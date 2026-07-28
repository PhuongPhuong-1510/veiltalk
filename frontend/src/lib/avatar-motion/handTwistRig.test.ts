import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { computeHandForearmTwist } from "./handForearmTwist";
import { composePoseLowerArmWithHandTwist, HAND_TWIST_RIG_CONVENTION_V1, handWorldBasisToMotionFrame, normalizePalmBasisForTwist } from "./handTwistRig";

const basis = (normal: { x: number; y: number; z: number }) => ({
  across: { x: 0, y: 1, z: 0 }, forward: { x: 0, y: 0, z: 1 }, normal,
});

describe("Hand twist rig convention v1", () => {
  it("converts the complete raw Hand world basis before negating left normal exactly once", () => {
    const raw = {
      across: { x: 1, y: 0, z: 0 },
      forward: { x: 0, y: 1, z: 0 },
      normal: { x: 0, y: 0, z: 1 },
    };
    const converted = handWorldBasisToMotionFrame(raw);
    const right = normalizePalmBasisForTwist("right", raw);
    const left = normalizePalmBasisForTwist("left", raw);
    expect(converted).toEqual({
      across: { x: 1, y: -0, z: -0 },
      forward: { x: 0, y: -1, z: -0 },
      normal: { x: 0, y: -0, z: -1 },
    });
    expect(right.basis).toEqual(converted);
    expect(right.chiralityCorrectionApplied).toBe(false);
    expect(left.basis.across).toEqual(converted.across);
    expect(left.basis.forward).toEqual(converted.forward);
    expect(left.basis.normal).toEqual({ x: -0, y: 0, z: 1 });
    expect(left.chiralityCorrectionApplied).toBe(true);
    expect(HAND_TWIST_RIG_CONVENTION_V1.configuredPositiveSign).toEqual({ left: 1, right: 1 });
    expect(HAND_TWIST_RIG_CONVENTION_V1.rigApplicationSign).toEqual({ left: 1, right: -1 });

    const across = new Vector3(converted.across.x, converted.across.y, converted.across.z);
    const forward = new Vector3(converted.forward.x, converted.forward.y, converted.forward.z);
    const normal = new Vector3(converted.normal.x, converted.normal.y, converted.normal.z);
    expect(across.length()).toBeCloseTo(1, 7);
    expect(forward.length()).toBeCloseTo(1, 7);
    expect(normal.length()).toBeCloseTo(1, 7);
    expect(across.dot(forward)).toBeCloseTo(0, 7);
    expect(across.dot(normal)).toBeCloseTo(0, 7);
    expect(forward.dot(normal)).toBeCloseTo(0, 7);
    expect(across.clone().cross(forward).distanceTo(normal)).toBeLessThan(1e-7);
  });

  it("maps raw physical neutral/±45° consistently for left/right without double-negating", () => {
    const rawNormalForPhysicalAngle = (side: "left" | "right", angle: number) => {
      const physical = new Vector3(0, Math.cos(angle), Math.sin(angle));
      if (side === "left") physical.negate();
      return { x: physical.x, y: -physical.y, z: -physical.z };
    };
    const solve = (side: "left" | "right", angle: number) => computeHandForearmTwist({
      side, forearmAxis: { x: 1, y: 0, z: 0 }, palmBasis: normalizePalmBasisForTwist(side, basis(rawNormalForPhysicalAngle(side, angle))).basis, palmBasisQuality: 1,
      palmDirectionAxis: HAND_TWIST_RIG_CONVENTION_V1.selectedPalmAxis,
      referenceDirection: { x: 0, y: 1, z: 0 },
      positiveSign: HAND_TWIST_RIG_CONVENTION_V1.configuredPositiveSign[side],
    });
    for (const angle of [0, Math.PI / 4, -Math.PI / 4]) {
      const right = solve("right", angle);
      const left = solve("left", angle);
      expect(right.twistRadians).toBeCloseTo(angle, 7);
      expect(left.twistRadians).toBeCloseTo(angle, 7);
    }
  });

  it("composes poseDelta * twist and preserves the posed primary direction", () => {
    const axis = new Vector3(1, 0, 0);
    const pose = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.7);
    const output = composePoseLowerArmWithHandTwist(
      { x: pose.x, y: pose.y, z: pose.z, w: pose.w }, { x: 1, y: 0, z: 0 }, 0.8,
    )!;
    const expected = pose.clone().multiply(new Quaternion().setFromAxisAngle(axis, 0.8));
    expect(Math.abs(output.x * expected.x + output.y * expected.y + output.z * expected.z + output.w * expected.w)).toBeCloseTo(1, 7);
    const posedPrimary = axis.clone().applyQuaternion(pose);
    const outputPrimary = axis.clone().applyQuaternion(new Quaternion(output.x, output.y, output.z, output.w));
    expect(outputPrimary.distanceTo(posedPrimary)).toBeLessThan(1e-7);
  });

  it("rejects non-finite angle instead of producing NaN/Infinity", () => {
    expect(composePoseLowerArmWithHandTwist({ x: 0, y: 0, z: 0, w: 1 }, { x: 1, y: 0, z: 0 }, NaN)).toBeNull();
    expect(composePoseLowerArmWithHandTwist({ x: 0, y: 0, z: 0, w: 1 }, { x: 1, y: 0, z: 0 }, Infinity)).toBeNull();
  });
});
