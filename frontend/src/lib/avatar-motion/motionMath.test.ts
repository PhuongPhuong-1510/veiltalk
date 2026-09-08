import { describe, expect, it } from "vitest";
import { quaternionFromBasis } from "./motionMath";

describe("motion math basis", () => {
  it("creates a finite quaternion from a right-handed orthogonal basis", () => {
    const value = quaternionFromBasis(
      { x: 1, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
    );
    expect(value).toEqual({ x: 0, y: 0, z: 0, w: 1 });
  });

  it("rejects non-finite, zero and collinear basis evidence", () => {
    expect(quaternionFromBasis(
      { x: Number.NaN, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
    )).toBeNull();
    expect(quaternionFromBasis(
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 1, z: 0 },
      { x: 0, y: 0, z: 1 },
    )).toBeNull();
    expect(quaternionFromBasis(
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    )).toBeNull();
  });
});
