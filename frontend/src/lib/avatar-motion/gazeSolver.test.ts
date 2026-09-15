import { describe, expect, it } from "vitest";
import { GazeSolver, clampGaze, quaternionYawPitch } from "./gazeSolver";
import { DEFAULT_GAZE_OBSERVATION_CONFIG } from "./gazeObservation";

const config = { observation: DEFAULT_GAZE_OBSERVATION_CONFIG, temporal: { filter: { minCutoff: 1.5, beta: .08, derivativeCutoff: 1 }, maximumTimestampGapMs: 500, holdMs: 100, returnMs: 200 }, limits: { yawLeft: .8, yawRight: .8, pitchUp: .6, pitchDown: .5 } };
const positiveHorizontal = { eyeLookInLeft: 0, eyeLookOutLeft: 1, eyeLookUpLeft: 0, eyeLookDownLeft: 0, eyeLookInRight: 1, eyeLookOutRight: 0, eyeLookUpRight: 0, eyeLookDownRight: 0 };

describe("GazeSolver", () => {
  it("clamps diagonal targets on an asymmetric ellipse", () => {
    const output = clampGaze(1, 1, config.limits);
    expect(output.clampApplied).toBe(true);
    expect((output.yaw / .8) ** 2 + (output.pitch / .6) ** 2).toBeCloseTo(1);
  });

  it("produces a minimal gaze packet and local-only diagnostics", () => {
    const solver = new GazeSolver(config);
    expect(solver.processFresh(positiveHorizontal, 100, { x: 0, y: 0, z: 0, w: 1 }, false)).toEqual({ version: 1, yaw: .8, pitch: 0 });
    expect(solver.snapshot()).toMatchObject({ outputState: "active", quality: 1, rejectReason: null, head: { yaw: 0, pitch: 0 } });
  });

  it("keeps the previous output when a duplicate carries different or invalid values", () => {
    const solver = new GazeSolver(config); const first = solver.processFresh(positiveHorizontal, 100, null, false);
    expect(solver.processFresh({ ...positiveHorizontal, eyeLookOutLeft: Number.NaN }, 100, null, false)).toEqual(first);
    expect(solver.snapshot().sampleDisposition).toBe("duplicate");
  });

  it("does not turn a duplicated rejected observation into a fresh temporal target", () => {
    const solver = new GazeSolver(config); const invalid = { ...positiveHorizontal, eyeLookOutLeft: Number.NaN };
    expect(solver.processFresh(invalid, 100, null, false, 120)).toBeNull();
    expect(solver.processFresh(invalid, 100, null, false, 180)).toBeNull();
    expect(solver.snapshot()).toMatchObject({ outputState: "idle", sampleDisposition: "duplicate", rejectReason: "nonfinite-eye-look" });
  });

  it("returns null after loss reaches idle", () => {
    const solver = new GazeSolver(config); solver.processFresh(positiveHorizontal, 100, null, false);
    expect(solver.processLoss(401)).toBeNull();
  });

  it("rejects invalid head quaternions", () => expect(quaternionYawPitch({ x: 0, y: 0, z: 0, w: 0 })).toBeNull());

  it("validates realtime configuration once at construction", () => {
    expect(() => new GazeSolver({ ...config, limits: { ...config.limits, pitchUp: 0 } })).toThrow(/giới hạn semantic gaze/i);
  });
});
