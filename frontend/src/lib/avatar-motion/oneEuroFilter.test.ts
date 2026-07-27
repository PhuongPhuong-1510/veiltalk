import { describe, expect, it } from "vitest";
import { OneEuroScalarFilter } from "./oneEuroFilter";

const parameters = { minCutoff: 1, beta: 0, derivativeCutoff: 1 };
const deviation = (values: number[]) => {
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
};

describe("OneEuroScalarFilter", () => {
  it("reduces deterministic static jitter by at least 30 percent", () => {
    const input = Array.from({ length: 120 }, (_, index) => 1 + (index % 4 === 0 ? .08 : index % 4 === 1 ? -.07 : index % 4 === 2 ? .05 : -.06));
    const filter = new OneEuroScalarFilter(parameters);
    const output = input.map((value, index) => filter.filter(value, index * 33.333));
    expect(1 - deviation(output.slice(20)) / deviation(input.slice(20))).toBeGreaterThan(.3);
  });
  it("resets safely for reversed and unusually large timestamps", () => {
    const filter = new OneEuroScalarFilter(parameters, 100);
    filter.filter(0, 100); expect(filter.filter(1, 90)).toBe(1); expect(filter.filter(.25, 500)).toBe(.25);
  });
  it("does not emit NaN for invalid samples", () => {
    const filter = new OneEuroScalarFilter(parameters); expect(filter.filter(Number.NaN, 0)).toBe(0);
  });
});

