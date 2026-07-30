import { describe, expect, it } from "vitest";
import { TorsoTemporalProcessor } from "./torsoTemporal";

describe("3E-04 torso temporal stabilization", () => {
  it("filters only new Pose timestamps and converges without losing amplitude", () => {
    const value = new TorsoTemporalProcessor(); value.process({ yaw: 0, pitch: 0, roll: 0 }, 0, true);
    const first = value.process({ yaw: 45, pitch: 0, roll: 0 }, 16, true); expect(first.output.yaw).toBeGreaterThan(0); expect(first.output.yaw).toBeLessThan(45);
    expect(value.process({ yaw: -45, pitch: 0, roll: 0 }, 16, true)).toMatchObject({ sampleAdvanced: false, output: first.output });
    let last = first; for (let timestamp = 32; timestamp <= 1_500; timestamp += 16) last = value.process({ yaw: 45, pitch: 0, roll: 0 }, timestamp, true);
    expect(last.output.yaw).toBeGreaterThan(44.5);
  });
  it("resets without carrying a stale direction", () => {
    const value = new TorsoTemporalProcessor(); value.process({ yaw: 50, pitch: 0, roll: 0 }, 0, true); value.reset();
    expect(value.process({ yaw: -30, pitch: 0, roll: 0 }, 10, true).output.yaw).toBe(-30);
  });
});
