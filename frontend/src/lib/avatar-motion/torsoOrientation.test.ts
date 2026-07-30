import { describe, expect, it } from "vitest";
import { createDebugPreset } from "../avatar-renderer/avatarDiagnostics";
import { inspectTorsoBasis } from "./torsoBasis";
import { buildTorsoSemanticObservation, solveTorsoOrientation, torsoQuaternionFromSemanticEuler, TorsoCalibrationProcessor } from "./torsoOrientation";
import { multiplyQuaternions } from "./motionMath";

const observation = (name: Parameters<typeof createDebugPreset>[0]) => { const landmarks = createDebugPreset(name).pose.worldLandmarks!; return buildTorsoSemanticObservation(landmarks, inspectTorsoBasis(landmarks)); };
describe("3E-03 torso neutral and semantic response", () => {
  it("calibrates only unique valid stable Pose samples", () => {
    const calibration = new TorsoCalibrationProcessor(); calibration.start(); const neutral = observation("tPose");
    calibration.process("tracked", 1, neutral); calibration.process("tracked", 1, neutral); expect(calibration.snapshot()).toMatchObject({ status: "collecting", acceptedSamples: 1, rejectedSamples: 1, rejectionReason: "duplicate-timestamp" });
    for (let i = 2; i <= 12; i++) calibration.process("tracked", i, neutral); expect(calibration.snapshot().status).toBe("ready"); expect(calibration.snapshot().neutral).not.toBeNull();
  });
  it("returns neutral identity and continuous dead-zone output", () => {
    const neutral = observation("tPose").basis!.worldRotation; const result = solveTorsoOrientation(observation("tPose"), neutral);
    expect(result.neutralRelative).toMatchObject({ x: 0, y: 0, z: 0, w: 1 }); expect(result.outputEulerDegrees).toEqual({ yaw: 0, pitch: 0, roll: 0 });
  });
  it("separates yaw, pitch and roll with opposite signs", () => {
    const neutral = observation("tPose").basis!.worldRotation;
    const left = solveTorsoOrientation(observation("torsoYawLeft"), neutral).inputEulerDegrees!; const right = solveTorsoOrientation(observation("torsoYawRight"), neutral).inputEulerDegrees!;
    const forward = solveTorsoOrientation(observation("torsoPitchForward"), neutral).inputEulerDegrees!; const back = solveTorsoOrientation(observation("torsoPitchBack"), neutral).inputEulerDegrees!;
    const rollLeft = solveTorsoOrientation(observation("torsoRollLeft"), neutral).inputEulerDegrees!; const rollRight = solveTorsoOrientation(observation("torsoRollRight"), neutral).inputEulerDegrees!;
    expect(left.yaw * right.yaw).toBeLessThan(0); expect(forward.pitch * back.pitch).toBeLessThan(0); expect(rollLeft.roll * rollRight.roll).toBeLessThan(0);
    expect(Math.abs(left.pitch)).toBeLessThan(1); expect(Math.abs(rollLeft.yaw)).toBeLessThan(1);
    expect(solveTorsoOrientation(observation("torsoYawLeft"), neutral).outputEulerDegrees!.yaw * left.yaw).toBeLessThan(0);
  });
  it("maps yaw nearly 1:1 before a soft 80 degree limit", () => {
    const neutralObservation = observation("tPose"); const neutral = neutralObservation.basis!.worldRotation;
    const at45 = structuredClone(neutralObservation); at45.basis!.worldRotation = multiplyQuaternions(neutral, torsoQuaternionFromSemanticEuler({ yaw: 45, pitch: 0, roll: 0 }));
    const at90 = structuredClone(neutralObservation); at90.basis!.worldRotation = multiplyQuaternions(neutral, torsoQuaternionFromSemanticEuler({ yaw: 90, pitch: 0, roll: 0 }));
    expect(solveTorsoOrientation(at45, neutral).outputEulerDegrees!.yaw).toBeCloseTo(-45, 6);
    const limited = solveTorsoOrientation(at90, neutral).outputEulerDegrees!.yaw; expect(limited).toBeLessThan(-75); expect(limited).toBeGreaterThan(-80);
  });
  it("keeps shoulder-only body roll conservative around a slightly uneven neutral posture", () => {
    const neutralObservation = observation("tPose"); const neutral = neutralObservation.basis!.worldRotation;
    const tilted = structuredClone(neutralObservation); tilted.basis!.worldRotation = multiplyQuaternions(neutral, torsoQuaternionFromSemanticEuler({ yaw: 0, pitch: 0, roll: 8.1 }));
    const output = solveTorsoOrientation(tilted, neutral).outputEulerDegrees!.roll;
    expect(output).toBeGreaterThan(5); expect(output).toBeLessThan(5.5);
  });
  it("rejects unavailable neutral and low visibility explicitly", () => {
    expect(solveTorsoOrientation(observation("tPose"), null).rejectionReason).toBe("neutral-unavailable"); const low = observation("tPose"); low.basis = null; low.rejectionReason = "low-visibility"; expect(solveTorsoOrientation(low, null).rejectionReason).toBe("low-visibility");
  });
  it("uses shoulder-only yaw/roll and never consumes head landmarks when hips are hidden", () => {
    const frame = createDebugPreset("torsoYawLeft"); const landmarks = frame.pose.worldLandmarks!; landmarks[23].visibility = 0; landmarks[24].visibility = 0;
    const semantic = buildTorsoSemanticObservation(landmarks, inspectTorsoBasis(landmarks)); const neutral = observation("tPose").basis!.worldRotation; const result = solveTorsoOrientation(semantic, neutral);
    expect(result.mode).toBe("shoulder-only"); expect(result.pitchObservable).toBe(false); expect(result.inputEulerDegrees?.yaw).not.toBe(0); expect(result.outputEulerDegrees?.pitch).toBe(0);
    const headMoved = structuredClone(landmarks); headMoved[0] = { x: .5, y: -.8, z: -.9, visibility: 1 }; headMoved[7] = { x: .4, y: -.7, z: -.8, visibility: 1 }; headMoved[8] = { x: .6, y: -.7, z: -.8, visibility: 1 };
    const afterHeadMove = solveTorsoOrientation(buildTorsoSemanticObservation(headMoved, inspectTorsoBasis(headMoved)), neutral);
    expect(afterHeadMove.outputEulerDegrees).toEqual(result.outputEulerDegrees);
  });
});
