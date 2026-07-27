import type { AvatarJointName, QuaternionData } from "./avatarPoseTypes";
import { normalizeQuaternion } from "./coordinateAdapter";

export interface JointLimit { maxAngleRadians: number; reason: string }
export const JOINT_LIMITS: Partial<Record<AvatarJointName, JointLimit>> = {
  leftShoulder: { maxAngleRadians: 2.62, reason: "Giới hạn thử nghiệm 150° quanh rest pose" },
  rightShoulder: { maxAngleRadians: 2.62, reason: "Giới hạn thử nghiệm 150° quanh rest pose" },
  leftUpperArm: { maxAngleRadians: 2.62, reason: "Giới hạn thử nghiệm 150° quanh rest pose" },
  rightUpperArm: { maxAngleRadians: 2.62, reason: "Giới hạn thử nghiệm 150° quanh rest pose" },
  leftLowerArm: { maxAngleRadians: 2.44, reason: "Giới hạn thử nghiệm khuỷu 140°" },
  rightLowerArm: { maxAngleRadians: 2.44, reason: "Giới hạn thử nghiệm khuỷu 140°" },
  leftHand: { maxAngleRadians: 1.4, reason: "Giới hạn thử nghiệm cổ tay 80°" },
  rightHand: { maxAngleRadians: 1.4, reason: "Giới hạn thử nghiệm cổ tay 80°" },
};

export function constrainJointRotation(name: AvatarJointName, value: QuaternionData): QuaternionData | null {
  const normalized = normalizeQuaternion(value); if (!normalized) return null;
  const limit = JOINT_LIMITS[name]; if (!limit) return normalized;
  const angle = 2 * Math.acos(Math.min(1, Math.abs(normalized.w)));
  if (angle <= limit.maxAngleRadians) return normalized;
  const vectorLength = Math.hypot(normalized.x, normalized.y, normalized.z);
  if (vectorLength < 1e-6) return { x: 0, y: 0, z: 0, w: 1 };
  const half = limit.maxAngleRadians / 2;
  const scale = Math.sin(half) / vectorLength;
  return { x: normalized.x * scale, y: normalized.y * scale, z: normalized.z * scale, w: Math.cos(half) };
}

