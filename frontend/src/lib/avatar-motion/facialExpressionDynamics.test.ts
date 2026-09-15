import { describe, expect, it } from "vitest";
import { DEFAULT_AVATAR_MOTION_CONFIG } from "./motionConfig";
import { asymmetricExpressionStep, FacialExpressionDynamics, validateFacialExpressionDynamicsConfig } from "./facialExpressionDynamics";

const config = DEFAULT_AVATAR_MOTION_CONFIG.face.dynamics;

describe("F4 facial expression dynamics", () => {
  it("rejects invalid timing config before entering the realtime loop", () => {
    expect(() => validateFacialExpressionDynamicsConfig({ ...config, dtMaxMs: 300 })).toThrow(/dtMaxMs/);
    expect(() => validateFacialExpressionDynamicsConfig({ ...config, groups: { ...config.groups, brow: { attackMs: 0, releaseMs: 100 } } })).toThrow(/brow/);
  });

  it("matches the analytical t90 response", () => {
    const tauMs = 12;
    const value = asymmetricExpressionStep(0, 1, tauMs * Math.log(10), { attackMs: tauMs, releaseMs: 45 });
    expect(value).toBeCloseTo(.9, 10);
  });

  it("is frame-rate independent at 15, 30 and 60 FPS over equal wall time", () => {
    const simulate = (fps: number) => {
      let value = 0;
      const dt = 1_000 / fps;
      for (let elapsed = 0; elapsed < 1_000 - 1e-6; elapsed += dt) value = asymmetricExpressionStep(value, 1, dt, { attackMs: 70, releaseMs: 150 });
      return value;
    };
    expect(simulate(15)).toBeCloseTo(simulate(30), 10);
    expect(simulate(30)).toBeCloseTo(simulate(60), 10);
  });

  it("makes closure a first-update response while cheek remains slower", () => {
    const dynamics = new FacialExpressionDynamics(config);
    const result = dynamics.processFresh({ mouthClose: 1, cheekSquintLeft: 1 }, 100, true);
    expect(result.mouthClose).toBeGreaterThan(.9);
    expect(result.cheekSquintLeft).toBeLessThan(.5);
  });

  it("uses slower release than attack for lip closure", () => {
    const dynamics = new FacialExpressionDynamics(config);
    dynamics.processFresh({ mouthClose: 1 }, 100, false);
    const released = dynamics.processFresh({ mouthClose: 0 }, 112, true).mouthClose;
    const attacked = new FacialExpressionDynamics(config).processFresh({ mouthClose: 1 }, 112, true).mouthClose;
    expect(1 - released).toBeLessThan(attacked);
  });

  it("holds duplicate/reversed samples and rebases a long gap without snapping", () => {
    const dynamics = new FacialExpressionDynamics(config);
    const first = dynamics.processFresh({ jawOpen: 0 }, 100, true);
    expect(dynamics.processFresh({ jawOpen: 1 }, 100, true)).toEqual(first);
    expect(dynamics.snapshot().sampleDisposition).toBe("duplicate");
    expect(dynamics.processFresh({ jawOpen: 1 }, 90, true)).toEqual(first);
    expect(dynamics.snapshot().sampleDisposition).toBe("reversed");
    const resumed = dynamics.processFresh({ jawOpen: 1 }, 1_000, true);
    expect(resumed.jawOpen).toBeGreaterThan(0);
    expect(resumed.jawOpen).toBeLessThan(1);
    expect(dynamics.snapshot()).toMatchObject({ gapRebased: true, dtMs: config.initialStepMs });
  });

  it("keeps state equal to the visible output while Filter is off", () => {
    const dynamics = new FacialExpressionDynamics(config);
    expect(dynamics.processFresh({ browInnerUp: 1 }, 100, false).browInnerUp).toBe(1);
    const afterEnable = dynamics.processFresh({ browInnerUp: 1 }, 133, true);
    expect(afterEnable.browInnerUp).toBe(1);
  });

  it("holds, returns with a fixed smoothstep snapshot, reaches exact zero and reacquires from current", () => {
    const dynamics = new FacialExpressionDynamics(config);
    dynamics.processFresh({ aa: 1 }, 100, false);
    expect(dynamics.processLoss("held", 300, 100, 250, 500, true).aa).toBe(1);
    expect(dynamics.processLoss("returning", 350, 100, 250, 500, true).aa).toBe(1);
    expect(dynamics.processLoss("returning", 600, 100, 250, 500, true).aa).toBeCloseTo(.5);
    expect(dynamics.processLoss("idle", 900, 100, 250, 500, true).aa).toBe(0);
    const reacquired = dynamics.processFresh({ aa: 1 }, 900, true);
    expect(reacquired.aa).toBeGreaterThan(0);
    expect(reacquired.aa).toBeLessThan(1);
    expect(dynamics.snapshot().lifecycle).toBe("reacquiring");
  });

  it("stores post-mix output so a suppressed vowel cannot reappear as hidden energy", () => {
    const dynamics = new FacialExpressionDynamics(config);
    dynamics.processFresh({ aa: 1, mouthClose: 0 }, 100, false);
    const closed = dynamics.processFresh({ aa: 1, mouthClose: 1 }, 133, false);
    expect(closed.aa).toBe(0);
    const reopenedWithoutVowel = dynamics.processFresh({ aa: 0, mouthClose: 0 }, 166, true);
    expect(reopenedWithoutVowel.aa).toBe(0);
  });

  it("resets all temporal and diagnostic state", () => {
    const dynamics = new FacialExpressionDynamics(config);
    dynamics.processFresh({ aa: 1 }, 100, false);
    dynamics.reset();
    expect(dynamics.snapshot()).toMatchObject({ lifecycle: "idle", sampleDisposition: "reset", final: {} });
  });
});
