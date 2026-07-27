import type {
  FaceLandmarkerResult,
  HandLandmarkerResult,
  Landmark,
  NormalizedLandmark,
  PoseLandmarkerResult,
} from "@mediapipe/tasks-vision";
import {
  DEFAULT_TRACKING_FRESHNESS,
  type RawFaceSampleV1,
  type RawHandSampleV1,
  type RawNormalizedLandmarkV1,
  type RawPoseSampleV1,
  type RawTrackingFrameV1,
  type TrackingFreshnessPolicy,
} from "./rawTrackingTypes";

export interface MediaPipeFrameResults {
  face?: FaceLandmarkerResult;
  hands?: HandLandmarkerResult;
  pose?: PoseLandmarkerResult;
  sampledAtMs?: {
    face?: number;
    hands?: number;
    pose?: number;
  };
}

const mapLandmark = (landmark: NormalizedLandmark | Landmark): RawNormalizedLandmarkV1 => ({
  x: landmark.x,
  y: landmark.y,
  z: landmark.z,
  visibility: Number.isFinite(landmark.visibility) ? landmark.visibility : null,
});

function notSampledFace(previous?: RawFaceSampleV1): RawFaceSampleV1 {
  return previous
    ? { ...previous, state: "not-sampled" }
    : { state: "not-sampled", sampledAtMs: null, landmarks: null, blendshapes: null, facialTransform: null };
}

function mapFace(result: FaceLandmarkerResult | undefined, now: number, previous?: RawFaceSampleV1): RawFaceSampleV1 {
  if (result === undefined) return notSampledFace(previous);
  const landmarks = result.faceLandmarks[0];
  if (!landmarks) {
    return { state: "lost", sampledAtMs: now, landmarks: null, blendshapes: null, facialTransform: null };
  }
  const categories = result.faceBlendshapes[0]?.categories ?? [];
  return {
    state: "tracked",
    sampledAtMs: now,
    landmarks: landmarks.map(mapLandmark),
    blendshapes: Object.fromEntries(categories.map((item) => [item.categoryName, item.score])),
    facialTransform: result.facialTransformationMatrixes[0]
      ? { ...result.facialTransformationMatrixes[0], data: [...result.facialTransformationMatrixes[0].data] }
      : null,
  };
}

function emptyHand(handedness: "left" | "right", state: "lost" | "not-sampled", sampledAtMs: number | null): RawHandSampleV1 {
  return { state, sampledAtMs, handedness, handednessScore: null, landmarks: null, worldLandmarks: null };
}

function mapHands(
  result: HandLandmarkerResult | undefined,
  now: number,
  previousLeft?: RawHandSampleV1,
  previousRight?: RawHandSampleV1,
): { left: RawHandSampleV1; right: RawHandSampleV1 } {
  if (result === undefined) {
    return {
      left: previousLeft ? { ...previousLeft, state: "not-sampled" } : emptyHand("left", "not-sampled", null),
      right: previousRight ? { ...previousRight, state: "not-sampled" } : emptyHand("right", "not-sampled", null),
    };
  }

  const mapped: Partial<Record<"left" | "right", RawHandSampleV1>> = {};
  result.landmarks.forEach((landmarks, index) => {
    const category = result.handedness[index]?.[0];
    const side = category?.categoryName.toLowerCase() === "left" ? "left" :
      category?.categoryName.toLowerCase() === "right" ? "right" : null;
    if (!side || mapped[side]) return;
    mapped[side] = {
      state: "tracked",
      sampledAtMs: now,
      handedness: side,
      handednessScore: category.score,
      landmarks: landmarks.map(mapLandmark),
      worldLandmarks: (result.worldLandmarks[index] ?? []).map(mapLandmark),
    };
  });

  return {
    left: mapped.left ?? emptyHand("left", "lost", now),
    right: mapped.right ?? emptyHand("right", "lost", now),
  };
}

function mapPose(result: PoseLandmarkerResult | undefined, now: number, previous?: RawPoseSampleV1): RawPoseSampleV1 {
  if (result === undefined) {
    return previous
      ? { ...previous, state: "not-sampled" }
      : { state: "not-sampled", sampledAtMs: null, landmarks: null, worldLandmarks: null };
  }
  const landmarks = result.landmarks[0];
  if (!landmarks) return { state: "lost", sampledAtMs: now, landmarks: null, worldLandmarks: null };
  return {
    state: "tracked",
    sampledAtMs: now,
    landmarks: landmarks.map(mapLandmark),
    worldLandmarks: (result.worldLandmarks[0] ?? []).map(mapLandmark),
  };
}

function isFresh(sampledAtMs: number | null, payload: unknown, now: number, maxAge: number): boolean {
  return sampledAtMs !== null && payload !== null && now - sampledAtMs <= maxAge;
}

export function mapRawTrackingFrame(
  frameTimestampMs: number,
  results: MediaPipeFrameResults,
  previous?: RawTrackingFrameV1,
  freshness: TrackingFreshnessPolicy = DEFAULT_TRACKING_FRESHNESS,
): RawTrackingFrameV1 {
  const faceSampledAt = results.sampledAtMs?.face ?? frameTimestampMs;
  const handSampledAt = results.sampledAtMs?.hands ?? frameTimestampMs;
  const poseSampledAt = results.sampledAtMs?.pose ?? frameTimestampMs;
  const face = mapFace(results.face, faceSampledAt, previous?.face);
  const hands = mapHands(results.hands, handSampledAt, previous?.leftHand, previous?.rightHand);
  const pose = mapPose(results.pose, poseSampledAt, previous?.pose);
  const fresh = [
    isFresh(face.sampledAtMs, face.landmarks, faceSampledAt, freshness.faceMaxAgeMs),
    isFresh(hands.left.sampledAtMs, hands.left.landmarks, faceSampledAt, freshness.handMaxAgeMs),
    isFresh(hands.right.sampledAtMs, hands.right.landmarks, faceSampledAt, freshness.handMaxAgeMs),
    isFresh(pose.sampledAtMs, pose.landmarks, faceSampledAt, freshness.poseMaxAgeMs),
  ];
  const freshCount = fresh.filter(Boolean).length;
  return {
    version: 1,
    frameTimestampMs,
    overall: freshCount === fresh.length ? "full" : freshCount > 0 ? "partial" : "lost",
    face,
    leftHand: hands.left,
    rightHand: hands.right,
    pose,
  };
}
