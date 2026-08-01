import { describe, expect, it } from "vitest";
import type { RawHandCandidateV1, RawTrackingFrameV1 } from "../tracking/rawTrackingTypes";
import { AvatarMotionProcessor } from "./avatarMotionProcessor";
import type { NormalizedAvatarRigProfile } from "./normalizedRigProfile";
import { buildIdleArmPose } from "./idleArmPose";
import { rotateVector, vectorAngularDeltaDegrees } from "./motionMath";
import { DEFAULT_AVATAR_MOTION_CONFIG } from "./motionConfig";

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
    rawHands: [], handSampledThisFrame: state !== "not-sampled", handSampledAtMs: state === "not-sampled" ? null : 100,
    pose: { state, sampledAtMs: 100, landmarks: pose.map((point) => ({ ...point, x: .5 + point.x * .4, y: .5 + point.y * .4 })), worldLandmarks: pose },
    videoWidth: 1280, videoHeight: 720 };
}

// Pose left wrist (index 15) và right wrist (index 16) trong frame() map sang image space
// tại (.18, .62) và (.82, .62) theo công thức x: .5+point.x*.4, y: .5+point.y*.4 ở trên.
const LEFT_WRIST_IMAGE = { x: .18, y: .62 };
const RIGHT_WRIST_IMAGE = { x: .82, y: .62 };
function handCandidate(sourceIndex: number, wristImage: { x: number; y: number }, handedness: RawHandCandidateV1["handedness"], sampledAtMs = 100): RawHandCandidateV1 {
  const wrist = { x: wristImage.x, y: wristImage.y, z: 0, visibility: 1 };
  // 21 landmark Hand Landmarker: wrist=0, indexMcp=5, middleMcp=9, pinkyMcp=17 cần khác biệt để palm basis hợp lệ.
  const landmarks = Array.from({ length: 21 }, () => ({ x: wristImage.x, y: wristImage.y, z: 0, visibility: 1 }));
  landmarks[0] = wrist;
  landmarks[5] = { x: wristImage.x + .05, y: wristImage.y, z: 0, visibility: 1 };
  landmarks[9] = { x: wristImage.x + .02, y: wristImage.y - .08, z: 0, visibility: 1 };
  landmarks[17] = { x: wristImage.x - .05, y: wristImage.y, z: 0, visibility: 1 };
  const worldLandmarks = landmarks.map((point, index) => ({ ...point, z: index === 9 ? .01 : 0 }));
  return { sourceIndex, sampledAtMs, handedness, handednessScore: 0.9, landmarks, worldLandmarks };
}

function handCandidateWithMiddleDepth(sourceIndex: number, wristImage: { x: number; y: number }, handedness: RawHandCandidateV1["handedness"], sampledAtMs: number, middleDepth: number): RawHandCandidateV1 {
  const candidate = handCandidate(sourceIndex, wristImage, handedness, sampledAtMs);
  candidate.worldLandmarks![9] = { ...candidate.worldLandmarks![9], z: middleDepth };
  return candidate;
}

function sampledFrame(timestamp: number): RawTrackingFrameV1 {
  const value = frame();
  value.frameTimestampMs = timestamp;
  value.pose.sampledAtMs = timestamp;
  value.handSampledAtMs = timestamp;
  return value;
}

function setPoseLandmark(value: RawTrackingFrameV1, index: number, x: number, y: number, z = 0, visibility = 1): void {
  value.pose.worldLandmarks![index] = { x, y, z, visibility };
  value.pose.landmarks![index] = { x: .5 + x * .4, y: .5 + y * .4, z, visibility };
}

function leftElbow90Frame(timestamp: number): RawTrackingFrameV1 {
  const value = sampledFrame(timestamp);
  setPoseLandmark(value, 11, -.2, .3);
  setPoseLandmark(value, 13, -.5, .3);
  setPoseLandmark(value, 15, -.5, .6);
  return value;
}

function edgeOnLeftHand(timestamp: number): RawHandCandidateV1 {
  const candidate = handCandidate(0, LEFT_WRIST_IMAGE, "left", timestamp);
  const wrist = candidate.worldLandmarks![0];
  candidate.worldLandmarks![5] = { x: wrist.x, y: wrist.y + .05, z: wrist.z, visibility: 1 };
  candidate.worldLandmarks![17] = { x: wrist.x, y: wrist.y - .05, z: wrist.z, visibility: 1 };
  candidate.worldLandmarks![9] = { x: wrist.x, y: wrist.y, z: wrist.z + .08, visibility: 1 };
  return candidate;
}

describe("AvatarMotionProcessor", () => {
  describe("Mức 2B-5 Hand twist wiring", () => {
    it("feature flag defaults off and remains bit-for-bit Pose-only", () => {
      const input = frame(); input.rawHands = [handCandidate(0, LEFT_WRIST_IMAGE, "left"), handCandidate(1, RIGHT_WRIST_IMAGE, "right")];
      const poseOnly = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: false, now: () => 120 }); poseOnly.setRigProfile(rigProfile);
      const explicitlyOff = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: false, now: () => 120 }); explicitlyOff.setRigProfile(rigProfile);
      expect(explicitlyOff.process(input).jointRotations).toEqual(poseOnly.process(input).jointRotations);
      expect(explicitlyOff.getLastDiagnostics()?.handTwist.left.handTwistApplied).toBe(false);
    });

    it("first trusted Hand anchors neutral, then correction changes only lowerArm", () => {
      let now = 120;
      const off = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: false, now: () => now }); off.setRigProfile(rigProfile);
      const on = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: true, now: () => now }); on.setRigProfile(rigProfile);
      const neutral = frame(); neutral.rawHands = [handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", 100, 0.01)];
      const neutralPose = off.process(neutral); const neutralTwist = on.process(neutral);
      expect(neutralTwist.jointRotations).toEqual(neutralPose.jointRotations);
      expect(on.getLastDiagnostics()!.handTwist.left).toMatchObject({ neutralReanchored: true, correctedTwistRadians: 0, handTwistApplied: false });
      const movedAt = 133; now = 153;
      const moved = frame(); moved.frameTimestampMs = movedAt; moved.pose.sampledAtMs = movedAt; moved.handSampledAtMs = movedAt;
      moved.rawHands = [handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", movedAt, 0.08)];
      const pose = off.process(moved); const twisted = on.process(moved);
      expect(twisted.jointRotations.leftUpperArm).toEqual(pose.jointRotations.leftUpperArm);
      expect(twisted.jointRotations.rightUpperArm).toEqual(pose.jointRotations.rightUpperArm);
      expect(twisted.jointRotations.rightLowerArm).toEqual(pose.jointRotations.rightLowerArm);
      expect(twisted.jointRotations.leftLowerArm).not.toEqual(pose.jointRotations.leftLowerArm);
      const diagnostic = on.getLastDiagnostics()!.handTwist.left;
      expect(diagnostic).toMatchObject({ selectedPalmAxis: "normal", chiralityCorrectionApplied: true, configuredPositiveSign: 1, observationMode: "valid", trusted: true, neutralReanchored: false, handTwistApplied: true, unwrapOwner: "handTwistStabilization" });
      expect(Object.values(twisted.jointRotations.leftLowerArm!)).toSatisfy((values: number[]) => values.every(Number.isFinite));
    });

    it("2B-5C exposes the complete scalar diagnostic chain independently for left and right", () => {
      let now = 120;
      const processor = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: true, now: () => now });
      processor.setRigProfile(rigProfile);
      const neutral = frame();
      neutral.rawHands = [
        handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", 100, 0.01),
        handCandidateWithMiddleDepth(1, RIGHT_WRIST_IMAGE, "right", 100, 0.01),
      ];
      processor.process(neutral);

      now = 153;
      const moved = frame(); moved.frameTimestampMs = 133; moved.pose.sampledAtMs = 133; moved.handSampledAtMs = 133;
      moved.rawHands = [
        handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", 133, 0.08),
        handCandidateWithMiddleDepth(1, RIGHT_WRIST_IMAGE, "right", 133, 0.08),
      ];
      processor.process(moved);

      for (const side of ["left", "right"] as const) {
        const diagnostic = processor.getLastDiagnostics()!.handTwist[side];
        for (const key of [
          "rawWrappedTwistRadians", "rawUnwrappedTwistRadians", "neutralTwistRadians",
          "correctedTwistRadians", "deadZoneOutputRadians", "filteredTargetTwistRadians",
          "clampedTwistRadians", "targetInfluenceWeight", "temporalInfluenceWeight",
          "appliedTwistRadians",
        ] as const) expect(Number.isFinite(diagnostic[key])).toBe(true);
        expect(diagnostic).toMatchObject({
          trusted: true, rejectionReason: null, clampApplied: false, observationMode: "valid",
        });
      }
    });

    it("duplicate timestamp is ignored as observation but temporal advances toward held target", () => {
      let now = 120; const processor = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: true, now: () => now }); processor.setRigProfile(rigProfile);
      const neutral = frame(); neutral.rawHands = [handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", 100, 0.01)]; processor.process(neutral);
      const movedAt = 133; now = 153; const moved = frame(); moved.pose.sampledAtMs = movedAt; moved.handSampledAtMs = movedAt; moved.rawHands = [handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", movedAt, 0.08)]; processor.process(moved);
      const first = processor.getLastDiagnostics()!.handTwist.left;
      now += 33; processor.process(moved);
      const duplicate = processor.getLastDiagnostics()!.handTwist.left;
      expect(duplicate).toMatchObject({ observationMode: "duplicate", observationWasNew: false, duplicateTimestampIgnored: true, rawWrappedTwistRadians: null });
      expect(duplicate.neutralReanchored).toBe(false);
      expect(duplicate.temporalInfluenceWeight).toBeGreaterThanOrEqual(first.temporalInfluenceWeight);
      expect(duplicate.temporalAdvancedWithoutNewObservation).toBe(true);
    });

    it("2B-6: duplicate is gated before matching/palm, preserves wrist continuity, and still ticks temporal", () => {
      let now = 120;
      const processor = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: true, now: () => now });
      processor.setRigProfile(rigProfile);
      const neutral = frame(); neutral.rawHands = [handCandidateWithMiddleDepth(7, LEFT_WRIST_IMAGE, "left", 100, .01)];
      processor.process(neutral);

      const movedAt = 133; now = 153;
      const moved = sampledFrame(movedAt); moved.rawHands = [handCandidateWithMiddleDepth(8, LEFT_WRIST_IMAGE, "left", movedAt, .08)];
      processor.process(moved);
      const before = processor.getLastDiagnostics()!.handTwist.left;

      now = 186;
      const duplicatePacket = processor.process(moved);
      const duplicate = processor.getLastDiagnostics()!.handTwist.left;
      expect(duplicate.sampleClassification).toBe("duplicate");
      expect(duplicatePacket.handMotion?.left.ranMatching).toBe(false);
      expect(duplicatePacket.handMotion?.left.imageBasis).toBeNull();
      expect(duplicatePacket.handMotion?.left.worldBasis).toBeNull();
      expect(duplicate.temporalInfluenceWeight).toBeGreaterThanOrEqual(before.temporalInfluenceWeight);
      expect(duplicate.temporalAdvancedWithoutNewObservation).toBe(true);

      now = 219;
      const continued = sampledFrame(166); continued.rawHands = [handCandidateWithMiddleDepth(99, LEFT_WRIST_IMAGE, "left", 166, .08)];
      const continuedPacket = processor.process(continued);
      expect(continuedPacket.handMotion?.left.matchingContinuity).toBe("continued");
    });

    it("2B-6: rig generation resets matching, starts a new epoch, and anchors neutral once", () => {
      let now = 120;
      const processor = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: true, now: () => now });
      processor.setRigProfile(rigProfile);
      const first = frame(); first.rawHands = [handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", 100, .01)];
      processor.process(first);
      const before = processor.getLastDiagnostics()!.handTwist.left;

      processor.setRigProfile({ ...rigProfile, modelGeneration: 2, modelFingerprint: "test-generation-2" });
      now = 153;
      const afterFrame = sampledFrame(133); afterFrame.rawHands = [handCandidateWithMiddleDepth(42, LEFT_WRIST_IMAGE, "left", 133, .08)];
      const afterPacket = processor.process(afterFrame);
      const after = processor.getLastDiagnostics()!.handTwist.left;
      expect(after.trackingEpochId).toBe(before.trackingEpochId + 1);
      expect(after.trackingEpochResetReason).toBe("rig-profile-change");
      expect(after.matchingStateReset).toBe(true);
      expect(after.matchingStateResetReason).toBe("rig-profile-change");
      expect(afterPacket.handMotion?.left.matchingContinuity).toBe("new");
      expect(after.neutralReanchored).toBe(true);
      expect(after.neutralAnchoredForEpochId).toBe(after.trackingEpochId);
      expect(after.neutralPreservedAcrossEpoch).toBe(false);

      now = 186;
      const next = sampledFrame(166); next.rawHands = [handCandidateWithMiddleDepth(43, LEFT_WRIST_IMAGE, "left", 166, .09)];
      processor.process(next);
      expect(processor.getLastDiagnostics()!.handTwist.left.neutralReanchored).toBe(false);
    });

    it("2B-6: short reacquire preserves epoch/neutral and sourceIndex reorder does not create an epoch", () => {
      let now = 120;
      const processor = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: true, now: () => now });
      processor.setRigProfile(rigProfile);
      const first = frame(); first.rawHands = [handCandidateWithMiddleDepth(3, LEFT_WRIST_IMAGE, "left", 100, .01)];
      processor.process(first);
      const initial = processor.getLastDiagnostics()!.handTwist.left;

      now = 153;
      const reordered = sampledFrame(133); reordered.rawHands = [handCandidateWithMiddleDepth(99, LEFT_WRIST_IMAGE, "left", 133, .08)];
      processor.process(reordered);
      expect(processor.getLastDiagnostics()!.handTwist.left.trackingEpochId).toBe(initial.trackingEpochId);

      now = 186;
      const missing = sampledFrame(166); missing.rawHands = []; processor.process(missing);
      now = 219;
      const reacquired = sampledFrame(199); reacquired.rawHands = [handCandidateWithMiddleDepth(5, { x: LEFT_WRIST_IMAGE.x + .26, y: LEFT_WRIST_IMAGE.y }, "left", 199, .09)];
      processor.process(reacquired);
      const after = processor.getLastDiagnostics()!.handTwist.left;
      expect(after.matchingContinuity).toBe("reacquired");
      expect(after.trackingEpochId).toBe(initial.trackingEpochId);
      expect(after.neutralTwistRadians).toBe(initial.neutralTwistRadians);
      expect(after.neutralReanchored).toBe(false);
    });

    it("2B-6 regression: long Hand loss resets volatile state but preserves calibrated neutral", () => {
      let now = 120;
      const processor = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: true, now: () => now });
      processor.setRigProfile(rigProfile);
      const first = frame(); first.rawHands = [handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", 100, .01)]; processor.process(first);
      const epoch = processor.getLastDiagnostics()!.handTwist.left.trackingEpochId;
      const initialNeutral = processor.getLastDiagnostics()!.handTwist.left.neutralTwistRadians;

      now = 153; const missing = sampledFrame(133); missing.rawHands = []; processor.process(missing);
      now = 2_500; const unsampled = frame("not-sampled"); unsampled.frameTimestampMs = 2_500; processor.process(unsampled);
      const reset = processor.getLastDiagnostics()!.handTwist.left;
      expect(reset.trackingEpochId).toBe(epoch + 1);
      expect(reset.trackingEpochResetReason).toBe("long-loss-temporal-reset");
      expect(reset.matchingStateReset).toBe(true);
      expect(reset.lastAppliedTwistRadians).toBe(0);
      expect(reset.neutralPreservedAcrossEpoch).toBe(true);

      now = 2_533;
      const reacquired = sampledFrame(2_533); reacquired.rawHands = [handCandidateWithMiddleDepth(10, LEFT_WRIST_IMAGE, "left", 2_533, .08)];
      const packet = processor.process(reacquired);
      const anchored = processor.getLastDiagnostics()!.handTwist.left;
      expect(packet.handMotion?.left.matchingContinuity).toBe("new");
      expect(anchored.neutralReanchored).toBe(false);
      expect(anchored.neutralPreservedAcrossEpoch).toBe(true);
      expect(anchored.neutralTwistRadians).toBe(initialNeutral);
      expect(Math.abs(anchored.appliedTwistRadians)).toBeGreaterThan(1e-6);

      now = 2_566;
      const next = sampledFrame(2_566); next.rawHands = [handCandidateWithMiddleDepth(11, LEFT_WRIST_IMAGE, "left", 2_566, .09)]; processor.process(next);
      expect(processor.getLastDiagnostics()!.handTwist.left.neutralReanchored).toBe(false);
    });

    it("2B-6: reset/dispose clear both matching and prior epoch output", () => {
      let now = 120;
      const processor = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: true, now: () => now });
      processor.setRigProfile(rigProfile);
      const first = frame(); first.rawHands = [handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", 100, .01)]; processor.process(first);
      const initialEpoch = processor.getLastDiagnostics()!.handTwist.left.trackingEpochId;

      processor.reset(); now = 153;
      const afterReset = sampledFrame(133); afterReset.rawHands = [handCandidateWithMiddleDepth(1, LEFT_WRIST_IMAGE, "left", 133, .08)]; processor.process(afterReset);
      const resetDiagnostic = processor.getLastDiagnostics()!.handTwist.left;
      expect(resetDiagnostic.trackingEpochId).toBe(initialEpoch + 1);
      expect(resetDiagnostic.appliedTwistRadians).toBe(0);
      expect(resetDiagnostic.neutralReanchored).toBe(true);
      expect(resetDiagnostic.neutralPreservedAcrossEpoch).toBe(false);

      processor.dispose(); processor.setRigProfile(rigProfile); now = 186;
      const afterDispose = sampledFrame(166); afterDispose.rawHands = [handCandidateWithMiddleDepth(2, LEFT_WRIST_IMAGE, "left", 166, -.08)]; processor.process(afterDispose);
      const disposeDiagnostic = processor.getLastDiagnostics()!.handTwist.left;
      expect(disposeDiagnostic.trackingEpochId).toBe(resetDiagnostic.trackingEpochId + 2);
      expect(disposeDiagnostic.appliedTwistRadians).toBe(0);
      expect(disposeDiagnostic.neutralReanchored).toBe(true);
      expect(disposeDiagnostic.neutralPreservedAcrossEpoch).toBe(false);
    });

    it("2B-6 regression: a side-specific timestamp discontinuity preserves only that side's neutral", () => {
      let now = 120;
      const processor = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: true, now: () => now });
      processor.setRigProfile(rigProfile);
      const both = frame(); both.rawHands = [
        handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", 100, .01),
        handCandidateWithMiddleDepth(1, RIGHT_WRIST_IMAGE, "right", 100, .01),
      ];
      processor.process(both);

      now = 153;
      const leftAhead = sampledFrame(133); leftAhead.rawHands = [handCandidateWithMiddleDepth(2, LEFT_WRIST_IMAGE, "left", 133, .08)];
      processor.process(leftAhead);
      const before = processor.getLastDiagnostics()!.handTwist;
      const leftNeutralBeforeReset = before.left.neutralTwistRadians;

      now = 186;
      const rollbackForLeft = sampledFrame(166); rollbackForLeft.handSampledAtMs = 120; rollbackForLeft.rawHands = [
        handCandidateWithMiddleDepth(3, LEFT_WRIST_IMAGE, "left", 120, .09),
        handCandidateWithMiddleDepth(4, RIGHT_WRIST_IMAGE, "right", 120, .08),
      ];
      processor.process(rollbackForLeft);
      const after = processor.getLastDiagnostics()!.handTwist;
      expect(after.left.trackingEpochId).toBe(before.left.trackingEpochId + 1);
      expect(after.left.trackingEpochResetReason).toBe("tracking-discontinuity");
      expect(after.left.neutralPreservedAcrossEpoch).toBe(true);
      expect(after.right.trackingEpochId).toBe(before.right.trackingEpochId);
      expect(after.right.neutralReanchored).toBe(false);

      now = 219;
      const firstTrustedAfterReset = sampledFrame(199);
      firstTrustedAfterReset.rawHands = [handCandidateWithMiddleDepth(5, LEFT_WRIST_IMAGE, "left", 199, .08)];
      processor.process(firstTrustedAfterReset);
      const anchored = processor.getLastDiagnostics()!.handTwist.left;
      expect(anchored.neutralReanchored).toBe(false);
      expect(anchored.neutralPreservedAcrossEpoch).toBe(true);
      expect(anchored.neutralTwistRadians).toBe(leftNeutralBeforeReset);
    });

    it("2B-6: right-only and both-hands samples modify exactly their lowerArm outputs", () => {
      let now = 120;
      const poseOnly = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: false, now: () => now }); poseOnly.setRigProfile(rigProfile);
      const rightOnly = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: true, now: () => now }); rightOnly.setRigProfile(rigProfile);
      const bothHands = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: true, now: () => now }); bothHands.setRigProfile(rigProfile);

      const neutralRight = frame(); neutralRight.rawHands = [handCandidateWithMiddleDepth(1, RIGHT_WRIST_IMAGE, "right", 100, .01)]; rightOnly.process(neutralRight);
      const neutralBoth = frame(); neutralBoth.rawHands = [
        handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", 100, .01),
        handCandidateWithMiddleDepth(1, RIGHT_WRIST_IMAGE, "right", 100, .01),
      ]; bothHands.process(neutralBoth);

      now = 153;
      const movedRight = sampledFrame(133); movedRight.rawHands = [handCandidateWithMiddleDepth(9, RIGHT_WRIST_IMAGE, "right", 133, .09)];
      const poseRight = poseOnly.process(movedRight); const outputRight = rightOnly.process(movedRight);
      expect(outputRight.jointRotations.rightLowerArm).not.toEqual(poseRight.jointRotations.rightLowerArm);
      expect(outputRight.jointRotations.leftLowerArm).toEqual(poseRight.jointRotations.leftLowerArm);
      expect(outputRight.jointRotations.rightUpperArm).toEqual(poseRight.jointRotations.rightUpperArm);
      const rightDiagnostic = rightOnly.getLastDiagnostics()!.handTwist.right;
      expect(rightDiagnostic.rigApplicationSign).toBe(1);
      expect(Math.sign(rightDiagnostic.appliedTwistRadians)).toBe(Math.sign(rightDiagnostic.filteredTargetTwistRadians!));

      const movedBoth = sampledFrame(133); movedBoth.rawHands = [
        handCandidateWithMiddleDepth(10, LEFT_WRIST_IMAGE, "left", 133, .09),
        handCandidateWithMiddleDepth(11, RIGHT_WRIST_IMAGE, "right", 133, .09),
      ];
      const outputBoth = bothHands.process(movedBoth);
      expect(outputBoth.jointRotations.leftLowerArm).not.toEqual(poseRight.jointRotations.leftLowerArm);
      expect(outputBoth.jointRotations.rightLowerArm).not.toEqual(poseRight.jointRotations.rightLowerArm);
      expect(outputBoth.jointRotations.leftUpperArm).toEqual(poseRight.jointRotations.leftUpperArm);
      expect(outputBoth.jointRotations.rightUpperArm).toEqual(poseRight.jointRotations.rightUpperArm);
    });

    it("2B-6: pure twist preserves elbow output and lowerArm primary direction", () => {
      let now = 120;
      const off = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: false, now: () => now }); off.setRigProfile(rigProfile);
      const on = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: true, now: () => now }); on.setRigProfile(rigProfile);
      const neutral = frame(); neutral.rawHands = [handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", 100, .01)]; on.process(neutral); off.process(neutral);
      now = 153;
      const moved = sampledFrame(133); moved.rawHands = [handCandidateWithMiddleDepth(1, LEFT_WRIST_IMAGE, "left", 133, .09)];
      const pose = off.process(moved); const twisted = on.process(moved);
      expect(twisted.jointRotations.leftUpperArm).toEqual(pose.jointRotations.leftUpperArm);
      const primary = rigProfile.joints.leftLowerArm.anatomicalRestBasis.primaryLocal;
      const posePrimary = rotateVector(pose.jointRotations.leftLowerArm!, primary);
      const twistPrimary = rotateVector(twisted.jointRotations.leftLowerArm!, primary);
      expect(vectorAngularDeltaDegrees(posePrimary, twistPrimary)).toBeLessThan(1e-5);
    });

    it("2B-6: neutral -> positive -> neutral -> negative crosses zero without epoch change", () => {
      let now = 120;
      const config = {
        ...DEFAULT_AVATAR_MOTION_CONFIG,
        handTwist: { ...DEFAULT_AVATAR_MOTION_CONFIG.handTwist, deadZoneRadians: 0, targetFilterTimeConstantSeconds: 0 },
      };
      const processor = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: true, now: () => now, config });
      processor.setRigProfile(rigProfile);
      const observe = (timestamp: number, depth: number) => {
        now = timestamp + 20;
        const value = sampledFrame(timestamp); value.rawHands = [handCandidateWithMiddleDepth(timestamp, LEFT_WRIST_IMAGE, "left", timestamp, depth)];
        processor.process(value);
        return processor.getLastDiagnostics()!.handTwist.left;
      };
      const neutral = observe(100, .01);
      const positive = observe(133, .09);
      const backToNeutral = observe(166, .01);
      const negative = observe(199, -.09);
      expect(neutral.correctedTwistRadians).toBeCloseTo(0, 7);
      expect(Math.abs(positive.correctedTwistRadians!)).toBeGreaterThan(.1);
      expect(backToNeutral.correctedTwistRadians).toBeCloseTo(0, 7);
      expect(Math.sign(negative.correctedTwistRadians!)).toBe(-Math.sign(positive.correctedTwistRadians!));
      expect(negative.trackingEpochId).toBe(neutral.trackingEpochId);
    });

    it("2B-6: first trusted sample of a new rig epoch cannot leak the old twist quaternion", () => {
      let now = 120;
      const on = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: true, now: () => now }); on.setRigProfile(rigProfile);
      const off = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: false, now: () => now }); off.setRigProfile(rigProfile);
      const neutral = frame(); neutral.rawHands = [handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", 100, .01)]; on.process(neutral);
      now = 153; const moved = sampledFrame(133); moved.rawHands = [handCandidateWithMiddleDepth(1, LEFT_WRIST_IMAGE, "left", 133, .09)]; on.process(moved);
      expect(on.getLastDiagnostics()!.handTwist.left.handTwistApplied).toBe(true);

      const nextRig = { ...rigProfile, modelGeneration: 2, modelFingerprint: "next-rig" };
      on.setRigProfile(nextRig); off.setRigProfile(nextRig);
      now = 186; const firstNewEpoch = sampledFrame(166); firstNewEpoch.rawHands = [handCandidateWithMiddleDepth(2, LEFT_WRIST_IMAGE, "left", 166, -.09)];
      const twisted = on.process(firstNewEpoch); const pose = off.process(firstNewEpoch);
      expect(twisted.jointRotations).toEqual(pose.jointRotations);
      expect(on.getLastDiagnostics()!.handTwist.left).toMatchObject({ neutralReanchored: true, appliedTwistRadians: 0, handTwistApplied: false });
    });

    it("2B-6 regression: short lower-arm geometry dropout falls back Pose-only without changing epoch or neutral", () => {
      let now = 120;
      const on = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: true, now: () => now }); on.setRigProfile(rigProfile);
      const off = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: false, now: () => now }); off.setRigProfile(rigProfile);
      const neutral = frame(); neutral.rawHands = [handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", 100, .01)]; on.process(neutral); off.process(neutral);
      const initialEpoch = on.getLastDiagnostics()!.handTwist.left.trackingEpochId;
      const initialNeutral = on.getLastDiagnostics()!.handTwist.left.neutralTwistRadians;

      now = 153;
      const invalid = sampledFrame(133);
      setPoseLandmark(invalid, 15, -.5, .3); // wrist == elbow => lower-arm direction degenerate
      invalid.rawHands = [];
      const invalidOn = on.process(invalid); const invalidOff = off.process(invalid);
      expect(invalidOn.jointRotations).toEqual(invalidOff.jointRotations);
      const firstInvalid = on.getLastDiagnostics()!.handTwist;
      expect(firstInvalid.left.trackingEpochId).toBe(initialEpoch);
      expect(firstInvalid.right.trackingEpochId).toBe(initialEpoch);

      now = 186;
      const recovered = sampledFrame(166); recovered.rawHands = [handCandidateWithMiddleDepth(1, LEFT_WRIST_IMAGE, "left", 166, .09)];
      on.process(recovered);
      const recovery = on.getLastDiagnostics()!.handTwist.left;
      expect(recovery.trackingEpochId).toBe(initialEpoch);
      expect(recovery.neutralReanchored).toBe(false);
      expect(recovery.neutralTwistRadians).toBe(initialNeutral);
      expect(Math.abs(recovery.correctedTwistRadians!)).toBeGreaterThan(.01);
    });

    it("2B-6 regression: confirmed geometry loss opens one epoch but keeps calibrated neutral", () => {
      let now = 120;
      const processor = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: true, now: () => now }); processor.setRigProfile(rigProfile);
      const neutral = frame(); neutral.rawHands = [handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", 100, .01)]; processor.process(neutral);
      const initialEpoch = processor.getLastDiagnostics()!.handTwist.left.trackingEpochId;
      const initialNeutral = processor.getLastDiagnostics()!.handTwist.left.neutralTwistRadians;

      const invalidAt = (timestamp: number) => {
        const value = sampledFrame(timestamp); setPoseLandmark(value, 15, -.5, .3); value.rawHands = [];
        return value;
      };
      now = 153; processor.process(invalidAt(133));
      now = 253; processor.process(invalidAt(233)); // vượt invalidGraceMs bằng observation invalid thứ hai
      expect(processor.getLastDiagnostics()!.handTwist.left.trackingEpochId).toBe(initialEpoch);

      now = 286;
      const recovered = sampledFrame(266); recovered.rawHands = [handCandidateWithMiddleDepth(1, LEFT_WRIST_IMAGE, "left", 266, .09)];
      processor.process(recovered);
      const recovery = processor.getLastDiagnostics()!.handTwist.left;
      expect(recovery.trackingEpochId).toBe(initialEpoch + 1);
      expect(recovery.trackingEpochResetReason).toBe("invalid-lower-arm-profile-or-geometry");
      expect(recovery.matchingStateReset).toBe(true);
      expect(recovery.appliedTwistRadians).toBe(0);
      expect(recovery.neutralPreservedAcrossEpoch).toBe(true);
      expect(recovery.neutralTwistRadians).toBe(initialNeutral);

      now = 319;
      const firstTrusted = sampledFrame(299); firstTrusted.rawHands = [handCandidateWithMiddleDepth(2, LEFT_WRIST_IMAGE, "left", 299, -.08)];
      processor.process(firstTrusted);
      const anchored = processor.getLastDiagnostics()!.handTwist.left;
      expect(anchored.trackingEpochId).toBe(initialEpoch + 1);
      expect(anchored.neutralReanchored).toBe(false);
      expect(anchored.neutralPreservedAcrossEpoch).toBe(true);
      expect(Math.abs(anchored.appliedTwistRadians)).toBeGreaterThan(1e-6);
    });

    it("2B-6 regression: repeated lower-arm loss/recovery keeps one physical Hand orientation on one calibration", () => {
      let now = 120;
      const processor = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: true, now: () => now }); processor.setRigProfile(rigProfile);
      const neutral = sampledFrame(100); neutral.rawHands = [handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", 100, .01)]; processor.process(neutral);
      const initialNeutral = processor.getLastDiagnostics()!.handTwist.left.neutralTwistRadians;
      let expectedCorrection: number | null = null;
      let timestamp = 133;

      for (let cycle = 0; cycle < 4; cycle += 1) {
        const invalid = sampledFrame(timestamp); setPoseLandmark(invalid, 15, -.5, .3); invalid.rawHands = [];
        now = timestamp + 20; processor.process(invalid);

        timestamp += 100;
        const confirmedInvalid = sampledFrame(timestamp); setPoseLandmark(confirmedInvalid, 15, -.5, .3); confirmedInvalid.rawHands = [];
        now = timestamp + 20; processor.process(confirmedInvalid);

        timestamp += 33;
        const recovery = sampledFrame(timestamp); recovery.rawHands = [handCandidateWithMiddleDepth(cycle + 1, LEFT_WRIST_IMAGE, "left", timestamp, .08)];
        now = timestamp + 20; processor.process(recovery);

        timestamp += 33;
        const returned = sampledFrame(timestamp); returned.rawHands = [handCandidateWithMiddleDepth(cycle + 10, LEFT_WRIST_IMAGE, "left", timestamp, .08)];
        now = timestamp + 20; processor.process(returned);
        const diagnostic = processor.getLastDiagnostics()!.handTwist.left;

        expect(diagnostic.neutralReanchored).toBe(false);
        expect(diagnostic.neutralPreservedAcrossEpoch).toBe(true);
        expect(diagnostic.neutralTwistRadians).toBe(initialNeutral);
        expect(Math.abs(diagnostic.appliedTwistRadians)).toBeGreaterThan(1e-6);
        if (expectedCorrection === null) expectedCorrection = diagnostic.correctedTwistRadians;
        else expect(diagnostic.correctedTwistRadians).toBeCloseTo(expectedCorrection, 7);

        timestamp += 33;
      }
    });

    it("2B-6 regression: alternating one-frame geometry dropouts never pump epoch or re-anchor neutral", () => {
      let now = 120;
      const processor = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: true, now: () => now }); processor.setRigProfile(rigProfile);
      const neutral = frame(); neutral.rawHands = [handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", 100, .01)]; processor.process(neutral);
      const initial = processor.getLastDiagnostics()!.handTwist.left;

      for (let index = 0; index < 6; index += 1) {
        const invalidTimestamp = 133 + index * 66; now = invalidTimestamp + 20;
        const invalid = sampledFrame(invalidTimestamp); setPoseLandmark(invalid, 15, -.5, .3); invalid.rawHands = [];
        processor.process(invalid);
        expect(processor.getLastDiagnostics()!.handTwist.left.trackingEpochId).toBe(initial.trackingEpochId);

        const validTimestamp = invalidTimestamp + 33; now = validTimestamp + 20;
        const valid = sampledFrame(validTimestamp); valid.rawHands = [handCandidateWithMiddleDepth(index + 1, LEFT_WRIST_IMAGE, "left", validTimestamp, .08)];
        processor.process(valid);
        const diagnostic = processor.getLastDiagnostics()!.handTwist.left;
        expect(diagnostic.trackingEpochId).toBe(initial.trackingEpochId);
        expect(diagnostic.neutralReanchored).toBe(false);
        expect(diagnostic.neutralTwistRadians).toBe(initial.neutralTwistRadians);
      }
    });

    it("2B-6: malformed rig profile remains fail-fast", () => {
      const processor = new AvatarMotionProcessor();
      const malformed = { ...rigProfile, joints: { ...rigProfile.joints, leftLowerArm: undefined } };
      expect(() => processor.setRigProfile(malformed as unknown as NormalizedAvatarRigProfile)).toThrow("Normalized avatar rig profile");
    });

    it("candidateSourceIndex changes while continuity is continued without re-anchoring neutral", () => {
      let now = 120; const processor = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: true, now: () => now }); processor.setRigProfile(rigProfile);
      const neutral = frame(); neutral.rawHands = [handCandidateWithMiddleDepth(3, LEFT_WRIST_IMAGE, "left", 100, 0.01)]; processor.process(neutral);
      const neutralAngle = processor.getLastDiagnostics()!.handTwist.left.neutralTwistRadians;
      const nextAt = 133; now = 153; const next = frame(); next.pose.sampledAtMs = nextAt; next.handSampledAtMs = nextAt; next.rawHands = [handCandidateWithMiddleDepth(99, LEFT_WRIST_IMAGE, "left", nextAt, 0.08)]; processor.process(next);
      const diagnostic = processor.getLastDiagnostics()!.handTwist.left;
      expect(diagnostic.neutralReanchored).toBe(false);
      expect(diagnostic.neutralTwistRadians).toBe(neutralAngle);
      expect(diagnostic.correctedTwistRadians).not.toBe(0);
    });

    it("manual neutral calibration reanchors only the requested side and clears its old output", () => {
      let now = 120;
      const processor = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: true, now: () => now });
      processor.setRigProfile(rigProfile);
      const neutral = frame(); neutral.rawHands = [
        handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", 100, .01),
        handCandidateWithMiddleDepth(1, RIGHT_WRIST_IMAGE, "right", 100, .01),
      ];
      processor.process(neutral);

      now = 153;
      const moved = sampledFrame(133); moved.rawHands = [
        handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", 133, .08),
        handCandidateWithMiddleDepth(1, RIGHT_WRIST_IMAGE, "right", 133, .08),
      ];
      processor.process(moved);
      const before = processor.getLastDiagnostics()!.handTwist;
      expect(Math.abs(before.right.appliedTwistRadians)).toBeGreaterThan(0);

      processor.calibrateHandTwistNeutral("right");
      now = 186;
      const calibration = sampledFrame(166); calibration.rawHands = [
        handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", 166, .08),
        handCandidateWithMiddleDepth(1, RIGHT_WRIST_IMAGE, "right", 166, .08),
      ];
      processor.process(calibration);
      const after = processor.getLastDiagnostics()!.handTwist;
      expect(after.right).toMatchObject({
        neutralReanchored: true,
        neutralReanchorReason: "manual-neutral-calibration",
        correctedTwistRadians: 0,
        appliedTwistRadians: 0,
      });
      expect(after.right.trackingEpochId).toBe(before.right.trackingEpochId);
      expect(after.left.neutralTwistRadians).toBe(before.left.neutralTwistRadians);
      expect(after.left.neutralReanchored).toBe(false);
    });

    it("manual neutral calibration survives a later long Hand loss on the same rig", () => {
      let now = 120;
      const processor = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: true, now: () => now });
      processor.setRigProfile(rigProfile);
      const initial = frame(); initial.rawHands = [handCandidateWithMiddleDepth(1, RIGHT_WRIST_IMAGE, "right", 100, .01)]; processor.process(initial);

      now = 153;
      const moved = sampledFrame(133); moved.rawHands = [handCandidateWithMiddleDepth(1, RIGHT_WRIST_IMAGE, "right", 133, .08)]; processor.process(moved);
      processor.calibrateHandTwistNeutral("right");

      now = 186;
      const calibration = sampledFrame(166); calibration.rawHands = [handCandidateWithMiddleDepth(1, RIGHT_WRIST_IMAGE, "right", 166, .08)]; processor.process(calibration);
      const manualNeutral = processor.getLastDiagnostics()!.handTwist.right.neutralTwistRadians;

      now = 219;
      const missing = sampledFrame(199); missing.rawHands = []; processor.process(missing);
      now = 2_500;
      const resetTick = frame("not-sampled"); resetTick.frameTimestampMs = 2_500; processor.process(resetTick);
      expect(processor.getLastDiagnostics()!.handTwist.right.neutralPreservedAcrossEpoch).toBe(true);

      now = 2_533;
      const returned = sampledFrame(2_533); returned.rawHands = [handCandidateWithMiddleDepth(1, RIGHT_WRIST_IMAGE, "right", 2_533, .09)]; processor.process(returned);
      const diagnostic = processor.getLastDiagnostics()!.handTwist.right;
      expect(diagnostic.neutralReanchored).toBe(false);
      expect(diagnostic.neutralPreservedAcrossEpoch).toBe(true);
      expect(diagnostic.neutralTwistRadians).toBe(manualNeutral);
      expect(Math.abs(diagnostic.appliedTwistRadians)).toBeGreaterThan(1e-6);
    });

    it("trusted observations acquire full steady-state amplitude for both sides", () => {
      const halfTurn = Math.PI / 2;
      expect(DEFAULT_AVATAR_MOTION_CONFIG.handTwist.correctionLimits).toEqual({
        left: { minRadians: -halfTurn, maxRadians: halfTurn },
        right: { minRadians: -halfTurn, maxRadians: halfTurn },
      });
      for (const side of ["left", "right"] as const) {
        let now = 120;
        const processor = new AvatarMotionProcessor({
          filtered: false,
          handTwistEnabled: true,
          now: () => now,
          config: {
            ...DEFAULT_AVATAR_MOTION_CONFIG,
            handTwist: { ...DEFAULT_AVATAR_MOTION_CONFIG.handTwist, deadZoneRadians: 0, targetFilterTimeConstantSeconds: 0 },
          },
        });
        processor.setRigProfile(rigProfile);
        const wrist = side === "left" ? LEFT_WRIST_IMAGE : RIGHT_WRIST_IMAGE;
        const neutral = frame(); neutral.rawHands = [handCandidateWithMiddleDepth(0, wrist, side, 100, .01)];
        processor.process(neutral);

        for (let index = 1; index <= 12; index += 1) {
          now += 33;
          const sampledAtMs = 100 + index * 33;
          const turned = sampledFrame(sampledAtMs);
          turned.rawHands = [handCandidateWithMiddleDepth(0, wrist, side, sampledAtMs, .08)];
          processor.process(turned);
        }
        const diagnostic = processor.getLastDiagnostics()!.handTwist[side];
        expect(diagnostic.trusted).toBe(true);
        expect(diagnostic.targetInfluenceWeight).toBe(1);
        expect(diagnostic.temporalInfluenceWeight).toBe(1);
        expect(Math.abs(diagnostic.appliedTwistRadians)).toBeCloseTo(Math.abs(diagnostic.clampedTwistRadians!), 6);
      }
    });

    it("keeps invalid Hand fallback identical to Pose-only", () => {
      const invalid = frame(); invalid.rawHands = [];
      const off = new AvatarMotionProcessor({ filtered: false, now: () => 120 }); off.setRigProfile(rigProfile);
      const on = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: true, now: () => 120 }); on.setRigProfile(rigProfile);
      expect(on.process(invalid).jointRotations).toEqual(off.process(invalid).jointRotations);
      expect(on.getLastDiagnostics()!.handTwist.left.temporalInfluenceWeight).toBe(0);
    });

    it("keeps left/right temporal state independent and clears state on reset or rig generation change", () => {
      let now = 120; const processor = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: true, now: () => now }); processor.setRigProfile(rigProfile);
      const neutral = frame(); neutral.rawHands = [handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", 100, 0.01)]; processor.process(neutral);
      expect(processor.getLastDiagnostics()!.handTwist.left.temporalInfluenceWeight).toBeGreaterThan(0);
      expect(processor.getLastDiagnostics()!.handTwist.right.temporalInfluenceWeight).toBe(0);
      processor.reset(); now = 153; processor.process(frame());
      expect(processor.getLastDiagnostics()!.handTwist.left.temporalInfluenceWeight).toBe(0);
      processor.setRigProfile({ ...rigProfile, modelGeneration: 2, modelFingerprint: "test-2" });
      now = 186; processor.process(frame());
      expect(processor.getLastDiagnostics()!.handTwist.left.temporalTrackingState).toBe("inactive");
    });

    it("unsampled holds target without pumping; real missing holds then fades; short reacquire preserves neutral", () => {
      let now = 120; const processor = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: true, now: () => now }); processor.setRigProfile(rigProfile);
      const neutral = frame(); neutral.rawHands = [handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", 100, 0.01)]; processor.process(neutral);
      const movedAt = 133; now = 153; const moved = frame(); moved.pose.sampledAtMs = movedAt; moved.handSampledAtMs = movedAt; moved.rawHands = [handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", movedAt, 0.08)]; processor.process(moved);
      const active = processor.getLastDiagnostics()!.handTwist.left;

      now += 33;
      const staggered = frame("not-sampled"); staggered.frameTimestampMs = 133; processor.process(staggered);
      const held = processor.getLastDiagnostics()!.handTwist.left;
      expect(held.observationMode).toBe("unsampled");
      expect(held.temporalInfluenceWeight).toBeGreaterThanOrEqual(active.temporalInfluenceWeight);
      expect(held.missingDurationMs).toBe(0);

      const missingAt = movedAt + 66; now = missingAt + 20; const missing = frame(); missing.pose.sampledAtMs = missingAt; missing.handSampledAtMs = missingAt; missing.rawHands = []; processor.process(missing);
      expect(processor.getLastDiagnostics()!.handTwist.left).toMatchObject({ observationMode: "missing", observationWasNew: true, missingSinceMs: now });
      const missingSince = now; now = missingSince + 50; processor.process(frame("not-sampled"));
      expect(processor.getLastDiagnostics()!.handTwist.left).toMatchObject({ observationMode: "unsampled", temporalTrackingState: "holding", missingDurationMs: 50 });
      now = missingSince + 250; processor.process(frame("not-sampled"));
      expect(processor.getLastDiagnostics()!.handTwist.left).toMatchObject({ temporalTrackingState: "inactive", temporalInfluenceWeight: 0, handTwistApplied: false });

      const reacquiredAt = missingAt + 300; now = reacquiredAt + 20;
      const reacquired = frame(); reacquired.frameTimestampMs = reacquiredAt; reacquired.pose.sampledAtMs = reacquiredAt; reacquired.handSampledAtMs = reacquiredAt; reacquired.rawHands = [handCandidateWithMiddleDepth(0, { x: LEFT_WRIST_IMAGE.x + 0.26, y: LEFT_WRIST_IMAGE.y }, "left", reacquiredAt, 0.08)]; processor.process(reacquired);
      const reacquireDiagnostic = processor.getLastDiagnostics()!.handTwist.left;
      expect(reacquireDiagnostic.neutralReanchored).toBe(false);
      expect(reacquireDiagnostic.neutralPreservedOnReacquire).toBe(true);
      expect(reacquireDiagnostic.neutralTwistRadians).toBe(active.neutralTwistRadians);

      now = 2_000;
      const discontinuity = frame(); discontinuity.frameTimestampMs = 2_000; discontinuity.pose.sampledAtMs = 2_000;
      discontinuity.handSampledAtMs = 2_000; discontinuity.rawHands = []; processor.process(discontinuity);
      expect(processor.getLastDiagnostics()!.handTwist.left.temporalInfluenceWeight).toBe(0);
      expect(processor.getLastDiagnostics()!.handTwist.left.handTwistApplied).toBe(false);
    });
  });

  describe("2B-5D Arm Stability root-cause audit", () => {
    it("1. Pose-only: exact hold is stable, while deterministic landmark noise appears first in Pose targets", () => {
      let now = 0;
      const processor = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: false, now: () => now });
      processor.setRigProfile(rigProfile);
      processor.process(leftElbow90Frame(0));
      now = 33; processor.process(leftElbow90Frame(33));
      const held = processor.getLastDiagnostics()!.armStability.left;
      expect(held).toMatchObject({
        elbowSource: "observed",
        elbowSourceChanged: false,
        poseConfidence: 1,
        poseTrackingState: "active",
        frameDtMs: 33,
        poseSampleAgeMs: 0,
        handSampleAgeMs: 0,
      });
      expect(held.poseUpperTargetAngularDeltaRadians).toBeLessThan(1e-7);
      expect(held.poseLowerTargetAngularDeltaRadians).toBeLessThan(1e-7);
      expect(held.poseUpperAppliedAngularDeltaRadians).toBeLessThan(1e-7);
      expect(held.poseLowerAppliedAngularDeltaRadians).toBeLessThan(1e-7);

      now = 66;
      const noisy = leftElbow90Frame(66);
      setPoseLandmark(noisy, 13, -.5, .303);
      setPoseLandmark(noisy, 15, -.497, .6);
      processor.process(noisy);
      const diagnostic = processor.getLastDiagnostics()!.armStability.left;
      expect(diagnostic.poseUpperTargetAngularDeltaRadians).toBeGreaterThan(0);
      expect(diagnostic.poseLowerTargetAngularDeltaRadians).toBeGreaterThan(0);
      expect(diagnostic.poseUpperAppliedAngularDeltaRadians).toBeCloseTo(diagnostic.poseUpperTargetAngularDeltaRadians!, 7);
      expect(diagnostic.poseLowerAppliedAngularDeltaRadians).toBeCloseTo(diagnostic.poseLowerTargetAngularDeltaRadians!, 7);
      expect(diagnostic.elbowSourceChanged).toBe(false);
      expect(diagnostic.poleBranchChanged).toBe(false);
      expect(diagnostic.trusted).toBe(false);
      expect(diagnostic.handAppliedTwistDeltaRadians).toBe(0);
    });

    it("2. Twist on: stationary Pose stays stable and only Hand target noise reaches applied twist", () => {
      let now = 0;
      const processor = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: true, now: () => now });
      processor.setRigProfile(rigProfile);
      const neutral = sampledFrame(0);
      neutral.rawHands = [handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", 0, .01)];
      processor.process(neutral);
      now = 33;
      const turned = sampledFrame(33);
      turned.rawHands = [handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", 33, .08)];
      processor.process(turned);
      let previousInfluence = processor.getLastDiagnostics()!.armStability.left.temporalInfluenceWeight;
      for (let timestamp = 66; timestamp <= 396; timestamp += 33) {
        now = timestamp;
        const held = sampledFrame(timestamp);
        held.rawHands = [handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", timestamp, .08)];
        processor.process(held);
        const heldDiagnostic = processor.getLastDiagnostics()!.armStability.left;
        expect(heldDiagnostic.handRawTwistDeltaRadians).toBeLessThan(1e-7);
        expect(heldDiagnostic.temporalInfluenceWeight).toBeGreaterThanOrEqual(previousInfluence);
        previousInfluence = heldDiagnostic.temporalInfluenceWeight;
      }
      now = 429;
      const noisy = sampledFrame(429);
      noisy.rawHands = [handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", 429, .079)];
      const packet = processor.process(noisy);
      const diagnostic = processor.getLastDiagnostics()!.armStability.left;
      expect(diagnostic.poseUpperTargetAngularDeltaRadians).toBeLessThan(1e-7);
      expect(diagnostic.poseLowerTargetAngularDeltaRadians).toBeLessThan(1e-7);
      expect(diagnostic.poseUpperAppliedAngularDeltaRadians).toBeLessThan(1e-7);
      expect(diagnostic.poseLowerAppliedAngularDeltaRadians).toBeLessThan(1e-7);
      expect(diagnostic.handRawTwistDeltaRadians).toBeGreaterThan(0);
      expect(diagnostic.handAppliedTwistDeltaRadians).toBeGreaterThan(0);
      expect(diagnostic.handAppliedTwistDeltaRadians).toBeLessThan(diagnostic.handRawTwistDeltaRadians!);
      expect(diagnostic.trusted).toBe(true);
      const poseOnly = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: false, now: () => now });
      poseOnly.setRigProfile(rigProfile);
      const posePacket = poseOnly.process(noisy);
      const primary = rigProfile.joints.leftLowerArm.anatomicalRestBasis.primaryLocal;
      expect(vectorAngularDeltaDegrees(
        rotateVector(packet.jointRotations.leftLowerArm!, primary),
        rotateVector(posePacket.jointRotations.leftLowerArm!, primary),
      )).toBeLessThan(1e-5);
    });

    it("3. Near-straight arm reports pole branch transitions instead of hiding them", () => {
      let now = 0;
      const processor = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: false, now: () => now });
      processor.setRigProfile(rigProfile);
      const withOffset = (timestamp: number, elbowY: number) => {
        const value = sampledFrame(timestamp);
        setPoseLandmark(value, 13, -.5, elbowY);
        return value;
      };
      processor.process(withOffset(0, .34));
      now = 33; processor.process(withOffset(33, .312));
      const degraded = processor.getLastDiagnostics()!.armStability.left;
      expect(degraded.poleSource).toBe("previous");
      expect(degraded.poleBranchChanged).toBe(true);
      expect(degraded.poseUpperTargetAngularDeltaRadians).toBeGreaterThan(0);
      now = 66; processor.process(withOffset(66, .34));
      const reacquired = processor.getLastDiagnostics()!.armStability.left;
      expect(reacquired.poleSource).toBe("fresh");
      expect(reacquired.poleBranchChanged).toBe(true);
      expect(processor.getLastDiagnostics()!.arms.left.trackingReacquired).toBe(true);
    });

    it("4. Elbow at 90 degrees has a stable high-quality pole for identical samples", () => {
      let now = 0;
      const processor = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: false, now: () => now });
      processor.setRigProfile(rigProfile);
      processor.process(leftElbow90Frame(0));
      now = 33; processor.process(leftElbow90Frame(33));
      const diagnostic = processor.getLastDiagnostics()!.armStability.left;
      expect(diagnostic.poleSource).toBe("fresh");
      expect(diagnostic.poleQuality).toBeGreaterThan(.5);
      expect(diagnostic.poleBranchChanged).toBe(false);
      expect(diagnostic.poseUpperTargetAngularDeltaRadians).toBeLessThan(1e-7);
      expect(diagnostic.poseLowerTargetAngularDeltaRadians).toBeLessThan(1e-7);
    });

    it("5. Edge-on palm rejects projection-degenerate Hand geometry without moving the arm", () => {
      let now = 0;
      const processor = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: true, now: () => now });
      processor.setRigProfile(rigProfile);
      const value = sampledFrame(0);
      value.rawHands = [edgeOnLeftHand(0)];
      processor.process(value);
      const hand = processor.getLastDiagnostics()!.handTwist.left;
      const stability = processor.getLastDiagnostics()!.armStability.left;
      expect(hand.rejectionReason).toBe("projection-degenerate");
      expect(stability).toMatchObject({ trusted: false, targetInfluenceWeight: 0, temporalInfluenceWeight: 0 });
      expect(stability.handRawTwistDeltaRadians).toBeNull();
      expect(hand.appliedTwistRadians).toBe(0);
    });

    it("6. A short Hand miss/unsampled/reacquire sequence preserves neutral and exposes each observation mode", () => {
      let now = 0;
      const processor = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: true, now: () => now });
      processor.setRigProfile(rigProfile);
      const neutral = sampledFrame(0); neutral.rawHands = [handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", 0, .01)]; processor.process(neutral);
      const neutralAngle = processor.getLastDiagnostics()!.handTwist.left.neutralTwistRadians;
      now = 33; const turned = sampledFrame(33); turned.rawHands = [handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", 33, .08)]; processor.process(turned);
      now = 66; const missing = sampledFrame(66); missing.rawHands = []; processor.process(missing);
      expect(processor.getLastDiagnostics()!.armStability.left.observationMode).toBe("missing");
      now = 99; const unsampled = sampledFrame(99); unsampled.handSampledThisFrame = false; unsampled.handSampledAtMs = null; unsampled.rawHands = []; processor.process(unsampled);
      expect(processor.getLastDiagnostics()!.armStability.left.observationMode).toBe("unsampled");
      now = 132; const reacquired = sampledFrame(132); reacquired.rawHands = [handCandidateWithMiddleDepth(0, LEFT_WRIST_IMAGE, "left", 132, .08)]; processor.process(reacquired);
      const hand = processor.getLastDiagnostics()!.handTwist.left;
      const stability = processor.getLastDiagnostics()!.armStability.left;
      expect(stability.observationMode).toBe("valid");
      expect(stability.neutralReanchored).toBe(false);
      expect(hand.neutralTwistRadians).toBe(neutralAngle);
      expect(Number.isFinite(stability.handAppliedTwistDeltaRadians)).toBe(true);
    });

    it("7. Elbow visibility hysteresis reports only the real threshold crossings", () => {
      let now = 0;
      const processor = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: false, now: () => now });
      processor.setRigProfile(rigProfile);
      const withVisibility = (timestamp: number, visibility: number) => {
        const value = leftElbow90Frame(timestamp);
        value.pose.landmarks![13].visibility = visibility;
        return value;
      };
      for (const timestamp of [0, 20, 40]) { now = timestamp; processor.process(withVisibility(timestamp, .61)); }
      now = 60; processor.process(withVisibility(60, .5));
      expect(processor.getLastDiagnostics()!.armStability.left).toMatchObject({ elbowSource: "observed", elbowSourceChanged: false, poseConfidence: .5 });
      now = 80; processor.process(withVisibility(80, .29));
      expect(processor.getLastDiagnostics()!.armStability.left).toMatchObject({ elbowSource: "inferred-history", elbowSourceChanged: true, poseConfidence: .29 });
      now = 100; processor.process(withVisibility(100, .59));
      expect(processor.getLastDiagnostics()!.armStability.left).toMatchObject({ elbowSource: "inferred-history", elbowSourceChanged: false, poseConfidence: .59 });
      now = 120; processor.process(withVisibility(120, .61));
      expect(processor.getLastDiagnostics()!.armStability.left).toMatchObject({ elbowSource: "observed", elbowSourceChanged: true, poseConfidence: .61 });
    });

    it("8. Variable FPS/dt changes cadence diagnostics but cannot create motion from identical Pose input", () => {
      let now = 0;
      const processor = new AvatarMotionProcessor({ filtered: false, handTwistEnabled: false, now: () => now });
      processor.setRigProfile(rigProfile);
      const timestamps = [0, 16, 66, 99, 199];
      processor.process(leftElbow90Frame(0));
      for (let index = 1; index < timestamps.length; index += 1) {
        const timestamp = timestamps[index];
        now = timestamp; processor.process(leftElbow90Frame(timestamp));
        const diagnostic = processor.getLastDiagnostics()!.armStability.left;
        expect(diagnostic.frameDtMs).toBe(timestamp - timestamps[index - 1]);
        expect(diagnostic.poseSampleAgeMs).toBe(0);
        expect(diagnostic.poseUpperTargetAngularDeltaRadians).toBeLessThan(1e-7);
        expect(diagnostic.poseLowerTargetAngularDeltaRadians).toBeLessThan(1e-7);
        expect(diagnostic.poseUpperAppliedAngularDeltaRadians).toBeLessThan(1e-7);
        expect(diagnostic.poseLowerAppliedAngularDeltaRadians).toBeLessThan(1e-7);
      }
    });
  });

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
    // Mất theo dõi lâu phải về tư thế buông tay, KHÔNG phải identity (T-pose dang ngang).
    now = 900; const idle = processor.process(frame("lost")); expect(idle.tracking.pose.outputState).toBe("idle");
    expect(idle.jointRotations.leftUpperArm).toEqual(buildIdleArmPose(rigProfile, "left").upper);
    expect(idle.jointRotations.leftUpperArm).not.toEqual(identity);
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
    // Phase 3B partial-arm: chỉ cổ tay trái ra ngoài khung; vai/khuỷu vẫn rõ nên upper không rời "active".
    now = 300; processor.process(sample(300, false));
    expect(processor.getLastDiagnostics()?.arms.left.segmentLossState.upper).toBe("active");
    now = 400; processor.process(sample(400, false)); expect(processor.getLastDiagnostics()?.arms.left.segmentLossState.lower).toBe("recovering");
    now = 600; processor.process(sample(600, false)); expect(processor.getLastDiagnostics()?.arms.left.segmentLossState).toEqual({ upper: "active", lower: "active" });
  });
  // Phase 3B partial-arm: mất RIÊNG cổ tay không được giết cánh tay trên. Upper phải tiếp tục bám
  // vai→khuỷu, lower giữ parent-local delta (khối cứng theo upper) rồi mới return riêng.
  it("keeps the upper arm tracking while only the wrist is occluded", () => {
    const cases = [
      { side: "left", elbowIndex: 13, wristIndex: 15, upperName: "leftUpperArm", lowerName: "leftLowerArm" },
      { side: "right", elbowIndex: 14, wristIndex: 16, upperName: "rightUpperArm", lowerName: "rightLowerArm" },
    ] as const;
    for (const current of cases) {
      let now = 100;
      const processor = new AvatarMotionProcessor({ filtered: false, now: () => now });
      processor.setRigProfile(rigProfile);
      const initialPacket = processor.process(sampledFrame(100));
      const partial = (timestamp: number, elbowY: number) => {
        const value = sampledFrame(timestamp);
        value.pose.worldLandmarks![current.elbowIndex].y = elbowY;
        value.pose.landmarks![current.elbowIndex].y = .5 + elbowY * .4;
        value.pose.landmarks![current.wristIndex].x = 1.2;
        return value;
      };

      now = 150;
      const partialPacket = processor.process(partial(150, -.5));
      // Khuỷu đã di chuyển thật → upper phải đi theo, KHÔNG được đứng im như trước.
      expect(partialPacket.jointRotations[current.upperName]).not.toEqual(initialPacket.jointRotations[current.upperName]);
      // Lower mất nghiệm hình học → giữ nguyên parent-local delta của lần cuối hợp lệ.
      expect(partialPacket.jointRotations[current.lowerName]).toEqual(initialPacket.jointRotations[current.lowerName]);
      expect(processor.getLastDiagnostics()?.arms[current.side].segmentLossState).toEqual({ upper: "active", lower: "active" });

      // Che lâu: chỉ lower đi vào return; upper vẫn bám người thật.
      now = 450;
      processor.process(partial(450, -.8));
      const lateState = processor.getLastDiagnostics()?.arms[current.side].segmentLossState;
      expect(lateState?.upper).toBe("active");
      expect(lateState?.lower).toBe("returning");
    }
  });

  // Chống tái phát lỗi "forearm quét ngang mặt": trong hold window, lower phải giữ nguyên
  // parent-local delta kể cả khi upper liên tục đổi hướng. Giữ local delta cố định nghĩa là
  // cẳng tay xoay theo cánh tay trên như một khối cứng, không tự quét sang hướng khác.
  it("freezes the lower-arm local delta while the upper arm keeps moving during wrist occlusion", () => {
    let now = 100;
    const processor = new AvatarMotionProcessor({ filtered: false, now: () => now });
    processor.setRigProfile(rigProfile);
    processor.process(sampledFrame(100));
    const partial = (timestamp: number, elbowY: number) => {
      const value = sampledFrame(timestamp);
      value.pose.worldLandmarks![13].y = elbowY;
      value.pose.landmarks![13].y = .5 + elbowY * .4;
      value.pose.landmarks![15].x = 1.2;
      return value;
    };

    now = 150; const first = processor.process(partial(150, -.3));
    now = 200; const second = processor.process(partial(200, -.6));
    now = 250; const third = processor.process(partial(250, -.9));

    // Upper đổi mỗi frame theo khuỷu quan sát được.
    expect(second.jointRotations.leftUpperArm).not.toEqual(first.jointRotations.leftUpperArm);
    expect(third.jointRotations.leftUpperArm).not.toEqual(second.jointRotations.leftUpperArm);
    // Lower local delta bất biến suốt hold window.
    expect(second.jointRotations.leftLowerArm).toEqual(first.jointRotations.leftLowerArm);
    expect(third.jointRotations.leftLowerArm).toEqual(first.jointRotations.leftLowerArm);
  });

  // Phase 3B partial-arm: cổ tay bị che rồi quay lại. Upper không bao giờ rời "active" (vai/khuỷu luôn
  // rõ trong kịch bản này); chỉ lower đi qua held → recovering → active và phải blend chứ
  // không snap khi wrist trở lại.
  it("blends the lower arm back without snapping when the wrist is reacquired", () => {
    let now = 100;
    const processor = new AvatarMotionProcessor({ filtered: false, now: () => now });
    processor.setRigProfile(rigProfile);
    processor.process(sampledFrame(100));
    const occluded = (timestamp: number) => {
      const value = sampledFrame(timestamp);
      value.pose.landmarks![15].x = 1.2;
      return value;
    };

    now = 150; processor.process(occluded(150));
    now = 250; const held = processor.process(occluded(250));
    const heldState = processor.getLastDiagnostics()?.arms.left.segmentLossState;
    expect(heldState?.upper).toBe("active");
    expect(heldState?.lower).toBe("held");

    // Wrist quay lại: lower không được snap thẳng sang target quan sát.
    now = 280; const firstValid = processor.process(sampledFrame(280));
    for (const key of ["x", "y", "z", "w"] as const) {
      expect(firstValid.jointRotations.leftLowerArm![key]).toBeCloseTo(held.jointRotations.leftLowerArm![key], 12);
    }

    now = 370; processor.process(sampledFrame(370));
    expect(processor.getLastDiagnostics()?.arms.left.segmentLossState.lower).toBe("recovering");

    now = 570; processor.process(sampledFrame(570));
    expect(processor.getLastDiagnostics()?.arms.left.segmentLossState).toEqual({ upper: "active", lower: "active" });
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
  it("Mức 1B-2: reacquire blend triggers when poleSource upgrades even though elbowSource never changes (no angular jump)", () => {
    // Đo được trước sửa: elbowSource giữ nguyên "observed" xuyên suốt (elbow luôn quan sát
    // được), nhưng poleSource đổi rest→fresh (tay chuyển từ gần thẳng camera sang vuông góc)
    // làm quaternion nhảy ~58° không có blend nào — vì lossState không hề rời "active" (chỉ
    // dựa theo mất/còn tracking, không theo loại nguồn pole).
    let now = 0; const processor = new AvatarMotionProcessor({ filtered: false, now: () => now }); processor.setRigProfile(rigProfile);
    const weakPoleFrame = frame(); weakPoleFrame.frameTimestampMs = 0; weakPoleFrame.pose.sampledAtMs = 0;
    weakPoleFrame.pose.worldLandmarks![13] = { x: -.2, y: 0, z: -.6, visibility: 1 }; weakPoleFrame.pose.worldLandmarks![15] = { x: -.2, y: 0, z: -1.2, visibility: 1 };
    weakPoleFrame.pose.landmarks![13] = { x: .5 - .2 * .4, y: .5, z: -.6, visibility: 1 }; weakPoleFrame.pose.landmarks![15] = { x: .5 - .2 * .4, y: .5, z: -1.2, visibility: 1 };
    const before = processor.process(weakPoleFrame);
    expect(processor.getLastDiagnostics()?.arms.left.poleSource).toBe("rest");

    now = 33;
    const strongPoleFrame = frame(); strongPoleFrame.frameTimestampMs = 33; strongPoleFrame.pose.sampledAtMs = 33;
    strongPoleFrame.pose.worldLandmarks![13] = { x: -.5, y: -.1, z: -.3, visibility: 1 }; strongPoleFrame.pose.worldLandmarks![15] = { x: -.5, y: -.3, z: 0, visibility: 1 };
    strongPoleFrame.pose.landmarks![13] = { x: .5 - .5 * .4, y: .5 - .1 * .4, z: -.3, visibility: 1 }; strongPoleFrame.pose.landmarks![15] = { x: .5 - .5 * .4, y: .5 - .3 * .4, z: 0, visibility: 1 };
    const after = processor.process(strongPoleFrame);
    const diagnostic = processor.getLastDiagnostics()!.arms.left;
    expect(diagnostic.poleSource).toBe("fresh");
    expect(diagnostic.segmentLossState.upper).toBe("recovering");
    expect(diagnostic.transitionProgress).toBeLessThan(1);
    // Frame ngay lúc reacquire (progress gần 0) phải gần với output TRƯỚC đó, không nhảy thẳng
    // theo góc quan sát mới — đó chính là ý nghĩa của blend.
    const beforeQ = before.jointRotations.leftUpperArm!, afterQ = after.jointRotations.leftUpperArm!;
    for (const key of ["x", "y", "z", "w"] as const) expect(afterQ[key]).toBeCloseTo(beforeQ[key], 6);
    // Mức 1B-3: diagnostic mới phải phản ánh đúng frame reacquire này.
    expect(diagnostic.poleSourceChanged).toBe(true);
    expect(diagnostic.trackingReacquired).toBe(true);
    // Output góc lệch gần 0 (đúng ý nghĩa blend), khác hẳn góc raw ~58° nếu không có Việc 1+2.
    expect(diagnostic.upperArmAngularDeltaDeg).not.toBeNull();
    expect(diagnostic.upperArmAngularDeltaDeg!).toBeLessThan(1);
  });
  it("Mức 1B-3: angular-delta diagnostics stay null before any frame and report near-zero for an unchanged pose", () => {
    let now = 0; const processor = new AvatarMotionProcessor({ filtered: false, now: () => now }); processor.setRigProfile(rigProfile);
    processor.process(frame());
    const first = processor.getLastDiagnostics()!.arms.left;
    // Frame đầu tiên: không có "trước đó" để so — currentOutputDelta khởi tạo từ idle pose,
    // nên góc lệch đo được chính là góc từ tư thế nghỉ tới tư thế quan sát đầu tiên (không null).
    expect(first.upperArmAngularDeltaDeg).not.toBeNull();
    expect(first.poleSourceChanged).toBe(true); // unavailable -> quan sát được lần đầu
    expect(first.trackingReacquired).toBe(false); // elbowSource "unavailable" ban đầu bị loại trừ khỏi elbowSourceChanged

    now = 33; processor.process(frame());
    const second = processor.getLastDiagnostics()!.arms.left;
    // Cùng tư thế hai frame liên tiếp -> output không đổi -> góc lệch gần 0.
    expect(second.upperArmAngularDeltaDeg).toBeLessThan(0.01);
    expect(second.lowerArmAngularDeltaDeg).toBeLessThan(0.01);
    expect(second.poleSourceChanged).toBe(false);
    expect(second.trackingReacquired).toBe(false);
  });
  it("Mức 1B-5: sequence fresh -> degraded -> previous -> reacquired fresh has no pole flip or angular spike", () => {
    // Chuỗi tích hợp đủ 4 pha qua chính processor thật (không phải solver cô lập), kiểm tra
    // toàn bộ Việc 1+2+3+4 cùng hoạt động: khuỷu rõ (fresh) -> khuỷu bị che (degraded, rơi về
    // previous qua elbow-inference) -> vẫn che (previous ổn định) -> khuỷu rõ lại (reacquired).
    let now = 0; const processor = new AvatarMotionProcessor({ filtered: false, now: () => now }); processor.setRigProfile(rigProfile);
    const withElbow = (ts: number, elbowVisible: boolean): RawTrackingFrameV1 => {
      const value = frame(); value.frameTimestampMs = ts; value.pose.sampledAtMs = ts;
      value.pose.worldLandmarks![11] = { x: -.2, y: 0, z: 0, visibility: 1 }; value.pose.worldLandmarks![13] = { x: -.5, y: -.1, z: .3, visibility: 1 }; value.pose.worldLandmarks![15] = { x: -.5, y: -.3, z: 0, visibility: elbowVisible ? 1 : .1 };
      value.pose.landmarks![11] = { x: .5 - .2 * .4, y: .5, z: 0, visibility: .9 }; value.pose.landmarks![13] = { x: .5 - .5 * .4, y: .5 - .1 * .4, z: .3, visibility: elbowVisible ? .9 : .1 }; value.pose.landmarks![15] = { x: .5 - .5 * .4, y: .5 - .3 * .4, z: 0, visibility: .9 };
      return value;
    };
    // Calibrate trước để elbow-inference có sẵn độ dài xương khi pha 2 cần dùng.
    for (let i = 0; i < 3; i += 1) { now = i * 33; processor.process(withElbow(now, true)); }

    now += 33; processor.process(withElbow(now, true));
    const freshDiagnostic = processor.getLastDiagnostics()!.arms.left;
    expect(freshDiagnostic.poleSource).toBe("fresh");

    now += 33; processor.process(withElbow(now, false));
    const degradedDiagnostic = processor.getLastDiagnostics()!.arms.left;
    expect(degradedDiagnostic.poleSource).toBe("previous");
    expect(degradedDiagnostic.segmentLossState.upper).toBe("recovering"); // elbowSource observed->inferred kích hoạt reacquire blend

    now += 33; const previousStage = processor.process(withElbow(now, false));
    const previousDiagnostic = processor.getLastDiagnostics()!.arms.left;
    expect(previousDiagnostic.poleSource).toBe("previous");

    now += 33; const reacquired = processor.process(withElbow(now, true));
    const reacquiredDiagnostic = processor.getLastDiagnostics()!.arms.left;
    expect(reacquiredDiagnostic.poleSource).toBe("fresh");
    expect(reacquiredDiagnostic.trackingReacquired).toBe(true);
    // Không pole flip, không angular spike: output cuối cùng (đã qua Việc 1+2) phải liên tục.
    expect(reacquiredDiagnostic.upperArmAngularDeltaDeg).not.toBeNull();
    expect(reacquiredDiagnostic.upperArmAngularDeltaDeg!).toBeLessThan(1);
    const q3 = previousStage.jointRotations.leftUpperArm!, q4 = reacquired.jointRotations.leftUpperArm!;
    for (const key of ["x", "y", "z", "w"] as const) expect(q4[key]).toBeCloseTo(q3[key], 3);
  });

  describe("Mức 2A — Việc 4: Hand motion wiring (diagnostic only, must not affect jointRotations)", () => {
    it("8. regression: jointRotations identical with and without valid Hand input, while handMotion proves matching+palm ran", () => {
      const withoutHand = frame();
      const withHand = frame();
      withHand.rawHands = [handCandidate(0, LEFT_WRIST_IMAGE, "left"), handCandidate(1, RIGHT_WRIST_IMAGE, "right")];

      const processorA = new AvatarMotionProcessor({ filtered: false, now: () => 120 }); processorA.setRigProfile(rigProfile);
      const packetA = processorA.process(withoutHand);
      const processorB = new AvatarMotionProcessor({ filtered: false, now: () => 120 }); processorB.setRigProfile(rigProfile);
      const packetB = processorB.process(withHand);

      expect(packetB.jointRotations).toEqual(packetA.jointRotations);

      // Chứng minh Hand matching + palm basis THỰC SỰ chạy, không chỉ jointRotations giống nhau do trùng hợp.
      expect(packetB.handMotion?.left.handMatched).toBe(true);
      expect(packetB.handMotion?.left.status).toBe("matched");
      expect(packetB.handMotion?.left.imageBasis).not.toBeNull();
      expect(packetB.handMotion?.left.worldBasis).not.toBeNull();
      expect(packetB.handMotion?.right.handMatched).toBe(true);
      expect(packetB.handMotion?.right.status).toBe("matched");
      expect(packetA.handMotion?.left.handMatched).toBe(false);
      expect(packetA.handMotion?.left.status).toBe("no-candidates");
    });

    it("handSampledThisFrame=false -> not-sampled, does not run new assignment, does not clear continuity", () => {
      const processor = new AvatarMotionProcessor({ filtered: false, now: () => 120 }); processor.setRigProfile(rigProfile);
      const matched = frame(); matched.rawHands = [handCandidate(0, LEFT_WRIST_IMAGE, "left")];
      const first = processor.process(matched);
      expect(first.handMotion?.left.handMatched).toBe(true);

      const notSampled = frame(); notSampled.handSampledThisFrame = false; notSampled.rawHands = []; notSampled.frameTimestampMs = 43;
      const second = processor.process(notSampled);
      expect(second.handMotion?.left.status).toBe("not-sampled");
      expect(second.handMotion?.left.ranMatching).toBe(false);

      // Continuity vẫn còn: một candidate gần vị trí cũ ở frame kế tiếp phải "continued", không "new".
      const reappear = frame(); reappear.rawHands = [handCandidate(0, LEFT_WRIST_IMAGE, "left")]; reappear.frameTimestampMs = 44;
      const third = processor.process(reappear);
      // (continuity không expose trực tiếp qua handMotion, nhưng matchChanged phản ánh nó.)
      expect(third.handMotion?.left.matchChanged).toBe(false);
    });

    it("sampled=true but rawHands=[] -> no-candidates, no jointRotations impact", () => {
      const processor = new AvatarMotionProcessor({ filtered: false, now: () => 120 }); processor.setRigProfile(rigProfile);
      const noHands = frame(); noHands.rawHands = [];
      const packet = processor.process(noHands);
      expect(packet.handMotion?.left.status).toBe("no-candidates");
      expect(packet.handMotion?.left.handDetected).toBe(false);
      expect(packet.jointRotations.leftUpperArm).toBeDefined();
    });

    it("candidate wrist too far from pose wrist -> unmatched", () => {
      const processor = new AvatarMotionProcessor({ filtered: false, now: () => 120 }); processor.setRigProfile(rigProfile);
      const farHand = frame(); farHand.rawHands = [handCandidate(0, { x: 0.02, y: 0.02 }, "left")];
      const packet = processor.process(farHand);
      expect(packet.handMotion?.left.status).toBe("unmatched");
      expect(packet.handMotion?.left.handDetected).toBe(true);
      expect(packet.handMotion?.left.handMatched).toBe(false);
    });

    it("candidates swap sourceIndex order between frames but continuity keeps matchChanged=false", () => {
      const processor = new AvatarMotionProcessor({ filtered: false, now: () => 120 }); processor.setRigProfile(rigProfile);
      const frame1 = frame(); frame1.rawHands = [handCandidate(0, LEFT_WRIST_IMAGE, "left"), handCandidate(1, RIGHT_WRIST_IMAGE, "right")];
      processor.process(frame1);

      const frame2 = frame(); frame2.frameTimestampMs = 43;
      frame2.rawHands = [handCandidate(0, RIGHT_WRIST_IMAGE, "right"), handCandidate(1, LEFT_WRIST_IMAGE, "left")];
      const packet2 = processor.process(frame2);
      expect(packet2.handMotion?.left.matchChanged).toBe(false);
      expect(packet2.handMotion?.right.matchChanged).toBe(false);
    });

    it("candidate reappears far from previous wrist position -> reacquired (matchChanged=true)", () => {
      const processor = new AvatarMotionProcessor({ filtered: false, now: () => 120 }); processor.setRigProfile(rigProfile);
      const frame1 = frame(); frame1.rawHands = [handCandidate(0, LEFT_WRIST_IMAGE, "left")];
      processor.process(frame1);

      // Vẫn đủ gần pose left wrist để match, nhưng cách xa vị trí match trước đó (ngoài continuityMaxDistance=0.25).
      const frame2 = frame(); frame2.frameTimestampMs = 133; frame2.pose.sampledAtMs = 133; frame2.handSampledAtMs = 133;
      frame2.rawHands = [handCandidate(0, { x: LEFT_WRIST_IMAGE.x + 0.3, y: LEFT_WRIST_IMAGE.y }, "left", 133)];
      const packet2 = processor.process(frame2);
      expect(packet2.handMotion?.left.handMatched).toBe(true);
      expect(packet2.handMotion?.left.matchChanged).toBe(true);
    });

    it("stale hand sample relative to pose sample -> stale status", () => {
      const processor = new AvatarMotionProcessor({ filtered: false, now: () => 120 }); processor.setRigProfile(rigProfile);
      const stale = frame(); stale.rawHands = [handCandidate(0, LEFT_WRIST_IMAGE, "left", 100)]; stale.handSampledAtMs = 100; stale.pose.sampledAtMs = 1000;
      const packet = processor.process(stale);
      expect(packet.handMotion?.left.status).toBe("stale");
    });

    it("left and right hand diagnostics are independent (one matched, one unmatched)", () => {
      const processor = new AvatarMotionProcessor({ filtered: false, now: () => 120 }); processor.setRigProfile(rigProfile);
      const mixed = frame(); mixed.rawHands = [handCandidate(0, LEFT_WRIST_IMAGE, "left")];
      const packet = processor.process(mixed);
      expect(packet.handMotion?.left.handMatched).toBe(true);
      expect(packet.handMotion?.left.status).toBe("matched");
      expect(packet.handMotion?.right.handMatched).toBe(false);
      expect(packet.handMotion?.right.status).toBe("unmatched");
    });

    it("does not use Hand result to change jointRotations, pole, or arm temporal state across frames", () => {
      let now = 0;
      const processorNoHand = new AvatarMotionProcessor({ filtered: false, now: () => now }); processorNoHand.setRigProfile(rigProfile);
      const processorWithHand = new AvatarMotionProcessor({ filtered: false, now: () => now }); processorWithHand.setRigProfile(rigProfile);
      for (let i = 0; i < 4; i += 1) {
        now = i * 33;
        const base = frame(); base.frameTimestampMs = now; base.pose.sampledAtMs = now;
        const withHand = frame(); withHand.frameTimestampMs = now; withHand.pose.sampledAtMs = now;
        withHand.rawHands = [handCandidate(0, LEFT_WRIST_IMAGE, "left"), handCandidate(1, RIGHT_WRIST_IMAGE, "right")];
        const a = processorNoHand.process(base);
        const b = processorWithHand.process(withHand);
        expect(b.jointRotations).toEqual(a.jointRotations);
      }
      const diagnosticNoHand = processorNoHand.getLastDiagnostics()!.arms.left;
      const diagnosticWithHand = processorWithHand.getLastDiagnostics()!.arms.left;
      expect(diagnosticWithHand.poleSource).toBe(diagnosticNoHand.poleSource);
      expect(diagnosticWithHand.elbowInference.source).toBe(diagnosticNoHand.elbowInference.source);
    });
  });
});
