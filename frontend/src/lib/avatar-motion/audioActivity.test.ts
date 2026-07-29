import { describe, expect, it } from "vitest";
import { rmsActivity, SimulatedAudioActivitySource } from "./audioActivity";
describe("audio activity", () => {
  it("removes noise floor and clamps RMS", () => { expect(rmsActivity(new Float32Array([0, 0]))).toBe(0); expect(rmsActivity(new Float32Array([.01, -.01]))).toBe(0); expect(rmsActivity(new Float32Array([2, -2]))).toBe(1); });
  it("provides a clamped local simulated source", () => { const source = new SimulatedAudioActivitySource(); expect(source.getActivity()).toBeNull(); source.setActivity(2); expect(source.getActivity()).toBe(1); });
});
