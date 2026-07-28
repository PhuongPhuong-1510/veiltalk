import { describe, expect, it } from "vitest";
import type { FaceLandmarkerResult, HandLandmarkerResult, PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import { mapRawTrackingFrame } from "./rawTrackingMapper";

const point = { x: 0.1, y: 0.2, z: -0.1, visibility: 0.9 };
const face = (present = true) => ({
  faceLandmarks: present ? [[point]] : [],
  faceBlendshapes: present ? [{ categories: [{ categoryName: "mouthSmileLeft", score: 0.8, index: 0, displayName: "" }], headIndex: 0, headName: "" }] : [],
  facialTransformationMatrixes: present ? [{ rows: 4, columns: 4, data: [1, 0, 0, 1] }] : [],
}) as FaceLandmarkerResult;
const hands = (sides: string[]) => ({
  landmarks: sides.map(() => [point]),
  worldLandmarks: sides.map(() => [point]),
  handedness: sides.map((side) => [{ categoryName: side, score: 0.95, index: 0, displayName: "" }]),
  handednesses: [],
}) as HandLandmarkerResult;
const pose = (present = true) => ({
  landmarks: present ? [[point]] : [],
  worldLandmarks: present ? [[point]] : [],
  close() {},
}) as unknown as PoseLandmarkerResult;

describe("mapRawTrackingFrame", () => {
  it("maps face blendshape, hands, pose, version and full state", () => {
    const frame = mapRawTrackingFrame(100, { face: face(), hands: hands(["Left", "Right"]), pose: pose() });
    expect(frame.version).toBe(1);
    expect(frame.overall).toBe("full");
    expect(frame.face.blendshapes).toEqual({ mouthSmileLeft: 0.8 });
    expect(frame.face.facialTransform?.data).toEqual([1, 0, 0, 1]);
    expect(frame.leftHand.handedness).toBe("left");
    expect(frame.rightHand.handedness).toBe("right");
    expect(frame.pose.landmarks).toHaveLength(1);
  });

  it("marks sampled but missing groups as lost", () => {
    const frame = mapRawTrackingFrame(100, { face: face(false), hands: hands([]), pose: pose(false) });
    expect(frame.overall).toBe("lost");
    expect(frame.face.state).toBe("lost");
    expect(frame.leftHand.state).toBe("lost");
    expect(frame.rightHand.state).toBe("lost");
    expect(frame.pose.state).toBe("lost");
    expect(frame.face.sampledAtMs).toBe(100);
  });

  it("preserves sample time and freshness without pretending cached values are newly tracked", () => {
    const initial = mapRawTrackingFrame(100, { face: face(), hands: hands(["Left", "Right"]), pose: pose() });
    const skipped = mapRawTrackingFrame(140, { face: face() }, initial);
    expect(skipped.overall).toBe("full");
    expect(skipped.leftHand.state).toBe("not-sampled");
    expect(skipped.leftHand.sampledAtMs).toBe(100);
    expect(skipped.pose.state).toBe("not-sampled");
    expect(skipped.pose.sampledAtMs).toBe(100);
  });

  it("degrades overall when cached samples exceed their freshness budget", () => {
    const initial = mapRawTrackingFrame(100, { face: face(), hands: hands(["Left", "Right"]), pose: pose() });
    const stale = mapRawTrackingFrame(300, { face: face() }, initial);
    expect(stale.overall).toBe("partial");
    expect(stale.leftHand.state).toBe("not-sampled");
    expect(stale.leftHand.sampledAtMs).toBe(100);
  });

  it("keeps video timestamp separate from monotonic sample timestamps", () => {
    const frame = mapRawTrackingFrame(2_000, {
      face: face(), hands: hands(["Left", "Right"]), pose: pose(),
      sampledAtMs: { face: 10_000, hands: 9_980, pose: 9_970 },
    });
    expect(frame.frameTimestampMs).toBe(2_000);
    expect(frame.face.sampledAtMs).toBe(10_000);
    expect(frame.leftHand.sampledAtMs).toBe(9_980);
    expect(frame.pose.sampledAtMs).toBe(9_970);
    expect(frame.overall).toBe("full");
  });

  it("keeps every raw hand candidate without deduplicating by handedness", () => {
    const frame = mapRawTrackingFrame(100, { face: face(), hands: hands(["Left", "Left"]), pose: pose() });
    expect(frame.rawHands).toHaveLength(2);
    expect(frame.rawHands[0]).toEqual({
      sourceIndex: 0, sampledAtMs: 100, handedness: "left", handednessScore: 0.95,
      landmarks: [point], worldLandmarks: [point],
    });
    expect(frame.rawHands[1]).toEqual({
      sourceIndex: 1, sampledAtMs: 100, handedness: "left", handednessScore: 0.95,
      landmarks: [point], worldLandmarks: [point],
    });
    // leftHand/rightHand giữ nguyên hành vi cũ: chỉ nhận candidate đầu tiên mỗi label.
    expect(frame.leftHand.state).toBe("tracked");
    expect(frame.rightHand.state).toBe("lost");
  });

  it("marks unrecognized handedness labels as unknown in rawHands", () => {
    const frame = mapRawTrackingFrame(100, { face: face(), hands: hands(["Left", "Unsure"]), pose: pose() });
    expect(frame.rawHands[1].handedness).toBe("unknown");
  });

  it("returns an empty rawHands array when hands were not sampled this frame", () => {
    const initial = mapRawTrackingFrame(100, { face: face(), hands: hands(["Left", "Right"]), pose: pose() });
    const skipped = mapRawTrackingFrame(140, { face: face() }, initial);
    expect(skipped.rawHands).toEqual([]);
  });

  it("distinguishes not-sampled-this-frame from sampled-but-no-hands-detected", () => {
    const detected = mapRawTrackingFrame(100, { face: face(), hands: hands(["Left", "Right"]), pose: pose() });
    expect(detected.handSampledThisFrame).toBe(true);
    expect(detected.handSampledAtMs).toBe(100);
    expect(detected.rawHands).toHaveLength(2);

    // Staggered mode: frame kế tiếp không lấy mẫu hands (kết quả undefined) — không phải mất tay.
    const notSampled = mapRawTrackingFrame(140, { face: face() }, detected);
    expect(notSampled.handSampledThisFrame).toBe(false);
    expect(notSampled.rawHands).toEqual([]);
    // handSampledAtMs giữ nguyên mốc lần chạy gần nhất để matcher tính độ trễ/staleness.
    expect(notSampled.handSampledAtMs).toBe(100);

    // Detector thực sự chạy lại nhưng không thấy tay nào — đây LÀ một observation mới.
    const noHandsDetected = mapRawTrackingFrame(180, { face: face(), hands: hands([]), pose: pose() }, notSampled);
    expect(noHandsDetected.handSampledThisFrame).toBe(true);
    expect(noHandsDetected.rawHands).toEqual([]);
    expect(noHandsDetected.handSampledAtMs).toBe(180);
  });

  it("starts with handSampledAtMs null before hands have ever been sampled", () => {
    const frame = mapRawTrackingFrame(100, { face: face() });
    expect(frame.handSampledThisFrame).toBe(false);
    expect(frame.handSampledAtMs).toBeNull();
  });
});
