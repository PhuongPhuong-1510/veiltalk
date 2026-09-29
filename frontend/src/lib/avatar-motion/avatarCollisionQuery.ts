import { Vector3 } from "three";
import { capsuleCapsuleContact, capsuleSphereContact } from "./collision/collisionPrimitives";
import type { CapsuleCollider } from "./collision/collisionTypes";
import type { Vector3Data } from "./avatarPoseTypes";
import type { AvatarCollisionProfile } from "./avatarCollisionProfile";
import type { AvatarCollisionArmPart, AvatarCollisionBodyPart, AvatarCollisionPose, CollisionContact } from "./avatarCollisionTypes";

const v = (p: Vector3Data) => new Vector3(p.x, p.y, p.z);

export function queryAvatarArmBodyCollisions(profile: AvatarCollisionProfile, side: "left" | "right", pose: AvatarCollisionPose): CollisionContact[] {
  const dimensions = profile.arms[side];
  const arm: Record<AvatarCollisionArmPart, CapsuleCollider> = {
    upperArm: { start: pose.shoulder, end: pose.elbow, radius: dimensions.upperRadius },
    forearm: { start: pose.elbow, end: pose.wrist, radius: dimensions.forearmRadius },
    hand: { start: pose.wrist, end: pose.hand ?? pose.wrist, radius: dimensions.handRadius },
  };
  const contacts: CollisionContact[] = [];
  const bodyParts:AvatarCollisionBodyPart[]=["head","neck","torso",...(profile.body.chestLeft?["chestLeft" as const]:[]),...(profile.body.chestRight?["chestRight" as const]:[])];
  for (const [armPart, collider] of Object.entries(arm) as Array<[AvatarCollisionArmPart, CapsuleCollider]>) {
    for (const bodyPart of bodyParts) {
      const sphere=bodyPart==="head"?profile.body.head:bodyPart==="chestLeft"||bodyPart==="chestRight"?profile.body[bodyPart]:null;
      const meta={pairKey:`arm:${side}:${armPart}|body:${bodyPart}`,ownerA:{kind:"arm" as const,side,part:armPart},ownerB:{kind:"body" as const,part:bodyPart}};
      const result = sphere ? capsuleSphereContact(collider, sphere,meta) : capsuleCapsuleContact(collider, profile.body[bodyPart as "neck"|"torso"],meta);
      if (!result.valid || result.penetrationDepth <= 0) continue;
      let surfaceNormal=result.normalBToA;
      if((bodyPart==="torso"||bodyPart==="chestLeft"||bodyPart==="chestRight")&&profile.body.frontNormal&&(armPart==="forearm"||armPart==="hand")){
        const front=v(profile.body.frontNormal).normalize(),frontDepth=v(result.pointA).sub(v(profile.body.torso.start)).dot(front);
        // Near the torso mid-plane, a webcam cross-body gesture is front-side unless depth gives
        // strong evidence that it is behind. Bias the correction outward instead of deeper inside.
        if(frontDepth>=-profile.body.torso.radius*.15&&v(surfaceNormal).dot(front)<.35){
          const outward=v(surfaceNormal).multiplyScalar(.35).addScaledVector(front,.65).normalize();surfaceNormal={x:outward.x,y:outward.y,z:outward.z};
        }
      }
      contacts.push({ bodyPart, armPart, signedDistance: result.signedDistance, penetrationDepth: result.penetrationDepth, closestPointArm: result.pointA,
        closestPointBody: result.pointB, surfaceNormal,
        normalizedPenetration: result.normalizedPenetration,armParameter:result.parameterA??.5 });
    }
  }
  return contacts.sort((a, b) => b.penetrationDepth - a.penetrationDepth);
}
