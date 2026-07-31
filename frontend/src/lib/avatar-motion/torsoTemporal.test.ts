import { describe, expect, it } from "vitest";
import { TorsoLossRecoveryProcessor, TorsoTemporalProcessor } from "./torsoTemporal";

describe("torso temporal and loss recovery", () => {
  it("does not advance a duplicate pose timestamp", () => {
    const value = new TorsoTemporalProcessor();
    const first = value.process({ yaw: 10, pitch: 2, roll: 1 }, 100, false);
    const duplicate = value.process({ yaw: 30, pitch: 8, roll: 4 }, 100, false);
    expect(duplicate.sampleAdvanced).toBe(false); expect(duplicate.output).toEqual(first.output);
  });
  it("holds, returns to neutral, then reacquires without snapping", () => {
    const value = new TorsoLossRecoveryProcessor({ holdMs: 100, returnMs: 200, recoveryMs: 100, confirmationSamples: 2 });
    expect(value.process({ yaw: 30, pitch: 0, roll: 0 }, "tracked", 1, 0).state).toBe("active");
    expect(value.process(null, "lost", null, 50).output.yaw).toBe(30);
    const returning = value.process(null, "lost", null, 200); expect(returning.state).toBe("returning"); expect(returning.output.yaw).toBeGreaterThan(0); expect(returning.output.yaw).toBeLessThan(30);
    value.process(null, "lost", null, 400);
    expect(value.process({ yaw: -20, pitch: 0, roll: 0 }, "tracked", 2, 410).state).toBe("confirming");
    const recovering = value.process({ yaw: -20, pitch: 0, roll: 0 }, "tracked", 3, 420); expect(recovering.state).toBe("recovering"); expect(recovering.output.yaw).toBeCloseTo(0);
    const blended = value.process({ yaw: -20, pitch: 0, roll: 0 }, "tracked", 4, 470); expect(blended.output.yaw).toBeGreaterThan(-20); expect(blended.output.yaw).toBeLessThan(0);
  });
});
