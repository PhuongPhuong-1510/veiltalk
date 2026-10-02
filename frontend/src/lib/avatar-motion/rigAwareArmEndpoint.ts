import { Vector3 } from "three";
import type { Vector3Data } from "./avatarPoseTypes";
import { solveContactArmIk } from "./contactArmIk";

export interface RigAwareEndpointResult {
  upperDirection: Vector3Data; lowerDirection: Vector3Data;
  reachRatio: number; projected: boolean; projectionErrorRatio: number;
}
const vector = (p: Vector3Data) => new Vector3(p.x,p.y,p.z);
const data = (p: Vector3) => ({x:p.x,y:p.y,z:p.z});

/** Retarget normalized reach, retaining the human bend hemisphere. No landmark mutation. */
export function retargetArmEndpoint(input: {
  shoulder: Vector3Data; elbow: Vector3Data; wrist: Vector3Data;
  avatarUpperLength: number; avatarLowerLength: number;
  /** Optional relative depth objective in observed human units; measurements stay raw. */
  targetOffset?: Vector3Data | null;
}): RigAwareEndpointResult | null {
  const s = vector(input.shoulder), e = vector(input.elbow), w = vector(input.wrist);
  const humanLength = e.distanceTo(s)+w.distanceTo(e), offset = input.targetOffset ? vector(input.targetOffset) : w.clone().sub(s), reach = offset.length();
  const avatarLength = input.avatarUpperLength+input.avatarLowerLength;
  if (![humanLength, reach, avatarLength, ...s.toArray(), ...e.toArray(), ...w.toArray()].every(Number.isFinite)
    || humanLength <= 1e-6 || reach <= 1e-6 || !(input.avatarUpperLength > 0 && input.avatarLowerLength > 0)) return null;
  const axis = offset.clone().normalize(), pole = e.clone().sub(s);
  pole.addScaledVector(axis,-pole.dot(axis));
  // Nearly straight arms do not have a trustworthy fresh bend plane. Keep canonical baseline.
  if (pole.length()/humanLength < .015) return null;
  const target = offset.multiplyScalar(avatarLength/humanLength);
  const result = solveContactArmIk({ shoulder: {x:0,y:0,z:0}, wristTarget: data(target), upperLength: input.avatarUpperLength,
    lowerLength: input.avatarLowerLength, preferredPole: data(pole.normalize()) });
  if (!result) return null;
  return { upperDirection: data(vector(result.elbow).normalize()), lowerDirection: data(vector(result.wrist).sub(vector(result.elbow)).normalize()),
    reachRatio: reach/humanLength, projected: result.projected, projectionErrorRatio: result.reachErrorRatio };
}
