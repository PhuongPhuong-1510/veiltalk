export interface OneEuroParameters { minCutoff: number; beta: number; derivativeCutoff: number }

export interface AvatarMotionConfig {
  freshnessMs: { face: number; hand: number; pose: number };
  loss: { holdMs: number; returnMs: number; recoveryMs: number; filterResetMs: number };
  filter: {
    expressions: OneEuroParameters;
    head: OneEuroParameters;
    arms: OneEuroParameters;
    wrist: OneEuroParameters;
    maxTimestampGapMs: number;
  };
}

export const DEFAULT_AVATAR_MOTION_CONFIG: AvatarMotionConfig = {
  freshnessMs: { face: 100, hand: 150, pose: 150 },
  loss: { holdMs: 250, returnMs: 500, recoveryMs: 180, filterResetMs: 750 },
  filter: {
    expressions: { minCutoff: 1.2, beta: 0.03, derivativeCutoff: 1 },
    head: { minCutoff: 1.1, beta: 0.12, derivativeCutoff: 1 },
    arms: { minCutoff: 1, beta: 0.2, derivativeCutoff: 1 },
    wrist: { minCutoff: 1.4, beta: 0.25, derivativeCutoff: 1 },
    maxTimestampGapMs: 1_000,
  },
};
