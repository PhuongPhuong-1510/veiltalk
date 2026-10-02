import { describe, expect, it } from "vitest";
import { HandLandmarkConditioner } from "./handLandmarkConditioning";
import type { RawHandCandidateV1 } from "../tracking/rawTrackingTypes";

const sample = (at: number, x = 0, y = 0): RawHandCandidateV1 => {
  const landmarks = Array.from({ length: 21 }, (_, i) => ({ x: x + i * .01, y: y + i * .02, z: i * .001, visibility: 1 }));
  return { sourceIndex: 0, handedness: "left", handednessScore: .9, sampledAtMs: at, landmarks, worldLandmarks: structuredClone(landmarks) };
};

describe("wrist-relative conditioning", () => {
  it("follows wrist translation immediately without mutating raw observations", () => {
    const conditioner = new HandLandmarkConditioner();
    conditioner.condition(sample(0), 1280, 720);
    const input = sample(33, .3, .2), before = structuredClone(input);
    const result = conditioner.condition(input, 1280, 720);
    expect(result.landmarks[0]).toEqual(input.landmarks[0]);
    result.landmarks.forEach((p, i) => {
      expect(p.x).toBeCloseTo(input.landmarks[i].x, 10);
      expect(p.y).toBeCloseTo(input.landmarks[i].y, 10);
    });
    expect(input).toEqual(before);
  });
  it("reduces shape jitter without advancing on duplicate samples", () => {
    const conditioner = new HandLandmarkConditioner();
    const first = sample(0); conditioner.condition(first, 1280, 720);
    const noisy = sample(33); noisy.landmarks[8].y += .02;
    const filtered = conditioner.condition(noisy, 1280, 720);
    expect(filtered.landmarks[8].y).toBeGreaterThan(first.landmarks[8].y);
    expect(filtered.landmarks[8].y).toBeLessThan(noisy.landmarks[8].y);
    expect(conditioner.condition(noisy, 1280, 720)).toBe(filtered);
  });
  it("resets on long gaps and rejects incomplete/nonfinite geometry", () => {
    const conditioner = new HandLandmarkConditioner(); conditioner.condition(sample(0), 1280, 720);
    const reacquired = sample(800, .3); expect(conditioner.condition(reacquired, 1280, 720)).toEqual(reacquired);
    const invalid = sample(833); invalid.landmarks[5].x = NaN;
    expect(conditioner.condition(invalid, 1280, 720)).toBe(invalid);
  });
});
