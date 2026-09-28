import { Vector3 } from "three";
import type { Vector3Data } from "./avatarPoseTypes";

export interface ContactArmIkInput {
  shoulder:Vector3Data;
  wristTarget:Vector3Data;
  upperLength:number;
  lowerLength:number;
  preferredPole:Vector3Data;
  /** Reserved for callers that want to report a wider acceptable reach band. The solver never stretches bones. */
  reachSlackRatio?:number;
}

export type ContactReachProjection = "none"|"too-near"|"too-far";

export interface ContactArmIkResult {
  shoulder:Vector3Data;
  elbow:Vector3Data;
  wrist:Vector3Data;
  /** requested shoulder->target distance / (L1 + L2). */
  reachRatio:number;
  /** Distance from the requested wrist target to the closest length-preserving wrist solution. */
  targetError:number;
  targetDistance:number;
  minReach:number;
  maxReach:number;
  reachErrorRatio:number;
  projected:boolean;
  projection:ContactReachProjection;
  pole:Vector3Data;
}

const data=(v:Vector3):Vector3Data=>({x:v.x,y:v.y,z:v.z});

/**
 * Analytic length-preserving two-bone IK.
 *
 * Important contact invariant: unreachable requests are projected to the nearest valid reach
 * boundary instead of stretching avatar bones or failing the solve. The caller decides how much
 * influence a projected solution should receive.
 */
export function solveContactArmIk(input:ContactArmIkInput):ContactArmIkResult|null{
  const shoulder=new Vector3(input.shoulder.x,input.shoulder.y,input.shoulder.z);
  const requested=new Vector3(input.wristTarget.x,input.wristTarget.y,input.wristTarget.z);
  if(![
    shoulder.x,shoulder.y,shoulder.z,requested.x,requested.y,requested.z,
    input.upperLength,input.lowerLength,input.preferredPole.x,input.preferredPole.y,input.preferredPole.z,
  ].every(Number.isFinite))return null;

  if(!(input.upperLength>0&&input.lowerLength>0))return null;
  const delta=requested.clone().sub(shoulder),distance=delta.length();
  if(distance<1e-8)return null;

  const axis=delta.clone().multiplyScalar(1/distance);
  const epsilon=Math.max(1e-6,(input.upperLength+input.lowerLength)*1e-6);
  const minReach=Math.abs(input.upperLength-input.lowerLength)+epsilon;
  const maxReach=Math.max(minReach+epsilon,input.upperLength+input.lowerLength-epsilon);
  const clamped=Math.max(minReach,Math.min(maxReach,distance));
  const projection:ContactReachProjection=distance<minReach?"too-near":distance>maxReach?"too-far":"none";
  const wrist=shoulder.clone().addScaledVector(axis,clamped);

  const rawPole=new Vector3(input.preferredPole.x,input.preferredPole.y,input.preferredPole.z);
  let pole=rawPole.clone().addScaledVector(axis,-rawPole.dot(axis));
  if(pole.lengthSq()<1e-8){
    pole=Math.abs(axis.y)<.9?new Vector3(0,1,0):new Vector3(1,0,0);
    pole.addScaledVector(axis,-pole.dot(axis));
  }
  if(pole.lengthSq()<1e-8)return null;
  pole.normalize();

  const x=(input.upperLength**2-input.lowerLength**2+clamped**2)/(2*clamped);
  const radius=Math.sqrt(Math.max(0,input.upperLength**2-x**2));
  const elbow=shoulder.clone().addScaledVector(axis,x).addScaledVector(pole,radius);
  if(![elbow.x,elbow.y,elbow.z,wrist.x,wrist.y,wrist.z].every(Number.isFinite))return null;

  const targetError=wrist.distanceTo(requested);
  const totalLength=Math.max(1e-8,input.upperLength+input.lowerLength);
  return{
    shoulder:data(shoulder),
    elbow:data(elbow),
    wrist:data(wrist),
    reachRatio:distance/totalLength,
    targetError,
    targetDistance:distance,
    minReach,
    maxReach,
    reachErrorRatio:targetError/totalLength,
    projected:projection!=="none",
    projection,
    pole:data(pole),
  };
}
