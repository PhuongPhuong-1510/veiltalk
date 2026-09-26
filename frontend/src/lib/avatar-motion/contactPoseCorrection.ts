import { Quaternion,Vector3 } from "three";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { AvatarJointName,AvatarPoseJointNameV2,QuaternionData,Vector3Data } from "./avatarPoseTypes";
import type { ArmSide } from "./avatarMotionDiagnostics";
import type { AvatarContactRig } from "./avatarContactRig";
import type { AvatarContactAnchor } from "./contactAnchorMapping";
import { solveContactWristTarget } from "./contactWristTarget";
import { solveContactArmIk } from "./contactArmIk";
import { solveParentLocalArmRotations } from "./jointSolver";
import type { NormalizedAvatarRigProfile } from "./normalizedRigProfile";
import { capsuleCapsulePenetration,capsuleSpherePenetration } from "./contactCollision";

export interface ContactPoseCorrection {rotations:Partial<Record<AvatarJointName,QuaternionData>>;anchorError:number;normalErrorRadians:number;reachRatio:number;projected:boolean;accepted:boolean;reason:"none"|"missing-contact-rig"|"invalid-target"|"unreachable-contact"|"unsafe-angular-jump"|"collision-unsatisfied"}
const multiply=(a:QuaternionData,b:QuaternionData):QuaternionData=>({x:a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,y:a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,z:a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z});
const inverse=(q:QuaternionData):QuaternionData=>({x:-q.x,y:-q.y,z:-q.z,w:q.w});
const qData=(q:Quaternion):QuaternionData=>({x:q.x,y:q.y,z:q.z,w:q.w});
const data=(value:Vector3):Vector3Data=>({x:value.x,y:value.y,z:value.z});
const lm=(v:Vector3):RawNormalizedLandmarkV1=>({x:v.x,y:v.y,z:v.z,visibility:1});
const angularDelta=(a:QuaternionData|undefined,b:QuaternionData)=>{const qa=new Quaternion(a?.x??0,a?.y??0,a?.z??0,a?.w??1).normalize(),qb=new Quaternion(b.x,b.y,b.z,b.w).normalize();return 2*Math.acos(Math.min(1,Math.abs(qa.dot(qb))));};
const worldDelta=(delta:QuaternionData|undefined,parentRestWorld:QuaternionData)=>{if(!delta)return new Quaternion();const parent=new Quaternion(parentRestWorld.x,parentRestWorld.y,parentRestWorld.z,parentRestWorld.w).normalize();return parent.clone().multiply(new Quaternion(delta.x,delta.y,delta.z,delta.w).normalize()).multiply(parent.clone().invert()).normalize();};

function currentElbowPole(profile:NormalizedAvatarRigProfile,side:ArmSide,baseline:Partial<Record<AvatarPoseJointNameV2,QuaternionData>>,shoulder:Vector3,wristTarget:Vector3):Vector3{
  const upperName=`${side}UpperArm` as const,upper=profile.joints[upperName],arm=profile.collisionReference!.arms[side];
  const restDirection=new Vector3(upper.restWorldDirection.x,upper.restWorldDirection.y,upper.restWorldDirection.z);
  const restWorld=new Quaternion(upper.restWorldRotation.x,upper.restWorldRotation.y,upper.restWorldRotation.z,upper.restWorldRotation.w),delta=baseline[upperName],shoulderDelta=baseline[`${side}Shoulder`];
  if(delta||shoulderDelta){const parentRest=new Quaternion(upper.parentRestWorldRotation.x,upper.parentRestWorldRotation.y,upper.parentRestWorldRotation.z,upper.parentRestWorldRotation.w),restLocal=new Quaternion(upper.restLocalRotation.x,upper.restLocalRotation.y,upper.restLocalRotation.z,upper.restLocalRotation.w),targetWorld=parentRest.multiply(quaternionOrIdentity(shoulderDelta)).multiply(restLocal).multiply(quaternionOrIdentity(delta)).normalize(),worldChange=targetWorld.multiply(restWorld.clone().invert());restDirection.applyQuaternion(worldChange);}
  const elbow=shoulder.clone().addScaledVector(restDirection.normalize(),arm.upperLength),axis=wristTarget.clone().sub(shoulder).normalize(),shoulderToElbow=elbow.sub(shoulder);
  const pole=shoulderToElbow.clone().addScaledVector(axis,-shoulderToElbow.dot(axis));
  if(pole.lengthSq()>1e-8)return pole.normalize();
  return new Vector3(profile.torsoReference.upWorld.x,profile.torsoReference.upWorld.y,profile.torsoReference.upWorld.z);
}
function quaternionOrIdentity(value:QuaternionData|undefined):Quaternion{return value?new Quaternion(value.x,value.y,value.z,value.w).normalize():new Quaternion();}

export function solveContactPoseCorrection(profile:NormalizedAvatarRigProfile,contactRig:AvatarContactRig,side:ArmSide,anchor:AvatarContactAnchor,probeName:"palmCenter"|"radialEdge"|"ulnarEdge",baseline:Partial<Record<AvatarPoseJointNameV2,QuaternionData>>={},maximumReachErrorRatio=.12):ContactPoseCorrection{
  const hand=profile.hands?.[side],collision=profile.collisionReference,arm=collision?.arms[side];if(!hand||!arm||!collision)return{rotations:{},anchorError:Infinity,normalErrorRadians:Infinity,reachRatio:Infinity,projected:false,accepted:false,reason:"missing-contact-rig"};
  const wristTarget=solveContactWristTarget(anchor,contactRig.probes[side][probeName]);if(!wristTarget)return{rotations:{},anchorError:Infinity,normalErrorRadians:Infinity,reachRatio:Infinity,projected:false,accepted:false,reason:"invalid-target"};
  const torsoPivot=new Vector3(collision.torso.endWorld.x,collision.torso.endWorld.y,collision.torso.endWorld.z),torsoRotation=worldDelta(baseline.upperChest??baseline.chest??baseline.spine??baseline.hips,profile.torsoReference.worldRotation);
  const shoulder=new Vector3(arm.shoulderWorld.x,arm.shoulderWorld.y,arm.shoulderWorld.z).sub(torsoPivot).applyQuaternion(torsoRotation).add(torsoPivot),target=new Vector3(wristTarget.wrist.x,wristTarget.wrist.y,wristTarget.wrist.z),preferredPole=currentElbowPole(profile,side,baseline,shoulder,target);
  const ik=solveContactArmIk({shoulder:data(shoulder),wristTarget:wristTarget.wrist,upperLength:arm.upperLength,lowerLength:arm.lowerLength,preferredPole:data(preferredPole)});if(!ik)return{rotations:{},anchorError:Infinity,normalErrorRadians:Infinity,reachRatio:Infinity,projected:false,accepted:false,reason:"invalid-target"};
  const reachErrorRatio=ik.targetError/Math.max(1e-6,arm.upperLength+arm.lowerLength);if(reachErrorRatio>maximumReachErrorRatio)return{rotations:{},anchorError:ik.targetError,normalErrorRadians:wristTarget.normalErrorRadians,reachRatio:ik.reachRatio,projected:ik.projected,accepted:false,reason:"unreachable-contact"};
  const head=collision.head,torso=collision.torso,lowerCapsule={start:ik.elbow,end:ik.wrist,radius:arm.radius};
  const headPenetration=capsuleSpherePenetration(lowerCapsule,{center:head.centerWorld,radius:head.radius}).penetration,torsoPenetration=capsuleCapsulePenetration(lowerCapsule,{start:torso.startWorld,end:torso.endWorld,radius:torso.radius}).penetration;
  const targetsHead=anchor.parent==="head",targetsTorso=anchor.parent==="torso"||anchor.parent==="leftShoulder"||anchor.parent==="rightShoulder";
  if((headPenetration>arm.radius*(targetsHead?1.75:.5))||(torsoPenetration>arm.radius*(targetsTorso?1.75:.5)))return{rotations:{},anchorError:ik.targetError,normalErrorRadians:wristTarget.normalErrorRadians,reachRatio:ik.reachRatio,projected:ik.projected,accepted:false,reason:"collision-unsatisfied"};
  const landmarks=Array.from({length:33},()=>lm(new Vector3()));const indices=side==="left"?[11,13,15]:[12,14,16];landmarks[indices[0]]=lm(new Vector3(ik.shoulder.x,ik.shoulder.y,ik.shoulder.z));landmarks[indices[1]]=lm(new Vector3(ik.elbow.x,ik.elbow.y,ik.elbow.z));landmarks[indices[2]]=lm(new Vector3(ik.wrist.x,ik.wrist.y,ik.wrist.z));
  const solved=solveParentLocalArmRotations(landmarks,profile,true),upperName=`${side}UpperArm` as const,lowerName=`${side}LowerArm` as const,handName=`${side}Hand` as const;
  const lowerWorld=solved.targetWorldRotations[lowerName];if(!lowerWorld)return{rotations:{},anchorError:Infinity,normalErrorRadians:Infinity,reachRatio:ik.reachRatio,projected:ik.projected,accepted:false,reason:"invalid-target"};
  const desiredHandWorld=wristTarget.orientation,targetHandLocal=multiply(inverse(lowerWorld),desiredHandWorld),handDelta=multiply(inverse(hand.restLocalRotation),targetHandLocal);
  const normalized=qData(new Quaternion(handDelta.x,handDelta.y,handDelta.z,handDelta.w).normalize());
  if((baseline[upperName]&&angularDelta(baseline[upperName],solved.deltas[upperName]!)>75*Math.PI/180)||(baseline[lowerName]&&angularDelta(baseline[lowerName],solved.deltas[lowerName]!)>95*Math.PI/180)||(baseline[handName]&&angularDelta(baseline[handName],normalized)>110*Math.PI/180))return{rotations:{},anchorError:ik.targetError,normalErrorRadians:wristTarget.normalErrorRadians,reachRatio:ik.reachRatio,projected:ik.projected,accepted:false,reason:"unsafe-angular-jump"};
  return{rotations:{[upperName]:solved.deltas[upperName]!,[lowerName]:solved.deltas[lowerName]!,[handName]:normalized},anchorError:ik.targetError,normalErrorRadians:wristTarget.normalErrorRadians,reachRatio:ik.reachRatio,projected:ik.projected,accepted:true,reason:"none"};
}
