import { describe, expect, it } from "vitest";
import { HeadLossRecoveryProcessor } from "./headLossRecovery";

const pose = { yaw: 40, pitch: 10, roll: 5 };
describe("Phase 3D head loss/recovery", () => {
  it("holds exactly then returns monotonically to neutral", () => {
    const value = new HeadLossRecoveryProcessor(); value.process(pose, "tracked", 1, 0);
    expect(value.process(null, "lost", null, 10).output).toEqual(pose);
    expect(value.process(null, "lost", null, 260).output).toEqual(pose);
    const mid = value.process(null, "lost", null, 510); expect(mid.state).toBe("returning"); expect(mid.output.yaw).toBeGreaterThan(0); expect(mid.output.yaw).toBeLessThan(40);
    expect(value.process(null, "lost", null, 760)).toMatchObject({ state: "idle", output: { yaw: 0, pitch: 0, roll: 0 } });
  });
  it("requires two new samples and ignores duplicates/not-sampled", () => {
    const value = new HeadLossRecoveryProcessor(); value.process(pose, "tracked", 1, 0); value.process(null, "lost", null, 10);
    expect(value.process({ yaw: -30, pitch: 0, roll: 0 }, "tracked", 2, 20).confirmationCount).toBe(1);
    expect(value.process({ yaw: -30, pitch: 0, roll: 0 }, "tracked", 2, 30).confirmationCount).toBe(1);
    expect(value.process(null, "not-sampled", null, 40).confirmationCount).toBe(1);
    expect(value.process({ yaw: -30, pitch: 0, roll: 0 }, "tracked", 3, 50).state).toBe("recovering");
    expect(value.process({ yaw: -30, pitch: 0, roll: 0 }, "tracked", 4, 230)).toMatchObject({ state: "active", output: { yaw: -30 } });
  });
  it("starts a fresh hold from the rendered output when recovery is interrupted", () => {
    const value = new HeadLossRecoveryProcessor(); value.process(pose, "tracked", 10, 0); value.process(null, "lost", null, 10); value.process({ yaw: -30, pitch: 0, roll: 0 }, "tracked", 11, 20); value.process({ yaw: -30, pitch: 0, roll: 0 }, "tracked", 12, 30);
    const interrupted = value.process(null, "lost", null, 40); expect(interrupted.state).toBe("held"); expect(interrupted.lossDurationMs).toBe(0);
    const regression = value.process({ yaw: 5, pitch: 0, roll: 0 }, "tracked", 1, 50); expect(regression).toMatchObject({ state: "active", output: { yaw: 5 } });
  });
  it("does not treat idle-after-loss as first activation", () => {
    const value = new HeadLossRecoveryProcessor(); value.process(pose, "tracked", 1, 0); value.process(null, "lost", null, 10); value.process(null, "lost", null, 800);
    expect(value.process({ yaw: -20, pitch: 0, roll: 0 }, "tracked", 2, 810)).toMatchObject({ state: "confirming", confirmationCount: 1, output: { yaw: 0 } });
    expect(value.process({ yaw: -20, pitch: 0, roll: 0 }, "tracked", 3, 830).state).toBe("recovering");
  });
});
