import { describe, expect, it } from "vitest";
import { GazeTemporal } from "./gazeTemporal";

const config = { filter: { minCutoff: 1.5, beta: .08, derivativeCutoff: 1 }, maximumTimestampGapMs: 500, holdMs: 100, returnMs: 200 };

describe("GazeTemporal", () => {
  it("does not promote duplicate or reversed samples", () => {
    const temporal = new GazeTemporal(config);
    expect(temporal.processFresh(.5, -.2, 100, false).sampleDisposition).toBe("fresh");
    expect(temporal.processFresh(1, 1, 100, false)).toMatchObject({ yaw: .5, pitch: -.2, sampleDisposition: "duplicate" });
    expect(temporal.processFresh(1, 1, 90, false).sampleDisposition).toBe("reversed");
  });

  it("holds, returns by wall clock and reaches exact center", () => {
    const temporal = new GazeTemporal(config); temporal.processFresh(.8, -.4, 100, false);
    expect(temporal.processLoss(180)).toMatchObject({ yaw: .8, outputState: "held" });
    const returning = temporal.processLoss(300); expect(returning.outputState).toBe("returning"); expect(returning.yaw).toBeGreaterThan(0); expect(returning.yaw).toBeLessThan(.8);
    expect(temporal.processLoss(400)).toMatchObject({ yaw: 0, pitch: 0, outputState: "idle" });
  });

  it("is equivalent at shared wall-clock observations regardless of render-only calls", () => {
    const a = new GazeTemporal(config), b = new GazeTemporal(config);
    a.processFresh(0, 0, 0, true); b.processFresh(0, 0, 0, true);
    for (const now of [5, 10, 15, 20, 25]) a.processLoss(now);
    expect(a.processFresh(.8, .3, 50, true)).toEqual(b.processFresh(.8, .3, 50, true));
  });
});
