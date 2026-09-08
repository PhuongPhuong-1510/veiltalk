import { Vector3 } from "three";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { Vector3Data } from "./avatarPoseTypes";

export type WristReconstructionRejectionReason =
  | "non-finite"
  | "invalid-video-size"
  | "invalid-scale"
  | "invalid-length"
  | "missing-depth-prior"
  | "outside-reach-slack";

export interface WristReconstructionResult {
  accepted: boolean;
  point: Vector3Data | null;
  confidence: number;
  imageToWorldScale: number | null;
  planarDistance: number | null;
  depthDelta: number | null;
  reachViolation: number;
  rejectionReason: WristReconstructionRejectionReason | null;
}

const finiteLandmark = (point: RawNormalizedLandmarkV1 | null | undefined): point is RawNormalizedLandmarkV1 => Boolean(
  point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z),
);
const semanticWorld = (point: RawNormalizedLandmarkV1): Vector3 => new Vector3(point.x, -point.y, -point.z);
const rejected = (reason: WristReconstructionRejectionReason): WristReconstructionResult => ({
  accepted: false, point: null, confidence: 0, imageToWorldScale: null,
  planarDistance: null, depthDelta: null, reachViolation: 0, rejectionReason: reason,
});

function aspectCorrectedDelta(
  from: RawNormalizedLandmarkV1,
  to: RawNormalizedLandmarkV1,
  videoWidth: number,
  videoHeight: number,
): { x: number; y: number } | null {
  if (!(videoWidth > 0) || !(videoHeight > 0)) return null;
  const aspect = videoWidth / videoHeight;
  const x = to.x - from.x;
  // Image Y đi xuống; motion/world semantic Y đi lên. Chia aspect để x/y cùng đơn vị
  // theo chiều rộng thật của khung hình.
  const y = -(to.y - from.y) / aspect;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/**
 * Scale orthographic cục bộ từ image-space sang Pose world-space, lấy trên hai vai của cùng
 * frame. Không tuyên bố đây là camera calibration theo mét; chỉ là tỉ lệ cục bộ đủ để dựng
 * wrist candidate rồi bắt buộc chiếu lại lên sphere chiều dài xương.
 */
export function estimateShoulderImageToWorldScale(input: {
  leftShoulderWorld: RawNormalizedLandmarkV1 | null | undefined;
  rightShoulderWorld: RawNormalizedLandmarkV1 | null | undefined;
  leftShoulderImage: RawNormalizedLandmarkV1 | null | undefined;
  rightShoulderImage: RawNormalizedLandmarkV1 | null | undefined;
  videoWidth: number;
  videoHeight: number;
}): number | null {
  const { leftShoulderWorld, rightShoulderWorld, leftShoulderImage, rightShoulderImage } = input;
  if (![leftShoulderWorld, rightShoulderWorld, leftShoulderImage, rightShoulderImage].every(finiteLandmark)) return null;
  const imageDelta = aspectCorrectedDelta(leftShoulderImage!, rightShoulderImage!, input.videoWidth, input.videoHeight);
  if (!imageDelta) return null;
  const imageDistance = Math.hypot(imageDelta.x, imageDelta.y);
  const worldDistance = semanticWorld(rightShoulderWorld!).distanceTo(semanticWorld(leftShoulderWorld!));
  if (!Number.isFinite(imageDistance) || !Number.isFinite(worldDistance) || imageDistance <= 1e-6 || worldDistance <= 1e-6) return null;
  const scale = worldDistance / imageDistance;
  return Number.isFinite(scale) && scale > 0 ? scale : null;
}

/**
 * Nâng một điểm ảnh lên sphere 3D: target phải nằm trên camera-aligned x/y của Hand wrist và
 * cách anchor đúng `targetDistance`. Hai dấu depth là hai nghiệm; depth prior chọn nghiệm gần
 * chuyển động trước nhất. Không có prior thì từ chối vì webcam đơn không phân biệt hai nghiệm.
 */
export function reconstructPointOnSphereFromImage(input: {
  anchorWorld: Vector3Data;
  anchorImage: RawNormalizedLandmarkV1;
  targetImage: RawNormalizedLandmarkV1;
  targetDistance: number;
  imageToWorldScale: number;
  previousDirection: Vector3Data | null;
  videoWidth: number;
  videoHeight: number;
  reachSlackRatio: number;
}): WristReconstructionResult {
  const anchor = new Vector3(input.anchorWorld.x, input.anchorWorld.y, input.anchorWorld.z);
  const previous = input.previousDirection && new Vector3(input.previousDirection.x, input.previousDirection.y, input.previousDirection.z);
  if (![anchor.x, anchor.y, anchor.z].every(Number.isFinite) || !finiteLandmark(input.anchorImage) || !finiteLandmark(input.targetImage)) return rejected("non-finite");
  if (!(input.videoWidth > 0) || !(input.videoHeight > 0)) return rejected("invalid-video-size");
  if (!Number.isFinite(input.imageToWorldScale) || input.imageToWorldScale <= 0) return rejected("invalid-scale");
  if (!Number.isFinite(input.targetDistance) || input.targetDistance <= 1e-6) return rejected("invalid-length");
  if (!previous || ![previous.x, previous.y, previous.z].every(Number.isFinite) || previous.lengthSq() <= 1e-8) return rejected("missing-depth-prior");

  const imageDelta = aspectCorrectedDelta(input.anchorImage, input.targetImage, input.videoWidth, input.videoHeight);
  if (!imageDelta) return rejected("invalid-video-size");
  let dx = imageDelta.x * input.imageToWorldScale;
  let dy = imageDelta.y * input.imageToWorldScale;
  const rawPlanarDistance = Math.hypot(dx, dy);
  const slack = input.targetDistance * Math.max(0, input.reachSlackRatio);
  const violation = Math.max(0, rawPlanarDistance - input.targetDistance);
  if (violation > slack) return { ...rejected("outside-reach-slack"), imageToWorldScale: input.imageToWorldScale, planarDistance: rawPlanarDistance, reachViolation: violation };
  if (rawPlanarDistance > input.targetDistance) {
    const clamp = input.targetDistance / rawPlanarDistance;
    dx *= clamp; dy *= clamp;
  }
  const planarDistance = Math.hypot(dx, dy);
  const depthMagnitude = Math.sqrt(Math.max(0, input.targetDistance * input.targetDistance - planarDistance * planarDistance));
  const priorTarget = anchor.clone().add(previous.clone().normalize().multiplyScalar(input.targetDistance));
  const positive = anchor.clone().add(new Vector3(dx, dy, depthMagnitude));
  const negative = anchor.clone().add(new Vector3(dx, dy, -depthMagnitude));
  const chosen = positive.distanceToSquared(priorTarget) <= negative.distanceToSquared(priorTarget) ? positive : negative;
  const confidence = Math.max(0, Math.min(1, 1 - violation / Math.max(1e-6, slack)));
  return {
    accepted: true,
    point: { x: chosen.x, y: chosen.y, z: chosen.z },
    confidence,
    imageToWorldScale: input.imageToWorldScale,
    planarDistance,
    depthDelta: chosen.z - anchor.z,
    reachViolation: violation,
    rejectionReason: null,
  };
}
