import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import type { AvatarFingerName, QuaternionData } from "./avatarPoseTypes";
import type { FingerChainRig, HandFingerRig } from "./fingerRig";
import { planFingerPose } from "./fingerPosePlanner";
import { FINGER_FLEXION_RANGE_RADIANS, getFingerPosePreset } from "./fingerPosePresets";

const quaternionData = (quaternion: Quaternion): QuaternionData => ({
  x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w,
});

const asQuaternion = (value: QuaternionData) => new Quaternion(value.x, value.y, value.z, value.w);

function expectSameRotation(actual: QuaternionData | undefined, expected: Quaternion): void {
  expect(actual).toBeDefined();
  // q và −q biểu diễn cùng một rotation; so dot tuyệt đối để assertion không phụ thuộc hemisphere.
  expect(Math.abs(asQuaternion(actual!).normalize().dot(expected.clone().normalize()))).toBeCloseTo(1, 7);
}

function thumbRig(directionalSwingLocal?: { up: QuaternionData; down: QuaternionData }): HandFingerRig {
  const thumb: FingerChainRig = {
    finger: "thumb",
    truncatedAtSegment: null,
    segments: [
      {
        joint: "leftThumbMetacarpal",
        // Cố ý khác trục swing để regression có thể bắt việc vô tình áp swing cho đốt ngọn.
        flexAxisLocal: { x: 1, y: 0, z: 0 },
        directionalSwingLocal,
        hasChild: true,
      },
      { joint: "leftThumbProximal", flexAxisLocal: { x: 1, y: 0, z: 0 }, hasChild: true },
      { joint: "leftThumbDistal", flexAxisLocal: { x: 1, y: 0, z: 0 }, hasChild: false },
    ],
  };
  const emptyChain = (finger: Exclude<AvatarFingerName, "thumb">): FingerChainRig => ({
    finger,
    segments: [],
    truncatedAtSegment: "Proximal",
  });
  return {
    side: "left",
    chains: [thumb, emptyChain("index"), emptyChain("middle"), emptyChain("ring"), emptyChain("little")],
    controllableSegmentCount: 3,
  };
}

describe("fingerPosePlanner — directional thumb swing", () => {
  it("dùng calibrated swing up/down tại ThumbMetacarpal và chỉ flex ở hai đốt ngọn", () => {
    // Swing quanh Z và flex quanh X không cùng trục. Dù preset root hiện chủ ý flexion = 0,
    // expected vẫn viết dưới dạng `swing × flex` để khóa contract planner.
    const directionalSwingLocal = {
      up: quaternionData(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.8)),
      down: quaternionData(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -0.8)),
    };
    const rig = thumbRig(directionalSwingLocal);
    const upPreset = getFingerPosePreset("thumbsUp").thumb;
    const downPreset = getFingerPosePreset("thumbsDown").thumb;
    const upRootFlex = new Quaternion().setFromAxisAngle(
      new Vector3(1, 0, 0), upPreset.proximal * FINGER_FLEXION_RANGE_RADIANS.thumb.proximal,
    );
    const downRootFlex = new Quaternion().setFromAxisAngle(
      new Vector3(1, 0, 0), downPreset.proximal * FINGER_FLEXION_RANGE_RADIANS.thumb.proximal,
    );

    const up = planFingerPose(rig, "thumbsUp");
    const down = planFingerPose(rig, "thumbsDown");
    expectSameRotation(up.leftThumbMetacarpal, asQuaternion(directionalSwingLocal.up).multiply(upRootFlex));
    expectSameRotation(down.leftThumbMetacarpal, asQuaternion(directionalSwingLocal.down).multiply(downRootFlex));

    // Direction không được rò sang đốt ngọn: chúng chỉ cong nhẹ cho dáng tự nhiên.
    const proximalFlex = new Quaternion().setFromAxisAngle(
      new Vector3(1, 0, 0), upPreset.intermediate * FINGER_FLEXION_RANGE_RADIANS.thumb.intermediate,
    );
    const distalFlex = new Quaternion().setFromAxisAngle(
      new Vector3(1, 0, 0), upPreset.distal * FINGER_FLEXION_RANGE_RADIANS.thumb.distal,
    );
    expectSameRotation(up.leftThumbProximal, proximalFlex);
    expectSameRotation(up.leftThumbDistal, distalFlex);
    expect(downPreset.intermediate).toBe(upPreset.intermediate);
    expect(downPreset.distal).toBe(upPreset.distal);
  });

  it("thiếu directional calibration thì fallback an toàn về flexion rest-relative", () => {
    // Capability rig là optional: model thiếu geometry torso hợp lệ không được crash hoặc đoán
    // một swing chung. Với thumbs-up root flexion semantic là 0 nên fallback phải là identity.
    const plan = planFingerPose(thumbRig(), "thumbsUp");
    expectSameRotation(plan.leftThumbMetacarpal, new Quaternion());
  });
});
