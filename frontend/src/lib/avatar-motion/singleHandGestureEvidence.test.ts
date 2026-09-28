import { describe, expect, it } from "vitest";
import type { FingerContactTemporalSnapshot } from "./fingerContactTemporal";
import type { FingerPairKey } from "./fingerContactFeatures";
import { FINGER_TIP_PAIRS } from "./fingerContactFeatures";
import type { FingerSpatialRelations } from "./fingerSpatialRelations";
import { scoreSingleHandGestureEvidence } from "./singleHandGestureEvidence";

function contacts(thumbIndexStrength: number): FingerContactTemporalSnapshot {
  return Object.fromEntries(FINGER_TIP_PAIRS.map(([key]) => [key, {
    active: key === "thumb-index" && thumbIndexStrength > 0,
    strength: key === "thumb-index" ? thumbIndexStrength : 0,
    enteredAtMs: null,
    lastObservedAtMs: null,
    lastSampledAtMs: null,
    previousDistance: null,
    approaching: false,
    separating: false,
  }])) as Record<FingerPairKey, FingerContactTemporalSnapshot[FingerPairKey]>;
}

const spatial = (crossingScore: number): FingerSpatialRelations => ({
  valid: true,
  indexMiddle: { valid: true, crossingScore, baseOrderSign: -1, tipOrderSign: crossingScore > 0 ? 1 : -1 },
  middleRing: { valid: true, crossingScore: 0, baseOrderSign: -1, tipOrderSign: -1 },
  ringLittle: { valid: true, crossingScore: 0, baseOrderSign: -1, tipOrderSign: -1 },
  adjacentTipSpread: { indexMiddle: 0.2, middleRing: 0.2, ringLittle: 0.2 },
});

describe("scoreSingleHandGestureEvidence", () => {
  it("separates OK-like evidence from finger-heart-like evidence", () => {
    const ok = scoreSingleHandGestureEvidence(
      { thumb: 0.35, index: 0.45, middle: 0.05, ring: 0.08, little: 0.1 },
      contacts(0.95),
      spatial(0),
    );
    const heart = scoreSingleHandGestureEvidence(
      { thumb: 0.35, index: 0.45, middle: 0.8, ring: 0.85, little: 0.8 },
      contacts(0.95),
      spatial(0),
    );
    expect(ok.ok).toBeGreaterThan(ok.fingerHeart);
    expect(heart.fingerHeart).toBeGreaterThan(heart.ok);
  });

  it("reports crossed-finger evidence without creating a named pose", () => {
    const result = scoreSingleHandGestureEvidence(
      { thumb: 0.1, index: 0.05, middle: 0.08, ring: 0.2, little: 0.2 },
      contacts(0),
      spatial(0.9),
    );
    expect(result.crossedFingers).toBeGreaterThan(0.5);
  });
});
