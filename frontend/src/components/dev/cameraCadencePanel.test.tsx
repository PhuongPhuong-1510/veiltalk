// @vitest-environment happy-dom
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { CameraCadencePanel } from "./CameraCadencePanel";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it("resets, exports camera-only without inference metrics, and cancels callbacks on stop", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.useFakeTimers();
  const videoRef = createRef<HTMLVideoElement>(); videoRef.current = document.createElement("video");
  let callback: VideoFrameRequestCallback = () => {};
  videoRef.current.requestVideoFrameCallback = vi.fn(cb => { callback = cb; return 42; });
  videoRef.current.cancelVideoFrameCallback = vi.fn();
  const container = document.createElement("div"), root = createRoot(container);
  let now = 0; vi.spyOn(performance, "now").mockImplementation(() => now);
  let blob: Blob | undefined;
  vi.spyOn(URL, "createObjectURL").mockImplementation(value => { blob = value as Blob; return "blob:test"; });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const props = { videoRef, running: true, mode: "camera-only" as const, context: { strategy: "none" } };
  await act(async () => root.render(<CameraCadencePanel {...props}/>));
  const buttons = container.querySelectorAll("button");
  expect(buttons[1].disabled).toBe(true);
  await act(async () => buttons[0].click());
  await act(async () => {
    callback(0, { presentedFrames: 100 } as VideoFrameCallbackMetadata);
    now = 1000; callback(1000, { presentedFrames: 130 } as VideoFrameCallbackMetadata);
    vi.advanceTimersByTime(500);
  });
  await act(async () => buttons[1].click());
  expect(JSON.parse(await blob!.text())).toMatchObject({ mode: "camera-only", metrics: null, cadence: { presentedFps: 30, callbackFps: 1 } });
  await act(async () => root.render(<CameraCadencePanel {...props} running={false}/>));
  expect(videoRef.current.cancelVideoFrameCallback).toHaveBeenCalledWith(42);
  expect(buttons[1].disabled).toBe(true);
  await act(async () => root.unmount());
});
