import { Vector3 } from "three";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { HandBasisResult } from "./handPalmBasis";

export interface AdjacentFingerCrossingEvidence {
  valid: boolean;
  /** 0 = normal order, 1 = clearly crossed/inverted along the palm-across axis. */
  crossingScore: number;
  baseOrderSign: number;
  tipOrderSign: number;
}

export interface FingerSpatialRelations {
  valid: boolean;
  indexMiddle: AdjacentFingerCrossingEvidence;
  middleRing: AdjacentFingerCrossingEvidence;
  ringLittle: AdjacentFingerCrossingEvidence;
  /** Tip spread / palm width for adjacent regular fingers. */
  adjacentTipSpread: {
    indexMiddle: number;
    middleRing: number;
    ringLittle: number;
  };
}

const finite = (point: RawNormalizedLandmarkV1 | undefined): point is RawNormalizedLandmarkV1 =>
  Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));
const vec = (point: RawNormalizedLandmarkV1): Vector3 => new Vector3(point.x, point.y, point.z);
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smoothstep = (value: number): number => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

const INVALID: AdjacentFingerCrossingEvidence = {
  valid: false,
  crossingScore: 0,
  baseOrderSign: 0,
  tipOrderSign: 0,
};

function crossing(
  landmarks: readonly RawNormalizedLandmarkV1[],
  across: Vector3,
  palmWidth: number,
  aMcpIndex: number,
  aTipIndex: number,
  bMcpIndex: number,
  bTipIndex: number,
): AdjacentFingerCrossingEvidence {
  const aMcp = landmarks[aMcpIndex];
  const aTip = landmarks[aTipIndex];
  const bMcp = landmarks[bMcpIndex];
  const bTip = landmarks[bTipIndex];
  if (![aMcp, aTip, bMcp, bTip].every(finite) || palmWidth <= 1e-6) return INVALID;

  const baseDelta = vec(aMcp).sub(vec(bMcp)).dot(across);
  const tipDelta = vec(aTip).sub(vec(bTip)).dot(across);
  const baseOrderSign = Math.sign(baseDelta);
  const tipOrderSign = Math.sign(tipDelta);
  const inverted = baseOrderSign !== 0 && tipOrderSign !== 0 && baseOrderSign !== tipOrderSign;
  if (!inverted) return { valid: true, crossingScore: 0, baseOrderSign, tipOrderSign };

  // Require a meaningful inversion rather than jitter exactly at the order boundary.
  const normalizedInversion = Math.abs(tipDelta) / palmWidth;
  const crossingScore = smoothstep(normalizedInversion / 0.18);
  return { valid: true, crossingScore, baseOrderSign, tipOrderSign };
}

function tipDistance(
  landmarks: readonly RawNormalizedLandmarkV1[],
  aIndex: number,
  bIndex: number,
  palmWidth: number,
): number {
  const a = landmarks[aIndex];
  const b = landmarks[bIndex];
  if (!finite(a) || !finite(b) || palmWidth <= 1e-6) return 0;
  return vec(a).distanceTo(vec(b)) / palmWidth;
}

export function computeFingerSpatialRelations(
  landmarks: readonly RawNormalizedLandmarkV1[],
  basis: HandBasisResult,
): FingerSpatialRelations {
  const indexMcp = landmarks[5];
  const littleMcp = landmarks[17];
  const across = new Vector3(basis.across.x, basis.across.y, basis.across.z);
  if (!finite(indexMcp) || !finite(littleMcp) || across.lengthSq() <= 1e-8) {
    return {
      valid: false,
      indexMiddle: INVALID,
      middleRing: INVALID,
      ringLittle: INVALID,
      adjacentTipSpread: { indexMiddle: 0, middleRing: 0, ringLittle: 0 },
    };
  }

  across.normalize();
  const palmWidth = vec(indexMcp).distanceTo(vec(littleMcp));
  if (!Number.isFinite(palmWidth) || palmWidth <= 1e-6) {
    return {
      valid: false,
      indexMiddle: INVALID,
      middleRing: INVALID,
      ringLittle: INVALID,
      adjacentTipSpread: { indexMiddle: 0, middleRing: 0, ringLittle: 0 },
    };
  }

  return {
    valid: true,
    indexMiddle: crossing(landmarks, across, palmWidth, 5, 8, 9, 12),
    middleRing: crossing(landmarks, across, palmWidth, 9, 12, 13, 16),
    ringLittle: crossing(landmarks, across, palmWidth, 13, 16, 17, 20),
    adjacentTipSpread: {
      indexMiddle: tipDistance(landmarks, 8, 12, palmWidth),
      middleRing: tipDistance(landmarks, 12, 16, palmWidth),
      ringLittle: tipDistance(landmarks, 16, 20, palmWidth),
    },
  };
}
