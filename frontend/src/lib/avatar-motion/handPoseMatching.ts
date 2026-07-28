import type { RawHandCandidateV1, RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { ArmSide } from "./avatarMotionDiagnostics";

/**
 * Mức 2A — Việc 1: matching Hand Landmarker candidate ↔ Pose wrist (side trái/phải) trong
 * image space. KHÔNG trừ world position (Hand world và Pose world không cùng origin/scale —
 * xem AGENTS.md Mức 2A mục 2). Chỉ so sánh normalized image landmark (0..1) đã sửa aspect
 * ratio, để khoảng cách phản ánh đúng khoảng cách vật lý trên khung hình chữ nhật thật.
 */

export type HandMatchRejectionReason =
  | "no-candidates"
  | "wrist-distance-too-large"
  | "stale-frame"
  | "non-finite";

export interface HandMatchImagePoint { x: number; y: number }

export interface HandMatchConfig {
  /** Khoảng cách wrist tối đa (đơn vị: theo chiều rộng khung hình, sau khi sửa aspect ratio) để chấp nhận match. */
  maxWristDistance: number;
  /**
   * Tuổi tối đa (ms) của candidate so với thời điểm Pose được lấy mẫu trước khi coi SAMPLE
   * hiện tại là stale — so `handSampledAtMs` với `poseSampledAtMs` của CÙNG frame đang xử lý.
   * Khác hẳn `continuityTimeoutMs` (so với `lastMatchedAtMs` của LỊCH SỬ match).
   */
  maxHandAgeMs: number;
  /** Phạt mềm cộng vào distance khi handedness label không khớp side đang xét; không loại trừ ngay. */
  handednessMismatchPenalty: number;
  /** Thưởng trừ vào distance khi candidate gần vị trí match trước đó của cùng side (chống swap). */
  continuityBonusWeight: number;
  /** Khoảng cách tối đa so với match trước để continuity bonus còn áp dụng. */
  continuityMaxDistance: number;
  /**
   * Thời gian tối đa (ms) kể từ `lastMatchedAtMs` để lịch sử continuity của một side còn được
   * coi là hợp lệ. Nếu `handSampledAtMs - lastMatchedAtMs` vượt ngưỡng này, continuity không
   * được trả "continued" dù vị trí candidate mới có gần `wristPosition` cũ đến đâu — lịch sử
   * quá cũ để tin là cùng một lần theo dõi liên tục (không phải "current sample stale" như
   * `maxHandAgeMs`, mà là "previous continuity stale").
   */
  continuityTimeoutMs: number;
}

export const DEFAULT_HAND_MATCH_CONFIG: HandMatchConfig = {
  maxWristDistance: 0.35,
  maxHandAgeMs: 200,
  handednessMismatchPenalty: 0.08,
  continuityBonusWeight: 0.05,
  continuityMaxDistance: 0.25,
  continuityTimeoutMs: 1000,
};

export interface HandMatchPreviousState {
  /** Vị trí wrist (image space, đã sửa aspect ratio) của candidate từng match với side này, frame trước. */
  wristPosition: HandMatchImagePoint | null;
  /** Thời điểm (ms, cùng đồng hồ với `handSampledAtMs`) của lần match thành công gần nhất cho side này. null nếu chưa từng match. */
  lastMatchedAtMs: number | null;
}

/**
 * Liên tục hoá theo VỊ TRÍ wrist trước đó, không theo `sourceIndex` — MediaPipe có thể đảo thứ
 * tự candidate trong mảng kết quả giữa hai frame liên tiếp trong khi vẫn là cùng một bàn tay
 * thật. `candidateIndex`/`candidateSourceIndex` chỉ có ý nghĩa trong phạm vi một frame.
 *
 * - "unmatched": side này không match được candidate nào ở frame hiện tại.
 * - "new": match được nhưng không có match hợp lệ ở frame trước để so continuity (lần đầu).
 * - "continued": match được, và candidate được chọn nằm trong `continuityMaxDistance` so với
 *   vị trí wrist đã match ở frame trước — cùng một bàn tay thật, dù `sourceIndex` có đổi hay không.
 * - "reacquired": match được, nhưng candidate được chọn CÁCH XA vị trí match trước đó (ngoài
 *   `continuityMaxDistance`) — coi như bắt lại một bàn tay khác/mới xuất hiện ở vị trí khác.
 */
export type HandMatchContinuity = "unmatched" | "new" | "continued" | "reacquired";

export interface HandSideMatchResult {
  side: ArmSide;
  matched: boolean;
  /**
   * Vị trí (index) của candidate được chọn trong MẢNG `rawHands` của LẦN GỌI HIỆN TẠI — dùng
   * để truy cập `rawHands[candidateArrayIndex]` ngay trong frame này. KHÔNG mang ý nghĩa xuyên
   * frame: rawHands có thể bị filter/reorder trước khi truyền vào matcher, nên array index của
   * cùng một bàn tay thật có thể khác nhau giữa các lần gọi dù `sourceIndex` (MediaPipe gốc)
   * không đổi, hoặc ngược lại.
   */
  candidateArrayIndex: number | null;
  /** `sourceIndex` gốc từ MediaPipe của candidate được chọn — CHỈ dùng hiển thị diagnostic, không dùng làm identity xuyên frame (xem `HandMatchContinuity`). */
  candidateSourceIndex: number | null;
  distance: number | null;
  handedness: RawHandCandidateV1["handedness"] | null;
  handednessScore: number | null;
  rejectionReason: HandMatchRejectionReason | null;
  continuity: HandMatchContinuity;
  /** true khi match được VÀ continuity vừa chuyển "continued" -> khác, hoặc lần đầu match sau khi unmatched/mới. Không dựa sourceIndex hay array index. */
  matchChanged: boolean;
}

export interface HandPoseMatchResult {
  /** false nếu Việc này không chạy match mới ở frame hiện tại (hand detector không sample). */
  ranMatching: boolean;
  left: HandSideMatchResult;
  right: HandSideMatchResult;
}

function aspectCorrectedPoint(point: RawNormalizedLandmarkV1, videoWidth: number, videoHeight: number): HandMatchImagePoint {
  // Quy đổi toạ độ normalized [0,1]x[0,1] sang đơn vị vật lý theo chiều rộng khung hình, để
  // khoảng cách theo x và y đều tính bằng cùng đơn vị thật (tránh méo khi video không vuông).
  const aspect = videoHeight > 0 ? videoWidth / videoHeight : 1;
  return { x: point.x, y: point.y / aspect };
}

function isFinitePoint(point: HandMatchImagePoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function distance(a: HandMatchImagePoint, b: HandMatchImagePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

const HANDEDNESS_FOR_SIDE: Record<ArmSide, RawHandCandidateV1["handedness"]> = { left: "left", right: "right" };

interface CandidateInfo {
  /** Vị trí trong mảng `rawHands` truyền vào — dùng làm khoá nội bộ cho assignment vì luôn duy nhất trong một lần gọi, kể cả khi nhiều candidate trùng `sourceIndex` (không nên xảy ra nhưng không giả định). */
  arrayIndex: number;
  sourceIndex: number;
  wristPoint: HandMatchImagePoint;
  handedness: RawHandCandidateV1["handedness"];
  candidate: RawHandCandidateV1;
}

/**
 * Chi phí gán một candidate cho một side: wrist distance là tín hiệu chính; handedness sai chỉ
 * cộng thêm phạt mềm (chưa xác nhận convention/mirror bằng webcam thật nên không loại trừ
 * cứng); gần vị trí match trước của side đó được thưởng để chống đổi tay giữa hai frame liền kề.
 */
function assignmentCost(
  side: ArmSide,
  candidate: CandidateInfo,
  poseWrist: HandMatchImagePoint,
  previous: HandMatchPreviousState | undefined,
  config: HandMatchConfig,
): number {
  let cost = distance(candidate.wristPoint, poseWrist);
  if (candidate.handedness !== "unknown" && candidate.handedness !== HANDEDNESS_FOR_SIDE[side]) {
    cost += config.handednessMismatchPenalty;
  }
  if (previous?.wristPosition) {
    const continuityDistance = distance(candidate.wristPoint, previous.wristPosition);
    if (continuityDistance <= config.continuityMaxDistance) {
      cost -= config.continuityBonusWeight * (1 - continuityDistance / config.continuityMaxDistance);
    }
  }
  return cost;
}

function rejectedResult(side: ArmSide, reason: HandMatchRejectionReason): HandSideMatchResult {
  return { side, matched: false, candidateArrayIndex: null, candidateSourceIndex: null, distance: null, handedness: null, handednessScore: null, rejectionReason: reason, continuity: "unmatched", matchChanged: false };
}

/**
 * Đánh giá toàn bộ assignment khả dĩ (không greedy độc lập theo side): với tối đa hai candidate
 * và hai side, không gian assignment nhỏ nên liệt kê hết — chọn assignment có tổng cost thấp
 * nhất trong số các assignment hợp lệ (mỗi candidate được dùng cho tối đa một side).
 */
function bestAssignment(
  candidates: CandidateInfo[],
  poseWrists: Record<ArmSide, HandMatchImagePoint | null>,
  previous: Record<ArmSide, HandMatchPreviousState | undefined>,
  config: HandMatchConfig,
): Record<ArmSide, { arrayIndex: number; cost: number } | null> {
  const sides: ArmSide[] = ["left", "right"];
  let best: Record<ArmSide, { arrayIndex: number; cost: number } | null> = { left: null, right: null };
  let bestMatchCount = -1;
  let bestTotalCost = Infinity;

  // Assignment options: mỗi side có thể nhận "không candidate nào" (null) hoặc một candidate cụ
  // thể, khoá theo `arrayIndex` (vị trí trong mảng truyền vào lần gọi này) — không phải `sourceIndex`.
  const options: Array<number | null> = [null, ...candidates.map((c) => c.arrayIndex)];
  for (const leftChoice of options) {
    for (const rightChoice of options) {
      if (leftChoice !== null && leftChoice === rightChoice) continue; // một candidate không được gán cho cả hai side.
      let totalCost = 0;
      let matchCount = 0;
      const assignment: Record<ArmSide, { arrayIndex: number; cost: number } | null> = { left: null, right: null };
      let feasible = true;
      for (const side of sides) {
        const choice = side === "left" ? leftChoice : rightChoice;
        const poseWrist = poseWrists[side];
        if (choice === null || poseWrist === null) continue;
        const candidate = candidates.find((c) => c.arrayIndex === choice)!;
        const cost = assignmentCost(side, candidate, poseWrist, previous[side], config);
        if (cost > config.maxWristDistance) { feasible = false; break; }
        assignment[side] = { arrayIndex: choice, cost };
        totalCost += cost;
        matchCount += 1;
      }
      if (!feasible) continue;
      // Ưu tiên assignment khớp được nhiều side hơn (maximize matches); trong các assignment
      // khớp cùng số side, chọn tổng cost thấp nhất. Tránh việc "không gán gì" (cost=0) luôn
      // thắng chỉ vì rẻ hơn một assignment thật có cost dương nhỏ.
      if (matchCount > bestMatchCount || (matchCount === bestMatchCount && totalCost < bestTotalCost)) {
        bestMatchCount = matchCount; bestTotalCost = totalCost; best = assignment;
      }
    }
  }
  return best;
}

export interface MatchHandsToPoseInput {
  handSampledThisFrame: boolean;
  rawHands: RawHandCandidateV1[];
  poseWristImage: { left: RawNormalizedLandmarkV1 | null; right: RawNormalizedLandmarkV1 | null };
  poseSampledAtMs: number | null;
  handSampledAtMs: number | null;
  videoWidth: number;
  videoHeight: number;
  previous: { left?: HandMatchPreviousState; right?: HandMatchPreviousState };
  config?: HandMatchConfig;
}

export function matchHandsToPose(input: MatchHandsToPoseInput): HandPoseMatchResult {
  const config = input.config ?? DEFAULT_HAND_MATCH_CONFIG;

  // Không lấy mẫu hands ở frame này: không phải "mất tay" (đó chỉ là staggered sampling) —
  // không chạy matching mới, caller giữ nguyên state/continuity từ lần match trước.
  if (!input.handSampledThisFrame) {
    return { ranMatching: false, left: rejectedResult("left", "no-candidates"), right: rejectedResult("right", "no-candidates") };
  }

  if (input.rawHands.length === 0) {
    // Detector đã chạy và không thấy tay nào: đây LÀ một observation mới (no-hand), khác hẳn
    // trường hợp không sample ở trên.
    return { ranMatching: true, left: rejectedResult("left", "no-candidates"), right: rejectedResult("right", "no-candidates") };
  }

  if (
    input.poseSampledAtMs !== null &&
    input.handSampledAtMs !== null &&
    Math.abs(input.poseSampledAtMs - input.handSampledAtMs) > config.maxHandAgeMs
  ) {
    return { ranMatching: true, left: rejectedResult("left", "stale-frame"), right: rejectedResult("right", "stale-frame") };
  }

  const candidates: CandidateInfo[] = [];
  input.rawHands.forEach((candidate, arrayIndex) => {
    const wrist = candidate.landmarks[0];
    if (!wrist) return;
    const wristPoint = aspectCorrectedPoint(wrist, input.videoWidth, input.videoHeight);
    if (!isFinitePoint(wristPoint)) return;
    candidates.push({ arrayIndex, sourceIndex: candidate.sourceIndex, wristPoint, handedness: candidate.handedness, candidate });
  });
  if (candidates.length === 0) {
    return { ranMatching: true, left: rejectedResult("left", "non-finite"), right: rejectedResult("right", "non-finite") };
  }

  const poseWrists: Record<ArmSide, HandMatchImagePoint | null> = {
    left: input.poseWristImage.left && isFinitePoint(aspectCorrectedPoint(input.poseWristImage.left, input.videoWidth, input.videoHeight))
      ? aspectCorrectedPoint(input.poseWristImage.left, input.videoWidth, input.videoHeight) : null,
    right: input.poseWristImage.right && isFinitePoint(aspectCorrectedPoint(input.poseWristImage.right, input.videoWidth, input.videoHeight))
      ? aspectCorrectedPoint(input.poseWristImage.right, input.videoWidth, input.videoHeight) : null,
  };

  const previous: Record<ArmSide, HandMatchPreviousState | undefined> = { left: input.previous.left, right: input.previous.right };
  const assignment = bestAssignment(candidates, poseWrists, previous, config);

  const buildSideResult = (side: ArmSide): HandSideMatchResult => {
    if (poseWrists[side] === null) return rejectedResult(side, "non-finite");
    const chosen = assignment[side];
    if (!chosen) return rejectedResult(side, "wrist-distance-too-large");
    const candidate = candidates.find((c) => c.arrayIndex === chosen.arrayIndex)!;

    // Continuity dựa trên VỊ TRÍ wrist đã match ở frame trước cho side này — không dựa
    // sourceIndex/arrayIndex, để MediaPipe đảo thứ tự hoặc rawHands bị filter/reorder trước
    // khi truyền vào không bị hiểu nhầm là đổi tay.
    const previousState = previous[side];
    const previousWrist = previousState?.wristPosition ?? null;
    // "previous continuity stale": lịch sử match đã quá lâu (so lastMatchedAtMs với sample
    // hiện tại) — khác với "current sample stale" (maxHandAgeMs, so poseSampledAtMs/handSampledAtMs
    // của CÙNG frame, đã được lọc ở nhánh "stale-frame" phía trên trước khi tới đây).
    const continuityExpired = Boolean(
      previousState &&
      previousState.lastMatchedAtMs !== null &&
      input.handSampledAtMs !== null &&
      input.handSampledAtMs - previousState.lastMatchedAtMs > config.continuityTimeoutMs,
    );
    let continuity: HandMatchContinuity;
    if (!previousWrist || continuityExpired) {
      continuity = "new";
    } else {
      const continuityDistance = distance(candidate.wristPoint, previousWrist);
      continuity = continuityDistance <= config.continuityMaxDistance ? "continued" : "reacquired";
    }
    const matchChanged = continuity !== "continued";

    return {
      side, matched: true, candidateArrayIndex: chosen.arrayIndex, candidateSourceIndex: candidate.sourceIndex,
      distance: distance(candidate.wristPoint, poseWrists[side]!),
      handedness: candidate.handedness, handednessScore: candidate.candidate.handednessScore,
      rejectionReason: null, continuity, matchChanged,
    };
  };

  return { ranMatching: true, left: buildSideResult("left"), right: buildSideResult("right") };
}
