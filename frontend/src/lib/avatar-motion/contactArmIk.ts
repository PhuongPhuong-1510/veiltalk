import { Vector3 } from "three";
import type { Vector3Data } from "./avatarPoseTypes";

export interface ContactArmIkInput {shoulder:Vector3Data;wristTarget:Vector3Data;upperLength:number;lowerLength:number;preferredPole:Vector3Data;reachSlackRatio?:number}
export interface ContactArmIkResult {shoulder:Vector3Data;elbow:Vector3Data;wrist:Vector3Data;reachRatio:number;targetError:number;projected:boolean;pole:Vector3Data}
const data=(v:Vector3):Vector3Data=>({x:v.x,y:v.y,z:v.z});
/** Analytic length-preserving two-bone IK. It never stretches avatar bones. */
export function solveContactArmIk(input:ContactArmIkInput):ContactArmIkResult|null{
  const shoulder=new Vector3(input.shoulder.x,input.shoulder.y,input.shoulder.z),requested=new Vector3(input.wristTarget.x,input.wristTarget.y,input.wristTarget.z);
  const delta=requested.clone().sub(shoulder),distance=delta.length();if(!(input.upperLength>0&&input.lowerLength>0)||distance<1e-8)return null;
  const axis=delta.normalize(),minReach=Math.abs(input.upperLength-input.lowerLength)+1e-6,maxReach=input.upperLength+input.lowerLength-1e-6;
  const clamped=Math.max(minReach,Math.min(maxReach,distance)),wrist=shoulder.clone().addScaledVector(axis,clamped);
  let pole=new Vector3(input.preferredPole.x,input.preferredPole.y,input.preferredPole.z).addScaledVector(axis,-new Vector3(input.preferredPole.x,input.preferredPole.y,input.preferredPole.z).dot(axis));
  if(pole.lengthSq()<1e-8){pole=Math.abs(axis.y)<.9?new Vector3(0,1,0):new Vector3(1,0,0);pole.addScaledVector(axis,-pole.dot(axis));}
  if(pole.lengthSq()<1e-8)return null;pole.normalize();
  const x=(input.upperLength**2-input.lowerLength**2+clamped**2)/(2*clamped),radius=Math.sqrt(Math.max(0,input.upperLength**2-x**2));
  const elbow=shoulder.clone().addScaledVector(axis,x).addScaledVector(pole,radius);
  return{shoulder:data(shoulder),elbow:data(elbow),wrist:data(wrist),reachRatio:distance/(input.upperLength+input.lowerLength),targetError:wrist.distanceTo(requested),projected:Math.abs(clamped-distance)>1e-7,pole:data(pole)};
}
