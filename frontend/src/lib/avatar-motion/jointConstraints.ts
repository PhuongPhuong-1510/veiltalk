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

export function constrainJointRotation(name: AvatarJointName, value: QuaternionData, previous?: QuaternionData | null): QuaternionData | null {
  let normalized = normalizeQuaternion(value); if (!normalized) return null;
  // q and -q must produce the same limited rotation, including beyond the angle cap.
  const firstAxis = [normalized.x, normalized.y, normalized.z].reduce((best, component) => Math.abs(component) > Math.abs(best) ? component : best, 0);
  if (normalized.w < -1e-12 || Math.abs(normalized.w) <= 1e-12 && firstAxis < 0) normalized = { x: -normalized.x, y: -normalized.y, z: -normalized.z, w: -normalized.w };
  const limit = JOINT_LIMITS[name]; if (!limit) return normalized;
  const angle = 2 * Math.acos(Math.min(1, Math.abs(normalized.w)));
  if (angle <= limit.maxAngleRadians) return normalized;
  const vectorLength = Math.hypot(normalized.x, normalized.y, normalized.z);
  if (vectorLength < 1e-6) return { x: 0, y: 0, z: 0, w: 1 };
  const half = limit.maxAngleRadians / 2;
  const scale = Math.sin(half) / vectorLength;
  const limited = { x: normalized.x * scale, y: normalized.y * scale, z: normalized.z * scale, w: Math.cos(half) };
  // At the antipodal rest direction, tiny measurement noise can reverse the shortest-axis
  // representation. Both capped branches are feasible. Prefer the branch already represented
  // by the last detector target inside a narrow singularity band, rather than flipping ~60°.
  if (previous && angle > Math.PI - 0.1) {
    const prior = normalizeQuaternion(previous);
    if (prior) {
      const alternate = { x: -limited.x, y: -limited.y, z: -limited.z, w: limited.w };
      const similarity = (q: QuaternionData) => Math.abs(prior.x*q.x+prior.y*q.y+prior.z*q.z+prior.w*q.w);
      if (similarity(alternate) > similarity(limited)) return alternate;
    }
  }
  return limited;
}

