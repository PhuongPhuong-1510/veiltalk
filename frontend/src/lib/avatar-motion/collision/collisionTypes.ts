import type { AvatarCollisionArmPart, AvatarCollisionBodyPart } from "../avatarCollisionTypes";
import type { Vector3Data } from "../avatarPoseTypes";

export interface SphereCollider {center:Vector3Data;radius:number}
export interface CapsuleCollider {start:Vector3Data;end:Vector3Data;radius:number}
export type ColliderOwner=
  |{kind:"body";part:AvatarCollisionBodyPart}
  |{kind:"arm";side:"left"|"right";part:AvatarCollisionArmPart};

/** Pure geometry only. Tracking confidence and correction policy do not belong here. */
export interface GeometricContact {
  pairKey:string;
  ownerA:ColliderOwner;
  ownerB:ColliderOwner;
  pointA:Vector3Data;
  pointB:Vector3Data;
  /** Fixed convention: collider B toward collider A. */
  normalBToA:Vector3Data;
  signedDistance:number;
  penetrationDepth:number;
  normalizedPenetration:number;
  /** Closest point position on capsule A/B: 0=start, 1=end. */
  parameterA:number|null;
  parameterB:number|null;
  valid:boolean;
}
