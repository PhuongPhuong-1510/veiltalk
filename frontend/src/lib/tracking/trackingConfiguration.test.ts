import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ runtime: vi.fn(), worker: vi.fn(), camera: vi.fn() }));
vi.mock("./mediaPipeRuntime", () => ({ MediaPipeRuntime: class { constructor(...args: unknown[]) { mocks.runtime(...args); } } }));
vi.mock("./handTrackingWorker", () => ({ HandTrackingWorker: class { constructor(...args: unknown[]) { mocks.worker(...args); } } }));
vi.mock("./cameraController", () => ({ CameraController: class { constructor(...args: unknown[]) { mocks.camera(...args); } } }));
import { TrackingPipeline, type TrackingPipelineOptions } from "./trackingPipeline";
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
function create(options: Partial<TrackingPipelineOptions> = {}) {
  vi.stubGlobal("document", { baseURI: "https://local.test/" });
  return new TrackingPipeline({ parallelHands: true, delegate: "GPU", onFrame: vi.fn(), ...options });
}
describe("tracking dependency configuration", () => {
  it.each([undefined, "GPU", "CPU", "AUTO"] as const)("inherits the main delegate %s without an override", delegate => {
    create({ delegate });
    expect(mocks.runtime.mock.calls[0][1]).toBe(delegate);
    expect(mocks.worker.mock.calls[0][1]).toBe(delegate);
  });
  it("overrides only the worker, retaining GPU for main tasks and fallback", () => {
    create({ handWorkerDelegate: "CPU" });
    expect(mocks.runtime.mock.calls[0].slice(1, 3)).toEqual(["GPU", { face: true, hands: false, pose: true }]);
    expect(mocks.worker.mock.calls[0][1]).toBe("CPU");
  });
  it("passes experimental ROI flags only when explicitly requested", () => {
    const experiments = { cachedPoseHint: true, handRoiRecovery: true };
    create({ experiments });
    expect(mocks.worker.mock.calls[0][5]).toBe(experiments);
    expect(mocks.runtime.mock.calls[0][2]).toEqual({ face: true, hands: false, pose: true });
  });
  it.each([{ parallelHands: false }, { tasks: { face: true, hands: false, pose: true } }])("does not create a disabled worker", options => {
    create({ ...options, handWorkerDelegate: "CPU" });
    expect(mocks.worker).not.toHaveBeenCalled();
  });
});
