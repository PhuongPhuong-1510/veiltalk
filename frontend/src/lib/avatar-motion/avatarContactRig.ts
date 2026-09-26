import { Vector3 } from "three";
import type { BodyContactRegion, HandContactProbe } from "./bodyContactTypes";
import type { Vector3Data } from "./avatarPoseTypes";
import type { NormalizedAvatarRigProfile } from "./normalizedRigProfile";

export interface AvatarContactSurface {region:BodyContactRegion;center:Vector3Data;radii:Vector3Data;parent:"head"|"torso"|"leftShoulder"|"rightShoulder";confidence:number}
export interface AvatarProbeProfile {probe:HandContactProbe;frameOffset:Vector3Data;contactNormal:Vector3Data;tangentHint:Vector3Data}
export interface AvatarContactRig {modelGeneration:number;modelFingerprint:string;surfaces:Record<BodyContactRegion,AvatarContactSurface>;probes:Record<"left"|"right",Record<HandContactProbe,AvatarProbeProfile>>}
const data=(v:Vector3):Vector3Data=>({x:v.x,y:v.y,z:v.z});

export function buildAvatarContactRig(profile:NormalizedAvatarRigProfile):AvatarContactRig|null{
  const collision=profile.collisionReference;if(!collision)return null;
  const up=new Vector3(profile.torsoReference.upWorld.x,profile.torsoReference.upWorld.y,profile.torsoReference.upWorld.z).normalize();
  const right=new Vector3(profile.torsoReference.rightWorld.x,profile.torsoReference.rightWorld.y,profile.torsoReference.rightWorld.z).normalize();
  const forward=new Vector3(profile.torsoReference.forwardWorld.x,profile.torsoReference.forwardWorld.y,profile.torsoReference.forwardWorld.z).normalize();
  const head=new Vector3(collision.head.centerWorld.x,collision.head.centerWorld.y,collision.head.centerWorld.z),r=collision.head.radius;
  const torsoStart=new Vector3(collision.torso.startWorld.x,collision.torso.startWorld.y,collision.torso.startWorld.z),torsoEnd=new Vector3(collision.torso.endWorld.x,collision.torso.endWorld.y,collision.torso.endWorld.z);
  const surface=(region:BodyContactRegion,center:Vector3,radii:Vector3,parent:AvatarContactSurface["parent"],confidence=1):AvatarContactSurface=>({region,center:data(center),radii:data(radii),parent,confidence});
  const surfaces={} as AvatarContactRig["surfaces"];
  surfaces.headTop=surface("headTop",head.clone().addScaledVector(up,.82*r),new Vector3(.48*r,.25*r,.48*r),"head");
  surfaces.forehead=surface("forehead",head.clone().addScaledVector(up,.28*r).addScaledVector(forward,.72*r),new Vector3(.42*r,.28*r,.18*r),"head");
  surfaces.leftCheek=surface("leftCheek",head.clone().addScaledVector(right,-.52*r).addScaledVector(forward,.48*r),new Vector3(.28*r,.35*r,.18*r),"head");
  surfaces.rightCheek=surface("rightCheek",head.clone().addScaledVector(right,.52*r).addScaledVector(forward,.48*r),new Vector3(.28*r,.35*r,.18*r),"head");
  surfaces.chin=surface("chin",head.clone().addScaledVector(up,-.65*r).addScaledVector(forward,.42*r),new Vector3(.32*r,.2*r,.2*r),"head");
  surfaces.neck=surface("neck",torsoStart.clone().addScaledVector(up,.2*r),new Vector3(.32*r,.36*r,.3*r),"torso",.75);
  surfaces.upperChest=surface("upperChest",torsoStart.clone().lerp(torsoEnd,.18).addScaledVector(forward,collision.torso.radius*.7),new Vector3(collision.torso.radius*.75,collision.torso.radius*.5,collision.torso.radius*.2),"torso",.8);
  for(const side of ["left","right"] as const){const center=new Vector3(collision.arms[side].shoulderWorld.x,collision.arms[side].shoulderWorld.y,collision.arms[side].shoulderWorld.z);surfaces[`${side}Shoulder`]=surface(`${side}Shoulder`,center,new Vector3(r*.28,r*.28,r*.28),`${side}Shoulder`,.82);}
  const probes={} as AvatarContactRig["probes"];
  for(const side of ["left","right"] as const){const handScale=collision.arms[side].radius*2.4,sign=side==="left"?-1:1;probes[side]={
    palmCenter:{probe:"palmCenter",frameOffset:{x:0,y:handScale*.7,z:0},contactNormal:{x:0,y:0,z:1},tangentHint:{x:0,y:1,z:0}},
    radialEdge:{probe:"radialEdge",frameOffset:{x:sign*handScale*.45,y:handScale*.45,z:0},contactNormal:{x:sign,y:0,z:0},tangentHint:{x:0,y:1,z:0}},
    ulnarEdge:{probe:"ulnarEdge",frameOffset:{x:-sign*handScale*.45,y:handScale*.45,z:0},contactNormal:{x:-sign,y:0,z:0},tangentHint:{x:0,y:1,z:0}},
  };}
  return{modelGeneration:profile.modelGeneration,modelFingerprint:profile.modelFingerprint,surfaces,probes};
}
