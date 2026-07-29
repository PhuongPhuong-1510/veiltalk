import { Euler, Matrix4, Quaternion } from "three";
import type { RawMatrixV1 } from "../tracking/rawTrackingTypes";
import type { QuaternionData } from "./avatarPoseTypes";
import { normalizeQuaternion, quaternionFromRotationMatrix } from "./coordinateAdapter";
import { inverseQuaternion, multiplyQuaternions } from "./motionMath";

export interface HeadEulerDegrees { yaw: number; pitch: number; roll: number }
export interface HeadAxisResponseConfig { deadZoneDegrees: number; gain: number; largeMotionBoost: number; boostReferenceDegrees: number; maximumInputDegrees: number; maximumOutputDegrees: number }
export interface HeadResponseConfig { yaw: HeadAxisResponseConfig; pitch: HeadAxisResponseConfig; roll: HeadAxisResponseConfig }
export interface HeadResponseResult { inputEulerDegrees: HeadEulerDegrees; outputEulerDegrees: HeadEulerDegrees; output: QuaternionData; inputClamped: boolean }

export const DEFAULT_HEAD_RESPONSE_CONFIG: HeadResponseConfig = {
  yaw: { deadZoneDegrees: 1.5, gain: 1.35, largeMotionBoost: .2, boostReferenceDegrees: 45, maximumInputDegrees: 85, maximumOutputDegrees: 75 },
  pitch: { deadZoneDegrees: 1.5, gain: 1.35, largeMotionBoost: .15, boostReferenceDegrees: 35, maximumInputDegrees: 70, maximumOutputDegrees: 55 },
  roll: { deadZoneDegrees: 2, gain: 1.2, largeMotionBoost: .12, boostReferenceDegrees: 30, maximumInputDegrees: 60, maximumOutputDegrees: 45 },
};
export type HeadOrientationRejectionReason = "not-tracked" | "invalid-matrix" | "neutral-unavailable";

export interface HeadOrientationResult {
  raw: QuaternionData | null;
  rawEulerDegrees: HeadEulerDegrees | null;
  neutral: QuaternionData | null;
  neutralRelative: QuaternionData | null;
  neutralRelativeEulerDegrees: HeadEulerDegrees | null;
  rejectionReason: HeadOrientationRejectionReason | null;
}

/** MediaPipe facial matrix is column-major; coordinateAdapter owns the single camera-to-motion conversion. */
export function facialTransformToMotionQuaternion(transform: RawMatrixV1 | null): QuaternionData | null {
  if (!transform || transform.rows !== 4 || transform.columns !== 4) return null;
  return quaternionFromRotationMatrix(transform.data);
}

/** Delta convention is inverse(neutral) * current, expressed in the verified motion frame. */
export function neutralRelativeHeadRotation(neutral: QuaternionData, current: QuaternionData): QuaternionData | null {
  return normalizeQuaternion(multiplyQuaternions(inverseQuaternion(neutral), current));
}

export function headEulerDegrees(rotation: QuaternionData): HeadEulerDegrees {
  const euler = new Euler().setFromQuaternion(new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w), "YXZ");
  const degrees = 180 / Math.PI;
  // MediaPipe camera pitch is opposite to the user-facing semantic: looking up must be positive pitch.
  return { yaw: euler.y * degrees, pitch: -euler.x * degrees, roll: euler.z * degrees };
}

function respondAxis(value: number, config: HeadAxisResponseConfig): { value: number; inputClamped: boolean } {
  const finite = Number.isFinite(value) ? value : 0;
  const clampedInput = Math.min(config.maximumInputDegrees, Math.max(-config.maximumInputDegrees, finite));
  const magnitude = Math.abs(clampedInput);
  if (magnitude <= config.deadZoneDegrees) return { value: 0, inputClamped: clampedInput !== value };
  const adjusted = magnitude - config.deadZoneDegrees;
  const boostProgress = Math.min(1, adjusted / Math.max(1e-6, config.boostReferenceDegrees));
  const scale = config.gain + config.largeMotionBoost * boostProgress * boostProgress;
  const output = Math.min(config.maximumOutputDegrees, adjusted * scale);
  return { value: Math.sign(clampedInput) * output, inputClamped: clampedInput !== value };
}

/** Continuous per-axis response. Dead-zone starts at zero without a threshold jump. */
export function applyHeadResponseCurve(rotation: QuaternionData, config: HeadResponseConfig = DEFAULT_HEAD_RESPONSE_CONFIG): HeadResponseResult {
  const inputEulerDegrees = headEulerDegrees(rotation);
  const yaw = respondAxis(inputEulerDegrees.yaw, config.yaw);
  const pitch = respondAxis(inputEulerDegrees.pitch, config.pitch);
  const roll = respondAxis(inputEulerDegrees.roll, config.roll);
  const outputEulerDegrees = { yaw: yaw.value, pitch: pitch.value, roll: roll.value };
  return { inputEulerDegrees, outputEulerDegrees, output: avatarLocalQuaternionFromSemanticEuler(outputEulerDegrees), inputClamped: yaw.inputClamped || pitch.inputClamped || roll.inputClamped };
}

export function avatarLocalQuaternionFromSemanticEuler(value: HeadEulerDegrees): QuaternionData {
  const radians = Math.PI / 180;
  // Renderer/avatar local X uses the semantic output sign; this intentionally inverts camera pitch.
  const q = new Quaternion().setFromEuler(new Euler(value.pitch * radians, value.yaw * radians, value.roll * radians, "YXZ")).normalize();
  return { x: q.x, y: q.y, z: q.z, w: q.w };
}

export function solveHeadOrientation(
  tracked: boolean,
  transform: RawMatrixV1 | null,
  neutral: QuaternionData | null,
): HeadOrientationResult {
  if (!tracked) return { raw: null, rawEulerDegrees: null, neutral, neutralRelative: null, neutralRelativeEulerDegrees: null, rejectionReason: "not-tracked" };
  const raw = facialTransformToMotionQuaternion(transform);
  if (!raw) return { raw: null, rawEulerDegrees: null, neutral, neutralRelative: null, neutralRelativeEulerDegrees: null, rejectionReason: "invalid-matrix" };
  if (!neutral) return { raw, rawEulerDegrees: headEulerDegrees(raw), neutral: null, neutralRelative: null, neutralRelativeEulerDegrees: null, rejectionReason: "neutral-unavailable" };
  const relative = neutralRelativeHeadRotation(neutral, raw);
  return {
    raw,
    rawEulerDegrees: headEulerDegrees(raw),
    neutral,
    neutralRelative: relative,
    neutralRelativeEulerDegrees: relative ? headEulerDegrees(relative) : null,
    rejectionReason: relative ? null : "invalid-matrix",
  };
}

export const HEAD_FROZEN_PRESETS = [
  "neutral", "yaw-left-15", "yaw-right-15", "yaw-left-35", "yaw-right-35", "yaw-left-60", "yaw-right-60",
  "pitch-up-10", "pitch-down-10", "pitch-up-25", "pitch-down-25", "pitch-up-40", "pitch-down-40",
  "roll-left-10", "roll-right-10", "roll-left-25", "roll-right-25",
] as const;
export type HeadFrozenPreset = typeof HEAD_FROZEN_PRESETS[number];

export function createHeadFrozenPreset(name: HeadFrozenPreset): RawMatrixV1 {
  const match = /^(yaw|pitch|roll)-(left|right|up|down)-(\d+)$/.exec(name);
  const euler = new Euler(0, 0, 0, "YXZ");
  if (match) {
    const radians = Number(match[3]) * Math.PI / 180;
    if (match[1] === "yaw") euler.y = match[2] === "left" ? radians : -radians;
    if (match[1] === "pitch") euler.x = match[2] === "up" ? -radians : radians;
    if (match[1] === "roll") euler.z = match[2] === "left" ? radians : -radians;
  }
  // Invert the Y/Z sign conversion performed by coordinateAdapter to synthesize a MediaPipe matrix.
  const motion = new Quaternion().setFromEuler(euler);
  const mediaPipe = new Quaternion(motion.x, -motion.y, -motion.z, motion.w);
  return { rows: 4, columns: 4, data: new Matrix4().makeRotationFromQuaternion(mediaPipe).toArray() };
}
