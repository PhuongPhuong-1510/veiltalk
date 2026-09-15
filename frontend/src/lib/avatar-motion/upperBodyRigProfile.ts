import type { QuaternionData, AvatarUpperBodyJointName, Vector3Data } from "./avatarPoseTypes";
import type { AsymmetricRotationLimits } from "./quaternionDistribution";

export type UpperBodyCapabilityClass = "full" | "reduced" | "head-only" | "partial-shoulder" | "unsupported";

export interface UpperBodyJointProfile {
  name: AvatarUpperBodyJointName | "head";
  parent: AvatarUpperBodyJointName | null;
  restLocalRotation: QuaternionData;
  restWorldRotation: QuaternionData;
  parentRestWorldRotation: QuaternionData;
  pitchAxisLocal: Vector3Data;
  yawAxisLocal: Vector3Data;
  rollAxisLocal: Vector3Data;
  limits: AsymmetricRotationLimits;
}

export interface UpperBodyRigProfileV1 {
  version: 1;
  modelGeneration: number;
  modelFingerprint: string;
  capability: UpperBodyCapabilityClass;
  shoulderWidth: number | null;
  joints: Partial<Record<AvatarUpperBodyJointName | "head", UpperBodyJointProfile>>;
}

export const UPPER_BODY_HIERARCHY: readonly (AvatarUpperBodyJointName | "head")[] = [
  "hips", "spine", "chest", "upperChest", "neck", "head", "leftShoulder", "rightShoulder",
];

const finite = (...values: number[]) => values.every(Number.isFinite);
const unitQuaternion = (q: QuaternionData) => finite(q.x, q.y, q.z, q.w)
  && Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) < 1e-4;
const unitVector = (v: Vector3Data) => finite(v.x, v.y, v.z)
  && Math.abs(Math.hypot(v.x, v.y, v.z) - 1) < 1e-4;

export function classifyUpperBodyCapability(profile: Pick<UpperBodyRigProfileV1, "joints">): UpperBodyCapabilityClass {
  const has = (name: AvatarUpperBodyJointName | "head") => Boolean(profile.joints[name]);
  if (!has("head") && !has("chest") && !has("upperChest") && !has("spine")) return "unsupported";
  if (has("leftShoulder") !== has("rightShoulder")) return "partial-shoulder";
  if (has("head") && !has("neck") && !has("chest") && !has("upperChest") && !has("spine")) return "head-only";
  if (has("spine") && has("chest") && has("upperChest") && has("neck") && has("head") && has("leftShoulder") && has("rightShoulder")) return "full";
  return "reduced";
}

export function validateUpperBodyRigProfile(profile: UpperBodyRigProfileV1): boolean {
  if (profile.version !== 1 || !Number.isInteger(profile.modelGeneration) || profile.modelGeneration < 1 || !profile.modelFingerprint) return false;
  if (profile.shoulderWidth !== null && (!Number.isFinite(profile.shoulderWidth) || profile.shoulderWidth <= 0)) return false;
  for (const [name, joint] of Object.entries(profile.joints) as Array<[AvatarUpperBodyJointName | "head", UpperBodyJointProfile]>) {
    if (!joint || joint.name !== name || !unitQuaternion(joint.restLocalRotation) || !unitQuaternion(joint.restWorldRotation)
      || !unitQuaternion(joint.parentRestWorldRotation) || !unitVector(joint.pitchAxisLocal)
      || !unitVector(joint.yawAxisLocal) || !unitVector(joint.rollAxisLocal)) return false;
    if (!Object.values(joint.limits).every((limit) => Number.isFinite(limit) && limit > 0)) return false;
  }
  return profile.capability === classifyUpperBodyCapability(profile);
}

export function freezeUpperBodyRigProfile(profile: UpperBodyRigProfileV1): UpperBodyRigProfileV1 {
  for (const joint of Object.values(profile.joints)) {
    if (!joint) continue;
    Object.freeze(joint.restLocalRotation); Object.freeze(joint.restWorldRotation); Object.freeze(joint.parentRestWorldRotation);
    Object.freeze(joint.pitchAxisLocal); Object.freeze(joint.yawAxisLocal); Object.freeze(joint.rollAxisLocal);
    Object.freeze(joint.limits); Object.freeze(joint);
  }
  Object.freeze(profile.joints);
  return Object.freeze(profile);
}
