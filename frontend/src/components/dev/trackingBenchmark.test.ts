import { describe, expect, it, vi } from "vitest";
import { BenchmarkSession, getBenchmarkProfile } from "./trackingBenchmark";
import type { TrackingMetricsSnapshot } from "../../lib/tracking/trackingMetrics";

const snapshot = (id: number, duration: number) => ({ measurementId: id, measurementStartedAtMs: 10_000,
  runDurationMs: duration, measurementCounts: { trackingPublish: 1440, avatarApply: 1440 },
  measurementPresentedFps: 30, renderFps: 60 } as TrackingMetricsSnapshot);

describe("B1 benchmark session", () => {
  it("excludes warm-up, requests exactly one boundary reset, ignores old snapshots and retains completion", () => {
    const s = new BenchmarkSession(), reset = vi.fn(() => 7);
    s.start(0); s.tick(9999, reset); expect(reset).not.toHaveBeenCalled();
    s.accept(snapshot(0, 80_000)); expect(s.stage).toBe("warmup");
    s.tick(10_000, reset); s.tick(11_000, reset); expect(reset).toHaveBeenCalledOnce();
    s.accept(snapshot(6, 65_000)); expect(s.stage).toBe("waiting-reset");
    s.accept(snapshot(7, 59_999)); expect(s.stage).toBe("measuring");
    expect(s.result(getBenchmarkProfile("A"), "stationary", {}, "")).toBeNull();
    s.accept(snapshot(7, 60_000)); expect(s.stage).toBe("complete");
    s.accept(snapshot(7, 90_000)); // Subsequent tracking cannot overwrite a finished result.
    const result = s.result(getBenchmarkProfile("A"), "stationary", { avatar: "reference-avatar-2" }, "stable")!;
    expect(result.measuredSeconds).toBe(60);
    expect(result.overallFps.trackingPublish).toBe(24);
    expect(result.overallFps.videoPresented).toBe(30);
    expect(result.overallFps.render).toBeNull(); // No invented whole-run renderer counter.
    expect(result.snapshots).toHaveLength(2);
  });

  it("does not export an interrupted run and starts fresh on retry", () => {
    const s = new BenchmarkSession(); s.start(0); s.tick(10_000, () => 1);
    s.accept(snapshot(1, 20_000)); s.abort("hidden"); s.accept(snapshot(1, 60_000));
    expect(s.result(getBenchmarkProfile("E"), "movement", {}, "")).toBeNull();
    s.start(100_000); expect(s.stage).toBe("warmup"); expect(s.error).toBe("");
  });

  it("invalidates a stalled callback/metrics stream instead of exporting a partial run", () => {
    const s = new BenchmarkSession(); s.start(0); s.tick(10_000, () => 1); s.tick(15_001, () => 2);
    expect(s.stage).toBe("aborted");
    expect(s.result(getBenchmarkProfile("A"), "stationary", {}, "")).toBeNull();
  });

  it("defines isolated task/model variants without changing baseline defaults", () => {
    expect(getBenchmarkProfile("A").tasks).toEqual({ face: true, hands: true, pose: true });
    expect(getBenchmarkProfile("B").tasks).toEqual({ face: true, hands: false, pose: true });
    expect(getBenchmarkProfile("C").tasks).toEqual({ face: true, hands: true, pose: false });
    expect(getBenchmarkProfile("D").tasks).toEqual({ face: true, hands: false, pose: false });
    expect(getBenchmarkProfile("E").tasks).toEqual(getBenchmarkProfile("A").tasks);
    expect(getBenchmarkProfile("A").poseModel).toBe("full");
    expect(getBenchmarkProfile("E").poseModel).toBe("lite");
  });
});
