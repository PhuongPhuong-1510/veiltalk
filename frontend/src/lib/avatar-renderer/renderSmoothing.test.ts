import { describe, expect, it } from "vitest";
import { dampScalar, slerpQuaternion } from "./renderSmoothing";

describe("render smoothing", () => {
  it("moves toward the latest target without overshoot", () => { const value = dampScalar(0, 1, 18, 1 / 60); expect(value).toBeGreaterThan(0); expect(value).toBeLessThan(1); });
  it("corrects quaternion hemisphere and keeps the result normalized", () => {
    const value = slerpQuaternion({ x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: 0, z: 0, w: -1 }, .5);
    expect(Math.hypot(value.x, value.y, value.z, value.w)).toBeCloseTo(1); expect(Math.abs(value.w)).toBeCloseTo(1);
  });
});

