import { OneEuroScalarFilter } from "./oneEuroFilter";
import type { AvatarOutputMotionState } from "./avatarPoseTypes";
import type { OneEuroParameters } from "./motionConfig";

export interface GazeTemporalConfig {
  filter: OneEuroParameters;
  maximumTimestampGapMs: number;
  holdMs: number;
  returnMs: number;
}

export interface GazeTemporalOutput {
  yaw: number;
  pitch: number;
  outputState: AvatarOutputMotionState;
  sampleDisposition: "fresh" | "duplicate" | "reversed" | "loss";
}

const smoothstep = (value: number) => { const x = Math.min(1, Math.max(0, value)); return x * x * (3 - 2 * x); };

export class GazeTemporal {
  private readonly config: GazeTemporalConfig;
  private readonly yawFilter: OneEuroScalarFilter;
  private readonly pitchFilter: OneEuroScalarFilter;
  private lastSampledAtMs: number | null = null;
  private lastTrackedAtMs: number | null = null;
  private output = { yaw: 0, pitch: 0 };
  private returnStart: { yaw: number; pitch: number } | null = null;

  constructor(config: GazeTemporalConfig) {
    if (![config.maximumTimestampGapMs, config.holdMs, config.returnMs, config.filter.minCutoff, config.filter.beta, config.filter.derivativeCutoff].every(Number.isFinite)
        || config.maximumTimestampGapMs <= 0 || config.holdMs < 0 || config.returnMs <= 0
        || config.filter.minCutoff <= 0 || config.filter.beta < 0 || config.filter.derivativeCutoff <= 0) {
      throw new Error("Cấu hình gaze temporal không hợp lệ.");
    }
    this.config = config;
    this.yawFilter = new OneEuroScalarFilter(config.filter, config.maximumTimestampGapMs);
    this.pitchFilter = new OneEuroScalarFilter(config.filter, config.maximumTimestampGapMs);
  }

  processFresh(yaw: number, pitch: number, sampledAtMs: number, filtered: boolean): GazeTemporalOutput {
    if (this.lastSampledAtMs !== null && sampledAtMs <= this.lastSampledAtMs) {
      return { ...this.output, outputState: "active", sampleDisposition: sampledAtMs === this.lastSampledAtMs ? "duplicate" : "reversed" };
    }
    this.lastSampledAtMs = sampledAtMs;
    this.lastTrackedAtMs = sampledAtMs;
    this.returnStart = null;
    this.output = filtered
      ? { yaw: this.yawFilter.filter(yaw, sampledAtMs), pitch: this.pitchFilter.filter(pitch, sampledAtMs) }
      : { yaw, pitch };
    return { ...this.output, outputState: "active", sampleDisposition: "fresh" };
  }

  processLoss(nowMs: number): GazeTemporalOutput {
    if (this.lastTrackedAtMs === null) return { yaw: 0, pitch: 0, outputState: "idle", sampleDisposition: "loss" };
    const lostFor = Math.max(0, nowMs - this.lastTrackedAtMs);
    if (lostFor <= this.config.holdMs) return { ...this.output, outputState: "held", sampleDisposition: "loss" };
    this.returnStart ??= { ...this.output };
    const progress = (lostFor - this.config.holdMs) / Math.max(1, this.config.returnMs);
    if (progress >= 1) {
      this.output = { yaw: 0, pitch: 0 };
      return { ...this.output, outputState: "idle", sampleDisposition: "loss" };
    }
    const remaining = 1 - smoothstep(progress);
    this.output = { yaw: this.returnStart.yaw * remaining, pitch: this.returnStart.pitch * remaining };
    return { ...this.output, outputState: "returning", sampleDisposition: "loss" };
  }

  reset(): void {
    this.lastSampledAtMs = null; this.lastTrackedAtMs = null; this.output = { yaw: 0, pitch: 0 }; this.returnStart = null;
    this.yawFilter.reset(); this.pitchFilter.reset();
  }
}
