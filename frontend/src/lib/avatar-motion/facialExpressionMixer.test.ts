import { describe, expect, it } from "vitest";
import { DEFAULT_AVATAR_MOTION_CONFIG } from "./motionConfig";
import { mixFacialExpressions, validateFacialExpressionMixerConfig } from "./facialExpressionMixer";

const config = DEFAULT_AVATAR_MOTION_CONFIG.face.dynamics.mixer;
const mix = (input: Record<string, number>) => mixFacialExpressions(input, config).expressions;

describe("F4 facial expression mixer", () => {
  it("rejects invalid static config before entering the realtime loop", () => {
    expect(() => validateFacialExpressionMixerConfig({ ...config, priorityExponent: 0 })).toThrow(/priorityExponent/);
    expect(() => validateFacialExpressionMixerConfig({ ...config, budgets: { ...config.budgets, lipShape: Number.NaN } })).toThrow(/lipShape/);
    expect(() => validateFacialExpressionMixerConfig({ ...config, smile: { ...config.smile, openOnset: .8, openFull: .5 } })).toThrow(/openOnset/);
  });

  it("sanitizes every runtime value to a finite weight", () => {
    expect(mix({ aa: Number.NaN, ih: Infinity, ou: -2, ee: 3, custom: .4 })).toMatchObject({ aa: 0, ih: 0, ou: 0, ee: 1, custom: .4 });
  });

  it("uses idempotent available-budget priority for closure and blink", () => {
    const once = mix({ mouthClose: .5, aa: .8, blinkLeft: .5, eyeWideLeft: 1 });
    const twice = mix(once);
    expect(once.aa).toBeCloseTo(.5);
    expect(once.eyeWideLeft).toBeCloseTo(.5);
    expect(twice).toEqual(once);
  });

  it("uses only canonical F3 mouthClose for the vowel budget", () => {
    const result = mix({ mouthClose: .2, mouthPressLeft: 1, mouthPressRight: 1, aa: 1 });
    expect(result.mouthClose).toBe(.2);
    expect(result.aa).toBeCloseTo(.8);
    expect(result.mouthPress).toBe(1);
  });

  it("resolves true antagonists without winner-take-all discontinuity", () => {
    const result = mix({ jawLeft: .8, jawRight: .2, mouthSmileLeft: .8, mouthFrownLeft: .7, mouthWide: .3, mouthNarrow: .9 });
    expect(result.jawLeft).toBeCloseTo(.6);
    expect(result.jawRight).toBe(0);
    expect(result.mouthSmileLeft).toBeCloseTo(.1);
    expect(result.mouthFrownLeft).toBe(0);
    expect(result.mouthWide).toBe(0);
    expect(result.mouthNarrow).toBeCloseTo(.6);
  });

  it("keeps symmetric mouth corners as strong as two independent unilateral corners", () => {
    const bilateral = mix({ mouthSmileLeft: .8, mouthSmileRight: .8 });
    const unilateral = mix({ mouthSmileLeft: .8 });
    expect(bilateral.mouthSmileLeft).toBe(unilateral.mouthSmileLeft);
    expect(bilateral.mouthSmileRight).toBe(.8);
    expect(bilateral.mouthSmileClosed).toBeCloseTo(.8 * config.smile.closedGain);
    expect(unilateral.mouthSmileClosed).toBeCloseTo(.4 * config.smile.closedGain);
  });

  it("separates closed and open smile stages and exposes a bounded frown", () => {
    const closed = mix({ mouthSmileLeft: 1, mouthSmileRight: 1, jawOpen: 0, aa: 1 });
    const open = mix({ mouthSmileLeft: 1, mouthSmileRight: 1, jawOpen: 1, aa: 1 });
    const teeth = mix({
      mouthSmileLeft: 1, mouthSmileRight: 1, jawOpen: 0,
      mouthUpperUpLeft: 1, mouthUpperUpRight: 1,
      mouthLowerDownLeft: 1, mouthLowerDownRight: 1,
    });
    const frown = mix({ mouthFrownLeft: 1, mouthFrownRight: 1 });
    expect(closed.mouthSmileClosed).toBe(config.smile.closedGain);
    expect(closed.mouthSmileOpen).toBe(0);
    expect(open.mouthSmileClosed).toBe(0);
    expect(open.mouthSmileOpen).toBe(config.smile.openGain);
    expect(teeth.mouthSmileClosed).toBe(0);
    expect(teeth.mouthSmileOpen).toBe(config.smile.openGain);
    expect(closed.aa).toBeCloseTo(1 - config.smile.vowelSuppression);
    expect(open.aa).toBeCloseTo(1 - config.smile.vowelSuppression);
    expect(frown.mouthFrown).toBe(config.smile.frownGain);
    expect(mix(closed)).toEqual(closed);
    expect(mix(open)).toEqual(open);
  });

  it("blocks lip-press squint coupling without blocking a genuine blink", () => {
    const lipPress = mix({ mouthClose: 1, eyeSquintLeft: 1, eyeBlinkLeft: 0 });
    expect(lipPress.eyeSquintLeft).toBe(0);
    expect(lipPress.blinkLeft).toBe(0);
    const genuineBlink = mix({ mouthClose: 1, eyeSquintLeft: 1, eyeBlinkLeft: 1 });
    expect(genuineBlink.eyeSquintLeft).toBe(0);
    expect(genuineBlink.blinkLeft).toBe(1);
  });

  it("budgets lip shape under smile without scaling independent vertical and corner regions", () => {
    const result = mix({ aa: 1, mouthPucker: 1, mouthFunnel: 1, mouthUpperUpLeft: .8, mouthSmileLeft: .8 });
    const smile = .4;
    const vowel = 1 - smile * config.smile.vowelSuppression;
    const lipShapeLimit = (config.budgets.mouthBase - vowel) * (1 - smile * config.smile.lipShapeSuppression);
    expect(result.mouthPucker + result.mouthFunnel).toBeCloseTo(lipShapeLimit);
    expect(result.mouthUpperUpLeft).toBe(.8);
    expect(result.mouthSmileLeft).toBe(.8);
  });

  it("keeps global inner brow evidence while resolving per-side outer/down and aggregate fallback", () => {
    const result = mix({ browInnerUp: .8, browOuterUpLeft: .9, browDownLeft: .4, browDownRight: 0 });
    expect(result.browInnerUp).toBe(.8);
    expect(result.browOuterUpLeft).toBeCloseTo(.5);
    expect(result.browDownLeft).toBe(0);
    expect(result.browUp).toBe(.8);
    expect(result.browDown).toBe(0);
    const asymmetricConflict = mix({ browInnerUp: .8, browDownLeft: .8, browDownRight: 0 });
    expect(asymmetricConflict.browInnerUp).toBe(.8);
    expect(asymmetricConflict.browDownLeft).toBe(.8);
    expect(asymmetricConflict.browUp).toBeCloseTo(.4);
    expect(asymmetricConflict.browDown).toBe(0);
  });

  it("does not let one face region consume another region's budget", () => {
    const result = mix({ blinkLeft: 1, aa: 1, browInnerUp: 1, cheekSquintRight: 1, noseSneerRight: 1 });
    expect(result.blinkLeft).toBe(1);
    expect(result.aa).toBe(1);
    expect(result.browInnerUp).toBe(1);
    expect(result.cheekSquintRight + result.noseSneerRight).toBeCloseTo(.8);
  });

  it("preserves mirror symmetry and all mixer invariants over an extreme grid", () => {
    const values = [0, .5, 1];
    for (const close of values) for (const blink of values) for (const wide of values) for (const squint of values) {
      const result = mix({ mouthClose: close, aa: 1, ih: 1, blinkLeft: blink, eyeWideLeft: wide, eyeSquintLeft: squint });
      expect(Object.values(result).every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
      expect(result.aa + result.ih).toBeLessThanOrEqual(1 - close + 1e-12);
      expect(result.eyeWideLeft + result.eyeSquintLeft).toBeLessThanOrEqual(1 - blink + 1e-12);
      expect(mix(result)).toEqual(result);
    }
    const left = mix({ mouthSmileLeft: .7, eyeWideLeft: .6, browOuterUpLeft: .5 });
    const right = mix({ mouthSmileRight: .7, eyeWideRight: .6, browOuterUpRight: .5 });
    expect(left.mouthSmileLeft).toBe(right.mouthSmileRight);
    expect(left.eyeWideLeft).toBe(right.eyeWideRight);
    expect(left.browOuterUpLeft).toBe(right.browOuterUpRight);
  });
});
