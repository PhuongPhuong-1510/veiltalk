import { describe, expect, it } from "vitest";
import { BrowCheekExpressionProcessor } from "./browCheekExpression";

describe("BrowCheekExpressionProcessor", () => {
  it("preserves independent brow and frown semantics without cross-coupling", () => {
    const value = new BrowCheekExpressionProcessor().process({
      browDownLeft: .8, browDownRight: .1, browInnerUp: .6,
      browOuterUpLeft: .7, browOuterUpRight: .2,
      mouthFrownLeft: .9, mouthFrownRight: 0,
    }, 0);
    expect(value).toMatchObject({ browDownLeft: .8, browDownRight: .1, browInnerUp: .6, browOuterUpLeft: .7, browOuterUpRight: .2, mouthFrownLeft: .9, mouthFrownRight: 0 });
    expect(value.mouthFrownRight).toBe(0);
  });

  it("keeps cheek puff at zero inside its dead zone", () => {
    const processor = new BrowCheekExpressionProcessor();
    expect(processor.process({ cheekPuff: .05 }, 0).cheekPuff).toBe(0);
  });

  it("uses hysteresis so a weak boundary does not chatter", () => {
    const processor = new BrowCheekExpressionProcessor();
    expect(processor.process({ cheekPuff: .5 }, 0).cheekPuff).toBeGreaterThan(0);
    expect(processor.process({ cheekPuff: .16 }, 16).cheekPuff).toBeGreaterThan(0);
    for (let at = 32; at <= 240; at += 16) processor.process({ cheekPuff: .02 }, at);
    expect(processor.snapshot()?.puffLatched).toBe(false);
  });

  it("suppresses weak speech leakage but lets strong puff evidence through", () => {
    const weak = new BrowCheekExpressionProcessor().process({ cheekPuff: .3, jawOpen: .8 }, 0);
    const strong = new BrowCheekExpressionProcessor().process({ cheekPuff: .9, jawOpen: .8 }, 0);
    expect(weak.cheekPuff).toBeLessThan(.1);
    expect(strong.cheekPuff).toBeGreaterThan(.5);
  });

  it("clamps invalid values, preserves unrelated semantics and resets state", () => {
    const processor = new BrowCheekExpressionProcessor();
    const input = { cheekPuff: 2, browDownLeft: Number.NaN, mouthSmileLeft: .7 };
    const value = processor.process(input, 0);
    expect(value).toMatchObject({ cheekPuff: 1, browDownLeft: 0, mouthSmileLeft: .7 });
    expect(input.cheekPuff).toBe(2);
    processor.reset();
    expect(processor.snapshot()).toBeNull();
  });
});
