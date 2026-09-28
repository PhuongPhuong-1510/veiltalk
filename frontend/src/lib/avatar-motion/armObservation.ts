import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { Vector3Data } from "./avatarPoseTypes";
import type { ArmSide } from "./avatarMotionDiagnostics";
import { classifyArmObservability, type ArmObservability } from "./armObservability";

export type JointEstimateSource =
  | "pose-observed" | "hand-observed" | "torso-derived" | "temporal-propagated"
  | "constraint-projected" | "held" | "unavailable";

export interface JointObservation {
  position: Vector3Data | null;
  source: "pose-observed" | "hand-observed" | "unavailable";
  confidence: number;
  sampledAtMs: number | null;
}

export interface ArmObservations {
  side: ArmSide;
  shoulder: JointObservation;
  elbow: JointObservation;
  wrist: JointObservation;
  observability: ArmObservability;
}

const INDICES = { left: { shoulder: 11, elbow: 13, wrist: 15 }, right: { shoulder: 12, elbow: 14, wrist: 16 } } as const;
const semantic = (p: RawNormalizedLandmarkV1): Vector3Data => ({ x: p.x, y: -p.y, z: -p.z });

function poseObservation(world: RawNormalizedLandmarkV1[], image: RawNormalizedLandmarkV1[], index: number, sampledAtMs: number | null, minimumVisibility: number, margin: number): JointObservation {
  const w = world[index], i = image[index];
  const confidence = i?.visibility ?? w?.visibility ?? 0;
  const valid = Boolean(w && i && confidence >= minimumVisibility && i.x >= -margin && i.x <= 1 + margin && i.y >= -margin && i.y <= 1 + margin);
  return valid
    ? { position: semantic(w), source: "pose-observed", confidence: Math.max(0, Math.min(1, confidence)), sampledAtMs }
    : { position: null, source: "unavailable", confidence: 0, sampledAtMs };
}

export function buildArmObservations(input: {
  side: ArmSide; worldLandmarks: RawNormalizedLandmarkV1[]; imageLandmarks: RawNormalizedLandmarkV1[];
  sampledAtMs: number | null; minimumVisibility: number; outerBoundsMargin?: number;
  handWrist?: { position: Vector3Data; confidence: number; sampledAtMs: number } | null;
}): ArmObservations {
  const indices = INDICES[input.side], margin = input.outerBoundsMargin ?? 0;
  const shoulder = poseObservation(input.worldLandmarks, input.imageLandmarks, indices.shoulder, input.sampledAtMs, input.minimumVisibility, margin);
  const elbow = poseObservation(input.worldLandmarks, input.imageLandmarks, indices.elbow, input.sampledAtMs, input.minimumVisibility, margin);
  let wrist = poseObservation(input.worldLandmarks, input.imageLandmarks, indices.wrist, input.sampledAtMs, input.minimumVisibility, margin);
  if (wrist.source === "unavailable" && input.handWrist) wrist = { position: input.handWrist.position, source: "hand-observed", confidence: input.handWrist.confidence, sampledAtMs: input.handWrist.sampledAtMs };
  const observability = classifyArmObservability({ shoulder: shoulder.source !== "unavailable", elbow: elbow.source !== "unavailable", wrist: wrist.source !== "unavailable" }).mask;
  return { side: input.side, shoulder, elbow, wrist, observability };
}
