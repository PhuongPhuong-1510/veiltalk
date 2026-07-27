import { describe, expect, it, vi } from "vitest";
import type { FaceLandmarkerResult, HandLandmarkerResult, PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import { TrackingPipeline, type TrackingPipelineDependencies } from "./trackingPipeline";

const point = { x: 0, y: 0, z: 0, visibility: 1 };
const faceResult = { faceLandmarks: [[point]], faceBlendshapes: [], facialTransformationMatrixes: [] } as FaceLandmarkerResult;
const handResult = { landmarks: [], worldLandmarks: [], handedness: [], handednesses: [] } as HandLandmarkerResult;
const poseResult = { landmarks: [[point]], worldLandmarks: [[point]], close() {} } as unknown as PoseLandmarkerResult;

function setup(profile: "full-rate" | "staggered" = "full-rate") {
  let callback: VideoFrameRequestCallback | undefined;
  const video = {
    requestVideoFrameCallback: vi.fn((next: VideoFrameRequestCallback) => { callback = next; return 1; }),
    cancelVideoFrameCallback: vi.fn(),
    currentTime: 0,
  } as unknown as HTMLVideoElement;
  const camera = { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn() };
  const runtime = {
    initialize: vi.fn().mockResolvedValue(undefined), dispose: vi.fn(), selectedDelegate: "GPU",
    tasks: {
      face: { detectForVideo: vi.fn((_video: TexImageSource, _timestamp: number) => faceResult), close: vi.fn() },
      hands: { detectForVideo: vi.fn((_video: TexImageSource, _timestamp: number) => handResult), close: vi.fn() },
      pose: { detectForVideo: vi.fn((_video: TexImageSource, _timestamp: number) => poseResult), close: vi.fn() },
    },
  };
  const metrics = {
    reset: vi.fn(), startLongTaskObserver: vi.fn(), stopLongTaskObserver: vi.fn(), recordCameraFrame: vi.fn(),
    recordInference: vi.fn(), recordPipeline: vi.fn(), snapshot: vi.fn(() => ({})),
  };
  let now = 0;
  const onFrame = vi.fn();
  const onError = vi.fn();
  const pipeline = new TrackingPipeline(
    { profile, onFrame, onError, now: () => ++now },
    { camera, runtime, metrics } as unknown as TrackingPipelineDependencies,
  );
  return { pipeline, video, camera, runtime, metrics, onFrame, onError, frame: (mediaTime: number) => callback?.(0, { mediaTime } as VideoFrameCallbackMetadata) };
}

describe("TrackingPipeline", () => {
  it("starts only one loop, ignores duplicate frames, stops camera but retains models", async () => {
    const test = setup();
    await Promise.all([test.pipeline.start(test.video), test.pipeline.start(test.video)]);
    expect(test.runtime.initialize).toHaveBeenCalledTimes(1);
    expect(test.video.requestVideoFrameCallback).toHaveBeenCalledTimes(1);
    test.frame(1);
    expect(test.onFrame).toHaveBeenCalledTimes(1);
    expect(test.runtime.tasks.face.detectForVideo).toHaveBeenCalledTimes(1);
    const firstMediaPipeTimestamp = test.runtime.tasks.face.detectForVideo.mock.calls[0][1];
    test.frame(1);
    expect(test.onFrame).toHaveBeenCalledTimes(1);
    test.pipeline.stop();
    expect(test.camera.stop).toHaveBeenCalled();
    expect(test.runtime.dispose).not.toHaveBeenCalled();
    await test.pipeline.start(test.video);
    expect(test.runtime.initialize).toHaveBeenCalledTimes(2);
    test.frame(0.1);
    const restartedMediaPipeTimestamp = test.runtime.tasks.face.detectForVideo.mock.calls[1][1];
    expect(restartedMediaPipeTimestamp).toBeGreaterThan(firstMediaPipeTimestamp);
    test.pipeline.dispose();
    expect(test.runtime.dispose).toHaveBeenCalledTimes(1);
    await expect(test.pipeline.start(test.video)).rejects.toThrow("dispose");
  });

  it("isolates consumer callback errors and continues scheduling", async () => {
    const test = setup();
    test.onFrame.mockImplementation(() => { throw new Error("consumer"); });
    await test.pipeline.start(test.video);
    test.frame(1);
    expect(test.onError).toHaveBeenCalledWith(expect.objectContaining({ message: "consumer" }));
    expect(test.video.requestVideoFrameCallback).toHaveBeenCalledTimes(2);
  });

  it("cleans camera and reports MediaPipe initialization failure", async () => {
    const test = setup();
    test.runtime.initialize.mockRejectedValueOnce(new Error("model 404"));
    await expect(test.pipeline.start(test.video)).rejects.toThrow("model 404");
    expect(test.camera.stop).toHaveBeenCalled();
    expect(test.onError).toHaveBeenCalled();
    expect(test.pipeline.state).toBe("error");
  });

  it("marks staggered groups not-sampled without changing their sample time", async () => {
    const test = setup("staggered");
    await test.pipeline.start(test.video);
    test.frame(1);
    const first = test.onFrame.mock.calls[0][0];
    test.frame(1.033);
    const second = test.onFrame.mock.calls[1][0];
    expect(first.pose.state).toBe("tracked");
    expect(second.pose.state).toBe("not-sampled");
    expect(second.pose.sampledAtMs).toBe(first.pose.sampledAtMs);
  });

  it("does not call fetch, WebSocket or WebRTC while processing camera frames", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const websocket = vi.fn(); const peer = vi.fn();
    vi.stubGlobal("WebSocket", websocket); vi.stubGlobal("RTCPeerConnection", peer);
    const test = setup();
    await test.pipeline.start(test.video);
    test.frame(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(websocket).not.toHaveBeenCalled();
    expect(peer).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
