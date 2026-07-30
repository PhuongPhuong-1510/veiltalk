import { Euler, Quaternion } from "three";
import type { QuaternionData } from "./avatarPoseTypes";
import type { TorsoBasisObservation } from "./torsoBasis";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import { subtract } from "./coordinateAdapter";
import { inverseQuaternion, multiplyQuaternions, quaternionData, quaternionFromBasis, slerpQuaternionData, vector, vectorData } from "./motionMath";

export interface TorsoEulerDegrees { yaw: number; pitch: number; roll: number }
export type TorsoCalibrationStatus = "idle" | "collecting" | "ready" | "failed";
export interface TorsoCalibrationSnapshot { status: TorsoCalibrationStatus; acceptedSamples: number; rejectedSamples: number; rejectionReason: string | null; neutral: QuaternionData | null }
export type TorsoObservationMode = "full-torso" | "shoulder-only" | "unavailable";
export interface TorsoSemanticObservation extends TorsoBasisObservation { mode: TorsoObservationMode; pitchObservable: boolean }
export interface TorsoOrientationResult { mode: TorsoObservationMode; pitchObservable: boolean; raw: QuaternionData | null; neutral: QuaternionData | null; neutralRelative: QuaternionData | null; inputEulerDegrees: TorsoEulerDegrees | null; outputEulerDegrees: TorsoEulerDegrees | null; output: QuaternionData | null; rejectionReason: string | null }

export function buildTorsoSemanticObservation(landmarks: RawNormalizedLandmarkV1[], full: TorsoBasisObservation, minimumVisibility = .5, minimumLength = 1e-3): TorsoSemanticObservation {
  if (full.basis) return { ...full, mode: "full-torso", pitchObservable: true };
  const left = landmarks[11], rightLandmark = landmarks[12];
  if (!left || !rightLandmark || [left, rightLandmark].some((point) => point.visibility !== null && point.visibility < minimumVisibility)) return { ...full, mode: "unavailable", pitchObservable: false };
  const right = vector(subtract(left, rightLandmark)); if (right.length() < minimumLength) return { ...full, mode: "unavailable", pitchObservable: false };
  right.normalize(); const up = vector({ x: 0, y: 1, z: 0 }).addScaledVector(right, -right.y);
  if (up.lengthSq() < 1e-8) return { ...full, mode: "unavailable", pitchObservable: false };
  up.normalize(); const forward = right.clone().cross(up).normalize(); up.copy(forward).cross(right).normalize(); const worldRotation = quaternionFromBasis(vectorData(right), vectorData(up), vectorData(forward));
  return worldRotation ? { ...full, basis: { right: vectorData(right), up: vectorData(up), forward: vectorData(forward), worldRotation }, rejectionReason: null, mode: "shoulder-only", pitchObservable: false } : { ...full, mode: "unavailable", pitchObservable: false };
}

const radians = Math.PI / 180;
const smoothstep = (value: number): number => { const t = Math.min(1, Math.max(0, value)); return t * t * (3 - 2 * t); };
const softLimit = (magnitude: number, start: number, limit: number): number => magnitude <= start
  ? magnitude
  : start + (limit - start) * (1 - Math.exp(-(magnitude - start) / Math.max(1e-6, limit - start)));
const axisResponse = (value: number, deadZoneStart: number, deadZoneEnd: number, gain: number, softLimitStart: number, limit: number, sign = 1): number => {
  const magnitude = Math.abs(value); if (magnitude <= deadZoneStart) return 0;
  const deadZoneGain = smoothstep((magnitude - deadZoneStart) / Math.max(1e-6, deadZoneEnd - deadZoneStart));
  return Math.sign(value) * sign * softLimit(magnitude * deadZoneGain * gain, softLimitStart, limit);
};
export function torsoEulerDegrees(rotation: QuaternionData): TorsoEulerDegrees {
  const e = new Euler().setFromQuaternion(new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w), "YXZ");
  return { yaw: e.y / radians, pitch: e.x / radians, roll: e.z / radians };
}
export function torsoQuaternionFromSemanticEuler(value: TorsoEulerDegrees): QuaternionData {
  return quaternionData(new Quaternion().setFromEuler(new Euler(value.pitch * radians, value.yaw * radians, value.roll * radians, "YXZ")).normalize());
}
export function solveTorsoOrientation(observation: TorsoSemanticObservation | null, neutral: QuaternionData | null): TorsoOrientationResult {
  if (!observation?.basis) return { mode: observation?.mode ?? "unavailable", pitchObservable: false, raw: null, neutral, neutralRelative: null, inputEulerDegrees: null, outputEulerDegrees: null, output: null, rejectionReason: observation?.rejectionReason ?? "not-tracked" };
  const raw = observation.basis.worldRotation;
  if (!neutral) return { mode: observation.mode, pitchObservable: observation.pitchObservable, raw, neutral: null, neutralRelative: null, inputEulerDegrees: null, outputEulerDegrees: null, output: null, rejectionReason: "neutral-unavailable" };
  const relative = multiplyQuaternions(inverseQuaternion(neutral), raw); const input = torsoEulerDegrees(relative);
  if (!observation.pitchObservable) input.pitch = 0;
  // MediaPipe camera-space yaw có chiều ngược avatar semantic yaw. Giữ gần 1:1 tới 70°, sau đó
  // tiến dần về 80° để tránh snap khi một vai gần khuất ở tư thế quay ngang.
  const outputEulerDegrees = { yaw: axisResponse(input.yaw, 1, 3, 1, 70, 80, -1), pitch: observation.pitchObservable ? axisResponse(input.pitch, 1, 3, .9, 25, 30) : 0, roll: axisResponse(input.roll, 2, 4, .65, 20, 25) };
  return { mode: observation.mode, pitchObservable: observation.pitchObservable, raw, neutral, neutralRelative: relative, inputEulerDegrees: input, outputEulerDegrees, output: torsoQuaternionFromSemanticEuler(outputEulerDegrees), rejectionReason: null };
}

export class TorsoCalibrationProcessor {
  private status: TorsoCalibrationStatus = "idle"; private accepted = 0; private rejected = 0; private samples: QuaternionData[] = []; private lastSampledAtMs: number | null = null; private neutral: QuaternionData | null = null; private rejectionReason: string | null = null;
  start(): void { this.reset(); this.status = "collecting"; }
  reset(): void { this.status = "idle"; this.accepted = 0; this.rejected = 0; this.samples = []; this.lastSampledAtMs = null; this.neutral = null; this.rejectionReason = null; }
  process(state: "tracked" | "lost" | "not-sampled", sampledAtMs: number | null, observation: TorsoSemanticObservation | null): void {
    if (this.status !== "collecting" || state !== "tracked" || sampledAtMs === null) return;
    if (sampledAtMs === this.lastSampledAtMs) { this.rejected++; this.rejectionReason = "duplicate-timestamp"; return; }
    this.lastSampledAtMs = sampledAtMs;
    if (!observation?.basis) { this.rejected++; this.rejectionReason = observation?.rejectionReason ?? "invalid-input"; return; }
    const current = observation.basis.worldRotation; const previous = this.samples.at(-1);
    if (previous && new Quaternion(previous.x, previous.y, previous.z, previous.w).angleTo(new Quaternion(current.x, current.y, current.z, current.w)) > 8 * radians) { this.rejected++; this.rejectionReason = "torso-motion"; return; }
    this.samples.push(current); this.accepted++; this.rejectionReason = null;
    if (this.accepted >= 12) { let average = this.samples[0]; for (let i = 1; i < this.samples.length; i++) average = slerpQuaternionData(average, this.samples[i], 1 / (i + 1)); this.neutral = average; this.status = "ready"; }
  }
  snapshot(): TorsoCalibrationSnapshot { return { status: this.status, acceptedSamples: this.accepted, rejectedSamples: this.rejected, rejectionReason: this.rejectionReason, neutral: this.neutral ? { ...this.neutral } : null }; }
}
