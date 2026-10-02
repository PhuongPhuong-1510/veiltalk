import { Vector3 } from "three";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { ContactPoint2, ContactPoint3, HumanAnatomicalLabel, HumanBodyRegionCandidate } from "./bodyContactTypes";
import { CANONICAL_FACE_TRIANGLES, CANONICAL_FACE_VERTICES } from "./faceContactTopology";

export interface HumanFaceContactSurface {
  vertices: Array<ContactPoint3 | null>;
  faceHeight: number;
  center: ContactPoint2;
  yawRadians: number;
  rollRadians: number;
  quality: number;
  source: "canonical-correspondence-relative-face";
}
export interface FaceSurfaceLocation {
  triangle: number;
  barycentric: readonly [number, number, number];
  uv: ContactPoint2;
  point: ContactPoint3;
  normal: ContactPoint3;
  projectedDistance: number;
  quality: number;
  protectedRegion: "eye" | "mouth" | null;
}
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const canonicalUv = (p: readonly number[]): ContactPoint2 => ({ x: p[0] / 7.75, y: -(p[1] + .5708) / 8.8326 });
const finite = (p: RawNormalizedLandmarkV1 | undefined) => p && [p.x, p.y, p.z].every(Number.isFinite);

/** Uses correspondence and relative face shape only, never mixes normalized face z with Hand/Pose. */
export function buildHumanFaceContactSurface(landmarks: readonly RawNormalizedLandmarkV1[] | null | undefined, width: number, height: number): HumanFaceContactSurface | null {
  if (!landmarks || landmarks.length < 468 || !(width > 0 && height > 0)||![width,height].every(Number.isFinite)) return null;
  const aspect = height / width;
  const vertices = landmarks.slice(0, 468).map(p => finite(p) ? { x: p.x, y: p.y * aspect, z: p.z } : null);
  const top = vertices[10], chin = vertices[152], a = vertices[33], b = vertices[263];
  if (!top || !chin || !a || !b) return null;
  const faceHeight = Math.hypot(top.x - chin.x, top.y - chin.y);
  const eyeWidth = Math.hypot(a.x - b.x, a.y - b.y);
  if (faceHeight < .025 || eyeWidth < .008) return null;
  const validFraction = vertices.filter(Boolean).length / 468;
  const yawRadians = Math.atan2(b.z - a.z, eyeWidth);
  const rollRadians = Math.atan2(b.y - a.y, b.x - a.x);
  // Shape validity is not a per-landmark visibility probability.
  const quality = clamp01(validFraction * Math.min(1, eyeWidth / (faceHeight * .22)));
  return { vertices, faceHeight, center: { x: (top.x + chin.x) / 2, y: (top.y + chin.y) / 2 }, yawRadians, rollRadians, quality, source: "canonical-correspondence-relative-face" };
}

function projectedBarycentric(p: ContactPoint2, a: ContactPoint3, b: ContactPoint3, c: ContactPoint3): readonly [number, number, number] | null {
  const den = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(den) < 1e-10) return null;
  const u = ((b.y - c.y) * (p.x - c.x) + (c.x - b.x) * (p.y - c.y)) / den;
  const v = ((c.y - a.y) * (p.x - c.x) + (a.x - c.x) * (p.y - c.y)) / den;
  if (u >= -1e-6 && v >= -1e-6 && u + v <= 1.000001) return [Math.max(0, u), Math.max(0, v), Math.max(0, 1 - u - v)];
  let best: readonly [number, number, number] = [1, 0, 0], distance = Infinity;
  for (const [i, j] of [[0, 1], [1, 2], [2, 0]]) {
    const ends = [a, b, c], x = ends[i], y = ends[j], dx = y.x - x.x, dy = y.y - x.y;
    const t = clamp01(((p.x - x.x) * dx + (p.y - x.y) * dy) / Math.max(1e-12, dx * dx + dy * dy));
    const d = Math.hypot(p.x - x.x - dx * t, p.y - x.y - dy * t);
    if (d < distance) { const w: [number, number, number] = [0, 0, 0]; w[i] = 1 - t; w[j] = t; best = w; distance = d; }
  }
  return best;
}

/** Finds the frontmost projected triangle, with explicit bounded silhouette fallback. */
export function locateHumanFaceSurface(surface: HumanFaceContactSurface, p: ContactPoint2): FaceSurfaceLocation | null {
  let result: FaceSurfaceLocation | null = null, bestCost = Infinity;
  for (let index = 0; index < CANONICAL_FACE_TRIANGLES.length; index++) {
    const ids = CANONICAL_FACE_TRIANGLES[index], a = surface.vertices[ids[0]], b = surface.vertices[ids[1]], c = surface.vertices[ids[2]];
    if (!a || !b || !c) continue;
    const margin=surface.faceHeight*.12;
    if(p.x<Math.min(a.x,b.x,c.x)-margin||p.x>Math.max(a.x,b.x,c.x)+margin||p.y<Math.min(a.y,b.y,c.y)-margin||p.y>Math.max(a.y,b.y,c.y)+margin)continue;
    const w = projectedBarycentric(p, a, b, c); if (!w) continue;
    const point = { x: w[0] * a.x + w[1] * b.x + w[2] * c.x, y: w[0] * a.y + w[1] * b.y + w[2] * c.y, z: w[0] * a.z + w[1] * b.z + w[2] * c.z };
    const projectedDistance = Math.hypot(p.x - point.x, p.y - point.y) / surface.faceHeight;
    if (projectedDistance > .12) continue;
    const cost = projectedDistance * 100 + point.z / surface.faceHeight * .001;
    if (cost >= bestCost) continue;
    const normal = new Vector3(b.x - a.x, b.y - a.y, b.z - a.z).cross(new Vector3(c.x - a.x, c.y - a.y, c.z - a.z));
    if (normal.lengthSq() < 1e-16) continue;
    normal.normalize(); if (normal.z > 0) normal.negate();
    const uvs = ids.map(i => canonicalUv(CANONICAL_FACE_VERTICES[i]));
    const uv = { x: w[0] * uvs[0].x + w[1] * uvs[1].x + w[2] * uvs[2].x, y: w[0] * uvs[0].y + w[1] * uvs[1].y + w[2] * uvs[2].y };
    const eye = Math.abs(uv.x) > .25 && Math.abs(uv.x) < .68 && uv.y > -.45 && uv.y < -.15;
    const mouth = Math.abs(uv.x) < .38 && uv.y > .34 && uv.y < .58;
    const protectedRegion = eye ? "eye" : mouth ? "mouth" : null;
    result = { triangle: index, barycentric: w, uv, point, normal: { x: normal.x, y: normal.y, z: normal.z }, projectedDistance, quality: surface.quality * (1 - projectedDistance / .16) * (.55 + .45 * Math.abs(normal.z)), protectedRegion };
    bestCost = cost;
  }
  return result;
}

export function classifyCanonicalFaceUv(uv: ContactPoint2): HumanAnatomicalLabel {
  if (uv.y < -.40 && Math.abs(uv.x) < .72) return "forehead";
  if (uv.y > .68) return "chin";
  if (Math.abs(uv.x) < .19 && uv.y > -.27 && uv.y < .27) return "nose";
  if (Math.abs(uv.x) < .38 && uv.y >= .34 && uv.y < .60) return "mouth";
  if (Math.abs(uv.x) > .64 && uv.y < .10) return uv.x > 0 ? "leftTemple" : "rightTemple";
  return uv.x > 0 ? "leftCheek" : "rightCheek";
}

export function faceSurfaceCandidate(surface: HumanFaceContactSurface, point: ContactPoint2): HumanBodyRegionCandidate | null {
  const location = locateHumanFaceSurface(surface, point); if (!location) return null;
  const label = classifyCanonicalFaceUv(location.uv);
  const region = label === "leftTemple" ? "leftCheek" : label === "rightTemple" ? "rightCheek" : label === "nose" ? "forehead" : label;
  return { region, anatomicalLabel: label, anatomicalSource: "face-landmark", anatomicalConfidence: location.quality,
    correctionEligible: !location.protectedRegion && label !== "nose" && label !== "mouth", center: surface.center,
    radius: { x: surface.faceHeight * .45, y: surface.faceHeight * .5 }, signedDistance: location.projectedDistance,
    confidence: location.quality, rawUv: location.uv, familyUv: location.uv, surfaceFamily: "head", surfaceNormalCamera: location.normal,
    modelConfidence: surface.quality, selectionBias: location.protectedRegion ? .35 : (1 - location.quality) * .12,
    faceLocation: location,
  };
}
