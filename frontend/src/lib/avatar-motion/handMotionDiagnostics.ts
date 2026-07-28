import type { ArmSide, HandSampleClassification } from "./avatarMotionDiagnostics";
import type { HandMatchContinuity } from "./handPoseMatching";
import type { HandMatchRejectionReason, HandPoseMatchResult, HandSideMatchResult } from "./handPoseMatching";
import type { HandBasisRejectionReason, HandBasisResult, HandPalmBasisOutput } from "./handPalmBasis";

/**
 * Mức 2A — Việc 3: tổng hợp THUẦN diagnostic từ kết quả matching (Việc 1) và palm basis
 * (Việc 2) thành một snapshot dễ đọc trên dev panel. Không tính toán hình học mới, không đọc
 * hay sửa jointRotations/pole/VRM — chỉ sắp xếp lại dữ liệu đã có kèm một `status` tổng hợp.
 */

export type PalmBasisPlain = HandBasisResult;
export type PalmBasisRejectionReason = HandBasisRejectionReason | null;
export type HandPoseMatchRejectionReason = HandMatchRejectionReason | null;

export type HandMotionStatus =
  | "not-sampled"
  | "duplicate"
  | "stale"
  | "no-candidates"
  | "unmatched"
  | "matched-no-palm"
  | "matched-partial-palm"
  | "matched";

export interface HandMotionSideDiagnostics {
  poseSide: ArmSide;

  handSampledThisFrame: boolean;
  sampleClassification: HandSampleClassification;
  handSampledAtMs: number | null;
  poseSampledAtMs: number | null;
  handPoseTimestampDeltaMs: number | null;

  candidatesCount: number;
  handDetected: boolean;
  handMatched: boolean;

  candidateSourceIndex: number | null;
  reportedHandedness: "left" | "right" | "unknown" | null;
  handednessScore: number | null;

  wristDistance: number | null;
  matchingCost: number | null;
  matchChanged: boolean;
  matchingContinuity: HandMatchContinuity | "not-evaluated";
  ranMatching: boolean;

  imageBasis: PalmBasisPlain | null;
  worldBasis: PalmBasisPlain | null;

  imageGeometryQuality: number;
  worldGeometryQuality: number;

  imagePalmRejectionReason: PalmBasisRejectionReason;
  worldPalmRejectionReason: PalmBasisRejectionReason;
  matchingRejectionReason: HandPoseMatchRejectionReason;

  status: HandMotionStatus;

  mirrorApplied: boolean;
}

export interface HandMotionDiagnosticsSnapshot {
  left: HandMotionSideDiagnostics;
  right: HandMotionSideDiagnostics;
}

export interface HandMotionDiagnosticsInput {
  handSampledThisFrame: boolean;
  handSampledAtMs: number | null;
  poseSampledAtMs: number | null;
  rawHandsCount: number;
  sampleClassification?: HandSampleClassification;
  matchResult: HandPoseMatchResult;
  /** Basis theo side đã match (đúng candidate được gán cho side đó); null nếu side không match. */
  palmBasisBySide: Record<ArmSide, HandPalmBasisOutput | null>;
}

/**
 * `matchingCost` không tồn tại trong `HandSideMatchResult` (chỉ có `distance` — số liệu
 * hình học thô, chưa cộng phạt handedness/thưởng continuity). Diagnostic hiện tại chỉ có thể
 * hiển thị distance; không tái tạo lại cost nội bộ của matcher (đó là chi tiết triển khai của
 * Việc 1, không phải hợp đồng public). Do đó `matchingCost` phản ánh distance đã báo cáo.
 */
function readMatchingCost(match: HandSideMatchResult): number | null {
  return match.matched ? match.distance : null;
}

function computeTimestampDelta(handSampledAtMs: number | null, poseSampledAtMs: number | null): number | null {
  return handSampledAtMs !== null && poseSampledAtMs !== null ? Math.abs(handSampledAtMs - poseSampledAtMs) : null;
}

/**
 * Thứ tự ưu tiên xác định `status`, đúng theo đặc tả: not-sampled trước stale trước
 * no-candidates trước unmatched trước matched-* — mỗi nhánh chỉ áp dụng khi các nhánh trước
 * không khớp, tránh việc "không sample" bị hiểu nhầm thành "không có candidate".
 */
function computeStatus(
  sampleClassification: HandSampleClassification,
  handSampledThisFrame: boolean,
  ranMatching: boolean,
  matchingRejectionReason: HandPoseMatchRejectionReason,
  rawHandsCount: number,
  match: HandSideMatchResult,
  imageBasis: PalmBasisPlain | null,
  worldBasis: PalmBasisPlain | null,
): HandMotionStatus {
  if (sampleClassification === "unsampled" || !handSampledThisFrame) return "not-sampled";
  if (sampleClassification === "duplicate") return "duplicate";
  if (ranMatching && matchingRejectionReason === "stale-frame") return "stale";
  if (rawHandsCount === 0) return "no-candidates";
  if (!match.matched) return "unmatched";
  const imageValid = imageBasis !== null;
  const worldValid = worldBasis !== null;
  if (!imageValid && !worldValid) return "matched-no-palm";
  if (imageValid !== worldValid) return "matched-partial-palm";
  return "matched";
}

function buildSideDiagnostics(
  side: ArmSide,
  input: HandMotionDiagnosticsInput,
  match: HandSideMatchResult,
): HandMotionSideDiagnostics {
  const palmResult = input.palmBasisBySide[side];
  const imageBasis = palmResult?.imageBasis ?? null;
  const worldBasis = palmResult?.worldBasis ?? null;
  const imageGeometryQuality = palmResult?.imageGeometryQuality ?? 0;
  const worldGeometryQuality = palmResult?.worldGeometryQuality ?? 0;
  const imagePalmRejectionReason = palmResult?.imageRejectionReason ?? null;
  const worldPalmRejectionReason = palmResult?.worldRejectionReason ?? null;

  const handPoseTimestampDeltaMs = computeTimestampDelta(input.handSampledAtMs, input.poseSampledAtMs);
  const sampleClassification = input.sampleClassification ?? (input.handSampledThisFrame ? "new-sample" : "unsampled");

  const status = computeStatus(
    sampleClassification,
    input.handSampledThisFrame,
    input.matchResult.ranMatching,
    match.rejectionReason,
    input.rawHandsCount,
    match,
    imageBasis,
    worldBasis,
  );

  return {
    poseSide: side,
    handSampledThisFrame: input.handSampledThisFrame,
    sampleClassification,
    handSampledAtMs: input.handSampledAtMs,
    poseSampledAtMs: input.poseSampledAtMs,
    handPoseTimestampDeltaMs,
    candidatesCount: input.rawHandsCount,
    handDetected: input.rawHandsCount > 0,
    handMatched: match.matched,
    candidateSourceIndex: match.matched ? match.candidateSourceIndex : null,
    reportedHandedness: match.handedness,
    handednessScore: match.handednessScore,
    wristDistance: match.distance,
    matchingCost: readMatchingCost(match),
    // matchChanged đến trực tiếp từ matcher (Việc 1), tính theo continuity vị trí wrist —
    // KHÔNG suy lại từ candidateSourceIndex, vì sourceIndex có thể đảo giữa các frame dù vẫn
    // là cùng một bàn tay thật (xem HandMatchContinuity trong handPoseMatching.ts).
    matchChanged: match.matched && match.matchChanged,
    matchingContinuity: input.matchResult.ranMatching ? match.continuity : "not-evaluated",
    ranMatching: input.matchResult.ranMatching,
    imageBasis: imageBasis ? { ...imageBasis, across: { ...imageBasis.across }, forward: { ...imageBasis.forward }, normal: { ...imageBasis.normal } } : null,
    worldBasis: worldBasis ? { ...worldBasis, across: { ...worldBasis.across }, forward: { ...worldBasis.forward }, normal: { ...worldBasis.normal } } : null,
    imageGeometryQuality,
    worldGeometryQuality,
    imagePalmRejectionReason,
    worldPalmRejectionReason,
    matchingRejectionReason: match.rejectionReason,
    status,
    mirrorApplied: false,
  };
}

export function buildHandMotionDiagnostics(input: HandMotionDiagnosticsInput): HandMotionDiagnosticsSnapshot {
  return {
    left: buildSideDiagnostics("left", input, input.matchResult.left),
    right: buildSideDiagnostics("right", input, input.matchResult.right),
  };
}
