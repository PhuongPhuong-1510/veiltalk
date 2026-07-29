import { describe, expect, it } from "vitest";
import { EyeExpressionProcessor } from "./eyeExpression";
describe("eye expression processor", () => {
  it("keeps blink sides independent and lets blink defeat wide", () => {
    const p = new EyeExpressionProcessor(); const v = p.process({ eyeBlinkLeft: 1, eyeBlinkRight: 0, eyeWideLeft: 1, eyeWideRight: .5 }, 0);
    expect(v.blinkLeft).toBeGreaterThan(.8); expect(v.blinkRight).toBe(0); expect(v.eyeWideLeft).toBe(0); expect(v.eyeWideRight).toBeGreaterThan(0);
  });
  it("preserves a short blink pulse through minimum hold and then releases", () => {
    const p = new EyeExpressionProcessor(); p.process({ eyeBlinkLeft: 1 }, 0); const held = p.process({ eyeBlinkLeft: 0 }, 20); expect(held.blinkLeft).toBeGreaterThan(.5); const released = p.process({ eyeBlinkLeft: 0 }, 100); expect(released.blinkLeft).toBeLessThan(held.blinkLeft);
  });
  it("composes eye and cheek squint while only strong smile adds a bounded amount", () => {
    const p = new EyeExpressionProcessor(); const weak = p.process({ mouthSmileLeft: .4, mouthSmileRight: .4 }, 0); expect(weak.eyeSquintLeft).toBe(0);
    const strong = p.process({ eyeSquintLeft: .3, cheekSquintLeft: .8, mouthSmileLeft: 1, mouthSmileRight: 1 }, 20); expect(strong.eyeSquintLeft).toBeCloseTo(.64); expect(strong.eyeSquintRight).toBeLessThanOrEqual(.22);
  });
  it("applies wide dead zone, sanitizes invalid input and resets", () => {
    const p = new EyeExpressionProcessor(); const v = p.process({ eyeWideLeft: .04, eyeBlinkRight: Number.NaN }, 0); expect(v.eyeWideLeft).toBe(0); expect(v.blinkRight).toBe(0); expect(p.snapshot()).not.toBeNull(); p.reset(); expect(p.snapshot()).toBeNull();
  });
});
