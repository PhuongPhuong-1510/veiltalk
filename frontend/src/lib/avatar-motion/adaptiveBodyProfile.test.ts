import { describe, expect, it } from "vitest";
import { createRobustMeasurementState, updateRobustMeasurement } from "./adaptiveBodyProfile";

const config = { minimumSamples: 3, windowSamples: 8, outlierSigma: 3, minimumRelativeTolerance: .12 };

describe("passive robust body measurements", () => {
  it("learns a median and rejects a single implausible bone-length jump", () => {
    const state = createRobustMeasurementState();
    for (const value of [1, 1.02, .98]) expect(updateRobustMeasurement(state, value, config).accepted).toBe(true);
    expect(updateRobustMeasurement(state, 2.5, config)).toMatchObject({ accepted: false, reason: "outlier" });
    expect(state.value).toBe(1);
    expect(state.rejectedSamples).toBe(1);
  });

  it("uses a bounded rolling window and exposes confidence independently from lifetime samples", () => {
    const state = createRobustMeasurementState();
    for (let index = 0; index < 20; index += 1) updateRobustMeasurement(state, 1 + index * .001, config);
    expect(state.samples).toHaveLength(8);
    expect(state.acceptedSamples).toBe(20);
    expect(state.confidence).toBe(1);
  });

  it("rejects invalid measurements without poisoning the sample window", () => {
    const state = createRobustMeasurementState();
    expect(updateRobustMeasurement(state, Number.NaN, config).accepted).toBe(false);
    expect(updateRobustMeasurement(state, 0, config).accepted).toBe(false);
    expect(state.samples).toEqual([]);
  });
});
