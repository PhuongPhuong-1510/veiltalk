import { describe, expect, it, vi } from "vitest";
import { TrackingPipeline, type TrackingPipelineDependencies } from "./trackingPipeline";
import type { HandWorkerSample } from "./handWorkerProtocol";

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function setup(features: { poseGuidedHands?: boolean; adaptiveHandConfidence?: boolean } = {}) {
  let callback: VideoFrameRequestCallback | undefined, now = 100;
  const video = { videoWidth: 640, videoHeight: 480, currentTime: 0,
    requestVideoFrameCallback: vi.fn((cb: VideoFrameRequestCallback) => { callback = cb; return 1; }), cancelVideoFrameCallback: vi.fn(),
  } as unknown as HTMLVideoElement;
  const bitmaps: ImageBitmap[] = [];
  const captureFrame = vi.fn(async () => { const bitmap = { width: 640, height: 480, close: vi.fn() } as unknown as ImageBitmap; bitmaps.push(bitmap); return bitmap; });
  const sample = { landmarks: [], worldLandmarks: [], handedness: [], handednesses: [] };
  const task = () => ({ detectForVideo: vi.fn(() => sample) });
  const runtime = { initialize: vi.fn().mockResolvedValue(undefined), initializeHands: vi.fn().mockResolvedValue(undefined), releaseHands: vi.fn(), dispose: vi.fn(), selectedDelegate: "GPU", selectedPoseModel: "full",
    tasks: { hands: task(), pose: task(), face: { detectForVideo: vi.fn(() => ({ faceLandmarks: [], faceBlendshapes: [], facialTransformationMatrixes: [] })) } },
  };
  let resolve!: (sample: HandWorkerSample) => void, reject!: (error: Error) => void;
  const worker = { initialize: vi.fn().mockResolvedValue(undefined), selectedDelegate: "GPU", dispose: vi.fn(),
    detect: vi.fn((_bitmap: ImageBitmap, _timestamp: number, _sampled: number, _poseHint?: unknown, _guided?: boolean) => new Promise<HandWorkerSample>((res, rej) => { resolve = res; reject = rej; })),
  };
  const metrics = { reset: vi.fn(), startLongTaskObserver: vi.fn(), stopLongTaskObserver: vi.fn(), recordCameraFrame: vi.fn(), recordInference: vi.fn(), recordPipeline: vi.fn(), snapshot: vi.fn(() => ({})), recordWorkerFrame: vi.fn() };
  const camera = { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn() };
  const onFrame = vi.fn(), onError = vi.fn(), onMetrics = vi.fn();
  const pipeline = new TrackingPipeline({ parallelHands: true, ...features, onFrame, onError, onMetrics, now: () => now }, { runtime, camera, metrics, handWorker: worker, captureFrame } as unknown as TrackingPipelineDependencies);
  const finish = (at = worker.detect.mock.calls.at(-1)![2]) => resolve({ result: sample, sampledAtMs: at, inferenceMs: 12 });
  return { pipeline, video, worker, runtime, metrics, captureFrame, bitmaps, camera, onFrame, onError, onMetrics, finish,
    fail: () => reject(new Error("worker timeout")), frame: (time = 1) => callback?.(0, { mediaTime: time } as VideoFrameCallbackMetadata), setNow: (value: number) => { now = value; } };
}

describe("parallel Hand tracking pipeline", () => {
  it("passes only a recent Pose hint to the worker and keeps capture timestamps aligned", async () => {
    const t = setup({ poseGuidedHands: true });
    const points = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 1 }));
    points[11].x = .4; points[12].x = .6; points[15].x = .3; points[16].x = .7;
    t.runtime.tasks.pose.detectForVideo.mockReturnValue({ landmarks: [points], worldLandmarks: [points] } as never);
    await t.pipeline.start(t.video);
    t.frame(1); await flush();
    expect(t.worker.detect.mock.calls[0][3]).toBeNull();
    t.setNow(125); t.finish(); await flush();
    t.setNow(150); t.frame(1.033); await flush();
    expect(t.worker.detect.mock.calls[1][3]).toMatchObject({ width: 640, height: 480, ageMs: 50 });
    expect(t.worker.detect.mock.calls[1][4]).toBe(true);
    t.finish(); await flush(); t.pipeline.dispose();
  });
  it("starts Hand before Face/Pose, reads one immutable source image and publishes matching sample times", async () => {
    const t = setup(); await t.pipeline.start(t.video); t.frame(); await flush();
    expect(t.captureFrame).toHaveBeenNthCalledWith(1, t.video);
    expect(t.captureFrame).toHaveBeenNthCalledWith(2, t.bitmaps[0]);
    expect(t.runtime.tasks.face.detectForVideo).toHaveBeenCalledWith(t.bitmaps[0], 100);
    expect(t.runtime.tasks.pose.detectForVideo).toHaveBeenCalledWith(t.bitmaps[0], 100);
    expect(t.worker.detect.mock.invocationCallOrder[0]).toBeLessThan(t.runtime.tasks.face.detectForVideo.mock.invocationCallOrder[0]);
    expect(t.runtime.tasks.hands.detectForVideo).not.toHaveBeenCalled();
    expect(t.onFrame).not.toHaveBeenCalled();
    expect(t.video.requestVideoFrameCallback).toHaveBeenCalledTimes(1); // No queue while busy.
    t.setNow(130); t.finish(); await flush();
    const frame = t.onFrame.mock.calls[0][0];
    expect(frame.face.sampledAtMs).toBe(100); expect(frame.pose.sampledAtMs).toBe(100); expect(frame.handSampledAtMs).toBe(100);
    expect(frame.handSampledThisFrame).toBe(true);
    expect(t.bitmaps[0].close).toHaveBeenCalledOnce();
    expect(t.onMetrics.mock.calls[0][0].handExecution).toBe("worker"); t.pipeline.dispose();
  });

  it("discards stale results without pretending to have a fresh empty hand detection", async () => {
    const t = setup(); await t.pipeline.start(t.video); t.frame(); await flush(); t.setNow(290); t.finish(); await flush();
    const frame = t.onFrame.mock.calls[0][0];
    expect(frame.handSampledThisFrame).toBe(false); expect(frame.leftHand.state).toBe("not-sampled"); expect(frame.handSampledAtMs).toBeNull();
    expect(t.onMetrics.mock.calls[0][0].handWorkerDroppedSamples).toBe(1); t.pipeline.dispose();
  });

  it("ignores results from a stopped session and keeps restarted timestamps monotonic", async () => {
    const t = setup(); await t.pipeline.start(t.video); t.frame(); await flush();
    t.pipeline.stop(); await t.pipeline.start(t.video); t.finish(); await flush();
    expect(t.onFrame).not.toHaveBeenCalled();
    t.frame(.1); await flush(); expect(t.worker.detect.mock.calls[1][1]).toBeGreaterThan(t.worker.detect.mock.calls[0][1]);
    t.finish(); await flush(); expect(t.onFrame).toHaveBeenCalledOnce(); t.pipeline.dispose();
  });

  it("closes captures that finish after stop without dispatching them", async () => {
    const t = setup(); let resolveCapture!: (image: ImageBitmap) => void;
    t.captureFrame.mockImplementationOnce(() => new Promise(res => { resolveCapture = res; }));
    await t.pipeline.start(t.video); t.frame(); t.pipeline.stop();
    const image = { close: vi.fn() } as unknown as ImageBitmap; resolveCapture(image); await flush();
    expect(image.close).toHaveBeenCalledOnce(); expect(t.worker.detect).not.toHaveBeenCalled(); expect(t.onFrame).not.toHaveBeenCalled(); t.pipeline.dispose();
  });

  it("falls back on initialization failure, reporting actual execution mode", async () => {
    const t = setup(); t.worker.initialize.mockRejectedValueOnce(new Error("unsupported GPU"));
    await t.pipeline.start(t.video); t.frame(); await flush();
    expect(t.runtime.initializeHands).toHaveBeenCalledOnce(); expect(t.runtime.tasks.hands.detectForVideo).toHaveBeenCalledOnce();
    expect(t.onMetrics.mock.calls[0][0]).toMatchObject({ handExecution: "main-thread", handWorkerFallback: "unsupported GPU" });
    expect(t.onError).not.toHaveBeenCalled(); t.pipeline.dispose();
  });

  it("falls back after inference failure and skips the frame delayed by fallback model loading", async () => {
    const t = setup(); await t.pipeline.start(t.video); t.frame(); await flush(); t.fail(); await flush();
    expect(t.runtime.initializeHands).toHaveBeenCalledOnce(); expect(t.onFrame).not.toHaveBeenCalled();
    t.setNow(200); t.frame(2); await flush(); expect(t.runtime.tasks.hands.detectForVideo).toHaveBeenCalledOnce();
    expect(t.onFrame).toHaveBeenCalledOnce(); expect(t.onError).not.toHaveBeenCalled(); t.pipeline.dispose();
  });

  it("falls back when frame transfer/capture is unsupported", async () => {
    const t = setup(); t.captureFrame.mockRejectedValueOnce(new Error("bitmap unsupported"));
    await t.pipeline.start(t.video); t.frame(); await flush();
    expect(t.runtime.initializeHands).toHaveBeenCalledOnce(); expect(t.worker.detect).not.toHaveBeenCalled();
    t.frame(2); await flush(); expect(t.onMetrics.mock.calls[0][0].handWorkerFallback).toBe("bitmap unsupported"); t.pipeline.dispose();
  });

  it("does not revive a stopped pipeline when an asynchronous fallback fails", async () => {
    const t = setup(); let rejectFallback!: (error: Error) => void;
    t.runtime.initializeHands.mockImplementationOnce(() => new Promise((_res, reject) => { rejectFallback = reject; }));
    await t.pipeline.start(t.video); t.frame(); await flush(); t.fail(); await flush();
    t.pipeline.stop(); rejectFallback(new Error("fallback load failed")); await flush();
    expect(t.pipeline.state).toBe("stopped"); expect(t.onError).not.toHaveBeenCalled(); expect(t.onFrame).not.toHaveBeenCalled(); t.pipeline.dispose();
  });
});
