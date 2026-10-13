import { describe, expect, it } from "vitest";
import { BoundedPoseScheduler, resolveTrackingExperiments } from "./trackingScheduler";
import type { RawPoseSampleV1 } from "./rawTrackingTypes";
const pose = (sampledAtMs: number, state: RawPoseSampleV1["state"] = "tracked"): RawPoseSampleV1 => ({ state, sampledAtMs, landmarks: [], worldLandmarks: [] });
describe("bounded Pose experimental policy", () => {
  it("defaults all experiments off", () => {
    expect(resolveTrackingExperiments()).toEqual({ version: 1, callbackAhead: false, boundedPose: false, cachedPoseHint: false, handRoiRecovery: false });
  });
  it("samples at startup and never skips two consecutive processed frames", () => {
    const scheduler = new BoundedPoseScheduler();
    expect(scheduler.shouldSample(100)).toBe(true);
    expect(scheduler.shouldSample(130, pose(100))).toBe(false);
    expect(scheduler.shouldSample(160, pose(100, "not-sampled"))).toBe(true);
  });
  it.each(["lost", "not-sampled"] as const)("forces reacquisition for %s", state => {
    expect(new BoundedPoseScheduler().shouldSample(110, pose(100, state))).toBe(true);
  });
  it("includes predicted completion age and backs off skipping under overload", () => {
    const scheduler = new BoundedPoseScheduler();
    expect(scheduler.shouldSample(150, pose(100))).toBe(true); // 50 + 75 > 120
    scheduler.observeCompletion(140);
    expect(scheduler.shouldSample(210, pose(200))).toBe(true);
    scheduler.reset();
    expect(scheduler.shouldSample(230, pose(200))).toBe(false);
  });
  it("forces Pose if capture/Face already exceeded the age budget in the current frame", () => {
    expect(new BoundedPoseScheduler().shouldSample(130, pose(100), 100)).toBe(true);
  });
  it.each([-1, 100, 500, NaN])("rejects negative/stale/invalid ages %s", age => {
    expect(new BoundedPoseScheduler().shouldSample(100 + age, pose(100))).toBe(true);
  });
});
