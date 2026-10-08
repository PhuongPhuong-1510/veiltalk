import { afterEach, describe, expect, it, vi } from "vitest";
import { TrackingPipeline, type TrackingPipelineDependencies } from "./trackingPipeline";
import { TrackingMetricsCollector } from "./trackingMetrics";
import * as mapper from "./rawTrackingMapper";
import type { HandWorkerSample } from "./handWorkerProtocol";

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
afterEach(() => vi.restoreAllMocks());

function setup(parallelHands = false) {
  let clock = 100, callback: VideoFrameRequestCallback | undefined;
  const video = { videoWidth: 1280, videoHeight: 720, currentTime: 0,
    requestVideoFrameCallback: vi.fn((cb: VideoFrameRequestCallback) => { callback = cb; return 1; }),
    cancelVideoFrameCallback: vi.fn() } as unknown as HTMLVideoElement;
  const empty = { landmarks: [], worldLandmarks: [], handedness: [], handednesses: [] };
  const tasks = {
    face: { detectForVideo: vi.fn(() => { clock += 7; return { faceLandmarks: [], faceBlendshapes: [], facialTransformationMatrixes: [] }; }) },
    hands: { detectForVideo: vi.fn(() => { clock += 11; return empty; }) },
    pose: { detectForVideo: vi.fn(() => { clock += 13; return empty; }) },
  };
  const runtime = { tasks, initialize: vi.fn().mockResolvedValue(undefined), releaseHands: vi.fn(), dispose: vi.fn(),
    selectedDelegate: "GPU", selectedPoseModel: "full" };
  const metrics = new TrackingMetricsCollector();
  const camera = { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn(), settings: { frameRate: 30 } };
  const onFrame = vi.fn(() => { clock += 10; return { motionProcessMs: 6, avatarApplyMs: 1, avatarAppliedAtMs: clock - 1 }; });
  const onMetrics = vi.fn(() => { clock += 3; });
  let resolveHand!: (sample: HandWorkerSample) => void;
  const worker = { initialize: vi.fn().mockResolvedValue(undefined), dispose: vi.fn(), selectedDelegate: "GPU",
    detect: vi.fn(() => new Promise<HandWorkerSample>(resolve => { resolveHand = resolve; })) };
  const captureFrame = vi.fn(async () => { clock += 2; return { width: 1280, height: 720, close: vi.fn(() => { clock += 1; }) } as unknown as ImageBitmap; });
  const originalMapper = mapper.mapRawTrackingFrame;
  vi.spyOn(mapper, "mapRawTrackingFrame").mockImplementation((...args) => { clock += 5; return originalMapper(...args); });
  const pipeline = new TrackingPipeline({ profile: "full-rate", resolution: "720p", delegate: "GPU", parallelHands,
    poseGuidedHands: true, adaptiveHandConfidence: true, onFrame, onMetrics, now: () => clock },
  { camera, runtime, metrics, handWorker: parallelHands ? worker : undefined, captureFrame } as unknown as TrackingPipelineDependencies);
  return { pipeline, video, tasks, metrics, onFrame, worker,
    frame: (mediaTime = 1, presentedFrames = 1) => callback?.(clock, { mediaTime, presentedFrames } as VideoFrameCallbackMetadata),
    snapshot: () => metrics.snapshot(clock, "GPU", "full"),
    setClock: (value: number) => { clock = value; },
    finishHand: () => resolveHand({ result: empty, sampledAtMs: 100, inferenceMs: 14,
      timings: { roiPreparationMs: 2, inferenceMs: 11, mappingMs: 1, workerTotalMs: 14 }, postMessageMs: .5 }) };
}

describe("Phase A pipeline instrumentation", () => {
  it("applies a measurement reset at the next callback without resetting model clocks or rescheduling", async () => {
    const t = setup(true); await t.pipeline.start(t.video); t.frame(); await flush();
    const id = t.pipeline.requestMeasurementReset(); // Request while a worker owns the current bitmap.
    expect(t.snapshot().measurementId).toBe(0);
    expect(t.video.requestVideoFrameCallback).toHaveBeenCalledOnce();
    t.setClock(150); t.finishHand(); await flush();
    expect(t.snapshot().measurementId).toBe(0); // Current frame stays in old measurement.
    t.setClock(200); t.frame(2, 4); await flush();
    expect(t.snapshot().measurementId).toBe(id);
    expect(t.snapshot().measurementCounts?.pipelineFrames).toBe(1);
    expect(t.worker.initialize).toHaveBeenCalledOnce();
    expect(t.tasks.face.detectForVideo).toHaveBeenCalledTimes(2);
    expect(t.tasks.pose.detectForVideo).toHaveBeenCalledTimes(2);
    expect(t.video.requestVideoFrameCallback).toHaveBeenCalledTimes(2); // No backlog while second Hand is pending.
    t.pipeline.dispose();
  });
  it("includes mapping, a 10ms onFrame and metrics handler in total without changing detector calls", async () => {
    const t = setup(); await t.pipeline.start(t.video); t.frame();
    const s = t.snapshot(), d = s.timings!;
    expect(d.mapRawTrackingFrameMs.average).toBe(5);
    expect(d.onFrameMs.average).toBe(10);
    expect(d.trackingPublishMs.average).toBe(36); // 7 + 11 + 13 + mapping 5.
    expect(d.totalProcessFrameMs.average).toBe(49); // Publish 36 + onFrame 10 + metrics handler 3.
    expect(s.inferenceTimeMs.pipeline.average).toBe(49);
    expect(d.motionProcessMs.average).toBe(6);
    expect(d.avatarApplyMs.average).toBe(1);
    expect(d.pipelineStartToAvatarApplyMs.average).toBe(45);
    for (const task of Object.values(t.tasks)) expect(task.detectForVideo).toHaveBeenCalledOnce();
    expect(t.onFrame).toHaveBeenCalledOnce();
    expect(t.video.requestVideoFrameCallback).toHaveBeenCalledTimes(2);
    t.frame(1, 2); // Duplicate mediaTime still reschedules, never runs detectors.
    for (const task of Object.values(t.tasks)) expect(task.detectForVideo).toHaveBeenCalledOnce();
    expect(t.video.requestVideoFrameCallback).toHaveBeenCalledTimes(3);
    t.pipeline.dispose();
  });

  it("keeps a single frame in flight and measures worker overlap rather than summing inference branches", async () => {
    const t = setup(true); await t.pipeline.start(t.video); t.frame(); await flush();
    expect(t.onFrame).not.toHaveBeenCalled();
    expect(t.video.requestVideoFrameCallback).toHaveBeenCalledOnce();
    expect(t.worker.detect).toHaveBeenCalledOnce();
    expect(t.tasks.hands.detectForVideo).not.toHaveBeenCalled();
    t.setClock(150); t.finishHand(); await flush();
    const d = t.snapshot().timings!;
    expect(d.captureVideoBitmapMs.average).toBe(2);
    expect(d.captureHandBitmapMs.average).toBe(2);
    expect(d.mainThreadInferenceMs.average).toBe(20);
    expect(d.workerRoundTripMs.average).toBe(46); // Dispatch at 104, continuation at 150.
    expect(d.workerWaitMs.average).toBe(26); // Main branch already occupied 20 of those 46ms.
    expect(d.handsInferenceMs.average).toBe(11);
    expect(d.workerRoiPreparationMs.average).toBe(2);
    expect(d.workerMappingMs.average).toBe(1);
    expect(d.trackingPublishMs.average).toBe(55);
    expect(d.totalProcessFrameMs.average).toBe(69); // 4 + max(20,46) + 5 + 10 + 3 + bitmap close 1.
    expect(t.video.requestVideoFrameCallback).toHaveBeenCalledTimes(2);
    expect(t.onFrame).toHaveBeenCalledOnce();
    t.pipeline.dispose();
  });
});
