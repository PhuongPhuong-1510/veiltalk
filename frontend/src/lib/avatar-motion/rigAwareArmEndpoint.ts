import { Vector3 } from "three";
import type { Vector3Data } from "./avatarPoseTypes";
import { solveContactArmIk } from "./contactArmIk";

export interface RigAwareEndpointResult {
  upperDirection: Vector3Data; lowerDirection: Vector3Data;
  reachRatio: number; projected: boolean; projectionErrorRatio: number;
  quality:number; requestedAvatarOffset:Vector3Data;
  imageObjective?:RigImageObjective;
  imageErrorBefore:number|null;imageErrorIk:number|null;
}
export interface RigImageObjective {
  /** Shoulder-relative semantic XY in human units, from an explicitly weak-perspective adapter. */
  x:number;y:number;quality:number;shoulderWidth:number;source:"pose-image"|"matched-hand-image";
}
export function endpointImageError(avatarOffset:Vector3Data,humanLength:number,avatarLength:number,goal:RigImageObjective):number {
  const scale=humanLength/avatarLength;
  return Math.hypot(avatarOffset.x*scale-goal.x,avatarOffset.y*scale-goal.y)/goal.shoulderWidth;
}
const vector = (p: Vector3Data) => new Vector3(p.x,p.y,p.z);
const data = (p: Vector3) => ({x:p.x,y:p.y,z:p.z});

/** Retarget normalized reach, retaining the human bend hemisphere. No landmark mutation. */
export function retargetArmEndpoint(input: {
  shoulder: Vector3Data; elbow: Vector3Data; wrist: Vector3Data;
  avatarUpperLength: number; avatarLowerLength: number;
  /** Optional relative depth objective in observed human units; measurements stay raw. */
  targetOffset?: Vector3Data | null;
  imageObjective?:RigImageObjective|null;
}): RigAwareEndpointResult | null {
  const s = vector(input.shoulder), e = vector(input.elbow), w = vector(input.wrist);
  const humanLength = e.distanceTo(s)+w.distanceTo(e), offset = input.targetOffset ? vector(input.targetOffset) : w.clone().sub(s);
  const avatarLength = input.avatarUpperLength+input.avatarLowerLength;
  if (![humanLength, avatarLength, ...offset.toArray(), ...s.toArray(), ...e.toArray(), ...w.toArray()].every(Number.isFinite)
    || humanLength <= 1e-6 || offset.length() <= 1e-6 || !(input.avatarUpperLength > 0 && input.avatarLowerLength > 0)) return null;
  const image=input.imageObjective;
  const validImage=image&&[image.x,image.y,image.quality,image.shoulderWidth].every(Number.isFinite)&&image.shoulderWidth>1e-6&&image.quality>0;
  if(validImage){
    const change=new Vector3(image.x-offset.x,image.y-offset.y,0).multiplyScalar(.35*Math.min(1,image.quality));
    if(change.length()>humanLength*.08)change.setLength(humanLength*.08);
    offset.add(change);
  }
  const reach=offset.length();
  const observedAxis=w.clone().sub(s);
  if(observedAxis.length()<1e-6)return null;
  observedAxis.normalize();
  const observedPole=e.clone().sub(s);observedPole.addScaledVector(observedAxis,-observedPole.dot(observedAxis));
  // An image/depth objective must not invent a fresh bend plane in a straight observed arm.
  if(observedPole.length()/humanLength<.015)return null;
  const axis = offset.clone().normalize(), pole = observedPole.clone();
  pole.addScaledVector(axis,-pole.dot(axis));
  // Nearly straight arms do not have a trustworthy fresh bend plane. Keep canonical baseline.
  if (pole.length()/humanLength < .015) return null;
  const target = offset.clone().multiplyScalar(avatarLength/humanLength);
  const result = solveContactArmIk({ shoulder: {x:0,y:0,z:0}, wristTarget: data(target), upperLength: input.avatarUpperLength,
    lowerLength: input.avatarLowerLength, preferredPole: data(pole.normalize()) });
  if (!result) return null;
  const t=Math.max(0,Math.min(1,(result.reachErrorRatio-.02)/.10)),quality=1-t*t*(3-2*t);
  const originalUpper=e.clone().sub(s).normalize(),originalLower=w.clone().sub(e).normalize();
  const upper=originalUpper.clone().lerp(vector(result.elbow).normalize(),quality).normalize();
  const lower=originalLower.clone().lerp(vector(result.wrist).sub(vector(result.elbow)).normalize(),quality).normalize();
  if(upper.lengthSq()<1e-8||lower.lengthSq()<1e-8)return null;
  const before=originalUpper.multiplyScalar(input.avatarUpperLength).addScaledVector(originalLower,input.avatarLowerLength);
  const after=upper.clone().multiplyScalar(input.avatarUpperLength).addScaledVector(lower,input.avatarLowerLength);
  return { upperDirection: data(upper), lowerDirection: data(lower),quality,requestedAvatarOffset:data(target),
    imageObjective:validImage?image:undefined,imageErrorBefore:validImage?endpointImageError(data(before),humanLength,avatarLength,image):null,
    imageErrorIk:validImage?endpointImageError(data(after),humanLength,avatarLength,image):null,
    reachRatio: reach/humanLength, projected: result.projected, projectionErrorRatio: result.reachErrorRatio };
}
