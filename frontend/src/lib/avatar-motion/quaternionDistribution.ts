import { Quaternion, Vector3 } from "three";
import type { QuaternionData, Vector3Data } from "./avatarPoseTypes";

const EPSILON = 1e-8;

export interface AsymmetricRotationLimits {
  pitchUp: number;
  pitchDown: number;
  yawRight: number;
  yawLeft: number;
  rollRight: number;
  rollLeft: number;
}

export interface AxisWeights { pitch: number; yaw: number; roll: number }
export interface DistributedRotation {
  rotations: Record<string, QuaternionData>;
  residual: Vector3Data;
}

const finiteQuaternion = (q: QuaternionData) => [q.x, q.y, q.z, q.w].every(Number.isFinite)
  && Math.hypot(q.x, q.y, q.z, q.w) > EPSILON;

export function quaternionLog(value: QuaternionData): Vector3Data | null {
  if (!finiteQuaternion(value)) return null;
  const q = new Quaternion(value.x, value.y, value.z, value.w).normalize();
  if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
  const v = new Vector3(q.x, q.y, q.z);
  const length = v.length();
  if (length <= EPSILON) return { x: 0, y: 0, z: 0 };
  const angle = 2 * Math.atan2(length, Math.max(0, q.w));
  return { x: v.x * angle / length, y: v.y * angle / length, z: v.z * angle / length };
}

export function quaternionExp(rotation: Vector3Data): QuaternionData | null {
  if (![rotation.x, rotation.y, rotation.z].every(Number.isFinite)) return null;
  const angle = Math.hypot(rotation.x, rotation.y, rotation.z);
  if (angle <= EPSILON) return { x: 0, y: 0, z: 0, w: 1 };
  const scale = Math.sin(angle / 2) / angle;
  const q = new Quaternion(rotation.x * scale, rotation.y * scale, rotation.z * scale, Math.cos(angle / 2)).normalize();
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

/** Vector convention: x=pitch, y=yaw, z=roll. Mọi limit phải là radian dương. */
export function clampRotationEllipsoid(rotation: Vector3Data, limits: AsymmetricRotationLimits): Vector3Data | null {
  if (![rotation.x, rotation.y, rotation.z, ...Object.values(limits)].every(Number.isFinite)
    || Object.values(limits).some((limit) => limit <= 0)) return null;
  const pitchLimit = rotation.x >= 0 ? limits.pitchUp : limits.pitchDown;
  const yawLimit = rotation.y >= 0 ? limits.yawRight : limits.yawLeft;
  const rollLimit = rotation.z >= 0 ? limits.rollRight : limits.rollLeft;
  const rhoSquared = (rotation.x / pitchLimit) ** 2 + (rotation.y / yawLimit) ** 2 + (rotation.z / rollLimit) ** 2;
  const scale = rhoSquared > 1 ? 1 / Math.sqrt(rhoSquared) : 1;
  return { x: rotation.x * scale, y: rotation.y * scale, z: rotation.z * scale };
}

export function clampQuaternionEllipsoid(value: QuaternionData, limits: AsymmetricRotationLimits): QuaternionData | null {
  const rotation = quaternionLog(value);
  const clamped = rotation && clampRotationEllipsoid(rotation, limits);
  return clamped ? quaternionExp(clamped) : null;
}

/**
 * Phân phối từng semantic axis trên các bone hiện hữu. Weight của bone thiếu được normalize;
 * cap được áp lặp và residual không thể nhận an toàn sẽ được trả về cho telemetry.
 */
export function distributeRotation(
  desired: Vector3Data,
  weights: Readonly<Record<string, AxisWeights>>,
  available: ReadonlySet<string>,
  limits: Readonly<Record<string, AsymmetricRotationLimits>>,
): DistributedRotation {
  const vectors: Record<string, Vector3Data> = {};
  for (const name of Object.keys(weights)) if (available.has(name)) vectors[name] = { x: 0, y: 0, z: 0 };
  const axes = [{ key: "pitch" as const, component: "x" as const }, { key: "yaw" as const, component: "y" as const }, { key: "roll" as const, component: "z" as const }];
  const residual: Vector3Data = { x: 0, y: 0, z: 0 };
  for (const axis of axes) {
    const candidates = Object.keys(vectors).filter((name) => weights[name][axis.key] > 0 && limits[name]);
    const sum = candidates.reduce((total, name) => total + weights[name][axis.key], 0);
    if (sum <= EPSILON) { residual[axis.component] = desired[axis.component]; continue; }
    for (const name of candidates) vectors[name][axis.component] = desired[axis.component] * weights[name][axis.key] / sum;
  }
  const rotations: Record<string, QuaternionData> = {};
  for (const [name, value] of Object.entries(vectors)) {
    const clamped = clampRotationEllipsoid(value, limits[name]);
    if (!clamped) continue;
    residual.x += value.x - clamped.x; residual.y += value.y - clamped.y; residual.z += value.z - clamped.z;
    const rotation = quaternionExp(clamped);
    if (rotation) rotations[name] = rotation;
  }
  return { rotations, residual };
}
