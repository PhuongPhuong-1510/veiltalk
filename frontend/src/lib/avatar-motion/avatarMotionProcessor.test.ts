import { describe, expect, it } from "vitest";
import type { RawTrackingFrameV1 } from "../tracking/rawTrackingTypes";
import { AvatarMotionProcessor } from "./avatarMotionProcessor";
import type { NormalizedAvatarRigProfile } from "./normalizedRigProfile";

const identity = { x: 0, y: 0, z: 0, w: 1 };
const zero = { x: 0, y: 0, z: 0 };
const leftBasis = { primaryLocal: { x: 1, y: 0, z: 0 }, secondaryLocal: { x: 0, y: 1, z: 0 }, binormalLocal: { x: 0, y: 0, z: 1 }, primaryWorld: { x: 1, y: 0, z: 0 }, secondaryWorld: { x: 0, y: 1, z: 0 }, binormalWorld: { x: 0, y: 0, z: 1 }, worldRotation: identity };
const rightBasis = { primaryLocal: { x: -1, y: 0, z: 0 }, secondaryLocal: { x: 0, y: 1, z: 0 }, binormalLocal: { x: 0, y: 0, z: -1 }, primaryWorld: { x: -1, y: 0, z: 0 }, secondaryWorld: { x: 0, y: 1, z: 0 }, binormalWorld: { x: 0, y: 0, z: -1 }, worldRotation: { x: 0, y: 1, z: 0, w: 0 } };
const rigProfile: NormalizedAvatarRigProfile = { version: 1, modelGeneration: 1, modelFingerprint: "test", torsoReference: { rightWorld: { x: 1, y: 0, z: 0 }, upWorld: { x: 0, y: 1, z: 0 }, forwardWorld: { x: 0, y: 0, z: 1 }, worldRotation: identity }, joints: {
  leftUpperArm: { parentJoint: "leftShoulder", childJoint: "leftLowerArm", parentMode: "fixed-rest", controlledParentJoint: null, restLocalPosition: zero, restLocalRotation: identity, restWorldPosition: zero, restWorldRotation: identity, parentRestWorldRotation: identity, restWorldDirection: { x: 1, y: 0, z: 0 }, anatomicalRestBasis: leftBasis },
  leftLowerArm: { parentJoint: "leftUpperArm", childJoint: "leftHand", parentMode: "controlled", controlledParentJoint: "leftUpperArm", restLocalPosition: zero, restLocalRotation: identity, restWorldPosition: zero, restWorldRotation: identity, parentRestWorldRotation: identity, restWorldDirection: { x: 1, y: 0, z: 0 }, anatomicalRestBasis: leftBasis },
  rightUpperArm: { parentJoint: "rightShoulder", childJoint: "rightLowerArm", parentMode: "fixed-rest", controlledParentJoint: null, restLocalPosition: zero, restLocalRotation: identity, restWorldPosition: zero, restWorldRotation: identity, parentRestWorldRotation: identity, restWorldDirection: { x: -1, y: 0, z: 0 }, anatomicalRestBasis: rightBasis },
  rightLowerArm: { parentJoint: "rightUpperArm", childJoint: "rightHand", parentMode: "controlled", controlledParentJoint: "rightUpperArm", restLocalPosition: zero, restLocalRotation: identity, restWorldPosition: zero, restWorldRotation: identity, parentRestWorldRotation: identity, restWorldDirection: { x: -1, y: 0, z: 0 }, anatomicalRestBasis: rightBasis },
} };

const landmark = (x: number, y: number, z = 0) => ({ x, y, z, visibility: 1 });
function frame(state: "tracked" | "lost" | "not-sampled" = "tracked"): RawTrackingFrameV1 {
  const pose = Array.from({ length: 33 }, () => landmark(0, 0));
  pose[11] = landmark(-.2, .3); pose[13] = landmark(-.5, .3); pose[15] = landmark(-.8, .3);
  pose[12] = landmark(.2, .3); pose[14] = landmark(.5, .3); pose[16] = landmark(.8, .3);
  pose[23] = landmark(-.15, .8); pose[24] = landmark(.15, .8);
  return { version: 1, frameTimestampMs: 42, overall: state === "tracked" ? "full" : "lost",
    face: { state, sampledAtMs: 100, landmarks: state === "lost" ? null : [landmark(0, 0)], blendshapes: { eyeBlinkLeft: 2, jawOpen: .4, mouthSmileLeft: .5, mouthSmileRight: .7 }, facialTransform: { rows: 4, columns: 4, data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] } },
    leftHand: { state, sampledAtMs: 100, handedness: "left", handednessScore: 1, landmarks: null, worldLandmarks: null },
    rightHand: { state, sampledAtMs: 100, handedness: "right", handednessScore: 1, landmarks: null, worldLandmarks: null },
    pose: { state, sampledAtMs: 100, landmarks: pose.map((point) => ({ ...point, x: .5 + point.x * .4, y: .5 + point.y * .4 })), worldLandmarks: pose } };
}

describe("AvatarMotionProcessor", () => {
  it("creates a serializable plain packet with semantic expressions and finite joints", () => {
    const processor = new AvatarMotionProcessor({ filtered: false, now: () => 120 }); processor.setRigProfile(rigProfile); const packet = processor.process(frame());
    expect(packet.version).toBe(1); expect(packet.sequence).toBe(1); expect(packet.expressions.eyeBlinkLeft).toBe(1);
    expect(Object.keys(packet.expressions).length).toBeGreaterThanOrEqual(4); expect(packet.jointRotations.leftUpperArm).toBeDefined();
    const serialized = JSON.stringify(packet); expect(JSON.parse(serialized).version).toBe(1); expect(serialized).not.toMatch(/landmarks|facialTransform/);
  });
  it("keeps not-sampled distinct and holds a briefly lost pose", () => {
    let now = 110; const processor = new AvatarMotionProcessor({ filtered: false, now: () => now }); processor.setRigProfile(rigProfile); processor.process(frame());
    const sampledDiagnostic = processor.getLastDiagnostics()?.arms.left;
    now = 130; const cached = processor.process(frame("not-sampled")); expect(cached.tracking.pose.sourceState).toBe("not-sampled"); expect(cached.tracking.pose.outputState).toBe("active");
    expect(processor.getLastDiagnostics()?.arms.left.sampleDisposition).toBe("not-sampled");
    expect(processor.getLastDiagnostics()?.arms.left.imageBounds).toEqual(sampledDiagnostic?.imageBounds);
    expect(processor.getLastDiagnostics()?.arms.left.hardRejectionReason).toBe(sampledDiagnostic?.hardRejectionReason);
    now = 260; const lost = processor.process(frame("lost")); expect(lost.tracking.pose.outputState).toBe("held");
    now = 500; const returning = processor.process(frame("lost")); expect(returning.tracking.pose.outputState).toBe("returning"); expect(returning.jointRotations.leftUpperArm).not.toEqual(identity);
    now = 900; const idle = processor.process(frame("lost")); expect(idle.tracking.pose.outputState).toBe("idle"); expect(idle.jointRotations.leftUpperArm).toEqual(identity);
    expect(processor.getLastDiagnostics()?.arms.left.lossState).toBe("idle");
  });
  it("holds an exact frozen duplicate without aging arm temporal state", () => {
    let now = 110; const processor = new AvatarMotionProcessor({ filtered: false, now: () => now }); processor.setRigProfile(rigProfile);
    const initial = processor.process(frame()); const initialDiagnostic = processor.getLastDiagnostics()?.arms.left;
    now = 10_000; const duplicate = processor.process(frame()); const diagnostic = processor.getLastDiagnostics()?.arms.left;
    expect(duplicate.jointRotations.leftUpperArm).toEqual(initial.jointRotations.leftUpperArm);
    expect(diagnostic?.sampleDisposition).toBe("duplicate-timestamp"); expect(diagnostic?.lossState).toBe("active");
    expect(diagnostic?.imageBounds).toEqual(initialDiagnostic?.imageBounds); expect(diagnostic?.hardRejectionReason).toBe(initialDiagnostic?.hardRejectionReason);
  });
  it("reports previous then rest torso fallback instead of a null torso", () => {
    let now = 110; const processor = new AvatarMotionProcessor({ filtered: false, now: () => now }); processor.setRigProfile(rigProfile);
    const valid = frame(); processor.process(valid); expect(processor.getLastDiagnostics()?.torso.source).toBe("fresh");
    const cropped = frame(); cropped.pose.sampledAtMs = 120; cropped.pose.worldLandmarks![23].visibility = 0; cropped.pose.worldLandmarks![24].visibility = 0; now = 120;
    processor.process(cropped); expect(processor.getLastDiagnostics()?.torso.source).toBe("previous");
    processor.reset(); processor.setRigProfile(rigProfile); cropped.pose.sampledAtMs = 130; now = 130;
    processor.process(cropped); expect(processor.getLastDiagnostics()?.torso.source).toBe("rest"); expect(processor.getLastDiagnostics()?.torso).not.toBeNull();
  });
  it("does not reuse raw pose when tracking is stale", () => {
    const processor = new AvatarMotionProcessor({ now: () => 1_000 }); const packet = processor.process(frame());
    expect(packet.tracking.pose.outputState).toBe("idle"); expect(packet.jointRotations).toEqual({});
  });
  it("does not solve before a rig profile is installed and resets on profile change", () => {
    const processor = new AvatarMotionProcessor({ filtered: false, now: () => 120 }); expect(processor.process(frame()).jointRotations).toEqual({});
    processor.setRigProfile(rigProfile); expect(processor.process(frame()).jointRotations.leftUpperArm).toBeDefined(); processor.setRigProfile(null); expect(processor.getLastDiagnostics()).toBeNull(); expect(processor.process(frame()).jointRotations).toEqual({});
  });
  it("resets temporal continuity for a reversed sample timestamp", () => {
    let now = 120; const processor = new AvatarMotionProcessor({ filtered: false, now: () => now }); processor.setRigProfile(rigProfile); processor.process(frame());
    const reversed = frame(); reversed.pose.sampledAtMs = 90; reversed.frameTimestampMs = 90; now = 130; processor.process(reversed);
    expect(processor.getLastDiagnostics()?.arms.left.lossState).toBe("active");
  });
  it("gates out-of-frame loss and recovery independently per arm", () => {
    let now = 100; const processor = new AvatarMotionProcessor({ filtered: true, now: () => now }); processor.setRigProfile(rigProfile);
    const sample = (timestamp: number, leftOutside: boolean) => { const value = frame(); value.frameTimestampMs = timestamp; value.pose.sampledAtMs = timestamp; if (leftOutside) value.pose.landmarks![15].x = 1.2; return value; };
    processor.process(sample(100, false)); now = 150; processor.process(sample(150, true));
    expect(processor.getLastDiagnostics()?.arms.left.segmentLossState).toEqual({ upper: "active", lower: "active" }); expect(processor.getLastDiagnostics()?.arms.left.observation.lowerRejectionReason).toBe("wrist-outside-frame");
    now = 260; processor.process(sample(260, true)); expect(processor.getLastDiagnostics()?.arms.left.lossState).toBe("held"); expect(processor.getLastDiagnostics()?.arms.right.lossState).toBe("active");
    now = 300; processor.process(sample(300, false)); expect(processor.getLastDiagnostics()?.arms.left.segmentLossState.lower).toBe("recovering");
    now = 500; processor.process(sample(500, false)); expect(processor.getLastDiagnostics()?.arms.left.segmentLossState).toEqual({ upper: "active", lower: "active" });
  });
  it("updates upper direction while a missing wrist makes only lower hold then return locally", () => {
    let now = 100; const processor = new AvatarMotionProcessor({ filtered: false, now: () => now }); processor.setRigProfile(rigProfile);
    const initial = frame(); const initialPacket = processor.process(initial); const lowerInitial = initialPacket.jointRotations.leftLowerArm;
    const partial = (timestamp: number, elbowY: number) => { const value = frame(); value.frameTimestampMs = timestamp; value.pose.sampledAtMs = timestamp; value.pose.worldLandmarks![13].y = elbowY; value.pose.landmarks![13].y = .5 + elbowY * .4; value.pose.landmarks![15].x = 1.2; return value; };
    now = 150; const movingUpper = processor.process(partial(150, -.5));
    expect(movingUpper.jointRotations.leftUpperArm).not.toEqual(initialPacket.jointRotations.leftUpperArm); expect(movingUpper.jointRotations.leftLowerArm).toEqual(lowerInitial);
    expect(processor.getLastDiagnostics()?.arms.left.segmentLossState).toEqual({ upper: "active", lower: "active" });
    now = 450; const returning = processor.process(partial(450, -.8)); expect(processor.getLastDiagnostics()?.arms.left.segmentLossState.upper).toBe("active"); expect(processor.getLastDiagnostics()?.arms.left.segmentLossState.lower).toBe("returning");
    expect(returning.jointRotations.leftLowerArm).not.toEqual(lowerInitial);
  });
  it("calibrates only observed segments then uses inferred elbow as a temporary fallback", () => {
    let now = 100; const processor = new AvatarMotionProcessor({ filtered: false, now: () => now }); processor.setRigProfile(rigProfile);
    for (const timestamp of [100, 120, 140]) { const observed = frame(); observed.frameTimestampMs = timestamp; observed.pose.sampledAtMs = timestamp; now = timestamp; processor.process(observed); }
    const hidden = frame(); hidden.frameTimestampMs = 160; hidden.pose.sampledAtMs = 160; hidden.pose.landmarks![13].visibility = 0; now = 160; processor.process(hidden);
    const diagnostic = processor.getLastDiagnostics()!.arms.left; expect(diagnostic.elbowInference.source).toBe("inferred-history"); expect(diagnostic.elbowInference.calibratedUpperLength).toBeGreaterThan(0);
    expect(diagnostic.segmentLossState).toEqual({ upper: "recovering", lower: "recovering" });
    const continued = structuredClone(hidden); continued.frameTimestampMs = 360; continued.pose.sampledAtMs = 360; now = 360; processor.process(continued);
    expect(processor.getLastDiagnostics()?.arms.left.segmentLossState).toEqual({ upper: "active", lower: "active" });
  });
});
