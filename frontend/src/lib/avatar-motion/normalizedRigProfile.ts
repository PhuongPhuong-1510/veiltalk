import type { AvatarJointName, QuaternionData, Vector3Data } from "./avatarPoseTypes";

export type ControlledArmJoint = "leftUpperArm" | "leftLowerArm" | "rightUpperArm" | "rightLowerArm";

export interface AnatomicalRestBasis {
  primaryLocal: Vector3Data;
  secondaryLocal: Vector3Data;
  binormalLocal: Vector3Data;
  primaryWorld: Vector3Data;
  secondaryWorld: Vector3Data;
  binormalWorld: Vector3Data;
  worldRotation: QuaternionData;
}

export interface RigTorsoReference {
  rightWorld: Vector3Data;
  upWorld: Vector3Data;
  forwardWorld: Vector3Data;
  worldRotation: QuaternionData;
}

export interface ControlledJointProfile {
  parentJoint: AvatarJointName;
  childJoint: AvatarJointName;
  parentMode: "fixed-rest" | "controlled";
  controlledParentJoint: ControlledArmJoint | null;
  restLocalPosition: Vector3Data;
  restLocalRotation: QuaternionData;
  restWorldPosition: Vector3Data;
  restWorldRotation: QuaternionData;
  parentRestWorldRotation: QuaternionData;
  restWorldDirection: Vector3Data;
  anatomicalRestBasis: AnatomicalRestBasis;
}

export interface NormalizedAvatarRigProfile {
  version: 1;
  modelGeneration: number;
  modelFingerprint: string;
  torsoReference: RigTorsoReference;
  joints: Record<ControlledArmJoint, ControlledJointProfile>;
}

const HIERARCHY: Record<ControlledArmJoint, Pick<ControlledJointProfile, "parentJoint" | "childJoint" | "parentMode" | "controlledParentJoint">> = {
  leftUpperArm: { parentJoint: "leftShoulder", childJoint: "leftLowerArm", parentMode: "fixed-rest", controlledParentJoint: null },
  leftLowerArm: { parentJoint: "leftUpperArm", childJoint: "leftHand", parentMode: "controlled", controlledParentJoint: "leftUpperArm" },
  rightUpperArm: { parentJoint: "rightShoulder", childJoint: "rightLowerArm", parentMode: "fixed-rest", controlledParentJoint: null },
  rightLowerArm: { parentJoint: "rightUpperArm", childJoint: "rightHand", parentMode: "controlled", controlledParentJoint: "rightUpperArm" },
};

const finite = (...values: number[]) => values.every(Number.isFinite);
const finiteVector = (v: Vector3Data) => finite(v.x, v.y, v.z);
const unitQuaternion = (q: QuaternionData) => finite(q.x, q.y, q.z, q.w) && Math.abs(Math.hypot(q.x, q.y, q.z, q.w) - 1) < 1e-4;
const unitVector = (v: Vector3Data) => finite(v.x, v.y, v.z) && Math.abs(Math.hypot(v.x, v.y, v.z) - 1) < 1e-4;
const orthonormal = (a: Vector3Data, b: Vector3Data, c: Vector3Data) => unitVector(a) && unitVector(b) && unitVector(c)
  && Math.abs(a.x * b.x + a.y * b.y + a.z * b.z) < 1e-4
  && Math.abs(a.x * c.x + a.y * c.y + a.z * c.z) < 1e-4
  && Math.abs(b.x * c.x + b.y * c.y + b.z * c.z) < 1e-4;

export function validateRigProfile(profile: NormalizedAvatarRigProfile): boolean {
  if (profile.version !== 1 || !Number.isInteger(profile.modelGeneration) || !profile.modelFingerprint) return false;
  if (!orthonormal(profile.torsoReference.rightWorld, profile.torsoReference.upWorld, profile.torsoReference.forwardWorld) || !unitQuaternion(profile.torsoReference.worldRotation)) return false;
  for (const [name, expected] of Object.entries(HIERARCHY) as Array<[ControlledArmJoint, typeof HIERARCHY[ControlledArmJoint]]>) {
    const joint = profile.joints[name];
    if (!joint || joint.parentJoint !== expected.parentJoint || joint.childJoint !== expected.childJoint || joint.parentMode !== expected.parentMode || joint.controlledParentJoint !== expected.controlledParentJoint) return false;
    if (!finiteVector(joint.restLocalPosition) || !finiteVector(joint.restWorldPosition)) return false;
    if (!unitQuaternion(joint.restLocalRotation) || !unitQuaternion(joint.restWorldRotation) || !unitQuaternion(joint.parentRestWorldRotation) || !unitVector(joint.restWorldDirection)) return false;
    const basis = joint.anatomicalRestBasis;
    if (!basis || !orthonormal(basis.primaryLocal, basis.secondaryLocal, basis.binormalLocal) || !orthonormal(basis.primaryWorld, basis.secondaryWorld, basis.binormalWorld) || !unitQuaternion(basis.worldRotation)) return false;
  }
  return true;
}

export function freezeRigProfile(profile: NormalizedAvatarRigProfile): NormalizedAvatarRigProfile {
  Object.values(profile.torsoReference).forEach(Object.freeze); Object.freeze(profile.torsoReference);
  for (const joint of Object.values(profile.joints)) {
    Object.values(joint.anatomicalRestBasis).forEach(Object.freeze); Object.freeze(joint.anatomicalRestBasis);
    Object.freeze(joint.restLocalPosition); Object.freeze(joint.restLocalRotation); Object.freeze(joint.restWorldPosition); Object.freeze(joint.restWorldRotation); Object.freeze(joint.parentRestWorldRotation); Object.freeze(joint.restWorldDirection); Object.freeze(joint);
  }
  Object.freeze(profile.joints); return Object.freeze(profile);
}
