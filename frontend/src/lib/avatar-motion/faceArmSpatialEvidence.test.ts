import { describe, expect, it } from "vitest";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import { buildFaceArmSpatialEvidence } from "./faceArmSpatialEvidence";

const point = (x: number, y: number): RawNormalizedLandmarkV1 => ({ x, y, z: 0, visibility: null });
const face = [
  point(.4, .35), point(.5, .3), point(.6, .35), point(.62, .5),
  point(.6, .65), point(.5, .7), point(.4, .65), point(.38, .5),
];

describe("face-arm spatial evidence", () => {
  it("reports the real hand side and keeps a separated hand out of contact mode", () => {
    const hand = [point(.8, .5), point(.82, .45), point(.84, .4)];
    const result = buildFaceArmSpatialEvidence(face, hand, 1_000, 1_000)!;
    expect(result.desiredSide).toBe(1);
    expect(result.allowContact).toBe(false);
    expect(result.observedMinimumEllipseDistance).toBeGreaterThan(1);
  });

  it("allows intentional contact when any observed Hand point overlaps the face ellipse", () => {
    const hand = [point(.72, .5), point(.59, .5), point(.8, .4)];
    const result = buildFaceArmSpatialEvidence(face, hand, 1_000, 1_000)!;
    expect(result.allowContact).toBe(true);
  });

  it("rejects invalid video size and insufficient face geometry", () => {
    expect(buildFaceArmSpatialEvidence(face, [point(.8, .5)], 0, 720)).toBeNull();
    expect(buildFaceArmSpatialEvidence(face.slice(0, 4), [point(.8, .5)], 1280, 720)).toBeNull();
  });
});
