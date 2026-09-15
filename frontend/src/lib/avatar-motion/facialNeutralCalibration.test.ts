import { describe, expect, it } from "vitest";
import { FacialNeutralCalibrator, type FacialNeutralCalibrationConfig } from "./facialNeutralCalibration";

const config: FacialNeutralCalibrationConfig = {
  sampleCount: 3, deadZone: .02, neutralActivationLimit: .2,
  adaptiveRate: .05, adaptiveWindow: .08,
};

describe("F1 facial neutral calibration", () => {
  it("learns median neutral bias and keeps real activation above the baseline", () => {
    const calibrator = new FacialNeutralCalibrator(config);
    calibrator.process({ jawOpen: .08, mouthSmileLeft: .03 });
    calibrator.process({ jawOpen: .1, mouthSmileLeft: .04 });
    calibrator.process({ jawOpen: .09, mouthSmileLeft: .02 });
    expect(calibrator.snapshot()).toMatchObject({ state: "ready", collectionMode: "automatic", acceptedSamples: 3, rejectedSamples: 0, baselines: { jawOpen: .09, mouthSmileLeft: .03 } });
    expect(calibrator.process({ jawOpen: .1, mouthSmileLeft: .04 }).jawOpen).toBe(0);
    expect(calibrator.process({ jawOpen: .7, mouthSmileLeft: .03 }).jawOpen).toBeGreaterThan(.6);
  });

  it("does not learn a blink or open mouth as neutral", () => {
    const calibrator = new FacialNeutralCalibrator(config);
    calibrator.process({ jawOpen: .8, eyeBlinkLeft: 0 });
    calibrator.process({ jawOpen: 0, eyeBlinkLeft: .9 });
    expect(calibrator.snapshot().acceptedSamples).toBe(0);
    expect(calibrator.snapshot().rejectedSamples).toBe(2);
    for (let index = 0; index < 3; index += 1) calibrator.process({ jawOpen: .03, eyeBlinkLeft: .02 });
    expect(calibrator.snapshot().state).toBe("ready");
  });

  it("resets all calibration data for a new session or model", () => {
    const calibrator = new FacialNeutralCalibrator(config);
    for (let index = 0; index < 3; index += 1) calibrator.process({ jawOpen: .05 });
    calibrator.reset();
    expect(calibrator.snapshot()).toEqual({ state: "collecting", collectionMode: "automatic", acceptedSamples: 0, rejectedSamples: 0, requiredSamples: 3, baselines: {} });
  });

  it("accepts explicit manual calibration frames even when automatic neutral guard is too strict", () => {
    const calibrator = new FacialNeutralCalibrator(config);
    calibrator.beginCalibration();
    for (let index = 0; index < 3; index += 1) calibrator.process({ jawOpen: .26, browInnerUp: .3 });
    expect(calibrator.snapshot()).toMatchObject({ state: "ready", collectionMode: "manual", acceptedSamples: 3, rejectedSamples: 0 });
  });
});
