import type { AudioActivitySource } from "./audioActivity";

export interface MouthTimingConfig {
  jawAttackMs: number; jawReleaseMs: number; suppressionStart: number; suppressionFull: number;
  strongCloseEnter: number; strongCloseExit: number; strongCloseConfirmMs: number; strongCloseReleaseMs: number;
  speakingJawThreshold: number; neutralJawThreshold: number; audioJawHoldMaximum: number; audioHoldMs: number; maximumDeltaMs: number;
  pressWeights: { close: number; left: number; right: number; upperRoll: number; lowerRoll: number };
}
export const DEFAULT_MOUTH_TIMING_CONFIG: MouthTimingConfig = {
  jawAttackMs: 35, jawReleaseMs: 55, suppressionStart: .2, suppressionFull: .8, strongCloseEnter: .82, strongCloseExit: .55,
  strongCloseConfirmMs: 45, strongCloseReleaseMs: 35, speakingJawThreshold: .08, neutralJawThreshold: .025,
  audioJawHoldMaximum: .08, audioHoldMs: 70, maximumDeltaMs: 100,
  pressWeights: { close: 1, left: .85, right: .85, upperRoll: .7, lowerRoll: .7 },
};
export type MouthTimingState = "neutral" | "opening" | "speaking" | "closing" | "pressed";
export interface MouthTimingDiagnostics { rawJawOpen: number; filteredJawOpen: number; closeOrPressStrength: number; suppressionWeight: number; strongCloseLatched: boolean; audioAvailable: boolean; audioActivity: number | null; outputJawOpen: number; outputMouthClose: number; state: MouthTimingState; dtMs: number }
const clamp01 = (value: number): number => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const smoothstep = (a: number, b: number, value: number): number => { const x = clamp01((value - a) / Math.max(1e-6, b - a)); return x * x * (3 - 2 * x); };
const alpha = (dtMs: number, timeMs: number): number => timeMs <= 0 ? 1 : 1 - Math.exp(-dtMs / timeMs);
export class MouthTimingProcessor {
  private outputJaw = 0; private lastAtMs: number | null = null; private lastSampledAtMs: number | null = null; private latched = false; private pendingSinceMs: number | null = null; private releaseSinceMs: number | null = null; private lastAudioActiveAtMs: number | null = null; private diagnostics: MouthTimingDiagnostics | null = null;
  private readonly config: MouthTimingConfig; private audio: AudioActivitySource | null;
  constructor(config: MouthTimingConfig = DEFAULT_MOUTH_TIMING_CONFIG, audio: AudioActivitySource | null = null) { this.config = config; this.audio = audio; }
  setAudioSource(source: AudioActivitySource | null): void { if (this.audio !== source) this.audio?.dispose?.(); this.audio = source; }
  reset(): void { this.outputJaw = 0; this.lastAtMs = null; this.lastSampledAtMs = null; this.latched = false; this.pendingSinceMs = null; this.releaseSinceMs = null; this.lastAudioActiveAtMs = null; this.diagnostics = null; }
  dispose(): void { this.audio?.dispose?.(); this.audio = null; this.reset(); }
  snapshot(): MouthTimingDiagnostics | null { return this.diagnostics ? { ...this.diagnostics } : null; }
  process(values: Record<string, number>, sampledAtMs: number | null, nowMs: number, tracked = true): Record<string, number> {
    if (sampledAtMs !== null && this.lastSampledAtMs !== null && sampledAtMs < this.lastSampledAtMs) this.reset();
    const dtMs = Math.min(this.config.maximumDeltaMs, Math.max(0, this.lastAtMs === null ? 0 : nowMs - this.lastAtMs)); this.lastAtMs = nowMs;
    const duplicate = sampledAtMs !== null && sampledAtMs === this.lastSampledAtMs; if (sampledAtMs !== null && !duplicate) this.lastSampledAtMs = sampledAtMs;
    const rawJaw = tracked ? clamp01(values.jawOpen ?? 0) : 0;
    const press = tracked ? Math.max(clamp01(values.mouthClose ?? 0) * this.config.pressWeights.close, clamp01(values.mouthPressLeft ?? 0) * this.config.pressWeights.left, clamp01(values.mouthPressRight ?? 0) * this.config.pressWeights.right, clamp01(values.mouthRollUpper ?? 0) * this.config.pressWeights.upperRoll, clamp01(values.mouthRollLower ?? 0) * this.config.pressWeights.lowerRoll) : 0;
    if (!duplicate) this.updateLatch(press, nowMs);
    const suppression = smoothstep(this.config.suppressionStart, this.config.suppressionFull, press);
    let target = rawJaw * (1 - suppression); if (this.latched) target = 0;
    const audioActivity = this.audio?.getActivity(nowMs) ?? null; if (audioActivity !== null && audioActivity > .08) this.lastAudioActiveAtMs = nowMs;
    if (!this.latched && this.lastAudioActiveAtMs !== null && nowMs - this.lastAudioActiveAtMs <= this.config.audioHoldMs) target = Math.max(target, Math.min(this.config.audioJawHoldMaximum, clamp01(audioActivity ?? 0) * this.config.audioJawHoldMaximum));
    const previous = this.outputJaw; const time = target > previous ? this.config.jawAttackMs : this.config.jawReleaseMs; this.outputJaw += (target - this.outputJaw) * alpha(dtMs, time); if (dtMs === 0 && this.lastSampledAtMs === sampledAtMs) this.outputJaw = target;
    const state: MouthTimingState = this.latched || press > this.config.strongCloseExit ? "pressed" : this.outputJaw <= this.config.neutralJawThreshold ? "neutral" : target > previous ? "opening" : this.outputJaw > this.config.speakingJawThreshold ? "speaking" : "closing";
    this.diagnostics = { rawJawOpen: rawJaw, filteredJawOpen: this.outputJaw, closeOrPressStrength: press, suppressionWeight: suppression, strongCloseLatched: this.latched, audioAvailable: audioActivity !== null, audioActivity, outputJawOpen: clamp01(this.outputJaw), outputMouthClose: clamp01(values.mouthClose ?? 0), state, dtMs };
    return { ...values, jawOpen: clamp01(this.outputJaw), aa: clamp01(this.outputJaw), mouthClose: clamp01(values.mouthClose ?? 0) };
  }
  private updateLatch(press: number, nowMs: number): void {
    if (!this.latched) { this.releaseSinceMs = null; if (press >= this.config.strongCloseEnter) { this.pendingSinceMs ??= nowMs; if (nowMs - this.pendingSinceMs >= this.config.strongCloseConfirmMs) { this.latched = true; this.pendingSinceMs = null; } } else this.pendingSinceMs = null; }
    else { this.pendingSinceMs = null; if (press <= this.config.strongCloseExit) { this.releaseSinceMs ??= nowMs; if (nowMs - this.releaseSinceMs >= this.config.strongCloseReleaseMs) { this.latched = false; this.releaseSinceMs = null; } } else this.releaseSinceMs = null; }
  }
}
