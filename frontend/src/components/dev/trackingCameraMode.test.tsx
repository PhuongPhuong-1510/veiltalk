// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  cameraStart: vi.fn(async () => {}), cameraStop: vi.fn(),
  pipeline: { start: vi.fn(async () => {}), stop: vi.fn(), requestMeasurementReset: vi.fn(), state: "running", cameraSettings: { frameRate: 30 } },
  options: vi.fn(),
}));
vi.mock("../../lib/tracking/cameraController", () => ({ CameraController: class {
  start = mocks.cameraStart; stop = mocks.cameraStop; settings = { frameRate: 30 };
} }));
vi.mock("../../lib/tracking/useTracking", () => ({ useTracking: (options: unknown) => { mocks.options(options); return mocks.pipeline; } }));
import TrackingDevHarness from "./TrackingDevHarness";
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
it("camera-only bypasses model startup; All three uses the tested worker configuration", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div"), root = createRoot(container);
  mocks.pipeline.stop.mockImplementation(() => { mocks.pipeline.state = "stopped"; });
  mocks.pipeline.start.mockImplementation(async () => { mocks.pipeline.state = "running"; });
  await act(async () => root.render(<TrackingDevHarness/>));
  const button = (name: string) => [...container.querySelectorAll("button")].find(b => b.textContent === name)!;
  await act(async () => button("Start").click());
  expect(mocks.cameraStart).toHaveBeenCalledOnce(); expect(mocks.pipeline.start).not.toHaveBeenCalled();
  await act(async () => button("Stop").click()); expect(mocks.cameraStop).toHaveBeenCalled();
  const tasks = [...container.querySelectorAll("select")].find(s => [...s.options].some(o => o.value === "camera"))!;
  await act(async () => { tasks.value = "all"; tasks.dispatchEvent(new Event("change", { bubbles: true })); });
  await act(async () => button("Start").click());
  expect(mocks.pipeline.start).toHaveBeenCalledOnce();
  expect(mocks.options).toHaveBeenLastCalledWith(expect.objectContaining({
    delegate: "GPU", handWorkerDelegate: "GPU", poseModel: "full", parallelHands: true,
    poseGuidedHands: true, adaptiveHandConfidence: true, experiments: { callbackAhead: true },
    tasks: { face: true, hands: true, pose: true },
  }));
  await act(async () => root.unmount());
});
it("closes a camera that finishes opening after the page unmounts", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let resolve!: () => void;
  mocks.cameraStart.mockImplementationOnce(() => new Promise<void>(done => { resolve = done; }));
  const container = document.createElement("div"), root = createRoot(container);
  await act(async () => root.render(<TrackingDevHarness/>));
  await act(async () => [...container.querySelectorAll("button")].find(b => b.textContent === "Start")!.click());
  await act(async () => root.unmount());
  const stops = mocks.cameraStop.mock.calls.length;
  await act(async () => resolve());
  expect(mocks.cameraStop.mock.calls.length).toBeGreaterThan(stops);
  expect(mocks.pipeline.start).not.toHaveBeenCalled();
});
