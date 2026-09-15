import { describe, expect, it } from "vitest";
import { GazeMetricsCollector } from "./gazeMetrics";
import type { GazeDiagnostics } from "./gazeSolver";

const diagnostic = (overrides: Partial<GazeDiagnostics> = {}): GazeDiagnostics => ({
  outputState: "active", quality: 1, rejectReason: null, rawLeft: null, rawRight: null,
  fused: { yaw: .1, pitch: 0 }, head: null, finalSemantic: { yaw: .1, pitch: 0 },
  sampleDisposition: "fresh", clampApplied: false, mode: "faithful",
  cinematic: { yaw: .1, pitch: 0, proceduralBlink: 0, blend: 0, attentionBias: { yaw: 0, pitch: 0 }, saccade: { yaw: 0, pitch: 0 } },
  ...overrides,
});

describe("GazeMetricsCollector", () => {
  it("counts only objective scalar events and computes clamp ratio", () => {
    const metrics = new GazeMetricsCollector();
    metrics.record(diagnostic({ clampApplied: true }), 0);
    metrics.record(diagnostic({ sampleDisposition: "duplicate" }), 10);
    metrics.record(diagnostic({ rejectReason: "nonfinite-eye-look" }), 20);
    expect(metrics.snapshot(40)).toMatchObject({ freshSampleCount: 2, invalidSampleCount: 1, duplicateSampleCount: 1, clampHitCount: 1, clampHitRatio: .5, longestClampDurationMs: 20 });
  });

  it("records reacquire peak and settle time after three stable samples", () => {
    const metrics = new GazeMetricsCollector();
    metrics.record(diagnostic({ sampleDisposition: "loss", outputState: "returning", finalSemantic: { yaw: 0, pitch: 0 } }), 100);
    metrics.record(diagnostic({ finalSemantic: { yaw: .3, pitch: 0 } }), 200);
    for (const at of [230, 260, 290]) metrics.record(diagnostic({ fused: { yaw: .3, pitch: 0 }, finalSemantic: { yaw: .3, pitch: 0 } }), at);
    expect(metrics.snapshot()).toMatchObject({ reacquireCount: 1, semanticReacquirePeakDelta: .3, semanticReacquireSettleTimeMs: 90 });
  });
});
