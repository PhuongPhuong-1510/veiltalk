import type { RawMatrixV1 } from "../tracking/rawTrackingTypes";
import { MEDIA_PIPE_FACE_EXPRESSION_NAMES } from "./expressionMapper";
import { quaternionFromRotationMatrix } from "./coordinateAdapter";
import type { QuaternionData } from "./avatarPoseTypes";

export type FaceCalibrationFailureReason = "timeout" | "tracking-lost" | "insufficient-neutral-samples" | "unstable-head" | "invalid-input";
export type FaceNeutralRejectionReason = "duplicate-timestamp" | "invalid-input" | "head-motion-warmup" | "head-motion" | "mouth" | "eyes" | "brows";
export interface FaceCalibrationExpressionProfile { baseline: number; noiseFloor: number; activationThreshold: number; quality: "stable" | "unstable" }
export interface FaceCalibrationProfile { version: 1; calibratedAtMs: number; sampleCount: number; durationMs: number; expressions: Record<string, FaceCalibrationExpressionProfile>; headNeutralRotation: QuaternionData }
export type FaceCalibrationStatus = "idle" | "collecting" | "ready" | "failed";
export interface FaceCalibrationSnapshot {
  status: FaceCalibrationStatus; startedAtMs: number | null; acceptedSamples: number; rejectedSamples: number;
  acceptedRatio: number; neutralStreak: number; rejectionReasons: Partial<Record<FaceNeutralRejectionReason, number>>;
  failureReason: FaceCalibrationFailureReason | null; profile: FaceCalibrationProfile | null; calibratedValues: Record<string, number>;
}
export interface FaceCalibrationConfig {
  targetSamples: number; minimumSamples: number; minimumCollectingMs: number; targetCollectingMs: number; timeoutMs: number;
  minimumAcceptedRatio: number; minimumNeutralStreak: number; longLossResetMs: number; minimumNoiseFloor: number; maximumNoiseFloor: number;
  maximumHeadAngularVelocityRadiansPerSecond: number;
}
export const DEFAULT_FACE_CALIBRATION_CONFIG: FaceCalibrationConfig = {
  targetSamples: 36, minimumSamples: 24, minimumCollectingMs: 1_000, targetCollectingMs: 1_500, timeoutMs: 4_000,
  minimumAcceptedRatio: .6, minimumNeutralStreak: 8, longLossResetMs: 750, minimumNoiseFloor: .01, maximumNoiseFloor: .15,
  maximumHeadAngularVelocityRadiansPerSecond: 35 * Math.PI / 180,
};

const THRESHOLDS: Record<string, [number, FaceNeutralRejectionReason]> = {
  // Calibration phải học được baseline phụ thuộc khuôn mặt/camera. Các ngưỡng này chỉ loại biểu cảm
  // chủ ý rất mạnh; MAD/noise gate bên dưới mới quyết định baseline có đủ ổn định hay không.
  jawOpen: [.4, "mouth"], mouthSmileLeft: [.85, "mouth"], mouthSmileRight: [.85, "mouth"], mouthFrownLeft: [.85, "mouth"], mouthFrownRight: [.85, "mouth"],
  mouthPucker: [.85, "mouth"], mouthFunnel: [.85, "mouth"], mouthPressLeft: [.85, "mouth"], mouthPressRight: [.85, "mouth"], cheekPuff: [.85, "mouth"],
  eyeBlinkLeft: [.85, "eyes"], eyeBlinkRight: [.85, "eyes"], eyeSquintLeft: [.85, "eyes"], eyeSquintRight: [.85, "eyes"], eyeWideLeft: [.85, "eyes"], eyeWideRight: [.85, "eyes"],
  browDownLeft: [.85, "brows"], browDownRight: [.85, "brows"], browInnerUp: [.85, "brows"], browOuterUpLeft: [.85, "brows"], browOuterUpRight: [.85, "brows"],
};
const CORE = new Set(["jawOpen", "eyeBlinkLeft", "eyeBlinkRight", "mouthSmileLeft", "mouthSmileRight"]);
const UNCALIBRATED_DIRECTIONAL = /^(jawLeft|jawRight|mouthLeft|mouthRight)/;
const median = (values: readonly number[]): number => { const sorted = [...values].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2); return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2; };
const angularVelocity = (a: ReturnType<typeof quaternionFromRotationMatrix>, b: ReturnType<typeof quaternionFromRotationMatrix>, dtMs: number): number => {
  if (!a || !b || dtMs <= 0) return Infinity; const dot = Math.min(1, Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w)); return 2 * Math.acos(dot) / (dtMs / 1000);
};

export class FaceCalibrationProcessor {
  private status: FaceCalibrationStatus = "idle"; private startedAtMs: number | null = null; private accepted = 0; private rejected = 0; private streak = 0;
  private rejectionReasons: Partial<Record<FaceNeutralRejectionReason, number>> = {}; private failureReason: FaceCalibrationFailureReason | null = null;
  private profile: FaceCalibrationProfile | null = null; private samples = new Map<string, number[]>(); private lastSampledAtMs: number | null = null;
  private headSamples: QuaternionData[] = [];
  private lastHead: ReturnType<typeof quaternionFromRotationMatrix> = null; private lastHeadAtMs: number | null = null; private lostSinceMs: number | null = null;
  private calibratedValues: Record<string, number> = {};
  private readonly config: FaceCalibrationConfig;
  constructor(config: FaceCalibrationConfig = DEFAULT_FACE_CALIBRATION_CONFIG) { this.config = config; }
  start(nowMs: number): void { this.reset(); this.status = "collecting"; this.startedAtMs = nowMs; }
  cancel(): void { this.reset(); }
  reset(): void { this.status = "idle"; this.startedAtMs = null; this.accepted = 0; this.rejected = 0; this.streak = 0; this.rejectionReasons = {}; this.failureReason = null; this.profile = null; this.samples.clear(); this.headSamples = []; this.lastSampledAtMs = null; this.lastHead = null; this.lastHeadAtMs = null; this.lostSinceMs = null; this.calibratedValues = {}; }
  process(state: "tracked" | "lost" | "not-sampled", sampledAtMs: number | null, values: Record<string, number> | null, transform: RawMatrixV1 | null, nowMs: number): Record<string, number> {
    if (state !== "tracked" || sampledAtMs === null || !values) { this.observeLoss(nowMs); return values ? { ...values } : {}; }
    this.lostSinceMs = null;
    if (this.lastSampledAtMs !== null && sampledAtMs < this.lastSampledAtMs) { this.reset(); return { ...values }; }
    if (this.status === "collecting") this.collect(sampledAtMs, values, transform, nowMs);
    this.lastSampledAtMs = sampledAtMs;
    this.calibratedValues = this.status === "ready" && this.profile ? this.calibrate(values, this.profile) : { ...values };
    return { ...this.calibratedValues };
  }
  snapshot(): FaceCalibrationSnapshot { const total = this.accepted + this.rejected; return { status: this.status, startedAtMs: this.startedAtMs, acceptedSamples: this.accepted, rejectedSamples: this.rejected, acceptedRatio: total ? this.accepted / total : 0, neutralStreak: this.streak, rejectionReasons: { ...this.rejectionReasons }, failureReason: this.failureReason, profile: this.profile ? structuredClone(this.profile) : null, calibratedValues: { ...this.calibratedValues } }; }
  private collect(sampledAtMs: number, values: Record<string, number>, transform: RawMatrixV1 | null, nowMs: number): void {
    const reason = this.rejectReason(sampledAtMs, values, transform);
    if (reason) { this.rejected += 1; this.streak = 0; this.rejectionReasons[reason] = (this.rejectionReasons[reason] ?? 0) + 1; }
    else { this.accepted += 1; this.streak += 1; const head = transform ? quaternionFromRotationMatrix(transform.data) : null; if (head) this.headSamples.push(head); for (const name of MEDIA_PIPE_FACE_EXPRESSION_NAMES) { const value = values[name]; if (Number.isFinite(value)) { const list = this.samples.get(name) ?? []; list.push(value); this.samples.set(name, list); } } }
    const elapsed = nowMs - this.startedAtMs!; const total = this.accepted + this.rejected; const ratio = total ? this.accepted / total : 0;
    if ((this.accepted >= this.config.targetSamples && elapsed >= this.config.minimumCollectingMs) || elapsed >= this.config.targetCollectingMs) {
      if (this.accepted >= this.config.minimumSamples && ratio >= this.config.minimumAcceptedRatio && this.streak >= this.config.minimumNeutralStreak) this.finish(nowMs, elapsed);
      else if (elapsed >= this.config.timeoutMs) this.fail("insufficient-neutral-samples");
    } else if (elapsed >= this.config.timeoutMs) this.fail("timeout");
  }
  private rejectReason(sampledAtMs: number, values: Record<string, number>, transform: RawMatrixV1 | null): FaceNeutralRejectionReason | null {
    if (sampledAtMs === this.lastSampledAtMs) return "duplicate-timestamp";
    if (Object.values(values).some((value) => !Number.isFinite(value)) || [...CORE].some((name) => !Number.isFinite(values[name]))) return "invalid-input";
    for (const [name, [threshold, reason]] of Object.entries(THRESHOLDS)) if ((values[name] ?? 0) > threshold) return reason;
    const head = transform ? quaternionFromRotationMatrix(transform.data) : null;
    if (!head) return "invalid-input";
    if (this.lastHead && this.lastHeadAtMs !== null && angularVelocity(this.lastHead, head, sampledAtMs - this.lastHeadAtMs) > this.config.maximumHeadAngularVelocityRadiansPerSecond) { this.lastHead = head; this.lastHeadAtMs = sampledAtMs; return "head-motion"; }
    this.lastHead = head; this.lastHeadAtMs = sampledAtMs; return null;
  }
  private finish(nowMs: number, durationMs: number): void {
    const expressions: Record<string, FaceCalibrationExpressionProfile> = {};
    for (const [name, values] of this.samples) { const baseline = median(values); const mad = median(values.map((value) => Math.abs(value - baseline))); const noiseFloor = Math.min(this.config.maximumNoiseFloor, Math.max(this.config.minimumNoiseFloor, mad * 3)); expressions[name] = { baseline, noiseFloor, activationThreshold: Math.min(1, baseline + noiseFloor), quality: mad * 3 > this.config.maximumNoiseFloor ? "unstable" : "stable" }; }
    if ([...CORE].some((name) => expressions[name]?.quality === "unstable")) { this.fail("invalid-input"); return; }
    const headNeutralRotation = averageQuaternions(this.headSamples);
    if (!headNeutralRotation) { this.fail("invalid-input"); return; }
    this.profile = { version: 1, calibratedAtMs: nowMs, sampleCount: this.accepted, durationMs, expressions, headNeutralRotation }; this.status = "ready";
  }
  private calibrate(values: Record<string, number>, profile: FaceCalibrationProfile): Record<string, number> { return Object.fromEntries(Object.entries(values).map(([name, raw]) => { const item = profile.expressions[name]; if (!item || UNCALIBRATED_DIRECTIONAL.test(name)) return [name, raw]; if (raw <= item.activationThreshold) return [name, 0]; return [name, Math.min(1, Math.max(0, (raw - item.activationThreshold) / Math.max(1e-6, 1 - item.activationThreshold)))]; })); }
  private fail(reason: FaceCalibrationFailureReason): void { this.status = "failed"; this.failureReason = reason; this.profile = null; }
  private observeLoss(nowMs: number): void {
    this.lostSinceMs ??= nowMs;
    if (Number.isFinite(this.lostSinceMs) && nowMs - this.lostSinceMs > this.config.longLossResetMs) { this.reset(); this.lostSinceMs = Number.POSITIVE_INFINITY; }
  }
}

function averageQuaternions(values: readonly QuaternionData[]): QuaternionData | null {
  if (values.length === 0) return null;
  const reference = values[0];
  const sum = values.reduce((result, value) => {
    const dot = reference.x * value.x + reference.y * value.y + reference.z * value.z + reference.w * value.w;
    const sign = dot < 0 ? -1 : 1;
    return { x: result.x + value.x * sign, y: result.y + value.y * sign, z: result.z + value.z * sign, w: result.w + value.w * sign };
  }, { x: 0, y: 0, z: 0, w: 0 });
  const length = Math.hypot(sum.x, sum.y, sum.z, sum.w);
  return length > 1e-8 && Number.isFinite(length) ? { x: sum.x / length, y: sum.y / length, z: sum.z / length, w: sum.w / length } : null;
}
