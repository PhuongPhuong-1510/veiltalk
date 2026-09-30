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
  /** Selected camera-depth hemisphere. Kept across occlusion frames to prevent branch chatter. */
  depthSign: -1 | 1 | null;
  reachViolation: number;
  /** Image-space point consistent with the reconstructed world x/y after reach clamping. */
  projectedImage: Vector3Data | null;
  depthAmbiguity: number;
  rejectionReason: WristReconstructionRejectionReason | null;
}

const finiteLandmark = (point: RawNormalizedLandmarkV1 | null | undefined): point is RawNormalizedLandmarkV1 => Boolean(
  point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z),
);
const semanticWorld = (point: RawNormalizedLandmarkV1): Vector3 => new Vector3(point.x, -point.y, -point.z);
const rejected = (reason: WristReconstructionRejectionReason): WristReconstructionResult => ({
  accepted: false, point: null, confidence: 0, imageToWorldScale: null,
  planarDistance: null, depthDelta: null, depthSign: null, reachViolation: 0, projectedImage: null,
  depthAmbiguity: 1, rejectionReason: reason,
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
  preferredDepthSign?: -1 | 1 | null;
  depthSwitchHysteresisRatio?: number;
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
  // Shoulder-derived scale and calibrated bone length are accumulated through different floating
  // point paths. At the exact reach boundary they can differ by a few ulps; treating that as a hard
  // outlier makes a perfectly matching Hand wrist disappear for one frame. Keep the configured
  // slack semantic, but include a scale-aware numerical tolerance at its boundary.
  const reachEpsilon = Math.max(1e-6, input.targetDistance * 1e-5);
  if (violation > slack + reachEpsilon) return { ...rejected("outside-reach-slack"), imageToWorldScale: input.imageToWorldScale, planarDistance: rawPlanarDistance, reachViolation: violation };
  if (rawPlanarDistance > input.targetDistance) {
    const clamp = input.targetDistance / rawPlanarDistance;
    dx *= clamp; dy *= clamp;
  }
  const planarDistance = Math.hypot(dx, dy);
  const depthMagnitude = Math.sqrt(Math.max(0, input.targetDistance * input.targetDistance - planarDistance * planarDistance));
  const priorTarget = anchor.clone().add(previous.clone().normalize().multiplyScalar(input.targetDistance));
  const positive = anchor.clone().add(new Vector3(dx, dy, depthMagnitude));
  const negative = anchor.clone().add(new Vector3(dx, dy, -depthMagnitude));
  const positiveError = positive.distanceTo(priorTarget), negativeError = negative.distanceTo(priorTarget);
  let depthSign: -1 | 1 = positiveError <= negativeError ? 1 : -1;
  if (input.preferredDepthSign) {
    const preferredError = input.preferredDepthSign === 1 ? positiveError : negativeError;
    const alternateError = input.preferredDepthSign === 1 ? negativeError : positiveError;
    const switchMargin = input.targetDistance * Math.max(0, input.depthSwitchHysteresisRatio ?? 0.08);
    // Keep the previous depth hemisphere through small monocular jitter. Switch only when the
    // alternate branch is materially closer to motion history, not merely microscopically closer.
    depthSign = alternateError + switchMargin < preferredError ? (input.preferredDepthSign === 1 ? -1 : 1) : input.preferredDepthSign;
  }
  const chosen = depthSign === 1 ? positive : negative;
  const effectiveViolation = violation <= reachEpsilon ? 0 : violation;
  const confidence = Math.max(0, Math.min(1, 1 - effectiveViolation / Math.max(1e-6, slack)));
  const aspect = input.videoWidth / input.videoHeight;
  const projectedImage = {
    x: input.anchorImage.x + dx / input.imageToWorldScale,
    y: input.anchorImage.y - (dy / input.imageToWorldScale) * aspect,
    z: input.targetImage.z,
  };
  // 1 means the two depth signs are maximally ambiguous (near the image plane).
  const depthAmbiguity = 1 - Math.min(1, depthMagnitude / input.targetDistance);
  return {
    accepted: true,
    point: { x: chosen.x, y: chosen.y, z: chosen.z },
    confidence,
    imageToWorldScale: input.imageToWorldScale,
    planarDistance,
    depthDelta: chosen.z - anchor.z,
    depthSign,
    reachViolation: violation,
    projectedImage,
    depthAmbiguity,
    rejectionReason: null,
  };
}
