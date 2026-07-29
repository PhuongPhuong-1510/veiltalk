import type { TrackingSampleState } from "../tracking/rawTrackingTypes";
import type { HeadEulerDegrees } from "./headOrientation";

export type HeadLossState = "idle" | "active" | "held" | "returning" | "confirming" | "recovering";
export interface HeadLossConfig { holdMs: number; returnMs: number; recoveryMs: number; confirmationSamples: number }
export interface HeadLossResult { state: HeadLossState; output: HeadEulerDegrees; lossDurationMs: number; progress: number; confirmationCount: number; sampleAdvanced: boolean }
export const DEFAULT_HEAD_LOSS_CONFIG: HeadLossConfig = { holdMs: 250, returnMs: 500, recoveryMs: 180, confirmationSamples: 2 };
const ZERO: HeadEulerDegrees = { yaw: 0, pitch: 0, roll: 0 };
const smooth = (v: number) => { const t = Math.min(1, Math.max(0, v)); return t * t * (3 - 2 * t); };
const blend = (a: HeadEulerDegrees, b: HeadEulerDegrees, t: number): HeadEulerDegrees => ({ yaw: a.yaw + (b.yaw - a.yaw) * t, pitch: a.pitch + (b.pitch - a.pitch) * t, roll: a.roll + (b.roll - a.roll) * t });

export class HeadLossRecoveryProcessor {
  private readonly config: HeadLossConfig;
  private state: HeadLossState = "idle"; private output = { ...ZERO }; private lossStartMs: number | null = null; private lossOrigin = { ...ZERO };
  private lastSampledAtMs: number | null = null; private confirmationCount = 0; private recoveryStartMs: number | null = null; private recoveryOrigin = { ...ZERO };
  constructor(config: HeadLossConfig = DEFAULT_HEAD_LOSS_CONFIG) { this.config = config; }
  process(candidate: HeadEulerDegrees | null, source: TrackingSampleState, sampledAtMs: number | null, nowMs: number): HeadLossResult {
    if (candidate && sampledAtMs !== null && this.lastSampledAtMs !== null && sampledAtMs < this.lastSampledAtMs) this.reset();
    const isNew = candidate !== null && source === "tracked" && sampledAtMs !== null && (this.lastSampledAtMs === null || sampledAtMs > this.lastSampledAtMs);
    if (source === "not-sampled" || (candidate && !isNew)) return this.result(nowMs, false);
    if (isNew) {
      this.lastSampledAtMs = sampledAtMs;
      if (this.state === "active" || (this.state === "idle" && this.lossStartMs === null)) { this.state = "active"; this.output = { ...candidate }; return this.result(nowMs, true); }
      if (this.state === "recovering") {
        const p = smooth((nowMs - this.recoveryStartMs!) / this.config.recoveryMs); this.output = blend(this.recoveryOrigin, candidate, p);
        if (p >= 1) { this.state = "active"; this.confirmationCount = 0; this.lossStartMs = null; }
        return this.result(nowMs, true);
      }
      this.confirmationCount += 1; this.state = "confirming";
      if (this.confirmationCount >= this.config.confirmationSamples) { this.state = "recovering"; this.recoveryStartMs = nowMs; this.recoveryOrigin = { ...this.output }; }
      return this.result(nowMs, true);
    }
    if (source === "lost" || candidate === null) {
      if (this.state === "confirming" || this.state === "recovering") { this.lossStartMs = null; this.confirmationCount = 0; }
      if (this.lossStartMs === null) { this.lossStartMs = nowMs; this.lossOrigin = { ...this.output }; this.state = "held"; this.confirmationCount = 0; }
      const elapsed = nowMs - this.lossStartMs;
      if (elapsed > this.config.holdMs) { this.state = "returning"; const p = smooth((elapsed - this.config.holdMs) / this.config.returnMs); this.output = blend(this.lossOrigin, ZERO, p); if (p >= 1) this.state = "idle"; }
    }
    return this.result(nowMs, false);
  }
  reset(): void { this.state = "idle"; this.output = { ...ZERO }; this.lossStartMs = null; this.lastSampledAtMs = null; this.confirmationCount = 0; this.recoveryStartMs = null; }
  private result(nowMs: number, sampleAdvanced: boolean): HeadLossResult { const duration = this.lossStartMs === null ? 0 : Math.max(0, nowMs - this.lossStartMs); const progress = this.state === "returning" ? Math.min(1, (duration - this.config.holdMs) / this.config.returnMs) : this.state === "recovering" && this.recoveryStartMs !== null ? Math.min(1, (nowMs - this.recoveryStartMs) / this.config.recoveryMs) : 0; return { state: this.state, output: { ...this.output }, lossDurationMs: duration, progress, confirmationCount: this.confirmationCount, sampleAdvanced }; }
}
