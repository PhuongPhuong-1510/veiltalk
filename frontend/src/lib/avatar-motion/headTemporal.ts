import type { HeadEulerDegrees } from "./headOrientation";
import { OneEuroScalarFilter } from "./oneEuroFilter";
import type { OneEuroParameters } from "./motionConfig";

export interface HeadSemanticConstraints { yaw: number; pitchUp: number; pitchDown: number; roll: number }
export interface HeadTemporalConfig { constraints: HeadSemanticConstraints; filter: OneEuroParameters; maxTimestampGapMs: number }
export interface HeadTemporalResult { input: HeadEulerDegrees; constrained: HeadEulerDegrees; output: HeadEulerDegrees; constrainedAxes: Array<keyof HeadEulerDegrees>; sampleAdvanced: boolean }

export const DEFAULT_HEAD_TEMPORAL_CONFIG: HeadTemporalConfig = {
  constraints: { yaw: 70, pitchUp: 35, pitchDown: 45, roll: 36 },
  filter: { minCutoff: 1.8, beta: .008, derivativeCutoff: 1 },
  maxTimestampGapMs: 1_000,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));
export class HeadTemporalProcessor {
  private readonly yaw: OneEuroScalarFilter; private readonly pitch: OneEuroScalarFilter; private readonly roll: OneEuroScalarFilter;
  private readonly config: HeadTemporalConfig;
  private lastSampledAtMs: number | null = null; private lastOutput: HeadEulerDegrees | null = null;
  constructor(config: HeadTemporalConfig = DEFAULT_HEAD_TEMPORAL_CONFIG) {
    this.config = config;
    this.yaw = new OneEuroScalarFilter(config.filter, config.maxTimestampGapMs); this.pitch = new OneEuroScalarFilter(config.filter, config.maxTimestampGapMs); this.roll = new OneEuroScalarFilter(config.filter, config.maxTimestampGapMs);
  }
  process(input: HeadEulerDegrees, sampledAtMs: number, constraintsEnabled: boolean, filterEnabled: boolean): HeadTemporalResult {
    if (this.lastSampledAtMs !== null && sampledAtMs <= this.lastSampledAtMs && this.lastOutput) return { input, constrained: this.constrain(input, constraintsEnabled), output: { ...this.lastOutput }, constrainedAxes: [], sampleAdvanced: false };
    const constrained = this.constrain(input, constraintsEnabled); const constrainedAxes = (["yaw", "pitch", "roll"] as const).filter((axis) => Math.abs(constrained[axis] - input[axis]) > 1e-7);
    const output = filterEnabled ? { yaw: this.yaw.filter(constrained.yaw, sampledAtMs), pitch: this.pitch.filter(constrained.pitch, sampledAtMs), roll: this.roll.filter(constrained.roll, sampledAtMs) } : constrained;
    if (!filterEnabled) { this.yaw.reset(output.yaw, sampledAtMs); this.pitch.reset(output.pitch, sampledAtMs); this.roll.reset(output.roll, sampledAtMs); }
    this.lastSampledAtMs = sampledAtMs; this.lastOutput = output; return { input, constrained, output, constrainedAxes, sampleAdvanced: true };
  }
  reset(): void { this.yaw.reset(); this.pitch.reset(); this.roll.reset(); this.lastSampledAtMs = null; this.lastOutput = null; }
  private constrain(input: HeadEulerDegrees, enabled: boolean): HeadEulerDegrees {
    if (!enabled) return { ...input };
    return { yaw: clamp(input.yaw, -this.config.constraints.yaw, this.config.constraints.yaw), pitch: clamp(input.pitch, -this.config.constraints.pitchDown, this.config.constraints.pitchUp), roll: clamp(input.roll, -this.config.constraints.roll, this.config.constraints.roll) };
  }
}
