import { describe, expect, it } from "vitest";
import { JOINT_LIMITS, constrainJointRotation } from "./jointConstraints";

describe("joint constraints", () => {
  it("limits equivalent quaternion hemispheres to the same rotation", () => {
    const angle = 2.9, q = { x: 0, y: Math.sin(angle/2), z: 0, w: Math.cos(angle/2) };
    expect(constrainJointRotation("leftLowerArm", q)).toEqual(constrainJointRotation("leftLowerArm", { x: -q.x, y: -q.y, z: -q.z, w: -q.w }));
    const positive=constrainJointRotation("leftLowerArm", {x:1,y:0,z:0,w:0})!,negative=constrainJointRotation("leftLowerArm", {x:-1,y:0,z:0,w:0})!;
    for(const key of ["x","y","z","w"] as const)expect(positive[key]).toBeCloseTo(negative[key],12);
  });
  it("keeps the previous capped branch through antipodal measurement jitter", () => {
    const prior=constrainJointRotation("leftUpperArm",{x:0,y:0,z:1,w:0})!;
    const noisy=constrainJointRotation("leftUpperArm",{x:0,y:0,z:1,w:-.003},prior)!;
    expect(noisy.z).toBeGreaterThan(0);
    expect(noisy.w).toBeCloseTo(prior.w,8);
  });
  it("normalizes and clamps rotations to the configured anatomical limit", () => {
    const constrained = constrainJointRotation("leftHand", { x: 1, y: 0, z: 0, w: 0 })!;
    const angle = 2 * Math.acos(Math.abs(constrained.w)); expect(angle).toBeLessThanOrEqual(JOINT_LIMITS.leftHand!.maxAngleRadians + 1e-8);
    expect(Math.hypot(constrained.x, constrained.y, constrained.z, constrained.w)).toBeCloseTo(1);
  });
});

