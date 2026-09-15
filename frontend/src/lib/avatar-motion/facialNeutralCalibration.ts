import { clamp01 } from "./coordinateAdapter";

export interface FacialNeutralCalibrationConfig {
  sampleCount: number;
  deadZone: number;
  neutralActivationLimit: number;
  adaptiveRate: number;
  adaptiveWindow: number;
}

export interface FacialNeutralCalibrationSnapshot {
  state: "collecting" | "ready";
  collectionMode: "automatic" | "manual";
  acceptedSamples: number;
  rejectedSamples: number;
  requiredSamples: number;
  baselines: Readonly<Record<string, number>>;
}

const NEUTRAL_GUARD_CHANNELS = [
  "eyeBlinkLeft", "eyeBlinkRight", "jawOpen",
  "mouthSmileLeft", "mouthSmileRight", "mouthFrownLeft", "mouthFrownRight",
  "browDownLeft", "browDownRight", "browInnerUp",
] as const;

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * F1: học bias trung tính từ dữ liệu blendshape local-only. Trong lúc thu baseline, output vẫn đi thẳng
 * để không làm avatar "chết"; baseline chỉ có hiệu lực sau khi đủ sample trung tính.
 */
export class FacialNeutralCalibrator {
  private acceptedSamples = 0;
  private rejectedSamples = 0;
  private collectionMode: "automatic" | "manual" = "automatic";
  private readonly samples = new Map<string, number[]>();
  private readonly baselines = new Map<string, number>();
  private readonly config: FacialNeutralCalibrationConfig;

  constructor(config: FacialNeutralCalibrationConfig) { this.config = config; }

  process(input: Readonly<Record<string, number>>): Record<string, number> {
    const values = Object.fromEntries(Object.entries(input).map(([name, value]) => [name, clamp01(value)]));
    const neutralCandidate = this.isNeutralCandidate(values);
    const wasReady = this.ready;
    if (!wasReady && (this.collectionMode === "manual" || neutralCandidate)) this.collect(values);
    else if (!wasReady) this.rejectedSamples += 1;
    if (!this.ready) return values;

    if (wasReady && neutralCandidate) this.adapt(values);
    return Object.fromEntries(Object.entries(values).map(([name, value]) => {
      const baseline = this.baselines.get(name) ?? 0;
      const residual = Math.max(0, value - baseline - this.config.deadZone);
      const availableRange = Math.max(1e-4, 1 - baseline - this.config.deadZone);
      return [name, clamp01(residual / availableRange)];
    }));
  }

  beginCalibration(): void { this.clear("manual"); }
  reset(): void { this.clear("automatic"); }

  snapshot(): FacialNeutralCalibrationSnapshot {
    return {
      state: this.ready ? "ready" : "collecting",
      collectionMode: this.collectionMode,
      acceptedSamples: this.acceptedSamples,
      rejectedSamples: this.rejectedSamples,
      requiredSamples: this.config.sampleCount,
      baselines: Object.freeze(Object.fromEntries(this.baselines)),
    };
  }

  private get ready(): boolean { return this.acceptedSamples >= this.config.sampleCount; }

  private isNeutralCandidate(input: Readonly<Record<string, number>>): boolean {
    return NEUTRAL_GUARD_CHANNELS.every((name) => (input[name] ?? 0) <= this.config.neutralActivationLimit);
  }

  private collect(input: Readonly<Record<string, number>>): void {
    for (const [name, value] of Object.entries(input)) {
      const samples = this.samples.get(name) ?? [];
      samples.push(value); this.samples.set(name, samples);
    }
    this.acceptedSamples += 1;
    if (!this.ready) return;
    for (const [name, samples] of this.samples) this.baselines.set(name, median(samples));
  }

  private adapt(input: Readonly<Record<string, number>>): void {
    for (const [name, value] of Object.entries(input)) {
      const baseline = this.baselines.get(name) ?? 0;
      if (value > baseline + this.config.adaptiveWindow) continue;
      this.baselines.set(name, baseline + (value - baseline) * this.config.adaptiveRate);
    }
  }

  private clear(mode: "automatic" | "manual"): void {
    this.acceptedSamples = 0;
    this.rejectedSamples = 0;
    this.collectionMode = mode;
    this.samples.clear();
    this.baselines.clear();
  }
}
