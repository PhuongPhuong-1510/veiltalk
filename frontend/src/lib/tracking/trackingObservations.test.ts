import { describe, expect, it } from "vitest";
import type { HandLandmarkerResult } from "@mediapipe/tasks-vision";
import { TrackingMetricsCollector } from "./trackingMetrics";
import { TrackingObservationCollector } from "./trackingObservations";
import { mapRawTrackingFrame } from "./rawTrackingMapper";
const empty: HandLandmarkerResult = { landmarks: [], worldLandmarks: [], handedness: [], handednesses: [] };
const hand: HandLandmarkerResult = { ...empty, landmarks: [[{ x: .3, y: .5, z: 0, visibility: 1 }]],
  handedness: [[{ categoryName: "Left", displayName: "Left", score: .9, index: 0 }]] };
const frame = (at: number, tracked: boolean) => mapRawTrackingFrame(at / 10, { hands: tracked ? hand : empty, sampledAtMs: { face: at, hands: at, pose: at } });
describe("observation measurements", () => {
  it("counts accepted observations rather than dropped inference results", () => {
    const metrics = new TrackingMetricsCollector();
    metrics.recordInference("hands", 100, 10); metrics.recordInference("hands", 200, 10);
    const accepted = frame(100, true);
    metrics.recordPipeline(110, 10, accepted);
    metrics.recordPipeline(210, 10, mapRawTrackingFrame(20, {}, accepted));
    const snapshot = metrics.snapshot(210, "GPU");
    expect(snapshot.handSampleFps).toBeGreaterThan(0);
    expect(snapshot.observations?.acceptedHandSamples).toBe(1);
    expect(snapshot.observations?.acceptedHandFps).toBe(0);
  });
  it("ignores duplicate/unsampled observations and measures true loss-to-reacquire intervals", () => {
    const metrics = new TrackingObservationCollector();
    metrics.accepted(frame(100, true), 110);
    const lost = frame(200, false); metrics.accepted(lost, 210);
    metrics.accepted(mapRawTrackingFrame(30, {}, lost), 310);
    metrics.accepted(frame(200, true), 320); // Must not create fake reacquisition.
    metrics.accepted(frame(400, false), 410);
    metrics.accepted(frame(500, true), 510);
    const report = metrics.snapshot(510);
    expect(report.acceptedHandSamples).toBe(4);
    expect(report.detectorLabelCoverage.left).toMatchObject({ lossEvents: 1, reacquireEvents: 1, reacquireMs: { count: 1, average: 300 } });
    expect(report.detectorLabelCoverage.right.lossEvents).toBe(0); // Initial absence is not a tracking loss.
  });
  it("separates ROI modes, confidence switches, and geometry coverage from label coverage", () => {
    const metrics = new TrackingObservationCollector();
    const timing = { roiPreparationMs: 2, inferenceMs: 10, mappingMs: 1, workerTotalMs: 13 };
    metrics.execution("split", "normal", true, hand, timing, { hintStatus: "fresh-tracked", roiReason: "roi", expectedSides: ["left", "right"], coveredSides: ["right"] });
    metrics.execution("full-frame", "sensitive", false, hand, { ...timing, inferenceMs: 30 });
    const report = metrics.snapshot(100);
    expect(report.byInputMode.split).toMatchObject({ attempts: 1, accepted: 1, leftDetected: 1, expectedRight: 1, coveredRight: 1, inferenceMs: { average: 10 } });
    expect(report.byInputMode["full-frame"]).toMatchObject({ accepted: 0, inferenceMs: { average: 30 } });
    expect(report.confidence).toEqual({ normal: 1, sensitive: 1, switches: 1 });
  });
  it("resets measurement data while retaining no warm-up distribution or loss history", () => {
    const metrics = new TrackingMetricsCollector(); metrics.recordCameraFrame(100);
    metrics.recordTiming("handsInferenceMs", 999); metrics.observations.accepted(frame(100, true), 110);
    metrics.observations.workerError(); metrics.beginMeasurement(1000);
    const snapshot = metrics.snapshot(1100, "GPU");
    expect(snapshot.measurement).toEqual({ id: 1, startedAtMs: 1000, durationMs: 100 });
    expect(snapshot.timings?.handsInferenceMs.count).toBe(0);
    expect(snapshot.observations).toMatchObject({ acceptedHandSamples: 0, workerErrors: 0 });
    metrics.beginMeasurement(2000); expect(metrics.snapshot(2100, "GPU").measurement?.id).toBe(2);
  });
  it("bounds per-mode timing storage and expires accepted FPS without clearing measurement counts", () => {
    const metrics = new TrackingObservationCollector();
    for (let i = 1; i <= 700; i++) {
      metrics.execution("full-frame", "normal", true, empty, { inferenceMs: i, roiPreparationMs: 0, mappingMs: 0, workerTotalMs: i });
      metrics.accepted(frame(i * 10, false), i * 10);
    }
    const snapshot = metrics.snapshot(20_000);
    expect(snapshot.byInputMode["full-frame"].inferenceMs).toMatchObject({ count: 600, average: 400.5 });
    expect(snapshot.acceptedHandFps).toBe(0); expect(snapshot.acceptedHandSamples).toBe(700);
  });
});
