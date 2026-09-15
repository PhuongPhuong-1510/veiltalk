import { describe, expect, it } from "vitest";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import { computeMouthLandmarkGeometry } from "./mouthLandmarkGeometry";

const point = (x: number, y: number): RawNormalizedLandmarkV1 => ({ x, y, z: 0, visibility: null });
const face = (gap: number, roll = 0): RawNormalizedLandmarkV1[] => {
  const values = Array.from({ length: 478 }, () => point(.5, .5));
  const cosine = Math.cos(roll), sine = Math.sin(roll);
  const rotate = (x: number, y: number) => point(.5 + x * cosine - y * sine, .5 + x * sine + y * cosine);
  values[61] = rotate(-.1, 0);
  values[291] = rotate(.1, 0);
  values[13] = rotate(0, -gap / 2);
  values[14] = rotate(0, gap / 2);
  return values;
};
const range = { onset: .02, full: .32 };

describe("mouth landmark geometry", () => {
  it("normalizes inner-lip aperture by mouth width", () => {
    const result = computeMouthLandmarkGeometry(face(.04), 100, 100, range);
    expect(result.valid).toBe(true);
    expect(result.apertureRatio).toBeCloseTo(.2);
    expect(result.jawOpen).toBeGreaterThan(.4);
  });

  it("is invariant to in-plane head roll", () => {
    const level = computeMouthLandmarkGeometry(face(.04), 100, 100, range);
    const rolled = computeMouthLandmarkGeometry(face(.04, Math.PI / 5), 100, 100, range);
    expect(rolled.apertureRatio).toBeCloseTo(level.apertureRatio, 10);
    expect(rolled.jawOpen).toBeCloseTo(level.jawOpen, 10);
  });

  it("does not treat closed lips as an opening and rejects incomplete geometry", () => {
    expect(computeMouthLandmarkGeometry(face(0), 1280, 720, range)).toMatchObject({ valid: true, apertureRatio: 0, jawOpen: 0 });
    expect(computeMouthLandmarkGeometry(face(.04).slice(0, 100), 1280, 720, range)).toMatchObject({ valid: false, jawOpen: 0 });
  });

  it("uses actual video aspect when comparing horizontal width and vertical gap", () => {
    const square = computeMouthLandmarkGeometry(face(.04), 100, 100, range);
    const wide = computeMouthLandmarkGeometry(face(.04), 200, 100, range);
    expect(wide.apertureRatio).toBeCloseTo(square.apertureRatio / 2);
  });
});
