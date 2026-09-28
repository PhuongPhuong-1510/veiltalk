import { Quaternion, Vector3 } from "three";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { AvatarJointName, QuaternionData, Vector3Data } from "./avatarPoseTypes";
import type { ControlledArmJoint, NormalizedAvatarRigProfile } from "./normalizedRigProfile";
import { normalizeQuaternion, subtract } from "./coordinateAdapter";
import { quaternionFromBasis } from "./motionMath";
import { constrainJointRotation } from "./jointConstraints";
import { solveAnatomicalArmFrames } from "./armFrameSolver";

const ORDER: ControlledArmJoint[] = ["leftUpperArm", "leftLowerArm", "rightUpperArm", "rightLowerArm"];
const SEGMENTS: Record<ControlledArmJoint, [number, number]> = {
  leftUpperArm: [11, 13], leftLowerArm: [13, 15], rightUpperArm: [12, 14], rightLowerArm: [14, 16],
};

const multiply = (a: QuaternionData, b: QuaternionData): QuaternionData => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});
const inverse = (q: QuaternionData): QuaternionData => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
const vector = (v: Vector3Data): Vector3 => new Vector3(v.x, v.y, v.z);
const vectorData = (v: Vector3): Vector3Data => ({ x: v.x, y: v.y, z: v.z });
const quaternion = (q: QuaternionData): Quaternion => new Quaternion(q.x, q.y, q.z, q.w).normalize();

function transportedSecondary(primary: Vector3, previousPrimary: Vector3, previousSecondary: Vector3): Vector3 | null {
  if (primary.lengthSq() <= 1e-8 || previousPrimary.lengthSq() <= 1e-8 || previousSecondary.lengthSq() <= 1e-8) return null;
  const from = previousPrimary.clone().normalize();
  const to = primary.clone().normalize();
  const rotation = new Quaternion().setFromUnitVectors(from, to);
  const transported = previousSecondary.clone().applyQuaternion(rotation);
  transported.addScaledVector(to, -transported.dot(to));
  return transported.lengthSq() > 1e-8 ? transported.normalize() : null;
}

function animatedRestAxes(
  joint: NormalizedAvatarRigProfile["joints"][ControlledArmJoint],
  parentWorld: QuaternionData,
): { primary: Vector3; secondary: Vector3; binormal: Vector3 } {
  const parentDelta = quaternion(parentWorld).multiply(quaternion(joint.parentRestWorldRotation).invert()).normalize();
  return {
    primary: vector(joint.anatomicalRestBasis.primaryWorld).applyQuaternion(parentDelta).normalize(),
    secondary: vector(joint.anatomicalRestBasis.secondaryWorld).applyQuaternion(parentDelta).normalize(),
    binormal: vector(joint.anatomicalRestBasis.binormalWorld).applyQuaternion(parentDelta).normalize(),
  };
}

export interface ArmSolveResult {
  deltas: Partial<Record<ControlledArmJoint, QuaternionData>>;
  targetWorldRotations: Partial<Record<ControlledArmJoint, QuaternionData>>;
}

export interface ArmRotationSolveOptions {
  /**
   * Current world rotation of non-controlled parents (normally left/right shoulder).
   * Contact IK must use the posed parent, not the rest parent, otherwise a correct world target
   * is converted into the wrong parent-local delta whenever torso/shoulder animation is active.
   */
  fixedParentWorldRotations?: Partial<Record<AvatarJointName, QuaternionData>>;
}

function projectSecondary(primary: Vector3, candidate: Vector3Data): Vector3 | null {
  const value = vector(candidate);
  value.addScaledVector(primary, -value.dot(primary));
  if (value.lengthSq() <= 1e-8) return null;
  return value.normalize();
}

function targetBoneWorld(
  primary: Vector3,
  secondary: Vector3,
  joint: NormalizedAvatarRigProfile["joints"][ControlledArmJoint],
): QuaternionData | null {
  const p = primary.clone();
  if (p.lengthSq() <= 1e-8) return null;
  p.normalize();
  const s = secondary.clone().addScaledVector(p, -secondary.dot(p));
  if (s.lengthSq() <= 1e-8) return null;
  s.normalize();
  const binormal = p.clone().cross(s);
  if (binormal.lengthSq() <= 1e-8) return null;
  binormal.normalize();
  s.copy(binormal).cross(p).normalize();
  const targetFrame = quaternionFromBasis(vectorData(p), vectorData(s), vectorData(binormal));
  if (!targetFrame) return null;
  return normalizeQuaternion(multiply(multiply(targetFrame, inverse(joint.anatomicalRestBasis.worldRotation)), joint.restWorldRotation));
}

/**
 * Convert target shoulder→elbow→wrist geometry into parent-local rest-relative rotations.
 *
 * This used to be a one-vector swing solver. That was sufficient for an old DEV baseline but it
 * gave AR9 a different arm-frame convention from the production anatomical solver. The current
 * version constructs a full orthonormal frame and uses minimal-twist secondary axes derived from
 * the rig rest basis / parent segment. It still accepts the old call signature.
 */
export function solveParentLocalArmRotations(
  landmarks: RawNormalizedLandmarkV1[],
  profile: NormalizedAvatarRigProfile,
  constraintsEnabled = true,
  directionFilter?: (name: ControlledArmJoint, direction: Vector3Data) => Vector3Data,
  options: ArmRotationSolveOptions = {},
): ArmSolveResult {
  const deltas: ArmSolveResult["deltas"] = {};
  const targetWorldRotations: ArmSolveResult["targetWorldRotations"] = {};
  const targetSecondaries: Partial<Record<ControlledArmJoint, Vector3>> = {};

  for (const name of ORDER) {
    const joint = profile.joints[name];
    const [fromIndex, toIndex] = SEGMENTS[name];
    const from = landmarks[fromIndex], to = landmarks[toIndex];
    if (!from || !to) continue;

    const rawDirection = subtract(to, from);
    const filteredDirection = directionFilter?.(name, rawDirection) ?? rawDirection;
    const primary = vector(filteredDirection);
    if (![primary.x, primary.y, primary.z].every(Number.isFinite) || primary.lengthSq() <= 1e-8) continue;
    primary.normalize();

    const parentTargetWorld = joint.parentMode === "controlled" && joint.controlledParentJoint
      ? targetWorldRotations[joint.controlledParentJoint]
      : options.fixedParentWorldRotations?.[joint.parentJoint] ?? joint.parentRestWorldRotation;
    if (!parentTargetWorld) continue;

    let secondary: Vector3 | null = null;
    if (joint.controlledParentJoint) {
      // Lower arm inherits the constrained upper-arm frame, then projects that secondary onto
      // its own normal plane. This mirrors the production anatomical solver's lower-frame policy.
      const parentSecondary = targetSecondaries[joint.controlledParentJoint];
      if (parentSecondary) {
        const projected = parentSecondary.clone().addScaledVector(primary, -parentSecondary.dot(primary));
        if (projected.lengthSq() > 1e-8) secondary = projected.normalize();
      }
    } else {
      // Upper arm uses a parallel-transported rest frame under the CURRENT shoulder parent.
      // This is minimal-twist swing, not arbitrary projection of a rest-world axis.
      const rest = animatedRestAxes(joint, parentTargetWorld);
      secondary = transportedSecondary(primary, rest.primary, rest.secondary)
        ?? projectSecondary(primary, vectorData(rest.secondary))
        ?? projectSecondary(primary, vectorData(rest.binormal));
    }
    secondary ??= projectSecondary(primary, joint.anatomicalRestBasis.secondaryWorld);
    secondary ??= projectSecondary(primary, joint.anatomicalRestBasis.binormalWorld);
    if (!secondary) continue;

    const targetWorld = targetBoneWorld(primary, secondary, joint);
    if (!targetWorld) continue;

    const targetLocal = normalizeQuaternion(multiply(inverse(parentTargetWorld), targetWorld));
    if (!targetLocal) continue;
    const deltaLocal = normalizeQuaternion(multiply(inverse(joint.restLocalRotation), targetLocal));
    if (!deltaLocal) continue;
    const safe = constraintsEnabled ? constrainJointRotation(name, deltaLocal) : deltaLocal;
    if (!safe) continue;

    deltas[name] = safe;
    const constrainedWorld = normalizeQuaternion(multiply(parentTargetWorld, multiply(joint.restLocalRotation, safe))) ?? targetWorld;
    targetWorldRotations[name] = constrainedWorld;

    // Store the secondary actually represented by the constrained world rotation. Using the
    // requested secondary after a constraint clamp would let the child inherit a frame that the
    // parent no longer has.
    const restSecondaryLocal = vector(joint.anatomicalRestBasis.secondaryLocal);
    targetSecondaries[name] = restSecondaryLocal.applyQuaternion(
      new Quaternion(constrainedWorld.x, constrainedWorld.y, constrainedWorld.z, constrainedWorld.w),
    ).normalize();
  }

  return { deltas, targetWorldRotations };
}

export const solvePoseJointRotations = solveParentLocalArmRotations;

/** Phase 3A production entry point. */
export { solveAnatomicalArmFrames };
