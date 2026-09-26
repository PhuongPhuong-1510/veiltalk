import { Vector3 } from "three";
import type { ContactPoint2 } from "./bodyContactTypes";
import type { Vector3Data } from "./avatarPoseTypes";
import type { AvatarContactSurface } from "./avatarContactRig";

export interface AvatarContactAnchor {region:AvatarContactSurface["region"];point:Vector3Data;normal:Vector3Data;tangent:Vector3Data;parent:AvatarContactSurface["parent"]}
const data=(v:Vector3):Vector3Data=>({x:v.x,y:v.y,z:v.z});
/** Ellipsoid front patch mapping. uv is clamped semantic patch space, never a raw camera coordinate. */
export function mapContactAnchor(surface:AvatarContactSurface,uv:ContactPoint2={x:0,y:0}):AvatarContactAnchor{
  const u=Math.max(-1,Math.min(1,uv.x)),v=Math.max(-1,Math.min(1,uv.y));
  const radii=new Vector3(surface.radii.x,surface.radii.y,surface.radii.z),center=new Vector3(surface.center.x,surface.center.y,surface.center.z);
  const z=Math.sqrt(Math.max(0,1-u*u*.55-v*v*.55));
  const local=new Vector3(u*radii.x*.7,v*radii.y*.7,z*radii.z);
  const point=center.clone().add(local);
  const normal=new Vector3(local.x/(radii.x*radii.x),local.y/(radii.y*radii.y),local.z/(radii.z*radii.z)).normalize();
  let tangent=new Vector3(0,1,0).addScaledVector(normal,-normal.y);if(tangent.lengthSq()<1e-8)tangent.set(1,0,0).addScaledVector(normal,-normal.x);tangent.normalize();
  return{region:surface.region,point:data(point),normal:data(normal),tangent:data(tangent),parent:surface.parent};
}
