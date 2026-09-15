import { describe, expect, it } from "vitest";
import { MouthSpeechCorrective, validateMouthSpeechCorrectiveConfig, type MouthSpeechCorrectiveConfig } from "./mouthSpeechCorrective";

const config: MouthSpeechCorrectiveConfig = {
  activityOnset: .05,
  activityFull: .55,
  midRangeLift: .35,
  peakDecayMs: 90,
  strongClosure: .65,
  maxContinuousGapMs: 250,
  epsilon: 1e-6,
};
const evidence = (opening: number, round = 0, stretch = 0, closure = 0) => ({ visibleOpening: opening, round, stretch, closure });

describe("F4 fast-speech mouth corrective", () => {
  it("validates ranges instead of accepting a degenerate tuning", () => {
    expect(() => validateMouthSpeechCorrectiveConfig({ ...config, activityFull: config.activityOnset })).toThrow(/activity range/);
    expect(() => validateMouthSpeechCorrectiveConfig({ ...config, peakDecayMs: 0 })).toThrow(/time constants/);
  });

  it("lifts an existing mid-range viseme without inventing jaw or a different shape", () => {
    const corrective = new MouthSpeechCorrective(config);
    const output = corrective.process({ ou: .3, jawOpen: .08 }, evidence(.1, .4), 100, true);
    expect(output.ou).toBeGreaterThan(.3);
    expect(output.ou).toBeLessThanOrEqual(1);
    expect(output.aa ?? 0).toBe(0);
    expect(output.jawOpen).toBe(.08);
  });

  it("preserves one normalized shape briefly, then replaces it immediately when a new viseme arrives", () => {
    const corrective = new MouthSpeechCorrective(config);
    const first = corrective.process({ aa: .7 }, evidence(.7), 100, true);
    const held = corrective.process({ aa: 0, ou: 0 }, evidence(0), 150, true);
    expect(held.aa).toBeGreaterThan(0);
    expect(held.aa).toBeLessThan(first.aa);
    const changed = corrective.process({ ou: .5 }, evidence(.1, .5), 200, true);
    expect(changed.aa).toBe(0);
    expect(changed.ou).toBeGreaterThan(.5);
  });

  it("lets strong closure kill opening immediately while preserving the closure articulation", () => {
    const corrective = new MouthSpeechCorrective(config);
    corrective.process({ aa: .8 }, evidence(.8), 100, true);
    const closed = corrective.process({ aa: .2, mouthClose: .9 }, evidence(.1, 0, 0, .9), 150, true);
    expect(closed.aa).toBe(.2);
    expect(closed.mouthClose).toBe(.9);
    expect(corrective.snapshot()).toMatchObject({ disposition: "closure-reset", preservedEnvelope: 0, closure: .9 });
    const after = corrective.process({ aa: 0 }, evidence(0), 200, true);
    expect(after.aa).toBe(0);
  });

  it("does not create a viseme for silence or a silent smile", () => {
    const corrective = new MouthSpeechCorrective(config);
    expect(corrective.process({ mouthSmileLeft: 1, mouthSmileRight: 1 }, evidence(0), 100, true)).toMatchObject({
      mouthSmileLeft: 1, mouthSmileRight: 1, aa: 0, ih: 0, ou: 0, ee: 0, oh: 0,
    });
  });

  it("uses wall-clock decay consistently and bypasses temporal hold when filtering is off", () => {
    const at20 = new MouthSpeechCorrective(config);
    const at30 = new MouthSpeechCorrective(config);
    at20.process({ aa: .8 }, evidence(.8), 0, true);
    at30.process({ aa: .8 }, evidence(.8), 0, true);
    const after100At20 = at20.process({ aa: 0 }, evidence(0), 100, true).aa;
    at30.process({ aa: 0 }, evidence(0), 50, true);
    const after100At30 = at30.process({ aa: 0 }, evidence(0), 100, true).aa;
    expect(after100At20).toBeCloseTo(after100At30);
    const bypassed = new MouthSpeechCorrective(config);
    bypassed.process({ aa: .8 }, evidence(.8), 0, false);
    expect(bypassed.process({ aa: 0 }, evidence(0), 50, false).aa).toBe(0);
  });

  it("has the same decay after equal wall-clock time at 15, 20 and 30 FPS", () => {
    const run = (fps: number) => {
      const corrective = new MouthSpeechCorrective(config);
      corrective.process({ aa: .8 }, evidence(.8), 0, true);
      const frameMs = 1_000 / fps;
      let output = { aa: .8 } as Record<string, number>;
      for (let frame = 1; frame <= fps; frame += 1) output = corrective.process({ aa: 0 }, evidence(0), frame * frameMs, true);
      return output.aa;
    };
    expect(run(15)).toBeCloseTo(run(20), 10);
    expect(run(20)).toBeCloseTo(run(30), 10);
  });

  it("switches aa to ou to ee without stacking old normalized shapes", () => {
    const corrective = new MouthSpeechCorrective(config);
    corrective.process({ aa: .5 }, evidence(.5), 0, true);
    expect(corrective.process({ ou: .5 }, evidence(.1, .5), 50, true)).toMatchObject({ aa: 0 });
    const ee = corrective.process({ ee: .5 }, evidence(.1, 0, .5), 100, true);
    expect(ee.aa).toBe(0);
    expect(ee.ou).toBe(0);
    expect(ee.ee).toBeGreaterThan(.5);
  });

  it("allows a fresh vowel to rise immediately after a closure reset", () => {
    const corrective = new MouthSpeechCorrective(config);
    corrective.process({ ee: .7 }, evidence(.1, 0, .7), 0, true);
    corrective.process({ mouthClose: 1 }, evidence(0, 0, 0, 1), 50, true);
    const released = corrective.process({ aa: .4, mouthClose: 0 }, evidence(.4), 100, true);
    expect(released.aa).toBeGreaterThan(.4);
    expect(released.ee).toBe(0);
  });

  it("drops stale peak state across a long tracking gap", () => {
    const corrective = new MouthSpeechCorrective(config);
    corrective.process({ ee: .8 }, evidence(.1, 0, .8), 0, true);
    const output = corrective.process({ ee: 0 }, evidence(0), 500, true);
    expect(output.ee).toBe(0);
    expect(corrective.snapshot().disposition).toBe("no-viseme");
  });
});
