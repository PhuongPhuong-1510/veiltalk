import { describe, expect, it } from "vitest";
import { FaceExpressionLossProcessor } from "./faceExpressionLoss";

const config = { holdMs: 100, returnMs: 200, recoveryMs: 100, confirmationSamples: 2 };
const sample = (jawOpen = .8) => ({ expressions: { jawOpen, aa: jawOpen, happy: .6, browInnerUp: .5 }, gaze: { yaw: .7, pitch: -.4 } });

describe("FaceExpressionLossProcessor", () => {
  it("holds the exact last valid output through short loss and not-sampled frames", () => {
    const value = new FaceExpressionLossProcessor(config);
    const active = value.process(sample(), "tracked", 10, 10);
    expect(value.process(null, "not-sampled", null, 50)).toEqual(active);
    expect(value.process(null, "lost", null, 100)).toEqual(active);
    expect(value.snapshot().state).toBe("held");
  });

  it("eases to neutral on long loss and closes the mouth", () => {
    const value = new FaceExpressionLossProcessor(config); value.process(sample(), "tracked", 10, 10);
    const returning = value.process(null, "lost", null, 210);
    expect(returning.expressions.jawOpen).toBeCloseTo(.4);
    expect(returning.expressions.aa).toBeCloseTo(.4);
    expect(returning.gaze.yaw).toBeCloseTo(.35);
    const idle = value.process(null, "lost", null, 310);
    expect(idle.expressions.jawOpen).toBe(0); expect(idle.expressions.happy).toBe(0); expect(idle.gaze).toEqual({ yaw: 0, pitch: 0 });
    expect(value.snapshot()).toMatchObject({ state: "idle", longLossResetRequested: true });
    value.process(null, "lost", null, 320);
    expect(value.snapshot().longLossResetRequested).toBe(false);
  });

  it("requires consecutive new samples and blends recovery without snapping", () => {
    const value = new FaceExpressionLossProcessor(config); value.process(sample(), "tracked", 10, 10); value.process(null, "lost", null, 310);
    expect(value.process(sample(.2), "tracked", 400, 400).expressions.jawOpen).toBe(0);
    expect(value.snapshot().state).toBe("confirming");
    expect(value.process(sample(.2), "tracked", 400, 410).expressions.jawOpen).toBe(0);
    expect(value.snapshot().confirmationCount).toBe(1);
    expect(value.process(sample(.2), "tracked", 420, 420).expressions.jawOpen).toBe(0);
    expect(value.snapshot().state).toBe("recovering");
    const middle = value.process(sample(.2), "tracked", 440, 470);
    expect(middle.expressions.jawOpen).toBeGreaterThan(0); expect(middle.expressions.jawOpen).toBeLessThan(.2);
    expect(value.process(sample(.2), "tracked", 460, 520).expressions.jawOpen).toBeCloseTo(.2);
    expect(value.snapshot().state).toBe("active");
  });

  it("cancels confirmation on renewed loss and reset clears all cache", () => {
    const value = new FaceExpressionLossProcessor(config); value.process(sample(), "tracked", 10, 10); value.process(null, "lost", null, 310);
    value.process(sample(.2), "tracked", 400, 400); value.process(null, "lost", null, 410);
    expect(value.snapshot().state).not.toBe("confirming");
    value.reset(); expect(value.snapshot()).toMatchObject({ state: "idle", cached: null, confirmationCount: 0 });
  });
});
