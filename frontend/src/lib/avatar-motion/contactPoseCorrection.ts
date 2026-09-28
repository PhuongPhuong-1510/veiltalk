import { Quaternion,Vector3 } from "three";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { AvatarJointName,AvatarPoseJointNameV2,QuaternionData,Vector3Data } from "./avatarPoseTypes";
import type { ArmSide } from "./avatarMotionDiagnostics";
import type { AvatarContactRig } from "./avatarContactRig";
import type { AvatarContactAnchor } from "./contactAnchorMapping";
import { solveContactWristTarget } from "./contactWristTarget";
import { solveContactArmIk,type ContactReachProjection } from "./contactArmIk";
import { solveParentLocalArmRotations } from "./jointSolver";
import type { ContactBodyJointName,NormalizedAvatarRigProfile } from "./normalizedRigProfile";
import { capsuleCapsulePenetration,capsuleSpherePenetration } from "./contactCollision";
import { getPosedContactJointTransform,poseContactRestWorldPoint } from "./posedContactAnchor";

export type ContactPoseCorrectionReason =
  | "none"
  | "missing-contact-rig"
  | "invalid-target"
  | "reach-degraded"
  | "collision-degraded"
  | "kinematic-degraded"
  | "multi-degraded";

export interface ContactPoseCorrection {
  rotations:Partial<Record<AvatarJointName,QuaternionData>>;
  /** Probe-to-anchor error after joint constraints, before runtime blend/rate-limit. */
  anchorError:number;
  normalErrorRadians:number;
  reachRatio:number;
  projected:boolean;
  projection:ContactReachProjection;
  targetDistance:number;
  minReach:number;
  maxReach:number;
  reachErrorRatio:number;
  reachQuality:number;
  headPenetration:number;
  torsoPenetration:number;
  collisionQuality:number;
  /** Suppresses large solver departures from the faithful baseline without a binary reject. */
  kinematicQuality:number;
  /** Multiplied with the temporal contact influence by ContactRuntime. */
  influenceScale:number;
  angularDeltaDegrees:{upper:number;lower:number;hand:number};
  accepted:boolean;
  reason:ContactPoseCorrectionReason;
}

const multiply=(a:QuaternionData,b:QuaternionData):QuaternionData=>({x:a.w*b.x+a.x*b.w+a.y*b.z-a.z*b.y,y:a.w*b.y-a.x*b.z+a.y*b.w+a.z*b.x,z:a.w*b.z+a.x*b.y-a.y*b.x+a.z*b.w,w:a.w*b.w-a.x*b.x-a.y*b.y-a.z*b.z});
const inverse=(q:QuaternionData):QuaternionData=>({x:-q.x,y:-q.y,z:-q.z,w:q.w});
const qData=(q:Quaternion):QuaternionData=>({x:q.x,y:q.y,z:q.z,w:q.w});
const data=(value:Vector3):Vector3Data=>({x:value.x,y:value.y,z:value.z});
const lm=(v:Vector3):RawNormalizedLandmarkV1=>({x:v.x,y:v.y,z:v.z,visibility:1});
const angularDelta=(a:QuaternionData|undefined,b:QuaternionData)=>{const qa=new Quaternion(a?.x??0,a?.y??0,a?.z??0,a?.w??1).normalize(),qb=new Quaternion(b.x,b.y,b.z,b.w).normalize();return 2*Math.acos(Math.min(1,Math.abs(qa.dot(qb))));};
const quaternionOrIdentity=(value:QuaternionData|undefined)=>value?new Quaternion(value.x,value.y,value.z,value.w).normalize():new Quaternion();
const clamp01=(value:number)=>Math.max(0,Math.min(1,value));
const smoothstep=(a:number,b:number,x:number)=>{const t=clamp01((x-a)/Math.max(1e-8,b-a));return t*t*(3-2*t);};
const finite=(...values:number[])=>values.every(Number.isFinite);

const rejected=(reason:"missing-contact-rig"|"invalid-target"):ContactPoseCorrection=>({
  rotations:{},anchorError:Infinity,normalErrorRadians:Infinity,reachRatio:Infinity,projected:false,projection:"none",
  targetDistance:Infinity,minReach:0,maxReach:0,reachErrorRatio:Infinity,reachQuality:0,
  headPenetration:Infinity,torsoPenetration:Infinity,collisionQuality:0,kinematicQuality:0,influenceScale:0,
  angularDeltaDegrees:{upper:0,lower:0,hand:0},accepted:false,reason,
});

function currentElbowPole(
  profile:NormalizedAvatarRigProfile,side:ArmSide,baseline:Partial<Record<AvatarPoseJointNameV2,QuaternionData>>,
  shoulder:Vector3,wristTarget:Vector3,headRotation:QuaternionData|null,
):Vector3{
  const upperName=`${side}UpperArm` as const,upper=profile.joints[upperName],arm=profile.collisionReference!.arms[side];
  const shoulderTransform=getPosedContactJointTransform(profile,`${side}Shoulder` as ContactBodyJointName,baseline,headRotation);
  let direction=new Vector3(upper.restWorldDirection.x,upper.restWorldDirection.y,upper.restWorldDirection.z).normalize();
  if(shoulderTransform){
    const primaryLocal=new Vector3(upper.anatomicalRestBasis.primaryLocal.x,upper.anatomicalRestBasis.primaryLocal.y,upper.anatomicalRestBasis.primaryLocal.z);
    const upperWorld=shoulderTransform.rotation.clone().multiply(new Quaternion(upper.restLocalRotation.x,upper.restLocalRotation.y,upper.restLocalRotation.z,upper.restLocalRotation.w)).multiply(quaternionOrIdentity(baseline[upperName])).normalize();
    direction=primaryLocal.applyQuaternion(upperWorld).normalize();
  }
  const elbow=shoulder.clone().addScaledVector(direction,arm.upperLength),axis=wristTarget.clone().sub(shoulder).normalize(),shoulderToElbow=elbow.sub(shoulder);
  const pole=shoulderToElbow.clone().addScaledVector(axis,-shoulderToElbow.dot(axis));
  if(pole.lengthSq()>1e-8)return pole.normalize();
  return new Vector3(profile.torsoReference.upWorld.x,profile.torsoReference.upWorld.y,profile.torsoReference.upWorld.z).normalize();
}

/**
 * Contact-aware arm correction with fail-soft reach/collision handling.
 *
 * Geometry/rig failures still reject. Ordinary reach mismatch, penetration, or a large angular
 * difference do NOT discard the solution: they reduce influence while ContactRuntime rate-limits
 * the actual joint motion. This prevents the old all-or-nothing fallback to the baseline pose.
 */
export function solveContactPoseCorrection(
  profile:NormalizedAvatarRigProfile,contactRig:AvatarContactRig,side:ArmSide,anchor:AvatarContactAnchor,
  probeName:"palmCenter"|"radialEdge"|"ulnarEdge",baseline:Partial<Record<AvatarPoseJointNameV2,QuaternionData>>={},
  headRotation:QuaternionData|null=null,
  /** Reach error at which the projected solution fades to zero influence. */
  maximumReachErrorRatio=.24,
):ContactPoseCorrection{
  const hand=profile.hands?.[side],collision=profile.collisionReference,arm=collision?.arms[side];
  if(!hand?.contactFrame?.probes||!arm||!collision||!profile.contactSkeleton)return rejected("missing-contact-rig");

  const wristTarget=solveContactWristTarget(anchor,contactRig.probes[side][probeName]);
  if(!wristTarget)return rejected("invalid-target");

  const shoulderParent=`${side}Shoulder` as ContactBodyJointName;
  const shoulderTransform=getPosedContactJointTransform(profile,shoulderParent,baseline,headRotation);
  const shoulder=poseContactRestWorldPoint(profile,shoulderParent,arm.shoulderWorld,baseline,headRotation);
  if(!shoulder||!shoulderTransform)return rejected("missing-contact-rig");

  const target=new Vector3(wristTarget.wrist.x,wristTarget.wrist.y,wristTarget.wrist.z);
  const preferredPole=currentElbowPole(profile,side,baseline,shoulder,target,headRotation);
  const ik=solveContactArmIk({shoulder:data(shoulder),wristTarget:wristTarget.wrist,upperLength:arm.upperLength,lowerLength:arm.lowerLength,preferredPole:data(preferredPole)});
  if(!ik)return rejected("invalid-target");

  // Exact/near-exact reaches receive full weight. Projected targets fade continuously instead of
  // being rejected at a single threshold.
  const reachSoftRatio=.015;
  const reachQuality=1-smoothstep(reachSoftRatio,Math.max(reachSoftRatio+.001,maximumReachErrorRatio),ik.reachErrorRatio);

  const headCenter=poseContactRestWorldPoint(profile,"head",collision.head.centerWorld,baseline,headRotation);
  const torsoStartParent:ContactBodyJointName=profile.contactSkeleton.joints.upperChest?"upperChest":profile.contactSkeleton.joints.chest?"chest":profile.contactSkeleton.joints.spine?"spine":"hips";
  const torsoStart=poseContactRestWorldPoint(profile,torsoStartParent,collision.torso.startWorld,baseline,headRotation);
  const torsoEnd=poseContactRestWorldPoint(profile,profile.contactSkeleton.joints.hips?"hips":torsoStartParent,collision.torso.endWorld,baseline,headRotation);
  if(!headCenter||!torsoStart||!torsoEnd)return rejected("missing-contact-rig");

  const lowerCapsule={start:ik.elbow,end:ik.wrist,radius:arm.radius};
  const headResult=capsuleSpherePenetration(lowerCapsule,{center:data(headCenter),radius:collision.head.radius});
  const torsoResult=capsuleCapsulePenetration(lowerCapsule,{start:data(torsoStart),end:data(torsoEnd),radius:collision.torso.radius});
  if(!headResult.valid||!torsoResult.valid||!finite(headResult.penetration,torsoResult.penetration))return rejected("invalid-target");

  const targetsHead=anchor.parentJoint==="head";
  const targetsTorso=anchor.parentJoint==="hips"||anchor.parentJoint==="spine"||anchor.parentJoint==="chest"||anchor.parentJoint==="upperChest"||anchor.parentJoint==="leftShoulder"||anchor.parentJoint==="rightShoulder";
  const penetrationQuality=(penetration:number,targetBody:boolean)=>{
    // Intentional contact naturally places the forearm closer to the target body than an ordinary
    // arm pose. Give it a wider free band, then fade instead of hard-rejecting the entire contact.
    const soft=arm.radius*(targetBody?1.25:.25);
    const hard=arm.radius*(targetBody?2.9:1.25);
    return 1-smoothstep(soft,Math.max(soft+1e-6,hard),penetration);
  };
  const headQuality=penetrationQuality(headResult.penetration,targetsHead);
  const torsoQuality=penetrationQuality(torsoResult.penetration,targetsTorso);
  const collisionQuality=Math.min(headQuality,torsoQuality);

  const landmarks=Array.from({length:33},()=>lm(new Vector3()));
  const indices=side==="left"?[11,13,15]:[12,14,16];
  landmarks[indices[0]]=lm(new Vector3(ik.shoulder.x,ik.shoulder.y,ik.shoulder.z));
  landmarks[indices[1]]=lm(new Vector3(ik.elbow.x,ik.elbow.y,ik.elbow.z));
  landmarks[indices[2]]=lm(new Vector3(ik.wrist.x,ik.wrist.y,ik.wrist.z));

  // Use the CURRENT posed shoulder world rotation when converting IK geometry back into
  // parent-local deltas. The old path always used parentRestWorldRotation, which becomes wrong
  // as soon as torso/shoulder animation is active.
  const solved=solveParentLocalArmRotations(
    landmarks,profile,true,undefined,{fixedParentWorldRotations:{[shoulderParent]:qData(shoulderTransform.rotation)}},
  ),upperName=`${side}UpperArm` as const,lowerName=`${side}LowerArm` as const,handName=`${side}Hand` as const;
  const upperWorld=solved.targetWorldRotations[upperName],lowerWorld=solved.targetWorldRotations[lowerName];
  if(!upperWorld||!lowerWorld||!solved.deltas[upperName]||!solved.deltas[lowerName])return rejected("invalid-target");

  const desiredHandWorld=wristTarget.orientation;
  const targetHandLocal=multiply(inverse(lowerWorld),desiredHandWorld);
  const handDelta=multiply(inverse(hand.restLocalRotation),targetHandLocal);
  const normalized=qData(new Quaternion(handDelta.x,handDelta.y,handDelta.z,handDelta.w).normalize());
  if(!finite(normalized.x,normalized.y,normalized.z,normalized.w))return rejected("invalid-target");

  // Forward-kinematics validation AFTER joint constraints. Analytic IK may hit the requested wrist
  // exactly, but constrained local deltas can move the rendered wrist/probe away from that target.
  // Diagnostics must report the pose that the renderer can actually reproduce, not pre-constraint IK.
  const upperPrimaryLocal=new Vector3(
    profile.joints[upperName].anatomicalRestBasis.primaryLocal.x,
    profile.joints[upperName].anatomicalRestBasis.primaryLocal.y,
    profile.joints[upperName].anatomicalRestBasis.primaryLocal.z,
  );
  const lowerPrimaryLocal=new Vector3(
    profile.joints[lowerName].anatomicalRestBasis.primaryLocal.x,
    profile.joints[lowerName].anatomicalRestBasis.primaryLocal.y,
    profile.joints[lowerName].anatomicalRestBasis.primaryLocal.z,
  );
  const upperWorldQ=new Quaternion(upperWorld.x,upperWorld.y,upperWorld.z,upperWorld.w).normalize();
  const lowerWorldQ=new Quaternion(lowerWorld.x,lowerWorld.y,lowerWorld.z,lowerWorld.w).normalize();
  const actualElbow=shoulder.clone().addScaledVector(upperPrimaryLocal.applyQuaternion(upperWorldQ).normalize(),arm.upperLength);
  const actualWrist=actualElbow.clone().addScaledVector(lowerPrimaryLocal.applyQuaternion(lowerWorldQ).normalize(),arm.lowerLength);
  const actualHandWorld=lowerWorldQ.clone()
    .multiply(new Quaternion(hand.restLocalRotation.x,hand.restLocalRotation.y,hand.restLocalRotation.z,hand.restLocalRotation.w))
    .multiply(new Quaternion(normalized.x,normalized.y,normalized.z,normalized.w))
    .normalize();
  const probe=contactRig.probes[side][probeName];
  const actualProbePoint=actualWrist.clone().add(new Vector3(probe.frameOffset.x,probe.frameOffset.y,probe.frameOffset.z).applyQuaternion(actualHandWorld));
  const actualProbeNormal=new Vector3(probe.contactNormal.x,probe.contactNormal.y,probe.contactNormal.z).normalize().applyQuaternion(actualHandWorld);
  const targetNormal=new Vector3(-anchor.normal.x,-anchor.normal.y,-anchor.normal.z).normalize();
  const postConstraintAnchorError=actualProbePoint.distanceTo(new Vector3(anchor.point.x,anchor.point.y,anchor.point.z));
  const postConstraintNormalError=actualProbeNormal.angleTo(targetNormal);
  if(!finite(postConstraintAnchorError,postConstraintNormalError))return rejected("invalid-target");

  // Large differences are diagnostic only. Runtime already owns angular velocity limiting, so a
  // valid contact is allowed to converge over several render frames instead of being discarded.
  const angularDeltaDegrees={
    upper:angularDelta(baseline[upperName],solved.deltas[upperName]!)*180/Math.PI,
    lower:angularDelta(baseline[lowerName],solved.deltas[lowerName]!)*180/Math.PI,
    hand:angularDelta(baseline[handName],normalized)*180/Math.PI,
  };

  // V2 allowed any finite target to pull the arm, which amplified a wrong semantic/depth target
  // into a catastrophic pose. Keep fail-soft behaviour, but make contact a LOCAL corrective layer:
  // a very large departure from faithful reconstruction fades to zero instead of being forced.
  const upperQuality=1-smoothstep(65,125,angularDeltaDegrees.upper);
  const lowerQuality=1-smoothstep(85,155,angularDeltaDegrees.lower);
  const handQuality=1-smoothstep(100,175,angularDeltaDegrees.hand);
  const kinematicQuality=clamp01(Math.min(upperQuality,lowerQuality,handQuality));

  const influenceScale=clamp01(reachQuality*collisionQuality*kinematicQuality);
  const degraded=[reachQuality<.999,collisionQuality<.999,kinematicQuality<.999].filter(Boolean).length;
  const reason:ContactPoseCorrectionReason=degraded>1?"multi-degraded":reachQuality<.999?"reach-degraded":collisionQuality<.999?"collision-degraded":kinematicQuality<.999?"kinematic-degraded":"none";

  return{
    rotations:{[upperName]:solved.deltas[upperName]!,[lowerName]:solved.deltas[lowerName]!,[handName]:normalized},
    anchorError:postConstraintAnchorError,
    normalErrorRadians:postConstraintNormalError,
    reachRatio:ik.reachRatio,
    projected:ik.projected,
    projection:ik.projection,
    targetDistance:ik.targetDistance,
    minReach:ik.minReach,
    maxReach:ik.maxReach,
    reachErrorRatio:ik.reachErrorRatio,
    reachQuality,
    headPenetration:headResult.penetration,
    torsoPenetration:torsoResult.penetration,
    collisionQuality,
    kinematicQuality,
    influenceScale,
    angularDeltaDegrees,
    accepted:true,
    reason,
  };
}
