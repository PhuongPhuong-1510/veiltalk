import type { RawNormalizedLandmarkV1, RawWorldLandmarkV1 } from "../tracking/rawTrackingTypes";
import { computeFingerCurl } from "./fingerFeatures";
import type { FingerContactTemporalSnapshot } from "./fingerContactTemporal";
import type { FingerSpatialRelations } from "./fingerSpatialRelations";

export interface SingleHandGestureEvidence {
  pinch: number;
  ok: number;
  fingerHeart: number;
  crossedFingers: number;
}

export interface SingleHandCurlSnapshot {
  thumb: number;
  index: number;
  middle: number;
  ring: number;
  little: number;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smoothstep = (value: number): number => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const extendedScore = (curl: number): number => 1 - smoothstep((curl - 0.18) / 0.34);
const curledScore = (curl: number): number => smoothstep((curl - 0.28) / 0.40);
const moderateCurlScore = (curl: number): number => {
  const enter = smoothstep((curl - 0.18) / 0.28);
  const rejectOverCurl = 1 - smoothstep((curl - 0.82) / 0.14);
  return clamp01(enter * rejectOverCurl);
};

export function scoreSingleHandGestureEvidence(
  curls: SingleHandCurlSnapshot,
  contacts: FingerContactTemporalSnapshot,
  spatial: FingerSpatialRelations | null,
): SingleHandGestureEvidence {
  const thumbIndex = contacts["thumb-index"].strength;
  const pinch = thumbIndex;

  const ok = Math.min(
    thumbIndex,
    moderateCurlScore(curls.index),
    extendedScore(curls.middle),
    extendedScore(curls.ring),
    extendedScore(curls.little),
  );

  const fingerHeart = Math.min(
    thumbIndex,
    moderateCurlScore(curls.index),
    curledScore(curls.middle),
    curledScore(curls.ring),
    curledScore(curls.little),
  );

  const crossedFingers = spatial?.indexMiddle.valid
    ? Math.min(
        spatial.indexMiddle.crossingScore,
        extendedScore(curls.index),
        extendedScore(curls.middle),
      )
    : 0;

  return {
    pinch: clamp01(pinch),
    ok: clamp01(ok),
    fingerHeart: clamp01(fingerHeart),
    crossedFingers: clamp01(crossedFingers),
  };
}

/**
 * Semantic evidence only. These scores never own the finger pose and never
 * emit quaternions/presets; they can only strengthen an already-observed contact.
 */
export function computeSingleHandGestureEvidence(
  worldLandmarks: readonly RawNormalizedLandmarkV1[],
  contacts: FingerContactTemporalSnapshot,
  spatial: FingerSpatialRelations | null,
): SingleHandGestureEvidence {
  // RawNormalizedLandmarkV1 and RawWorldLandmarkV1 share the xyz shape; this solver receives
  // Hand-world samples in the current runtime despite the legacy normalized type alias.
  const points = worldLandmarks as readonly RawWorldLandmarkV1[];
  const thumb = computeFingerCurl(points, "thumb");
  const index = computeFingerCurl(points, "index");
  const middle = computeFingerCurl(points, "middle");
  const ring = computeFingerCurl(points, "ring");
  const little = computeFingerCurl(points, "little");

  if (![thumb, index, middle, ring, little].every((finger) => finger.valid)) {
    return { pinch: 0, ok: 0, fingerHeart: 0, crossedFingers: 0 };
  }

  return scoreSingleHandGestureEvidence({
    thumb: thumb.combinedCurl,
    index: index.combinedCurl,
    middle: middle.combinedCurl,
    ring: ring.combinedCurl,
    little: little.combinedCurl,
  }, contacts, spatial);
}
