import type { GestureClassification, GesturePoseLabel } from "./gestureClassifier";

/**
 * Phase 3B.3 — Bước 1: ổn định nhãn cử chỉ theo thời gian.
 *
 * Classifier chạy mỗi sample và có thể đổi ý liên tục ở vùng ranh giới. Phát thẳng đầu ra của nó
 * lên avatar sẽ làm ngón nhấp nháy. Module này quyết định KHI NÀO một nhãn mới đủ ổn định để phát.
 *
 * Ba nguyên tắc bắt buộc:
 *
 * 1. **Đếm theo thời gian thực, không theo số frame.** Đếm frame làm hành vi phụ thuộc FPS: cùng
 *    một cử chỉ giữ 120ms sẽ promote ở 60 FPS nhưng không promote ở 15 FPS.
 * 2. **Sample trùng không đẩy nhanh promotion.** Hand Landmarker chạy chậm hơn render loop, nên
 *    nhiều render frame dùng lại đúng một sample. Nếu tính mỗi lần gọi là một quan sát mới thì
 *    render nhanh sẽ promote sớm hơn — lại là phụ thuộc FPS qua đường khác.
 * 3. **`unknown-observed` phải NHẢ nhãn cũ.** Bàn tay hiện rõ ở tư thế không hỗ trợ mà avatar giữ
 *    `fist` vô hạn là trạng thái sai, không phải chống rung. Chỉ `unknown-low-quality` mới được
 *    giữ nhãn cũ, và chỉ tạm thời.
 */

export type GestureTemporalPhase = "stable" | "promoting" | "holding-low-quality" | "releasing" | "rest";

export interface GestureTemporalConfig {
  /** Nhãn mới phải ổn định liên tục bấy nhiêu ms mới được phát. */
  promotionMs: number;
  /** `unknown-low-quality` được giữ nhãn cũ tối đa bấy nhiêu ms, sau đó về `relaxed`. */
  lowQualityHoldMs: number;
  /** `unknown-observed` ổn định bấy nhiêu ms thì nhả nhãn cũ về `relaxed`. */
  unknownReleaseMs: number;
  /** Mất hẳn bàn tay bấy nhiêu ms thì về `rest`. */
  handLostMs: number;
  /** Dưới mức này thì quan sát không được tính là ứng viên promotion. */
  minConfidence: number;
}

/**
 * Giá trị khởi tạo theo suy luận:
 * - `promotionMs` 120: đủ để lọc nhiễu một-hai sample, vẫn dưới ngưỡng người dùng cảm thấy trễ (~150ms).
 * - `lowQualityHoldMs` 500: che được lúc tay lướt qua vùng khuất, không giữ lâu tới mức thành sai.
 * - `unknownReleaseMs` 350: ngắn hơn low-quality vì đây là quan sát TỐT nói rằng tư thế đã đổi.
 */
export const DEFAULT_GESTURE_TEMPORAL_CONFIG: GestureTemporalConfig = {
  promotionMs: 120,
  lowQualityHoldMs: 500,
  unknownReleaseMs: 350,
  handLostMs: 500,
  minConfidence: 0.5,
};

export interface GestureTemporalState {
  /** Nhãn đang phát ra avatar. */
  activePose: GesturePoseLabel;
  phase: GestureTemporalPhase;
  /** Nhãn đang chờ đủ thời gian để thay thế `activePose`. */
  candidateLabel: GesturePoseLabel | null;
  candidateSinceMs: number | null;
  /** Mốc bắt đầu của trạng thái bất thường đang diễn ra (low-quality / observed / hand-lost). */
  degradedSinceMs: number | null;
  /** Timestamp của sample đã tiêu thụ gần nhất — dùng để bỏ qua sample trùng. */
  lastObservationAtMs: number | null;
}

export const INITIAL_GESTURE_TEMPORAL_STATE: GestureTemporalState = {
  activePose: "rest",
  phase: "rest",
  candidateLabel: null,
  candidateSinceMs: null,
  degradedSinceMs: null,
  lastObservationAtMs: null,
};

export interface GestureTemporalInput {
  /**
   * Kết quả classifier của sample mới. `null` nghĩa là frame này KHÔNG có quan sát mới — hoặc
   * detector chưa chạy lại, hoặc bàn tay không được match. Phân biệt với `handPresent` bên dưới.
   */
  classification: GestureClassification | null;
  /** Bàn tay có được phát hiện ở frame này không. false → đếm về `rest`. */
  handPresent: boolean;
  /**
   * Timestamp của sample Hand Landmarker sinh ra `classification`. Trùng với lần trước nghĩa là
   * cùng một quan sát được dùng lại — không tính là bằng chứng mới.
   */
  observationAtMs: number | null;
  nowMs: number;
}

export interface GestureTemporalResult {
  state: GestureTemporalState;
  /** Nhãn phát ra avatar ở frame này. */
  pose: GesturePoseLabel;
  /** True khi `pose` vừa đổi so với frame trước — dùng cho diagnostic. */
  poseChanged: boolean;
}

export function updateGestureTemporal(
  previous: GestureTemporalState,
  input: GestureTemporalInput,
  config: GestureTemporalConfig = DEFAULT_GESTURE_TEMPORAL_CONFIG,
): GestureTemporalResult {
  const state: GestureTemporalState = { ...previous };
  const previousPose = previous.activePose;

  // ── Mất bàn tay ────────────────────────────────────────────────────────────────────────────
  // Đếm bằng thời gian thực nên frame duplicate không ảnh hưởng: chỉ mốc bắt đầu được ghi.
  if (!input.handPresent) {
    state.candidateLabel = null;
    state.candidateSinceMs = null;
    state.degradedSinceMs ??= input.nowMs;
    if (input.nowMs - state.degradedSinceMs >= config.handLostMs) {
      state.activePose = "rest";
      state.phase = "rest";
    } else {
      state.phase = "holding-low-quality";
    }
    return { state, pose: state.activePose, poseChanged: state.activePose !== previousPose };
  }

  // ── Không có quan sát MỚI ──────────────────────────────────────────────────────────────────
  // Sample trùng hoặc frame render không kèm sample: giữ nguyên mọi bộ đếm. Đây là điều kiện bảo
  // đảm bất biến FPS — render nhanh không được đẩy nhanh promotion.
  const isNewObservation = input.classification !== null
    && input.observationAtMs !== null
    && input.observationAtMs !== previous.lastObservationAtMs;
  if (!isNewObservation) {
    // Ngoại lệ: các timer đã khởi động vẫn phải chạy theo thời gian thực, nếu không thì bàn tay
    // đứng yên ở tư thế không hỗ trợ sẽ giữ nhãn cũ mãi khi detector chạy chậm.
    return applyElapsedTimers(state, input, config, previousPose);
  }

  state.lastObservationAtMs = input.observationAtMs;
  const classification = input.classification!;

  // ── Quan sát kém: được giữ nhãn cũ, nhưng có hạn ───────────────────────────────────────────
  if (classification.label === "unknown-low-quality") {
    state.candidateLabel = null;
    state.candidateSinceMs = null;
    state.degradedSinceMs ??= input.nowMs;
    if (input.nowMs - state.degradedSinceMs >= config.lowQualityHoldMs) {
      state.activePose = "relaxed";
      state.phase = "stable";
      state.degradedSinceMs = null;
    } else {
      state.phase = "holding-low-quality";
    }
    return { state, pose: state.activePose, poseChanged: state.activePose !== previousPose };
  }

  // ── Quan sát tốt nhưng không khớp luật: PHẢI nhả nhãn cũ ───────────────────────────────────
  if (classification.label === "unknown-observed") {
    state.candidateLabel = null;
    state.candidateSinceMs = null;
    state.degradedSinceMs ??= input.nowMs;
    if (input.nowMs - state.degradedSinceMs >= config.unknownReleaseMs) {
      state.activePose = "relaxed";
      state.phase = "stable";
      state.degradedSinceMs = null;
    } else {
      state.phase = "releasing";
    }
    return { state, pose: state.activePose, poseChanged: state.activePose !== previousPose };
  }

  // ── Nhãn tư thế hợp lệ ─────────────────────────────────────────────────────────────────────
  state.degradedSinceMs = null;
  // Confidence thấp không đủ tư cách làm ứng viên, nhưng cũng không phải bằng chứng để nhả nhãn
  // hiện tại — coi như chưa có thông tin.
  if (classification.confidence < config.minConfidence) {
    state.candidateLabel = null;
    state.candidateSinceMs = null;
    state.phase = "stable";
    return { state, pose: state.activePose, poseChanged: false };
  }

  const label = classification.label as GesturePoseLabel;
  if (label === state.activePose) {
    state.candidateLabel = null;
    state.candidateSinceMs = null;
    state.phase = "stable";
    return { state, pose: state.activePose, poseChanged: false };
  }

  if (state.candidateLabel !== label) {
    state.candidateLabel = label;
    state.candidateSinceMs = input.nowMs;
    state.phase = "promoting";
    return { state, pose: state.activePose, poseChanged: false };
  }

  if (state.candidateSinceMs !== null && input.nowMs - state.candidateSinceMs >= config.promotionMs) {
    state.activePose = label;
    state.candidateLabel = null;
    state.candidateSinceMs = null;
    state.phase = "stable";
    return { state, pose: state.activePose, poseChanged: true };
  }

  state.phase = "promoting";
  return { state, pose: state.activePose, poseChanged: false };
}

/**
 * Frame không có quan sát mới: không tạo bằng chứng, nhưng timer đã chạy thì vẫn phải đến hạn.
 * Nếu không, detector chạy chậm sẽ khiến nhãn cũ bị giữ quá thời gian đã hứa.
 */
function applyElapsedTimers(
  state: GestureTemporalState,
  input: GestureTemporalInput,
  config: GestureTemporalConfig,
  previousPose: GesturePoseLabel,
): GestureTemporalResult {
  if (state.degradedSinceMs !== null) {
    const elapsed = input.nowMs - state.degradedSinceMs;
    const limit = state.phase === "releasing" ? config.unknownReleaseMs : config.lowQualityHoldMs;
    if (elapsed >= limit) {
      state.activePose = "relaxed";
      state.phase = "stable";
      state.degradedSinceMs = null;
    }
  }
  return { state, pose: state.activePose, poseChanged: state.activePose !== previousPose };
}
