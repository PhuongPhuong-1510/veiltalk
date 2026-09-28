import { describe, expect, it } from "vitest";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import { computeFingerContactFeatures } from "./fingerContactFeatures";

const point = (x: number, y = 0, z = 0): RawNormalizedLandmarkV1 => ({ x, y, z } as RawNormalizedLandmarkV1);

function hand(scale = 1): RawNormalizedLandmarkV1[] {
  const points = Array.from({ length: 21 }, () => point(0, 0, 0));
  // Palm width = 1 * scale.
  points[5] = point(0 * scale, 0, 0);
  points[17] = point(1 * scale, 0, 0);
  points[4] = point(0.20 * scale, 0, 0); // thumb tip
  points[8] = point(0.22 * scale, 0, 0); // index tip: contact
  points[12] = point(0.60 * scale, 0, 0);
  points[16] = point(0.75 * scale, 0, 0);
  points[20] = point(0.90 * scale, 0, 0);
  return points;
}

describe("computeFingerContactFeatures", () => {
  it("detects thumb-index contact", () => {
    const result = computeFingerContactFeatures(hand());
    expect(result.valid).toBe(true);
    expect(result.thumbIndex.valid).toBe(true);
    expect(result.thumbIndex.normalizedDistance).toBeCloseTo(0.02, 6);
    expect(result.thumbIndex.proximity).toBeGreaterThan(0.95);
    expect(result.thumbIndex.touching).toBe(true);
  });

  it("is scale invariant because distance is normalized by palm width", () => {
    const small = computeFingerContactFeatures(hand(1));
    const large = computeFingerContactFeatures(hand(3));
    expect(large.thumbIndex.normalizedDistance).toBeCloseTo(small.thumbIndex.normalizedDistance, 6);
    expect(large.thumbIndex.proximity).toBeCloseTo(small.thumbIndex.proximity, 6);
  });

  it("does not invent contact for far fingertips", () => {
    const points = hand();
    points[8] = point(0.8, 0, 0);
    const result = computeFingerContactFeatures(points);
    expect(result.thumbIndex.proximity).toBe(0);
    expect(result.thumbIndex.touching).toBe(false);
  });
});

it("exposes all regular fingertip pairs for M5 spatial/contact reasoning", () => {
  const result = computeFingerContactFeatures(hand());
  expect(result.pairs["index-middle"].valid).toBe(true);
  expect(result.pairs["middle-ring"].valid).toBe(true);
  expect(result.pairs["ring-little"].valid).toBe(true);
  expect(Number.isFinite(result.pairs["index-middle"].relativeDepth)).toBe(true);
});
