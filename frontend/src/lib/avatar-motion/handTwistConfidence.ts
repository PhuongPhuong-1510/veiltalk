/**
 * Mức 2B — Việc 3: combine independent quality signals into one trusted twist decision.
 * Pure/stateless: no quaternion, unwrap, temporal smoothing, or renderer ownership here.
 */

export type HandTwistConfidenceRejectionReason =
  | "non-finite"
  | "hand-not-fresh"
  | "timestamp-delta-too-large"
  | "projection-degenerate"
  | "below-hysteresis-threshold";

export interface HandTwistConfidenceConfig {
  maxHandAgeMs: number;
  maxPoseHandDeltaMs: number;
  enterThreshold: number;
  exitThreshold: number;
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
  softWeights: { matchQuality: 0.45, palmGeometryQuality: 0.45, handednessQuality: 0.1 },
};

export interface HandTwistConfidenceInput {
  handMatched: boolean;
  twistAccepted: boolean;
  matchQuality: number;
  palmGeometryQuality: number;
  palmProjectionRatio: number | null;
  referenceProjectionRatio: number | null;
  handAgeMs: number | null;
  poseHandTimestampDeltaMs: number | null;
  /** Legacy raw detector score. Kept for compatibility. */
  handednessScore: number | null;
  /** Side-compatibility quality, not raw detector certainty. Prefer this when caller knows assigned side. */
  handednessCompatibilityQuality?: number | null;
  /** Geometry quality from an alternative accepted solver, e.g. absolute rig palm alignment. */
  projectionQualityOverride?: number | null;
  previousTrusted: boolean;
}

export interface HandTwistConfidenceResult {
  trusted: boolean;
  overallQuality: number;
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

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const finiteOrNull = (value: number | null | undefined): boolean => value === undefined || value === null || Number.isFinite(value);

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
    finiteOrNull(input.palmProjectionRatio) &&
    finiteOrNull(input.referenceProjectionRatio) &&
    finiteOrNull(input.handAgeMs) &&
    finiteOrNull(input.poseHandTimestampDeltaMs) &&
    finiteOrNull(input.handednessScore) &&
    finiteOrNull(input.handednessCompatibilityQuality) &&
    finiteOrNull(input.projectionQualityOverride);

  if (!numericInputsValid) {
    return { trusted: false, overallQuality: 0, targetInfluenceWeight: 0, rejectionReason: "non-finite", components: zeroComponents() };
  }
  if (!input.handMatched || !input.twistAccepted) {
    const reason: HandTwistConfidenceRejectionReason = !input.handMatched ? "below-hysteresis-threshold" : "projection-degenerate";
    return { trusted: false, overallQuality: 0, targetInfluenceWeight: 0, rejectionReason: reason, components: zeroComponents() };
  }

  const matchQuality = clamp01(input.matchQuality);
  const palmGeometryQuality = clamp01(input.palmGeometryQuality);

  // IMPORTANT: MediaPipe handednessScore measures certainty of the emitted label. It is NOT side
  // compatibility. When the matcher intentionally assigns a candidate to the opposite side, a raw
  // 0.99 mismatch must not become a +0.99 confidence boost. Caller may provide compatibility.
  const handednessInput = input.handednessCompatibilityQuality !== undefined
    ? input.handednessCompatibilityQuality
    : input.handednessScore;
  const handednessAvailable = handednessInput !== null && handednessInput !== undefined;
  const handednessQuality = handednessAvailable ? clamp01(handednessInput as number) : 0;

  const weights = config.softWeights;
  const activeWeightSum = weights.matchQuality + weights.palmGeometryQuality + (handednessAvailable ? weights.handednessQuality : 0);
  const softQuality = activeWeightSum > 0
    ? clamp01((
        matchQuality * weights.matchQuality +
        palmGeometryQuality * weights.palmGeometryQuality +
        (handednessAvailable ? handednessQuality * weights.handednessQuality : 0)
      ) / activeWeightSum)
    : 0;

  const defaultProjection = clamp01(Math.min(input.palmProjectionRatio ?? 0, input.referenceProjectionRatio ?? 0));
  const projectionQuality = input.projectionQualityOverride !== null && input.projectionQualityOverride !== undefined
    ? clamp01(input.projectionQualityOverride)
    : defaultProjection;
  const freshnessQuality = linearAgeQuality(input.handAgeMs, config.maxHandAgeMs);
  const timestampQuality = linearAgeQuality(input.poseHandTimestampDeltaMs, config.maxPoseHandDeltaMs);
  const observabilityQuality = clamp01(projectionQuality * freshnessQuality * timestampQuality);
  const overallQuality = clamp01(softQuality * observabilityQuality);

  const components = {
    matchQuality,
    palmGeometryQuality,
    handednessQuality: handednessAvailable ? handednessQuality : 0,
    projectionQuality,
    freshnessQuality,
    timestampQuality,
    softQuality,
    observabilityQuality,
  };

  const trusted = input.previousTrusted ? overallQuality >= config.exitThreshold : overallQuality >= config.enterThreshold;
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
