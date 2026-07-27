import { describe, expect, it, vi } from "vitest";
import { TrackingMetricsCollector } from "./trackingMetrics";
import type { RawTrackingFrameV1 } from "./rawTrackingTypes";

const frame = {
  version: 1, frameTimestampMs: 100, overall: "partial",
  face: { state: "tracked", sampledAtMs: 100, landmarks: [], blendshapes: {}, facialTransform: null },
  leftHand: { state: "not-sampled", sampledAtMs: 80, handedness: "left", handednessScore: 1, landmarks: [], worldLandmarks: [] },
  rightHand: { state: "lost", sampledAtMs: 100, handedness: "right", handednessScore: null, landmarks: null, worldLandmarks: null },
  pose: { state: "not-sampled", sampledAtMs: 70, landmarks: [], worldLandmarks: [] },
} as RawTrackingFrameV1;

describe("TrackingMetricsCollector", () => {
  it("reports per-model inference FPS, sample ages and configured selection", () => {
    vi.stubGlobal("PerformanceObserver", undefined);
    const metrics = new TrackingMetricsCollector();
    metrics.recordCameraFrame(100);
    metrics.recordInference("face", 100, 8);
    metrics.recordInference("hands", 100, 12);
    metrics.recordInference("pose", 100, 15);
    metrics.recordPipeline(100, 55, frame);
    const snapshot = metrics.snapshot(100, "GPU");
    expect(snapshot.inferenceFps).toEqual({ face: 0, hands: 0, pose: 0 });
    expect(snapshot.sampleAgeMs.leftHand.average).toBe(20);
    expect(snapshot.sampleAgeMs.pose.max).toBe(30);
    expect(snapshot.mainThreadLongTasks).toBe(1);
    expect(snapshot.mainThreadBlockedMs).toBe(55);
    expect(snapshot.selectedDelegate).toBe("GPU");
    expect(snapshot.stateRatio.face.tracked).toBe(1);
    expect(snapshot.stateRatio.leftHand["not-sampled"]).toBe(1);
    expect(snapshot.lossEvents.rightHand).toBe(1);
    metrics.reset();
    expect(metrics.snapshot(100, "GPU").lossEvents.rightHand).toBe(0);
    vi.unstubAllGlobals();
  });

  it("uses elapsed time instead of a full 10-second denominator during warm-up", () => {
    vi.stubGlobal("PerformanceObserver", undefined);
    const metrics = new TrackingMetricsCollector();
    for (let index = 0; index <= 150; index += 1) metrics.recordCameraFrame(index * (5_000 / 150));
    expect(metrics.snapshot(5_000, "GPU").cameraFps).toBeCloseTo(30, 1);
    vi.unstubAllGlobals();
  });
});
