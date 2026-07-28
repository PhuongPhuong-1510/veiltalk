import { describe, expect, it } from "vitest";
import { DEFAULT_HAND_TWIST_TEMPORAL_CONFIG, INITIAL_HAND_TWIST_TEMPORAL_STATE, updateHandTwistTemporal, type HandTwistTemporalInput, type HandTwistTemporalState } from "./handTwistTemporal";

const DEG = Math.PI / 180;
const input = (mode: HandTwistTemporalInput["observationMode"], overrides: Partial<HandTwistTemporalInput> = {}): HandTwistTemporalInput => ({
  observationMode: mode,
  targetCorrectionRadians: mode === "valid" ? 30 * DEG : null,
  targetInfluenceWeight: mode === "valid" ? 1 : null,
  missingDurationSeconds: 0,
  dtSeconds: 1 / 30,
  ...overrides,
});

describe("Hand twist temporal sample-and-hold", () => {
  it("does not unwrap; it rate-limits an already continuous correction target", () => {
    const initialized = updateHandTwistTemporal(INITIAL_HAND_TWIST_TEMPORAL_STATE, input("valid", { targetCorrectionRadians: 0 })).state;
    const result = updateHandTwistTemporal(initialized, input("valid", { targetCorrectionRadians: 4 }));
    expect(result.angleDeltaRadians).toBeCloseTo(DEFAULT_HAND_TWIST_TEMPORAL_CONFIG.maxAngularVelocityRadPerSecond / 30);
    expect(result.state.acceptedTargetCorrectionRadians).toBe(4);
  });

  it("unsampled advances toward the last accepted target without fading influence", () => {
    let state = updateHandTwistTemporal(INITIAL_HAND_TWIST_TEMPORAL_STATE, input("valid", { targetCorrectionRadians: 1 })).state;
    const before = state;
    const result = updateHandTwistTemporal(state, input("unsampled"));
    expect(result.state.stabilizedTwistRadians).toBeGreaterThan(before.stabilizedTwistRadians);
    expect(result.influenceWeight).toBeGreaterThanOrEqual(before.influenceWeight);
    expect(result.state.lostDurationSeconds).toBe(0);
    expect(result.temporalAdvancedWithoutNewObservation).toBe(true);
  });

  it("duplicate behaves as sample-and-hold, not as a new observation", () => {
    const state = updateHandTwistTemporal(INITIAL_HAND_TWIST_TEMPORAL_STATE, input("valid", { targetCorrectionRadians: 1 })).state;
    const result = updateHandTwistTemporal(state, input("duplicate", { targetCorrectionRadians: 99, targetInfluenceWeight: 0 }));
    expect(result.state.acceptedTargetCorrectionRadians).toBe(1);
    expect(result.state.acceptedTargetInfluenceWeight).toBe(1);
  });

  it("real missing holds through 200ms then fades by real elapsed time", () => {
    let state = INITIAL_HAND_TWIST_TEMPORAL_STATE;
    for (let i = 0; i < 10; i += 1) state = updateHandTwistTemporal(state, input("valid", { targetCorrectionRadians: 0 })).state;
    const initialWeight = state.influenceWeight;
    const held = updateHandTwistTemporal(state, input("missing", { missingDurationSeconds: 0.15 }));
    expect(held.trackingState).toBe("holding");
    expect(held.influenceWeight).toBe(initialWeight);
    const fading = updateHandTwistTemporal(held.state, input("unsampled", { missingDurationSeconds: 0.25 }));
    expect(fading.trackingState).toBe("fading");
    expect(fading.influenceWeight).toBeLessThan(initialWeight);
  });

  it("short missing/reacquire keeps accepted angle continuity and does not snap", () => {
    let state = INITIAL_HAND_TWIST_TEMPORAL_STATE;
    for (let i = 0; i < 10; i += 1) state = updateHandTwistTemporal(state, input("valid", { targetCorrectionRadians: 30 * DEG })).state;
    state = updateHandTwistTemporal(state, input("missing", { missingDurationSeconds: 0.1 })).state;
    const before = state.stabilizedTwistRadians;
    const reacquired = updateHandTwistTemporal(state, input("valid", { targetCorrectionRadians: 40 * DEG }));
    expect(Math.abs(reacquired.stabilizedTwistRadians - before)).toBeLessThanOrEqual(DEFAULT_HAND_TWIST_TEMPORAL_CONFIG.maxAngularVelocityRadPerSecond / 30 + 1e-9);
  });

  it("long real missing fades and resets independently from hold timeout", () => {
    let state: HandTwistTemporalState = INITIAL_HAND_TWIST_TEMPORAL_STATE;
    for (let i = 0; i < 30; i += 1) state = updateHandTwistTemporal(state, input("valid")).state;
    let result = updateHandTwistTemporal(state, input("missing", { missingDurationSeconds: 0.3 }));
    for (let elapsed = 0.4; elapsed <= 3 && !result.resetOccurred; elapsed += 0.1) result = updateHandTwistTemporal(result.state, input("unsampled", { missingDurationSeconds: elapsed, dtSeconds: 0.1 }));
    expect(result.resetOccurred).toBe(true);
    expect(result.state).toEqual(INITIAL_HAND_TWIST_TEMPORAL_STATE);
  });

  it("is approximately FPS invariant for sample-and-hold convergence", () => {
    const run = (fps: number) => {
      let state = updateHandTwistTemporal(INITIAL_HAND_TWIST_TEMPORAL_STATE, input("valid", { targetCorrectionRadians: 1, dtSeconds: 1 / fps })).state;
      for (let i = 1; i < fps; i += 1) state = updateHandTwistTemporal(state, input("unsampled", { dtSeconds: 1 / fps })).state;
      return state;
    };
    const at30 = run(30), at60 = run(60);
    expect(at30.stabilizedTwistRadians).toBeCloseTo(at60.stabilizedTwistRadians, 5);
    expect(at30.influenceWeight).toBeCloseTo(at60.influenceWeight, 5);
  });

  it("rejects non-finite input without mutating state", () => {
    const state = updateHandTwistTemporal(INITIAL_HAND_TWIST_TEMPORAL_STATE, input("valid")).state;
    expect(updateHandTwistTemporal(state, input("valid", { dtSeconds: NaN })).state).toBe(state);
    expect(updateHandTwistTemporal(state, input("valid", { targetCorrectionRadians: Infinity })).state).toBe(state);
  });

  it("does not initialize from unsampled, duplicate or missing without an accepted target", () => {
    for (const mode of ["unsampled", "duplicate", "missing"] as const) {
      const result = updateHandTwistTemporal(INITIAL_HAND_TWIST_TEMPORAL_STATE, input(mode, { missingDurationSeconds: mode === "missing" ? 0.1 : 0 }));
      expect(result.state).toBe(INITIAL_HAND_TWIST_TEMPORAL_STATE);
      expect(result.rejectionReason).toBe("no-accepted-target");
    }
  });

  it("clamps very large dt before applying angular rate limit", () => {
    const state = updateHandTwistTemporal(INITIAL_HAND_TWIST_TEMPORAL_STATE, input("valid", { targetCorrectionRadians: 0 })).state;
    const result = updateHandTwistTemporal(state, input("valid", { targetCorrectionRadians: 100, dtSeconds: 999 }));
    expect(result.angleDeltaRadians).toBeCloseTo(DEFAULT_HAND_TWIST_TEMPORAL_CONFIG.maxAngularVelocityRadPerSecond * DEFAULT_HAND_TWIST_TEMPORAL_CONFIG.maxDtSeconds);
  });

  it("starts both angle and influence without snapping to a non-zero target", () => {
    const result = updateHandTwistTemporal(INITIAL_HAND_TWIST_TEMPORAL_STATE, input("valid", { targetCorrectionRadians: 1, targetInfluenceWeight: 1 }));
    expect(result.stabilizedTwistRadians).toBeLessThan(1);
    expect(result.influenceWeight).toBeLessThan(1);
    expect(result.trackingState).toBe("acquiring");
  });

  it("uses the configured rise and fall rates per second", () => {
    const risen = updateHandTwistTemporal(INITIAL_HAND_TWIST_TEMPORAL_STATE, input("valid", { targetCorrectionRadians: 0, dtSeconds: 0.1 }));
    expect(risen.influenceWeight).toBeCloseTo(DEFAULT_HAND_TWIST_TEMPORAL_CONFIG.riseRatePerSecond * 0.1);
    const faded = updateHandTwistTemporal(risen.state, input("missing", { missingDurationSeconds: 0.3, dtSeconds: 0.1 }));
    expect(risen.influenceWeight - faded.influenceWeight).toBeCloseTo(DEFAULT_HAND_TWIST_TEMPORAL_CONFIG.fallRatePerSecond * 0.1);
  });

  it("holds at the configured boundary and starts fading immediately after it", () => {
    let state = INITIAL_HAND_TWIST_TEMPORAL_STATE;
    for (let i = 0; i < 10; i += 1) state = updateHandTwistTemporal(state, input("valid", { targetCorrectionRadians: 0 })).state;
    const atBoundary = updateHandTwistTemporal(state, input("missing", { missingDurationSeconds: 0.2 }));
    const afterBoundary = updateHandTwistTemporal(atBoundary.state, input("unsampled", { missingDurationSeconds: 0.201 }));
    expect(atBoundary.trackingState).toBe("holding");
    expect(afterBoundary.influenceWeight).toBeLessThan(atBoundary.influenceWeight);
  });

  it("does not reset at resetAfterLostSeconds while influence is still above the reset threshold", () => {
    let state = INITIAL_HAND_TWIST_TEMPORAL_STATE;
    for (let i = 0; i < 30; i += 1) state = updateHandTwistTemporal(state, input("valid")).state;
    const result = updateHandTwistTemporal(state, input("missing", { missingDurationSeconds: DEFAULT_HAND_TWIST_TEMPORAL_CONFIG.resetAfterLostSeconds, dtSeconds: 1 / 240 }));
    expect(result.resetOccurred).toBe(false);
  });

  it("accepts a new continuous correction after short missing without resetting state", () => {
    let state = updateHandTwistTemporal(INITIAL_HAND_TWIST_TEMPORAL_STATE, input("valid", { targetCorrectionRadians: 0.2 })).state;
    state = updateHandTwistTemporal(state, input("missing", { missingDurationSeconds: 0.1 })).state;
    const result = updateHandTwistTemporal(state, input("valid", { targetCorrectionRadians: 0.5 }));
    expect(result.resetOccurred).toBe(false);
    expect(result.state.acceptedTargetCorrectionRadians).toBe(0.5);
  });

  it("rejects non-finite target influence", () => {
    const state = updateHandTwistTemporal(INITIAL_HAND_TWIST_TEMPORAL_STATE, input("valid")).state;
    const result = updateHandTwistTemporal(state, input("valid", { targetInfluenceWeight: Infinity }));
    expect(result.state).toBe(state);
    expect(result.rejectionReason).toBe("non-finite-target");
  });

  it("rejects negative or non-finite missing duration", () => {
    const state = updateHandTwistTemporal(INITIAL_HAND_TWIST_TEMPORAL_STATE, input("valid")).state;
    for (const value of [-1, NaN, Infinity]) expect(updateHandTwistTemporal(state, input("missing", { missingDurationSeconds: value })).state).toBe(state);
  });

  it("keeps state finite and influence bounded across mixed observations", () => {
    let state = INITIAL_HAND_TWIST_TEMPORAL_STATE;
    for (let i = 0; i < 300; i += 1) {
      const mode = i % 11 === 0 ? "missing" : i % 3 === 0 ? "unsampled" : "valid";
      const result = updateHandTwistTemporal(state, input(mode, {
        targetCorrectionRadians: mode === "valid" ? Math.sin(i) : null,
        targetInfluenceWeight: mode === "valid" ? (i % 10) / 9 : null,
        missingDurationSeconds: mode === "missing" ? 0.1 : 0,
      }));
      expect(Object.values(result.state).filter((value): value is number => typeof value === "number").every(Number.isFinite)).toBe(true);
      expect(result.influenceWeight).toBeGreaterThanOrEqual(0);
      expect(result.influenceWeight).toBeLessThanOrEqual(1);
      state = result.state;
    }
  });

  it("missing hold/fade timing is driven by elapsed seconds, not detector frame count", () => {
    const run = (fps: number) => {
      let state = INITIAL_HAND_TWIST_TEMPORAL_STATE;
      for (let i = 0; i < fps; i += 1) state = updateHandTwistTemporal(state, input("valid", { dtSeconds: 1 / fps })).state;
      for (let i = 1; i <= fps; i += 1) state = updateHandTwistTemporal(state, input("unsampled", { dtSeconds: 1 / fps, missingDurationSeconds: i / fps })).state;
      return state.influenceWeight;
    };
    expect(run(30)).toBeCloseTo(run(60), 5);
  });

  it("remains finite for very large continuous correction targets", () => {
    let state = updateHandTwistTemporal(INITIAL_HAND_TWIST_TEMPORAL_STATE, input("valid", { targetCorrectionRadians: 1e9 })).state;
    for (let i = 0; i < 10; i += 1) state = updateHandTwistTemporal(state, input("unsampled")).state;
    expect(Object.values(state).filter((value): value is number => typeof value === "number").every(Number.isFinite)).toBe(true);
  });
});
