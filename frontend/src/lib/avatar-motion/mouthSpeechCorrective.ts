const VISEMES = ["aa", "ih", "ou", "ee", "oh"] as const;

export interface MouthSpeechCorrectiveConfig {
  activityOnset: number;
  activityFull: number;
  midRangeLift: number;
  peakDecayMs: number;
  strongClosure: number;
  maxContinuousGapMs: number;
  epsilon: number;
}

export interface MouthSpeechEvidence {
  visibleOpening: number;
  round: number;
  stretch: number;
  closure: number;
}

export type MouthSpeechCorrectiveDisposition =
  | "active" | "temporal-bypassed" | "closure-reset" | "gap-reset" | "no-viseme" | "reset";

export interface MouthSpeechCorrectiveSnapshot {
  disposition: MouthSpeechCorrectiveDisposition;
  sampledAtMs: number | null;
  deltaTimeMs: number | null;
  activity: Readonly<{ visibleOpening: number; round: number; stretch: number; candidate: number }>;
  currentAmplitude: number;
  boostedAmplitude: number;
  preservedEnvelope: number;
  envelopeGain: number;
  closure: number;
  dominantViseme: typeof VISEMES[number] | null;
}

const clamp01 = (value: number | undefined): number => Number.isFinite(value) ? Math.min(1, Math.max(0, value!)) : 0;
const smoothstep = (value: number, onset: number, full: number): number => {
  const t = clamp01((value - onset) / (full - onset));
  return t * t * (3 - 2 * t);
};
const sumVisemes = (values: Readonly<Record<string, number>>): number =>
  Math.min(1, VISEMES.reduce((sum, name) => sum + clamp01(values[name]), 0));

const EMPTY_ACTIVITY = Object.freeze({ visibleOpening: 0, round: 0, stretch: 0, candidate: 0 });

export function createNeutralMouthSpeechCorrectiveSnapshot(): MouthSpeechCorrectiveSnapshot {
  return {
    disposition: "reset", sampledAtMs: null, deltaTimeMs: null, activity: EMPTY_ACTIVITY,
    currentAmplitude: 0, boostedAmplitude: 0, preservedEnvelope: 0, envelopeGain: 1,
    closure: 0, dominantViseme: null,
  };
}

export function validateMouthSpeechCorrectiveConfig(config: MouthSpeechCorrectiveConfig): void {
  for (const [name, value] of Object.entries(config)) {
    if (!Number.isFinite(value)) throw new RangeError(`Mouth speech corrective ${name} phải hữu hạn.`);
  }
  if (config.activityOnset < 0 || config.activityFull > 1 || config.activityFull <= config.activityOnset) {
    throw new RangeError("Mouth speech corrective activity range phải thỏa 0 <= onset < full <= 1.");
  }
  if (config.midRangeLift < 0 || config.midRangeLift > 1) throw new RangeError("Mouth speech corrective midRangeLift phải trong [0,1].");
  if (config.peakDecayMs <= 0 || config.maxContinuousGapMs <= 0) throw new RangeError("Mouth speech corrective time constants phải > 0.");
  if (config.strongClosure <= 0 || config.strongClosure > 1) throw new RangeError("Mouth speech corrective strongClosure phải trong (0,1].");
  if (config.epsilon <= 0) throw new RangeError("Mouth speech corrective epsilon phải > 0.");
}

/**
 * F4 corrective: tăng độ rõ của chính viseme F3 hiện tại và giữ một envelope ngắn theo wall-clock.
 * Shape được lưu như một vector chuẩn hóa duy nhất; input mới thay shape cũ ngay nên các nguyên âm không cộng dồn.
 */
export class MouthSpeechCorrective {
  private readonly config: MouthSpeechCorrectiveConfig;
  private lastSampledAtMs: number | null = null;
  private envelope = 0;
  private shape: Record<typeof VISEMES[number], number> = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
  private lastSnapshot: MouthSpeechCorrectiveSnapshot = createNeutralMouthSpeechCorrectiveSnapshot();

  constructor(config: MouthSpeechCorrectiveConfig) {
    validateMouthSpeechCorrectiveConfig(config);
    this.config = config;
  }

  process(
    input: Readonly<Record<string, number>>,
    evidence: Readonly<MouthSpeechEvidence>,
    sampledAtMs: number,
    temporalEnabled: boolean,
  ): Record<string, number> {
    const output = Object.fromEntries(Object.entries(input).map(([name, value]) => [name, clamp01(value)]));
    if (!Number.isFinite(sampledAtMs)) return output;

    const visibleOpening = clamp01(evidence.visibleOpening);
    const round = clamp01(evidence.round);
    const stretch = clamp01(evidence.stretch);
    const closure = clamp01(evidence.closure);
    const candidate = Math.max(visibleOpening, round, stretch);
    const activity = Object.freeze({ visibleOpening, round, stretch, candidate });
    const deltaTimeMs = this.lastSampledAtMs === null ? null : sampledAtMs - this.lastSampledAtMs;
    const invalidGap = deltaTimeMs !== null && (deltaTimeMs <= 0 || deltaTimeMs > this.config.maxContinuousGapMs);
    const currentAmplitude = sumVisemes(output);

    if (closure >= this.config.strongClosure) {
      this.clearTemporal(sampledAtMs);
      this.lastSnapshot = {
        disposition: "closure-reset", sampledAtMs, deltaTimeMs, activity,
        currentAmplitude, boostedAmplitude: currentAmplitude, preservedEnvelope: 0,
        envelopeGain: 1, closure, dominantViseme: null,
      };
      return output;
    }

    const liftWeight = smoothstep(candidate, this.config.activityOnset, this.config.activityFull);
    const boostedAmplitude = currentAmplitude <= this.config.epsilon
      ? 0
      : Math.min(1, currentAmplitude + this.config.midRangeLift * liftWeight * (1 - currentAmplitude));
    const currentShape = currentAmplitude <= this.config.epsilon ? null : Object.fromEntries(VISEMES.map((name) => [
      name,
      clamp01(output[name]) / currentAmplitude,
    ])) as Record<typeof VISEMES[number], number>;

    let disposition: MouthSpeechCorrectiveDisposition = "active";
    if (invalidGap) {
      this.envelope = 0;
      this.shape = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
      disposition = "gap-reset";
    }

    if (!temporalEnabled) {
      this.envelope = boostedAmplitude;
      if (currentShape) this.shape = currentShape;
      disposition = "temporal-bypassed";
    } else {
      const decayed = deltaTimeMs === null || invalidGap
        ? 0
        : this.envelope * Math.exp(-deltaTimeMs / this.config.peakDecayMs);
      this.envelope = Math.max(boostedAmplitude, decayed);
      // Một shape mới thay hoàn toàn shape cũ; không giữ độc lập aa/ih/ou/ee/oh rồi cộng chồng.
      if (currentShape) this.shape = currentShape;
      else if (this.envelope <= this.config.epsilon) {
        this.shape = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
        disposition = "no-viseme";
      }
    }

    for (const name of VISEMES) output[name] = clamp01(this.shape[name] * this.envelope);
    const dominantViseme = VISEMES.reduce<typeof VISEMES[number] | null>((best, name) =>
      output[name] > (best ? output[best] : 0) ? name : best, null);
    this.lastSampledAtMs = sampledAtMs;
    this.lastSnapshot = {
      disposition, sampledAtMs, deltaTimeMs, activity, currentAmplitude, boostedAmplitude,
      preservedEnvelope: this.envelope,
      envelopeGain: currentAmplitude > this.config.epsilon ? this.envelope / currentAmplitude : 1,
      closure, dominantViseme,
    };
    return output;
  }

  reset(disposition: MouthSpeechCorrectiveDisposition = "reset"): void {
    this.lastSampledAtMs = null;
    this.envelope = 0;
    this.shape = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
    this.lastSnapshot = { ...createNeutralMouthSpeechCorrectiveSnapshot(), disposition };
  }

  snapshot(): MouthSpeechCorrectiveSnapshot { return structuredClone(this.lastSnapshot); }

  private clearTemporal(sampledAtMs: number): void {
    this.lastSampledAtMs = sampledAtMs;
    this.envelope = 0;
    this.shape = { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 };
  }
}
