import { describe, expect, it } from "vitest";
import { JOINT_LIMITS, constrainJointRotation } from "./jointConstraints";

describe("joint constraints", () => {
  it("normalizes and clamps rotations to the configured anatomical limit", () => {
    const constrained = constrainJointRotation("leftHand", { x: 1, y: 0, z: 0, w: 0 })!;
    const angle = 2 * Math.acos(Math.abs(constrained.w)); expect(angle).toBeLessThanOrEqual(JOINT_LIMITS.leftHand!.maxAngleRadians + 1e-8);
    expect(Math.hypot(constrained.x, constrained.y, constrained.z, constrained.w)).toBeCloseTo(1);
  });
});

