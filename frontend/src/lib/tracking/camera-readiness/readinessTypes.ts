export type BodyRegionName =
  | "face"
  | "left-shoulder"
  | "right-shoulder"
  | "left-elbow"
  | "right-elbow"
  | "left-wrist"
  | "right-wrist"
  | "left-hip"
  | "right-hip";

export type ReadinessEvidenceReason =
  | "valid"
  | "not-sampled"
  | "lost"
  | "stale"
  | "missing-landmarks"
  | "missing-video-dimensions"
  | "non-finite-coordinate"
  | "unknown-visibility"
  | "low-visibility"
  | "outside-frame"
  | "near-edge"
  | "not-observed";

export interface BodyRegionEvidence {
  region: BodyRegionName;
  available: boolean;
  visibility: number | null;
  imagePoint: { x: number; y: number } | null;
  bounds: "inside" | "near-edge" | "outside" | "unknown";
  reasons: ReadinessEvidenceReason[];
  sourceLandmarkIndices: number[];
}

export interface CameraReadinessEvidenceSnapshot {
  frameTimestampMs: number;
  poseSampledAtMs: number | null;
  poseAgeMs: number | null;
  poseFreshness: "fresh" | "stale" | "unavailable";
  poseObservation: "new-sample" | "not-sampled" | "lost";
  videoSize: { width: number; height: number } | null;
  regions: BodyRegionEvidence[];
  handSampling: {
    sampledThisFrame: boolean;
    sampledAtMs: number | null;
    candidateCount: number;
  };
  light: { state: "not-observed" };
}

export interface BodyVisibilityRegionScore {
  region: BodyRegionName;
  weight: number;
  score: number;
  contribution: number;
  reasons: ReadinessEvidenceReason[];
}

export interface BodyVisibilitySnapshot {
  bodyVisiblePercent: number | null;
  availability: "available" | "unavailable";
  regions: BodyVisibilityRegionScore[];
  leftArmComplete: boolean;
  rightArmComplete: boolean;
  reasons: ReadinessEvidenceReason[];
}
