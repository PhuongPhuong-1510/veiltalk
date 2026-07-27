import { describe, expect, it } from "vitest";
import { normalizeQuaternion, quaternionFromRotationMatrix, quaternionFromUnitVectors, subtract } from "./coordinateAdapter";

describe("coordinate adapter", () => {
  it("converts MediaPipe down-positive Y into avatar up-positive Y", () => {
    const value = subtract({ x: 1, y: .2, z: .3, visibility: null }, { x: 0, y: .5, z: .1, visibility: null });
    expect(value.x).toBe(1); expect(value.y).toBeCloseTo(.3); expect(value.z).toBeCloseTo(-.2);
  });
  it("returns a finite normalized quaternion and rejects zero vectors", () => {
    const rotation = quaternionFromUnitVectors({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 });
    expect(rotation).not.toBeNull(); expect(Math.hypot(rotation!.x, rotation!.y, rotation!.z, rotation!.w)).toBeCloseTo(1);
    expect(quaternionFromUnitVectors({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBeNull();
    expect(normalizeQuaternion({ x: Number.NaN, y: 0, z: 0, w: 1 })).toBeNull();
  });
  it("extracts identity from a facial transform", () => {
    expect(quaternionFromRotationMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])).toEqual({ x: 0, y: -0, z: -0, w: 1 });
  });
});
