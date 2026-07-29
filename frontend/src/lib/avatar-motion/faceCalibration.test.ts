import { describe, expect, it } from "vitest";
import { FaceCalibrationProcessor, type FaceCalibrationConfig } from "./faceCalibration";

const matrix = { rows: 4, columns: 4, data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
const neutral = { jawOpen: .04, eyeBlinkLeft: .02, eyeBlinkRight: .02, eyeLookInLeft: .04, eyeLookOutLeft: .03, eyeLookInRight: .03, eyeLookOutRight: .04, mouthSmileLeft: .03, mouthSmileRight: .03, cheekPuff: .01 };
const config: FaceCalibrationConfig = { targetSamples: 4, minimumSamples: 3, minimumCollectingMs: 20, targetCollectingMs: 30, timeoutMs: 60, minimumAcceptedRatio: .6, minimumNeutralStreak: 2, longLossResetMs: 50, minimumNoiseFloor: .01, maximumNoiseFloor: .15, maximumHeadAngularVelocityRadiansPerSecond: 1 };
describe("face neutral calibration", () => {
  it("collects deliberate neutral samples and normalizes above threshold", () => {
    const value = new FaceCalibrationProcessor(config); value.start(0);
    for (let i = 0; i < 4; i++) value.process("tracked", i * 10 + 10, { ...neutral, jawOpen: .04 + i * .001 }, matrix, i * 10 + 10);
    expect(value.snapshot().status).toBe("ready"); expect(value.snapshot().profile?.expressions.jawOpen.baseline).toBeCloseTo(.0415);
    expect(value.process("tracked", 60, { ...neutral, jawOpen: .6 }, matrix, 60).jawOpen).toBeGreaterThan(0); expect(neutral.jawOpen).toBe(.04);
  });
  it("centers directional eye values on the calibrated neutral baseline", () => {
    const value = new FaceCalibrationProcessor(config); value.start(0);
    for (let i = 0; i < 4; i++) value.process("tracked", i * 10 + 10, neutral, matrix, i * 10 + 10);
    expect(value.process("tracked", 60, neutral, matrix, 60).eyeLookInLeft).toBe(0);
    expect(value.process("tracked", 70, { ...neutral, eyeLookInLeft: .6 }, matrix, 70).eyeLookInLeft).toBeGreaterThan(.5);
  });
  it("rejects expressive, duplicate and invalid frames with traceable reasons", () => {
    const value = new FaceCalibrationProcessor(config); value.start(0);
    value.process("tracked", 10, { ...neutral, jawOpen: .8 }, matrix, 10); value.process("tracked", 10, neutral, matrix, 20); value.process("tracked", 30, { ...neutral, cheekPuff: Number.NaN }, matrix, 30);
    expect(value.snapshot().rejectionReasons).toMatchObject({ mouth: 1, "duplicate-timestamp": 1, "invalid-input": 1 });
  });
  it("fails explicitly without enough neutral samples and never retains an old profile on restart", () => {
    const value = new FaceCalibrationProcessor(config); value.start(0);
    value.process("tracked", 70, { ...neutral, jawOpen: .8 }, matrix, 70); expect(value.snapshot().status).toBe("failed");
    value.start(100); expect(value.snapshot()).toMatchObject({ status: "collecting", profile: null, acceptedSamples: 0 });
  });
  it("resets on timestamp regression and long loss but not short loss", () => {
    const value = new FaceCalibrationProcessor(config); value.start(0); value.process("tracked", 20, neutral, matrix, 20); value.process("lost", null, null, null, 30); expect(value.snapshot().status).toBe("collecting");
    value.process("lost", null, null, null, 90); expect(value.snapshot().status).toBe("idle"); value.start(100); value.process("tracked", 120, neutral, matrix, 120); value.process("tracked", 110, neutral, matrix, 130); expect(value.snapshot().status).toBe("idle");
  });
  it("performs long-loss calibration reset only once until tracking returns", () => {
    const value = new FaceCalibrationProcessor(config); value.start(0); value.process("tracked", 20, neutral, matrix, 20);
    value.process("lost", null, null, null, 30); value.process("lost", null, null, null, 90);
    expect(value.snapshot().status).toBe("idle");
    value.process("lost", null, null, null, 200); expect(value.snapshot().status).toBe("idle");
    value.process("tracked", 220, neutral, matrix, 220); value.start(230); value.process("lost", null, null, null, 240); value.process("lost", null, null, null, 300);
    expect(value.snapshot().status).toBe("idle");
  });
  it("supports cancel without a silent fallback profile", () => { const value = new FaceCalibrationProcessor(config); value.start(0); value.cancel(); expect(value.snapshot()).toMatchObject({ status: "idle", profile: null }); });
});
