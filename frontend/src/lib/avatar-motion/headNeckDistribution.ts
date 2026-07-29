import type { QuaternionData } from "./avatarPoseTypes";
import { avatarLocalQuaternionFromSemanticEuler, type HeadEulerDegrees } from "./headOrientation";
import { inverseQuaternion, multiplyQuaternions } from "./motionMath";

export type HeadNeckDistributionMode = "distributed" | "head-only-fallback" | "unsupported";
export interface HeadNeckAxisDistributionConfig { lightHeadShare: number; largeHeadShare: number; largeMotionStartsDegrees: number; largeMotionFullDegrees: number }
export interface HeadNeckDistributionConfig { yaw: HeadNeckAxisDistributionConfig; pitch: HeadNeckAxisDistributionConfig; roll: HeadNeckAxisDistributionConfig }
export interface HeadNeckAxisDistribution { magnitudeDegrees: number; progress: number; headShare: number; neckShare: number }
export interface HeadNeckDistributionResult {
  mode: HeadNeckDistributionMode;
  axes: { yaw: HeadNeckAxisDistribution; pitch: HeadNeckAxisDistribution; roll: HeadNeckAxisDistribution };
  total: QuaternionData;
  neck: QuaternionData | null;
  head: QuaternionData | null;
}

export const DEFAULT_HEAD_NECK_DISTRIBUTION_CONFIG: HeadNeckDistributionConfig = {
  yaw: { lightHeadShare: .75, largeHeadShare: .5, largeMotionStartsDegrees: 15, largeMotionFullDegrees: 45 },
  pitch: { lightHeadShare: .7, largeHeadShare: .5, largeMotionStartsDegrees: 10, largeMotionFullDegrees: 35 },
  roll: { lightHeadShare: .75, largeHeadShare: .55, largeMotionStartsDegrees: 10, largeMotionFullDegrees: 30 },
};

const smoothstep = (value: number): number => { const t = Math.min(1, Math.max(0, value)); return t * t * (3 - 2 * t); };
function distributeAxis(value: number, config: HeadNeckAxisDistributionConfig, distributed: boolean): HeadNeckAxisDistribution {
  const magnitudeDegrees = Math.abs(Number.isFinite(value) ? value : 0);
  const range = Math.max(1e-6, config.largeMotionFullDegrees - config.largeMotionStartsDegrees);
  const progress = smoothstep((magnitudeDegrees - config.largeMotionStartsDegrees) / range);
  const headShare = distributed ? config.lightHeadShare + (config.largeHeadShare - config.lightHeadShare) * progress : 1;
  return { magnitudeDegrees, progress, headShare, neckShare: 1 - headShare };
}

export function distributeHeadNeckRotation(
  semantic: HeadEulerDegrees,
  capability: { head: boolean; neck: boolean; headRestLocalRotation?: QuaternionData },
  config: HeadNeckDistributionConfig = DEFAULT_HEAD_NECK_DISTRIBUTION_CONFIG,
): HeadNeckDistributionResult {
  const mode: HeadNeckDistributionMode = !capability.head ? "unsupported" : capability.neck ? "distributed" : "head-only-fallback";
  const distributed = mode === "distributed";
  const axes = {
    yaw: distributeAxis(semantic.yaw, config.yaw, distributed),
    pitch: distributeAxis(semantic.pitch, config.pitch, distributed),
    roll: distributeAxis(semantic.roll, config.roll, distributed),
  };
  const total = avatarLocalQuaternionFromSemanticEuler(semantic);
  if (mode === "unsupported") return { mode, axes, total, neck: null, head: null };
  if (!distributed) return { mode, axes, total, neck: null, head: total };
  const neckEuler = { yaw: semantic.yaw * axes.yaw.neckShare, pitch: semantic.pitch * axes.pitch.neckShare, roll: semantic.roll * axes.roll.neckShare };
  const neck = avatarLocalQuaternionFromSemanticEuler(neckEuler);
  // Residual guarantees neck × head == total even when combined Euler axes do not commute.
  const headRest = capability.headRestLocalRotation ?? { x: 0, y: 0, z: 0, w: 1 };
  // Rn·Dn·Rh·Dh = Rn·Rh·T  =>  Dh = Rh⁻¹·Dn⁻¹·Rh·T.
  const head = multiplyQuaternions(multiplyQuaternions(multiplyQuaternions(inverseQuaternion(headRest), inverseQuaternion(neck)), headRest), total);
  return { mode, axes, total, neck, head };
}
