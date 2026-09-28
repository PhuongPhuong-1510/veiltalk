import { Quaternion,Vector3 } from "three";
import type { AvatarPoseJointNameV2,QuaternionData,Vector3Data } from "./avatarPoseTypes";
import type { AvatarContactAnchor,AvatarContactLocalAnchor } from "./contactAnchorMapping";
import type { ContactBodyJointName,NormalizedAvatarRigProfile } from "./normalizedRigProfile";

const quaternion=(value:QuaternionData|undefined|null)=>value?new Quaternion(value.x,value.y,value.z,value.w).normalize():new Quaternion();
const vector=(value:Vector3Data)=>new Vector3(value.x,value.y,value.z);
const data=(value:Vector3):Vector3Data=>({x:value.x,y:value.y,z:value.z});

export interface ContactJointWorldTransform {position:Vector3;rotation:Quaternion}

function deltaFor(joint:ContactBodyJointName,rotations:Partial<Record<AvatarPoseJointNameV2,QuaternionData>>,headRotation:QuaternionData|null):Quaternion{
  if(joint==="head")return quaternion(headRotation);
  return quaternion(rotations[joint as AvatarPoseJointNameV2]);
}

/** Reconstructs the current rotation-only upper-body hierarchy from parent-local rest-relative deltas. */
export function getPosedContactJointTransform(
  profile:NormalizedAvatarRigProfile,
  joint:ContactBodyJointName,
  rotations:Partial<Record<AvatarPoseJointNameV2,QuaternionData>>,
  headRotation:QuaternionData|null,
  cache=new Map<ContactBodyJointName,ContactJointWorldTransform>(),
):ContactJointWorldTransform|null{
  const cached=cache.get(joint);if(cached)return cached;
  const ref=profile.contactSkeleton?.joints[joint];if(!ref)return null;
  const delta=deltaFor(joint,rotations,headRotation);
  let result:ContactJointWorldTransform;
  if(!ref.parent){
    result={position:vector(ref.restWorldPosition),rotation:quaternion(ref.restWorldRotation).multiply(delta).normalize()};
  }else{
    const parent=getPosedContactJointTransform(profile,ref.parent,rotations,headRotation,cache);if(!parent)return null;
    const position=vector(ref.restLocalPosition).applyQuaternion(parent.rotation).add(parent.position);
    const rotation=parent.rotation.clone().multiply(quaternion(ref.restLocalRotation)).multiply(delta).normalize();
    result={position,rotation};
  }
  cache.set(joint,result);return result;
}

export function poseContactRestWorldPoint(
  profile:NormalizedAvatarRigProfile,parentJoint:ContactBodyJointName,restWorldPoint:Vector3Data,
  rotations:Partial<Record<AvatarPoseJointNameV2,QuaternionData>>,headRotation:QuaternionData|null,
):Vector3|null{
  const ref=profile.contactSkeleton?.joints[parentJoint];if(!ref)return null;
  const restPos=vector(ref.restWorldPosition),restRot=quaternion(ref.restWorldRotation).invert();
  const local=vector(restWorldPoint).sub(restPos).applyQuaternion(restRot);
  const current=getPosedContactJointTransform(profile,parentJoint,rotations,headRotation);if(!current)return null;
  return local.applyQuaternion(current.rotation).add(current.position);
}

export function poseContactAnchor(
  anchor:AvatarContactLocalAnchor,
  profile:NormalizedAvatarRigProfile,
  rotations:Partial<Record<AvatarPoseJointNameV2,QuaternionData>>,
  headRotation:QuaternionData|null,
):AvatarContactAnchor|null{
  const transform=getPosedContactJointTransform(profile,anchor.parentJoint,rotations,headRotation);if(!transform)return null;
  const point=vector(anchor.pointLocal).applyQuaternion(transform.rotation).add(transform.position);
  const normal=vector(anchor.normalLocal).applyQuaternion(transform.rotation).normalize();
  const tangent=vector(anchor.tangentLocal).applyQuaternion(transform.rotation).normalize();
  return{region:anchor.region,point:data(point),normal:data(normal),tangent:data(tangent),parentJoint:anchor.parentJoint};
}
