import { Quaternion,Vector3 } from "three";
import type { QuaternionData } from "./avatarPoseTypes";
import type { AvatarContactLocalAnchor } from "./contactAnchorMapping";
import type { NormalizedAvatarRigProfile } from "./normalizedRigProfile";
import type { ObservedBodyDepth } from "./observedBodyDepth";
import { getPosedContactJointTransform,poseContactAnchor,poseContactRestWorldPoint } from "./posedContactAnchor";

/** Reject a target on the opposite body hemisphere from fresh pre-retarget Pose evidence.
 * Compare the posed anchor, not its semantic name: a turned head can put a cheek behind the torso plane.
 * Unknown ordering never creates a contact or manufactures a depth sign.
 */
export function contactDepthOrderConflicts(profile:NormalizedAvatarRigProfile,anchor:AvatarContactLocalAnchor,rotations:Partial<Record<string,QuaternionData>>,headRotation:QuaternionData|null,depth:ObservedBodyDepth["left"]|undefined):boolean{
  if(!depth||!profile.collisionReference)return false;
  const skeleton=profile.contactSkeleton?.joints;
  const torsoParent=skeleton?.upperChest?"upperChest":skeleton?.chest?"chest":skeleton?.spine?"spine":"hips";
  const ref=skeleton?.[torsoParent],posed=getPosedContactJointTransform(profile,torsoParent,rotations,headRotation),target=poseContactAnchor(anchor,profile,rotations,headRotation);
  if(!ref||!posed||!target)return false;
  const forward=new Vector3(profile.torsoReference.forwardWorld.x,profile.torsoReference.forwardWorld.y,profile.torsoReference.forwardWorld.z)
    .applyQuaternion(new Quaternion(ref.restWorldRotation.x,ref.restWorldRotation.y,ref.restWorldRotation.z,ref.restWorldRotation.w).invert()).applyQuaternion(posed.rotation).normalize();
  const head=anchor.parentJoint==="head",side=head?depth.head:anchor.parentJoint===torsoParent?depth.torso:null;
  if(side===null)return false;
  const collision=profile.collisionReference;
  const center=poseContactRestWorldPoint(profile,head?"head":torsoParent,head?collision.head.centerWorld:collision.torso.startWorld,rotations,headRotation);
  if(!center)return false;
  const offset=new Vector3(target.point.x,target.point.y,target.point.z).sub(center).dot(forward);
  const tolerance=(head?collision.head.radius:collision.torso.radius)*.08;
  return Number.isFinite(offset)&&offset*side < -tolerance;
}
