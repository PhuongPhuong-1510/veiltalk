import { OneEuroScalarFilter } from "./oneEuroFilter";
import type { TorsoEulerDegrees } from "./torsoOrientation";

export interface TorsoTemporalResult { input: TorsoEulerDegrees; output: TorsoEulerDegrees; sampleAdvanced: boolean }

/** Stabilization tối thiểu kéo sớm vào 3E-04 để neutral và distribution có thể qua manual gate. */
export class TorsoTemporalProcessor {
  private readonly yaw = new OneEuroScalarFilter({ minCutoff: 1.5, beta: .06, derivativeCutoff: 1 });
  private readonly pitch = new OneEuroScalarFilter({ minCutoff: 1.35, beta: .04, derivativeCutoff: 1 });
  private readonly roll = new OneEuroScalarFilter({ minCutoff: 1.35, beta: .04, derivativeCutoff: 1 });
  private lastSampledAtMs: number | null = null;
  private lastOutput: TorsoEulerDegrees | null = null;

  process(input: TorsoEulerDegrees, sampledAtMs: number, enabled: boolean): TorsoTemporalResult {
    if (this.lastSampledAtMs !== null && sampledAtMs <= this.lastSampledAtMs && this.lastOutput) return { input, output: { ...this.lastOutput }, sampleAdvanced: false };
    const output = enabled ? {
      yaw: this.yaw.filter(input.yaw, sampledAtMs), pitch: this.pitch.filter(input.pitch, sampledAtMs), roll: this.roll.filter(input.roll, sampledAtMs),
    } : { ...input };
    if (!enabled) { this.yaw.reset(output.yaw, sampledAtMs); this.pitch.reset(output.pitch, sampledAtMs); this.roll.reset(output.roll, sampledAtMs); }
    this.lastSampledAtMs = sampledAtMs; this.lastOutput = output;
    return { input, output, sampleAdvanced: true };
  }

  reset(): void { this.yaw.reset(); this.pitch.reset(); this.roll.reset(); this.lastSampledAtMs = null; this.lastOutput = null; }
}
