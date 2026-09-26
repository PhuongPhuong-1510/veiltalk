import { Quaternion,Vector3 } from "three";
import type { AvatarPoseJointNameV2,QuaternionData } from "./avatarPoseTypes";
import type { AvatarContactAnchor } from "./contactAnchorMapping";
import type { NormalizedAvatarRigProfile } from "./normalizedRigProfile";

const quaternion=(value:QuaternionData|undefined|null)=>value?new Quaternion(value.x,value.y,value.z,value.w).normalize():new Quaternion();
const data=(value:Vector3)=>({x:value.x,y:value.y,z:value.z});

/** Converts a rest-parent-local delta into a world-space delta without assuming XYZ-aligned avatars. */
function worldDelta(delta:QuaternionData|undefined|null,parentRestWorld:QuaternionData):Quaternion{
  const parent=quaternion(parentRestWorld);
  return parent.clone().multiply(quaternion(delta)).multiply(parent.clone().invert()).normalize();
}

export function poseContactAnchor(
  anchor:AvatarContactAnchor,
  profile:NormalizedAvatarRigProfile,
  rotations:Partial<Record<AvatarPoseJointNameV2,QuaternionData>>,
  headRotation:QuaternionData|null,
):AvatarContactAnchor{
  const collision=profile.collisionReference;if(!collision)return anchor;
  const torsoDelta=rotations.upperChest??rotations.chest??rotations.spine??rotations.hips;
  const torsoWorld=worldDelta(torsoDelta,profile.torsoReference.worldRotation);
  let rotation=torsoWorld.clone(),pivot=new Vector3(collision.torso.endWorld.x,collision.torso.endWorld.y,collision.torso.endWorld.z);
  if(anchor.parent==="head"){
    rotation.multiply(worldDelta(headRotation,profile.torsoReference.worldRotation)).normalize();
    pivot.set(collision.torso.startWorld.x,collision.torso.startWorld.y,collision.torso.startWorld.z);
  }else if(anchor.parent==="leftShoulder"||anchor.parent==="rightShoulder"){
    const side=anchor.parent==="leftShoulder"?"left":"right";
    pivot.set(collision.torso.endWorld.x,collision.torso.endWorld.y,collision.torso.endWorld.z);
    rotation.multiply(worldDelta(rotations[`${side}Shoulder`],profile.torsoReference.worldRotation)).normalize();
  }
  const transformPoint=(value:{x:number;y:number;z:number})=>new Vector3(value.x,value.y,value.z).sub(pivot).applyQuaternion(rotation).add(pivot);
  const transformDirection=(value:{x:number;y:number;z:number})=>new Vector3(value.x,value.y,value.z).applyQuaternion(rotation).normalize();
  return{...anchor,point:data(transformPoint(anchor.point)),normal:data(transformDirection(anchor.normal)),tangent:data(transformDirection(anchor.tangent))};
}
