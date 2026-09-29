import { Vector3 } from "three";
import { capsuleCapsulePenetration, capsuleSpherePenetration, type CapsuleCollider } from "./contactCollision";
import type { Vector3Data } from "./avatarPoseTypes";
import type { AvatarCollisionProfile } from "./avatarCollisionProfile";
import type { AvatarCollisionArmPart, AvatarCollisionBodyPart, AvatarCollisionPose, CollisionContact } from "./avatarCollisionTypes";

const v = (p: Vector3Data) => new Vector3(p.x, p.y, p.z);
const data = (p: Vector3): Vector3Data => ({ x: p.x, y: p.y, z: p.z });

function bodyClosest(part: AvatarCollisionBodyPart, profile: AvatarCollisionProfile, armPoint: Vector3Data): Vector3Data {
  if (part === "head") {
    const center = v(profile.body.head.center), direction = v(armPoint).sub(center);
    if (direction.lengthSq() < 1e-12) direction.set(1, 0, 0); else direction.normalize();
    return data(center.addScaledVector(direction, profile.body.head.radius));
  }
  const capsule = profile.body[part], start = v(capsule.start), axis = v(capsule.end).sub(start);
  const t = axis.lengthSq() > 1e-12 ? Math.max(0, Math.min(1, v(armPoint).sub(start).dot(axis) / axis.lengthSq())) : 0;
  return data(start.addScaledVector(axis, t));
}

export function queryAvatarArmBodyCollisions(profile: AvatarCollisionProfile, side: "left" | "right", pose: AvatarCollisionPose): CollisionContact[] {
  const dimensions = profile.arms[side];
  const arm: Record<AvatarCollisionArmPart, CapsuleCollider> = {
    upperArm: { start: pose.shoulder, end: pose.elbow, radius: dimensions.upperRadius },
    forearm: { start: pose.elbow, end: pose.wrist, radius: dimensions.forearmRadius },
    hand: { start: pose.wrist, end: pose.hand ?? pose.wrist, radius: dimensions.handRadius },
  };
  const contacts: CollisionContact[] = [];
  for (const [armPart, collider] of Object.entries(arm) as Array<[AvatarCollisionArmPart, CapsuleCollider]>) {
    for (const bodyPart of ["head", "neck", "torso"] as const) {
      const result = bodyPart === "head" ? capsuleSpherePenetration(collider, profile.body.head) : capsuleCapsulePenetration(collider, profile.body[bodyPart]);
      if (!result.valid || result.penetration <= 0) continue;
      const bodyRadius = bodyPart === "head" ? profile.body.head.radius : profile.body[bodyPart].radius;
      contacts.push({ bodyPart, armPart, signedDistance: -result.penetration, penetrationDepth: result.penetration, closestPointArm: result.closest,
        closestPointBody: bodyClosest(bodyPart, profile, result.closest), surfaceNormal: result.normal,
        normalizedPenetration: result.penetration / Math.max(1e-8, collider.radius + bodyRadius) });
    }
  }
  return contacts.sort((a, b) => b.penetrationDepth - a.penetrationDepth);
}
