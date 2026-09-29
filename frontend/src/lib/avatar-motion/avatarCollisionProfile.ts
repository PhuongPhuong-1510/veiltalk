import { Vector3 } from "three";
import type { Vector3Data } from "./avatarPoseTypes";
import type { NormalizedAvatarRigProfile } from "./normalizedRigProfile";
import type { CapsuleCollider, SphereCollider } from "./contactCollision";

export interface AvatarCollisionProfile {
  body: { head: SphereCollider; neck: CapsuleCollider; torso: CapsuleCollider };
  arms: Record<"left" | "right", { upperRadius: number; forearmRadius: number; handRadius: number; upperLength: number; lowerLength: number }>;
}

export interface PosedAvatarBodyFrame {
  headCenter: Vector3Data;
  neckStart: Vector3Data;
  neckEnd: Vector3Data;
  torsoStart: Vector3Data;
  torsoEnd: Vector3Data;
}

const data = (v: Vector3): Vector3Data => ({ x: v.x, y: v.y, z: v.z });

/** Builds all V1 colliders from the model-scaled rig reference; no world-unit constants are used. */
export function buildAvatarCollisionProfile(rig: NormalizedAvatarRigProfile): AvatarCollisionProfile | null {
  const source = rig.collisionReference;
  if (!source) return null;
  const head = new Vector3(source.head.centerWorld.x, source.head.centerWorld.y, source.head.centerWorld.z);
  const torsoStart = new Vector3(source.torso.startWorld.x, source.torso.startWorld.y, source.torso.startWorld.z);
  const up = new Vector3(rig.torsoReference.upWorld.x, rig.torsoReference.upWorld.y, rig.torsoReference.upWorld.z).normalize();
  const neckLength = Math.min(source.head.radius, head.distanceTo(torsoStart));
  const neckEnd = head.clone().addScaledVector(up, -source.head.radius * .55);
  const neckStart = neckEnd.clone().addScaledVector(up, -neckLength);
  const arms = Object.fromEntries((["left", "right"] as const).map((side) => {
    const arm = source.arms[side];
    return [side, { upperRadius: arm.radius * 1.08, forearmRadius: arm.radius, handRadius: arm.radius * 1.35, upperLength: arm.upperLength, lowerLength: arm.lowerLength }];
  })) as AvatarCollisionProfile["arms"];
  return {
    body: {
      head: { center: source.head.centerWorld, radius: source.head.radius },
      neck: { start: data(neckStart), end: data(neckEnd), radius: source.torso.radius * .42 },
      torso: { start: source.torso.startWorld, end: source.torso.endWorld, radius: source.torso.radius },
    },
    arms,
  };
}

/** Combines static, rig-scaled dimensions with body transforms sampled after current-frame FK. */
export function poseAvatarCollisionProfile(profile: AvatarCollisionProfile, frame: PosedAvatarBodyFrame): AvatarCollisionProfile {
  return { ...profile, body: {
    head: { center: frame.headCenter, radius: profile.body.head.radius },
    neck: { start: frame.neckStart, end: frame.neckEnd, radius: profile.body.neck.radius },
    torso: { start: frame.torsoStart, end: frame.torsoEnd, radius: profile.body.torso.radius },
  } };
}
