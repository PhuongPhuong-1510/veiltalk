import { Vector3 } from "three";
import type { Vector3Data } from "./avatarPoseTypes";

export interface SphereCollider {center:Vector3Data;radius:number}
export interface CapsuleCollider {start:Vector3Data;end:Vector3Data;radius:number}
export interface ContactCollisionResult {penetration:number;normal:Vector3Data;closest:Vector3Data;valid:boolean}
const data=(v:Vector3):Vector3Data=>({x:v.x,y:v.y,z:v.z});
export function capsuleSpherePenetration(capsule:CapsuleCollider,sphere:SphereCollider):ContactCollisionResult{
  const a=new Vector3(capsule.start.x,capsule.start.y,capsule.start.z),b=new Vector3(capsule.end.x,capsule.end.y,capsule.end.z),center=new Vector3(sphere.center.x,sphere.center.y,sphere.center.z),ab=b.clone().sub(a);
  const t=ab.lengthSq()>1e-12?Math.max(0,Math.min(1,center.clone().sub(a).dot(ab)/ab.lengthSq())):0,closest=a.clone().addScaledVector(ab,t),away=closest.clone().sub(center),distance=away.length(),clearance=capsule.radius+sphere.radius;
  const normal=distance>1e-8?away.multiplyScalar(1/distance):new Vector3(0,1,0),penetration=Math.max(0,clearance-distance);
  return{penetration,normal:data(normal),closest:data(closest),valid:[penetration,normal.x,normal.y,normal.z].every(Number.isFinite)};
}

/** Closest-points penetration for two finite capsules. */
export function capsuleCapsulePenetration(first:CapsuleCollider,second:CapsuleCollider):ContactCollisionResult{
  const p1=new Vector3(first.start.x,first.start.y,first.start.z),q1=new Vector3(first.end.x,first.end.y,first.end.z),p2=new Vector3(second.start.x,second.start.y,second.start.z),q2=new Vector3(second.end.x,second.end.y,second.end.z);
  const d1=q1.clone().sub(p1),d2=q2.clone().sub(p2),r=p1.clone().sub(p2),a=d1.dot(d1),e=d2.dot(d2),f=d2.dot(r);let s=0,t=0;
  if(a<=1e-12&&e<=1e-12){s=0;t=0;}else if(a<=1e-12){s=0;t=Math.max(0,Math.min(1,f/e));}else{const c=d1.dot(r);if(e<=1e-12){t=0;s=Math.max(0,Math.min(1,-c/a));}else{const b=d1.dot(d2),denominator=a*e-b*b;s=denominator!==0?Math.max(0,Math.min(1,(b*f-c*e)/denominator)):0;t=(b*s+f)/e;if(t<0){t=0;s=Math.max(0,Math.min(1,-c/a));}else if(t>1){t=1;s=Math.max(0,Math.min(1,(b-c)/a));}}}
  const firstPoint=p1.addScaledVector(d1,s),secondPoint=p2.addScaledVector(d2,t),away=firstPoint.clone().sub(secondPoint),distance=away.length(),clearance=first.radius+second.radius;
  const normal=distance>1e-8?away.multiplyScalar(1/distance):new Vector3(0,1,0),penetration=Math.max(0,clearance-distance);
  return{penetration,normal:data(normal),closest:data(firstPoint),valid:[penetration,normal.x,normal.y,normal.z].every(Number.isFinite)};
}

export function resolveContactCollisionFailSafe(baselineInfluence:number,penetration:number,hardThreshold:number):{influence:number;accepted:boolean;reason:"none"|"collision-unsatisfied"}{
  if(!Number.isFinite(penetration)||penetration>hardThreshold)return{influence:0,accepted:false,reason:"collision-unsatisfied"};
  const influence=hardThreshold<=0?0:baselineInfluence*Math.max(0,1-penetration/hardThreshold);
  return{influence,accepted:true,reason:"none"};
}
