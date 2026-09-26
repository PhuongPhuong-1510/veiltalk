import { Vector3 } from "three";
import type { BodyContactRegion, HandContactProbe } from "./bodyContactTypes";
import type { Vector3Data } from "./avatarPoseTypes";
import type { NormalizedAvatarRigProfile } from "./normalizedRigProfile";

export interface AvatarContactSurface {region:BodyContactRegion;center:Vector3Data;radii:Vector3Data;right:Vector3Data;up:Vector3Data;forward:Vector3Data;parent:"head"|"torso"|"leftShoulder"|"rightShoulder";confidence:number}
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
  const surface=(region:BodyContactRegion,center:Vector3,radii:Vector3,parent:AvatarContactSurface["parent"],confidence=1):AvatarContactSurface=>({region,center:data(center),radii:data(radii),right:data(right),up:data(up),forward:data(forward),parent,confidence});
  const backSurface=(region:BodyContactRegion,center:Vector3,radii:Vector3,parent:AvatarContactSurface["parent"],confidence:number):AvatarContactSurface=>({region,center:data(center),radii:data(radii),right:data(right.clone().negate()),up:data(up),forward:data(forward.clone().negate()),parent,confidence});
  const surfaces={} as AvatarContactRig["surfaces"];
  surfaces.headTop=surface("headTop",head.clone().addScaledVector(up,.82*r),new Vector3(.48*r,.25*r,.48*r),"head");
  surfaces.forehead=surface("forehead",head.clone().addScaledVector(up,.28*r).addScaledVector(forward,.72*r),new Vector3(.42*r,.28*r,.18*r),"head");
  surfaces.leftCheek=surface("leftCheek",head.clone().addScaledVector(right,-.52*r).addScaledVector(forward,.48*r),new Vector3(.28*r,.35*r,.18*r),"head");
  surfaces.rightCheek=surface("rightCheek",head.clone().addScaledVector(right,.52*r).addScaledVector(forward,.48*r),new Vector3(.28*r,.35*r,.18*r),"head");
  surfaces.mouth=surface("mouth",head.clone().addScaledVector(up,-.32*r).addScaledVector(forward,.76*r),new Vector3(.28*r,.14*r,.14*r),"head");
  surfaces.chin=surface("chin",head.clone().addScaledVector(up,-.65*r).addScaledVector(forward,.42*r),new Vector3(.32*r,.2*r,.2*r),"head");
  surfaces.leftEar=surface("leftEar",head.clone().addScaledVector(right,-.82*r),new Vector3(.13*r,.3*r,.16*r),"head",.75);
  surfaces.rightEar=surface("rightEar",head.clone().addScaledVector(right,.82*r),new Vector3(.13*r,.3*r,.16*r),"head",.75);
  surfaces.backHead=backSurface("backHead",head.clone().addScaledVector(forward,-.72*r),new Vector3(.5*r,.55*r,.18*r),"head",.55);
  surfaces.neck=surface("neck",torsoStart.clone().addScaledVector(up,.2*r),new Vector3(.32*r,.36*r,.3*r),"torso",.75);
  surfaces.backNeck=backSurface("backNeck",torsoStart.clone().addScaledVector(up,.05*r).addScaledVector(forward,-.35*r),new Vector3(.34*r,.34*r,.18*r),"torso",.55);
  surfaces.upperChest=surface("upperChest",torsoStart.clone().lerp(torsoEnd,.18).addScaledVector(forward,collision.torso.radius*.7),new Vector3(collision.torso.radius*.75,collision.torso.radius*.5,collision.torso.radius*.2),"torso",.8);
  surfaces.lowerChest=surface("lowerChest",torsoStart.clone().lerp(torsoEnd,.45).addScaledVector(forward,collision.torso.radius*.72),new Vector3(collision.torso.radius*.82,collision.torso.radius*.48,collision.torso.radius*.2),"torso",.72);
  surfaces.abdomen=surface("abdomen",torsoStart.clone().lerp(torsoEnd,.72).addScaledVector(forward,collision.torso.radius*.7),new Vector3(collision.torso.radius*.76,collision.torso.radius*.5,collision.torso.radius*.2),"torso",.62);
  for(const side of ["left","right"] as const){const center=new Vector3(collision.arms[side].shoulderWorld.x,collision.arms[side].shoulderWorld.y,collision.arms[side].shoulderWorld.z);surfaces[`${side}Shoulder`]=surface(`${side}Shoulder`,center,new Vector3(r*.28,r*.28,r*.28),`${side}Shoulder`,.82);}
  const probes={} as AvatarContactRig["probes"];
  for(const side of ["left","right"] as const){const frame=profile.hands?.[side].contactFrame,handScale=collision.arms[side].radius*2.4,across=new Vector3(frame?.acrossLocal.x??(side==="left"?-1:1),frame?.acrossLocal.y??0,frame?.acrossLocal.z??0).normalize(),forwardLocal=new Vector3(frame?.forwardLocal.x??0,frame?.forwardLocal.y??1,frame?.forwardLocal.z??0).normalize(),normal=new Vector3(frame?.normalLocal.x??0,frame?.normalLocal.y??0,frame?.normalLocal.z??1).normalize(),width=frame?.palmWidth??handScale,length=frame?.palmLength??handScale*1.4,palm=forwardLocal.clone().multiplyScalar(length*.45),radial=palm.clone().addScaledVector(across,width*.42),ulnar=palm.clone().addScaledVector(across,-width*.42);probes[side]={
    palmCenter:{probe:"palmCenter",frameOffset:data(palm),contactNormal:data(normal),tangentHint:data(forwardLocal)},
    radialEdge:{probe:"radialEdge",frameOffset:data(radial),contactNormal:data(across),tangentHint:data(forwardLocal)},
    ulnarEdge:{probe:"ulnarEdge",frameOffset:data(ulnar),contactNormal:data(across.clone().negate()),tangentHint:data(forwardLocal)},
  };}
  return{modelGeneration:profile.modelGeneration,modelFingerprint:profile.modelFingerprint,surfaces,probes};
}
