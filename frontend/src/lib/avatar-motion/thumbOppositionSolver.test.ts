import { describe, expect, it } from "vitest";
import {
  THUMB_SWEEP_LIMIT_RADIANS,
  contactFlexAssist,
  resolveThumbSweepDelta,
  wrapAnglePi,
} from "./thumbOppositionSolver";

const deg = (value: number) => value * Math.PI / 180;

describe("thumb opposition helpers", () => {
  it("wraps across +/- PI using the short direction", () => {
    expect(wrapAnglePi(deg(350))).toBeCloseTo(deg(-10), 6);
    expect(wrapAnglePi(deg(-350))).toBeCloseTo(deg(10), 6);
  });

  it("clamps observed thumb sweep to a safe anatomical range", () => {
    expect(resolveThumbSweepDelta(deg(100), 0)).toBeCloseTo(THUMB_SWEEP_LIMIT_RADIANS, 6);
    expect(resolveThumbSweepDelta(deg(-100), 0)).toBeCloseTo(-THUMB_SWEEP_LIMIT_RADIANS, 6);
  });

  it("keeps contact assist off until fingertips are already near", () => {
    expect(contactFlexAssist(0.2, deg(10))).toBe(0);
    expect(contactFlexAssist(0.45, deg(10))).toBe(0);
    expect(contactFlexAssist(1, deg(10))).toBeCloseTo(deg(10), 6);
  });
});
