import { describe, expect, it } from "vitest";
import { MouthShapeComposer } from "./mouthShapeComposer";

describe("mouth shape composition", () => {
  it("prevents a closed-lip smile from activating an open-mouth happy preset", () => {
    const value = new MouthShapeComposer().compose({ jawOpen: .02, mouthSmileLeft: .9, mouthSmileRight: .9 });
    expect(value.happy).toBe(0);
    expect(value.mouthSmileLeft).toBe(.9);
    expect(value.mouthSmileRight).toBe(.9);
  });

  it("allows conservative happy fallback when smile and mouth-open evidence agree", () => {
    const value = new MouthShapeComposer().compose({ jawOpen: .5, aa: .5, mouthSmileLeft: .8, mouthSmileRight: .6 });
    expect(value.happy).toBeCloseTo(.7);
    expect(value.aa).toBe(.5);
  });

  it("recognizes a teeth-showing smile from vertical lip shapes even when the jaw stays nearly closed", () => {
    const composer = new MouthShapeComposer();
    const value = composer.compose({
      jawOpen: .03, mouthSmileLeft: .9, mouthSmileRight: .9,
      mouthUpperUpLeft: .5, mouthUpperUpRight: .45,
      mouthLowerDownLeft: .4, mouthLowerDownRight: .4,
    });
    expect(value.happy).toBeGreaterThan(.8);
    expect(composer.snapshot()).toMatchObject({ happyOpenSource: "upper-lip", happySuppressionReason: "none" });
  });

  it("lets close or press suppress happy without destroying direct side smile", () => {
    const value = new MouthShapeComposer().compose({ jawOpen: .7, mouthClose: .8, mouthPressLeft: .9, mouthSmileLeft: .8, mouthSmileRight: .6 });
    expect(value.happy).toBe(0);
    expect(value.mouthSmileLeft).toBe(.8);
  });

  it("keeps the dominant pucker instead of mutually suppressing both conflicting groups", () => {
    const value = new MouthShapeComposer().compose({ mouthPucker: 1, mouthFunnel: .8, mouthStretchLeft: .7, mouthSmileRight: .6 });
    expect(value.mouthPucker).toBe(1);
    expect(value.mouthStretchLeft).toBeLessThan(.1);
  });

  it("keeps the dominant horizontal shape and suppresses pucker noise", () => {
    const value = new MouthShapeComposer().compose({ mouthPucker: .35, mouthSmileLeft: .9, mouthSmileRight: .8 });
    expect(value.mouthSmileLeft).toBe(.9);
    expect(value.mouthPucker).toBeLessThan(.1);
  });

  it("preserves left and right channels independently", () => {
    const value = new MouthShapeComposer().compose({ mouthSmileLeft: .8, mouthSmileRight: 0, mouthDimpleRight: .4, mouthStretchLeft: .3 });
    expect(value.mouthSmileLeft).toBe(.8);
    expect(value.mouthSmileRight).toBe(0);
    expect(value.mouthDimpleRight).toBe(.4);
  });

  it("clamps invalid input, does not mutate it and resets diagnostics", () => {
    const input = { jawOpen: Number.NaN, mouthPucker: 2, mouthSmileLeft: -.5 };
    const composer = new MouthShapeComposer(); const value = composer.compose(input);
    expect(value).toMatchObject({ jawOpen: 0, mouthPucker: 1, mouthSmileLeft: 0, happy: 0 });
    expect(input.mouthPucker).toBe(2); expect(composer.snapshot()).not.toBeNull(); composer.reset(); expect(composer.snapshot()).toBeNull();
  });
});
