import type { RawHandCandidateV1, RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import { OneEuroVectorFilter } from "./oneEuroFilter";

/** Shape filtering in palm-width units. Wrist translation never enters filter history. */
export class HandLandmarkConditioner {
  private imageFilters: OneEuroVectorFilter[] = [];
  private worldFilters: OneEuroVectorFilter[] = [];
  private lastAt: number | null = null;
  private aspect: number | null = null;
  private cached: RawHandCandidateV1 | null = null;

  reset(): void {
    this.imageFilters = []; this.worldFilters = [];
    this.lastAt = null; this.aspect = null; this.cached = null;
  }

  condition(candidate: RawHandCandidateV1, width: number, height: number): RawHandCandidateV1 {
    if (!(width > 0 && height > 0) || !Number.isFinite(candidate.sampledAtMs)) return candidate;
    const aspect = height / width;
    if (this.lastAt !== null && (candidate.sampledAtMs < this.lastAt || candidate.sampledAtMs - this.lastAt > 250 || aspect !== this.aspect)) this.reset();
    if (candidate.sampledAtMs === this.lastAt && this.cached) return this.cached;
    const image = this.filterShape(candidate.landmarks, candidate.sampledAtMs, aspect, this.imageFilters);
    const world = this.filterShape(candidate.worldLandmarks, candidate.sampledAtMs, 1, this.worldFilters);
    // An incomplete or degenerate palm cannot establish new trustworthy shape history.
    if (!image || !world) { this.reset(); return candidate; }
    this.lastAt = candidate.sampledAtMs; this.aspect = aspect;
    this.cached = { ...candidate, landmarks: image, worldLandmarks: world };
    return this.cached;
  }

  private filterShape(points: RawNormalizedLandmarkV1[], at: number, aspect: number, filters: OneEuroVectorFilter[]): RawNormalizedLandmarkV1[] | null {
    if (points.length !== 21 || points.some(p => ![p.x, p.y, p.z].every(Number.isFinite))) return null;
    const wrist = points[0], a = points[5], b = points[17];
    const scale = Math.hypot(a.x - b.x, (a.y - b.y) * aspect, a.z - b.z);
    if (!(scale > 1e-6)) return null;
    return points.map((point, index) => {
      if (index === 0) return { ...wrist };
      const filter = filters[index] ??= new OneEuroVectorFilter({ minCutoff: 3, beta: 0.7, derivativeCutoff: 1 }, 250);
      const shape = filter.filter({ x: (point.x - wrist.x) / scale, y: (point.y - wrist.y) * aspect / scale, z: (point.z - wrist.z) / scale }, at);
      if (this.lastAt === null) return { ...point };
      return { ...point, x: wrist.x + shape.x * scale, y: wrist.y + shape.y * scale / aspect, z: wrist.z + shape.z * scale };
    });
  }
}
