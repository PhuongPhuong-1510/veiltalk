import { Vector3 } from "three";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { AvatarFingerName } from "./avatarPoseTypes";

/**
 * Geometry-only fingertip relations.  No named gesture is created here.
 * Distances are normalized by palm width so the evidence is scale invariant.
 */

export type FingerPairKey =
  | "thumb-index"
  | "thumb-middle"
  | "thumb-ring"
  | "thumb-little"
  | "index-middle"
  | "index-ring"
  | "index-little"
  | "middle-ring"
  | "middle-little"
  | "ring-little";

export interface FingerContactPairEvidence {
  valid: boolean;
  /** Tip-to-tip distance / palm width. */
  normalizedDistance: number;
  /** 0 = clearly separate, 1 = confidently near contact. */
  proximity: number;
  /** Conservative binary diagnostic. Prefer `proximity` for blending. */
  touching: boolean;
  /** Signed z difference / palm width. Useful for front/back ordering. */
  relativeDepth: number;
}

export interface FingerContactFeatures {
  valid: boolean;
  palmWidth: number;
  pairs: Record<FingerPairKey, FingerContactPairEvidence>;

  // Backward-compatible aliases used by M1-M4 code.
  thumbIndex: FingerContactPairEvidence;
  thumbMiddle: FingerContactPairEvidence;
  thumbRing: FingerContactPairEvidence;
  thumbLittle: FingerContactPairEvidence;
}

export interface FingerContactThresholds {
  /** Below this normalized distance the pair has full soft-contact influence. */
  full: number;
  /** Above this normalized distance the contact influence is zero. */
  enter: number;
}

export const DEFAULT_FINGER_CONTACT_THRESHOLDS: FingerContactThresholds = {
  full: 0.09,
  enter: 0.28,
};

const TIP_INDEX: Record<AvatarFingerName, number> = {
  thumb: 4,
  index: 8,
  middle: 12,
  ring: 16,
  little: 20,
};

export const FINGER_TIP_PAIRS: ReadonlyArray<readonly [FingerPairKey, AvatarFingerName, AvatarFingerName]> = [
  ["thumb-index", "thumb", "index"],
  ["thumb-middle", "thumb", "middle"],
  ["thumb-ring", "thumb", "ring"],
  ["thumb-little", "thumb", "little"],
  ["index-middle", "index", "middle"],
  ["index-ring", "index", "ring"],
  ["index-little", "index", "little"],
  ["middle-ring", "middle", "ring"],
  ["middle-little", "middle", "little"],
  ["ring-little", "ring", "little"],
] as const;

const INVALID_PAIR: FingerContactPairEvidence = {
  valid: false,
  normalizedDistance: Number.POSITIVE_INFINITY,
  proximity: 0,
  touching: false,
  relativeDepth: 0,
};

const finite = (point: RawNormalizedLandmarkV1 | undefined): point is RawNormalizedLandmarkV1 =>
  Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));
const vector = (point: RawNormalizedLandmarkV1): Vector3 => new Vector3(point.x, point.y, point.z);
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smoothstep01 = (value: number): number => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

function pairEvidence(
  landmarks: readonly RawNormalizedLandmarkV1[],
  a: AvatarFingerName,
  b: AvatarFingerName,
  palmWidth: number,
  thresholds: FingerContactThresholds,
): FingerContactPairEvidence {
  const aTip = landmarks[TIP_INDEX[a]];
  const bTip = landmarks[TIP_INDEX[b]];
  if (!finite(aTip) || !finite(bTip) || palmWidth <= 1e-6) return INVALID_PAIR;

  const normalizedDistance = vector(aTip).distanceTo(vector(bTip)) / palmWidth;
  if (!Number.isFinite(normalizedDistance)) return INVALID_PAIR;

  const span = Math.max(1e-6, thresholds.enter - thresholds.full);
  const proximity = 1 - smoothstep01((normalizedDistance - thresholds.full) / span);
  return {
    valid: true,
    normalizedDistance,
    proximity,
    touching: normalizedDistance <= thresholds.full * 1.25,
    relativeDepth: (aTip.z - bTip.z) / palmWidth,
  };
}

function invalidFeatures(): FingerContactFeatures {
  const pairs = Object.fromEntries(FINGER_TIP_PAIRS.map(([key]) => [key, INVALID_PAIR])) as Record<FingerPairKey, FingerContactPairEvidence>;
  return {
    valid: false,
    palmWidth: 0,
    pairs,
    thumbIndex: pairs["thumb-index"],
    thumbMiddle: pairs["thumb-middle"],
    thumbRing: pairs["thumb-ring"],
    thumbLittle: pairs["thumb-little"],
  };
}

export function computeFingerContactFeatures(
  landmarks: readonly RawNormalizedLandmarkV1[],
  thresholds: FingerContactThresholds = DEFAULT_FINGER_CONTACT_THRESHOLDS,
): FingerContactFeatures {
  const indexMcp = landmarks[5];
  const littleMcp = landmarks[17];
  if (!finite(indexMcp) || !finite(littleMcp)) return invalidFeatures();

  const palmWidth = vector(indexMcp).distanceTo(vector(littleMcp));
  if (!Number.isFinite(palmWidth) || palmWidth <= 1e-6) return invalidFeatures();

  const pairs = Object.fromEntries(
    FINGER_TIP_PAIRS.map(([key, a, b]) => [key, pairEvidence(landmarks, a, b, palmWidth, thresholds)]),
  ) as Record<FingerPairKey, FingerContactPairEvidence>;

  return {
    valid: true,
    palmWidth,
    pairs,
    thumbIndex: pairs["thumb-index"],
    thumbMiddle: pairs["thumb-middle"],
    thumbRing: pairs["thumb-ring"],
    thumbLittle: pairs["thumb-little"],
  };
}
