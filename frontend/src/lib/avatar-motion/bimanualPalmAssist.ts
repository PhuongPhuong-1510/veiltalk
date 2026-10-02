import { Vector3 } from "three";
import type { AvatarCollisionProfile } from "./avatarCollisionProfile";
import type { AvatarCollisionPose } from "./avatarCollisionTypes";
import { queryAvatarArmBodyCollisions } from "./avatarCollisionQuery";
import { solveContactArmIk } from "./contactArmIk";

const v = (p: {x:number;y:number;z:number}) => new Vector3(p.x,p.y,p.z);
const bodyScore = (profile: AvatarCollisionProfile, side: "left"|"right", pose: AvatarCollisionPose) =>
  queryAvatarArmBodyCollisions(profile,side,pose).reduce((sum,hit)=>sum+hit.penetrationDepth**2,0);

export interface BimanualPalmAssistResult { left: AvatarCollisionPose; right: AvatarCollisionPose; applied: boolean; reason: string; distanceBefore: number | null; distanceAfter: number | null }

/** Bounded, model-space palm convergence for confirmed palms-together only. Not fingertip IK. */
export function assistBimanualPalms(profile: AvatarCollisionProfile, left: AvatarCollisionPose, right: AvatarCollisionPose,
  influence: number, maxStep: number): BimanualPalmAssistResult {
  const baseline = {left,right,applied:false,reason:"inactive",distanceBefore:null,distanceAfter:null};
  if (!left.hand || !right.hand || !Number.isFinite(influence) || influence<=0 || !Number.isFinite(maxStep) || maxStep<=0) return baseline;
  const leftPalm=v(left.palmCenter??left.hand),rightPalm=v(right.palmCenter??right.hand),distance=leftPalm.distanceTo(rightPalm);
  if (!Number.isFinite(distance)) return {...baseline,reason:"invalid-palm"};
  const total=Math.min(profile.arms.left.upperLength+profile.arms.left.lowerLength,profile.arms.right.upperLength+profile.arms.right.lowerLength);
  // Contact assistance must not invent a reach toward a remote second hand.
  if (distance>total*.35) return {...baseline,reason:"palm-gap-too-large",distanceBefore:distance};
  const separation=profile.arms.left.handRadius+profile.arms.right.handRadius;
  if (distance<=separation) return {...baseline,reason:"already-touching",distanceBefore:distance,distanceAfter:distance};
  const shift=rightPalm.clone().sub(leftPalm).normalize().multiplyScalar(Math.min(maxStep,(distance-separation)*.5*Math.min(1,influence)));
  const next=(side:"left"|"right",pose:AvatarCollisionPose,delta:Vector3):AvatarCollisionPose|null=>{
    const shoulder=v(pose.shoulder),target=v(pose.wrist).add(delta),axis=target.clone().sub(shoulder).normalize();
    const pole=v(pose.elbow).sub(shoulder);pole.addScaledVector(axis,-pole.dot(axis));
    if(pole.lengthSq()<1e-10)return null;
    const ik=solveContactArmIk({shoulder:pose.shoulder,wristTarget:target,upperLength:profile.arms[side].upperLength,lowerLength:profile.arms[side].lowerLength,preferredPole:pole});
    if(!ik||ik.projected)return null;
    const actualShift=v(ik.wrist).sub(v(pose.wrist));
    return{...pose,elbow:ik.elbow,wrist:ik.wrist,hand:v(pose.hand!).add(actualShift),...(pose.palmCenter?{palmCenter:v(pose.palmCenter).add(actualShift)}:{})};
  };
  const candidateLeft=next("left",left,shift),candidateRight=next("right",right,shift.clone().negate());
  if(!candidateLeft||!candidateRight)return{...baseline,reason:"unreachable",distanceBefore:distance};
  if(bodyScore(profile,"left",candidateLeft)>bodyScore(profile,"left",left)+1e-8||bodyScore(profile,"right",candidateRight)>bodyScore(profile,"right",right)+1e-8)
    return{...baseline,reason:"body-clearance",distanceBefore:distance};
  const after=v(candidateLeft.palmCenter??candidateLeft.hand!).distanceTo(v(candidateRight.palmCenter??candidateRight.hand!));
  if(after>=distance)return{...baseline,reason:"no-improvement",distanceBefore:distance};
  return{left:candidateLeft,right:candidateRight,applied:true,reason:"bounded-palm-assist",distanceBefore:distance,distanceAfter:after};
}
