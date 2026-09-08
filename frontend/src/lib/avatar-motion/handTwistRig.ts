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

export interface AbsoluteRigPalmTwistInput {
  forearmAxisWorld: Vector3Data;
  observedPalmNormalWorld: Vector3Data;
  restPalmNormalWorld: Vector3Data;
  lowerRestWorldRotation: QuaternionData;
  lowerTargetWorldRotation: QuaternionData;
}

/**
 * So sánh lòng bàn tay thật với hướng lòng bàn tay mà pose-only của đúng VRM sẽ tạo ra. Khác calibration
 * tương đối theo phiên, góc 0 ở đây có nghĩa tuyệt đối: palm của avatar đã trùng palm quan sát.
 */
export function computeAbsoluteRigPalmTwist(input: AbsoluteRigPalmTwistInput): { accepted: boolean; twistRadians: number | null; rejectionReason: string | null } {
  const axis = new Vector3(input.forearmAxisWorld.x, input.forearmAxisWorld.y, input.forearmAxisWorld.z);
  const observed = new Vector3(input.observedPalmNormalWorld.x, input.observedPalmNormalWorld.y, input.observedPalmNormalWorld.z);
  const restPalm = new Vector3(input.restPalmNormalWorld.x, input.restPalmNormalWorld.y, input.restPalmNormalWorld.z);
  const restRotation = new Quaternion(input.lowerRestWorldRotation.x, input.lowerRestWorldRotation.y, input.lowerRestWorldRotation.z, input.lowerRestWorldRotation.w);
  const targetRotation = new Quaternion(input.lowerTargetWorldRotation.x, input.lowerTargetWorldRotation.y, input.lowerTargetWorldRotation.z, input.lowerTargetWorldRotation.w);
  if (![axis.x, axis.y, axis.z, observed.x, observed.y, observed.z, restPalm.x, restPalm.y, restPalm.z, restRotation.x, restRotation.y, restRotation.z, restRotation.w, targetRotation.x, targetRotation.y, targetRotation.z, targetRotation.w].every(Number.isFinite)
    || axis.lengthSq() < 1e-8 || observed.lengthSq() < 1e-8 || restPalm.lengthSq() < 1e-8 || restRotation.lengthSq() < 1e-8 || targetRotation.lengthSq() < 1e-8) {
    return { accepted: false, twistRadians: null, rejectionReason: "invalid-rig-palm-reference" };
  }
  axis.normalize(); observed.normalize(); restPalm.normalize(); restRotation.normalize(); targetRotation.normalize();
  // Đưa pháp tuyến rest vào local lower-arm, rồi quay bằng target pose-only để biết palm avatar hiện tại.
  const localPalm = restPalm.applyQuaternion(restRotation.clone().invert());
  const posePalm = localPalm.applyQuaternion(targetRotation);
  observed.addScaledVector(axis, -observed.dot(axis)); posePalm.addScaledVector(axis, -posePalm.dot(axis));
  if (observed.lengthSq() < 1e-8 || posePalm.lengthSq() < 1e-8) return { accepted: false, twistRadians: null, rejectionReason: "degenerate-palm-projection" };
  observed.normalize(); posePalm.normalize();
  const twistRadians = Math.atan2(new Vector3().crossVectors(posePalm, observed).dot(axis), posePalm.dot(observed));
  return Number.isFinite(twistRadians)
    ? { accepted: true, twistRadians, rejectionReason: null }
    : { accepted: false, twistRadians: null, rejectionReason: "non-finite-rig-palm-twist" };
}
