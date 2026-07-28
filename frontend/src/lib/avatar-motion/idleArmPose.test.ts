import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { buildIdleArmPose, idleWorldDirection, IDLE_ARM_ANGLES } from "./idleArmPose";
import type { NormalizedAvatarRigProfile } from "./normalizedRigProfile";
import { multiplyQuaternions } from "./motionMath";

const identity = { x: 0, y: 0, z: 0, w: 1 };
const zero = { x: 0, y: 0, z: 0 };
const basis = (primary: number) => ({
  primaryLocal: { x: primary, y: 0, z: 0 }, secondaryLocal: { x: 0, y: 1, z: 0 }, binormalLocal: { x: 0, y: 0, z: primary },
  primaryWorld: { x: primary, y: 0, z: 0 }, secondaryWorld: { x: 0, y: 1, z: 0 }, binormalWorld: { x: 0, y: 0, z: primary },
  worldRotation: identity,
});
const joint = (primary: number, parent: "fixed-rest" | "controlled", controlledParent: string | null) => ({
  parentJoint: "p", childJoint: "c", parentMode: parent, controlledParentJoint: controlledParent,
  restLocalPosition: zero, restLocalRotation: identity, restWorldPosition: zero, restWorldRotation: identity,
  parentRestWorldRotation: identity, restWorldDirection: { x: primary, y: 0, z: 0 }, anatomicalRestBasis: basis(primary),
});
// T-pose: cánh tay trái duỗi theo +X, cánh tay phải theo -X.
const profile = {
  version: 1, modelGeneration: 1, modelFingerprint: "test",
  torsoReference: { rightWorld: { x: 1, y: 0, z: 0 }, upWorld: { x: 0, y: 1, z: 0 }, forwardWorld: { x: 0, y: 0, z: 1 }, worldRotation: identity },
  joints: {
    leftUpperArm: joint(1, "fixed-rest", null), leftLowerArm: joint(1, "controlled", "leftUpperArm"),
    rightUpperArm: joint(-1, "fixed-rest", null), rightLowerArm: joint(-1, "controlled", "rightUpperArm"),
  },
} as unknown as NormalizedAvatarRigProfile;

const angleToDownDegrees = (direction: Vector3) => direction.angleTo(new Vector3(0, -1, 0)) * 180 / Math.PI;

describe("buildIdleArmPose", () => {
  it("lowers both arms far from the T-pose rest direction", () => {
    for (const side of ["left", "right"] as const) {
      const pose = buildIdleArmPose(profile, side);
      const names = side === "left" ? { upper: "leftUpperArm", lower: "leftLowerArm" } as const : { upper: "rightUpperArm", lower: "rightLowerArm" } as const;
      const restDirection = new Vector3(side === "left" ? 1 : -1, 0, 0);
      const upperDirection = idleWorldDirection(profile, names.upper, identity, pose.upper);

      // Cánh tay phải rời xa hướng T-pose đúng bằng góc hạ đã cấu hình.
      expect(upperDirection.angleTo(restDirection) * 180 / Math.PI).toBeCloseTo(IDLE_ARM_ANGLES.upperDownDegrees, 4);
      // Và phải nghiêng về phía dưới, không phải hạ ra sau hay lên trên.
      expect(upperDirection.y).toBeLessThan(0);
      expect(angleToDownDegrees(upperDirection)).toBeLessThan(angleToDownDegrees(restDirection));
    }
  });

  it("keeps the lowered arm beside the body rather than crossing the torso", () => {
    for (const side of ["left", "right"] as const) {
      const pose = buildIdleArmPose(profile, side);
      const names = side === "left" ? "leftUpperArm" as const : "rightUpperArm" as const;
      const direction = idleWorldDirection(profile, names, identity, pose.upper);
      // Tay trái phải ở nửa +X, tay phải ở nửa -X; đổi dấu nghĩa là tay vắt chéo qua thân.
      if (side === "left") expect(direction.x).toBeGreaterThan(0); else expect(direction.x).toBeLessThan(0);
    }
  });

  it("chains the forearm through the rotated upper arm", () => {
    const pose = buildIdleArmPose(profile, "left");
    const upperJoint = profile.joints.leftUpperArm;
    const upperTargetWorld = multiplyQuaternions(upperJoint.parentRestWorldRotation, multiplyQuaternions(upperJoint.restLocalRotation, pose.upper));
    const upperDirection = idleWorldDirection(profile, "leftUpperArm", identity, pose.upper);
    const lowerDirection = idleWorldDirection(profile, "leftLowerArm", upperTargetWorld, pose.lower);
    // armsDown: cẳng tay thẳng hàng với cánh tay trên (0° gập thêm), nên hướng phải trùng nhau.
    expect(lowerDirection.angleTo(upperDirection) * 180 / Math.PI).toBeCloseTo(IDLE_ARM_ANGLES.lowerDownDegrees, 4);
    expect(angleToDownDegrees(lowerDirection)).toBeLessThanOrEqual(90);
  });

  it("returns identity when the rest direction is already vertical", () => {
    const vertical = structuredClone(profile);
    vertical.joints.leftUpperArm.restWorldDirection = { x: 0, y: -1, z: 0 };
    const pose = buildIdleArmPose(vertical, "left");
    expect(new Quaternion(pose.upper.x, pose.upper.y, pose.upper.z, pose.upper.w).angleTo(new Quaternion())).toBeCloseTo(0, 6);
  });
});
