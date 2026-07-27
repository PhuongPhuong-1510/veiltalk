export type TrackingSampleState = "tracked" | "lost" | "not-sampled";
export type OverallTrackingState = "full" | "partial" | "lost";

export interface RawNormalizedLandmarkV1 {
  x: number;
  y: number;
  z: number;
  visibility: number | null;
}

export type RawWorldLandmarkV1 = RawNormalizedLandmarkV1;

export interface RawMatrixV1 {
  rows: number;
  columns: number;
  data: number[];
}

export interface RawFaceSampleV1 {
  state: TrackingSampleState;
  sampledAtMs: number | null;
  landmarks: RawNormalizedLandmarkV1[] | null;
  blendshapes: Record<string, number> | null;
  facialTransform: RawMatrixV1 | null;
}

export interface RawHandSampleV1 {
  state: TrackingSampleState;
  sampledAtMs: number | null;
  handedness: "left" | "right";
  handednessScore: number | null;
  landmarks: RawNormalizedLandmarkV1[] | null;
  worldLandmarks: RawWorldLandmarkV1[] | null;
}

export interface RawPoseSampleV1 {
  state: TrackingSampleState;
  sampledAtMs: number | null;
  landmarks: RawNormalizedLandmarkV1[] | null;
  worldLandmarks: RawWorldLandmarkV1[] | null;
}

/** Output local-only của P4-T09. Không được dùng trực tiếp làm payload WebRTC. */
export interface RawTrackingFrameV1 {
  version: 1;
  frameTimestampMs: number;
  overall: OverallTrackingState;
  face: RawFaceSampleV1;
  leftHand: RawHandSampleV1;
  rightHand: RawHandSampleV1;
  pose: RawPoseSampleV1;
}

export interface TrackingFreshnessPolicy {
  faceMaxAgeMs: number;
  handMaxAgeMs: number;
  poseMaxAgeMs: number;
}

export const DEFAULT_TRACKING_FRESHNESS: TrackingFreshnessPolicy = {
  faceMaxAgeMs: 100,
  handMaxAgeMs: 150,
  poseMaxAgeMs: 150,
};
