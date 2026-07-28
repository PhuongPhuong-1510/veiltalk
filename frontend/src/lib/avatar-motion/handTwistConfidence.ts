/**
 * Mức 2B — Việc 3: kết hợp nhiều tín hiệu chất lượng thô (match quality, palm geometry
 * quality, projection leverage, freshness, Pose-Hand timestamp delta, handedness score) thành
 * MỘT overallQuality liên tục [0,1] và một `trusted` boolean có enter/exit hysteresis, để dùng
 * làm cơ sở khi caller (Mức 2B — Việc 4, temporal layer) làm mượt influence weight theo thời
 * gian thực (dtSeconds + rise/fall rate), KHÔNG theo số lần gọi.
 *
 * THUẦN: không tạo quaternion, không temporal unwrap, không rate-limit theo lần gọi, không
 * đọc/sửa jointRotations, armFrameSolver, temporal state hoặc VRM (AGENTS.md Mức 2B mục 8).
 * Module không giữ state nội bộ — `previousTrusted` do caller lưu và truyền lại mỗi frame chỉ
 * để quyết định hysteresis, KHÔNG dùng để làm mượt bất kỳ giá trị số nào ở đây.
 */

export type HandTwistConfidenceRejectionReason =
  | "non-finite"
  | "hand-not-fresh"
  | "timestamp-delta-too-large"
  | "projection-degenerate"
  | "below-hysteresis-threshold";

export interface HandTwistConfidenceConfig {
  /** Tuổi tối đa (ms) của mẫu Hand trước khi freshness quality về 0. */
  maxHandAgeMs: number;
  /** Lệch timestamp tối đa (ms) giữa Pose và Hand trước khi timestampQuality về 0. */
  maxPoseHandDeltaMs: number;
  /** Ngưỡng overallQuality để CHUYỂN sang trusted=true khi đang không trusted (enter). Cao hơn exitThreshold để tạo hysteresis, tránh dao động quanh một ngưỡng đơn. */
  enterThreshold: number;
  /** Ngưỡng overallQuality để RỜI trusted=true (exit) khi đang trusted. Thấp hơn enterThreshold. */
  exitThreshold: number;
  /** Trọng số kết hợp match/palm-geometry/handedness thành softQuality. Không cần tổng = 1 tuyệt đối nhưng nên xấp xỉ 1 để softQuality nằm trong [0,1]. */
  softWeights: {
    matchQuality: number;
    palmGeometryQuality: number;
    handednessQuality: number;
  };
}

export const DEFAULT_HAND_TWIST_CONFIDENCE_CONFIG: HandTwistConfidenceConfig = {
  maxHandAgeMs: 200,
  maxPoseHandDeltaMs: 150,
  enterThreshold: 0.55,
  exitThreshold: 0.35,
  softWeights: {
    matchQuality: 0.45,
    palmGeometryQuality: 0.45,
    handednessQuality: 0.1,
  },
};

export interface HandTwistConfidenceInput {
  /** true nếu Hand đã match được Pose side này ở frame hiện tại (từ `HandSideMatchResult.matched`). false/unmatched luôn reject an toàn, bất kể các quality khác. */
  handMatched: boolean;
  /** true nếu `computeHandForearmTwist` chấp nhận (accepted=true) ở frame hiện tại. Reject ở twist luôn kéo theo reject ở đây — twist không tồn tại thì confidence không có gì để đánh giá. */
  twistAccepted: boolean;
  /** Chất lượng match Hand↔Pose, 0..1. Caller quy đổi từ `HandSideMatchResult` (vd 1 - distance/maxWristDistance) — module này không tự suy ra cách quy đổi. */
  matchQuality: number;
  /** Chất lượng hình học palm basis (imageGeometryQuality hoặc worldGeometryQuality), 0..1. */
  palmGeometryQuality: number;
  /** `palmProjectionRatio` từ `HandForearmTwistResult` — tỉ lệ [0,1], ĐÃ độc lập với scale của palmBasis/referenceDirection (yêu cầu #4). null nếu twist bị reject trước bước chiếu. */
  palmProjectionRatio: number | null;
  /** `referenceProjectionRatio` từ `HandForearmTwistResult` — cùng ý nghĩa, cho phía reference. */
  referenceProjectionRatio: number | null;
  /** Tuổi (ms) của mẫu Hand tại thời điểm đánh giá: nowMs - handSampledAtMs. null nếu chưa từng sample. */
  handAgeMs: number | null;
  /** |poseSampledAtMs - handSampledAtMs|, ms. null nếu một trong hai chưa sample. */
  poseHandTimestampDeltaMs: number | null;
  /** Điểm tin cậy handedness do MediaPipe báo cáo, 0..1, hoặc null nếu không có. Chỉ là tín hiệu MỀM (yêu cầu #2) — không dùng để hard-reject dù thấp hay thiếu. */
  handednessScore: number | null;
  /** true nếu side này đang được coi là "trusted" từ lần đánh giá trước — dùng làm điểm neo cho enter/exit hysteresis (yêu cầu #4 gốc / Việc 3). KHÔNG dùng để làm mượt số. */
  previousTrusted: boolean;
}

export interface HandTwistConfidenceResult {
  /** true nếu side này được coi là trusted sau khi áp hysteresis ở lần đánh giá này — trở thành `previousTrusted` cho lần gọi kế tiếp. */
  trusted: boolean;
  /** Quality tổng hợp trong [0,1] = softQuality * observabilityQuality (0 khi handMatched=false hoặc twistAccepted=false). Đây là input cho temporal layer (Việc 4), KHÔNG phải giá trị đã làm mượt theo thời gian. */
  overallQuality: number;
  /**
   * Trọng số MỤC TIÊU (chưa làm mượt) nếu caller trộn twist ngay tại frame này: bằng
   * `overallQuality` khi trusted, 0 khi không trusted. Temporal layer (Mức 2B — Việc 4) sẽ tiến
   * influence weight thực tế về giá trị này theo `dtSeconds` và rise/fall rate — module này
   * KHÔNG tự làm mượt, không rate-limit theo lần gọi (yêu cầu #1).
   */
  targetInfluenceWeight: number;
  rejectionReason: HandTwistConfidenceRejectionReason | null;
  components: {
    matchQuality: number;
    palmGeometryQuality: number;
    handednessQuality: number;
    projectionQuality: number;
    freshnessQuality: number;
    timestampQuality: number;
    softQuality: number;
    observabilityQuality: number;
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isFiniteOrNull(value: number | null): boolean {
  return value === null || Number.isFinite(value);
}

/** Tuyến tính giảm từ 1 (tại 0ms) về 0 (tại maxMs). null age = chưa từng sample = quality 0. */
function linearAgeQuality(ageMs: number | null, maxMs: number): number {
  if (ageMs === null) return 0;
  if (ageMs <= 0) return 1;
  if (ageMs >= maxMs) return 0;
  return 1 - ageMs / maxMs;
}

function zeroComponents(): HandTwistConfidenceResult["components"] {
  return {
    matchQuality: 0, palmGeometryQuality: 0, handednessQuality: 0,
    projectionQuality: 0, freshnessQuality: 0, timestampQuality: 0,
    softQuality: 0, observabilityQuality: 0,
  };
}

export function computeHandTwistConfidence(
  input: HandTwistConfidenceInput,
  config: HandTwistConfidenceConfig = DEFAULT_HAND_TWIST_CONFIDENCE_CONFIG,
): HandTwistConfidenceResult {
  const numericInputsValid =
    Number.isFinite(input.matchQuality) &&
    Number.isFinite(input.palmGeometryQuality) &&
    isFiniteOrNull(input.palmProjectionRatio) &&
    isFiniteOrNull(input.referenceProjectionRatio) &&
    isFiniteOrNull(input.handAgeMs) &&
    isFiniteOrNull(input.poseHandTimestampDeltaMs) &&
    isFiniteOrNull(input.handednessScore);

  if (!numericInputsValid) {
    return {
      trusted: false, overallQuality: 0, targetInfluenceWeight: 0,
      rejectionReason: "non-finite", components: zeroComponents(),
    };
  }

  // Hand unmatched hoặc twist reject luôn reject an toàn (yêu cầu #2) — không có hình học hợp
  // lệ để đánh giá quality trên, bất kể các component khác nói gì.
  if (!input.handMatched || !input.twistAccepted) {
    const reason: HandTwistConfidenceRejectionReason = !input.handMatched ? "below-hysteresis-threshold" : "projection-degenerate";
    return { trusted: false, overallQuality: 0, targetInfluenceWeight: 0, rejectionReason: reason, components: zeroComponents() };
  }

  const matchQuality = clamp01(input.matchQuality);
  const palmGeometryQuality = clamp01(input.palmGeometryQuality);
  // Handedness chỉ là tín hiệu MỀM (yêu cầu #2 gốc / #3 lần này): thiếu score KHÔNG được kéo
  // quality xuống — loại hẳn component này khỏi softQuality và chuẩn hoá lại trọng số phần còn
  // lại, thay vì gán giá trị trung tính giả định (0.5 hay 1.0 đều là suy đoán không có căn cứ).
  const handednessAvailable = input.handednessScore !== null;
  const handednessQuality = handednessAvailable ? clamp01(input.handednessScore as number) : 0;

  const w = config.softWeights;
  const activeWeightSum = w.matchQuality + w.palmGeometryQuality + (handednessAvailable ? w.handednessQuality : 0);
  const softQuality = activeWeightSum > 0
    ? clamp01((matchQuality * w.matchQuality + palmGeometryQuality * w.palmGeometryQuality + (handednessAvailable ? handednessQuality * w.handednessQuality : 0)) / activeWeightSum)
    : 0;

  // observabilityQuality: NHÂN (không phải trung bình có trọng số) ba tín hiệu "có đủ căn cứ
  // hình học/thời gian để tin twist này không" — projection gần zero, hand quá cũ, hoặc lệch
  // timestamp quá lớn đều phải kéo toàn bộ observabilityQuality về gần 0 một mình, không thể bị
  // các tín hiệu tốt khác (vd match quality cao) che lấp như weighted average sẽ làm (yêu cầu #2).
  const projectionQuality = clamp01(Math.min(input.palmProjectionRatio ?? 0, input.referenceProjectionRatio ?? 0));
  const freshnessQuality = linearAgeQuality(input.handAgeMs, config.maxHandAgeMs);
  const timestampQuality = linearAgeQuality(input.poseHandTimestampDeltaMs, config.maxPoseHandDeltaMs);
  const observabilityQuality = clamp01(projectionQuality * freshnessQuality * timestampQuality);

  const overallQuality = clamp01(softQuality * observabilityQuality);

  const components = {
    matchQuality, palmGeometryQuality, handednessQuality: handednessAvailable ? handednessQuality : 0,
    projectionQuality, freshnessQuality, timestampQuality, softQuality, observabilityQuality,
  };

  // Enter/exit hysteresis quanh hai ngưỡng khác nhau (yêu cầu #4 gốc / #3 lần này giữ nguyên):
  // nếu đang trusted, chỉ rời trusted khi quality tụt xuống DƯỚI exitThreshold; nếu đang không
  // trusted, chỉ vào trusted khi quality vượt LÊN TRÊN enterThreshold — vùng giữa hai ngưỡng
  // giữ nguyên trạng thái trước đó, tránh dao động quanh một ngưỡng đơn.
  const trusted = input.previousTrusted
    ? overallQuality >= config.exitThreshold
    : overallQuality >= config.enterThreshold;

  const targetInfluenceWeight = trusted ? overallQuality : 0;

  let rejectionReason: HandTwistConfidenceRejectionReason | null = null;
  if (!trusted) {
    if (input.handAgeMs === null || input.handAgeMs >= config.maxHandAgeMs) rejectionReason = "hand-not-fresh";
    else if (input.poseHandTimestampDeltaMs !== null && input.poseHandTimestampDeltaMs >= config.maxPoseHandDeltaMs) rejectionReason = "timestamp-delta-too-large";
    else if (projectionQuality <= 0) rejectionReason = "projection-degenerate";
    else rejectionReason = "below-hysteresis-threshold";
  }

  return { trusted, overallQuality, targetInfluenceWeight, rejectionReason, components };
}
