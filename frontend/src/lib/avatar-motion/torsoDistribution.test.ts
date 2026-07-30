import { describe, expect, it } from "vitest";
import type { QuaternionData } from "./avatarPoseTypes";
import type { TorsoShoulderRigCapability } from "./normalizedRigProfile";
import { angularDeltaDegrees, inverseQuaternion, multiplyQuaternions } from "./motionMath";
import { torsoQuaternionFromSemanticEuler } from "./torsoOrientation";
import { distributeTorsoRotation } from "./torsoDistribution";

const identity = { x: 0, y: 0, z: 0, w: 1 };
const rotation = (yaw: number, pitch = 0, roll = 0) => torsoQuaternionFromSemanticEuler({ yaw, pitch, roll });
function capability(names: Array<"hips" | "spine" | "chest" | "upperChest">, rests: Partial<Record<string, QuaternionData>> = {}): TorsoShoulderRigCapability {
  const parent = { hips: null, spine: "hips", chest: "spine", upperChest: "chest" } as const;
  const bones = {} as TorsoShoulderRigCapability["bones"];
  for (const name of ["hips", "spine", "chest", "upperChest", "leftShoulder", "rightShoulder"] as const) {
    const available = names.includes(name as never); const restLocalRotation = available ? rests[name] ?? identity : null;
    const parentRestWorldRotation = available ? (parent[name as keyof typeof parent] ? rests[parent[name as keyof typeof parent]!] ?? identity : identity) : null;
    const restWorldRotation = available ? multiplyQuaternions(parentRestWorldRotation!, restLocalRotation!) : null;
    bones[name] = { available, parentSemantic: name in parent ? parent[name as keyof typeof parent] : null, restLocalRotation, restWorldRotation, parentRestWorldRotation };
  }
  return { mode: names.includes("upperChest") ? "full" : "without-upper-chest", bones, shoulderStatus: { left: "missing", right: "missing" }, futureUpperArmControlledParent: { left: null, right: null } };
}

describe("distributeTorsoRotation", () => {
  it("renormalizes shares and never gives one bone 100% on a multi-bone chain", () => {
    for (const names of [["hips", "spine", "chest", "upperChest"], ["hips", "spine", "chest"]] as const) {
      const result = distributeTorsoRotation({ yaw: 15, pitch: 8, roll: 5 }, capability([...names]));
      expect(result.mode).toBe("distributed");
      for (const axis of Object.values(result.shares)) {
        expect(Object.values(axis).reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 12);
        expect(Math.max(...Object.values(axis))).toBeLessThan(1);
      }
    }
  });

  it("continuously increases lower-torso participation for large motion", () => {
    const rig = capability(["hips", "spine", "chest", "upperChest"]);
    const small = distributeTorsoRotation({ yaw: 3, pitch: 0, roll: 0 }, rig);
    const large = distributeTorsoRotation({ yaw: 45, pitch: 0, roll: 0 }, rig);
    expect(large.shares.yaw.hips).toBeGreaterThan(small.shares.yaw.hips);
    expect(large.shares.yaw.spine).toBeGreaterThan(small.shares.yaw.spine);
    expect(large.progress).toBeGreaterThan(small.progress);
  });

  it("recomposes the exact semantic target with non-identity rest rotations", () => {
    const rig = capability(["hips", "spine", "chest"], { hips: rotation(8), spine: rotation(0, 5), chest: rotation(0, 0, -4) });
    const semantic = { yaw: 22, pitch: -7, roll: 11 }; const result = distributeTorsoRotation(semantic, rig);
    let parentWorld = identity;
    for (const name of result.activeBones) {
      const bone = rig.bones[name];
      const local = multiplyQuaternions(bone.restLocalRotation!, result.deltas[name]!);
      parentWorld = multiplyQuaternions(parentWorld, local);
      expect(angularDeltaDegrees(parentWorld, result.targetWorldRotations[name]!)).toBeLessThan(1e-5);
    }
    const last = result.activeBones.at(-1)!;
    const finalDelta = multiplyQuaternions(result.targetWorldRotations[last]!, inverseQuaternion(rig.bones[last].restWorldRotation!));
    expect(angularDeltaDegrees(finalDelta, result.total)).toBeLessThan(1e-5);
  });

  it("uses an explicit single-bone fallback", () => {
    const result = distributeTorsoRotation({ yaw: 10, pitch: 2, roll: 3 }, capability(["chest"]));
    expect(result.mode).toBe("single-bone-fallback"); expect(result.shares.yaw.chest).toBe(1); expect(result.deltas.chest).toBeDefined();
  });
});
