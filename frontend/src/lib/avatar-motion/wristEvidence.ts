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
}

export interface WristEvidenceInput {
  nowMs: number;
  poseSampledAtMs: number | null;
  poseObservationIsNew: boolean;
  poseValid: boolean;
  poseWorld: RawNormalizedLandmarkV1 | null;
  poseImage: RawNormalizedLandmarkV1 | null;
  handObservationIsNew: boolean;
  handMatched: boolean;
  handSampledAtMs: number | null;
  handImage: RawNormalizedLandmarkV1 | null;
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
});

const finitePoint = (point: RawNormalizedLandmarkV1 | null): point is RawNormalizedLandmarkV1 => Boolean(
  point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z),
);
const pointData = (point: RawNormalizedLandmarkV1): Vector3Data => ({ x: point.x, y: point.y, z: point.z });

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

/**
 * Chỉ chọn NGUỒN bằng chứng wrist. Module này không tự bịa depth và không ghi landmark vào
 * Pose; reconstruction 2D→3D thuộc `wristReconstruction.ts`. State chỉ tiến trên sample mới,
 * nên duplicate render frame không thể làm Hand đủ thời gian xác nhận một cách giả tạo.
 */
export function updateWristEvidence(
  state: WristEvidenceState,
  input: WristEvidenceInput,
  config: AvatarMotionConfig["wristEvidence"],
): WristEvidenceOutput {
  if (input.poseObservationIsNew && input.poseSampledAtMs !== null) {
    updateCadence(state, input.poseSampledAtMs, config.cadenceEwmaAlpha);
    if (input.poseValid && finitePoint(input.poseWorld) && finitePoint(input.poseImage)) {
      state.lastPoseWorld = pointData(input.poseWorld);
      state.lastPoseImage = pointData(input.poseImage);
      state.lastPoseAcceptedAtMs = input.poseSampledAtMs;
    }
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
  const handConfirmed = handConfirmedForMs >= config.handEnterConfirmMs || state.source === "hand-image";

  let nextSource: WristEvidenceSource;
  const currentPoseValid = input.poseObservationIsNew && input.poseValid && finitePoint(input.poseWorld) && finitePoint(input.poseImage);
  // Không có sample detector mới thì không được tự đổi nguồn chỉ vì render loop gọi lại.
  // Freshness/grace vẫn được báo theo đồng hồ thật, nhưng quyền điều khiển chỉ đổi tại biên
  // observation để duplicate frame không tạo một transition giả.
  if (!input.poseObservationIsNew && !input.handObservationIsNew) nextSource = state.source;
  else if (currentPoseValid) nextSource = "pose-world";
  else if (handFresh && handSynchronized && handConfirmed) nextSource = "hand-image";
  else if (state.lastPoseWorld && state.lastPoseAcceptedAtMs !== null && input.nowMs - state.lastPoseAcceptedAtMs <= effectiveGraceMs) nextSource = "held";
  else nextSource = "unavailable";

  const sourceChanged = nextSource !== state.source;
  const nextActiveSource = nextSource === "pose-world" || nextSource === "hand-image" ? nextSource : null;
  const requiresReacquireBlend = nextActiveSource !== null && state.lastActiveSource !== null && nextActiveSource !== state.lastActiveSource;
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
  };
}
