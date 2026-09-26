import { Quaternion,Vector3 } from "three";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { AvatarJointName,QuaternionData } from "./avatarPoseTypes";
import type { ArmSide } from "./avatarMotionDiagnostics";
import type { AvatarContactRig } from "./avatarContactRig";
import type { AvatarContactAnchor } from "./contactAnchorMapping";
import { solveContactWristTarget } from "./contactWristTarget";
import { solveContactArmIk } from "./contactArmIk";
import { solveParentLocalArmRotations } from "./jointSolver";
import type { NormalizedAvatarRigProfile } from "./normalizedRigProfile";

export interface ContactPoseCorrection {rotations:Partial<Record<AvatarJointName,QuaternionData>>;anchorError:number;normalErrorRadians:number;reachRatio:number;projected:boolean;accepted:boolean;reason:"none"|"missing-contact-rig"|"invalid-target"|"unreachable-contact"}
const multiply=(a:QuaternionData,b:QuaternionData):QuaternionData=>({x:a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,y:a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,z:a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z});
const inverse=(q:QuaternionData):QuaternionData=>({x:-q.x,y:-q.y,z:-q.z,w:q.w});
const qData=(q:Quaternion):QuaternionData=>({x:q.x,y:q.y,z:q.z,w:q.w});
const lm=(v:Vector3):RawNormalizedLandmarkV1=>({x:v.x,y:v.y,z:v.z,visibility:1});

export function solveContactPoseCorrection(profile:NormalizedAvatarRigProfile,contactRig:AvatarContactRig,side:ArmSide,anchor:AvatarContactAnchor,probeName:"palmCenter"|"radialEdge"|"ulnarEdge",maximumReachErrorRatio=.12):ContactPoseCorrection{
  const hand=profile.hands?.[side],arm=profile.collisionReference?.arms[side];if(!hand||!arm)return{rotations:{},anchorError:Infinity,normalErrorRadians:Infinity,reachRatio:Infinity,projected:false,accepted:false,reason:"missing-contact-rig"};
  const wristTarget=solveContactWristTarget(anchor,contactRig.probes[side][probeName]);if(!wristTarget)return{rotations:{},anchorError:Infinity,normalErrorRadians:Infinity,reachRatio:Infinity,projected:false,accepted:false,reason:"invalid-target"};
  const ik=solveContactArmIk({shoulder:arm.shoulderWorld,wristTarget:wristTarget.wrist,upperLength:arm.upperLength,lowerLength:arm.lowerLength,preferredPole:profile.torsoReference.upWorld});if(!ik)return{rotations:{},anchorError:Infinity,normalErrorRadians:Infinity,reachRatio:Infinity,projected:false,accepted:false,reason:"invalid-target"};
  const reachErrorRatio=ik.targetError/Math.max(1e-6,arm.upperLength+arm.lowerLength);if(reachErrorRatio>maximumReachErrorRatio)return{rotations:{},anchorError:ik.targetError,normalErrorRadians:wristTarget.normalErrorRadians,reachRatio:ik.reachRatio,projected:ik.projected,accepted:false,reason:"unreachable-contact"};
  const landmarks=Array.from({length:33},()=>lm(new Vector3()));const indices=side==="left"?[11,13,15]:[12,14,16];landmarks[indices[0]]=lm(new Vector3(ik.shoulder.x,ik.shoulder.y,ik.shoulder.z));landmarks[indices[1]]=lm(new Vector3(ik.elbow.x,ik.elbow.y,ik.elbow.z));landmarks[indices[2]]=lm(new Vector3(ik.wrist.x,ik.wrist.y,ik.wrist.z));
  const solved=solveParentLocalArmRotations(landmarks,profile,true),upperName=`${side}UpperArm` as const,lowerName=`${side}LowerArm` as const,handName=`${side}Hand` as const;
  const lowerWorld=solved.targetWorldRotations[lowerName];if(!lowerWorld)return{rotations:{},anchorError:Infinity,normalErrorRadians:Infinity,reachRatio:ik.reachRatio,projected:ik.projected,accepted:false,reason:"invalid-target"};
  const desiredHandWorld=wristTarget.orientation,targetHandLocal=multiply(inverse(lowerWorld),desiredHandWorld),handDelta=multiply(inverse(hand.restLocalRotation),targetHandLocal);
  const normalized=qData(new Quaternion(handDelta.x,handDelta.y,handDelta.z,handDelta.w).normalize());
  return{rotations:{[upperName]:solved.deltas[upperName]!,[lowerName]:solved.deltas[lowerName]!,[handName]:normalized},anchorError:ik.targetError,normalErrorRadians:wristTarget.normalErrorRadians,reachRatio:ik.reachRatio,projected:ik.projected,accepted:true,reason:"none"};
}
