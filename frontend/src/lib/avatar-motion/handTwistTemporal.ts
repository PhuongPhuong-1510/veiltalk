/**
 * Mức 2B-5: temporal layer nhận correction target ĐÃ unwrapped từ stabilization. Module này
 * chỉ rate-limit angle, smooth influence và chạy hold/fade theo thời gian thực; KHÔNG unwrap.
 */

export type HandTwistTrackingState = "inactive" | "acquiring" | "tracking" | "holding" | "fading";
export type HandTwistObservationMode = "valid" | "unsampled" | "duplicate" | "missing";
export type HandTwistTemporalRejectionReason = "none" | "invalid-dt" | "non-finite-target" | "no-accepted-target";

export interface HandTwistTemporalState {
  initialized: boolean;
  acceptedTargetCorrectionRadians: number;
  acceptedTargetInfluenceWeight: number;
  stabilizedTwistRadians: number;
  influenceWeight: number;
  lostDurationSeconds: number;
}

export const INITIAL_HAND_TWIST_TEMPORAL_STATE: HandTwistTemporalState = {
  initialized: false,
  acceptedTargetCorrectionRadians: 0,
  acceptedTargetInfluenceWeight: 0,
  stabilizedTwistRadians: 0,
  influenceWeight: 0,
  lostDurationSeconds: 0,
};

export interface HandTwistTemporalInput {
  observationMode: HandTwistObservationMode;
  /** Chỉ bắt buộc ở mode=valid; target đã unwrapped/dead-zone/filter/clamp. */
  targetCorrectionRadians: number | null;
  targetInfluenceWeight: number | null;
  /** Missing lifecycle được processor tính bằng nowMs-missingSinceMs, không theo frame count. */
  missingDurationSeconds: number;
  dtSeconds: number;
}

export interface HandTwistTemporalResult {
  state: HandTwistTemporalState;
  stabilizedTwistRadians: number;
  influenceWeight: number;
  trackingState: HandTwistTrackingState;
  angleDeltaRadians: number;
  temporalAdvancedWithoutNewObservation: boolean;
  resetOccurred: boolean;
  rejectionReason: HandTwistTemporalRejectionReason;
}

export interface HandTwistTemporalConfig {
  riseRatePerSecond: number;
  fallRatePerSecond: number;
  maxAngularVelocityRadPerSecond: number;
  minDtSeconds: number;
  maxDtSeconds: number;
  missingHoldSeconds: number;
  resetAfterLostSeconds: number;
  resetInfluenceWeightThreshold: number;
  inactiveInfluenceWeightThreshold: number;
}

export const DEFAULT_HAND_TWIST_TEMPORAL_CONFIG: HandTwistTemporalConfig = {
  riseRatePerSecond: 4,
  fallRatePerSecond: 1.5,
  maxAngularVelocityRadPerSecond: 12,
  minDtSeconds: 1 / 240,
  maxDtSeconds: 0.25,
  missingHoldSeconds: 0.2,
  resetAfterLostSeconds: 2,
  resetInfluenceWeightThreshold: 0.02,
  inactiveInfluenceWeightThreshold: 0.001,
};

function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function moveTowards(current: number, target: number, rate: number, dt: number): number {
  const step = Math.max(0, rate) * dt;
  return current < target ? Math.min(target, current + step) : Math.max(target, current - step);
}

function unchanged(state: HandTwistTemporalState, reason: HandTwistTemporalRejectionReason): HandTwistTemporalResult {
  return {
    state, stabilizedTwistRadians: state.stabilizedTwistRadians, influenceWeight: state.influenceWeight,
    trackingState: state.initialized ? "holding" : "inactive", angleDeltaRadians: 0,
    temporalAdvancedWithoutNewObservation: false, resetOccurred: false, rejectionReason: reason,
  };
}

export function updateHandTwistTemporal(
  state: HandTwistTemporalState,
  input: HandTwistTemporalInput,
  config: HandTwistTemporalConfig = DEFAULT_HAND_TWIST_TEMPORAL_CONFIG,
): HandTwistTemporalResult {
  if (!Number.isFinite(input.dtSeconds) || input.dtSeconds <= 0 || !Number.isFinite(input.missingDurationSeconds) || input.missingDurationSeconds < 0) {
    return unchanged(state, "invalid-dt");
  }
  if (input.observationMode === "valid" && (
    input.targetCorrectionRadians === null || !Number.isFinite(input.targetCorrectionRadians) ||
    input.targetInfluenceWeight === null || !Number.isFinite(input.targetInfluenceWeight)
  )) return unchanged(state, "non-finite-target");

  const dt = clamp(input.dtSeconds, config.minDtSeconds, config.maxDtSeconds);
  let working = state;
  if (input.observationMode === "valid") {
    working = {
      ...state,
      initialized: true,
      acceptedTargetCorrectionRadians: input.targetCorrectionRadians as number,
      acceptedTargetInfluenceWeight: clamp(input.targetInfluenceWeight as number, 0, 1),
      lostDurationSeconds: 0,
    };
  } else if (!state.initialized) {
    return unchanged(state, "no-accepted-target");
  }

  const missingActive = input.missingDurationSeconds > 0;
  const holdActive = missingActive && input.missingDurationSeconds <= config.missingHoldSeconds;
  const desiredInfluence = missingActive && !holdActive ? 0 : working.acceptedTargetInfluenceWeight;
  const maxAngleStep = config.maxAngularVelocityRadPerSecond * dt;
  const angleDelta = clamp(
    working.acceptedTargetCorrectionRadians - working.stabilizedTwistRadians,
    -maxAngleStep,
    maxAngleStep,
  );
  const stabilized = working.stabilizedTwistRadians + angleDelta;
  const influenceRate = desiredInfluence >= working.influenceWeight ? config.riseRatePerSecond : config.fallRatePerSecond;
  const influence = clamp(moveTowards(working.influenceWeight, desiredInfluence, influenceRate, dt), 0, 1);
  const lostDurationSeconds = missingActive ? input.missingDurationSeconds : 0;
  const canReset = missingActive && input.missingDurationSeconds >= config.resetAfterLostSeconds && influence <= config.resetInfluenceWeightThreshold;
  if (canReset) {
    return {
      ...unchanged(INITIAL_HAND_TWIST_TEMPORAL_STATE, "none"),
      resetOccurred: true,
      temporalAdvancedWithoutNewObservation: input.observationMode !== "valid",
    };
  }

  const next: HandTwistTemporalState = { ...working, stabilizedTwistRadians: stabilized, influenceWeight: influence, lostDurationSeconds };
  const trackingState: HandTwistTrackingState = missingActive
    ? holdActive ? "holding" : influence <= config.inactiveInfluenceWeightThreshold ? "inactive" : "fading"
    : input.observationMode === "valid" ? (state.initialized ? "tracking" : "acquiring") : "tracking";
  return {
    state: next,
    stabilizedTwistRadians: stabilized,
    influenceWeight: influence,
    trackingState,
    angleDeltaRadians: angleDelta,
    temporalAdvancedWithoutNewObservation: input.observationMode !== "valid" && (angleDelta !== 0 || influence !== state.influenceWeight),
    resetOccurred: false,
    rejectionReason: "none",
  };
}
