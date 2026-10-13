import type { HandWorkerTiming } from "./handWorkerProtocol";
import type { HandInputDiagnostics } from "./handRoiPolicy";
import type { RawTrackingFrameV1 } from "./rawTrackingTypes";

export type HandInputMode = "full-frame" | "single" | "combined" | "split";
const modes: HandInputMode[] = ["full-frame", "single", "combined", "split"];
const distribution = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { count: values.length, average: values.reduce((a, b) => a + b, 0) / (values.length || 1),
    p95: sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] ?? 0 };
};
function push(values: number[], value: number | undefined) {
  if (value === undefined || !Number.isFinite(value) || value < 0) return;
  values.push(value); if (values.length > 600) values.shift();
}
function modeStats() { return { attempts: 0, accepted: 0, withAnyHand: 0, leftDetected: 0, rightDetected: 0,
  expectedLeft: 0, expectedRight: 0, coveredLeft: 0, coveredRight: 0,
  inference: [] as number[], preparation: [] as number[], mapping: [] as number[] }; }
function sideStats() { return { observed: 0, tracked: 0, losses: 0, reacquires: 0, lastTracked: null as boolean | null,
  lostAt: null as number | null, reacquireMs: [] as number[] }; }

/** Bounded diagnostics only; does not modify observations or motion state. */
export class TrackingObservationCollector {
  private byMode = Object.fromEntries(modes.map(mode => [mode, modeStats()])) as Record<HandInputMode, ReturnType<typeof modeStats>>;
  private hints: Record<string, number> = {};
  private reasons: Record<string, number> = {};
  private confidence = { normal: 0, sensitive: 0, switches: 0 };
  private previousConfidence: "normal" | "sensitive" | null = null;
  private sides = { left: sideStats(), right: sideStats() };
  private acceptedTicks: number[] = [];
  private acceptedCount = 0;
  private lastSampledAt: number | null = null;
  private skew: number[] = [];
  private busyCallbacks = 0;
  private duplicateCallbacks = 0;
  private workerErrors = 0;
  reset(): void {
    this.byMode = Object.fromEntries(modes.map(mode => [mode, modeStats()])) as typeof this.byMode;
    this.hints = {}; this.reasons = {}; this.confidence = { normal: 0, sensitive: 0, switches: 0 };
    this.previousConfidence = null; this.sides = { left: sideStats(), right: sideStats() };
    this.acceptedTicks = []; this.lastSampledAt = null; this.skew = [];
    this.acceptedCount = 0;
    this.busyCallbacks = 0; this.duplicateCallbacks = 0; this.workerErrors = 0;
  }
  callbackDrop(reason: "busy" | "duplicate"): void { if (reason === "busy") this.busyCallbacks++; else this.duplicateCallbacks++; }
  workerError(): void { this.workerErrors++; }
  execution(mode: HandInputMode, confidence: "normal" | "sensitive", accepted: boolean,
    result: { landmarks: unknown[]; handedness: Array<Array<{ categoryName: string }>> },
    timing?: HandWorkerTiming, diagnostic?: HandInputDiagnostics): void {
    const bucket = this.byMode[mode]; bucket.attempts++; if (accepted) bucket.accepted++;
    if (result.landmarks.length) bucket.withAnyHand++;
    if (result.handedness.some(label => label[0]?.categoryName.toLowerCase() === "left")) bucket.leftDetected++;
    if (result.handedness.some(label => label[0]?.categoryName.toLowerCase() === "right")) bucket.rightDetected++;
    push(bucket.inference, timing?.inferenceMs); push(bucket.preparation, timing?.roiPreparationMs); push(bucket.mapping, timing?.mappingMs);
    this.confidence[confidence]++;
    if (this.previousConfidence !== null && this.previousConfidence !== confidence) this.confidence.switches++;
    this.previousConfidence = confidence;
    if (diagnostic) {
      this.hints[diagnostic.hintStatus] = (this.hints[diagnostic.hintStatus] ?? 0) + 1;
      this.reasons[diagnostic.roiReason] = (this.reasons[diagnostic.roiReason] ?? 0) + 1;
      for (const side of ["left", "right"] as const) {
        if (diagnostic.expectedSides.includes(side)) {
          if (side === "left") { bucket.expectedLeft++; if (diagnostic.coveredSides.includes(side)) bucket.coveredLeft++; }
          else { bucket.expectedRight++; if (diagnostic.coveredSides.includes(side)) bucket.coveredRight++; }
        }
      }
    }
  }
  accepted(frame: RawTrackingFrameV1, now: number): void {
    const sampledAt = frame.handSampledAtMs;
    if (!frame.handSampledThisFrame || sampledAt === null || !Number.isFinite(sampledAt)
      || (this.lastSampledAt !== null && sampledAt <= this.lastSampledAt)) return;
    this.lastSampledAt = sampledAt;
    ++this.acceptedCount;
    this.acceptedTicks.push(now); this.trim(now);
    if (frame.pose.sampledAtMs !== null) push(this.skew, Math.abs(sampledAt - frame.pose.sampledAtMs));
    for (const side of ["left", "right"] as const) {
      const sample = side === "left" ? frame.leftHand : frame.rightHand;
      if (sample.state === "not-sampled") continue;
      const stats = this.sides[side], tracked = sample.state === "tracked";
      stats.observed++; if (tracked) stats.tracked++;
      if (!tracked && stats.lastTracked === true) { stats.losses++; stats.lostAt = sampledAt; }
      if (tracked && stats.lostAt !== null) { stats.reacquires++; push(stats.reacquireMs, sampledAt - stats.lostAt); stats.lostAt = null; }
      stats.lastTracked = tracked;
    }
  }
  private trim(now: number): void { while (this.acceptedTicks.length && this.acceptedTicks[0] < now - 10_000) this.acceptedTicks.shift(); }
  snapshot(now: number) {
    this.trim(now);
    const ticks = this.acceptedTicks;
    return {
      acceptedHandFps: ticks.length < 2 ? 0 : (ticks.length - 1) * 1000 / Math.max(1, now - ticks[0]),
      acceptedHandSamples: this.acceptedCount,
      handPoseSkewMs: distribution(this.skew), busyCallbacks: this.busyCallbacks, duplicateCallbacks: this.duplicateCallbacks, workerErrors: this.workerErrors,
      byInputMode: Object.fromEntries(modes.map(mode => {
        const b = this.byMode[mode];
        const { inference, preparation, mapping, ...counts } = b;
        return [mode, { ...counts, inferenceMs: distribution(inference), preparationMs: distribution(preparation), mappingMs: distribution(mapping) }];
      })),
      hintStatus: { ...this.hints }, roiReason: { ...this.reasons }, confidence: { ...this.confidence },
      // Detector labels, not downstream temporal identity or manually labelled recall.
      detectorLabelCoverage: Object.fromEntries((["left", "right"] as const).map(side => {
        const s = this.sides[side]; return [side, { observed: s.observed, tracked: s.tracked, ratio: s.observed ? s.tracked / s.observed : null,
          lossEvents: s.losses, reacquireEvents: s.reacquires, reacquireMs: distribution(s.reacquireMs) }];
      })),
    };
  }
}
export type TrackingObservationSnapshot = ReturnType<TrackingObservationCollector["snapshot"]>;
