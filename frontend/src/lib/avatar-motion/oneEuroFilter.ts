import type { OneEuroParameters } from "./motionConfig";
import type { Vector3Data } from "./avatarPoseTypes";

const alpha = (cutoff: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export class OneEuroScalarFilter {
  private value: number | null = null;
  private derivative = 0;
  private timestampMs: number | null = null;

  private readonly parameters: OneEuroParameters;
  private readonly maxGapMs: number;
  constructor(parameters: OneEuroParameters, maxGapMs = 1_000) { this.parameters = parameters; this.maxGapMs = maxGapMs; }

  filter(next: number, timestampMs: number): number {
    if (!Number.isFinite(next) || !Number.isFinite(timestampMs)) return this.value ?? 0;
    if (this.timestampMs === null || timestampMs <= this.timestampMs || timestampMs - this.timestampMs > this.maxGapMs) {
      this.reset(next, timestampMs);
      return next;
    }
    const dt = (timestampMs - this.timestampMs) / 1_000;
    const previous = this.value!;
    const rawDerivative = (next - previous) / dt;
    const derivativeAlpha = alpha(this.parameters.derivativeCutoff, dt);
    this.derivative += derivativeAlpha * (rawDerivative - this.derivative);
    const cutoff = this.parameters.minCutoff + this.parameters.beta * Math.abs(this.derivative);
    this.value = previous + alpha(cutoff, dt) * (next - previous);
    this.timestampMs = timestampMs;
    return this.value;
  }

  reset(value?: number, timestampMs?: number): void {
    this.value = value ?? null;
    this.timestampMs = timestampMs ?? null;
    this.derivative = 0;
  }
}

export class OneEuroVectorFilter {
  private readonly x: OneEuroScalarFilter;
  private readonly y: OneEuroScalarFilter;
  private readonly z: OneEuroScalarFilter;
  constructor(parameters: OneEuroParameters, maxGapMs = 1_000) {
    this.x = new OneEuroScalarFilter(parameters, maxGapMs);
    this.y = new OneEuroScalarFilter(parameters, maxGapMs);
    this.z = new OneEuroScalarFilter(parameters, maxGapMs);
  }
  filter(value: Vector3Data, timestampMs: number): Vector3Data {
    return { x: this.x.filter(value.x, timestampMs), y: this.y.filter(value.y, timestampMs), z: this.z.filter(value.z, timestampMs) };
  }
  reset(): void { this.x.reset(); this.y.reset(); this.z.reset(); }
}
