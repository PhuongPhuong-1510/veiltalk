import { describe, expect, it, vi } from "vitest";
import { TrackingPipeline, type TrackingPipelineDependencies } from "./trackingPipeline";
import type { HandWorkerSample } from "./handWorkerProtocol";
import type { TrackingExperiments } from "./trackingScheduler";

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function setup(features: { poseGuidedHands?: boolean; adaptiveHandConfidence?: boolean; experiments?: TrackingExperiments } = {}) {
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
  it("combines scheduler flags without retimestamping cached Pose hints or Hand observations", async () => {
    const t = setup({ poseGuidedHands: true, adaptiveHandConfidence: true,
      experiments: { callbackAhead: true, boundedPose: true, cachedPoseHint: true, handRoiRecovery: true } });
    const points = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 1 }));
    points[11].x = .4; points[12].x = .6; points[15].x = .2; points[16].x = .8;
    t.runtime.tasks.pose.detectForVideo.mockReturnValue({ landmarks: [points], worldLandmarks: [points] } as never);
    await t.pipeline.start(t.video);
    for (const [time, at] of [[1, 100], [2, 130], [3, 160]]) { t.setNow(at); t.frame(time); await flush(); t.finish(); await flush(); }
    expect(t.worker.detect.mock.calls[2][3]).toMatchObject({ pose: { state: "not-sampled", sampledAtMs: 100 }, ageMs: 60 });
    expect(t.onFrame.mock.calls.map(call => call[0].handSampledAtMs)).toEqual([100, 130, 160]);
    expect(t.onFrame.mock.calls.map(call => call[0].pose.state)).toEqual(["tracked", "not-sampled", "tracked"]);
    t.pipeline.dispose();
  });
  it("drops busy callback-ahead frames without a queue or replay of their timestamps", async () => {
    const t = setup({ experiments: { callbackAhead: true } });
    await t.pipeline.start(t.video); t.frame(1); await flush();
    expect(t.video.requestVideoFrameCallback).toHaveBeenCalledTimes(2);
    for (let i = 1; i <= 4; i++) { t.setNow(100 + i * 10); t.frame(1 + i / 100); await flush(); }
    expect(t.worker.detect).toHaveBeenCalledOnce(); expect(t.captureFrame).toHaveBeenCalledTimes(2);
    t.finish(); await flush();
    expect(t.onFrame).toHaveBeenCalledOnce();
    t.setNow(160); t.frame(1); await flush(); // Duplicate after completion.
    expect(t.worker.detect).toHaveBeenCalledOnce();
    t.setNow(180); t.frame(2); await flush(); t.finish(); await flush();
    expect(t.onFrame.mock.calls.map(call => call[0].frameTimestampMs)).toEqual([1000, 2000]);
    t.pipeline.dispose();
  });

  it("ignores cancelled/duplicate callbacks without clearing the restarted callback", async () => {
    const t = setup({ experiments: { callbackAhead: true } });
    await t.pipeline.start(t.video);
    const oldCallback = (t.video.requestVideoFrameCallback as ReturnType<typeof vi.fn>).mock.calls[0][0] as VideoFrameRequestCallback;
    t.pipeline.stop(); await t.pipeline.start(t.video);
    oldCallback(0, { mediaTime: 10 } as VideoFrameCallbackMetadata);
    expect(t.worker.detect).not.toHaveBeenCalled();
    t.frame(.1); await flush(); t.finish(); await flush();
    expect(t.onFrame).toHaveBeenCalledOnce(); expect(t.onFrame.mock.calls[0][0].frameTimestampMs).toBe(100);
    const count = (t.video.requestVideoFrameCallback as ReturnType<typeof vi.fn>).mock.calls.length;
    t.pipeline.stop(); oldCallback(0, { mediaTime: 20 } as VideoFrameCallbackMetadata);
    expect(t.video.requestVideoFrameCallback).toHaveBeenCalledTimes(count); t.pipeline.dispose();
  });

  it("keeps bounded Pose skip semantics and forces a fresh Pose after a skip", async () => {
    const t = setup({ experiments: { boundedPose: true, callbackAhead: true } });
    const points = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 1 }));
    t.runtime.tasks.pose.detectForVideo.mockReturnValue({ landmarks: [points], worldLandmarks: [points] } as never);
    await t.pipeline.start(t.video); t.frame(1); await flush(); t.finish(); await flush();
    t.setNow(130); t.frame(2); await flush(); t.finish(); await flush();
    const skipped = t.onFrame.mock.calls[1][0];
    expect(skipped.pose.state).toBe("not-sampled"); expect(skipped.pose.sampledAtMs).toBe(100);
    expect(skipped.handSampledAtMs).toBe(130); expect(skipped.handSampledThisFrame).toBe(true);
    t.setNow(160); t.frame(3); await flush(); t.finish(); await flush();
    expect(t.runtime.tasks.pose.detectForVideo).toHaveBeenCalledTimes(2);
    expect(t.onFrame.mock.calls[2][0].pose).toMatchObject({ state: "tracked", sampledAtMs: 160 }); t.pipeline.dispose();
  });

  it("closes both captures when stopped during the second capture", async () => {
    const t = setup({ experiments: { callbackAhead: true } });
    let resolveCopy!: (image: ImageBitmap) => void;
    const snapshot = { width: 640, height: 480, close: vi.fn() } as unknown as ImageBitmap;
    t.captureFrame.mockResolvedValueOnce(snapshot).mockImplementationOnce(() => new Promise(resolve => { resolveCopy = resolve; }));
    await t.pipeline.start(t.video); t.frame(); await flush(); t.pipeline.stop();
    const copy = { close: vi.fn() } as unknown as ImageBitmap; resolveCopy(copy); await flush();
    expect(snapshot.close).toHaveBeenCalledOnce(); expect(copy.close).toHaveBeenCalledOnce();
    expect(t.worker.detect).not.toHaveBeenCalled(); t.pipeline.dispose();
  });
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

  it("CPU Worker failure reports GPU main fallback instead of counting it as a CPU run", async () => {
    const t = setup(); t.worker.selectedDelegate = "CPU";
    t.worker.initialize.mockRejectedValueOnce(new Error("CPU worker unavailable"));
    await t.pipeline.start(t.video); t.frame(); await flush();
    expect(t.runtime.initializeHands).toHaveBeenCalledOnce();
    expect(t.onMetrics.mock.calls[0][0]).toMatchObject({ handExecution: "main-thread", handDelegate: "GPU", handWorkerFallback: "CPU worker unavailable" });
    t.pipeline.dispose();
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
