import { describe, expect, it } from "vitest";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { HandBasisResult } from "./handPalmBasis";
import { computeFingerSpatialRelations } from "./fingerSpatialRelations";

const p = (x: number, y = 0, z = 0): RawNormalizedLandmarkV1 => ({ x, y, z } as RawNormalizedLandmarkV1);
const basis = {
  valid: true,
  across: { x: 1, y: 0, z: 0 },
  normal: { x: 0, y: 0, z: 1 },
  forward: { x: 0, y: 1, z: 0 },
} as HandBasisResult;

function fixture(crossed: boolean): RawNormalizedLandmarkV1[] {
  const hand = Array.from({ length: 21 }, () => p(0, 0, 0));
  hand[5] = p(-0.5, 0); hand[9] = p(-0.15, 0); hand[13] = p(0.15, 0); hand[17] = p(0.5, 0);
  hand[8] = p(crossed ? 0.05 : -0.35, 1);
  hand[12] = p(crossed ? -0.25 : -0.05, 1);
  hand[16] = p(0.2, 1); hand[20] = p(0.5, 1);
  return hand;
}

describe("computeFingerSpatialRelations", () => {
  it("detects index-middle order inversion", () => {
    const normal = computeFingerSpatialRelations(fixture(false), basis);
    const crossed = computeFingerSpatialRelations(fixture(true), basis);
    expect(normal.indexMiddle.crossingScore).toBe(0);
    expect(crossed.indexMiddle.crossingScore).toBeGreaterThan(0);
  });
});
