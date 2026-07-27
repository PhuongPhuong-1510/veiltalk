import type { QuaternionData } from "../avatar-motion/avatarPoseTypes";
import { normalizeQuaternion } from "../avatar-motion/coordinateAdapter";

export const dampingAlpha = (rate: number, deltaSeconds: number) => 1 - Math.exp(-Math.max(0, rate) * Math.max(0, deltaSeconds));
export const dampScalar = (current: number, target: number, rate: number, deltaSeconds: number) => current + (target - current) * dampingAlpha(rate, deltaSeconds);

export function slerpQuaternion(current: QuaternionData, target: QuaternionData, alpha: number): QuaternionData {
  let dot = current.x * target.x + current.y * target.y + current.z * target.z + current.w * target.w;
  let end = target;
  if (dot < 0) { dot = -dot; end = { x: -target.x, y: -target.y, z: -target.z, w: -target.w }; }
  if (dot > 0.9995) return normalizeQuaternion({ x: current.x + alpha * (end.x - current.x), y: current.y + alpha * (end.y - current.y), z: current.z + alpha * (end.z - current.z), w: current.w + alpha * (end.w - current.w) }) ?? current;
  const theta = Math.acos(Math.min(1, dot)); const sinTheta = Math.sin(theta);
  const a = Math.sin((1 - alpha) * theta) / sinTheta; const b = Math.sin(alpha * theta) / sinTheta;
  return { x: current.x * a + end.x * b, y: current.y * a + end.y * b, z: current.z * a + end.z * b, w: current.w * a + end.w * b };
}

