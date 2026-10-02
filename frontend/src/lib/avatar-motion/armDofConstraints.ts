import { Quaternion,Vector3 } from "three";
import type { QuaternionData,Vector3Data } from "./avatarPoseTypes";

export interface ArmDofLimits {swingRadians:number;twistRadians:number}
export const ARM_DOF_LIMITS={upper:{swingRadians:160*Math.PI/180,twistRadians:60*Math.PI/180},lower:{swingRadians:150*Math.PI/180,twistRadians:165*Math.PI/180}} satisfies Record<string,ArmDofLimits>;

/** Bound elbow flexion in its observed bend plane; never guess a fixed hinge axis at singularity. */
export function constrainElbowFlexion(upper:Vector3Data,lower:Vector3Data,maximumRadians=150*Math.PI/180):{lower:Vector3Data;bendBefore:number;bendAfter:number;limited:boolean}|null {
  const a=new Vector3(upper.x,upper.y,upper.z),b=new Vector3(lower.x,lower.y,lower.z);
  if(![...a.toArray(),...b.toArray(),maximumRadians].every(Number.isFinite)||a.length()<1e-6||b.length()<1e-6||maximumRadians<0||maximumRadians>Math.PI)return null;
  a.normalize();b.normalize();const before=a.angleTo(b);
  if(before<=maximumRadians)return {lower:{x:b.x,y:b.y,z:b.z},bendBefore:before,bendAfter:before,limited:false};
  const axis=a.clone().cross(b);if(axis.length()<1e-6)return null;
  const result=a.applyAxisAngle(axis.normalize(),maximumRadians);
  return {lower:{x:result.x,y:result.y,z:result.z},bendBefore:before,bendAfter:maximumRadians,limited:true};
}

/** Rest-relative rig-local swing and axial rotation are constrained independently. */
export function constrainArmDof(value:QuaternionData,axis:Vector3Data,limits:ArmDofLimits,previous?:QuaternionData|null):QuaternionData|null {
  const q=new Quaternion(value.x,value.y,value.z,value.w),a=new Vector3(axis.x,axis.y,axis.z);
  if(![...q.toArray(),...a.toArray(),limits.swingRadians,limits.twistRadians].every(Number.isFinite)||q.length()<1e-8||a.length()<1e-8||limits.swingRadians<0||limits.twistRadians<0)return null;
  q.normalize();a.normalize();
  const components=[q.x,q.y,q.z],largest=components.reduce((x,y)=>Math.abs(y)>Math.abs(x)?y:x,0);
  if(q.w< -1e-12||Math.abs(q.w)<=1e-12&&largest<0)q.set(-q.x,-q.y,-q.z,-q.w);
  const projection=q.x*a.x+q.y*a.y+q.z*a.z;
  const twist=new Quaternion(a.x*projection,a.y*projection,a.z*projection,q.w);
  // At an antipodal pure swing, axial DOF is unobservable. Do not manufacture pronation.
  if(twist.length()<1e-6)twist.identity();else twist.normalize();
  const swing=q.clone().multiply(twist.clone().invert()).normalize();
  const swingLimited=limit(swing,limits.swingRadians,previous);
  let twistAngle=2*Math.atan2(new Vector3(twist.x,twist.y,twist.z).dot(a),twist.w);
  twistAngle=Math.atan2(Math.sin(twistAngle),Math.cos(twistAngle));
  const twistLimited=new Quaternion().setFromAxisAngle(a,Math.max(-limits.twistRadians,Math.min(limits.twistRadians,twistAngle)));
  let result=swingLimited.clone().multiply(twistLimited).normalize();
  if(previous&&Math.abs(twistAngle)>Math.PI-.1&&Math.abs(twistAngle)>limits.twistRadians){
    const prior=new Quaternion(previous.x,previous.y,previous.z,previous.w).normalize();
    const alternate=swingLimited.clone().multiply(new Quaternion().setFromAxisAngle(a,-Math.sign(twistAngle)*limits.twistRadians)).normalize();
    if(Math.abs(alternate.dot(prior))>Math.abs(result.dot(prior)))result=alternate;
  }
  return {x:result.x,y:result.y,z:result.z,w:result.w};
}
function limit(q:Quaternion,maximum:number,previous?:QuaternionData|null):Quaternion {
  if(q.w<0)q.set(-q.x,-q.y,-q.z,-q.w);
  const angle=2*Math.acos(Math.min(1,Math.max(-1,q.w)));
  if(angle<=maximum)return q;
  const axis=new Vector3(q.x,q.y,q.z);if(axis.length()<1e-8)return new Quaternion();
  const result=new Quaternion().setFromAxisAngle(axis.normalize(),maximum);
  if(previous&&angle>Math.PI-.1){
    const prior=new Quaternion(previous.x,previous.y,previous.z,previous.w).normalize();
    const alternative=new Quaternion(-result.x,-result.y,-result.z,result.w);
    if(Math.abs(alternative.dot(prior))>Math.abs(result.dot(prior)))return alternative;
  }
  return result;
}
