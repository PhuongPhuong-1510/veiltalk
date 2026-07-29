import type { TrackingSampleState } from "../tracking/rawTrackingTypes";
import type { AvatarGazeV1 } from "./gaze";

export interface FaceMotionSample { expressions: Record<string, number>; gaze: AvatarGazeV1 }
export interface FaceExpressionLossConfig { holdMs: number; returnMs: number; recoveryMs: number; confirmationSamples: number }
export type FaceExpressionLossState = "idle" | "active" | "held" | "returning" | "confirming" | "recovering";
export interface FaceExpressionLossDiagnostics {
  state: FaceExpressionLossState; lostDurationMs: number; returnProgress: number; recoveryProgress: number;
  confirmationCount: number; longLossResetRequested: boolean; cached: FaceMotionSample | null;
}

const neutral = (names: Iterable<string> = []): FaceMotionSample => ({ expressions: Object.fromEntries([...names].map((name) => [name, 0])), gaze: { yaw: 0, pitch: 0 } });
const clone = (value: FaceMotionSample): FaceMotionSample => ({ expressions: { ...value.expressions }, gaze: { ...value.gaze } });
const mix = (from: FaceMotionSample, to: FaceMotionSample, progress: number): FaceMotionSample => {
  const t = Math.min(1, Math.max(0, progress)); const names = new Set([...Object.keys(from.expressions), ...Object.keys(to.expressions)]);
  return { expressions: Object.fromEntries([...names].map((name) => [name, (from.expressions[name] ?? 0) + ((to.expressions[name] ?? 0) - (from.expressions[name] ?? 0)) * t])), gaze: { yaw: from.gaze.yaw + (to.gaze.yaw - from.gaze.yaw) * t, pitch: from.gaze.pitch + (to.gaze.pitch - from.gaze.pitch) * t } };
};

export class FaceExpressionLossProcessor {
  private state: FaceExpressionLossState = "idle"; private cached: FaceMotionSample | null = null; private output: FaceMotionSample = neutral();
  private lastTrackedAtMs: number | null = null; private lastSampledAtMs: number | null = null; private confirmationCount = 0;
  private recoveryStartedAtMs: number | null = null; private recoveryFrom: FaceMotionSample | null = null; private longLossResetSent = false;
  private diagnostics: FaceExpressionLossDiagnostics = { state: "idle", lostDurationMs: 0, returnProgress: 1, recoveryProgress: 0, confirmationCount: 0, longLossResetRequested: false, cached: null };
  private readonly config: FaceExpressionLossConfig;
  constructor(config: FaceExpressionLossConfig) { this.config = config; }

  process(candidate: FaceMotionSample | null, source: TrackingSampleState, sampledAtMs: number | null, nowMs: number): FaceMotionSample {
    const isNew = source === "tracked" && candidate !== null && sampledAtMs !== null && sampledAtMs !== this.lastSampledAtMs;
    if (isNew) return this.accept(candidate, sampledAtMs, nowMs);
    if (source === "tracked" && candidate !== null) { this.record(0, 0, this.state === "active" ? 1 : 0, false); return clone(this.output); }
    return this.lose(source, nowMs);
  }

  snapshot(): FaceExpressionLossDiagnostics { return { ...this.diagnostics, cached: this.diagnostics.cached ? clone(this.diagnostics.cached) : null }; }
  reset(): void { this.state = "idle"; this.cached = null; this.output = neutral(); this.lastTrackedAtMs = null; this.lastSampledAtMs = null; this.confirmationCount = 0; this.recoveryStartedAtMs = null; this.recoveryFrom = null; this.longLossResetSent = false; this.record(0, 1, 0, false); }

  private accept(candidate: FaceMotionSample, sampledAtMs: number, nowMs: number): FaceMotionSample {
    this.lastSampledAtMs = sampledAtMs; this.lastTrackedAtMs = nowMs; this.longLossResetSent = false;
    if (this.state === "idle" || this.state === "held" || this.state === "returning" || this.state === "confirming") {
      this.confirmationCount += 1; this.state = "confirming";
      if (this.cached === null) { this.cached = clone(candidate); this.output = clone(candidate); this.state = "active"; this.confirmationCount = 0; this.record(0, 0, 1, false); return clone(this.output); }
      if (this.confirmationCount < this.config.confirmationSamples) { this.record(0, 0, 0, false); return clone(this.output); }
      this.state = "recovering"; this.recoveryStartedAtMs = nowMs; this.recoveryFrom = clone(this.output); this.confirmationCount = 0;
    }
    if (this.state === "recovering") {
      const progress = Math.min(1, Math.max(0, (nowMs - this.recoveryStartedAtMs!) / Math.max(1, this.config.recoveryMs)));
      this.output = mix(this.recoveryFrom!, candidate, progress); this.cached = clone(candidate);
      if (progress >= 1) { this.state = "active"; this.recoveryStartedAtMs = null; this.recoveryFrom = null; }
      this.record(0, 0, progress, false); return clone(this.output);
    }
    this.state = "active"; this.cached = clone(candidate); this.output = clone(candidate); this.confirmationCount = 0; this.record(0, 0, 1, false); return clone(this.output);
  }

  private lose(source: TrackingSampleState, nowMs: number): FaceMotionSample {
    if (source === "not-sampled" && this.state === "active") { this.record(0, 0, 1, false); return clone(this.output); }
    if (!this.cached || this.lastTrackedAtMs === null) { this.state = "idle"; this.output = neutral(); this.record(0, 1, 0, false); return clone(this.output); }
    this.confirmationCount = 0; this.recoveryStartedAtMs = null; this.recoveryFrom = null;
    const lostFor = Math.max(0, nowMs - this.lastTrackedAtMs);
    if (lostFor <= this.config.holdMs) { this.state = "held"; this.output = clone(this.cached); this.record(lostFor, 0, 0, false); return clone(this.output); }
    const progress = Math.min(1, (lostFor - this.config.holdMs) / Math.max(1, this.config.returnMs)); this.output = mix(this.cached, neutral(Object.keys(this.cached.expressions)), progress);
    this.state = progress < 1 ? "returning" : "idle"; const reset = progress >= 1 && !this.longLossResetSent; if (reset) this.longLossResetSent = true;
    this.record(lostFor, progress, 0, reset); return clone(this.output);
  }

  private record(lostDurationMs: number, returnProgress: number, recoveryProgress: number, reset: boolean): void { this.diagnostics = { state: this.state, lostDurationMs, returnProgress, recoveryProgress, confirmationCount: this.confirmationCount, longLossResetRequested: reset, cached: this.cached ? clone(this.cached) : null }; }
}
