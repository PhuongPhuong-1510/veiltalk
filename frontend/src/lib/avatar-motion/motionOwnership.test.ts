import { describe, expect, it } from "vitest";
import { processorOwnsJointTemporal, rendererClearanceMask } from "./motionOwnership";
import type { AvatarMotionOwnershipV1 } from "./avatarPoseTypes";

describe("final arm correction policy", () => {
  const ownership: AvatarMotionOwnershipV1 = { version: 1, armTemporal: "legacy-renderer", contactArms: { left: true, right: false } };
  it("contact owns its chain while the other arm retains clearance", () => {
    expect(rendererClearanceMask("SEW", ownership, "left")).toBe("---");
    expect(rendererClearanceMask("SEW", ownership, "right")).toBe("SEW");
    expect(processorOwnsJointTemporal(ownership, "leftUpperArm")).toBe(true);
    expect(processorOwnsJointTemporal(ownership, "rightLowerArm")).toBe(false);
    expect(processorOwnsJointTemporal(ownership, "leftIndexProximal")).toBe(false);
  });
  it("old packets preserve baseline and opting out restores ordinary clearance", () => {
    expect(rendererClearanceMask("SEW", undefined, "left")).toBe("SEW");
    expect(processorOwnsJointTemporal(undefined, "leftHand")).toBe(false);
    expect(rendererClearanceMask("SEW", { ...ownership, contactArms: { left: false, right: false } }, "left")).toBe("SEW");
  });
});
