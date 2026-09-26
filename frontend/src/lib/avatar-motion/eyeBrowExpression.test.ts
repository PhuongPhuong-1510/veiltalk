import { describe, expect, it } from "vitest";
import { EyeBrowExpressionProcessor, type EyeBrowExpressionConfig } from "./eyeBrowExpression";

const config: EyeBrowExpressionConfig = {
  blinkEnter: .55, blinkExit: .25, unilateralConfirmMs: 45,
  blinkOutputOnset: .05, blinkOutputFull: .75,
  browEmotionFallbackGain: 1, browInputOnset: .05, browInputFull: .45,
};

describe("F2 eye and brow expressions", () => {
  it("preserves continuous eyelid amplitude while tracking closed state with hysteresis", () => {
    const processor = new EyeBrowExpressionProcessor(config);
    const partial = processor.process({ eyeBlinkLeft: .4, eyeBlinkRight: .35 }, 84);
    expect(partial.blinkLeft).toBeCloseTo(.5);
    expect(partial.blinkRight).toBeCloseTo(3 / 7);
    expect(processor.snapshot()).toMatchObject({ leftClosed: false, rightClosed: false });

    const closing = processor.process({ eyeBlinkLeft: .8, eyeBlinkRight: .75 }, 100);
    expect(closing).toMatchObject({ blinkLeft: 1, blinkRight: 1 });
    expect(processor.snapshot()).toMatchObject({ leftClosed: true, rightClosed: true });

    const reopening = processor.process({ eyeBlinkLeft: .4, eyeBlinkRight: .4 }, 116);
    expect(reopening.blinkLeft).toBeCloseTo(.5);
    expect(reopening.blinkRight).toBeCloseTo(.5);
    expect(processor.snapshot()).toMatchObject({ leftClosed: true, rightClosed: true });
    const reopened = processor.process({ eyeBlinkLeft: .2, eyeBlinkRight: .2 }, 132);
    expect(reopened.blinkLeft).toBeCloseTo(3 / 14);
    expect(reopened.blinkRight).toBeCloseTo(3 / 14);
    expect(processor.snapshot()).toMatchObject({ leftClosed: false, rightClosed: false });
  });

  it("does not turn the blink-enter threshold into full eyelid closure", () => {
    const processor = new EyeBrowExpressionProcessor(config);
    expect(processor.process({ eyeBlinkLeft: .55, eyeBlinkRight: .55 }, 100)).toMatchObject({
      blinkLeft: 5 / 7,
      blinkRight: 5 / 7,
    });
  });

  it("rejects a one-frame unilateral spike but accepts an intentional wink after confirmation", () => {
    const processor = new EyeBrowExpressionProcessor(config);
    expect(processor.process({ eyeBlinkLeft: .9, eyeBlinkRight: .05 }, 100).blinkLeft).toBe(0);
    expect(processor.snapshot().unilateralCandidate).toBe("left");
    expect(processor.process({ eyeBlinkLeft: .05, eyeBlinkRight: .05 }, 116)).toMatchObject({ blinkLeft: 0, blinkRight: 0 });
    expect(processor.snapshot().unilateralCandidate).toBeNull();
    processor.process({ eyeBlinkLeft: .9, eyeBlinkRight: .05 }, 200);
    expect(processor.process({ eyeBlinkLeft: .9, eyeBlinkRight: .05 }, 250).blinkLeft).toBeGreaterThan(.8);
  });

  it("preserves asymmetric detail without promoting squint into blink", () => {
    const processor = new EyeBrowExpressionProcessor(config);
    const output = processor.process({
      eyeSquintLeft: .8, eyeSquintRight: .1, eyeWideLeft: .7, eyeWideRight: .3,
      browDownLeft: .9, browDownRight: .2, browInnerUp: .6, browOuterUpLeft: .8, browOuterUpRight: .1,
    }, 100);
    expect(output.eyeSquintLeft).toBe(.8); expect(output.eyeSquintRight).toBe(.1);
    expect(output.blinkLeft).toBe(0); expect(output.blinkRight).toBe(0);
    expect(output.browDown).toBe(1); expect(output.browUp).toBe(1); expect(output.eyeWide).toBe(.7);
  });

  it("clears temporal candidates and output on reset", () => {
    const processor = new EyeBrowExpressionProcessor(config);
    processor.process({ eyeBlinkLeft: .9 }, 100); processor.reset();
    expect(processor.snapshot()).toMatchObject({ blinkLeft: 0, leftClosed: false, unilateralCandidate: null });
  });
});
