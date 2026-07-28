import { Matrix4, Quaternion, Vector3 } from "three";
import type { QuaternionData, Vector3Data } from "./avatarPoseTypes";

export const vector = (value: Vector3Data) => new Vector3(value.x, value.y, value.z);
export const quaternion = (value: QuaternionData) => new Quaternion(value.x, value.y, value.z, value.w);
export const vectorData = (value: Vector3): Vector3Data => ({ x: value.x, y: value.y, z: value.z });
export const quaternionData = (value: Quaternion): QuaternionData => ({ x: value.x, y: value.y, z: value.z, w: value.w });
/** Mức 1B-3: góc quay (độ) giữa hai quaternion, dùng cho diagnostic angular-delta liên frame. */
export const angularDeltaDegrees = (a: QuaternionData, b: QuaternionData): number => quaternion(a).angleTo(quaternion(b)) * 180 / Math.PI;
/** Góc lệch (độ) giữa hai hướng vector đơn vị, dùng cho poleAngularDeltaDeg. */
export const vectorAngularDeltaDegrees = (a: Vector3Data, b: Vector3Data): number => vector(a).angleTo(vector(b)) * 180 / Math.PI;

export function quaternionFromBasis(primary: Vector3Data, secondary: Vector3Data, binormal: Vector3Data): QuaternionData | null {
  const x = vector(primary).normalize();
  const y = vector(secondary).addScaledVector(x, -vector(secondary).dot(x)).normalize();
  const z = new Vector3().crossVectors(x, y).normalize();
  if (![x, y, z].every((value) => Number.isFinite(value.lengthSq()) && value.lengthSq() > 1e-8)) return null;
  if (z.dot(vector(binormal)) < 0) { y.negate(); z.negate(); }
  return quaternionData(new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z)).normalize());
}

export function rotateVector(rotation: QuaternionData, value: Vector3Data): Vector3Data {
  return vectorData(vector(value).applyQuaternion(quaternion(rotation)));
}

export function slerpQuaternionData(from: QuaternionData, to: QuaternionData, alpha: number): QuaternionData {
  const a = quaternion(from).normalize(); const b = quaternion(to).normalize();
  if (a.dot(b) < 0) b.set(-b.x, -b.y, -b.z, -b.w);
  return quaternionData(a.slerp(b, Math.min(1, Math.max(0, alpha))).normalize());
}

export const multiplyQuaternions = (a: QuaternionData, b: QuaternionData): QuaternionData => quaternionData(quaternion(a).multiply(quaternion(b)).normalize());
export const inverseQuaternion = (value: QuaternionData): QuaternionData => quaternionData(quaternion(value).invert().normalize());
