import type { RawNormalizedLandmarkV1, RawTrackingFrameV1 } from "../rawTrackingTypes";
import type {
  BodyRegionEvidence,
  BodyRegionName,
  CameraReadinessEvidenceSnapshot,
  ReadinessEvidenceReason,
} from "./readinessTypes";

export const POSE_LANDMARK_INDEX = {
  nose: 0,
  leftEye: 2,
  rightEye: 5,
  leftEar: 7,
  rightEar: 8,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
} as const;

export interface ReadinessEvidenceConfig {
  nearEdgeMargin: number;
  minimumVisibility: number;
  poseMaxAgeMs: number;
}

export const DEFAULT_READINESS_EVIDENCE_CONFIG: ReadinessEvidenceConfig = {
  nearEdgeMargin: 0.05,
  minimumVisibility: 0.5,
  poseMaxAgeMs: 150,
};

const REGION_INDEX: Record<Exclude<BodyRegionName, "face">, number> = {
  "left-shoulder": POSE_LANDMARK_INDEX.leftShoulder,
  "right-shoulder": POSE_LANDMARK_INDEX.rightShoulder,
  "left-elbow": POSE_LANDMARK_INDEX.leftElbow,
  "right-elbow": POSE_LANDMARK_INDEX.rightElbow,
  "left-wrist": POSE_LANDMARK_INDEX.leftWrist,
  "right-wrist": POSE_LANDMARK_INDEX.rightWrist,
  "left-hip": POSE_LANDMARK_INDEX.leftHip,
  "right-hip": POSE_LANDMARK_INDEX.rightHip,
};

const finitePoint = (point: RawNormalizedLandmarkV1 | undefined): point is RawNormalizedLandmarkV1 =>
  Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));

function classifyBounds(
  point: RawNormalizedLandmarkV1,
  margin: number,
): BodyRegionEvidence["bounds"] {
  if (point.x < 0 || point.x > 1 || point.y < 0 || point.y > 1) return "outside";
  if (point.x <= margin || point.x >= 1 - margin || point.y <= margin || point.y >= 1 - margin) return "near-edge";
  return "inside";
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function reasonsFor(
  point: RawNormalizedLandmarkV1 | null,
  bounds: BodyRegionEvidence["bounds"],
  visibility: number | null,
  config: ReadinessEvidenceConfig,
  common: ReadinessEvidenceReason[],
): ReadinessEvidenceReason[] {
  const reasons = [...common];
  if (!point) reasons.push("missing-landmarks");
  if (point && bounds === "outside") reasons.push("outside-frame");
  if (point && bounds === "near-edge") reasons.push("near-edge");
  if (visibility === null) reasons.push("unknown-visibility");
  else if (visibility < config.minimumVisibility) reasons.push("low-visibility");
  if (point && bounds !== "outside" && visibility !== null && visibility >= config.minimumVisibility && common.length === 0) reasons.push("valid");
  return [...new Set(reasons)];
}

function singleRegion(
  region: Exclude<BodyRegionName, "face">,
  landmarks: RawNormalizedLandmarkV1[] | null,
  common: ReadinessEvidenceReason[],
  config: ReadinessEvidenceConfig,
): BodyRegionEvidence {
  const index = REGION_INDEX[region];
  const raw = landmarks?.[index];
  const point = finitePoint(raw) ? raw : null;
  const bounds = point ? classifyBounds(point, config.nearEdgeMargin) : "unknown";
  const visibility = point && Number.isFinite(point.visibility) ? point.visibility : null;
  const reasons = reasonsFor(point, bounds, visibility, config, common);
  if (raw && !point) reasons.push("non-finite-coordinate");
  return {
    region,
    available: Boolean(point && bounds !== "outside" && visibility !== null && visibility >= config.minimumVisibility && common.length === 0),
    visibility,
    imagePoint: point ? { x: point.x, y: point.y } : null,
    bounds,
    reasons: [...new Set(reasons)],
    sourceLandmarkIndices: [index],
  };
}

function faceRegion(
  landmarks: RawNormalizedLandmarkV1[] | null,
  common: ReadinessEvidenceReason[],
  config: ReadinessEvidenceConfig,
): BodyRegionEvidence {
  const indices = [
    POSE_LANDMARK_INDEX.nose,
    POSE_LANDMARK_INDEX.leftEye,
    POSE_LANDMARK_INDEX.rightEye,
    POSE_LANDMARK_INDEX.leftEar,
    POSE_LANDMARK_INDEX.rightEar,
  ];
  const points = indices.map((index) => landmarks?.[index]).filter(finitePoint);
  const noseValid = finitePoint(landmarks?.[POSE_LANDMARK_INDEX.nose]);
  const leftValid = [POSE_LANDMARK_INDEX.leftEye, POSE_LANDMARK_INDEX.leftEar].some((index) => finitePoint(landmarks?.[index]));
  const rightValid = [POSE_LANDMARK_INDEX.rightEye, POSE_LANDMARK_INDEX.rightEar].some((index) => finitePoint(landmarks?.[index]));
  const quorum = noseValid && leftValid && rightValid;
  const point = quorum ? {
    x: points.reduce((sum, value) => sum + value.x, 0) / points.length,
    y: points.reduce((sum, value) => sum + value.y, 0) / points.length,
    z: points.reduce((sum, value) => sum + value.z, 0) / points.length,
    visibility: null,
  } : null;
  const visibility = median(points.map((value) => value.visibility).filter((value): value is number => value !== null && Number.isFinite(value)));
  const bounds = point ? classifyBounds(point, config.nearEdgeMargin) : "unknown";
  const reasons = reasonsFor(point, bounds, visibility, config, common);
  if (points.length > 0 && !quorum) reasons.push("missing-landmarks");
  return {
    region: "face",
    available: Boolean(point && bounds !== "outside" && visibility !== null && visibility >= config.minimumVisibility && common.length === 0),
    visibility,
    imagePoint: point ? { x: point.x, y: point.y } : null,
    bounds,
    reasons: [...new Set(reasons)],
    sourceLandmarkIndices: indices.filter((index) => finitePoint(landmarks?.[index])),
  };
}

export function extractReadinessEvidence(
  frame: RawTrackingFrameV1,
  observedAtMs: number,
  config: ReadinessEvidenceConfig = DEFAULT_READINESS_EVIDENCE_CONFIG,
): CameraReadinessEvidenceSnapshot {
  const dimensionsValid = Number.isFinite(frame.videoWidth) && Number.isFinite(frame.videoHeight) &&
    (frame.videoWidth ?? 0) > 0 && (frame.videoHeight ?? 0) > 0;
  const poseAgeMs = frame.pose.sampledAtMs === null ? null : observedAtMs - frame.pose.sampledAtMs;
  const ageValid = poseAgeMs !== null && poseAgeMs >= 0 && poseAgeMs <= config.poseMaxAgeMs;
  const poseFreshness = frame.pose.state === "lost" || frame.pose.sampledAtMs === null
    ? "unavailable"
    : ageValid ? "fresh" : "stale";
  const common: ReadinessEvidenceReason[] = [];
  if (frame.pose.state === "lost") common.push("lost");
  if (frame.pose.state === "not-sampled") common.push("not-sampled");
  if (poseFreshness === "stale") common.push("stale");
  if (!dimensionsValid) common.push("missing-video-dimensions");
  if (!frame.pose.landmarks) common.push("missing-landmarks");

  const regions: BodyRegionEvidence[] = [
    faceRegion(frame.pose.landmarks, common, config),
    ...Object.keys(REGION_INDEX).map((region) => singleRegion(
      region as Exclude<BodyRegionName, "face">,
      frame.pose.landmarks,
      common,
      config,
    )),
  ];
  return {
    frameTimestampMs: frame.frameTimestampMs,
    poseSampledAtMs: frame.pose.sampledAtMs,
    poseAgeMs,
    poseFreshness,
    poseObservation: frame.pose.state === "tracked" ? "new-sample" : frame.pose.state,
    videoSize: dimensionsValid ? { width: frame.videoWidth!, height: frame.videoHeight! } : null,
    regions,
    handSampling: {
      sampledThisFrame: frame.handSampledThisFrame,
      sampledAtMs: frame.handSampledAtMs,
      candidateCount: frame.rawHands.length,
    },
    light: { state: "not-observed" },
  };
}
