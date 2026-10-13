import { describe, expect, it } from "vitest";
import type { HandLandmarkerResult } from "@mediapipe/tasks-vision";
import { planPoseGuidedHandInput, type HandPoseHint } from "./poseGuidedHandInput";
import { describeHandHint, handRegionCoverage, HandRoiRecovery } from "./handRoiPolicy";
function hint(): HandPoseHint {
  const landmarks = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 1 }));
  landmarks[11].x = .4; landmarks[12].x = .6; landmarks[15].x = .2; landmarks[16].x = .8;
  return { pose: { state: "tracked", sampledAtMs: 100, landmarks, worldLandmarks: null }, width: 1280, height: 720, ageMs: 30 };
}
const hands = (...wrists: number[]) => ({ landmarks: wrists.map(x => [{ x, y: .5, z: 0 }]) } as HandLandmarkerResult);
describe("experimental Hand ROI policy", () => {
  it("uses recent cached geometry only when opted in, without mutating its state or timestamp", () => {
    const input = hint(); input.pose.state = "not-sampled"; const before = structuredClone(input);
    expect(planPoseGuidedHandInput(input)).toBeNull();
    const plan = planPoseGuidedHandInput(input, true);
    expect(plan).not.toBeNull(); expect(input).toEqual(before);
    expect(describeHandHint(input, null)).toBe("cached-disabled");
    expect(describeHandHint(input, plan, true)).toBe("fresh-cached");
  });
  it.each([-1, 121, NaN, Infinity])("rejects invalid/stale age %s even with cached hints enabled", age => {
    const input = hint(); input.ageMs = age; input.pose.state = "not-sampled";
    expect(planPoseGuidedHandInput(input, true)).toBeNull();
  });
  it("rejects lost, unreliable shoulders, and unavailable wrist geometry", () => {
    const input = hint(); input.pose.state = "lost";
    expect(planPoseGuidedHandInput(input, true)).toBeNull(); expect(describeHandHint(input, null, true)).toBe("lost");
    input.pose.state = "tracked"; input.pose.landmarks![11].visibility = .1;
    expect(planPoseGuidedHandInput(input, true)).toBeNull();
    input.pose.landmarks![11].visibility = 1;
    input.pose.landmarks![15].visibility = 0; input.pose.landmarks![16].visibility = 0;
    expect(planPoseGuidedHandInput(input, true)).toBeNull(); expect(describeHandHint(input, null)).toBe("unreliable-geometry");
    expect(describeHandHint(null, null)).toBe("missing");
  });
  it("detects disappearance of one region even while the other hand remains visible", () => {
    const plan = planPoseGuidedHandInput(hint())!, recovery = new HandRoiRecovery();
    recovery.observe(false, plan, ["left", "right"], 100);
    expect(handRegionCoverage(hands(.2), plan)).toEqual(["left"]);
    for (const at of [130, 160]) {
      expect(recovery.reason(plan, at)).toBe("roi");
      recovery.observe(true, plan, handRegionCoverage(hands(.2), plan), at);
    }
    expect(recovery.reason(plan, 190)).toBe("recovery");
    recovery.observe(false, plan, ["left"], 190);
    expect(recovery.reason(plan, 220)).toBe("roi"); // Absent right hand cannot lock full-frame forever.
  });
  it("recovers both missing regions, resets a recovered side, and handles crossing without changing candidates", () => {
    const plan = planPoseGuidedHandInput(hint())!, recovery = new HandRoiRecovery();
    recovery.observe(false, plan, [], 100);
    recovery.observe(true, plan, [], 120);
    recovery.observe(true, plan, ["right"], 140);
    expect(recovery.reason(plan, 160)).toBe("recovery");
    const crossed = hands(.8, .2), before = structuredClone(crossed);
    expect(handRegionCoverage(crossed, plan).sort()).toEqual(["left", "right"]);
    expect(crossed).toEqual(before);
    recovery.observe(false, plan, ["right", "left"], 160);
    expect(recovery.reason(plan, 180)).toBe("roi");
  });
  it("probes periodically by count or time even with apparently complete coverage", () => {
    const plan = planPoseGuidedHandInput(hint())!, recovery = new HandRoiRecovery();
    recovery.observe(false, plan, ["left", "right"], 100);
    for (let i = 1; i <= 8; i++) recovery.observe(true, plan, ["left", "right"], 100 + 10 * i);
    expect(recovery.reason(plan, 190)).toBe("periodic");
    recovery.observe(false, plan, [], 200); expect(recovery.reason(plan, 700)).toBe("periodic");
    recovery.reset(); expect(recovery.reason(plan, 10)).toBe("periodic");
  });
  it("does not treat one ambiguous wrist or two wrists on one side as both regions covered", () => {
    const plan = planPoseGuidedHandInput(hint())!;
    expect(handRegionCoverage(hands(.2, .21), plan)).toEqual(["left"]);
    expect(handRegionCoverage(hands(.5, NaN), plan)).toEqual([]);
  });
});
