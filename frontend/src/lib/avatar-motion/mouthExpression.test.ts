import { describe, expect, it } from "vitest";
import { DEFAULT_AVATAR_MOTION_CONFIG } from "./motionConfig";
import { computeMouthExpressions, safe01, validateMouthExpressionConfig, type MouthExpressionConfig } from "./mouthExpression";

const config = DEFAULT_AVATAR_MOTION_CONFIG.face.mouth;
const compute = (input: Record<string, number>) => computeMouthExpressions(input, config);
const vowelSum = (value: ReturnType<typeof compute>) => Object.values(value.snapshot.visemes).reduce((sum, weight) => sum + weight, 0);
const cloneConfig = (): MouthExpressionConfig => structuredClone(config);

describe("F3 webcam mouth math", () => {
  it("sanitizes missing and non-finite detector values", () => {
    expect([safe01(undefined), safe01(Number.NaN), safe01(Infinity), safe01(-Infinity), safe01(-1), safe01(2)])
      .toEqual([0, 0, 0, 0, 0, 1]);
    for (const poisoned of [Number.NaN, Infinity, -Infinity]) {
      const result = compute({ jawOpen: 1, mouthPucker: poisoned });
      expect(Object.values(result.expressions).every(Number.isFinite)).toBe(true);
      expect(result.snapshot.visemes.aa).toBe(1);
    }
    expect(compute({}).snapshot).toMatchObject({
      geometry: { jawOpen: 0, closure: 0, visibleOpening: 0, activity: 0 },
      visemes: { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 },
    });
  });

  it("rejects invalid activation ranges, gains and epsilon", () => {
    const reversed = cloneConfig(); reversed.activation.jawOpen = { onset: .5, full: .5 };
    expect(() => validateMouthExpressionConfig(reversed)).toThrow(/onset < full/);
    const nonFinite = cloneConfig(); nonFinite.aperture.high.full = Infinity;
    expect(() => validateMouthExpressionConfig(nonFinite)).toThrow(/aperture.high/);
    const invalidGain = cloneConfig(); invalidGain.roundWideAntagonism = 1.1;
    expect(() => validateMouthExpressionConfig(invalidGain)).toThrow(/roundWideAntagonism/);
    const invalidEpsilon = cloneConfig(); invalidEpsilon.epsilon = 0;
    expect(() => validateMouthExpressionConfig(invalidEpsilon)).toThrow(/epsilon/);
  });

  it("maps the five intended visible geometries to their dominant VRM viseme", () => {
    expect(compute({ jawOpen: 1 }).snapshot.visemes.aa).toBe(1);
    expect(compute({ mouthStretchLeft: 1, mouthStretchRight: 1 }).snapshot.visemes.ih).toBe(1);
    expect(compute({ mouthPucker: 1 }).snapshot.visemes.ou).toBe(1);

    const spreadMid = compute({ jawOpen: .38, mouthStretchLeft: 1, mouthStretchRight: 1 }).snapshot.visemes;
    expect(spreadMid.ee).toBeGreaterThan(spreadMid.ih);
    expect(spreadMid.ee).toBeGreaterThan(spreadMid.aa);

    const roundedOpen = compute({ jawOpen: .65, mouthFunnel: 1 }).snapshot.visemes;
    expect(roundedOpen.oh).toBeGreaterThan(roundedOpen.ou);
    expect(roundedOpen.oh).toBeGreaterThan(roundedOpen.aa);
  });

  it("uses inner-lip landmark aperture when the jaw blendshape misses a visible opening", () => {
    const result = computeMouthExpressions({ jawOpen: .01 }, config, { landmarkJawOpen: .6 });
    expect(result.snapshot.geometry).toMatchObject({ blendshapeJawOpen: 0, landmarkJawOpen: .6, jawOpen: .6, visibleOpening: .6 });
    expect(result.snapshot.visemes.aa).toBeCloseTo(.6);
    expect(result.expressions.jawOpen).toBe(.6);
  });

  it("compresses a moderate absolute pucker instead of mapping it near the maximum", () => {
    const moderate = compute({ mouthPucker: .45 });
    expect(moderate.snapshot.geometry.pucker).toBeGreaterThan(0);
    expect(moderate.snapshot.geometry.pucker).toBeLessThan(.6);
    expect(moderate.snapshot.visemes.ou).toBeLessThan(.6);
  });

  it("allows low-aperture ih/ou when lips are not sealed", () => {
    const wide = compute({ jawOpen: 0, mouthClose: 0, mouthStretchLeft: 1, mouthStretchRight: 1 });
    expect(wide.snapshot.geometry.visibleOpening).toBe(0);
    expect(wide.snapshot.visemes.ih).toBe(1);
    const round = compute({ jawOpen: 0, mouthClose: 0, mouthPucker: 1 });
    expect(round.snapshot.geometry.visibleOpening).toBe(0);
    expect(round.snapshot.visemes.ou).toBe(1);
  });

  it("applies closure once to activity while preserving jaw and closure as separate outputs", () => {
    // Midpoint của smoothstep range tạo C=0.5 chính xác.
    const closureInput = (config.activation.mouthClose.onset + config.activation.mouthClose.full) / 2;
    const result = compute({ jawOpen: 1, mouthClose: closureInput });
    expect(result.expressions.jawOpen).toBe(1);
    expect(result.expressions.mouthClose).toBeCloseTo(.5);
    expect(result.snapshot.geometry.visibleOpening).toBeCloseTo(.5);
    expect(result.snapshot.geometry.activity).toBeCloseTo(.5);
    expect(result.snapshot.visemes.aa).toBeCloseTo(.5);
    expect(vowelSum(result)).toBeCloseTo(.5);

    const sealed = compute({ jawOpen: 1, mouthClose: 1 });
    expect(sealed.expressions.jawOpen).toBe(1);
    expect(sealed.expressions.mouthClose).toBe(1);
    expect(vowelSum(sealed)).toBe(0);
  });

  it("does not collapse total activity under contradictory round and wide evidence", () => {
    const result = compute({
      mouthPucker: 1, mouthFunnel: 1,
      mouthStretchLeft: 1, mouthStretchRight: 1,
    });
    expect(result.snapshot.geometry.round).toBeCloseTo(.5);
    expect(result.snapshot.geometry.width).toBeCloseTo(.5);
    expect(result.snapshot.geometry.activity).toBe(1);
    expect(vowelSum(result)).toBeCloseTo(1);
  });

  it("keeps silent smile out of vowel evidence and preserves corner asymmetry", () => {
    const left = compute({ mouthSmileLeft: 1 });
    expect(vowelSum(left)).toBe(0);
    expect(left.expressions.mouthSmileLeft).toBe(1);
    expect(left.expressions.mouthSmileRight).toBe(0);
    const mirrored = compute({ mouthSmileRight: 1 });
    expect(mirrored.expressions.mouthSmileRight).toBe(left.expressions.mouthSmileLeft);
    expect(mirrored.expressions.mouthSmileLeft).toBe(left.expressions.mouthSmileRight);
  });

  it("aggregates left/right lip channels without destroying their independent values", () => {
    const left = compute({ mouthUpperUpLeft: 1, mouthLowerDownLeft: 1 });
    expect(left.expressions).toMatchObject({
      mouthUpperUpLeft: 1, mouthUpperUpRight: 0, mouthUpperUp: .5,
      mouthLowerDownLeft: 1, mouthLowerDownRight: 0, mouthLowerDown: .5,
    });
    const right = compute({ mouthUpperUpRight: 1, mouthLowerDownRight: 1 });
    expect(right.expressions.mouthUpperUp).toBe(left.expressions.mouthUpperUp);
    expect(right.expressions.mouthLowerDown).toBe(left.expressions.mouthLowerDown);
  });

  it("is continuous around configured thresholds", () => {
    const delta = 1e-7;
    const activationInputs: Array<[keyof typeof config.activation, (value: number) => Record<string, number>]> = [
      ["jawOpen", (value) => ({ jawOpen: value })],
      ["mouthClose", (value) => ({ jawOpen: 1, mouthClose: value })],
      ["pucker", (value) => ({ mouthPucker: value })],
      ["funnel", (value) => ({ jawOpen: .5, mouthFunnel: value })],
      ["stretch", (value) => ({ mouthStretchLeft: value, mouthStretchRight: value })],
      ["lip", (value) => ({ mouthUpperUpLeft: value })],
      ["corner", (value) => ({ mouthSmileLeft: value })],
    ];
    for (const [name, input] of activationInputs) for (const threshold of [config.activation[name].onset, config.activation[name].full]) {
      const below = compute(input(threshold - delta));
      const above = compute(input(threshold + delta));
      for (const expression of Object.keys(above.expressions)) {
        expect(Math.abs(above.expressions[expression] - below.expressions[expression])).toBeLessThan(1e-5);
      }
    }

    // Đảo numerically smoothstep để đặt đúng visible opening quanh các boundary Low/Mid/High.
    const rawJawForOpening = (target: number) => {
      let low = 0, high = 1;
      for (let index = 0; index < 60; index += 1) {
        const middle = (low + high) / 2;
        if (compute({ jawOpen: middle }).snapshot.geometry.visibleOpening < target) low = middle;
        else high = middle;
      }
      return (low + high) / 2;
    };
    for (const threshold of Object.values(config.aperture).flatMap((range) => [range.onset, range.full])) {
      const below = compute({ jawOpen: rawJawForOpening(Math.max(0, threshold - delta)), mouthStretchLeft: 1, mouthStretchRight: 1 });
      const above = compute({ jawOpen: rawJawForOpening(Math.min(1, threshold + delta)), mouthStretchLeft: 1, mouthStretchRight: 1 });
      for (const viseme of Object.keys(above.snapshot.visemes) as Array<keyof typeof above.snapshot.visemes>) {
        expect(Math.abs(above.snapshot.visemes[viseme] - below.snapshot.visemes[viseme])).toBeLessThan(1e-5);
      }
    }
  });

  it("keeps aa monotonic as an unrounded unsealed jaw opens", () => {
    let previous = 0;
    for (let jawOpen = 0; jawOpen <= 1; jawOpen += .02) {
      const current = compute({ jawOpen }).snapshot.visemes.aa;
      expect(current + 1e-12).toBeGreaterThanOrEqual(previous);
      previous = current;
    }
  });

  it("keeps all outputs bounded and normalized across an evidence grid", () => {
    const values = [0, .25, .5, .75, 1];
    for (const jawOpen of values) for (const mouthClose of values) for (const mouthPucker of values) {
      for (const mouthFunnel of values) for (const stretch of values) {
        const result = compute({
          jawOpen, mouthClose, mouthPucker, mouthFunnel,
          mouthStretchLeft: stretch, mouthStretchRight: stretch,
        });
        expect(Object.values(result.expressions).every((value) => Number.isFinite(value) && value >= 0 && value <= 1)).toBe(true);
        expect(vowelSum(result)).toBeLessThanOrEqual(1 + 1e-12);
      }
    }
  });
});
