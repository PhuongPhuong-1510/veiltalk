import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { QuaternionData, Vector3Data } from "./avatarPoseTypes";

const EPSILON = 1e-6;
export const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
export const subtract = (to: RawNormalizedLandmarkV1, from: RawNormalizedLandmarkV1): Vector3Data => ({
  x: to.x - from.x,
  // MediaPipe image/world Y đi xuống; motion semantic dùng Y đi lên.
  y: -(to.y - from.y),
  z: -(to.z - from.z),
});
export const magnitude = (value: Vector3Data) => Math.hypot(value.x, value.y, value.z);
export const normalizeVector = (value: Vector3Data): Vector3Data | null => {
  const length = magnitude(value);
  return length < EPSILON || !Number.isFinite(length) ? null : { x: value.x / length, y: value.y / length, z: value.z / length };
};
export const normalizeQuaternion = (value: QuaternionData): QuaternionData | null => {
  const length = Math.hypot(value.x, value.y, value.z, value.w);
  return length < EPSILON || !Number.isFinite(length) ? null : { x: value.x / length, y: value.y / length, z: value.z / length, w: value.w / length };
};

export function quaternionFromUnitVectors(from: Vector3Data, to: Vector3Data): QuaternionData | null {
  const a = normalizeVector(from); const b = normalizeVector(to);
  if (!a || !b) return null;
  let x = a.y * b.z - a.z * b.y;
  let y = a.z * b.x - a.x * b.z;
  let z = a.x * b.y - a.y * b.x;
  let w = 1 + a.x * b.x + a.y * b.y + a.z * b.z;
  if (w < EPSILON) {
    if (Math.abs(a.x) > Math.abs(a.z)) { x = -a.y; y = a.x; z = 0; }
    else { x = 0; y = -a.z; z = a.y; }
    w = 0;
  }
  return normalizeQuaternion({ x, y, z, w });
}

export function quaternionFromRotationMatrix(data: number[]): QuaternionData | null {
  if (data.length < 16 || data.some((value) => !Number.isFinite(value))) return null;
  // MediaPipe matrix là column-major 4x4. Chuyển rotation sang quaternion rồi đổi dấu Y/Z sang semantic axes.
  const m00 = data[0], m11 = data[5], m22 = data[10];
  const trace = m00 + m11 + m22;
  let q: QuaternionData;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = { w: s / 4, x: (data[6] - data[9]) / s, y: (data[8] - data[2]) / s, z: (data[1] - data[4]) / s };
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = { w: (data[6] - data[9]) / s, x: s / 4, y: (data[4] + data[1]) / s, z: (data[8] + data[2]) / s };
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = { w: (data[8] - data[2]) / s, x: (data[4] + data[1]) / s, y: s / 4, z: (data[9] + data[6]) / s };
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = { w: (data[1] - data[4]) / s, x: (data[8] + data[2]) / s, y: (data[9] + data[6]) / s, z: s / 4 };
  }
  return normalizeQuaternion({ x: q.x, y: -q.y, z: -q.z, w: q.w });
}

