import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { Vector3Data } from "./avatarPoseTypes";
import type { AvatarMotionConfig } from "./motionConfig";

export type WristEvidenceSource = "pose-world" | "hand-image" | "held" | "unavailable";

export interface WristEvidenceState {
  source: WristEvidenceSource;
  lastPoseSampledAtMs: number | null;
  estimatedPoseIntervalMs: number | null;
  lastPoseWorld: Vector3Data | null;
  lastPoseImage: Vector3Data | null;
  lastPoseAcceptedAtMs: number | null;
  lastHandImage: Vector3Data | null;
  lastHandSampledAtMs: number | null;
  handCandidateSinceMs: number | null;
  lastActiveSource: "pose-world" | "hand-image" | null;
  hadInactiveGap: boolean;
}

export interface WristEvidenceInput {
  nowMs: number;
  poseSampledAtMs: number | null;
  poseObservationIsNew: boolean;
  poseValid: boolean;
  poseWorld: RawNormalizedLandmarkV1 | null;
  poseImage: RawNormalizedLandmarkV1 | null;
  /** Optional raw visibility/confidence of Pose wrist. Old callers may omit it. */
  poseVisibility?: number | null;
  handObservationIsNew: boolean;
  handMatched: boolean;
  handSampledAtMs: number | null;
  handImage: RawNormalizedLandmarkV1 | null;
  /** image y scale in the same convention as Hand/Pose matching: height / width. */
  imageAspectRatio?: number | null;
}

export interface WristEvidenceOutput {
  source: WristEvidenceSource;
  sourceChanged: boolean;
  poseWorld: Vector3Data | null;
  poseImage: Vector3Data | null;
  handImage: Vector3Data | null;
  handAgeMs: number | null;
  poseHandDeltaMs: number | null;
  effectiveGraceMs: number;
  requiresReacquireBlend: boolean;
  /** Current Pose↔Hand wrist disagreement in aspect-corrected image space. */
  poseHandImageDistance: number | null;
  /** True only when Pose won the arbitration for this output sample. */
  poseTrusted: boolean;
}

export const createWristEvidenceState = (): WristEvidenceState => ({
  source: "unavailable",
  lastPoseSampledAtMs: null,
  estimatedPoseIntervalMs: null,
  lastPoseWorld: null,
  lastPoseImage: null,
  lastPoseAcceptedAtMs: null,
  lastHandImage: null,
  lastHandSampledAtMs: null,
  handCandidateSinceMs: null,
  lastActiveSource: null,
  hadInactiveGap: false,
});

const finitePoint = (point: RawNormalizedLandmarkV1 | null): point is RawNormalizedLandmarkV1 => Boolean(
  point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z),
);
const pointData = (point: RawNormalizedLandmarkV1): Vector3Data => ({ x: point.x, y: point.y, z: point.z });
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function updateCadence(state: WristEvidenceState, sampledAtMs: number, alpha: number): void {
  if (state.lastPoseSampledAtMs !== null && sampledAtMs > state.lastPoseSampledAtMs) {
    const interval = sampledAtMs - state.lastPoseSampledAtMs;
    if (Number.isFinite(interval)) {
      state.estimatedPoseIntervalMs = state.estimatedPoseIntervalMs === null
        ? interval
        : state.estimatedPoseIntervalMs + Math.max(0, Math.min(1, alpha)) * (interval - state.estimatedPoseIntervalMs);
    }
  }
  if (state.lastPoseSampledAtMs === null || sampledAtMs > state.lastPoseSampledAtMs) state.lastPoseSampledAtMs = sampledAtMs;
}

function aspectCorrectedDistance(
  a: Vector3Data | RawNormalizedLandmarkV1,
  b: Vector3Data | RawNormalizedLandmarkV1,
  imageAspectRatio: number,
): number | null {
  const ratio = Number.isFinite(imageAspectRatio) && imageAspectRatio > 0 ? imageAspectRatio : 1;
  const dx = a.x - b.x;
  const dy = (a.y - b.y) * ratio;
  const distance = Math.hypot(dx, dy);
  return Number.isFinite(distance) ? distance : null;
}

/**
 * Chỉ chọn NGUỒN bằng chứng wrist. Module này không tự bịa depth và không ghi landmark vào
 * Pose; reconstruction 2D→3D thuộc `wristReconstruction.ts`. State chỉ tiến trên sample mới,
 * nên duplicate render frame không thể làm Hand đủ thời gian xác nhận một cách giả tạo.
 *
 * Khác bản cũ: Pose wrist không còn thắng tuyệt đối chỉ vì visibility còn hợp lệ. Khi Hand
 * Landmarker đã match/confirm và vị trí wrist image bất đồng rõ với Pose, Pose bị hạ cấp để
 * reconstruction dùng Hand image. Điều này đặc biệt quan trọng khi tay che mặt/ngực: MediaPipe
 * Pose có thể giữ visibility cao nhưng endpoint 3D đã trôi.
 */
export function updateWristEvidence(
  state: WristEvidenceState,
  input: WristEvidenceInput,
  config: AvatarMotionConfig["wristEvidence"],
): WristEvidenceOutput {
  // Confirmation must describe a continuous run of Hand samples. A detector pause must not make
  // the first returning sample inherit an old candidate timer.
  const handContinuityBroken = state.lastHandSampledAtMs !== null
    && input.nowMs - state.lastHandSampledAtMs > config.handMaxAgeMs;
  if (handContinuityBroken) {
    state.handCandidateSinceMs = null;
    state.hadInactiveGap = true;
  }
  // Cadence belongs to the Pose detector even when this particular wrist sample is later
  // downgraded by Hand disagreement. Do not, however, promote an untrusted Pose wrist into the
  // held fallback until arbitration has accepted it.
  if (input.poseObservationIsNew && input.poseSampledAtMs !== null) {
    updateCadence(state, input.poseSampledAtMs, config.cadenceEwmaAlpha);
  }

  if (input.handObservationIsNew) {
    if (input.handMatched && input.handSampledAtMs !== null && finitePoint(input.handImage)) {
      state.lastHandImage = pointData(input.handImage);
      state.lastHandSampledAtMs = input.handSampledAtMs;
      state.handCandidateSinceMs ??= input.handSampledAtMs;
    } else {
      state.handCandidateSinceMs = null;
    }
  }

  const cadenceGrace = state.estimatedPoseIntervalMs === null
    ? config.minimumGraceMs
    : state.estimatedPoseIntervalMs * config.graceCadenceMultiplier;
  const effectiveGraceMs = Math.max(config.minimumGraceMs, Math.min(config.maximumGraceMs, cadenceGrace));
  const handAgeMs = state.lastHandSampledAtMs === null ? null : Math.max(0, input.nowMs - state.lastHandSampledAtMs);
  const poseHandDeltaMs = state.lastHandSampledAtMs === null || input.poseSampledAtMs === null
    ? null
    : Math.abs(state.lastHandSampledAtMs - input.poseSampledAtMs);
  const handConfirmedForMs = state.handCandidateSinceMs === null || state.lastHandSampledAtMs === null
    ? 0
    : state.lastHandSampledAtMs - state.handCandidateSinceMs;
  const handFresh = state.lastHandImage !== null && handAgeMs !== null && handAgeMs <= config.handMaxAgeMs;
  const handSynchronized = poseHandDeltaMs === null || poseHandDeltaMs <= config.poseHandMaxDeltaMs;
  const handConfirmed = handConfirmedForMs >= config.handEnterConfirmMs || (state.source === "hand-image" && !handContinuityBroken);

  const currentPoseValid = input.poseObservationIsNew && input.poseValid && finitePoint(input.poseWorld) && finitePoint(input.poseImage);
  const currentHandUsable = handFresh && handSynchronized && handConfirmed && state.lastHandImage !== null;
  const imageAspectRatio = input.imageAspectRatio ?? 1;
  const poseHandImageDistance = currentPoseValid && currentHandUsable && input.poseImage && state.lastHandImage
    ? aspectCorrectedDistance(input.poseImage, state.lastHandImage, imageAspectRatio)
    : null;

  const agreementDistance = Math.max(1e-4, config.poseHandAgreementDistance ?? 0.045);
  const disagreementDistance = Math.max(agreementDistance + 1e-4, config.poseHandDisagreementDistance ?? 0.12);
  const poseVisibilityFullTrust = clamp01(config.poseVisibilityFullTrust ?? 0.82);
  const poseVisibility = Number.isFinite(input.poseVisibility) ? clamp01(input.poseVisibility as number) : 1;

  const hardPoseHandConflict = poseHandImageDistance !== null && poseHandImageDistance >= disagreementDistance;
  const softPoseHandConflict = poseHandImageDistance !== null && poseHandImageDistance > agreementDistance;
  const poseStrong = poseVisibility >= poseVisibilityFullTrust;
  // Once Hand owns wrist because Pose disagreed, require close re-agreement before Pose takes
  // ownership back. This prevents source ping-pong at low detector FPS.
  const keepHandOwnership = state.source === "hand-image" && poseHandImageDistance !== null
    && poseHandImageDistance > agreementDistance * 0.8;

  let nextSource: WristEvidenceSource;
  // No new detector observation means no source transition merely because the render loop called us.
  if (!input.poseObservationIsNew && !input.handObservationIsNew) {
    nextSource = state.source;
  } else if (currentPoseValid && currentHandUsable) {
    if (hardPoseHandConflict || (softPoseHandConflict && !poseStrong) || keepHandOwnership) nextSource = "hand-image";
    else nextSource = "pose-world";
  } else if (currentPoseValid) {
    nextSource = "pose-world";
  } else if (currentHandUsable) {
    nextSource = "hand-image";
  } else if (state.lastPoseWorld && state.lastPoseAcceptedAtMs !== null && input.nowMs - state.lastPoseAcceptedAtMs <= effectiveGraceMs) {
    nextSource = "held";
  } else {
    nextSource = "unavailable";
  }

  // Persist only Pose wrist samples that actually won arbitration. A high-visibility Pose outlier
  // that Hand rejected must not become the future `held` fallback.
  if (nextSource === "pose-world" && currentPoseValid && input.poseSampledAtMs !== null) {
    state.lastPoseWorld = pointData(input.poseWorld!);
    state.lastPoseImage = pointData(input.poseImage!);
    state.lastPoseAcceptedAtMs = input.poseSampledAtMs;
  }

  const sourceChanged = nextSource !== state.source;
  const nextActiveSource = nextSource === "pose-world" || nextSource === "hand-image" ? nextSource : null;
  const requiresReacquireBlend = nextActiveSource !== null && state.lastActiveSource !== null
    && (nextActiveSource !== state.lastActiveSource || state.hadInactiveGap);
  if (nextActiveSource === null) state.hadInactiveGap = true;
  else state.hadInactiveGap = false;
  if (nextActiveSource) state.lastActiveSource = nextActiveSource;
  state.source = nextSource;

  return {
    source: nextSource,
    sourceChanged,
    poseWorld: state.lastPoseWorld,
    poseImage: state.lastPoseImage,
    handImage: state.lastHandImage,
    handAgeMs,
    poseHandDeltaMs,
    effectiveGraceMs,
    requiresReacquireBlend,
    poseHandImageDistance,
    poseTrusted: nextSource === "pose-world",
  };
}
