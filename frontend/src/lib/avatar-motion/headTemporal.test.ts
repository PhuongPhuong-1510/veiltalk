import { describe, expect, it } from "vitest";
import { HeadTemporalProcessor } from "./headTemporal";

describe("Phase 3D head constraints and temporal filtering", () => {
  it("applies asymmetric pitch and axis constraints", () => {
    const value = new HeadTemporalProcessor();
    expect(value.process({ yaw: 100, pitch: 80, roll: -80 }, 10, true, false)).toMatchObject({ constrained: { yaw: 70, pitch: 35, roll: -36 }, constrainedAxes: ["yaw", "pitch", "roll"] });
    value.reset(); expect(value.process({ yaw: -100, pitch: -80, roll: 80 }, 20, true, false).constrained).toEqual({ yaw: -70, pitch: -45, roll: 36 });
  });
  it("filters only new sample timestamps and converges without losing held amplitude", () => {
    const value = new HeadTemporalProcessor(); value.process({ yaw: 0, pitch: 0, roll: 0 }, 0, true, true);
    const first = value.process({ yaw: 40, pitch: 0, roll: 0 }, 16, true, true); expect(first.output.yaw).toBeGreaterThan(0); expect(first.output.yaw).toBeLessThan(40);
    const duplicate = value.process({ yaw: -40, pitch: 0, roll: 0 }, 16, true, true); expect(duplicate.sampleAdvanced).toBe(false); expect(duplicate.output).toEqual(first.output);
    let last = first; for (let timestamp = 32; timestamp <= 1_000; timestamp += 16) last = value.process({ yaw: 40, pitch: 0, roll: 0 }, timestamp, true, true);
    expect(last.output.yaw).toBeGreaterThan(39);
  });
  it("resets cleanly across lifecycle boundaries", () => {
    const value = new HeadTemporalProcessor(); value.process({ yaw: 0, pitch: 0, roll: 0 }, 0, true, true); value.process({ yaw: 40, pitch: 0, roll: 0 }, 16, true, true); value.reset();
    expect(value.process({ yaw: -30, pitch: 0, roll: 0 }, 10, true, true).output.yaw).toBe(-30);
  });
});
