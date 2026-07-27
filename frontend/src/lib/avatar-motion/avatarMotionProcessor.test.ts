import { describe, expect, it } from "vitest";
import type { RawTrackingFrameV1 } from "../tracking/rawTrackingTypes";
import { AvatarMotionProcessor } from "./avatarMotionProcessor";
import type { NormalizedAvatarRigProfile } from "./normalizedRigProfile";

const identity = { x: 0, y: 0, z: 0, w: 1 }, zero = { x: 0, y: 0, z: 0 };
const basis = (right: boolean) => ({ primaryLocal: { x: right ? -1 : 1, y: 0, z: 0 }, secondaryLocal: { x: 0, y: 1, z: 0 }, binormalLocal: { x: 0, y: 0, z: right ? -1 : 1 }, primaryWorld: { x: right ? -1 : 1, y: 0, z: 0 }, secondaryWorld: { x: 0, y: 1, z: 0 }, binormalWorld: { x: 0, y: 0, z: right ? -1 : 1 }, worldRotation: right ? { x: 0, y: 1, z: 0, w: 0 } : identity });
const joint = (right: boolean, lower: boolean) => ({ parentJoint: `${right ? "right" : "left"}${lower ? "UpperArm" : "Shoulder"}` as const, childJoint: `${right ? "right" : "left"}${lower ? "Hand" : "LowerArm"}` as const, parentMode: lower ? "controlled" as const : "fixed-rest" as const, controlledParentJoint: lower ? `${right ? "right" : "left"}UpperArm` as const : null, restLocalPosition: zero, restLocalRotation: identity, restWorldPosition: zero, restWorldRotation: identity, parentRestWorldRotation: identity, restWorldDirection: { x: right ? -1 : 1, y: 0, z: 0 }, anatomicalRestBasis: basis(right) });
const rigProfile: NormalizedAvatarRigProfile = { version: 1, modelGeneration: 1, modelFingerprint: "phase2-test", torsoReference: { rightWorld: { x: 1, y: 0, z: 0 }, upWorld: { x: 0, y: 1, z: 0 }, forwardWorld: { x: 0, y: 0, z: 1 }, worldRotation: identity }, joints: { leftUpperArm: joint(false, false), leftLowerArm: joint(false, true), rightUpperArm: joint(true, false), rightLowerArm: joint(true, true) } };
const lm = (x: number, y: number, z = 0) => ({ x, y, z, visibility: 1 });
function frame(state: "tracked" | "lost" | "not-sampled" = "tracked"): RawTrackingFrameV1 {
  const pose = Array.from({ length: 33 }, () => lm(0, 0)); pose[11] = lm(-.2, .3); pose[13] = lm(-.5, .3); pose[15] = lm(-.8, .3); pose[12] = lm(.2, .3); pose[14] = lm(.5, .3); pose[16] = lm(.8, .3);
  return { version: 1, frameTimestampMs: 100, overall: state === "tracked" ? "full" : "lost", face: { state, sampledAtMs: 100, landmarks: null, blendshapes: { eyeBlinkLeft: 2 }, facialTransform: null }, leftHand: { state, sampledAtMs: 100, handedness: "left", handednessScore: 1, landmarks: null, worldLandmarks: null }, rightHand: { state, sampledAtMs: 100, handedness: "right", handednessScore: 1, landmarks: null, worldLandmarks: null }, pose: { state, sampledAtMs: 100, landmarks: pose, worldLandmarks: pose } };
}

describe("AvatarMotionProcessor Phase 2", () => {
  it("emits parent-local arm deltas only after a valid rig profile is installed", () => { const processor = new AvatarMotionProcessor({ filtered: false, now: () => 120 }); expect(processor.process(frame()).jointRotations).toEqual({}); processor.setRigProfile(rigProfile); expect(processor.process(frame()).jointRotations.leftUpperArm).toBeDefined(); });
  it("keeps the packet serializable and excludes raw landmarks", () => { const processor = new AvatarMotionProcessor({ filtered: false, now: () => 120 }); processor.setRigProfile(rigProfile); const packet = processor.process(frame()); const serialized = JSON.stringify(packet); expect(packet.expressions.eyeBlinkLeft).toBe(1); expect(serialized).not.toMatch(/landmarks|worldLandmarks/); });
  it("does not reuse a stale pose", () => { const processor = new AvatarMotionProcessor({ now: () => 1_000 }); processor.setRigProfile(rigProfile); expect(processor.process(frame()).jointRotations).toEqual({}); });
  it("keeps not-sampled distinct in the transport state", () => { let now = 110; const processor = new AvatarMotionProcessor({ filtered: false, now: () => now }); processor.setRigProfile(rigProfile); processor.process(frame()); now = 130; const packet = processor.process(frame("not-sampled")); expect(packet.tracking.pose.sourceState).toBe("not-sampled"); expect(packet.tracking.pose.outputState).toBe("active"); expect(packet.jointRotations).toEqual({}); });
});
