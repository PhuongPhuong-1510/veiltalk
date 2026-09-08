import { describe, expect, it } from "vitest";
import { Object3D } from "three";
import { AvatarMotionProcessor } from "./avatarMotionProcessor";
import { buildFingerRigProfile } from "./fingerRig";
import { fingerJointName, IDENTITY_QUATERNION, isFingerJointName } from "./avatarPoseTypes";
import type { RawTrackingFrameV1 } from "../tracking/rawTrackingTypes";

function emptyFrame(timestamp: number): RawTrackingFrameV1 {
  const lost = { state: "lost" as const, sampledAtMs: null, landmarks: null, worldLandmarks: null };
  return {
    version: 1, frameTimestampMs: timestamp, overall: "partial",
    face: { state: "lost", sampledAtMs: null, landmarks: null, blendshapes: null, facialTransform: null },
    leftHand: { ...lost, handedness: "left", handednessScore: null },
    rightHand: { ...lost, handedness: "right", handednessScore: null },
    rawHands: [], handSampledThisFrame: false, handSampledAtMs: null,
    videoWidth: 1280, videoHeight: 720,
    pose: { state: "lost", sampledAtMs: null, landmarks: null, worldLandmarks: null },
  };
}

function buildFingerRig() {
  const bones: Partial<Record<string, Object3D>> = {};
  for (const side of ["left", "right"] as const) {
    const hand = new Object3D();
    bones[`${side}Hand`] = hand;
    (["thumb", "index", "middle", "ring", "little"] as const).forEach((finger, fingerIndex) => {
      const segments = finger === "thumb"
        ? (["Metacarpal", "Proximal", "Distal"] as const)
        : (["Proximal", "Intermediate", "Distal"] as const);
      let parent = hand;
      segments.forEach((segment, segmentIndex) => {
        const bone = new Object3D();
        // Ngón cái lệch về phía lòng (-Z); rig ngón neo dấu trục gập vào vị trí ngón cái.
        const thumbPalmOffset = finger === "thumb" && segmentIndex === 0 ? -0.025 : 0;
        const mirror = side === "right" ? -1 : 1;
        bone.position.set(segmentIndex === 0 ? fingerIndex * 0.02 * mirror : 0, 0.03, thumbPalmOffset);
        parent.add(bone);
        bones[fingerJointName(side, finger, segment)] = bone;
        parent = bone;
      });
    });
    hand.updateMatrixWorld(true);
  }
  return buildFingerRigProfile(1, bones);
}

describe("Phase 3B.3 — công tắc gesture", () => {
  it("mặc định TẮT: packet không chứa khoá xương ngón nào", () => {
    const processor = new AvatarMotionProcessor({ now: () => 0 });
    processor.setFingerRig(buildFingerRig());
    const packet = processor.process(emptyFrame(0));
    expect(processor.isGestureEnabled()).toBe(false);
    expect(Object.keys(packet.jointRotations).filter(isFingerJointName)).toEqual([]);
  });

  it("bật rồi tắt: phát identity ĐÚNG MỘT LẦN cho joint đã sở hữu, sau đó im lặng", () => {
    // Renderer giữ nguyên rotation cũ của bone khi khoá biến mất khỏi packet, nên tắt tính năng
    // mà chỉ bỏ khoá sẽ làm ngón đóng băng ở tư thế cuối. Phải phát identity để nhả.
    const processor = new AvatarMotionProcessor({ now: () => 0 });
    processor.setFingerRig(buildFingerRig());
    processor.setGestureEnabled(true);
    processor.process(emptyFrame(0));

    processor.setGestureEnabled(false);
    const clearing = processor.process(emptyFrame(16));
    for (const [name, rotation] of Object.entries(clearing.jointRotations)) {
      if (!isFingerJointName(name)) continue;
      expect(rotation).toEqual(IDENTITY_QUATERNION);
    }

    const afterClear = processor.process(emptyFrame(32));
    expect(Object.keys(afterClear.jointRotations).filter(isFingerJointName)).toEqual([]);
  });

  it("đổi model (đổi fingerRig) khi đang bật thì nhả pose ngón cũ", () => {
    const processor = new AvatarMotionProcessor({ now: () => 0 });
    processor.setFingerRig(buildFingerRig());
    processor.setGestureEnabled(true);
    processor.process(emptyFrame(0));
    processor.setFingerRig(buildFingerRig());
    const packet = processor.process(emptyFrame(16));
    for (const [name, rotation] of Object.entries(packet.jointRotations)) {
      if (!isFingerJointName(name)) continue;
      expect(rotation).toEqual(IDENTITY_QUATERNION);
    }
  });

  it("bật/tắt gesture KHÔNG đổi khoá xương arm — Phase 3B giữ nguyên", () => {
    const off = new AvatarMotionProcessor({ now: () => 0 });
    const on = new AvatarMotionProcessor({ now: () => 0 });
    on.setFingerRig(buildFingerRig());
    on.setGestureEnabled(true);
    const offPacket = off.process(emptyFrame(0));
    const onPacket = on.process(emptyFrame(0));
    const armKeys = (packet: typeof offPacket) => Object.keys(packet.jointRotations).filter((name) => !isFingerJointName(name)).sort();
    expect(armKeys(onPacket)).toEqual(armKeys(offPacket));
  });

  it("không có fingerRig (model không phải VRM) thì bật gesture cũng không ghi khoá ngón", () => {
    const processor = new AvatarMotionProcessor({ now: () => 0 });
    processor.setGestureEnabled(true);
    const packet = processor.process(emptyFrame(0));
    expect(Object.keys(packet.jointRotations).filter(isFingerJointName)).toEqual([]);
  });
});
