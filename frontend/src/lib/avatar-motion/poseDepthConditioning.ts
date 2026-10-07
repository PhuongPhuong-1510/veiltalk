import type { RawNormalizedLandmarkV1, RawPoseSampleV1, RawTrackingFrameV1 } from "../tracking/rawTrackingTypes";
import { OneEuroScalarFilter } from "./oneEuroFilter";

// Image Z is normalized; world Z is in metres. Tune independently, with a fairly
// responsive cutoff because direction and render filters already follow this layer.
const IMAGE_FILTER = { minCutoff: 4, beta: 3, derivativeCutoff: 1 };
const WORLD_FILTER = { minCutoff: 4, beta: 1, derivativeCutoff: 1 };
const MAX_GAP_MS = 250;
const MIN_VISIBILITY = 0.6;

/** Derived solver measurements only. Recording/overlays retain the untouched raw frame. */
export class PoseDepthConditioner {
  private image = new Map<number, OneEuroScalarFilter>();
  private world = new Map<number, OneEuroScalarFilter>();
  private lastAt: number | null = null;
  private geometry: string | null = null;
  private cached: RawPoseSampleV1 | null = null;

  reset(): void {
    this.image.clear(); this.world.clear();
    this.lastAt = null; this.geometry = null; this.cached = null;
  }

  condition(frame: RawTrackingFrameV1): RawTrackingFrameV1 {
    const geometry = `${frame.videoWidth}x${frame.videoHeight}`;
    if (this.geometry !== null && this.geometry !== geometry) this.reset();
    this.geometry = geometry;
    const pose = frame.pose, at = pose.sampledAtMs;
    if (pose.state === "lost" || at === null || !Number.isFinite(at)) {
      this.reset(); return frame;
    }
    if (this.lastAt !== null && (at < this.lastAt || at - this.lastAt > MAX_GAP_MS)) this.reset();
    // Reuse the last derived measurement without advancing time on skipped/duplicate samples.
    if (at === this.lastAt && this.cached) {
      return { ...frame, pose: { ...pose, landmarks: this.cached.landmarks, worldLandmarks: this.cached.worldLandmarks } };
    }
    if (pose.state !== "tracked") return frame;
    this.geometry = geometry;
    const filter = (points: RawNormalizedLandmarkV1[] | null, world: boolean) => {
      const history = world ? this.world : this.image;
      if (!points || points.length !== 33) { history.clear(); return points; }
      return points.map((point, index) => {
        const imageVisibility = pose.landmarks?.[index]?.visibility;
        const usable = [point.x, point.y, point.z].every(Number.isFinite)
          && point.visibility !== null && point.visibility >= MIN_VISIBILITY
          && (!world || (imageVisibility !== null && imageVisibility !== undefined && imageVisibility >= MIN_VISIBILITY));
        if (!usable) { history.delete(index); return point; }
        let depth = history.get(index);
        if (!depth) { depth = new OneEuroScalarFilter(world ? WORLD_FILTER : IMAGE_FILTER, MAX_GAP_MS); history.set(index, depth); }
        return { ...point, z: depth.filter(point.z, at) };
      });
    };
    this.cached = { ...pose, landmarks: filter(pose.landmarks, false), worldLandmarks: filter(pose.worldLandmarks, true) };
    this.lastAt = at;
    return { ...frame, pose: this.cached };
  }
}
