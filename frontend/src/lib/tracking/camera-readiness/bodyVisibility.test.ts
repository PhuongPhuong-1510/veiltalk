import { describe, expect, it } from "vitest";
import { calculateBodyVisibility, DEFAULT_BODY_VISIBILITY_CONFIG } from "./bodyVisibility";
import { createReadinessFixture } from "./readinessFixtures";
import { extractReadinessEvidence, POSE_LANDMARK_INDEX } from "./readinessEvidence";

const evaluate = (name: Parameters<typeof createReadinessFixture>[0]) =>
  calculateBodyVisibility(extractReadinessEvidence(createReadinessFixture(name), 1050));

describe("body visibility", () => {
  it("locks the approved proposal weights to 100 and scores a centered body at 100", () => {
    expect(Object.values(DEFAULT_BODY_VISIBILITY_CONFIG.weights).reduce((sum, value) => sum + value, 0)).toBe(100);
    const result = evaluate("centered");
    expect(result.bodyVisiblePercent).toBe(100);
    expect(result.leftArmComplete).toBe(true);
    expect(result.rightArmComplete).toBe(true);
  });

  it("distinguishes unavailable from an evaluated zero", () => {
    expect(evaluate("pose-lost").bodyVisiblePercent).toBeNull();
    const frame = createReadinessFixture("centered");
    for (const landmark of frame.pose.landmarks ?? []) landmark.visibility = 0;
    expect(calculateBodyVisibility(extractReadinessEvidence(frame, 1050)).bodyVisiblePercent).toBe(0);
  });

  it("removes exactly the left wrist weight when it is outside", () => {
    const result = evaluate("left-wrist-outside");
    expect(result.bodyVisiblePercent).toBeCloseTo(82.5, 5);
    expect(result.leftArmComplete).toBe(false);
    expect(result.rightArmComplete).toBe(true);
  });

  it("does not score hips or Hand candidates", () => {
    const baseline = createReadinessFixture("centered");
    const changed = structuredClone(baseline);
    changed.pose.landmarks![POSE_LANDMARK_INDEX.leftHip].visibility = 0;
    changed.pose.landmarks![POSE_LANDMARK_INDEX.rightHip].visibility = 0;
    changed.rawHands = [{ sourceIndex: 0, sampledAtMs: 1000, handedness: "left", handednessScore: 1, landmarks: [], worldLandmarks: [] }];
    const score = (frame: typeof baseline) => calculateBodyVisibility(extractReadinessEvidence(frame, 1050)).bodyVisiblePercent;
    expect(score(changed)).toBe(score(baseline));
  });

  it("uses a continuous monotonic visibility curve", () => {
    const values = [0.5, 0.6, 0.7, 0.8].map((visibility) => {
      const frame = createReadinessFixture("centered");
      frame.pose.landmarks![POSE_LANDMARK_INDEX.leftWrist].visibility = visibility;
      return calculateBodyVisibility(extractReadinessEvidence(frame, 1050)).bodyVisiblePercent!;
    });
    expect(values).toEqual([...values].sort((left, right) => left - right));
    expect(new Set(values).size).toBe(values.length);
  });

  it("applies the near-edge factor without producing invalid numbers", () => {
    const frame = createReadinessFixture("centered");
    frame.pose.landmarks![POSE_LANDMARK_INDEX.rightWrist].x = 0.02;
    const result = calculateBodyVisibility(extractReadinessEvidence(frame, 1050));
    expect(result.bodyVisiblePercent).toBeCloseTo(91.25, 5);
    expect(Number.isFinite(result.bodyVisiblePercent)).toBe(true);
  });

  it("treats unknown visibility conservatively and explains it", () => {
    const frame = createReadinessFixture("centered");
    frame.pose.landmarks![POSE_LANDMARK_INDEX.leftElbow].visibility = null;
    const result = calculateBodyVisibility(extractReadinessEvidence(frame, 1050));
    expect(result.bodyVisiblePercent).toBeCloseTo(87.5, 5);
    expect(result.reasons).toContain("unknown-visibility");
  });
});
