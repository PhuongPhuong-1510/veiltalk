import type { QuaternionData } from "./avatarPoseTypes";
import { inverseQuaternion, multiplyQuaternions, slerpQuaternionData } from "./motionMath";
import { quaternionExp, quaternionLog } from "./quaternionDistribution";

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

  constructor(requiredPairs = 30, skewLimitMs = 50, qualityGate = 0.55) {
    this.requiredPairs = requiredPairs; this.skewLimitMs = skewLimitMs; this.qualityGate = qualityGate;
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
    const alpha = 1 / (this.acceptedPairs + 1);
    this.faceMean = this.faceMean ? slerpQuaternionData(this.faceMean, sample.faceRotation, alpha) : sample.faceRotation;
    this.shoulderMean = this.shoulderMean ? slerpQuaternionData(this.shoulderMean, sample.shoulderRotation, alpha) : sample.shoulderRotation;
    if (usableQuaternion(sample.fullTorsoRotation) && sample.fullTorsoQuality >= this.qualityGate) {
      const fullAlpha = 1 / (this.acceptedFullTorsoPairs + 1);
      this.fullTorsoMean = this.fullTorsoMean ? slerpQuaternionData(this.fullTorsoMean, sample.fullTorsoRotation, fullAlpha) : sample.fullTorsoRotation;
      this.acceptedFullTorsoPairs += 1;
    }
    this.acceptedPairs += 1;
    if (this.acceptedPairs >= this.requiredPairs) {
      this.state = "calibrated";
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
      ? correctPoseDelta(multiplyQuaternions(inverseQuaternion(this.shoulderMean), shoulder)) : null;
  }

  fullTorsoDelta(torso: QuaternionData): QuaternionData | null {
    return this.state === "calibrated" && this.fullTorsoMean
      ? correctPoseDelta(multiplyQuaternions(inverseQuaternion(this.fullTorsoMean), torso)) : null;
  }

  snapshot(): UpperBodyCalibrationSnapshot {
    const torsoNeutral = this.mode === "full-torso" ? this.fullTorsoMean : this.shoulderMean;
    const relativeNeutral = this.faceMean && torsoNeutral
      ? multiplyQuaternions(inverseQuaternion(torsoNeutral), this.faceMean) : null;
    return structuredClone({ state: this.state, acceptedPairs: this.acceptedPairs, requiredPairs: this.requiredPairs,
      rejectedSkew: this.rejectedSkew, rejectedQuality: this.rejectedQuality, rejectedMissingRequired: this.rejectedMissingRequired,
      modelFingerprint: this.modelFingerprint, mode: this.mode, acceptedFullTorsoPairs: this.acceptedFullTorsoPairs,
      faceNeutral: this.faceMean, shoulderNeutral: this.shoulderMean, fullTorsoNeutral: this.fullTorsoMean, torsoNeutral, relativeNeutral });
  }

  reset(modelFingerprint: string | null = this.modelFingerprint): void {
    this.state = "idle"; this.acceptedPairs = 0; this.rejectedSkew = 0; this.rejectedQuality = 0; this.rejectedMissingRequired = 0;
    this.faceMean = null; this.shoulderMean = null; this.fullTorsoMean = null; this.acceptedFullTorsoPairs = 0; this.mode = "pending";
    this.lastFaceTimestamp = null; this.lastPoseTimestamp = null;
    this.modelFingerprint = modelFingerprint;
  }
}

/** Pose World và Face matrix có yaw ngược nhau trên webcam; sửa một lần tại observation boundary. */
function correctPoseDelta(delta: QuaternionData): QuaternionData | null {
  const rotation = quaternionLog(delta);
  return rotation ? quaternionExp({ x: rotation.x, y: -rotation.y, z: rotation.z }) : null;
}
