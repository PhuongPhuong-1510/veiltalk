import { describe, expect, it } from "vitest";
import { Object3D, Quaternion, Vector3 } from "three";
import { faceSetupWavePalm } from "./setupWavePalm";

describe("setup wave palm correction", () => {
  it("turns the palm toward the thumbnail camera around the forearm axis", () => {
    const root = new Object3D();
    const lowerArm = new Object3D();
    const hand = new Object3D();
    root.add(lowerArm);
    lowerArm.add(hand);
    hand.position.set(0, 1, 0);
    root.updateMatrixWorld(true);

    expect(faceSetupWavePalm(hand, lowerArm, { x: 1, y: 0, z: 0 }, new Vector3(0, 1, 5))).toBe(true);
    root.updateMatrixWorld(true);

    const palmWorld = new Vector3(1, 0, 0)
      .applyQuaternion(hand.getWorldQuaternion(new Quaternion()))
      .normalize();
    expect(palmWorld.z).toBeGreaterThan(0.999);
    expect(Math.abs(palmWorld.y)).toBeLessThan(1e-6);
  });

  it("fails closed when the wrist has no usable forearm axis", () => {
    const lowerArm = new Object3D();
    const hand = new Object3D();
    lowerArm.add(hand);
    lowerArm.updateMatrixWorld(true);

    expect(faceSetupWavePalm(hand, lowerArm, { x: 1, y: 0, z: 0 }, new Vector3(0, 0, 5))).toBe(false);
  });
});
