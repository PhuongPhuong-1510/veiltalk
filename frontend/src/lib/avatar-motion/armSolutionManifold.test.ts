import { describe, expect, it } from "vitest";
import { buildElbowSolutionCircle, parallelTransportDirection, projectElbowToCircle } from "./armSolutionManifold";

describe("arm solution manifold", () => {
  it("projects the previous elbow onto the new exact circle without changing hemisphere", () => {
    const circle = buildElbowSolutionCircle({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 1, 1)!;
    const result = projectElbowToCircle(circle, { x: .5, y: .8, z: .1 })!;
    const upper = Math.hypot(result.elbow.x, result.elbow.y, result.elbow.z);
    const lower = Math.hypot(1 - result.elbow.x, result.elbow.y, result.elbow.z);
    expect(upper).toBeCloseTo(1, 6); expect(lower).toBeCloseTo(1, 6);
    expect(result.pole.y).toBeGreaterThan(0);
  });

  it("parallel-transports the lower direction with upper motion", () => {
    const result = parallelTransportDirection({ x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })!;
    expect(result.x).toBeCloseTo(-1, 6); expect(result.y).toBeCloseTo(0, 6);
  });
});
