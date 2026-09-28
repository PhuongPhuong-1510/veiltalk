import type { BimanualHandFeatures } from "./bimanualHandFeatures";

export interface BimanualGestureEvidence {
  heart: number;
  palmsTogether: number;
  clasp: number;
  interlace: number;
}

export const EMPTY_BIMANUAL_GESTURE_EVIDENCE: BimanualGestureEvidence = {
  heart: 0,
  palmsTogether: 0,
  clasp: 0,
  interlace: 0,
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smoothstep01 = (value: number): number => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const near = (distance: number, full: number, zero: number): number =>
  1 - smoothstep01((distance - full) / Math.max(1e-6, zero - full));
const inRange = (value: number, low: number, high: number, feather: number): number =>
  Math.min(
    smoothstep01((value - (low - feather)) / Math.max(1e-6, feather)),
    1 - smoothstep01((value - high) / Math.max(1e-6, feather)),
  );

/**
 * Semantic evidence only. No score in this module is allowed to directly create a pose.
 * It tells temporal/corrective layers when observed two-hand geometry is intentional/stable.
 */
export function computeBimanualGestureEvidence(features: BimanualHandFeatures | null): BimanualGestureEvidence {
  if (!features?.valid) return EMPTY_BIMANUAL_GESTURE_EVIDENCE;

  const wristsHeartRange = inRange(features.wristDistance, 0.8, 4.2, 0.8);
  const heart = Math.min(
    features.thumbThumb.proximity,
    features.indexIndex.proximity,
    features.palmsSameDirection,
    features.palmForwardAlignment,
    features.heartVerticalOrder,
    wristsHeartRange,
  );

  const palmNear = near(features.palmCenterDistance, 0.12, 0.72);
  const wristNear = near(features.wristDistance, 0.35, 1.9);
  const palmsTogether = Math.min(
    palmNear,
    wristNear,
    features.palmsFacing,
    features.palmForwardAlignment,
  );

  const tipCluster = near(features.tipCentroidDistance, 0.18, 1.15);
  const crossTipSupport = clamp01(features.regularTipContactCount / 5);
  const clasp = Math.min(
    near(features.palmCenterDistance, 0.18, 1.05),
    Math.max(features.palmsFacing * 0.75, features.palmsSameDirection * 0.65),
    Math.max(tipCluster, crossTipSupport),
  );

  // Interlace is topology-first: several opposite-hand finger segments must actually cross in
  // image space while palms are close. This is intentionally stricter than generic clasp.
  const interlace = Math.min(
    near(features.palmCenterDistance, 0.18, 1.1),
    features.regularSegmentIntersectionScore,
    Math.max(0.35, features.palmsFacing),
    near(features.nearestRegularTipDistance, 0.10, 0.62),
  );

  return {
    heart: clamp01(heart),
    palmsTogether: clamp01(palmsTogether),
    clasp: clamp01(clasp),
    interlace: clamp01(interlace),
  };
}
