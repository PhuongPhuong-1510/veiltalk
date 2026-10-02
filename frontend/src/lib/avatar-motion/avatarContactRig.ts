import { Quaternion,Vector3 } from "three";
import type { BodyContactRegion, BodyContactSurfaceFamily, HandContactProbe,ContactProbeMap } from "./bodyContactTypes";
import type { Vector3Data } from "./avatarPoseTypes";
import type { ContactBodyJointName, NormalizedAvatarRigProfile } from "./normalizedRigProfile";

export interface AvatarContactSurface {
  region:BodyContactRegion;
  centerLocal:Vector3Data;
  radii:Vector3Data;
  /** Axis corresponding to increasing image-space u (right). */
  uAxisLocal:Vector3Data;
  /** Axis corresponding to increasing image-space v (down). */
  vAxisLocal:Vector3Data;
  outwardLocal:Vector3Data;
  parentJoint:ContactBodyJointName;
  confidence:number;
}
export interface AvatarProbeProfile {probe:HandContactProbe;frameOffset:Vector3Data;contactNormal:Vector3Data;tangentHint:Vector3Data}
export interface AvatarContactPhysicalSurface {family:BodyContactSurfaceFamily;centerLocal:Vector3Data;radii:Vector3Data;uAxisLocal:Vector3Data;vAxisLocal:Vector3Data;outwardLocal:Vector3Data;parentJoint:ContactBodyJointName;confidence:number;uvScale:Vector3Data}
export interface AvatarContactRig {modelGeneration:number;modelFingerprint:string;surfaces:Record<BodyContactRegion,AvatarContactSurface>;probes:Record<"left"|"right",ContactProbeMap<AvatarProbeProfile>>;physicalSurfaces?:Partial<Record<BodyContactSurfaceFamily,AvatarContactPhysicalSurface>>;faceSurface?:import("./avatarFaceSurface").AvatarFaceSurfaceProfile}
const data=(v:Vector3):Vector3Data=>({x:v.x,y:v.y,z:v.z});
const vector=(v:Vector3Data)=>new Vector3(v.x,v.y,v.z);

function worldPointToLocal(profile:NormalizedAvatarRigProfile,parent:ContactBodyJointName,point:Vector3):Vector3|null{
  const ref=profile.contactSkeleton?.joints[parent];if(!ref)return null;
  const p=vector(ref.restWorldPosition),q=new Quaternion(ref.restWorldRotation.x,ref.restWorldRotation.y,ref.restWorldRotation.z,ref.restWorldRotation.w).normalize().invert();
  return point.clone().sub(p).applyQuaternion(q);
}
function worldDirectionToLocal(profile:NormalizedAvatarRigProfile,parent:ContactBodyJointName,direction:Vector3):Vector3|null{
  const ref=profile.contactSkeleton?.joints[parent];if(!ref)return null;
  const q=new Quaternion(ref.restWorldRotation.x,ref.restWorldRotation.y,ref.restWorldRotation.z,ref.restWorldRotation.w).normalize().invert();
  return direction.clone().applyQuaternion(q).normalize();
}
function projectedAxis(preferred:Vector3,outward:Vector3,fallback:Vector3):Vector3{
  let axis=preferred.clone().addScaledVector(outward,-preferred.dot(outward));
  if(axis.lengthSq()<1e-8)axis=fallback.clone().addScaledVector(outward,-fallback.dot(outward));
  return axis.normalize();
}

export function buildAvatarContactRig(profile:NormalizedAvatarRigProfile,useMeshSurface=false):AvatarContactRig|null{
  const collision=profile.collisionReference,skeleton=profile.contactSkeleton,hands=profile.hands;
  if(!collision||!skeleton||!hands)return null;
  const torsoParent:ContactBodyJointName=skeleton.joints.upperChest?"upperChest":skeleton.joints.chest?"chest":skeleton.joints.spine?"spine":"hips";
  if(!skeleton.joints.head||!skeleton.joints.neck||!skeleton.joints.leftShoulder||!skeleton.joints.rightShoulder||!skeleton.joints[torsoParent])return null;
  for(const side of ["left","right"] as const)if(!hands[side]?.contactFrame?.probes)return null;

  const up=vector(profile.torsoReference.upWorld).normalize(),right=vector(profile.torsoReference.rightWorld).normalize(),forward=vector(profile.torsoReference.forwardWorld).normalize();
  const head=vector(collision.head.centerWorld),r=collision.head.radius;
  const torsoStart=vector(collision.torso.startWorld),torsoEnd=vector(collision.torso.endWorld),torsoRadius=collision.torso.radius;
  const surfaces={} as AvatarContactRig["surfaces"];

  const surface=(region:BodyContactRegion,parent:ContactBodyJointName,surfacePointWorld:Vector3,radii:Vector3,outwardWorld:Vector3,preferredUWorld:Vector3,preferredVDownWorld:Vector3,confidence=1)=>{
    const outward=outwardWorld.clone().normalize();
    const u=projectedAxis(preferredUWorld,outward,right);
    let v=projectedAxis(preferredVDownWorld,outward,up.clone().negate());
    v.addScaledVector(u,-v.dot(u));if(v.lengthSq()<1e-8)v=new Vector3().crossVectors(outward,u);v.normalize();
    const primitiveCenterWorld=surfacePointWorld.clone().addScaledVector(outward,-radii.z);
    const centerLocal=worldPointToLocal(profile,parent,primitiveCenterWorld),uLocal=worldDirectionToLocal(profile,parent,u),vLocal=worldDirectionToLocal(profile,parent,v),outwardLocal=worldDirectionToLocal(profile,parent,outward);
    if(!centerLocal||!uLocal||!vLocal||!outwardLocal)return false;
    surfaces[region]={region,centerLocal:data(centerLocal),radii:data(radii),uAxisLocal:data(uLocal),vAxisLocal:data(vLocal),outwardLocal:data(outwardLocal),parentJoint:parent,confidence};
    return true;
  };

  const leftCheekOut=right.clone().multiplyScalar(-.72).addScaledVector(forward,.69).normalize();
  const rightCheekOut=right.clone().multiplyScalar(.72).addScaledVector(forward,.69).normalize();
  const chinOut=up.clone().multiplyScalar(-.62).addScaledVector(forward,.78).normalize();
  const leftEarOut=right.clone().negate(),rightEarOut=right.clone();
  const leftShoulderOut=right.clone().multiplyScalar(-.75).addScaledVector(up,.45).addScaledVector(forward,.35).normalize();
  const rightShoulderOut=right.clone().multiplyScalar(.75).addScaledVector(up,.45).addScaledVector(forward,.35).normalize();

  const ok=[
    surface("headTop","head",head.clone().addScaledVector(up,.90*r),new Vector3(.48*r,.42*r,.22*r),up,right,forward,.8),
    surface("forehead","head",head.clone().addScaledVector(up,.26*r).addScaledVector(forward,.82*r),new Vector3(.42*r,.30*r,.18*r),forward,right,up.clone().negate(),.92),
    surface("leftCheek","head",head.clone().addScaledVector(right,-.58*r).addScaledVector(forward,.52*r),new Vector3(.30*r,.36*r,.18*r),leftCheekOut,right,up.clone().negate(),.9),
    surface("rightCheek","head",head.clone().addScaledVector(right,.58*r).addScaledVector(forward,.52*r),new Vector3(.30*r,.36*r,.18*r),rightCheekOut,right,up.clone().negate(),.9),
    surface("mouth","head",head.clone().addScaledVector(up,-.30*r).addScaledVector(forward,.84*r),new Vector3(.28*r,.14*r,.13*r),forward,right,up.clone().negate(),.82),
    surface("chin","head",head.clone().addScaledVector(up,-.67*r).addScaledVector(forward,.54*r),new Vector3(.32*r,.22*r,.18*r),chinOut,right,up.clone().negate(),.82),
    surface("leftEar","head",head.clone().addScaledVector(right,-.88*r),new Vector3(.18*r,.30*r,.14*r),leftEarOut,forward,up.clone().negate(),.72),
    surface("rightEar","head",head.clone().addScaledVector(right,.88*r),new Vector3(.18*r,.30*r,.14*r),rightEarOut,forward.clone().negate(),up.clone().negate(),.72),
    surface("backHead","head",head.clone().addScaledVector(forward,-.86*r),new Vector3(.50*r,.52*r,.18*r),forward.clone().negate(),right.clone().negate(),up.clone().negate(),.65),
    surface("neck","neck",torsoStart.clone().addScaledVector(up,.16*r).addScaledVector(forward,.30*r),new Vector3(.32*r,.36*r,.20*r),forward,right,up.clone().negate(),.75),
    surface("backNeck","neck",torsoStart.clone().addScaledVector(up,.08*r).addScaledVector(forward,-.28*r),new Vector3(.34*r,.34*r,.18*r),forward.clone().negate(),right.clone().negate(),up.clone().negate(),.62),
    surface("upperChest",torsoParent,torsoStart.clone().lerp(torsoEnd,.18).addScaledVector(forward,torsoRadius*.78),new Vector3(torsoRadius*.78,torsoRadius*.54,torsoRadius*.20),forward,right,up.clone().negate(),.82),
    surface("lowerChest",torsoParent,torsoStart.clone().lerp(torsoEnd,.45).addScaledVector(forward,torsoRadius*.78),new Vector3(torsoRadius*.84,torsoRadius*.52,torsoRadius*.20),forward,right,up.clone().negate(),.74),
    surface("abdomen",torsoParent,torsoStart.clone().lerp(torsoEnd,.72).addScaledVector(forward,torsoRadius*.74),new Vector3(torsoRadius*.78,torsoRadius*.52,torsoRadius*.20),forward,right,up.clone().negate(),.64),
    surface("leftShoulder","leftShoulder",vector(collision.arms.left.shoulderWorld).addScaledVector(leftShoulderOut,r*.20),new Vector3(r*.30,r*.30,r*.24),leftShoulderOut,forward,up.clone().negate(),.84),
    surface("rightShoulder","rightShoulder",vector(collision.arms.right.shoulderWorld).addScaledVector(rightShoulderOut,r*.20),new Vector3(r*.30,r*.30,r*.24),rightShoulderOut,forward.clone().negate(),up.clone().negate(),.84),
  ].every(Boolean);
  if(!ok)return null;

  // One anterior head surface owns cheek/forehead/chin continuity. Semantic labels select meaning,
  // while family UV selects a stable physical point on the avatar.
  const headCenterLocal=worldPointToLocal(profile,"head",head),headULocal=worldDirectionToLocal(profile,"head",right);
  const headVLocal=worldDirectionToLocal(profile,"head",up.clone().negate()),headOutLocal=worldDirectionToLocal(profile,"head",forward);
  if(!headCenterLocal||!headULocal||!headVLocal||!headOutLocal)return null;
  const physicalSurfaces:AvatarContactRig["physicalSurfaces"]={head:{family:"head",centerLocal:data(headCenterLocal),radii:{x:r*.94,y:r*1.07,z:r*.93},uAxisLocal:data(headULocal),vAxisLocal:data(headVLocal),outwardLocal:data(headOutLocal),parentJoint:"head",confidence:.95,uvScale:{x:.78,y:.86,z:1}}};

  const probes={} as AvatarContactRig["probes"];
  for(const side of ["left","right"] as const){
    const frame=hands[side].contactFrame!;
    probes[side]={
      palmCenter:{probe:"palmCenter",frameOffset:frame.probes!.palmCenter.offsetLocal,contactNormal:frame.probes!.palmCenter.normalLocal,tangentHint:frame.probes!.palmCenter.tangentLocal},
      radialEdge:{probe:"radialEdge",frameOffset:frame.probes!.radialEdge.offsetLocal,contactNormal:frame.probes!.radialEdge.normalLocal,tangentHint:frame.probes!.radialEdge.tangentLocal},
      ulnarEdge:{probe:"ulnarEdge",frameOffset:frame.probes!.ulnarEdge.offsetLocal,contactNormal:frame.probes!.ulnarEdge.normalLocal,tangentHint:frame.probes!.ulnarEdge.tangentLocal},
    };
    if(useMeshSurface)for(const name of ["palmCenter","radialEdge","ulnarEdge"] as const){const skin=profile.handSkinProbes?.[side]?.[name];if(skin)probes[side][name]={probe:name,frameOffset:skin.offsetLocal,contactNormal:skin.normalLocal,tangentHint:skin.tangentLocal};}
  }
  return{modelGeneration:profile.modelGeneration,modelFingerprint:profile.modelFingerprint,surfaces,probes,physicalSurfaces,...(useMeshSurface&&profile.faceSurface?{faceSurface:profile.faceSurface}:{})};
}
