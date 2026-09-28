import type { QuaternionData } from "./avatarPoseTypes";
import { inverseQuaternion, multiplyQuaternions, slerpQuaternionData } from "./motionMath";

export type UpperBodyCalibrationMode = "pending" | "shoulder-only" | "full-torso";

export interface UpperBodyCalibrationSnapshot {
  state: "idle" | "collecting" | "calibrated";
  acceptedPairs: number;
  requiredPairs: number;
  rejectedSkew: number;
  rejectedQuality: number;
  rejectedMissingRequired: number;
  modelFingerprint: string | null;
  mode: UpperBodyCalibrationMode;
  acceptedFullTorsoPairs: number;
  faceNeutral: QuaternionData | null;
  shoulderNeutral: QuaternionData | null;
  fullTorsoNeutral: QuaternionData | null;
  /** Alias chẩn đoán: full torso nếu đủ, ngược lại shoulder-only. */
  torsoNeutral: QuaternionData | null;
  relativeNeutral: QuaternionData | null;
  minimumPairs: number;
  maximumPairs: number;
  elapsedMs: number;
  angularDispersionRadians: number | null;
  completionReason: "collecting" | "stable" | "maximum-samples" | "timeout";
}

export interface UpperBodyCalibrationSample {
  faceRotation: QuaternionData | null;
  shoulderRotation: QuaternionData | null;
  fullTorsoRotation: QuaternionData | null;
  faceSampledAtMs: number | null;
  poseSampledAtMs: number | null;
  faceQuality: number;
  shoulderQuality: number;
  fullTorsoQuality: number;
}

const usableQuaternion = (value: QuaternionData | null): value is QuaternionData => Boolean(value)
  && [value!.x, value!.y, value!.z, value!.w].every(Number.isFinite)
  && Math.hypot(value!.x, value!.y, value!.z, value!.w) > 1e-6;

export class UpperBodyNeutralCalibrator {
  private state: UpperBodyCalibrationSnapshot["state"] = "idle";
  private acceptedPairs = 0;
  private rejectedSkew = 0;
  private rejectedQuality = 0;
  private rejectedMissingRequired = 0;
  private faceMean: QuaternionData | null = null;
  private shoulderMean: QuaternionData | null = null;
  private fullTorsoMean: QuaternionData | null = null;
  private acceptedFullTorsoPairs = 0;
  private mode: UpperBodyCalibrationMode = "pending";
  private lastFaceTimestamp: number | null = null;
  private lastPoseTimestamp: number | null = null;
  private modelFingerprint: string | null = null;
  private readonly requiredPairs: number;
  private readonly skewLimitMs: number;
  private readonly qualityGate: number;
  private readonly minimumPairs: number;
  private readonly maximumPairs: number;
  private readonly maximumDurationMs: number;
  private readonly stabilityThresholdRadians: number;
  private firstAcceptedAtMs: number | null = null;
  private latestAcceptedAtMs: number | null = null;
  private faceSamples: QuaternionData[] = [];
  private shoulderSamples: QuaternionData[] = [];
  private angularDispersionRadians: number | null = null;
  private completionReason: UpperBodyCalibrationSnapshot["completionReason"] = "collecting";

  constructor(requiredPairs = 30, skewLimitMs = 50, qualityGate = 0.55, maximumDurationMs = 3_000, stabilityThresholdRadians = 3 * Math.PI / 180) {
    this.requiredPairs = requiredPairs; this.skewLimitMs = skewLimitMs; this.qualityGate = qualityGate;
    this.minimumPairs = requiredPairs >= 24 ? 24 : requiredPairs;
    this.maximumPairs = requiredPairs >= 24 ? Math.max(requiredPairs, 60) : requiredPairs;
    this.maximumDurationMs = maximumDurationMs; this.stabilityThresholdRadians = stabilityThresholdRadians;
  }

  begin(modelFingerprint: string): void {
    this.reset(modelFingerprint);
    this.state = "collecting";
  }

  setModelFingerprint(modelFingerprint: string | null): void {
    if (this.modelFingerprint === modelFingerprint) return;
    this.reset(modelFingerprint);
  }

  process(sample: UpperBodyCalibrationSample): boolean {
    if (this.state !== "collecting") return false;
    const { faceSampledAtMs: faceAt, poseSampledAtMs: poseAt } = sample;
    if (!usableQuaternion(sample.faceRotation) || !usableQuaternion(sample.shoulderRotation)
      || faceAt === null || poseAt === null) { this.rejectedMissingRequired += 1; return false; }
    if (faceAt === this.lastFaceTimestamp || poseAt === this.lastPoseTimestamp
      || (this.lastFaceTimestamp !== null && faceAt < this.lastFaceTimestamp)
      || (this.lastPoseTimestamp !== null && poseAt < this.lastPoseTimestamp)) return false;
    if (Math.abs(faceAt - poseAt) > this.skewLimitMs) { this.rejectedSkew += 1; return false; }
    if (sample.faceQuality < this.qualityGate || sample.shoulderQuality < this.qualityGate) { this.rejectedQuality += 1; return false; }
    this.lastFaceTimestamp = faceAt; this.lastPoseTimestamp = poseAt;
    this.firstAcceptedAtMs ??= Math.min(faceAt, poseAt);
    this.latestAcceptedAtMs = Math.max(faceAt, poseAt);
    const alpha = 1 / (this.acceptedPairs + 1);
    this.faceMean = this.faceMean ? slerpQuaternionData(this.faceMean, sample.faceRotation, alpha) : sample.faceRotation;
    this.shoulderMean = this.shoulderMean ? slerpQuaternionData(this.shoulderMean, sample.shoulderRotation, alpha) : sample.shoulderRotation;
    this.faceSamples.push(sample.faceRotation); this.shoulderSamples.push(sample.shoulderRotation);
    if (this.faceSamples.length > this.maximumPairs) this.faceSamples.shift();
    if (this.shoulderSamples.length > this.maximumPairs) this.shoulderSamples.shift();
    if (usableQuaternion(sample.fullTorsoRotation) && sample.fullTorsoQuality >= this.qualityGate) {
      const fullAlpha = 1 / (this.acceptedFullTorsoPairs + 1);
      this.fullTorsoMean = this.fullTorsoMean ? slerpQuaternionData(this.fullTorsoMean, sample.fullTorsoRotation, fullAlpha) : sample.fullTorsoRotation;
      this.acceptedFullTorsoPairs += 1;
    }
    this.acceptedPairs += 1;
    this.angularDispersionRadians = Math.max(
      angularMedianDeviation(this.faceSamples, this.faceMean),
      angularMedianDeviation(this.shoulderSamples, this.shoulderMean),
    );
    const elapsedMs = this.elapsedMs();
    const stable = this.angularDispersionRadians <= this.stabilityThresholdRadians;
    // At normal 30 FPS we retain the established 30-sample contract. The 24-sample
    // path only shortens calibration on slower cameras after a full second of stable evidence.
    const stableEnough = stable && this.acceptedPairs >= this.minimumPairs
      && (this.acceptedPairs >= this.requiredPairs || elapsedMs >= 1_000);
    const maximumReached = this.acceptedPairs >= this.maximumPairs;
    const timedOut = elapsedMs >= this.maximumDurationMs;
    if (stableEnough || maximumReached || timedOut) {
      this.state = "calibrated";
      this.completionReason = stableEnough ? "stable" : maximumReached ? "maximum-samples" : "timeout";
      this.mode = this.acceptedFullTorsoPairs >= Math.ceil(this.requiredPairs * .8) ? "full-torso" : "shoulder-only";
    }
    return true;
  }

  headRelative(face: QuaternionData, shoulder: QuaternionData | null): QuaternionData | null {
    const faceDelta = this.faceDelta(face);
    if (!faceDelta) return null;
    const shoulderDelta = shoulder ? this.shoulderDelta(shoulder) : null;
    return shoulderDelta ? multiplyQuaternions(inverseQuaternion(shoulderDelta), faceDelta) : faceDelta;
  }

  faceDelta(face: QuaternionData): QuaternionData | null {
    return this.state === "calibrated" && this.faceMean ? multiplyQuaternions(inverseQuaternion(this.faceMean), face) : null;
  }

  shoulderDelta(shoulder: QuaternionData): QuaternionData | null {
    return this.state === "calibrated" && this.shoulderMean
      ? multiplyQuaternions(inverseQuaternion(this.shoulderMean), shoulder) : null;
  }

  fullTorsoDelta(torso: QuaternionData): QuaternionData | null {
    return this.state === "calibrated" && this.fullTorsoMean
      ? multiplyQuaternions(inverseQuaternion(this.fullTorsoMean), torso) : null;
  }

  snapshot(): UpperBodyCalibrationSnapshot {
    const torsoNeutral = this.mode === "full-torso" ? this.fullTorsoMean : this.shoulderMean;
    const relativeNeutral = this.faceMean && torsoNeutral
      ? multiplyQuaternions(inverseQuaternion(torsoNeutral), this.faceMean) : null;
    return structuredClone({ state: this.state, acceptedPairs: this.acceptedPairs, requiredPairs: this.requiredPairs,
      rejectedSkew: this.rejectedSkew, rejectedQuality: this.rejectedQuality, rejectedMissingRequired: this.rejectedMissingRequired,
      modelFingerprint: this.modelFingerprint, mode: this.mode, acceptedFullTorsoPairs: this.acceptedFullTorsoPairs,
      faceNeutral: this.faceMean, shoulderNeutral: this.shoulderMean, fullTorsoNeutral: this.fullTorsoMean, torsoNeutral, relativeNeutral,
      minimumPairs: this.minimumPairs, maximumPairs: this.maximumPairs, elapsedMs: this.elapsedMs(), angularDispersionRadians: this.angularDispersionRadians,
      completionReason: this.completionReason });
  }

  reset(modelFingerprint: string | null = this.modelFingerprint): void {
    this.state = "idle"; this.acceptedPairs = 0; this.rejectedSkew = 0; this.rejectedQuality = 0; this.rejectedMissingRequired = 0;
    this.faceMean = null; this.shoulderMean = null; this.fullTorsoMean = null; this.acceptedFullTorsoPairs = 0; this.mode = "pending";
    this.lastFaceTimestamp = null; this.lastPoseTimestamp = null;
    this.firstAcceptedAtMs = null; this.latestAcceptedAtMs = null; this.faceSamples = []; this.shoulderSamples = [];
    this.angularDispersionRadians = null; this.completionReason = "collecting";
    this.modelFingerprint = modelFingerprint;
  }

  private elapsedMs(): number {
    return this.firstAcceptedAtMs === null || this.latestAcceptedAtMs === null ? 0 : Math.max(0, this.latestAcceptedAtMs - this.firstAcceptedAtMs);
  }
}

function angularMedianDeviation(samples: readonly QuaternionData[], mean: QuaternionData | null): number {
  if (!mean || samples.length === 0) return Infinity;
  const deviations = samples.map((sample) => {
    const dot = Math.min(1, Math.abs(sample.x * mean.x + sample.y * mean.y + sample.z * mean.z + sample.w * mean.w));
    return 2 * Math.acos(dot);
  }).sort((a, b) => a - b);
  const middle = Math.floor(deviations.length / 2);
  return deviations.length % 2 ? deviations[middle] : (deviations[middle - 1] + deviations[middle]) / 2;
}
