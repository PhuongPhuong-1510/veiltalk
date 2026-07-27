import { describe, expect, it } from "vitest";
import { buildTorsoBasis } from "./torsoBasis";

const point = (x: number, y: number, z = 0, visibility = 1) => ({ x, y, z, visibility });
describe("torso reference basis", () => {
  it("builds a finite right-handed orthonormal basis", () => {
    const landmarks = Array.from({ length: 33 }, () => point(0, 0));
    landmarks[11] = point(.2, 0); landmarks[12] = point(-.2, 0); landmarks[23] = point(.15, .6); landmarks[24] = point(-.15, .6);
    const basis = buildTorsoBasis(landmarks)!;
    const dot = (a: typeof basis.right, b: typeof basis.right) => a.x * b.x + a.y * b.y + a.z * b.z;
    expect(Math.abs(dot(basis.right, basis.up))).toBeLessThan(1e-6); expect(Math.abs(dot(basis.right, basis.forward))).toBeLessThan(1e-6);
    expect(basis.right.x).toBeCloseTo(1); expect(basis.up.y).toBeCloseTo(1); expect(basis.forward.z).toBeCloseTo(1);
  });
  it("rejects low-confidence and degenerate landmarks", () => {
    const landmarks = Array.from({ length: 33 }, () => point(0, 0)); landmarks[11] = point(.2, 0, 0, .1); landmarks[12] = point(-.2, 0); landmarks[23] = point(.1, .5); landmarks[24] = point(-.1, .5);
    expect(buildTorsoBasis(landmarks)).toBeNull(); landmarks[11].visibility = 1; landmarks[23] = point(0, 0); landmarks[24] = point(0, 0); expect(buildTorsoBasis(landmarks)).toBeNull();
  });
});
