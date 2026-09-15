import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";

// MediaPipe Face Mesh canonical lip indices: inner upper/lower and left/right mouth corners.
const INNER_UPPER_LIP = 13;
const INNER_LOWER_LIP = 14;
const LEFT_MOUTH_CORNER = 61;
const RIGHT_MOUTH_CORNER = 291;

export interface MouthLandmarkApertureRange { onset: number; full: number }

export interface MouthLandmarkGeometryEvidence {
  valid: boolean;
  apertureRatio: number;
  jawOpen: number;
  mouthWidthPixels: number;
  innerGapPixels: number;
}

const invalid = (): MouthLandmarkGeometryEvidence => ({
  valid: false, apertureRatio: 0, jawOpen: 0, mouthWidthPixels: 0, innerGapPixels: 0,
});
const finitePoint = (point: RawNormalizedLandmarkV1 | undefined): point is RawNormalizedLandmarkV1 =>
  Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const smoothstep = (value: number, range: MouthLandmarkApertureRange): number => {
  const t = clamp01((value - range.onset) / (range.full - range.onset));
  return t * t * (3 - 2 * t);
};

/**
 * Đo khe môi theo pháp tuyến của trục hai khóe, nên quay đầu/roll không biến chuyển động ngang thành mở miệng.
 * Chuẩn hóa bằng bề rộng miệng để không phụ thuộc khoảng cách camera hay độ phân giải video.
 */
export function computeMouthLandmarkGeometry(
  landmarks: readonly RawNormalizedLandmarkV1[] | null | undefined,
  videoWidth: number | null | undefined,
  videoHeight: number | null | undefined,
  apertureRange: MouthLandmarkApertureRange,
): MouthLandmarkGeometryEvidence {
  if (!landmarks || landmarks.length <= RIGHT_MOUTH_CORNER) return invalid();
  if (!Number.isFinite(apertureRange.onset) || !Number.isFinite(apertureRange.full) || apertureRange.onset < 0 || apertureRange.full <= apertureRange.onset) return invalid();
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
  const apertureRatio = innerGapPixels / mouthWidthPixels;
  if (!Number.isFinite(apertureRatio)) return invalid();
  return {
    valid: true,
    apertureRatio,
    jawOpen: smoothstep(apertureRatio, apertureRange),
    mouthWidthPixels,
    innerGapPixels,
  };
}
