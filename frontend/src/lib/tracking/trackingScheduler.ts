import type { RawPoseSampleV1 } from "./rawTrackingTypes";

/** Experimental controls are opt-in; production callers omit this object. */
export interface TrackingExperiments {
  callbackAhead?: boolean;
  boundedPose?: boolean;
  cachedPoseHint?: boolean;
  handRoiRecovery?: boolean;
}
export function resolveTrackingExperiments(options?: TrackingExperiments) {
  return { version: 1 as const, callbackAhead: options?.callbackAhead === true,
    boundedPose: options?.boundedPose === true, cachedPoseHint: options?.cachedPoseHint === true,
    handRoiRecovery: options?.handRoiRecovery === true };
}

/** At most one skipped processed frame, and only with a recent successful Pose.
 * The completion estimate is conservative but not a deadline guarantee: this policy
 * remains experimental until real movement validates freshness and continuity.
 */
export class BoundedPoseScheduler {
  private skipped = false;
  private completionEstimateMs = 75;
  reset(): void { this.skipped = false; this.completionEstimateMs = 75; }
  observeCompletion(durationMs: number): void {
    if (Number.isFinite(durationMs) && durationMs >= 0) {
      this.completionEstimateMs = Math.max(60, durationMs, this.completionEstimateMs * .95);
    }
  }
  shouldSample(nowMs: number, previous?: RawPoseSampleV1, elapsedMs = 0): boolean {
    const age = previous?.sampledAtMs == null ? Infinity : nowMs - previous.sampledAtMs;
    const sample = this.skipped || previous?.state !== "tracked" || !Number.isFinite(age) || age < 0
      || age >= 100 || age + Math.max(this.completionEstimateMs, elapsedMs) > 120;
    this.skipped = !sample;
    return sample;
  }
}
