import { capsuleCapsuleContact } from "./collision/collisionPrimitives";
import type { CapsuleCollider } from "./collision/collisionTypes";
import type { AvatarCollisionProfile } from "./avatarCollisionProfile";
import type { AvatarCollisionArmPart, AvatarCollisionPose } from "./avatarCollisionTypes";
import type { Vector3Data } from "./avatarPoseTypes";
import type { ArmObservability } from "./armObservability";
import { solveContactArmIk } from "./contactArmIk";
import { Vector3 } from "three";

export interface InterArmCollisionContact {
  leftPart: AvatarCollisionArmPart;
  rightPart: AvatarCollisionArmPart;
  penetrationDepth: number;
  normalRightToLeft: Vector3Data;
  closestPointLeft: Vector3Data;
  closestPointRight: Vector3Data;
  normalizedPenetration: number;
  leftParameter:number;
  rightParameter:number;
}

export interface InterArmCorrectionResult {left:AvatarCollisionPose;right:AvatarCollisionPose;contactsBefore:InterArmCollisionContact[];contactsAfter:InterArmCollisionContact[];iterations:number;baselinePreserved:boolean}

function colliders(profile: AvatarCollisionProfile, side: "left"|"right", pose: AvatarCollisionPose): Record<AvatarCollisionArmPart,CapsuleCollider> {
  const size=profile.arms[side];
  return {
    upperArm:{start:pose.shoulder,end:pose.elbow,radius:size.upperRadius},
    forearm:{start:pose.elbow,end:pose.wrist,radius:size.forearmRadius},
    hand:{start:pose.wrist,end:pose.hand??pose.wrist,radius:size.handRadius},
  };
}

/** All left/right limb pairs, including real palm capsules supplied through pose.hand. */
export function queryAvatarInterArmCollisions(profile:AvatarCollisionProfile,leftPose:AvatarCollisionPose,rightPose:AvatarCollisionPose):InterArmCollisionContact[]{
  const left=colliders(profile,"left",leftPose),right=colliders(profile,"right",rightPose),contacts:InterArmCollisionContact[]=[];
  for(const [leftPart,leftCollider] of Object.entries(left) as Array<[AvatarCollisionArmPart,CapsuleCollider]>) for(const [rightPart,rightCollider] of Object.entries(right) as Array<[AvatarCollisionArmPart,CapsuleCollider]>){
    const hit=capsuleCapsuleContact(leftCollider,rightCollider,{pairKey:`arm:left:${leftPart}|arm:right:${rightPart}`,ownerA:{kind:"arm",side:"left",part:leftPart},ownerB:{kind:"arm",side:"right",part:rightPart}});if(!hit.valid||hit.penetrationDepth<=0)continue;
    contacts.push({leftPart,rightPart,penetrationDepth:hit.penetrationDepth,normalRightToLeft:hit.normalBToA,closestPointLeft:hit.pointA,closestPointRight:hit.pointB,normalizedPenetration:hit.normalizedPenetration,leftParameter:hit.parameterA??.5,rightParameter:hit.parameterB??.5});
  }
  return contacts.sort((a,b)=>b.penetrationDepth-a.penetrationDepth);
}

const freedom=(mask:ArmObservability)=>{
  const observed=[...mask].filter(joint=>joint!=="-").length;
  if(observed<2)return 0;
  return mask[1]==="E"?(mask[2]==="W"?.15:.35):(mask[2]==="W"?.7:.5);
};
const vector=(p:Vector3Data)=>new Vector3(p.x,p.y,p.z);

/** Deepest-first mutual projection. The less-observed arm receives more displacement. */
export function correctAvatarInterArmCollision(profile:AvatarCollisionProfile,leftBaseline:AvatarCollisionPose,rightBaseline:AvatarCollisionPose,observability:Record<"left"|"right",ArmObservability>,maxDisplacement:number,maxIterations=3,depthOrdering:"left-front"|"right-front"|null=null):InterArmCorrectionResult{
  let left=leftBaseline,right=rightBaseline,contacts=queryAvatarInterArmCollisions(profile,left,right);const before=contacts;
  const leftPole=vector(left.elbow).sub(vector(left.shoulder)),rightPole=vector(right.elbow).sub(vector(right.shoulder));
  const leftFreedom=freedom(observability.left),rightFreedom=freedom(observability.right),sum=Math.max(1e-8,leftFreedom+rightFreedom);
  if(leftFreedom+rightFreedom<=1e-8)return{left,right,contactsBefore:before,contactsAfter:contacts,iterations:0,baselinePreserved:true};
  for(let iteration=1;iteration<=maxIterations&&contacts.length;iteration++){
    const hit=contacts[0],step=Math.min(hit.penetrationDepth,maxDisplacement),normal=vector(hit.normalRightToLeft);
    const leftCorrection=normal.clone().multiplyScalar(step*leftFreedom/sum),rightCorrection=normal.clone().multiplyScalar(-step*rightFreedom/sum),leftWeights=projectionWeights(hit.leftPart,hit.leftParameter),rightWeights=projectionWeights(hit.rightPart,hit.rightParameter);
    const nextLeft=vector(left.wrist).addScaledVector(leftCorrection,leftWeights.wrist),nextRight=vector(right.wrist).addScaledVector(rightCorrection,rightWeights.wrist);
    const desiredLeftElbow=vector(left.elbow).addScaledVector(leftCorrection,leftWeights.elbow),desiredRightElbow=vector(right.elbow).addScaledVector(rightCorrection,rightWeights.elbow);
    const leftIk=solveContactArmIk({shoulder:left.shoulder,wristTarget:nextLeft,upperLength:profile.arms.left.upperLength,lowerLength:profile.arms.left.lowerLength,preferredPole:poleFromDesired(left.shoulder,nextLeft,desiredLeftElbow,leftPole)});
    const rightIk=solveContactArmIk({shoulder:right.shoulder,wristTarget:nextRight,upperLength:profile.arms.right.upperLength,lowerLength:profile.arms.right.lowerLength,preferredPole:poleFromDesired(right.shoulder,nextRight,desiredRightElbow,rightPole)});
    if(!leftIk||!rightIk)break;
    const leftShift=vector(leftIk.wrist).sub(vector(left.wrist)),rightShift=vector(rightIk.wrist).sub(vector(right.wrist));
    const candidateLeft={...left,elbow:leftIk.elbow,wrist:leftIk.wrist,...(left.hand?{hand:vector(left.hand).add(leftShift)}:{})};const candidateRight={...right,elbow:rightIk.elbow,wrist:rightIk.wrist,...(right.hand?{hand:vector(right.hand).add(rightShift)}:{})};
    const depthDelta=candidateLeft.wrist.z-candidateRight.wrist.z;
    if((depthOrdering==="left-front"&&depthDelta<0)||(depthOrdering==="right-front"&&depthDelta>0))break;
    const next=queryAvatarInterArmCollisions(profile,candidateLeft,candidateRight);if(score(next)>=score(contacts))break;left=candidateLeft;right=candidateRight;contacts=next;
  }
  return{left,right,contactsBefore:before,contactsAfter:contacts,iterations:maxIterations,baselinePreserved:left===leftBaseline&&right===rightBaseline};
}
const score=(contacts:InterArmCollisionContact[])=>contacts.reduce((sum,c)=>sum+c.penetrationDepth*c.penetrationDepth,0);
const projectionWeights=(part:AvatarCollisionArmPart,parameter:number)=>{const t=Math.max(0,Math.min(1,parameter));if(part==="upperArm")return{elbow:.35+.65*t,wrist:.12*t};if(part==="forearm")return{elbow:.5*(1-t),wrist:.35+.65*t};return{elbow:0,wrist:1};};
const poleFromDesired=(shoulder:Vector3Data,wrist:Vector3,elbow:Vector3,fallback:Vector3)=>{const origin=vector(shoulder),axis=wrist.clone().sub(origin);if(axis.lengthSq()<1e-10)return{x:fallback.x,y:fallback.y,z:fallback.z};axis.normalize();const pole=elbow.clone().sub(origin);pole.addScaledVector(axis,-pole.dot(axis));const value=pole.lengthSq()>1e-10?pole:fallback;return{x:value.x,y:value.y,z:value.z};};
