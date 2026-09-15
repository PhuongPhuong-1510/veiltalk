import { describe, expect, it } from "vitest";
import { observeGaze } from "./gazeObservation";

const centered = () => ({
  eyeLookInLeft: 0, eyeLookOutLeft: 0, eyeLookUpLeft: 0, eyeLookDownLeft: 0,
  eyeLookInRight: 0, eyeLookOutRight: 0, eyeLookUpRight: 0, eyeLookDownRight: 0,
  eyeBlinkLeft: 0, eyeBlinkRight: 0,
});

describe("observeGaze", () => {
  it("maps conjugate horizontal and vertical evidence to stable semantic signs", () => {
    const positiveHorizontal = centered(); positiveHorizontal.eyeLookOutLeft = .8; positiveHorizontal.eyeLookInRight = .8;
    const up = centered(); up.eyeLookUpLeft = .8; up.eyeLookUpRight = .8;
    expect(observeGaze(positiveHorizontal)).toMatchObject({ yaw: 1, pitch: 0, rejectReason: null });
    expect(observeGaze(up)).toMatchObject({ yaw: 0, pitch: 1, rejectReason: null });
  });

  it("rejects missing/nonfinite inputs and binocular disagreement", () => {
    expect(observeGaze({})).toMatchObject({ quality: 0, rejectReason: "missing-eye-look-channels" });
    const invalid = centered(); invalid.eyeLookInLeft = Number.NaN;
    expect(observeGaze(invalid).rejectReason).toBe("nonfinite-eye-look");
    const opposed = centered(); opposed.eyeLookOutLeft = 1; opposed.eyeLookOutRight = 1;
    expect(observeGaze(opposed).rejectReason).toBe("conjugate-disagreement");
  });

  it("downweights a blinking eye without turning squint into blink or gaze", () => {
    const input = centered(); input.eyeLookOutLeft = 1; input.eyeLookInRight = 1; input.eyeBlinkLeft = 1;
    const result = observeGaze(input);
    expect(result.yaw).toBeCloseTo(1);
    expect(result.left.weight).toBe(0);
  });

  it("reports bilateral closure separately from conjugate disagreement", () => {
    const input = centered(); input.eyeBlinkLeft = 1; input.eyeBlinkRight = 1;
    expect(observeGaze(input).rejectReason).toBe("eyes-closed");
  });
});
