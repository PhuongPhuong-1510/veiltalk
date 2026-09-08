import { describe, expect, it } from "vitest";
import { DEFAULT_AVATAR_MOTION_CONFIG } from "./motionConfig";
import { createWristEvidenceState, updateWristEvidence } from "./wristEvidence";

const lm = (x: number, y: number, z = 0, visibility = 1) => ({ x, y, z, visibility });
const config = DEFAULT_AVATAR_MOTION_CONFIG.wristEvidence;

describe("wrist evidence", () => {
  it("prefers a fresh Pose world wrist", () => {
    const state = createWristEvidenceState();
    const value = updateWristEvidence(state, {
      nowMs: 100, poseSampledAtMs: 100, poseObservationIsNew: true, poseValid: true,
      poseWorld: lm(.2, .3, .4), poseImage: lm(.6, .4),
      handObservationIsNew: false, handMatched: false, handSampledAtMs: null, handImage: null,
    }, config);
    expect(value.source).toBe("pose-world");
    expect(value.requiresReacquireBlend).toBe(false);
    expect(value.poseWorld).toEqual({ x: .2, y: .3, z: .4 });
  });

  it("requires elapsed detector samples before Hand can replace Pose", () => {
    const state = createWristEvidenceState();
    updateWristEvidence(state, {
      nowMs: 0, poseSampledAtMs: 0, poseObservationIsNew: true, poseValid: true,
      poseWorld: lm(.2, .3, .4), poseImage: lm(.6, .4),
      handObservationIsNew: false, handMatched: false, handSampledAtMs: null, handImage: null,
    }, config);
    const first = updateWristEvidence(state, {
      nowMs: 40, poseSampledAtMs: 40, poseObservationIsNew: true, poseValid: false,
      poseWorld: null, poseImage: lm(.61, .41, 0, .1),
      handObservationIsNew: true, handMatched: true, handSampledAtMs: 40, handImage: lm(.61, .41),
    }, config);
    expect(first.source).toBe("held");
    const second = updateWristEvidence(state, {
      nowMs: 100, poseSampledAtMs: 100, poseObservationIsNew: true, poseValid: false,
      poseWorld: null, poseImage: lm(.62, .42, 0, .1),
      handObservationIsNew: true, handMatched: true, handSampledAtMs: 100, handImage: lm(.62, .42),
    }, config);
    expect(second.source).toBe("hand-image");
    expect(second.requiresReacquireBlend).toBe(true);
  });

  it("does not promote a Hand source on duplicate render frames", () => {
    const state = createWristEvidenceState();
    updateWristEvidence(state, {
      nowMs: 10, poseSampledAtMs: 10, poseObservationIsNew: true, poseValid: false,
      poseWorld: null, poseImage: null,
      handObservationIsNew: true, handMatched: true, handSampledAtMs: 10, handImage: lm(.5, .5),
    }, config);
    const duplicate = updateWristEvidence(state, {
      nowMs: 100, poseSampledAtMs: 10, poseObservationIsNew: false, poseValid: false,
      poseWorld: null, poseImage: null,
      handObservationIsNew: false, handMatched: true, handSampledAtMs: 10, handImage: lm(.5, .5),
    }, config);
    expect(duplicate.source).toBe("unavailable");
  });

  it("does not replace an active Pose source with cached Hand evidence on a duplicate frame", () => {
    const state = createWristEvidenceState();
    updateWristEvidence(state, {
      nowMs: 0, poseSampledAtMs: 0, poseObservationIsNew: true, poseValid: true,
      poseWorld: lm(.2, .3), poseImage: lm(.6, .4),
      handObservationIsNew: true, handMatched: true, handSampledAtMs: 0, handImage: lm(.6, .4),
    }, config);
    const duplicate = updateWristEvidence(state, {
      nowMs: 100, poseSampledAtMs: 0, poseObservationIsNew: false, poseValid: false,
      poseWorld: null, poseImage: null,
      handObservationIsNew: false, handMatched: false, handSampledAtMs: 0, handImage: null,
    }, config);
    expect(duplicate.source).toBe("pose-world");
    expect(duplicate.requiresReacquireBlend).toBe(false);
  });

  it("adapts grace to 11 FPS but caps very slow cadence", () => {
    const state = createWristEvidenceState();
    for (const sampledAtMs of [0, 91, 182]) {
      updateWristEvidence(state, {
        nowMs: sampledAtMs, poseSampledAtMs: sampledAtMs, poseObservationIsNew: true, poseValid: true,
        poseWorld: lm(.2, .3), poseImage: lm(.6, .4),
        handObservationIsNew: false, handMatched: false, handSampledAtMs: null, handImage: null,
      }, config);
    }
    const value = updateWristEvidence(state, {
      nowMs: 190, poseSampledAtMs: 182, poseObservationIsNew: false, poseValid: false,
      poseWorld: null, poseImage: null,
      handObservationIsNew: false, handMatched: false, handSampledAtMs: null, handImage: null,
    }, config);
    expect(value.effectiveGraceMs).toBeCloseTo(136.5);

    updateWristEvidence(state, {
      nowMs: 1_000, poseSampledAtMs: 1_000, poseObservationIsNew: true, poseValid: false,
      poseWorld: null, poseImage: null,
      handObservationIsNew: false, handMatched: false, handSampledAtMs: null, handImage: null,
    }, config);
    expect(updateWristEvidence(state, {
      nowMs: 1_001, poseSampledAtMs: 1_000, poseObservationIsNew: false, poseValid: false,
      poseWorld: null, poseImage: null,
      handObservationIsNew: false, handMatched: false, handSampledAtMs: null, handImage: null,
    }, config).effectiveGraceMs).toBeLessThanOrEqual(config.maximumGraceMs);
  });
});
