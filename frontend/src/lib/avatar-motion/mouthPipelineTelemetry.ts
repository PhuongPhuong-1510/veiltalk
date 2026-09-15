import type { FacialExpressionDynamicsSnapshot } from "./facialExpressionDynamics";
import type { MouthExpressionSnapshot } from "./mouthExpression";

export const MOUTH_TELEMETRY_CHANNELS = [
  "jawOpen", "mouthClose", "mouthPucker", "mouthFunnel",
  "mouthStretchLeft", "mouthStretchRight",
  "mouthUpperUpLeft", "mouthUpperUpRight",
  "mouthLowerDownLeft", "mouthLowerDownRight",
] as const;

const VISEMES = ["aa", "ih", "ou", "ee", "oh"] as const;

export interface MouthPipelineStageValues {
  vowelSum: number;
  closure: number;
}

export interface MouthPipelineTelemetrySample {
  sampledAtMs: number;
  deltaTimeMs: number | null;
  raw: Readonly<Record<string, number>>;
  calibrated: Readonly<Record<string, number>>;
  speechActivity: Readonly<{
    visibleOpening: number;
    round: number;
    stretch: number;
    candidate: number;
  }>;
  corrective: Readonly<{
    disposition: FacialExpressionDynamicsSnapshot["mouthCorrective"]["disposition"];
    currentAmplitude: number;
    boostedAmplitude: number;
    preservedEnvelope: number;
    envelopeGain: number;
  }>;
  stages: Readonly<{
    f3Mapped: MouthPipelineStageValues;
    f4Desired: MouthPipelineStageValues;
    f4Dynamic: MouthPipelineStageValues;
    f4Final: MouthPipelineStageValues;
  }>;
}

export interface MouthPipelineTelemetryWindow {
  durationMs: number;
  sampleCount: number;
  sampleRateFps: number | null;
  activeSampleCount: number;
  peaks: Readonly<{
    rawJawOpen: number;
    calibratedJawOpen: number;
    visibleOpening: number;
    speechActivity: number;
    boostedAmplitude: number;
    preservedEnvelope: number;
    f3VowelSum: number;
    desiredVowelSum: number;
    dynamicVowelSum: number;
    finalVowelSum: number;
    finalClosure: number;
  }>;
}

export interface MouthPipelineTelemetrySnapshot {
  current: MouthPipelineTelemetrySample | null;
  window: MouthPipelineTelemetryWindow;
}

export interface MouthPipelineTelemetryInput {
  sampledAtMs: number;
  raw: Readonly<Record<string, number>>;
  calibrated: Readonly<Record<string, number>>;
  mouth: MouthExpressionSnapshot;
  dynamics: FacialExpressionDynamicsSnapshot;
}

interface TimedSample extends MouthPipelineTelemetrySample {}

const safe01 = (value: number | undefined): number => Number.isFinite(value) ? Math.min(1, Math.max(0, value!)) : 0;
const sumVisemes = (values: Readonly<Record<string, number>>): number =>
  VISEMES.reduce((total, name) => total + safe01(values[name]), 0);
const stage = (values: Readonly<Record<string, number>>): MouthPipelineStageValues => ({
  vowelSum: sumVisemes(values),
  closure: safe01(values.mouthClose),
});
const selectChannels = (values: Readonly<Record<string, number>>): Readonly<Record<string, number>> =>
  Object.freeze(Object.fromEntries(MOUTH_TELEMETRY_CHANNELS.map((name) => [name, safe01(values[name])])));

export class MouthPipelineTelemetry {
  private readonly samples: TimedSample[] = [];
  private readonly windowMs: number;

  constructor(windowMs = 1_000) {
    if (!Number.isFinite(windowMs) || windowMs <= 0) throw new RangeError("Mouth telemetry windowMs phải hữu hạn và > 0.");
    this.windowMs = windowMs;
  }

  record(input: MouthPipelineTelemetryInput): void {
    if (!Number.isFinite(input.sampledAtMs)) return;
    const previous = this.samples.at(-1);
    if (previous && input.sampledAtMs <= previous.sampledAtMs) return;
    const appliedActivity = input.dynamics.mouthCorrective.sampledAtMs === input.sampledAtMs
      ? input.dynamics.mouthCorrective.activity
      : { visibleOpening: input.mouth.geometry.visibleOpening, round: input.mouth.geometry.round, stretch: input.mouth.geometry.width, candidate: input.mouth.geometry.activity };
    const visibleOpening = safe01(appliedActivity.visibleOpening);
    const round = safe01(appliedActivity.round);
    const stretch = safe01(appliedActivity.stretch);
    const candidate = Math.max(visibleOpening, round, stretch);
    const sample: TimedSample = Object.freeze({
      sampledAtMs: input.sampledAtMs,
      deltaTimeMs: previous ? input.sampledAtMs - previous.sampledAtMs : null,
      raw: selectChannels(input.raw),
      calibrated: selectChannels(input.calibrated),
      speechActivity: Object.freeze({ visibleOpening, round, stretch, candidate }),
      corrective: Object.freeze({
        disposition: input.dynamics.mouthCorrective.disposition,
        currentAmplitude: input.dynamics.mouthCorrective.currentAmplitude,
        boostedAmplitude: input.dynamics.mouthCorrective.boostedAmplitude,
        preservedEnvelope: input.dynamics.mouthCorrective.preservedEnvelope,
        envelopeGain: input.dynamics.mouthCorrective.envelopeGain,
      }),
      stages: Object.freeze({
        f3Mapped: Object.freeze({ vowelSum: sumVisemes(input.mouth.visemes), closure: safe01(input.mouth.geometry.closure) }),
        f4Desired: Object.freeze(stage(input.dynamics.desired)),
        f4Dynamic: Object.freeze(stage(input.dynamics.dynamic)),
        f4Final: Object.freeze(stage(input.dynamics.final)),
      }),
    });
    this.samples.push(sample);
    const cutoff = input.sampledAtMs - this.windowMs;
    while (this.samples.length > 1 && this.samples[0].sampledAtMs < cutoff) this.samples.shift();
  }

  reset(): void { this.samples.length = 0; }

  snapshot(): MouthPipelineTelemetrySnapshot {
    const current = this.samples.at(-1) ?? null;
    const first = this.samples[0];
    const last = this.samples.at(-1);
    const durationMs = first && last ? Math.max(0, last.sampledAtMs - first.sampledAtMs) : 0;
    const sampleRateFps = this.samples.length > 1 && durationMs > 0
      ? (this.samples.length - 1) * 1_000 / durationMs
      : null;
    const max = (read: (sample: TimedSample) => number): number =>
      this.samples.reduce((peak, sample) => Math.max(peak, read(sample)), 0);
    return structuredClone({
      current,
      window: {
        durationMs,
        sampleCount: this.samples.length,
        sampleRateFps,
        activeSampleCount: this.samples.filter((sample) => sample.speechActivity.candidate > 0).length,
        peaks: {
          rawJawOpen: max((sample) => sample.raw.jawOpen),
          calibratedJawOpen: max((sample) => sample.calibrated.jawOpen),
          visibleOpening: max((sample) => sample.speechActivity.visibleOpening),
          speechActivity: max((sample) => sample.speechActivity.candidate),
          boostedAmplitude: max((sample) => sample.corrective.boostedAmplitude),
          preservedEnvelope: max((sample) => sample.corrective.preservedEnvelope),
          f3VowelSum: max((sample) => sample.stages.f3Mapped.vowelSum),
          desiredVowelSum: max((sample) => sample.stages.f4Desired.vowelSum),
          dynamicVowelSum: max((sample) => sample.stages.f4Dynamic.vowelSum),
          finalVowelSum: max((sample) => sample.stages.f4Final.vowelSum),
          finalClosure: max((sample) => sample.stages.f4Final.closure),
        },
      },
    });
  }
}
