import { describe, expect, it } from "vitest";
import { Euler, Vector3 } from "three";
import { CANONICAL_FACE_VERTICES } from "./faceContactTopology";
import { buildHumanFaceContactSurface, faceSurfaceCandidate, locateHumanFaceSurface } from "./humanFaceContactSurface";

function observed(yaw = 0, roll = 0, mirrored = false) {
  return CANONICAL_FACE_VERTICES.map(v => {
    const p = new Vector3(v[0], -v[1], -v[2]).applyEuler(new Euler(0, yaw, roll)).multiplyScalar(.018);
    return { x: .5 + (mirrored ? -p.x : p.x), y: .45 + p.y, z: p.z, visibility: null };
  });
}
describe("face surface correspondence", () => {
  it("keeps anatomical sides under camera roll and mirrored landmark X", () => {
    for (const roll of [0, .65, -.65]) for (const mirrored of [false, true]) {
      const face = observed(0, roll, mirrored), surface = buildHumanFaceContactSurface(face, 1000, 1000)!;
      const candidate = faceSurfaceCandidate(surface, face[205])!;
      expect(candidate.anatomicalLabel).toBe("rightCheek");
      expect(candidate.familyUv!.x).toBeLessThan(0);
    }
  });
  it("uses actual triangle correspondence for forehead and excludes iris data", () => {
    const face = observed();
    const surface = buildHumanFaceContactSurface(face.concat(Array.from({ length: 10 }, () => ({ x: 10, y: -10, z: 10, visibility: null }))), 1000, 1000)!;
    expect(surface.vertices).toHaveLength(468);
    expect(faceSurfaceCandidate(surface, face[10])?.anatomicalLabel).toBe("forehead");
    expect(locateHumanFaceSurface(surface, { x: .01, y: .01 })).toBeNull();
  });
  it("preserves a visible cheek under moderate yaw instead of using a fixed image rectangle",()=>{
    for(const yaw of [-.4,.4]){const face=observed(yaw),surface=buildHumanFaceContactSurface(face,1000,1000)!;
      expect(Math.abs(surface.yawRadians)).toBeGreaterThan(.2);expect(faceSurfaceCandidate(surface,face[205])?.anatomicalLabel).toBe("rightCheek");}
  });
  it("degrades or refuses missing and degenerate face geometry", () => {
    expect(buildHumanFaceContactSurface(observed().slice(0, 20), 1000, 1000)).toBeNull();
    expect(buildHumanFaceContactSurface(observed(), 0, 1000)).toBeNull();
    const points = observed().map(p => ({ ...p, x: .5, y: .5 }));
    expect(buildHumanFaceContactSurface(points, 1000, 1000)).toBeNull();
  });
  it("protects central nose and mouth from palm correction", () => {
    const face = observed(), surface = buildHumanFaceContactSurface(face, 1000, 1000)!;
    expect(faceSurfaceCandidate(surface, face[1])?.correctionEligible).toBe(false);
    expect(faceSurfaceCandidate(surface, face[13])?.correctionEligible).toBe(false);
  });
});
