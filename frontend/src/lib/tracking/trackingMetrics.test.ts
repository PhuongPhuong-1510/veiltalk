import { describe, expect, it, vi } from "vitest";
import { TrackingMetricsCollector } from "./trackingMetrics";
import type { RawTrackingFrameV1 } from "./rawTrackingTypes";

const frame = {
  version: 1, frameTimestampMs: 100, overall: "partial",
  face: { state: "tracked", sampledAtMs: 100, landmarks: [], blendshapes: {}, facialTransform: null },
  leftHand: { state: "not-sampled", sampledAtMs: 80, handedness: "left", handednessScore: 1, landmarks: [], worldLandmarks: [] },
  rightHand: { state: "lost", sampledAtMs: 100, handedness: "right", handednessScore: null, landmarks: null, worldLandmarks: null },
  rawHands: [], handSampledThisFrame: false, handSampledAtMs: 80,
  pose: { state: "not-sampled", sampledAtMs: 70, landmarks: [], worldLandmarks: [] },
  videoWidth: 1280, videoHeight: 720,
} as RawTrackingFrameV1;

describe("TrackingMetricsCollector", () => {
  it("resets benchmark measurements, retains >600 timing samples and aggregates hint/ROI observations by mode", () => {
    const m = new TrackingMetricsCollector();
    m.recordCameraFrame(0); m.recordInference("face", 0, 100);
    m.beginMeasurement(3, 1000);
    for (let i = 0; i < 1800; i++) m.recordTiming("faceInferenceMs", i);
    m.recordHandHint(null); m.recordHandHint(120); m.recordHandHint(120.01); m.recordHandHint(-1);
    const tracked = { ...frame, leftHand: { ...frame.leftHand, state: "tracked" as const } };
    m.recordHandInput("single", 10, tracked, "roi");
    m.recordHandInput("full-frame", 30, frame, "stale-hint");
    const s = m.snapshot(61_000, "GPU");
    expect(s.measurementId).toBe(3); expect(s.runDurationMs).toBe(60_000);
    expect(s.measurementCounts?.face).toBe(0);
    expect(s.timings?.faceInferenceMs.count).toBe(1800);
    expect(s.timings?.faceInferenceMs.average).toBe(899.5);
    expect(s.handDiagnostics?.hintCounts).toEqual({ absent: 1, fresh: 1, stale: 1, invalidAge: 1 });
    expect(s.handDiagnostics?.roiUsageRatio).toBe(.5);
    expect(s.handDiagnostics?.modes.single?.leftTracked).toBe(1);
    expect(s.handDiagnostics?.modes["full-frame"]?.neitherTracked).toBe(1);
    expect(s.handDiagnostics?.modes.single?.inferenceMs.average).toBe(10);
    expect(s.longTaskScope).toBe("cumulative-measurement");
    m.reset(); expect(m.snapshot(62_000, "GPU").timingSamplesMax).toBe(600);
  });
  it("distinguishes received callbacks, presented video frames, accepted frames and avatar applies", () => {
    const metrics = new TrackingMetricsCollector();
    for (let index = 0; index <= 10; index++) metrics.recordVideoCallback(index * 100, index * 3);
    for (let index = 0; index <= 5; index++) {
      metrics.recordCameraFrame(index * 200);
      metrics.recordAvatarTiming({ motionProcessMs: 6, avatarApplyMs: 0, avatarAppliedAtMs: index * 200 }, index * 200);
    }
    const s = metrics.snapshot(1000, "GPU");
    expect(s.videoCallbackFps).toBe(10);
    expect(s.videoPresentedFps).toBe(30);
    expect(s.pipelineFrameFps).toBe(5);
    expect(s.avatarApplyFps).toBe(5);
    expect(s.timings?.videoCallbackIntervalMs.p50).toBe(100);
    expect(s.timings?.avatarApplyMs.count).toBe(6); // A measured zero is different from no sample.
    expect(s.timings?.captureVideoBitmapMs.count).toBe(0);
    expect(s.longTaskScope).toBe("cumulative-session");
    metrics.reset();
    expect(metrics.snapshot(1000, "GPU").videoPresentedFps).toBeNull();
    expect(metrics.snapshot(1000, "GPU").avatarApplyFps).toBe(0);
  });

  it("keeps only the newest 600 timing samples and reports avg/p50/p95 without NaN pollution", () => {
    const metrics = new TrackingMetricsCollector();
    for (let value = 1; value <= 650; value++) metrics.recordTiming("onFrameMs", value);
    metrics.recordTiming("onFrameMs", NaN);
    metrics.recordTiming("onFrameMs", -1);
    expect(metrics.snapshot(1000, "GPU").timings?.onFrameMs).toEqual({ count: 600, average: 350.5, p50: 350, p95: 620, max: 650 });
    metrics.reset();
    expect(metrics.snapshot(1000, "GPU").timings?.onFrameMs.count).toBe(0);
  });
  it("does not count asynchronous worker waiting as main-thread blocking", () => {
    vi.stubGlobal("PerformanceObserver", undefined);
    try {
      const metrics = new TrackingMetricsCollector();
      metrics.recordPipeline(200, 100, frame, 20);
      metrics.recordWorkerFrame(3, 80);
      const result = metrics.snapshot(200, "GPU");
      expect(result.inferenceTimeMs.pipeline.average).toBe(100);
      expect(result.mainThreadBlockedMs).toBe(0);
      expect(result.mainThreadLongTasks).toBe(0);
      expect(result.framePreparationMs?.p95).toBe(3);
      expect(result.handWorkerRoundTripMs?.p95).toBe(80);
    } finally { vi.unstubAllGlobals(); }
  });
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

  it("reports the pose model variant so lite and full can be compared in one snapshot", () => {
    const metrics = new TrackingMetricsCollector();
    expect(metrics.snapshot(100, "GPU").poseModel).toBeNull();
    expect(metrics.snapshot(100, "GPU", "full").poseModel).toBe("full");
    expect(metrics.snapshot(100, "CPU", "lite").poseModel).toBe("lite");
  });

  it("uses elapsed time instead of a full 10-second denominator during warm-up", () => {
    vi.stubGlobal("PerformanceObserver", undefined);
    const metrics = new TrackingMetricsCollector();
    for (let index = 0; index <= 150; index += 1) metrics.recordCameraFrame(index * (5_000 / 150));
    expect(metrics.snapshot(5_000, "GPU").cameraFps).toBeCloseTo(30, 1);
    vi.unstubAllGlobals();
  });
});
