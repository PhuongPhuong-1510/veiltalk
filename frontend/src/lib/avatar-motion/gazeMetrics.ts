import type { GazeDiagnostics } from "./gazeSolver";

export interface GazeMetricsSnapshot {
  freshSampleCount: number;
  invalidSampleCount: number;
  duplicateSampleCount: number;
  reversedSampleCount: number;
  lossTickCount: number;
  clampHitCount: number;
  clampHitRatio: number;
  longestClampDurationMs: number;
  semanticGazeJitterP95: number | null;
  semanticReacquirePeakDelta: number | null;
  semanticReacquireSettleTimeMs: number | null;
  reacquireCount: number;
}

const percentile95 = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(.95 * sorted.length) - 1] ?? null;
};

/** Collector local-only. Chỉ giữ scalar tổng hợp; không giữ coefficient, landmark hay ảnh. */
export class GazeMetricsCollector {
  private freshSampleCount = 0;
  private invalidSampleCount = 0;
  private duplicateSampleCount = 0;
  private reversedSampleCount = 0;
  private lossTickCount = 0;
  private clampHitCount = 0;
  private clampStartedAtMs: number | null = null;
  private longestClampDurationMs = 0;
  private readonly jitterSamples: number[] = [];
  private previousFresh: { yaw: number; pitch: number; fusedYaw: number; fusedPitch: number } | null = null;
  private lastOutputBeforeLoss: { yaw: number; pitch: number } | null = null;
  private lossSeen = false;
  private reacquireCount = 0;
  private semanticReacquirePeakDelta: number | null = null;
  private semanticReacquireSettleTimeMs: number | null = null;
  private settling: { startedAtMs: number; previous: { yaw: number; pitch: number }; stableSamples: number } | null = null;

  record(diagnostic: GazeDiagnostics, atMs: number): void {
    if (diagnostic.sampleDisposition === "duplicate") { this.duplicateSampleCount += 1; return; }
    if (diagnostic.sampleDisposition === "reversed") { this.reversedSampleCount += 1; return; }
    if (diagnostic.sampleDisposition === "loss") {
      this.lossTickCount += 1;
      if (!this.lossSeen) this.lastOutputBeforeLoss = { ...diagnostic.finalSemantic };
      this.lossSeen = true;
      this.updateClamp(false, atMs);
      return;
    }

    this.freshSampleCount += 1;
    if (diagnostic.rejectReason) {
      this.invalidSampleCount += 1;
      this.lossSeen = true;
      this.updateClamp(false, atMs);
      return;
    }
    this.updateClamp(diagnostic.clampApplied, atMs);
    const current = diagnostic.finalSemantic;
    if (this.previousFresh) {
      const fusedStep = Math.hypot(diagnostic.fused.yaw - this.previousFresh.fusedYaw, diagnostic.fused.pitch - this.previousFresh.fusedPitch);
      if (fusedStep <= .04) {
        this.jitterSamples.push(Math.hypot(current.yaw - this.previousFresh.yaw, current.pitch - this.previousFresh.pitch));
        if (this.jitterSamples.length > 600) this.jitterSamples.shift();
      }
    }
    if (this.lossSeen) {
      const prior = this.lastOutputBeforeLoss ?? { yaw: 0, pitch: 0 };
      const delta = Math.hypot(current.yaw - prior.yaw, current.pitch - prior.pitch);
      this.semanticReacquirePeakDelta = Math.max(this.semanticReacquirePeakDelta ?? 0, delta);
      this.reacquireCount += 1;
      this.settling = { startedAtMs: atMs, previous: { ...current }, stableSamples: 0 };
      this.lossSeen = false;
    } else if (this.settling) {
      const delta = Math.hypot(current.yaw - this.settling.previous.yaw, current.pitch - this.settling.previous.pitch);
      this.settling.stableSamples = delta <= .025 ? this.settling.stableSamples + 1 : 0;
      this.settling.previous = { ...current };
      if (this.settling.stableSamples >= 3) {
        this.semanticReacquireSettleTimeMs = atMs - this.settling.startedAtMs;
        this.settling = null;
      }
    }
    this.previousFresh = { yaw: current.yaw, pitch: current.pitch, fusedYaw: diagnostic.fused.yaw, fusedPitch: diagnostic.fused.pitch };
  }

  snapshot(nowMs?: number): GazeMetricsSnapshot {
    const activeClampMs = this.clampStartedAtMs !== null && nowMs !== undefined ? Math.max(0, nowMs - this.clampStartedAtMs) : 0;
    return {
      freshSampleCount: this.freshSampleCount,
      invalidSampleCount: this.invalidSampleCount,
      duplicateSampleCount: this.duplicateSampleCount,
      reversedSampleCount: this.reversedSampleCount,
      lossTickCount: this.lossTickCount,
      clampHitCount: this.clampHitCount,
      clampHitRatio: this.freshSampleCount === 0 ? 0 : this.clampHitCount / this.freshSampleCount,
      longestClampDurationMs: Math.max(this.longestClampDurationMs, activeClampMs),
      semanticGazeJitterP95: percentile95(this.jitterSamples),
      semanticReacquirePeakDelta: this.semanticReacquirePeakDelta,
      semanticReacquireSettleTimeMs: this.semanticReacquireSettleTimeMs,
      reacquireCount: this.reacquireCount,
    };
  }

  reset(): void {
    this.freshSampleCount = 0; this.invalidSampleCount = 0; this.duplicateSampleCount = 0; this.reversedSampleCount = 0; this.lossTickCount = 0;
    this.clampHitCount = 0; this.clampStartedAtMs = null; this.longestClampDurationMs = 0; this.jitterSamples.length = 0; this.previousFresh = null;
    this.lastOutputBeforeLoss = null; this.lossSeen = false; this.reacquireCount = 0; this.semanticReacquirePeakDelta = null; this.semanticReacquireSettleTimeMs = null; this.settling = null;
  }

  private updateClamp(clamped: boolean, atMs: number): void {
    if (clamped) {
      this.clampHitCount += 1;
      this.clampStartedAtMs ??= atMs;
      return;
    }
    if (this.clampStartedAtMs !== null) this.longestClampDurationMs = Math.max(this.longestClampDurationMs, Math.max(0, atMs - this.clampStartedAtMs));
    this.clampStartedAtMs = null;
  }
}
