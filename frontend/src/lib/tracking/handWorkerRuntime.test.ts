import { afterEach, describe, expect, it, vi } from "vitest";
import type { HandLandmarkerResult } from "@mediapipe/tasks-vision";
import type { HandWorkerExperiments, HandWorkerRequest, HandWorkerResponse } from "./handWorkerProtocol";
import type { HandPoseHint } from "./poseGuidedHandInput";
const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@mediapipe/tasks-vision", () => ({ HandLandmarker: { createFromOptions: mocks.create } }));
const empty: HandLandmarkerResult = { landmarks: [], worldLandmarks: [], handedness: [], handednesses: [] };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function hint(): HandPoseHint {
  const landmarks = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 1 }));
  landmarks[11].x = .4; landmarks[12].x = .6; landmarks[15].x = .2; landmarks[16].x = .8;
  return { pose: { state: "tracked", sampledAtMs: 100, landmarks, worldLandmarks: null }, width: 1280, height: 720, ageMs: 30 };
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
async function setup(experiments?: HandWorkerExperiments, adaptive = false) {
  vi.resetModules();
  const context = { fillRect: vi.fn(), drawImage: vi.fn(), fillStyle: "" };
  class Canvas { width: number; height: number; constructor(w: number, h: number) { this.width = w; this.height = h; } getContext() { return context; } }
  vi.stubGlobal("OffscreenCanvas", Canvas);
  const scope = { location: { href: "https://local.test/worker.js" }, onmessage: null as ((event: { data: HandWorkerRequest }) => void) | null, postMessage: vi.fn<(response: HandWorkerResponse) => void>() };
  vi.stubGlobal("self", scope);
  const normal = { detectForVideo: vi.fn(() => empty), close: vi.fn() }, sensitive = { detectForVideo: vi.fn(() => empty), close: vi.fn() };
  mocks.create.mockReset().mockResolvedValueOnce(normal).mockResolvedValueOnce(sensitive);
  await import("./handTracking.worker");
  const send = async (data: HandWorkerRequest) => { scope.onmessage!({ data }); await flush(); };
  await send({ kind: "initialize", id: 1, assetBase: "https://local.test/mediapipe/", delegate: "CPU", experiments, adaptiveHandConfidence: adaptive });
  normal.detectForVideo.mockClear(); sensitive.detectForVideo.mockClear(); scope.postMessage.mockClear();
  const detect = async (at: number, poseHint: HandPoseHint | null = hint(), guided = true) => {
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    await send({ kind: "detect", id: at, bitmap, timestampMs: at, sampledAtMs: at, poseHint, poseGuidedHands: guided });
    return { bitmap, response: scope.postMessage.mock.calls.at(-1)![0] };
  };
  return { context, normal, sensitive, scope, detect };
}
describe("Hand Worker runtime with synthetic model", () => {
  it("keeps the baseline two-zero-result miss limit and closes every transferred bitmap", async () => {
    const t = await setup();
    for (const [at, mode] of [[100, "split"], [130, "split"], [160, "full-frame"], [190, "split"]] as const) {
      const { bitmap, response } = await t.detect(at);
      expect(response).toMatchObject({ kind: "result", timestampMs: at, sampledAtMs: at, inputMode: mode });
      expect(bitmap.close).toHaveBeenCalledOnce();
    }
    expect(t.normal.detectForVideo).toHaveBeenCalledTimes(4);
  });
  it("recovers the missing right region while still detecting the left hand", async () => {
    const t = await setup({ handRoiRecovery: true });
    // After letterboxing each split region's wrist lies at (.25,.5) / (.75,.5).
    const left = { ...empty, landmarks: [Array.from({ length: 21 }, () => ({ x: .25, y: .5, z: 0, visibility: 1 }))] };
    const first = await t.detect(100); expect(first.response).toMatchObject({ inputMode: "full-frame", diagnostics: { roiReason: "periodic" } });
    t.normal.detectForVideo.mockReturnValue(left);
    const a = await t.detect(130), b = await t.detect(160), probe = await t.detect(190);
    expect(a.response).toMatchObject({ inputMode: "split", diagnostics: { coveredSides: ["left"] } });
    expect(b.response).toMatchObject({ inputMode: "split" });
    expect(probe.response).toMatchObject({ inputMode: "full-frame", diagnostics: { roiReason: "recovery" } });
  });
  it("uses cached geometry only behind its flag, keeps source clocks, and rejects stale geometry", async () => {
    const t = await setup({ cachedPoseHint: true });
    const cached = hint(); cached.pose.state = "not-sampled"; const before = structuredClone(cached);
    expect((await t.detect(130, cached)).response).toMatchObject({ timestampMs: 130, sampledAtMs: 130, inputMode: "split", diagnostics: { hintStatus: "fresh-cached" } });
    expect(cached).toEqual(before);
    cached.ageMs = 121;
    expect((await t.detect(160, cached)).response).toMatchObject({ inputMode: "full-frame", diagnostics: { hintStatus: "stale" } });
  });
  it("falls back to the original bitmap after draw errors and closes it on inference errors", async () => {
    const t = await setup(); t.context.drawImage.mockImplementation(() => { throw new Error("draw failed"); });
    const result = await t.detect(100);
    expect(result.response).toMatchObject({ inputMode: "full-frame", diagnostics: { roiReason: "draw-failed" } });
    expect(t.normal.detectForVideo).toHaveBeenLastCalledWith(result.bitmap, 100);
    t.normal.detectForVideo.mockImplementation(() => { throw new Error("inference failed"); });
    const failure = await t.detect(130);
    expect(failure.response).toMatchObject({ kind: "error", message: "inference failed" }); expect(failure.bitmap.close).toHaveBeenCalledOnce();
  });
  it("keeps normal and sensitive confidence options unchanged and runs only the selected instance", async () => {
    const t = await setup(undefined, true);
    expect(mocks.create.mock.calls[0][1]).toMatchObject({ baseOptions: { delegate: "CPU" }, runningMode: "VIDEO", numHands: 2 });
    expect(mocks.create.mock.calls[0][1].minHandDetectionConfidence).toBeUndefined();
    expect(mocks.create.mock.calls[1][1]).toMatchObject({ minHandDetectionConfidence: .3, minTrackingConfidence: .3, minHandPresenceConfidence: .5 });
    const far = hint(); far.pose.landmarks![11].x = .46; far.pose.landmarks![12].x = .54;
    expect((await t.detect(100, far)).response).toMatchObject({ confidenceMode: "sensitive" });
    expect(t.sensitive.detectForVideo).toHaveBeenCalledOnce(); expect(t.normal.detectForVideo).not.toHaveBeenCalled();
  });
});
