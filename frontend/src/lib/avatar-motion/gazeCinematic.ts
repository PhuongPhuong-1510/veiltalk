export interface GazeCinematicConfig {
  transitionMs: number;
  attentionMaxFraction: number;
  stableMagnitude: number;
  saccadeIntervalMs: number;
  saccadeDurationMs: number;
  saccadeAmplitude: number;
  idleBlinkIntervalMs: number;
  idleBlinkDurationMs: number;
  seed: number;
}

export interface GazeCinematicOutput {
  yaw: number;
  pitch: number;
  proceduralBlink: number;
  blend: number;
  attentionBias: { yaw: number; pitch: number };
  saccade: { yaw: number; pitch: number };
}

export const DEFAULT_GAZE_CINEMATIC_CONFIG: GazeCinematicConfig = {
  transitionMs: 180,
  attentionMaxFraction: .18,
  stableMagnitude: .3,
  saccadeIntervalMs: 1_150,
  saccadeDurationMs: 150,
  saccadeAmplitude: .028,
  idleBlinkIntervalMs: 5_300,
  idleBlinkDurationMs: 140,
  seed: 0x6a09e667,
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const hash01 = (value: number) => {
  let x = (value | 0) ^ 0x9e3779b9;
  x = Math.imul(x ^ (x >>> 16), 0x21f0aaad); x = Math.imul(x ^ (x >>> 15), 0x735a2d97); x ^= x >>> 15;
  return (x >>> 0) / 0xffffffff;
};

export class GazeCinematicLayer {
  private readonly config: GazeCinematicConfig;
  private enabled = false;
  private blend = 0;
  private lastAtMs: number | null = null;

  constructor(config: GazeCinematicConfig = DEFAULT_GAZE_CINEMATIC_CONFIG) {
    validateGazeCinematicConfig(config); this.config = config;
  }

  setEnabled(enabled: boolean): void { this.enabled = enabled; }

  apply(base: Readonly<{ yaw: number; pitch: number }>, nowMs: number, active: boolean, quality: number, attentionStrength: number): GazeCinematicOutput {
    const dt = this.lastAtMs === null ? 0 : Math.max(0, Math.min(100, nowMs - this.lastAtMs)); this.lastAtMs = nowMs;
    const step = dt / this.config.transitionMs;
    this.blend = this.enabled ? Math.min(1, this.blend + step) : Math.max(0, this.blend - step);
    if (!active || quality <= 0 || this.blend <= 0) return this.output(base, 0, 0, 0, 0, 0);

    const magnitude = Math.hypot(base.yaw, base.pitch);
    const stableWeight = clamp01(1 - magnitude / this.config.stableMagnitude);
    const attentionWeight = clamp01(attentionStrength) * stableWeight * this.config.attentionMaxFraction * this.blend;
    const biasYaw = -base.yaw * attentionWeight, biasPitch = -base.pitch * attentionWeight;

    const cycle = Math.floor(nowMs / this.config.saccadeIntervalMs);
    const phase = ((nowMs % this.config.saccadeIntervalMs) + this.config.saccadeIntervalMs) % this.config.saccadeIntervalMs;
    const pulse = phase < this.config.saccadeDurationMs ? Math.sin(Math.PI * phase / this.config.saccadeDurationMs) : 0;
    const sx = (hash01(cycle + this.config.seed) * 2 - 1) * this.config.saccadeAmplitude * pulse * stableWeight * this.blend;
    const sy = (hash01(cycle + this.config.seed + 17) * 2 - 1) * this.config.saccadeAmplitude * .65 * pulse * stableWeight * this.blend;

    const blinkPhase = ((nowMs + this.config.seed % 997) % this.config.idleBlinkIntervalMs + this.config.idleBlinkIntervalMs) % this.config.idleBlinkIntervalMs;
    const blinkPulse = blinkPhase < this.config.idleBlinkDurationMs ? Math.sin(Math.PI * blinkPhase / this.config.idleBlinkDurationMs) ** 2 : 0;
    return this.output(base, biasYaw, biasPitch, sx, sy, blinkPulse * stableWeight * this.blend);
  }

  reset(): void { this.enabled = false; this.blend = 0; this.lastAtMs = null; }

  private output(base: Readonly<{ yaw: number; pitch: number }>, biasYaw: number, biasPitch: number, sx: number, sy: number, proceduralBlink: number): GazeCinematicOutput {
    return { yaw: base.yaw + biasYaw + sx, pitch: base.pitch + biasPitch + sy, proceduralBlink, blend: this.blend, attentionBias: { yaw: biasYaw, pitch: biasPitch }, saccade: { yaw: sx, pitch: sy } };
  }
}

export function validateGazeCinematicConfig(config: GazeCinematicConfig): void {
  if (!Object.values(config).every(Number.isFinite)
      || config.transitionMs <= 0 || config.attentionMaxFraction < 0 || config.attentionMaxFraction > 1
      || config.stableMagnitude <= 0 || config.saccadeIntervalMs <= config.saccadeDurationMs
      || config.saccadeDurationMs <= 0 || config.saccadeAmplitude < 0 || config.saccadeAmplitude > .2
      || config.idleBlinkIntervalMs <= config.idleBlinkDurationMs || config.idleBlinkDurationMs <= 0) {
    throw new Error("Cấu hình cinematic gaze không hợp lệ.");
  }
}
