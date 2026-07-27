export interface OneEuroParameters { minCutoff: number; beta: number; derivativeCutoff: number }

export interface AvatarMotionConfig {
  freshnessMs: { face: number; hand: number; pose: number };
  loss: { holdMs: number; returnMs: number; recoveryMs: number; filterResetMs: number };
  filter: {
    expressions: OneEuroParameters;
    head: OneEuroParameters;
    arms: OneEuroParameters;
    wrist: OneEuroParameters;
    pole: OneEuroParameters;
    maxTimestampGapMs: number;
  };
  /** Ngưỡng Phase 3A ban đầu; calibration production thuộc Phase 3C. */
  armFrame: {
    minimumPoseVisibility: number;
    minimumSegmentLength: number;
    minimumSegmentRatio: number;
    maximumSegmentRatio: number;
    shoulderOuterBoundsMargin: number;
    elbowOuterBoundsMargin: number;
    wristOuterBoundsMargin: number;
    edgeWarningMargin: number;
    elbowOffsetEnterMagnitude: number;
    elbowOffsetExitMagnitude: number;
    minimumNormalizedElbowOffset: number;
    depthDegenerateEnterAlignment: number;
    depthDegenerateExitAlignment: number;
    maximumPoleAngularVelocityRadiansPerSecond: number;
    invalidGraceMs: number;
    validRecoveryConfirmMs: number;
    poleFallbackTimeoutMs: number;
    longGapDiscontinuityMs: number;
    calibrationMinimumSamples: number;
    calibrationWindowSamples: number;
    elbowInferenceTimeoutMs: number;
    elbowInferenceReachSlackRatio: number;
  };
}

/** Các duration là giá trị hiệu chỉnh ban đầu, chưa phải ngưỡng chính thức của SRS. */
export const DEFAULT_AVATAR_MOTION_CONFIG: AvatarMotionConfig = {
  freshnessMs: { face: 100, hand: 150, pose: 150 },
  loss: { holdMs: 250, returnMs: 500, recoveryMs: 180, filterResetMs: 750 },
  filter: {
    expressions: { minCutoff: 1.2, beta: 0.03, derivativeCutoff: 1 },
    head: { minCutoff: 1.1, beta: 0.12, derivativeCutoff: 1 },
    arms: { minCutoff: 1, beta: 0.2, derivativeCutoff: 1 },
    wrist: { minCutoff: 1.4, beta: 0.25, derivativeCutoff: 1 },
    pole: { minCutoff: 0.8, beta: 0.12, derivativeCutoff: 1 },
    maxTimestampGapMs: 1_000,
  },
  armFrame: {
    minimumPoseVisibility: 0.5,
    minimumSegmentLength: 0.02,
    minimumSegmentRatio: 0.35,
    maximumSegmentRatio: 2.85,
    shoulderOuterBoundsMargin: 0.2,
    elbowOuterBoundsMargin: 0.08,
    wristOuterBoundsMargin: 0.04,
    edgeWarningMargin: 0.04,
    elbowOffsetEnterMagnitude: 0.015,
    elbowOffsetExitMagnitude: 0.03,
    minimumNormalizedElbowOffset: 0.025,
    depthDegenerateEnterAlignment: 0.9,
    depthDegenerateExitAlignment: 0.82,
    maximumPoleAngularVelocityRadiansPerSecond: 7,
    invalidGraceMs: 80,
    validRecoveryConfirmMs: 80,
    poleFallbackTimeoutMs: 500,
    longGapDiscontinuityMs: 1_000,
    calibrationMinimumSamples: 3,
    calibrationWindowSamples: 30,
    elbowInferenceTimeoutMs: 1_200,
    elbowInferenceReachSlackRatio: 0.12,
  },
};
