import { OneEuroScalarFilter } from "./oneEuroFilter";
import type { TorsoEulerDegrees } from "./torsoOrientation";

export interface TorsoTemporalResult { input: TorsoEulerDegrees; output: TorsoEulerDegrees; sampleAdvanced: boolean }
export type TorsoLossState = "idle" | "active" | "held" | "returning" | "confirming" | "recovering";
export interface TorsoLossResult { state: TorsoLossState; output: TorsoEulerDegrees; lossDurationMs: number; progress: number; confirmationCount: number; sampleAdvanced: boolean }

export class TorsoTemporalProcessor {
  private readonly yaw = new OneEuroScalarFilter({ minCutoff: 1.5, beta: .06, derivativeCutoff: 1 });
  private readonly pitch = new OneEuroScalarFilter({ minCutoff: 1.35, beta: .04, derivativeCutoff: 1 });
  private readonly roll = new OneEuroScalarFilter({ minCutoff: 1.35, beta: .04, derivativeCutoff: 1 });
  private lastSampledAtMs: number | null = null; private lastOutput: TorsoEulerDegrees | null = null;
  process(input: TorsoEulerDegrees, sampledAtMs: number, enabled: boolean): TorsoTemporalResult {
    if (this.lastSampledAtMs !== null && sampledAtMs <= this.lastSampledAtMs && this.lastOutput) return { input, output: { ...this.lastOutput }, sampleAdvanced: false };
    const output = enabled ? { yaw: this.yaw.filter(input.yaw, sampledAtMs), pitch: this.pitch.filter(input.pitch, sampledAtMs), roll: this.roll.filter(input.roll, sampledAtMs) } : { ...input };
    if (!enabled) { this.yaw.reset(output.yaw, sampledAtMs); this.pitch.reset(output.pitch, sampledAtMs); this.roll.reset(output.roll, sampledAtMs); }
    this.lastSampledAtMs = sampledAtMs; this.lastOutput = output; return { input, output, sampleAdvanced: true };
  }
  reset(): void { this.yaw.reset(); this.pitch.reset(); this.roll.reset(); this.lastSampledAtMs = null; this.lastOutput = null; }
}

const ZERO: TorsoEulerDegrees = { yaw: 0, pitch: 0, roll: 0 };
const smooth = (value: number) => { const t = Math.min(1, Math.max(0, value)); return t * t * (3 - 2 * t); };
const blend = (a: TorsoEulerDegrees, b: TorsoEulerDegrees, t: number): TorsoEulerDegrees => ({ yaw: a.yaw + (b.yaw - a.yaw) * t, pitch: a.pitch + (b.pitch - a.pitch) * t, roll: a.roll + (b.roll - a.roll) * t });

/** Giữ ngắn, trở neutral mềm và xác nhận hai sample trước khi reacquire torso. */
export class TorsoLossRecoveryProcessor {
  private state: TorsoLossState = "idle"; private output = { ...ZERO }; private lossStartMs: number | null = null; private lossOrigin = { ...ZERO };
  private lastSampledAtMs: number | null = null; private confirmationCount = 0; private recoveryStartMs: number | null = null; private recoveryOrigin = { ...ZERO };
  private readonly config: { holdMs: number; returnMs: number; recoveryMs: number; confirmationSamples: number };
  constructor(config = { holdMs: 250, returnMs: 500, recoveryMs: 180, confirmationSamples: 2 }) { this.config = config; }
  process(candidate: TorsoEulerDegrees | null, source: "tracked" | "lost" | "not-sampled", sampledAtMs: number | null, nowMs: number): TorsoLossResult {
    if (candidate && sampledAtMs !== null && this.lastSampledAtMs !== null && sampledAtMs < this.lastSampledAtMs) this.reset();
    const isNew = candidate !== null && source === "tracked" && sampledAtMs !== null && (this.lastSampledAtMs === null || sampledAtMs > this.lastSampledAtMs);
    if (source === "not-sampled" || (candidate && !isNew)) return this.result(nowMs, false);
    if (isNew) {
      this.lastSampledAtMs = sampledAtMs;
      if (this.state === "active" || (this.state === "idle" && this.lossStartMs === null)) { this.state = "active"; this.output = { ...candidate! }; return this.result(nowMs, true); }
      if (this.state === "recovering") { const p = smooth((nowMs - (this.recoveryStartMs ?? nowMs)) / this.config.recoveryMs); this.output = blend(this.recoveryOrigin, candidate!, p); if (p >= 1) { this.state = "active"; this.confirmationCount = 0; this.lossStartMs = null; } return this.result(nowMs, true); }
      this.state = "confirming"; this.confirmationCount++;
      if (this.confirmationCount >= this.config.confirmationSamples) { this.state = "recovering"; this.recoveryStartMs = nowMs; this.recoveryOrigin = { ...this.output }; }
      return this.result(nowMs, true);
    }
    if (source === "lost" || (source === "tracked" && !candidate)) {
      if (this.state === "confirming" || this.state === "recovering") { this.lossStartMs = null; this.confirmationCount = 0; }
      if (this.lossStartMs === null) { this.lossStartMs = nowMs; this.lossOrigin = { ...this.output }; this.state = "held"; }
      const elapsed = nowMs - this.lossStartMs;
      if (elapsed > this.config.holdMs) { this.state = "returning"; const p = smooth((elapsed - this.config.holdMs) / this.config.returnMs); this.output = blend(this.lossOrigin, ZERO, p); if (p >= 1) this.state = "idle"; }
    }
    return this.result(nowMs, false);
  }
  reset(): void { this.state = "idle"; this.output = { ...ZERO }; this.lossStartMs = null; this.lastSampledAtMs = null; this.confirmationCount = 0; this.recoveryStartMs = null; }
  private result(nowMs: number, sampleAdvanced: boolean): TorsoLossResult { const duration = this.lossStartMs === null ? 0 : Math.max(0, nowMs - this.lossStartMs); const progress = this.state === "returning" ? Math.min(1, (duration - this.config.holdMs) / this.config.returnMs) : this.state === "recovering" && this.recoveryStartMs !== null ? Math.min(1, (nowMs - this.recoveryStartMs) / this.config.recoveryMs) : 0; return { state: this.state, output: { ...this.output }, lossDurationMs: duration, progress, confirmationCount: this.confirmationCount, sampleAdvanced }; }
}
