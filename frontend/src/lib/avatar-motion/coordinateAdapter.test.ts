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
  it("uses a stable orthogonal axis for an exact 180-degree rotation", () => {
    const rotation = quaternionFromUnitVectors({ x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 });
    expect(rotation).not.toBeNull();
    expect(Math.hypot(rotation!.x, rotation!.y, rotation!.z, rotation!.w)).toBeCloseTo(1);
    expect(rotation!.w).toBeCloseTo(0);
    expect(Math.abs(rotation!.x)).toBeLessThan(1e-8);
  });
  it("extracts identity from a facial transform", () => {
    expect(quaternionFromRotationMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])).toEqual({ x: 0, y: -0, z: -0, w: 1 });
  });
  it("keeps MediaPipe pitch sign while converting Y/Z into the avatar convention", () => {
    const angle = Math.PI / 3;
    const c = Math.cos(angle); const s = Math.sin(angle);
    const rotation = quaternionFromRotationMatrix([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
    expect(rotation).not.toBeNull();
    expect(rotation!.x).toBeCloseTo(Math.sin(angle / 2));
    expect(rotation!.w).toBeCloseTo(Math.cos(angle / 2));
  });
});
