import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { Vector3Data } from "./avatarPoseTypes";

export interface FaceArmSpatialEvidence {
  /** Tâm/radius ellipse trong image-space đã sửa aspect ratio; y vẫn hướng xuống ảnh. */
  centerImageAspect: Vector3Data;
  radiusX: number;
  radiusY: number;
  /** Bên của wrist thật so với tâm mặt; null khi wrist nằm quá gần trục giữa để kết luận. */
  desiredSide: -1 | 1 | null;
  /** Cho phép tiếp xúc khi chính Hand landmark thật đã chạm/chồng vùng mặt. */
  allowContact: boolean;
  /** Khoảng cách ellipse chuẩn hoá nhỏ nhất của các Hand landmark; 1 là đúng biên mặt. */
  observedMinimumEllipseDistance: number;
  quality: number;
}
export interface FaceArmSpatialEvidenceConfig {
  minimumFaceLandmarks: number;
  faceQuantileLow: number;
  faceQuantileHigh: number;
  contactMargin: number;
  minimumSideOffsetRatio: number;
}

export const DEFAULT_FACE_ARM_SPATIAL_EVIDENCE_CONFIG: FaceArmSpatialEvidenceConfig = {
  minimumFaceLandmarks: 8,
  faceQuantileLow: 0.02,
  faceQuantileHigh: 0.98,
  contactMargin: 0.08,
  minimumSideOffsetRatio: 0.2,
};

const finiteLandmark = (point: RawNormalizedLandmarkV1 | undefined): point is RawNormalizedLandmarkV1 => Boolean(
  point && Number.isFinite(point.x) && Number.isFinite(point.y),
);

function quantile(sorted: number[], ratio: number): number {
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * ratio)));
  return sorted[index];
}

function ellipseDistance(point: Vector3Data, center: Vector3Data, radiusX: number, radiusY: number): number {
  return Math.hypot((point.x - center.x) / radiusX, (point.y - center.y) / radiusY);
}

export function buildFaceArmSpatialEvidence(
  faceLandmarks: RawNormalizedLandmarkV1[] | null | undefined,
  handLandmarks: RawNormalizedLandmarkV1[] | null | undefined,
  videoWidth: number,
  videoHeight: number,
  config: FaceArmSpatialEvidenceConfig = DEFAULT_FACE_ARM_SPATIAL_EVIDENCE_CONFIG,
): FaceArmSpatialEvidence | null {
  if (!(Number.isFinite(videoWidth) && Number.isFinite(videoHeight) && videoWidth > 0 && videoHeight > 0)) return null;
  const face = (faceLandmarks ?? []).filter(finiteLandmark);
  const hand = (handLandmarks ?? []).filter(finiteLandmark);
  if (face.length < config.minimumFaceLandmarks || hand.length === 0) return null;
  const aspect = videoHeight / videoWidth;
  const xs = face.map((point) => point.x).sort((a, b) => a - b);
  const ys = face.map((point) => point.y * aspect).sort((a, b) => a - b);
  const minX = quantile(xs, config.faceQuantileLow), maxX = quantile(xs, config.faceQuantileHigh);
  const minY = quantile(ys, config.faceQuantileLow), maxY = quantile(ys, config.faceQuantileHigh);
  const radiusX = (maxX - minX) * 0.5, radiusY = (maxY - minY) * 0.5;
  if (![radiusX, radiusY].every(Number.isFinite) || radiusX <= 1e-5 || radiusY <= 1e-5) return null;
  const centerImageAspect = { x: (minX + maxX) * 0.5, y: (minY + maxY) * 0.5, z: 0 };
  const handPoints = hand.map((point) => ({ x: point.x, y: point.y * aspect, z: 0 }));
  const observedMinimumEllipseDistance = Math.min(...handPoints.map((point) => ellipseDistance(point, centerImageAspect, radiusX, radiusY)));
  const wrist = handPoints[0];
  const sideOffset = (wrist.x - centerImageAspect.x) / radiusX;
  const desiredSide = Math.abs(sideOffset) >= config.minimumSideOffsetRatio ? (sideOffset < 0 ? -1 : 1) : null;
  return {
    centerImageAspect,
    radiusX,
    radiusY,
    desiredSide,
    allowContact: observedMinimumEllipseDistance <= 1 + config.contactMargin,
    observedMinimumEllipseDistance,
    quality: Math.max(0, Math.min(1, face.length / 100)),
  };
}
