import { describe, expect, it } from "vitest";
import { applyHeadResponseCurve, avatarLocalQuaternionFromSemanticEuler, avatarSemanticEulerFromLocalQuaternion, createHeadFrozenPreset, facialTransformToMotionQuaternion, headEulerDegrees, neutralRelativeHeadRotation, solveHeadOrientation } from "./headOrientation";

describe("Phase 3D head coordinate and neutral contract", () => {
  it("reads MediaPipe column-major matrices and locks yaw/pitch/roll signs", () => {
    expect(headEulerDegrees(facialTransformToMotionQuaternion(createHeadFrozenPreset("yaw-left-35"))!).yaw).toBeCloseTo(35, 5);
    expect(headEulerDegrees(facialTransformToMotionQuaternion(createHeadFrozenPreset("yaw-right-35"))!).yaw).toBeCloseTo(-35, 5);
    expect(headEulerDegrees(facialTransformToMotionQuaternion(createHeadFrozenPreset("pitch-up-25"))!).pitch).toBeCloseTo(25, 5);
    expect(headEulerDegrees(facialTransformToMotionQuaternion(createHeadFrozenPreset("pitch-down-25"))!).pitch).toBeCloseTo(-25, 5);
    expect(headEulerDegrees(facialTransformToMotionQuaternion(createHeadFrozenPreset("roll-left-25"))!).roll).toBeCloseTo(25, 5);
    expect(headEulerDegrees(facialTransformToMotionQuaternion(createHeadFrozenPreset("roll-right-25"))!).roll).toBeCloseTo(-25, 5);
  });

  it("removes camera/rest neutral offset using inverse(neutral) times current", () => {
    const neutral = facialTransformToMotionQuaternion(createHeadFrozenPreset("yaw-left-15"))!;
    expect(neutralRelativeHeadRotation(neutral, neutral)).toMatchObject({ x: 0, y: 0, z: 0, w: 1 });
    const current = facialTransformToMotionQuaternion(createHeadFrozenPreset("yaw-left-35"))!;
    expect(headEulerDegrees(neutralRelativeHeadRotation(neutral, current)!).yaw).toBeCloseTo(20, 5);
  });

  it("rejects missing neutral and malformed matrices explicitly", () => {
    expect(solveHeadOrientation(true, createHeadFrozenPreset("neutral"), null).rejectionReason).toBe("neutral-unavailable");
    expect(solveHeadOrientation(true, { rows: 3, columns: 3, data: [] }, { x: 0, y: 0, z: 0, w: 1 }).rejectionReason).toBe("invalid-matrix");
    expect(solveHeadOrientation(false, null, null).rejectionReason).toBe("not-tracked");
  });

  it("removes neutral jitter continuously and increases useful yaw amplitude", () => {
    const tiny = facialTransformToMotionQuaternion(createHeadFrozenPreset("yaw-left-15"))!;
    const oneDegree = { x: 0, y: Math.sin(Math.PI / 360), z: 0, w: Math.cos(Math.PI / 360) };
    expect(applyHeadResponseCurve(oneDegree).outputEulerDegrees.yaw).toBe(0);
    const response = applyHeadResponseCurve(tiny).outputEulerDegrees.yaw;
    expect(response).toBeGreaterThan(15);
    expect(response).toBeLessThan(25);
  });

  it("is monotonic across the dead-zone boundary and clamps implausible input", () => {
    const yaw = (degrees: number) => applyHeadResponseCurve({ x: 0, y: Math.sin(degrees * Math.PI / 360), z: 0, w: Math.cos(degrees * Math.PI / 360) });
    const values = [1.5, 1.51, 5, 15, 35, 60].map((degrees) => yaw(degrees).outputEulerDegrees.yaw);
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(values[1]).toBeGreaterThanOrEqual(0); expect(values[1]).toBeLessThan(.1);
    const extreme = yaw(170); expect(extreme.inputClamped).toBe(true); expect(Math.abs(extreme.outputEulerDegrees.yaw)).toBeLessThanOrEqual(75);
  });

  it("inverts camera pitch when composing the avatar-local output", () => {
    const cameraUp = facialTransformToMotionQuaternion(createHeadFrozenPreset("pitch-up-25"))!;
    const response = applyHeadResponseCurve(cameraUp);
    expect(response.inputEulerDegrees.pitch).toBeCloseTo(25, 5);
    expect(cameraUp.x * response.output.x).toBeLessThan(0);
    const cameraDown = facialTransformToMotionQuaternion(createHeadFrozenPreset("pitch-down-25"))!;
    expect(cameraDown.x * applyHeadResponseCurve(cameraDown).output.x).toBeLessThan(0);
  });

  it("round-trips avatar semantic Euler without reusing the camera pitch inversion", () => {
    const semantic = { yaw: 28, pitch: -17, roll: 9 };
    const roundTrip = avatarSemanticEulerFromLocalQuaternion(avatarLocalQuaternionFromSemanticEuler(semantic));
    expect(roundTrip.yaw).toBeCloseTo(semantic.yaw, 6);
    expect(roundTrip.pitch).toBeCloseTo(semantic.pitch, 6);
    expect(roundTrip.roll).toBeCloseTo(semantic.roll, 6);
  });
});
