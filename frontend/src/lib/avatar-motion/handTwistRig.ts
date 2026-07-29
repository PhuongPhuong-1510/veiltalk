import { Quaternion, Vector3 } from "three";
import type { ArmSide } from "./avatarMotionDiagnostics";
import type { HandBasisResult } from "./handPalmBasis";
import type { QuaternionData, Vector3Data } from "./avatarPoseTypes";

/** Convention v1 đã kiểm chứng cho MediaPipe Hand world basis. */
export interface HandTwistRigConvention {
  selectedPalmAxis: "normal";
  chiralityNormalMultiplier: { left: -1; right: 1 };
  configuredPositiveSign: { left: 1; right: 1 };
  /**
   * Solver đã trả semantic giải phẫu thống nhất giữa hai bên. Trục `primaryLocal` của rig mang
   * sẵn hướng trái/phải, vì vậy không đảo tay phải lần hai tại boundary áp quaternion.
   */
  rigApplicationSign: { left: 1; right: 1 };
}

export const HAND_TWIST_RIG_CONVENTION_V1: HandTwistRigConvention = Object.freeze({
  selectedPalmAxis: "normal",
  chiralityNormalMultiplier: Object.freeze({ left: -1, right: 1 }),
  configuredPositiveSign: Object.freeze({ left: 1, right: 1 }),
  rigApplicationSign: Object.freeze({ left: 1, right: 1 }),
});

function handWorldVectorToMotionFrame(value: Vector3Data): Vector3Data {
  return { x: value.x, y: -value.y, z: -value.z };
}

/**
 * Coordinate boundary duy nhất của 2B-5: Hand Landmarker world basis dùng raw frame, còn Pose
 * forearm axis/reference dùng motion frame `(x,-y,-z)`. Đổi đồng bộ toàn basis trước mọi
 * chirality correction để cross-product orientation và orthogonality được bảo toàn.
 */
export function handWorldBasisToMotionFrame(basis: HandBasisResult): HandBasisResult {
  return {
    across: handWorldVectorToMotionFrame(basis.across),
    forward: handWorldVectorToMotionFrame(basis.forward),
    normal: handWorldVectorToMotionFrame(basis.normal),
  };
}

export function normalizePalmBasisForTwist(
  side: ArmSide,
  basis: HandBasisResult,
  convention: HandTwistRigConvention = HAND_TWIST_RIG_CONVENTION_V1,
): { basis: HandBasisResult; chiralityCorrectionApplied: boolean } {
  const motionBasis = handWorldBasisToMotionFrame(basis);
  const multiplier = convention.chiralityNormalMultiplier[side];
  return {
    basis: {
      across: motionBasis.across,
      forward: motionBasis.forward,
      normal: {
        x: motionBasis.normal.x * multiplier,
        y: motionBasis.normal.y * multiplier,
        z: motionBasis.normal.z * multiplier,
      },
    },
    chiralityCorrectionApplied: multiplier === -1,
  };
}

export function composePoseLowerArmWithHandTwist(
  poseLowerDelta: QuaternionData,
  primaryLocal: Vector3Data,
  appliedTwistRadians: number,
): QuaternionData | null {
  if (!Number.isFinite(appliedTwistRadians)) return null;
  const axis = new Vector3(primaryLocal.x, primaryLocal.y, primaryLocal.z);
  if (![axis.x, axis.y, axis.z].every(Number.isFinite) || axis.lengthSq() < 1e-8) return null;
  const pose = new Quaternion(poseLowerDelta.x, poseLowerDelta.y, poseLowerDelta.z, poseLowerDelta.w);
  if (![pose.x, pose.y, pose.z, pose.w].every(Number.isFinite) || pose.lengthSq() < 1e-8) return null;
  // Đúng thứ tự đã duyệt: outputDelta = poseLowerDelta * handTwistDelta.
  const output = pose.normalize().multiply(new Quaternion().setFromAxisAngle(axis.normalize(), appliedTwistRadians)).normalize();
  return { x: output.x, y: output.y, z: output.z, w: output.w };
}
