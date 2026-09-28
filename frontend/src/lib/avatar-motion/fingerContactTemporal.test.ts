import { describe, expect, it } from "vitest";
import type { FingerContactFeatures, FingerPairKey } from "./fingerContactFeatures";
import { FINGER_TIP_PAIRS } from "./fingerContactFeatures";
import { FingerContactTemporal } from "./fingerContactTemporal";

function features(distance: number): FingerContactFeatures {
  const evidence = (d: number) => ({
    valid: true,
    normalizedDistance: d,
    proximity: d <= 0.09 ? 1 : 0.5,
    touching: d <= 0.1125,
    relativeDepth: 0,
  });
  const pairs = Object.fromEntries(
    FINGER_TIP_PAIRS.map(([key]) => [key, evidence(key === "thumb-index" ? distance : 1)]),
  ) as Record<FingerPairKey, ReturnType<typeof evidence>>;
  return {
    valid: true,
    palmWidth: 1,
    pairs,
    thumbIndex: pairs["thumb-index"],
    thumbMiddle: pairs["thumb-middle"],
    thumbRing: pairs["thumb-ring"],
    thumbLittle: pairs["thumb-little"],
  };
}

describe("FingerContactTemporal", () => {
  it("uses hysteresis so a small separation does not immediately release contact", () => {
    const temporal = new FingerContactTemporal();
    let state = temporal.update(features(0.10), 0, 0);
    expect(state["thumb-index"].active).toBe(true);
    state = temporal.update(features(0.18), 16, 16);
    expect(state["thumb-index"].active).toBe(true);
    state = temporal.update(features(0.24), 32, 32);
    expect(state["thumb-index"].active).toBe(false);
  });

  it("holds a known contact through brief observation loss", () => {
    const temporal = new FingerContactTemporal();
    temporal.update(features(0.10), 0, 0);
    expect(temporal.update(null, null, 80)["thumb-index"].active).toBe(true);
    expect(temporal.update(null, null, 140)["thumb-index"].active).toBe(false);
  });

  it("reports approach/separation from successive samples", () => {
    const temporal = new FingerContactTemporal();
    temporal.update(features(0.20), 0, 0);
    expect(temporal.update(features(0.12), 16, 16)["thumb-index"].approaching).toBe(true);
    expect(temporal.update(features(0.18), 32, 32)["thumb-index"].separating).toBe(true);
  });
});
