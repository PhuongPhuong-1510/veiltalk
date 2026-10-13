import { describe, expect, it } from "vitest";
import { VideoCadence } from "./videoCadence";
describe("independent video cadence", () => {
  it("distinguishes missed callbacks from presented frames and resets warm-up", () => {
    const probe = new VideoCadence(); probe.reset(0);
    probe.record(0, 10); probe.record(1000, 40); probe.record(2000, 70);
    expect(probe.snapshot(2000)).toMatchObject({ presentedFps: 30, callbackFps: 1, callbacks: 3 });
    probe.reset(3000);
    expect(probe.snapshot(4000)).toMatchObject({ measurementId: 2, callbacks: 0, presentedFps: null, durationMs: 1000 });
  });
  it("expires stale samples and restarts on frame counter discontinuity", () => {
    const probe = new VideoCadence(); probe.reset(0);
    probe.record(0, 100); probe.record(1000, 130); probe.record(2000, 1);
    expect(probe.snapshot(2000).presentedFps).toBeNull();
    probe.record(3000, 16);
    expect(probe.snapshot(3000).presentedFps).toBe(15);
    expect(probe.snapshot(14000).presentedFps).toBeNull();
  });
});
