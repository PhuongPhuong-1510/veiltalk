import { describe, expect, it } from "vitest";
import { applyContinuousDeadZone, INITIAL_HAND_TWIST_STABILIZATION_STATE, updateHandTwistStabilization, type HandTwistStabilizationConfig, type HandTwistStabilizationInput } from "./handTwistStabilization";

const DEG = Math.PI / 180;
const config: HandTwistStabilizationConfig = {
  deadZoneRadians: 3 * DEG,
  targetFilterTimeConstantSeconds: 0,
  minCorrectionRadians: -75 * DEG,
  maxCorrectionRadians: 75 * DEG,
};

function input(angle: number, nowMs: number, overrides: Partial<HandTwistStabilizationInput> = {}): HandTwistStabilizationInput {
  return { rawWrappedTwistRadians: angle, nowMs, dtSeconds: 1 / 30, reanchorNeutral: false, reanchorReason: null, ...overrides };
}

describe("Hand twist stabilization", () => {
  it("anchors the first trusted observation as neutral", () => {
    const result = updateHandTwistStabilization(INITIAL_HAND_TWIST_STABILIZATION_STATE, input(40 * DEG, 0), config)!;
    expect(result.neutralReanchored).toBe(true);
    expect(result.neutralTwistRadians).toBeCloseTo(40 * DEG);
    expect(result.correctedTwistRadians).toBeCloseTo(0);
    expect(result.clampedTwistRadians).toBeCloseTo(0);
  });

  it("produces signed neutral-relative correction", () => {
    const anchored = updateHandTwistStabilization(INITIAL_HAND_TWIST_STABILIZATION_STATE, input(10 * DEG, 0), config)!;
    const positive = updateHandTwistStabilization(anchored.state, input(30 * DEG, 33), config)!;
    const negative = updateHandTwistStabilization(anchored.state, input(-10 * DEG, 33), config)!;
    expect(positive.correctedTwistRadians).toBeCloseTo(20 * DEG);
    expect(negative.correctedTwistRadians).toBeCloseTo(-20 * DEG);
  });

  it("owns unwrap across ±PI", () => {
    const anchored = updateHandTwistStabilization(INITIAL_HAND_TWIST_STABILIZATION_STATE, input(179 * DEG, 0), config)!;
    const result = updateHandTwistStabilization(anchored.state, input(-179 * DEG, 33), config)!;
    expect(result.correctedTwistRadians).toBeCloseTo(2 * DEG);
  });

  it("has a continuous dead-zone boundary", () => {
    expect(applyContinuousDeadZone(2 * DEG, 3 * DEG)).toBe(0);
    expect(applyContinuousDeadZone(3 * DEG, 3 * DEG)).toBe(0);
    expect(applyContinuousDeadZone(3.001 * DEG, 3 * DEG)).toBeCloseTo(0.001 * DEG);
    expect(applyContinuousDeadZone(-3.001 * DEG, 3 * DEG)).toBeCloseTo(-0.001 * DEG);
  });

  it("filters by dt and clamps neutral-relative correction", () => {
    const filteredConfig = { ...config, deadZoneRadians: 0, targetFilterTimeConstantSeconds: 0.08 };
    let state = updateHandTwistStabilization(INITIAL_HAND_TWIST_STABILIZATION_STATE, input(0, 0), filteredConfig)!.state;
    let result = updateHandTwistStabilization(state, input(120 * DEG, 33), filteredConfig)!;
    expect(result.filteredTargetTwistRadians).toBeGreaterThan(0);
    expect(result.filteredTargetTwistRadians).toBeLessThan(120 * DEG);
    state = result.state;
    for (let i = 2; i <= 30; i += 1) {
      result = updateHandTwistStabilization(state, input(120 * DEG, i * 1000 / 30), filteredConfig)!;
      state = result.state;
    }
    expect(result.clampApplied).toBe(true);
    expect(result.clampedTwistRadians).toBeCloseTo(75 * DEG);
  });

  it("target filter is time-based rather than call-count based", () => {
    const run = (fps: number) => {
      const local = { ...config, deadZoneRadians: 0, targetFilterTimeConstantSeconds: 0.08 };
      let state = updateHandTwistStabilization(INITIAL_HAND_TWIST_STABILIZATION_STATE, input(0, 0, { dtSeconds: 1 / fps }), local)!.state;
      let result = updateHandTwistStabilization(state, input(60 * DEG, 1000 / fps, { dtSeconds: 1 / fps }), local)!;
      state = result.state;
      for (let i = 2; i <= fps; i += 1) {
        result = updateHandTwistStabilization(state, input(60 * DEG, i * 1000 / fps, { dtSeconds: 1 / fps }), local)!;
        state = result.state;
      }
      return result.filteredTargetTwistRadians;
    };
    expect(run(30)).toBeCloseTo(run(60), 4);
  });

  it("explicit reanchor replaces neutral with the current trusted observation", () => {
    const anchored = updateHandTwistStabilization(INITIAL_HAND_TWIST_STABILIZATION_STATE, input(0, 0), config)!;
    const result = updateHandTwistStabilization(anchored.state, input(40 * DEG, 33, {
      reanchorNeutral: true, reanchorReason: "tracking-discontinuity",
    }), config)!;
    expect(result.neutralReanchored).toBe(true);
    expect(result.neutralReanchorReason).toBe("tracking-discontinuity");
    expect(result.neutralTwistRadians).toBeCloseTo(40 * DEG);
    expect(result.correctedTwistRadians).toBeCloseTo(0);
  });
});
