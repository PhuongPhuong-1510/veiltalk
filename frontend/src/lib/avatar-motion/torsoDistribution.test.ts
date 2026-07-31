import { describe, expect, it } from "vitest";
import type { TorsoShoulderRigCapability } from "./normalizedRigProfile";
import { angularDeltaDegrees, inverseQuaternion, multiplyQuaternions } from "./motionMath";
import { distributeTorsoRotation } from "./torsoDistribution";

const identity = { x: 0, y: 0, z: 0, w: 1 };
function capability(): TorsoShoulderRigCapability {
  const available = (parentSemantic: "hips" | "spine" | null) => ({ available: true, parentSemantic, restLocalRotation: identity, restWorldRotation: identity, parentRestWorldRotation: identity });
  const missing = { available: false, parentSemantic: null, restLocalRotation: null, restWorldRotation: null, parentRestWorldRotation: null };
  return { mode: "without-upper-chest", bones: { hips: available(null), spine: available("hips"), chest: available("spine"), upperChest: missing, leftShoulder: missing, rightShoulder: missing }, shoulderStatus: { left: "missing", right: "missing" }, futureUpperArmControlledParent: { left: null, right: null } };
}

describe("torso distribution", () => {
  it("distributes across the available chain and recomposes the exact total", () => {
    const rig = capability(); const result = distributeTorsoRotation({ yaw: 24, pitch: -8, roll: 6 }, rig);
    expect(result.activeBones).toEqual(["hips", "spine", "chest"]);
    expect(Math.max(...Object.values(result.shares.yaw))).toBeLessThan(1);
    let parentWorld = identity;
    for (const name of result.activeBones) {
      parentWorld = multiplyQuaternions(parentWorld, multiplyQuaternions(rig.bones[name].restLocalRotation!, result.deltas[name]!));
      expect(angularDeltaDegrees(parentWorld, result.targetWorldRotations[name]!)).toBeLessThan(1e-5);
    }
    const last = result.activeBones.at(-1)!;
    expect(angularDeltaDegrees(multiplyQuaternions(result.targetWorldRotations[last]!, inverseQuaternion(rig.bones[last].restWorldRotation!)), result.total)).toBeLessThan(1e-5);
  });
});
