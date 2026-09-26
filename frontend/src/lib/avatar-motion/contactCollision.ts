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

export function resolveContactCollisionFailSafe(baselineInfluence:number,penetration:number,hardThreshold:number):{influence:number;accepted:boolean;reason:"none"|"collision-unsatisfied"}{
  if(!Number.isFinite(penetration)||penetration>hardThreshold)return{influence:0,accepted:false,reason:"collision-unsatisfied"};
  const influence=hardThreshold<=0?0:baselineInfluence*Math.max(0,1-penetration/hardThreshold);
  return{influence,accepted:true,reason:"none"};
}
