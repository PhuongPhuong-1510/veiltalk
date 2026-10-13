import { afterEach, describe, expect, it, vi } from "vitest";
import { TrackingPipeline, type TrackingPipelineDependencies } from "./trackingPipeline";
import { TrackingMetricsCollector } from "./trackingMetrics";

afterEach(() => vi.unstubAllGlobals());
describe("animation callback fallback", () => {
  it.each([false, true])("keeps a single callback and fresh timestamps with callbackAhead=%s", async callbackAhead => {
    let clock = 100, nextId = 0;
    const callbacks = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { callbacks.set(++nextId, cb); return nextId; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => { callbacks.delete(id); });
    const onFrame = vi.fn(), metrics = new TrackingMetricsCollector();
    const task = { detectForVideo: vi.fn(() => ({ faceLandmarks: [], faceBlendshapes: [], facialTransformationMatrixes: [] })) };
    const video = { currentTime: 1, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement;
    const pipeline = new TrackingPipeline({ experiments: { callbackAhead }, onFrame, now: () => clock }, {
      camera: { start: vi.fn(), stop: vi.fn() }, metrics,
      runtime: { initialize: vi.fn(), dispose: vi.fn(), selectedDelegate: "GPU", tasks: { face: task } },
    } as unknown as TrackingPipelineDependencies);
    const tick = (time: number, at: number) => {
      video.currentTime = time; clock = at;
      expect(callbacks.size).toBe(1);
      const [id, callback] = callbacks.entries().next().value!; callbacks.delete(id); callback(at);
    };
    await pipeline.start(video);
    tick(1, 100); tick(1, 116); tick(1.033, 133); tick(1.01, 150); tick(NaN, 200); tick(2, 1100);
    expect(onFrame.mock.calls.map(call => call[0].frameTimestampMs)).toEqual([1000, 1033, 2000]);
    const late = [...callbacks.values()][0]; pipeline.stop(); expect(callbacks.size).toBe(0);
    await pipeline.start(video); late(1200); expect(callbacks.size).toBe(1);
    tick(.1, 1300); expect(onFrame.mock.calls.at(-1)![0].frameTimestampMs).toBe(100);
    const times = task.detectForVideo.mock.calls as unknown as Array<[unknown, number]>;
    expect(times.at(-1)![1]).toBeGreaterThan(times.at(-2)![1]);
    pipeline.dispose(); expect(callbacks.size).toBe(0);
  });
});
