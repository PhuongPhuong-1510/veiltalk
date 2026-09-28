import { Vector3 } from "three";
import type { ContactPoint2 } from "./bodyContactTypes";
import type { Vector3Data } from "./avatarPoseTypes";
import type { ContactBodyJointName } from "./normalizedRigProfile";
import type { AvatarContactSurface } from "./avatarContactRig";

export interface AvatarContactLocalAnchor {
  region:AvatarContactSurface["region"];
  pointLocal:Vector3Data;
  normalLocal:Vector3Data;
  tangentLocal:Vector3Data;
  parentJoint:ContactBodyJointName;
}
export interface AvatarContactAnchor {
  region:AvatarContactSurface["region"];
  point:Vector3Data;
  normal:Vector3Data;
  tangent:Vector3Data;
  parentJoint:ContactBodyJointName;
}
const data=(v:Vector3):Vector3Data=>({x:v.x,y:v.y,z:v.z});

/** Ellipsoid patch mapping in parent-local space. uv is semantic image patch space, never raw camera coordinates. */
export function mapContactAnchor(surface:AvatarContactSurface,uv:ContactPoint2={x:0,y:0},tangentAngleRadians=0):AvatarContactLocalAnchor{
  const u=Math.max(-1,Math.min(1,uv.x)),v=Math.max(-1,Math.min(1,uv.y));
  const radii=new Vector3(surface.radii.x,surface.radii.y,surface.radii.z),center=new Vector3(surface.centerLocal.x,surface.centerLocal.y,surface.centerLocal.z);
  const uAxis=new Vector3(surface.uAxisLocal.x,surface.uAxisLocal.y,surface.uAxisLocal.z).normalize();
  const vAxis=new Vector3(surface.vAxisLocal.x,surface.vAxisLocal.y,surface.vAxisLocal.z).normalize();
  const outward=new Vector3(surface.outwardLocal.x,surface.outwardLocal.y,surface.outwardLocal.z).normalize();
  const xNorm=u*.7,yNorm=v*.7,zNorm=Math.sqrt(Math.max(0,1-xNorm*xNorm-yNorm*yNorm));
  const point=center.clone().addScaledVector(uAxis,xNorm*radii.x).addScaledVector(vAxis,yNorm*radii.y).addScaledVector(outward,zNorm*radii.z);
  const normal=uAxis.clone().multiplyScalar(xNorm/Math.max(1e-8,radii.x))
    .addScaledVector(vAxis,yNorm/Math.max(1e-8,radii.y))
    .addScaledVector(outward,zNorm/Math.max(1e-8,radii.z)).normalize();
  let imageUp=vAxis.clone().negate().addScaledVector(normal,vAxis.dot(normal));
  let imageRight=uAxis.clone().addScaledVector(normal,-uAxis.dot(normal));
  if(imageUp.lengthSq()<1e-8)imageUp=uAxis.clone().addScaledVector(normal,-uAxis.dot(normal));
  imageUp.normalize();
  if(imageRight.lengthSq()<1e-8)imageRight=new Vector3().crossVectors(imageUp,normal);
  imageRight.normalize();
  const tangent=imageUp.multiplyScalar(Math.cos(tangentAngleRadians)).addScaledVector(imageRight,Math.sin(tangentAngleRadians)).normalize();
  return{region:surface.region,pointLocal:data(point),normalLocal:data(normal),tangentLocal:data(tangent),parentJoint:surface.parentJoint};
}
