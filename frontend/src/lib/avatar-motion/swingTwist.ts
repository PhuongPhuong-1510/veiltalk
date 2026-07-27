import type { QuaternionData, Vector3Data } from "./avatarPoseTypes";
import { quaternion, quaternionData, vector } from "./motionMath";

export interface SwingTwist { swing: QuaternionData; twist: QuaternionData; twistRadians: number }

export function decomposeSwingTwist(value: QuaternionData, axis: Vector3Data): SwingTwist | null {
  const q = quaternion(value).normalize(); if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w); const a = vector(axis).normalize();
  if (!Number.isFinite(a.lengthSq()) || a.lengthSq() < 1e-8) return null;
  const projection = a.clone().multiplyScalar(q.x * a.x + q.y * a.y + q.z * a.z);
  const twistLength = Math.hypot(projection.x, projection.y, projection.z, q.w);
  const twist = twistLength < 1e-8 ? { x: 0, y: 0, z: 0, w: 1 } : quaternionData(quaternion({ x: projection.x, y: projection.y, z: projection.z, w: q.w }).normalize());
  const swing = quaternionData(q.clone().multiply(quaternion(twist).invert()).normalize());
  const sign = projection.dot(vector(axis)) < 0 ? -1 : 1;
  return { swing, twist, twistRadians: 2 * Math.atan2(Math.hypot(twist.x, twist.y, twist.z) * sign, twist.w) };
}

export function composeSwingTwist(value: SwingTwist): QuaternionData {
  return quaternionData(quaternion(value.swing).multiply(quaternion(value.twist)).normalize());
}
