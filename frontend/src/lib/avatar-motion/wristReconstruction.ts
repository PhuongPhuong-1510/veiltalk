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
  /** Image-space point consistent with the reconstructed world x/y after reach clamping. */
  projectedImage: Vector3Data | null;
  /** Geometric reach feasibility only; this is not a claim that the selected Z branch is correct. */
  feasibilityConfidence: number;
  /** Distance between the two valid Z branches in Pose-world units. */
  branchSeparation: number;
  /** 0 when the branch is well distinguished, 1 when temporal evidence cannot distinguish it. */
  depthAmbiguity: number;
  selectedBranch: -1 | 1 | null;
  candidates: WristDepthCandidate[];
  rejectionReason: WristReconstructionRejectionReason | null;
}

export interface WristDepthCandidate {
  point: Vector3Data;
  branch: -1 | 1;
  depthDelta: number;
  direction: Vector3Data;
  targetDistance: number;
}

export interface WristDepthCandidateSet {
  accepted: boolean;
  candidates: WristDepthCandidate[];
  feasibilityConfidence: number;
  imageToWorldScale: number | null;
  planarDistance: number | null;
  rawPlanarDistance: number | null;
  reachViolation: number;
  projectedImage: Vector3Data | null;
  branchSeparation: number;
  rejectionReason: WristReconstructionRejectionReason | null;
}

const finiteLandmark = (point: RawNormalizedLandmarkV1 | null | undefined): point is RawNormalizedLandmarkV1 => Boolean(
  point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z),
);
const semanticWorld = (point: RawNormalizedLandmarkV1): Vector3 => new Vector3(point.x, -point.y, -point.z);
const rejected = (reason: WristReconstructionRejectionReason): WristReconstructionResult => ({
  accepted: false, point: null, confidence: 0, imageToWorldScale: null,
  planarDistance: null, depthDelta: null, reachViolation: 0, projectedImage: null,
  feasibilityConfidence: 0, branchSeparation: 0, depthAmbiguity: 1,
  selectedBranch: null, candidates: [], rejectionReason: reason,
});

const rejectedCandidates = (reason: WristReconstructionRejectionReason): WristDepthCandidateSet => ({
  accepted: false, candidates: [], feasibilityConfidence: 0, imageToWorldScale: null,
  planarDistance: null, rawPlanarDistance: null, reachViolation: 0, projectedImage: null, branchSeparation: 0,
  rejectionReason: reason,
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
  // Compare like with like: image distance is a camera-plane measurement, so shoulder Z must not
  // inflate the numerator during torso yaw. This remains a local weak-perspective scale, but avoids
  // the worst yaw pathology of full-3D-distance / projected-2D-distance.
  const leftWorld = semanticWorld(leftShoulderWorld!), rightWorld = semanticWorld(rightShoulderWorld!);
  const worldDistance = Math.hypot(rightWorld.x - leftWorld.x, rightWorld.y - leftWorld.y);
  if (!Number.isFinite(imageDistance) || !Number.isFinite(worldDistance) || imageDistance <= 1e-6 || worldDistance <= 1e-6) return null;
  const scale = worldDistance / imageDistance;
  return Number.isFinite(scale) && scale > 0 ? scale : null;
}

/**
 * Nâng một điểm ảnh lên sphere 3D: target phải nằm trên camera-aligned x/y của Hand wrist và
 * cách anchor đúng `targetDistance`. Hai dấu depth là hai nghiệm; depth prior chọn nghiệm gần
 * chuyển động trước nhất. Không có prior thì từ chối vì webcam đơn không phân biệt hai nghiệm.
 */
export function generateWristDepthCandidates(input: {
  anchorWorld: Vector3Data;
  anchorImage: RawNormalizedLandmarkV1;
  targetImage: RawNormalizedLandmarkV1;
  targetDistance: number;
  imageToWorldScale: number;
  videoWidth: number;
  videoHeight: number;
  reachSlackRatio: number;
}): WristDepthCandidateSet {
  const anchor = new Vector3(input.anchorWorld.x, input.anchorWorld.y, input.anchorWorld.z);
  if (![anchor.x, anchor.y, anchor.z].every(Number.isFinite) || !finiteLandmark(input.anchorImage) || !finiteLandmark(input.targetImage)) return rejectedCandidates("non-finite");
  if (!(input.videoWidth > 0) || !(input.videoHeight > 0)) return rejectedCandidates("invalid-video-size");
  if (!Number.isFinite(input.imageToWorldScale) || input.imageToWorldScale <= 0) return rejectedCandidates("invalid-scale");
  if (!Number.isFinite(input.targetDistance) || input.targetDistance <= 1e-6) return rejectedCandidates("invalid-length");

  const imageDelta = aspectCorrectedDelta(input.anchorImage, input.targetImage, input.videoWidth, input.videoHeight);
  if (!imageDelta) return rejectedCandidates("invalid-video-size");
  let dx = imageDelta.x * input.imageToWorldScale;
  let dy = imageDelta.y * input.imageToWorldScale;
  const rawPlanarDistance = Math.hypot(dx, dy);
  const slack = input.targetDistance * Math.max(0, input.reachSlackRatio);
  const violation = Math.max(0, rawPlanarDistance - input.targetDistance);
  if (violation > slack) return { ...rejectedCandidates("outside-reach-slack"), imageToWorldScale: input.imageToWorldScale, planarDistance: rawPlanarDistance, rawPlanarDistance, reachViolation: violation };
  if (rawPlanarDistance > input.targetDistance) {
    const clamp = input.targetDistance / rawPlanarDistance;
    dx *= clamp; dy *= clamp;
  }
  const planarDistance = Math.hypot(dx, dy);
  const depthMagnitude = Math.sqrt(Math.max(0, input.targetDistance * input.targetDistance - planarDistance * planarDistance));
  const positive = anchor.clone().add(new Vector3(dx, dy, depthMagnitude));
  const negative = anchor.clone().add(new Vector3(dx, dy, -depthMagnitude));
  const positiveDirection = positive.clone().sub(anchor).normalize();
  const negativeDirection = negative.clone().sub(anchor).normalize();
  const feasibilityConfidence = slack <= 1e-8 ? (violation <= 1e-8 ? 1 : 0) : Math.max(0, Math.min(1, 1 - violation / slack));
  const aspect = input.videoWidth / input.videoHeight;
  const projectedImage = {
    x: input.anchorImage.x + dx / input.imageToWorldScale,
    y: input.anchorImage.y - (dy / input.imageToWorldScale) * aspect,
    z: input.targetImage.z,
  };
  return {
    accepted: true, candidates: [
      { point: { x: positive.x, y: positive.y, z: positive.z }, branch: 1, depthDelta: depthMagnitude, direction: { x: positiveDirection.x, y: positiveDirection.y, z: positiveDirection.z }, targetDistance: input.targetDistance },
      { point: { x: negative.x, y: negative.y, z: negative.z }, branch: -1, depthDelta: -depthMagnitude, direction: { x: negativeDirection.x, y: negativeDirection.y, z: negativeDirection.z }, targetDistance: input.targetDistance },
    ], feasibilityConfidence,
    imageToWorldScale: input.imageToWorldScale,
    planarDistance,
    rawPlanarDistance,
    reachViolation: violation,
    projectedImage,
    branchSeparation: depthMagnitude * 2,
    rejectionReason: null,
  };
}

/** Backward-compatible single-result API. New production code should select candidates temporally. */
export function reconstructPointOnSphereFromImage(input: Parameters<typeof generateWristDepthCandidates>[0] & {
  previousDirection: Vector3Data | null;
}): WristReconstructionResult {
  const generated = generateWristDepthCandidates(input);
  if (!generated.accepted) return { ...rejected(generated.rejectionReason!), imageToWorldScale: generated.imageToWorldScale, planarDistance: generated.planarDistance, reachViolation: generated.reachViolation };
  const previous = input.previousDirection && new Vector3(input.previousDirection.x, input.previousDirection.y, input.previousDirection.z);
  if (!previous || ![previous.x, previous.y, previous.z].every(Number.isFinite) || previous.lengthSq() <= 1e-8) return { ...rejected("missing-depth-prior"), candidates: generated.candidates, branchSeparation: generated.branchSeparation, feasibilityConfidence: generated.feasibilityConfidence };
  const anchor = new Vector3(input.anchorWorld.x, input.anchorWorld.y, input.anchorWorld.z);
  const priorTarget = anchor.clone().add(previous.normalize().multiplyScalar(input.targetDistance));
  const chosen = generated.candidates.reduce((best, candidate) => {
    const point = new Vector3(candidate.point.x, candidate.point.y, candidate.point.z);
    const bestPoint = new Vector3(best.point.x, best.point.y, best.point.z);
    return point.distanceToSquared(priorTarget) < bestPoint.distanceToSquared(priorTarget) ? candidate : best;
  });
  // Large branch separation means a wrong sign is costly. With only one monocular frame it is
  // therefore more ambiguous, not less ambiguous as the legacy formula claimed.
  const depthAmbiguity = Math.min(1, generated.branchSeparation / Math.max(1e-6, input.targetDistance * 2));
  const topologyConfidence = 1 - depthAmbiguity;
  return {
    accepted: true, point: chosen.point,
    confidence: generated.feasibilityConfidence * topologyConfidence,
    feasibilityConfidence: generated.feasibilityConfidence,
    imageToWorldScale: generated.imageToWorldScale, planarDistance: generated.planarDistance,
    depthDelta: chosen.depthDelta, reachViolation: generated.reachViolation,
    projectedImage: generated.projectedImage, branchSeparation: generated.branchSeparation,
    depthAmbiguity, selectedBranch: chosen.branch, candidates: generated.candidates,
    rejectionReason: null,
  };
}
