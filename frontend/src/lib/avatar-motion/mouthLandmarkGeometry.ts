import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";

// MediaPipe Face Mesh canonical indices used by the mouth observer.
const INNER_UPPER_LIP = 13;
const INNER_LOWER_LIP = 14;
const LEFT_MOUTH_CORNER = 61;
const RIGHT_MOUTH_CORNER = 291;
const LEFT_EYE_OUTER = 33;
const RIGHT_EYE_OUTER = 263;

export interface MouthLandmarkApertureRange { onset: number; full: number }

export interface MouthLandmarkGeometryEvidence {
  valid: boolean;
  apertureRatio: number;
  jawOpen: number;
  mouthWidthPixels: number;
  innerGapPixels: number;
  /** Stable facial scale used for aperture normalization. */
  referenceScalePixels: number;
  /** Mouth width normalized independently from jaw opening. */
  mouthWidthRatio: number;
}

const invalid = (): MouthLandmarkGeometryEvidence => ({
  valid: false,
  apertureRatio: 0,
  jawOpen: 0,
  mouthWidthPixels: 0,
  innerGapPixels: 0,
  referenceScalePixels: 0,
  mouthWidthRatio: 0,
});

const finitePoint = (point: RawNormalizedLandmarkV1 | undefined): point is RawNormalizedLandmarkV1 =>
  Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const smoothstep = (value: number, range: MouthLandmarkApertureRange): number => {
  const t = clamp01((value - range.onset) / (range.full - range.onset));
  return t * t * (3 - 2 * t);
};

const pixelDistance = (
  a: RawNormalizedLandmarkV1,
  b: RawNormalizedLandmarkV1,
  width: number,
  height: number,
): number => Math.hypot((b.x - a.x) * width, (b.y - a.y) * height);

/**
 * Measures inner-lip aperture along the normal of the mouth-corner axis so head roll does not
 * turn horizontal mouth motion into jaw opening.
 *
 * Important: aperture is normalized by a facial reference (outer-eye distance), NOT by the
 * current mouth width. The old current-width denominator made smiling look like jaw closure and
 * puckering look like extra jaw opening because the denominator itself changed with the gesture.
 */
export function computeMouthLandmarkGeometry(
  landmarks: readonly RawNormalizedLandmarkV1[] | null | undefined,
  videoWidth: number | null | undefined,
  videoHeight: number | null | undefined,
  apertureRange: MouthLandmarkApertureRange,
): MouthLandmarkGeometryEvidence {
  if (!landmarks || landmarks.length <= RIGHT_MOUTH_CORNER) return invalid();
  if (!Number.isFinite(apertureRange.onset) || !Number.isFinite(apertureRange.full)
    || apertureRange.onset < 0 || apertureRange.full <= apertureRange.onset) return invalid();

  const upper = landmarks[INNER_UPPER_LIP];
  const lower = landmarks[INNER_LOWER_LIP];
  const left = landmarks[LEFT_MOUTH_CORNER];
  const right = landmarks[RIGHT_MOUTH_CORNER];
  if (![upper, lower, left, right].every(finitePoint)) return invalid();

  const widthPixels = Number.isFinite(videoWidth) && videoWidth! > 0 ? videoWidth! : 1;
  const heightPixels = Number.isFinite(videoHeight) && videoHeight! > 0 ? videoHeight! : 1;

  const cornerX = (right.x - left.x) * widthPixels;
  const cornerY = (right.y - left.y) * heightPixels;
  const mouthWidthPixels = Math.hypot(cornerX, cornerY);
  if (!Number.isFinite(mouthWidthPixels) || mouthWidthPixels <= 1e-4) return invalid();

  const normalX = -cornerY / mouthWidthPixels;
  const normalY = cornerX / mouthWidthPixels;
  const lipX = (lower.x - upper.x) * widthPixels;
  const lipY = (lower.y - upper.y) * heightPixels;
  const innerGapPixels = Math.abs(lipX * normalX + lipY * normalY);

  const eyeLeft = landmarks[LEFT_EYE_OUTER];
  const eyeRight = landmarks[RIGHT_EYE_OUTER];
  const eyeDistancePixels = finitePoint(eyeLeft) && finitePoint(eyeRight)
    ? pixelDistance(eyeLeft, eyeRight, widthPixels, heightPixels)
    : 0;

  // Eye distance is much less expression-dependent than current mouth width. Fallback keeps older
  // models/partial landmark payloads working rather than invalidating the whole mouth sample.
  const referenceScalePixels = Number.isFinite(eyeDistancePixels) && eyeDistancePixels > 1e-4
    ? eyeDistancePixels
    : mouthWidthPixels;
  const apertureRatio = innerGapPixels / referenceScalePixels;
  const mouthWidthRatio = mouthWidthPixels / referenceScalePixels;
  if (![apertureRatio, mouthWidthRatio].every(Number.isFinite)) return invalid();

  return {
    valid: true,
    apertureRatio,
    jawOpen: smoothstep(apertureRatio, apertureRange),
    mouthWidthPixels,
    innerGapPixels,
    referenceScalePixels,
    mouthWidthRatio,
  };
}
