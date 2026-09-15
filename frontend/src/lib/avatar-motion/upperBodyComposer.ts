import type { AvatarUpperBodyJointName, QuaternionData, Vector3Data } from "./avatarPoseTypes";
import { IDENTITY_QUATERNION } from "./avatarPoseTypes";
import { inverseQuaternion, multiplyQuaternions } from "./motionMath";
import { clampRotationEllipsoid, quaternionExp, quaternionLog } from "./quaternionDistribution";
import type { UpperBodyJointProfile, UpperBodyRigProfileV1 } from "./upperBodyRigProfile";
import { UPPER_BODY_HIERARCHY } from "./upperBodyRigProfile";

export type UpperBodyJoint = AvatarUpperBodyJointName | "head";
export type UpperBodyLayer = Partial<Record<UpperBodyJoint, QuaternionData>>;
export interface UpperBodyLayers {
  torsoBase?: UpperBodyLayer;
  headRelative?: UpperBodyLayer;
  observedShoulder?: UpperBodyLayer;
  lifeSecondary?: UpperBodyLayer;
}
export interface UpperBodyCompositionResult {
  deltas: Partial<Record<UpperBodyJoint, QuaternionData>>;
  targetWorldRotations: Partial<Record<UpperBodyJoint, QuaternionData>>;
  aggregateClamped: UpperBodyJoint[];
}

const dot = (a: Vector3Data, b: Vector3Data) => a.x * b.x + a.y * b.y + a.z * b.z;
const addScaled = (target: Vector3Data, axis: Vector3Data, scale: number) => {
  target.x += axis.x * scale; target.y += axis.y * scale; target.z += axis.z * scale;
};

export function semanticRotationToLocal(rotation: Vector3Data, profile: UpperBodyJointProfile): QuaternionData {
  const local = { x: 0, y: 0, z: 0 };
  addScaled(local, profile.pitchAxisLocal, rotation.x);
  addScaled(local, profile.yawAxisLocal, rotation.y);
  addScaled(local, profile.rollAxisLocal, rotation.z);
  return quaternionExp(local) ?? IDENTITY_QUATERNION;
}

export function localRotationToSemantic(rotation: QuaternionData, profile: UpperBodyJointProfile): Vector3Data | null {
  const local = quaternionLog(rotation);
  return local ? { x: dot(local, profile.pitchAxisLocal), y: dot(local, profile.yawAxisLocal), z: dot(local, profile.rollAxisLocal) } : null;
}

export function composeUpperBody(profile: UpperBodyRigProfileV1, layers: UpperBodyLayers): UpperBodyCompositionResult {
  const deltas: UpperBodyCompositionResult["deltas"] = {};
  const targetWorldRotations: UpperBodyCompositionResult["targetWorldRotations"] = {};
  const aggregateClamped: UpperBodyJoint[] = [];
  const orderedLayers = [layers.torsoBase, layers.headRelative, layers.observedShoulder, layers.lifeSecondary];

  for (const name of UPPER_BODY_HIERARCHY) {
    const joint = profile.joints[name];
    if (!joint) continue;
    let aggregate = IDENTITY_QUATERNION;
    let hasContribution = false;
    for (const layer of orderedLayers) {
      const contribution = layer?.[name];
      if (!contribution) continue;
      aggregate = multiplyQuaternions(aggregate, contribution);
      hasContribution = true;
    }
    const semantic = localRotationToSemantic(aggregate, joint);
    const safeSemantic = semantic && clampRotationEllipsoid(semantic, joint.limits);
    const safe = safeSemantic ? semanticRotationToLocal(safeSemantic, joint) : IDENTITY_QUATERNION;
    if (semantic && safeSemantic && Math.hypot(semantic.x - safeSemantic.x, semantic.y - safeSemantic.y, semantic.z - safeSemantic.z) > 1e-7) aggregateClamped.push(name);
    deltas[name] = hasContribution ? safe : IDENTITY_QUATERNION;

    const parent = joint.parent ? profile.joints[joint.parent] : null;
    const parentTarget = joint.parent ? targetWorldRotations[joint.parent] : null;
    if (parent && parentTarget) {
      const relativeRest = multiplyQuaternions(inverseQuaternion(parent.restWorldRotation), joint.restWorldRotation);
      targetWorldRotations[name] = multiplyQuaternions(parentTarget, multiplyQuaternions(relativeRest, deltas[name]!));
    } else {
      targetWorldRotations[name] = multiplyQuaternions(joint.restWorldRotation, deltas[name]!);
    }
  }
  return { deltas, targetWorldRotations, aggregateClamped };
}
