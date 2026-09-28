import type { Vector3Data } from "./avatarPoseTypes";
import type { ArmObservability } from "./armObservability";
import type { JointEstimateSource } from "./armObservation";
import { buildElbowSolutionCircle, parallelTransportDirection, projectElbowToCircle } from "./armSolutionManifold";

export interface EstimatedJoint { position: Vector3Data | null; source: JointEstimateSource; confidence: number; uncertainty: number; sampledAtMs: number | null; ageMs: number }
export interface ArmUncertainty { shoulderPosition: number; elbowPosition: number; wristPosition: number; bendPlaneRadians: number; depth: number; topologyAmbiguous: boolean }
export interface ArmTopologyState { bendHemisphere: -1 | 0 | 1; crossBodySide: -1 | 0 | 1; poleDirection: Vector3Data | null; depthOrdering: -1 | 0 | 1 }
export type PartialArmMode = "fully-observed" | "partial-continuation" | "ambiguous-hold" | "safe-return";
export interface EstimatedArmChain {
  shoulder: EstimatedJoint; elbow: EstimatedJoint; wrist: EstimatedJoint; upperLength: number; lowerLength: number;
  bendPole: Vector3Data | null; mode: PartialArmMode; observability: ArmObservability; topologyLocked: boolean;
  geometryConfidence: number; ambiguity: number; uncertainty: ArmUncertainty;
  mayUpdateUpper: boolean; mayUpdateLower: boolean; mayChangeBendPlane: boolean; solutionManifold: "none" | "elbow-circle" | "wrist-sphere";
}
export interface PartialArmHistory { chain: EstimatedArmChain | null; topology: ArmTopologyState; lastFullyObservedAtMs: number | null; previousUpperDirection?: Vector3Data | null; previousLowerDirection?: Vector3Data | null }

const unavailable = (nowMs: number): EstimatedJoint => ({ position: null, source: "unavailable", confidence: 0, uncertainty: 1, sampledAtMs: null, ageMs: nowMs });
const age = (joint: EstimatedJoint, nowMs: number): EstimatedJoint => ({ ...joint, ageMs: joint.sampledAtMs === null ? nowMs : Math.max(0, nowMs - joint.sampledAtMs) });

/** Policy core: partial evidence may continue history, but only SEW may alter topology. */
export function estimatePartialArm(input: {
  observability: ArmObservability; shoulder?: EstimatedJoint; elbow?: EstimatedJoint; wrist?: EstimatedJoint;
  upperLength: number; lowerLength: number; nowMs: number; history: PartialArmHistory; reachSlackRatio?: number;
}): EstimatedArmChain {
  const prior = input.history.chain, now = input.nowMs;
  let shoulder = age(input.shoulder ?? unavailable(now), now), elbow = age(input.elbow ?? unavailable(now), now), wrist = age(input.wrist ?? unavailable(now), now);
  let mode: PartialArmMode = input.observability === "SEW" ? "fully-observed" : "ambiguous-hold";
  let manifold: EstimatedArmChain["solutionManifold"] = "none", mayUpdateUpper = false, mayUpdateLower = false;
  let pole = prior?.bendPole ?? input.history.topology.poleDirection, ambiguity = input.observability === "SEW" ? 0 : .75;
  if (input.observability === "SEW") { mayUpdateUpper = mayUpdateLower = true; pole = input.history.topology.poleDirection; }
  else if (input.observability === "S-W" && shoulder.position && wrist.position && prior?.elbow.position) {
    const circle = buildElbowSolutionCircle(shoulder.position, wrist.position, input.upperLength, input.lowerLength, input.reachSlackRatio);
    const projected = circle && projectElbowToCircle(circle, prior.elbow.position, pole);
    if (projected) { elbow = { position: projected.elbow, source: "constraint-projected", confidence: Math.min(shoulder.confidence, wrist.confidence) * .65, uncertainty: Math.min(1, .35 + elbow.ageMs / 1000), sampledAtMs: now, ageMs: 0 }; pole = projected.pole; mode = "partial-continuation"; manifold = "elbow-circle"; mayUpdateUpper = mayUpdateLower = true; ambiguity = .5; }
  } else if (input.observability === "SE-" && shoulder.position && elbow.position && prior?.wrist.position) {
    let transportedPosition = prior.wrist.position;
    if (input.history.previousUpperDirection && input.history.previousLowerDirection) {
      const transported = parallelTransportDirection(input.history.previousLowerDirection, input.history.previousUpperDirection, { x: elbow.position.x - shoulder.position.x, y: elbow.position.y - shoulder.position.y, z: elbow.position.z - shoulder.position.z });
      if (transported) transportedPosition = { x: elbow.position.x + transported.x * input.lowerLength, y: elbow.position.y + transported.y * input.lowerLength, z: elbow.position.z + transported.z * input.lowerLength };
    }
    wrist = { ...age(prior.wrist, now), position: transportedPosition, source: "temporal-propagated", confidence: prior.wrist.confidence * .8, uncertainty: Math.min(1, prior.wrist.uncertainty + .15) };
    mode = "partial-continuation"; manifold = "wrist-sphere"; mayUpdateUpper = true; mayUpdateLower = false;
  } else if (prior && input.observability !== "---") {
    shoulder = shoulder.position ? shoulder : { ...age(prior.shoulder, now), source: "held" };
    elbow = elbow.position ? elbow : { ...age(prior.elbow, now), source: "held" };
    wrist = wrist.position ? wrist : { ...age(prior.wrist, now), source: "held" };
  } else if (!prior) mode = "safe-return";
  const topologyLocked = input.observability !== "SEW";
  const missingAge = input.history.lastFullyObservedAtMs === null ? 1000 : Math.max(0, now - input.history.lastFullyObservedAtMs);
  const growth = Math.min(1, missingAge / 1500);
  if (topologyLocked) ambiguity = Math.max(ambiguity, growth);
  if (topologyLocked && missingAge >= 1500) mode = "safe-return";
  return { shoulder, elbow, wrist, upperLength: input.upperLength, lowerLength: input.lowerLength, bendPole: pole, mode, observability: input.observability, topologyLocked,
    geometryConfidence: Math.max(0, 1 - ambiguity), ambiguity, mayUpdateUpper, mayUpdateLower, mayChangeBendPlane: !topologyLocked, solutionManifold: manifold,
    uncertainty: { shoulderPosition: shoulder.uncertainty, elbowPosition: elbow.uncertainty, wristPosition: wrist.uncertainty, bendPlaneRadians: topologyLocked ? Math.PI * ambiguity : 0, depth: ambiguity, topologyAmbiguous: topologyLocked } };
}
