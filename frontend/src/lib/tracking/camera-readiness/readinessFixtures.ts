import type { RawNormalizedLandmarkV1, RawTrackingFrameV1 } from "../rawTrackingTypes";
import { POSE_LANDMARK_INDEX } from "./readinessEvidence";

const point = (x: number, y: number, visibility = 1): RawNormalizedLandmarkV1 => ({ x, y, z: 0, visibility });

export type ReadinessFixtureName = "centered" | "left-wrist-outside" | "pose-not-sampled" | "pose-lost" | "invalid";

export function createReadinessFixture(name: ReadinessFixtureName, timestampMs = 1000): RawTrackingFrameV1 {
  const landmarks = Array.from({ length: 33 }, () => point(0.5, 0.5));
  const set = (index: number, x: number, y: number, visibility = 1) => { landmarks[index] = point(x, y, visibility); };
  set(POSE_LANDMARK_INDEX.nose, 0.5, 0.2);
  set(POSE_LANDMARK_INDEX.leftEye, 0.47, 0.19); set(POSE_LANDMARK_INDEX.rightEye, 0.53, 0.19);
  set(POSE_LANDMARK_INDEX.leftEar, 0.43, 0.21); set(POSE_LANDMARK_INDEX.rightEar, 0.57, 0.21);
  set(POSE_LANDMARK_INDEX.leftShoulder, 0.38, 0.36); set(POSE_LANDMARK_INDEX.rightShoulder, 0.62, 0.36);
  set(POSE_LANDMARK_INDEX.leftElbow, 0.3, 0.52); set(POSE_LANDMARK_INDEX.rightElbow, 0.7, 0.52);
  set(POSE_LANDMARK_INDEX.leftWrist, 0.24, 0.68); set(POSE_LANDMARK_INDEX.rightWrist, 0.76, 0.68);
  set(POSE_LANDMARK_INDEX.leftHip, 0.43, 0.72); set(POSE_LANDMARK_INDEX.rightHip, 0.57, 0.72);
  if (name === "left-wrist-outside") set(POSE_LANDMARK_INDEX.leftWrist, -0.05, 0.68);
  if (name === "invalid") landmarks[POSE_LANDMARK_INDEX.rightElbow] = point(Number.NaN, 0.52);
  const state = name === "pose-lost" ? "lost" : name === "pose-not-sampled" ? "not-sampled" : "tracked";
  return {
    version: 1,
    frameTimestampMs: timestampMs,
    overall: state === "lost" ? "lost" : "partial",
    face: { state: "lost", sampledAtMs: timestampMs, landmarks: null, blendshapes: null, facialTransform: null },
    leftHand: { state: "lost", sampledAtMs: timestampMs, handedness: "left", handednessScore: null, landmarks: null, worldLandmarks: null },
    rightHand: { state: "lost", sampledAtMs: timestampMs, handedness: "right", handednessScore: null, landmarks: null, worldLandmarks: null },
    rawHands: [], handSampledThisFrame: false, handSampledAtMs: null,
    pose: { state, sampledAtMs: state === "lost" ? timestampMs : timestampMs, landmarks: state === "lost" ? null : landmarks, worldLandmarks: null },
    videoWidth: name === "invalid" ? null : 1280,
    videoHeight: name === "invalid" ? null : 720,
  };
}
