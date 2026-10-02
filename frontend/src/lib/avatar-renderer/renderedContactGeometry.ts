import { Object3D, Quaternion, Vector3 } from "three";
import type { AvatarPoseJointNameV2,Vector3Data } from "../avatar-motion/avatarPoseTypes";
import type { AvatarCollisionPose } from "../avatar-motion/avatarCollisionTypes";
import type { NormalizedAvatarRigProfile } from "../avatar-motion/normalizedRigProfile";
import { poseAvatarCollisionProfile,type AvatarCollisionProfile } from "../avatar-motion/avatarCollisionProfile";
import { queryAvatarArmBodyCollisions } from "../avatar-motion/avatarCollisionQuery";
import { queryAvatarInterArmCollisions } from "../avatar-motion/avatarInterArmCollision";

export type ContactBoneMap=Partial<Record<AvatarPoseJointNameV2,Object3D>>;
export interface SemanticBoneFrame {bone:Object3D;restWorld:Quaternion;semanticRestWorld:Quaternion;restPosition:Vector3}
export function captureSemanticBoneFrames(normalized:ContactBoneMap,raw:ContactBoneMap):Map<string,SemanticBoneFrame>{
  const frames=new Map<string,SemanticBoneFrame>();
  for(const[name,semantic]of Object.entries(normalized)){
    if(!semantic)continue;const actual=raw[name as AvatarPoseJointNameV2]??semantic;
    frames.set(name,{bone:actual,restWorld:actual.getWorldQuaternion(new Quaternion()),semanticRestWorld:semantic.getWorldQuaternion(new Quaternion()),restPosition:actual.getWorldPosition(new Vector3())});
  }return frames;
}
/** Raw posed transform expressed in the normalized bone's rest axes. */
export function semanticRenderedRotation(frame:SemanticBoneFrame):Quaternion{return frame.bone.getWorldQuaternion(new Quaternion()).multiply(frame.restWorld.clone().invert()).multiply(frame.semanticRestWorld).normalize();}
const v=(p:Vector3Data)=>new Vector3(p.x,p.y,p.z);
export function renderedArmPose(frames:Map<string,SemanticBoneFrame>,rig:NormalizedAvatarRigProfile,side:"left"|"right"):AvatarCollisionPose|null{
  const upper=frames.get(side+"UpperArm"),lower=frames.get(side+"LowerArm"),hand=frames.get(side+"Hand");if(!upper||!lower||!hand)return null;
  const wrist=hand.bone.getWorldPosition(new Vector3()),q=semanticRenderedRotation(hand),frame=rig.hands?.[side]?.contactFrame;
  return{shoulder:upper.bone.getWorldPosition(new Vector3()),elbow:lower.bone.getWorldPosition(new Vector3()),wrist,
    hand:frame?wrist.clone().add(v(frame.forwardLocal).applyQuaternion(q).multiplyScalar(frame.palmLength??0)):wrist.clone(),
    ...(frame?.probes?.palmCenter?{palmCenter:wrist.clone().add(v(frame.probes.palmCenter.offsetLocal).applyQuaternion(q))}:{})};
}
export function renderedBodyProfile(frames:Map<string,SemanticBoneFrame>,profile:AvatarCollisionProfile):AvatarCollisionProfile|null{
  const head=frames.get("head"),neck=frames.get("neck"),chest=frames.get("upperChest")??frames.get("chest"),hips=frames.get("hips");if(!head||!neck||!chest||!hips)return null;
  const point=(frame:SemanticBoneFrame,p:Vector3Data)=>v(p).sub(frame.restPosition).applyQuaternion(semanticRenderedRotation(frame).multiply(frame.semanticRestWorld.clone().invert())).add(frame.bone.getWorldPosition(new Vector3()));
  const hp=head.bone.getWorldPosition(new Vector3()),np=neck.bone.getWorldPosition(new Vector3()),cp=chest.bone.getWorldPosition(new Vector3());
  return poseAvatarCollisionProfile(profile,{headCenter:point(head,profile.body.head.center),neckStart:cp.clone().lerp(np,.72),neckEnd:np.clone().lerp(hp,.55),torsoStart:cp,torsoEnd:hips.bone.getWorldPosition(new Vector3()),
    ...(profile.body.chestLeft?{chestLeftCenter:point(chest,profile.body.chestLeft.center)}:{}),...(profile.body.chestRight?{chestRightCenter:point(chest,profile.body.chestRight.center)}:{}),
    ...(profile.body.frontNormal?{frontNormal:v(profile.body.frontNormal).applyQuaternion(semanticRenderedRotation(chest).multiply(chest.semanticRestWorld.clone().invert())).normalize()}:{})});
}
export function measureRenderedContacts(profile:AvatarCollisionProfile,left:AvatarCollisionPose|null,right:AvatarCollisionPose|null){
  return{left:left?queryAvatarArmBodyCollisions(profile,"left",left):[],right:right?queryAvatarArmBodyCollisions(profile,"right",right):[],interArm:left&&right?queryAvatarInterArmCollisions(profile,left,right):[]};
}
