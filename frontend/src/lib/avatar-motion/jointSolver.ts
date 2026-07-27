import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { QuaternionData, Vector3Data } from "./avatarPoseTypes";
import type { ControlledArmJoint, NormalizedAvatarRigProfile } from "./normalizedRigProfile";
import { normalizeQuaternion, quaternionFromUnitVectors, subtract } from "./coordinateAdapter";
import { constrainJointRotation } from "./jointConstraints";
import { solveAnatomicalArmFrames } from "./armFrameSolver";

const ORDER: ControlledArmJoint[] = ["leftUpperArm", "leftLowerArm", "rightUpperArm", "rightLowerArm"];
const SEGMENTS: Record<ControlledArmJoint, [number, number]> = { leftUpperArm: [11, 13], leftLowerArm: [13, 15], rightUpperArm: [12, 14], rightLowerArm: [14, 16] };
const multiply = (a: QuaternionData, b: QuaternionData): QuaternionData => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
const inverse = (q: QuaternionData): QuaternionData => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

export interface ArmSolveResult {
  deltas: Partial<Record<ControlledArmJoint, QuaternionData>>;
  targetWorldRotations: Partial<Record<ControlledArmJoint, QuaternionData>>;
}

export function solveParentLocalArmRotations(
  landmarks: RawNormalizedLandmarkV1[], profile: NormalizedAvatarRigProfile, constraintsEnabled = true,
  directionFilter?: (name: ControlledArmJoint, direction: Vector3Data) => Vector3Data,
): ArmSolveResult {
  const deltas: ArmSolveResult["deltas"] = {}; const targetWorldRotations: ArmSolveResult["targetWorldRotations"] = {};
  for (const name of ORDER) {
    const joint = profile.joints[name]; const [fromIndex, toIndex] = SEGMENTS[name]; const from = landmarks[fromIndex], to = landmarks[toIndex]; if (!from || !to) continue;
    const rawDirection = subtract(to, from); const targetDirection = directionFilter?.(name, rawDirection) ?? rawDirection;
    const swingWorld = quaternionFromUnitVectors(joint.restWorldDirection, targetDirection); if (!swingWorld) continue;
    const targetWorld = normalizeQuaternion(multiply(swingWorld, joint.restWorldRotation)); if (!targetWorld) continue;
    const parentTargetWorld = joint.parentMode === "controlled" && joint.controlledParentJoint ? targetWorldRotations[joint.controlledParentJoint] : joint.parentRestWorldRotation;
    if (!parentTargetWorld) continue;
    const targetLocal = normalizeQuaternion(multiply(inverse(parentTargetWorld), targetWorld)); if (!targetLocal) continue;
    const deltaLocal = normalizeQuaternion(multiply(inverse(joint.restLocalRotation), targetLocal)); if (!deltaLocal) continue;
    const safe = constraintsEnabled ? constrainJointRotation(name, deltaLocal) : deltaLocal; if (!safe) continue;
    deltas[name] = safe;
    // Constraint thay đổi local delta nên target hierarchy phải dùng chính target đã constrained.
    targetWorldRotations[name] = normalizeQuaternion(multiply(parentTargetWorld, multiply(joint.restLocalRotation, safe))) ?? targetWorld;
  }
  return { deltas, targetWorldRotations };
}

export const solvePoseJointRotations = solveParentLocalArmRotations;

/** Phase 3A entry point; legacy one-vector solver phía trên chỉ giữ cho DEV baseline. */
export { solveAnatomicalArmFrames };
