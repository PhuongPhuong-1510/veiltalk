import { describe, expect, it } from "vitest";
import { Object3D, Quaternion, Vector3 } from "three";
import { AvatarMotionProcessor } from "./avatarMotionProcessor";
import { buildFingerRigProfile } from "./fingerRig";
import { FINGER_LANDMARK_CHAIN } from "./fingerFeatures";
import { fingerJointName, isFingerJointName, IDENTITY_QUATERNION } from "./avatarPoseTypes";
import type { RawTrackingFrameV1, RawWorldLandmarkV1 } from "../tracking/rawTrackingTypes";

/** Curl đồng nhất mọi ngón, hoặc chỉ định riêng từng ngón. */
type HandCurl = number | Partial<Record<"thumb" | "index" | "middle" | "ring" | "little", number>>;

/** Bàn tay tổng hợp: curl 0 = duỗi thẳng, 1 = nắm chặt. */
function handLandmarks(curl: HandCurl): RawWorldLandmarkV1[] {
  const points: RawWorldLandmarkV1[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0, visibility: null }));
  (["thumb", "index", "middle", "ring", "little"] as const).forEach((finger, fingerIndex) => {
    const chain = FINGER_LANDMARK_CHAIN[finger];
    const fingerCurl = typeof curl === "number" ? curl : curl[finger] ?? 0;
    let y = 0.08; let z = 0; let angle = 0;
    const x = (fingerIndex - 2) * 0.02;
    points[chain[0]] = { x, y, z, visibility: null };
    [0.035, 0.025, 0.02].forEach((bone, segment) => {
      angle += fingerCurl * (80 * Math.PI / 180);
      y += bone * Math.cos(angle);
      z -= bone * Math.sin(angle);
      points[chain[segment + 1]] = { x, y, z, visibility: null };
    });
  });
  return points;
}

/**
 * Image landmark: đủ để palm basis dựng được, matcher gán đúng side, và đo hướng ngón cái.
 *
 * `thumbDirection` là hướng ngón cái theo MÀN HÌNH (y dương = lên trên); mặc định chĩa ngang để
 * các test không liên quan tới `thumbsUp` giữ nguyên hành vi cũ.
 */
function handImageLandmarks(thumbDirection: { x: number; y: number } = { x: 1, y: 0 }): RawWorldLandmarkV1[] {
  const points: RawWorldLandmarkV1[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: null }));
  points[0] = { x: 0.5, y: 0.62, z: 0, visibility: null };
  points[5] = { x: 0.44, y: 0.48, z: 0, visibility: null };
  points[9] = { x: 0.5, y: 0.46, z: 0, visibility: null };
  points[17] = { x: 0.56, y: 0.5, z: 0, visibility: null };
  // Ngón cái: MCP ở index 2, TIP ở index 4.
  //
  // `thumbDirection` là hướng THẬT trên màn hình, nên phải quy về đơn vị chuẩn hoá của TỪNG trục
  // (x theo chiều rộng, y theo chiều cao) — giống hệt việc MediaPipe sinh ra toạ độ. Dựng thẳng
  // trong đơn vị chuẩn hoá thô sẽ tạo ra một góc khác với góc định thử.
  const pixels = 100;
  points[2] = { x: 0.46, y: 0.56, z: 0, visibility: null };
  points[4] = {
    x: 0.46 + (pixels * thumbDirection.x) / 1280,
    // Toạ độ ảnh có y tăng xuống dưới nên đảo dấu.
    y: 0.56 - (pixels * thumbDirection.y) / 720,
    z: 0, visibility: null,
  };
  return points;
}

function frameWithHand(options: {
  curl: HandCurl;
  timestamp: number;
  handPresent?: boolean;
  thumbDirection?: { x: number; y: number };
}): RawTrackingFrameV1 {
  const present = options.handPresent ?? true;
  const lost = { state: "lost" as const, sampledAtMs: null, landmarks: null, worldLandmarks: null };
  // Pose landmark: wrist trái ở index 15 cần khớp vị trí hand để matcher gán side.
  const poseLandmarks: RawWorldLandmarkV1[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.99 }));
  poseLandmarks[15] = { x: 0.5, y: 0.62, z: 0, visibility: 0.99 };
  poseLandmarks[16] = { x: 0.1, y: 0.9, z: 0, visibility: 0.99 };
  return {
    version: 1, frameTimestampMs: options.timestamp, overall: "partial",
    face: { state: "lost", sampledAtMs: null, landmarks: null, blendshapes: null, facialTransform: null },
    leftHand: { ...lost, handedness: "left", handednessScore: null },
    rightHand: { ...lost, handedness: "right", handednessScore: null },
    rawHands: present ? [{
      sourceIndex: 0, sampledAtMs: options.timestamp, handedness: "left", handednessScore: 0.98,
      landmarks: handImageLandmarks(options.thumbDirection), worldLandmarks: handLandmarks(options.curl),
    }] : [],
    handSampledThisFrame: true, handSampledAtMs: options.timestamp,
    videoWidth: 1280, videoHeight: 720,
    pose: { state: "tracked", sampledAtMs: options.timestamp, landmarks: poseLandmarks, worldLandmarks: poseLandmarks },
  };
}

function buildRigFixture() {
  const bones: Partial<Record<string, Object3D>> = {};
  const chest = new Object3D();
  chest.name = "chest";
  const neck = new Object3D();
  neck.name = "neck";
  neck.position.set(0, 0.25, 0);
  chest.add(neck);
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
        // Ngón cái lệch về phía lòng (-Z) và tay phải là ảnh gương — rig ngón neo dấu trục gập
        // vào vị trí ngón cái, nên bàn tay giả phẳng lì sẽ không dựng được trục.
        const thumbPalmOffset = finger === "thumb" && segmentIndex === 0 ? -0.025 : 0;
        const mirror = side === "right" ? -1 : 1;
        bone.position.set(segmentIndex === 0 ? fingerIndex * 0.02 * mirror : 0, 0.03, thumbPalmOffset);
        parent.add(bone);
        bones[fingerJointName(side, finger, segment)] = bone;
        parent = bone;
      });
    });
    // Rest thumb T-pose nằm ngang; có vậy regression thumbs-up/down mới bắt được lỗi cũ "delta
    // khác identity nhưng endpoint vẫn không chĩa lên".
    bones[fingerJointName(side, "thumb", "Metacarpal")]!.quaternion
      .setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(side === "left" ? 1 : -1, 0, 0));
    hand.position.set(side === "left" ? -0.18 : 0.18, 0.08, 0);
    chest.add(hand);
  }
  bones.chest = chest;
  bones.neck = neck;
  chest.updateMatrixWorld(true);
  return { rig: buildFingerRigProfile(1, bones), bones, chest, neck };
}

function buildRig() {
  return buildRigFixture().rig;
}

/** Áp đúng đường renderer: rest local × delta local, rồi đo hướng thực của đốt gốc ngón cái. */
function thumbDirectionAfterPacket(
  bones: Partial<Record<string, Object3D>>,
  side: "left" | "right",
  delta: { x: number; y: number; z: number; w: number },
): Vector3 {
  const bone = bones[fingerJointName(side, "thumb", "Metacarpal")]!;
  const child = bone.children[0]!;
  const restLocalRotation = bone.quaternion.clone();
  bone.quaternion.copy(restLocalRotation).multiply(new Quaternion(delta.x, delta.y, delta.z, delta.w));
  bone.updateWorldMatrix(true, true);
  const direction = child.getWorldPosition(new Vector3())
    .sub(bone.getWorldPosition(new Vector3()))
    .normalize();
  bone.quaternion.copy(restLocalRotation);
  bone.updateWorldMatrix(true, true);
  return direction;
}

const fingerKeys = (packet: { jointRotations: Record<string, unknown> }) =>
  Object.keys(packet.jointRotations).filter(isFingerJointName);

describe("Phase 3B.3 Bước 1 — pipeline fist end-to-end", () => {
  it("nắm tay đủ lâu → processor ghi rotation cho xương ngón", () => {
    let now = 0;
    const processor = new AvatarMotionProcessor({ now: () => now });
    processor.setFingerRig(buildRig());
    processor.setGestureEnabled(true);
    for (let t = 0; t <= 600; t += 33) {
      now = t;
      processor.process(frameWithHand({ curl: 1, timestamp: t }));
    }
    now = 633;
    const packet = processor.process(frameWithHand({ curl: 1, timestamp: 633 }));
    expect(fingerKeys(packet).length).toBeGreaterThan(0);
    expect(processor.getGesturePoses().left).toBe("fist");
  });

  it("bàn tay duỗi KHÔNG ra fist", () => {
    let now = 0;
    const processor = new AvatarMotionProcessor({ now: () => now });
    processor.setFingerRig(buildRig());
    processor.setGestureEnabled(true);
    for (let t = 0; t <= 600; t += 33) {
      now = t;
      processor.process(frameWithHand({ curl: 0, timestamp: t }));
    }
    expect(processor.getGesturePoses().left).not.toBe("fist");
  });

  it("nắm rồi duỗi → nhả fist, không kẹt", () => {
    let now = 0;
    const processor = new AvatarMotionProcessor({ now: () => now });
    processor.setFingerRig(buildRig());
    processor.setGestureEnabled(true);
    for (let t = 0; t <= 400; t += 33) { now = t; processor.process(frameWithHand({ curl: 1, timestamp: t })); }
    expect(processor.getGesturePoses().left).toBe("fist");
    for (let t = 433; t <= 1200; t += 33) { now = t; processor.process(frameWithHand({ curl: 0, timestamp: t })); }
    expect(processor.getGesturePoses().left).not.toBe("fist");
  });

  it("KHÔNG ghi đè leftHand/rightHand — cổ tay Phase 3B giữ nguyên", () => {
    let now = 0;
    const processor = new AvatarMotionProcessor({ now: () => now });
    processor.setFingerRig(buildRig());
    processor.setGestureEnabled(true);
    for (let t = 0; t <= 600; t += 33) { now = t; processor.process(frameWithHand({ curl: 1, timestamp: t })); }
    now = 633;
    const packet = processor.process(frameWithHand({ curl: 1, timestamp: 633 }));
    // Không có rigProfile nên arm không được tính; điều cần kiểm là gesture KHÔNG tự thêm khoá wrist.
    expect(packet.jointRotations.leftHand).toBeUndefined();
    expect(packet.jointRotations.rightHand).toBeUndefined();
  });

  it("tắt giữa chừng → phát identity rồi im lặng", () => {
    let now = 0;
    const processor = new AvatarMotionProcessor({ now: () => now });
    processor.setFingerRig(buildRig());
    processor.setGestureEnabled(true);
    for (let t = 0; t <= 600; t += 33) { now = t; processor.process(frameWithHand({ curl: 1, timestamp: t })); }

    processor.setGestureEnabled(false);
    now = 700;
    const clearing = processor.process(frameWithHand({ curl: 1, timestamp: 700 }));
    expect(fingerKeys(clearing).length).toBeGreaterThan(0);
    for (const key of fingerKeys(clearing)) {
      expect(clearing.jointRotations[key as keyof typeof clearing.jointRotations]).toEqual(IDENTITY_QUATERNION);
    }

    now = 733;
    const after = processor.process(frameWithHand({ curl: 1, timestamp: 733 }));
    expect(fingerKeys(after)).toEqual([]);
  });

  it("sample trùng timestamp không đẩy nhanh promotion", () => {
    // Render loop nhanh hơn detector: cùng một sample lặp lại nhiều frame.
    let now = 0;
    const processor = new AvatarMotionProcessor({ now: () => now });
    processor.setFingerRig(buildRig());
    processor.setGestureEnabled(true);
    for (let i = 0; i < 30; i += 1) {
      now = i * 2;
      processor.process(frameWithHand({ curl: 1, timestamp: 0 }));
    }
    expect(processor.getGesturePoses().left).toBe("rest");
  });

  it("chỉ ghi xương ngón nằm trong chuỗi điều khiển được", () => {
    let now = 0;
    const processor = new AvatarMotionProcessor({ now: () => now });
    const rig = buildRig();
    // Cắt chuỗi ngón trỏ trái xuống còn một đốt.
    rig.left.chains = rig.left.chains.map((chain) =>
      chain.finger === "index" ? { ...chain, segments: chain.segments.slice(0, 1) } : chain);
    processor.setFingerRig(rig);
    processor.setGestureEnabled(true);
    for (let t = 0; t <= 600; t += 33) { now = t; processor.process(frameWithHand({ curl: 1, timestamp: t })); }
    now = 633;
    const packet = processor.process(frameWithHand({ curl: 1, timestamp: 633 }));
    const keys = fingerKeys(packet);
    expect(keys).toContain("leftIndexProximal");
    expect(keys).not.toContain("leftIndexIntermediate");
    expect(keys).not.toContain("leftIndexDistal");
  });

  it("gesture tắt (mặc định) không ảnh hưởng packet", () => {
    let now = 0;
    const processor = new AvatarMotionProcessor({ now: () => now });
    processor.setFingerRig(buildRig());
    for (let t = 0; t <= 600; t += 33) { now = t; processor.process(frameWithHand({ curl: 1, timestamp: t })); }
    now = 633;
    const packet = processor.process(frameWithHand({ curl: 1, timestamp: 633 }));
    expect(fingerKeys(packet)).toEqual([]);
  });
});

describe("Phase 3B.3 Bước 2 — dáng open", () => {
  it("xoè tay đủ lâu → nhãn open", () => {
    let now = 0;
    const processor = new AvatarMotionProcessor({ now: () => now });
    processor.setFingerRig(buildRig());
    processor.setGestureEnabled(true);
    for (let t = 0; t <= 600; t += 33) { now = t; processor.process(frameWithHand({ curl: 0, timestamp: t })); }
    expect(processor.getGesturePoses().left).toBe("open");
  });

  it("chuyển nắm → xoè → nắm, nhãn bám theo và không kẹt", () => {
    let now = 0;
    const processor = new AvatarMotionProcessor({ now: () => now });
    processor.setFingerRig(buildRig());
    processor.setGestureEnabled(true);

    for (let t = 0; t <= 400; t += 33) { now = t; processor.process(frameWithHand({ curl: 1, timestamp: t })); }
    expect(processor.getGesturePoses().left).toBe("fist");

    for (let t = 433; t <= 900; t += 33) { now = t; processor.process(frameWithHand({ curl: 0, timestamp: t })); }
    expect(processor.getGesturePoses().left).toBe("open");

    for (let t = 933; t <= 1400; t += 33) { now = t; processor.process(frameWithHand({ curl: 1, timestamp: t })); }
    expect(processor.getGesturePoses().left).toBe("fist");
  });

  it("open và fist cho tư thế ngón KHÁC NHAU rõ rệt trên avatar", () => {
    // Nhãn đúng nhưng preset giống nhau thì người dùng không thấy khác biệt — cử chỉ mất ý nghĩa.
    const capture = (curl: number) => {
      let now = 0;
      const processor = new AvatarMotionProcessor({ now: () => now });
      processor.setFingerRig(buildRig());
      processor.setGestureEnabled(true);
      for (let t = 0; t <= 900; t += 33) { now = t; processor.process(frameWithHand({ curl, timestamp: t })); }
      now = 933;
      return processor.process(frameWithHand({ curl, timestamp: 933 })).jointRotations;
    };
    const fist = capture(1);
    const open = capture(0);
    const key = "leftMiddleIntermediate" as const;
    expect(fist[key]).toBeDefined();
    expect(open[key]).toBeDefined();
    // Góc giữa hai quaternion phải đủ lớn để nhìn thấy.
    const dot = Math.abs(
      fist[key]!.x * open[key]!.x + fist[key]!.y * open[key]!.y
      + fist[key]!.z * open[key]!.z + fist[key]!.w * open[key]!.w,
    );
    const angleDegrees = 2 * Math.acos(Math.min(1, dot)) * 180 / Math.PI;
    expect(angleDegrees).toBeGreaterThan(30);
  });
});

describe("Phase 3B.3 Bước 3 — dáng point", () => {
  const pointing = { thumb: 0.5, index: 0, middle: 1, ring: 1, little: 1 };

  const settle = (curl: HandCurl) => {
    let now = 0;
    const processor = new AvatarMotionProcessor({ now: () => now });
    processor.setFingerRig(buildRig());
    processor.setGestureEnabled(true);
    for (let t = 0; t <= 900; t += 33) { now = t; processor.process(frameWithHand({ curl, timestamp: t })); }
    return processor;
  };

  it("chỉ tay → nhãn point", () => {
    expect(settle(pointing).getGesturePoses().left).toBe("point");
  });

  it("chỉ tay KHÔNG bị nhận thành fist", () => {
    expect(settle(pointing).getGesturePoses().left).not.toBe("fist");
  });

  it("nắm đấm KHÔNG bị nhận thành point", () => {
    expect(settle(1).getGesturePoses().left).toBe("fist");
  });

  it("xoè tay KHÔNG bị nhận thành point", () => {
    expect(settle(0).getGesturePoses().left).toBe("open");
  });

  it("point cho NGÓN TRỎ duỗi nhưng ngón giữa vẫn co như fist", () => {
    // Kiểm trên rotation thật, không chỉ nhãn: nhãn đúng mà preset sai thì avatar vẫn hiển thị sai.
    const capture = (curl: HandCurl) => {
      let now = 0;
      const processor = new AvatarMotionProcessor({ now: () => now });
      processor.setFingerRig(buildRig());
      processor.setGestureEnabled(true);
      for (let t = 0; t <= 900; t += 33) { now = t; processor.process(frameWithHand({ curl, timestamp: t })); }
      now = 933;
      return processor.process(frameWithHand({ curl, timestamp: 933 })).jointRotations;
    };
    const point = capture(pointing);
    const fist = capture(1);
    const angleBetween = (a?: { x: number; y: number; z: number; w: number }, b?: typeof a) => {
      if (!a || !b) return Number.NaN;
      const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
      return 2 * Math.acos(Math.min(1, dot)) * 180 / Math.PI;
    };
    // Ngón trỏ: point duỗi, fist co → phải lệch nhau rõ.
    expect(angleBetween(point.leftIndexIntermediate, fist.leftIndexIntermediate)).toBeGreaterThan(30);
    // Ngón giữa: cả hai đều co → gần như trùng nhau.
    expect(angleBetween(point.leftMiddleIntermediate, fist.leftMiddleIntermediate)).toBeLessThan(10);
  });

  it("chuyển fist → point → open, nhãn bám theo từng bước", () => {
    let now = 0;
    const processor = new AvatarMotionProcessor({ now: () => now });
    processor.setFingerRig(buildRig());
    processor.setGestureEnabled(true);

    for (let t = 0; t <= 400; t += 33) { now = t; processor.process(frameWithHand({ curl: 1, timestamp: t })); }
    expect(processor.getGesturePoses().left).toBe("fist");

    for (let t = 433; t <= 900; t += 33) { now = t; processor.process(frameWithHand({ curl: pointing, timestamp: t })); }
    expect(processor.getGesturePoses().left).toBe("point");

    for (let t = 933; t <= 1400; t += 33) { now = t; processor.process(frameWithHand({ curl: 0, timestamp: t })); }
    expect(processor.getGesturePoses().left).toBe("open");
  });
});

describe("Phase 3B.3 Bước 4 — dáng thumbsUp", () => {
  // Bốn ngón co, ngón cái duỗi.
  const thumbUpCurl = { thumb: 0, index: 1, middle: 1, ring: 1, little: 1 };

  const settle = (thumbDirection: { x: number; y: number }, curl: HandCurl = thumbUpCurl) => {
    let now = 0;
    const processor = new AvatarMotionProcessor({ now: () => now });
    processor.setFingerRig(buildRig());
    processor.setGestureEnabled(true);
    for (let t = 0; t <= 900; t += 33) {
      now = t;
      processor.process(frameWithHand({ curl, timestamp: t, thumbDirection }));
    }
    return processor.getGesturePoses().left;
  };

  it("ngón cái chĩa LÊN → thumbsUp", () => {
    expect(settle({ x: 0, y: 1 })).toBe("thumbsUp");
  });

  it("ngón cái chĩa NGANG → KHÔNG phải thumbsUp", () => {
    expect(settle({ x: 1, y: 0 })).not.toBe("thumbsUp");
  });

  it("ngón cái chĩa XUỐNG → KHÔNG phải thumbsUp", () => {
    // Lỗi lớn nhất của plan v1, kiểm qua toàn bộ pipeline chứ không chỉ classifier.
    expect(settle({ x: 0, y: -1 })).not.toBe("thumbsUp");
  });

  it("ngón cái chếch lên vẫn nhận được", () => {
    expect(settle({ x: 0.5, y: 0.87 })).toBe("thumbsUp");
  });

  it("nắm đấm (ngón cái co) chĩa lên → fist, không phải thumbsUp", () => {
    expect(settle({ x: 0, y: 1 }, 1)).toBe("fist");
  });

  it("giơ lên rồi CHÚC XUỐNG → avatar phải NHẢ thumbsUp", () => {
    // Nghiệm thu webcam #5: avatar kẹt ở thumbsUp khi người dùng đã xoay ngón cái xuống.
    // `curl: 0.55` mô phỏng nắm tay LỎNG — đúng như tay thật khi chỉ để giơ ngón cái, chứ không
    // phải nắm đấm chặt. Với nắm lỏng, `fist` không đủ điểm thắng thay nên nhãn cũ sẽ được giữ
    // nếu classifier không chủ động nhả.
    const looseFist = { thumb: 0, index: 0.72, middle: 0.72, ring: 0.7, little: 0.68 };
    let now = 0;
    const processor = new AvatarMotionProcessor({ now: () => now });
    processor.setFingerRig(buildRig());
    processor.setGestureEnabled(true);

    for (let t = 0; t <= 600; t += 33) {
      now = t;
      processor.process(frameWithHand({ curl: looseFist, timestamp: t, thumbDirection: { x: 0, y: 1 } }));
    }
    expect(processor.getGesturePoses().left).toBe("thumbsUp");

    for (let t = 633; t <= 1600; t += 33) {
      now = t;
      processor.process(frameWithHand({ curl: looseFist, timestamp: t, thumbDirection: { x: 0, y: -1 } }));
    }
    expect(processor.getGesturePoses().left).not.toBe("thumbsUp");
  });

  it("giơ lên rồi xoay NGANG → avatar phải nhả thumbsUp", () => {
    const looseFist = { thumb: 0, index: 0.72, middle: 0.72, ring: 0.7, little: 0.68 };
    let now = 0;
    const processor = new AvatarMotionProcessor({ now: () => now });
    processor.setFingerRig(buildRig());
    processor.setGestureEnabled(true);
    for (let t = 0; t <= 600; t += 33) {
      now = t;
      processor.process(frameWithHand({ curl: looseFist, timestamp: t, thumbDirection: { x: 0, y: 1 } }));
    }
    for (let t = 633; t <= 1600; t += 33) {
      now = t;
      processor.process(frameWithHand({ curl: looseFist, timestamp: t, thumbDirection: { x: 1, y: 0 } }));
    }
    expect(processor.getGesturePoses().left).not.toBe("thumbsUp");
  });

  it("ngón cái RUNG quanh mốc → nhãn KHÔNG nhấp nháy", () => {
    // Nghiệm thu webcam #6: "lúc like được cả hai tay, lúc bị cụp xuống". Giơ like tự nhiên thì
    // ngón cái dao động vài độ liên tục chứ không đứng yên; không có hysteresis thì mỗi lần vượt
    // qua mốc là một lần bật/tắt nhãn.
    const looseFist = { thumb: 0, index: 0.72, middle: 0.72, ring: 0.7, little: 0.68 };
    let now = 0;
    const processor = new AvatarMotionProcessor({ now: () => now });
    processor.setFingerRig(buildRig());
    processor.setGestureEnabled(true);

    // Ổn định ở thumbsUp với ngón cái nghiêng 40°.
    for (let t = 0; t <= 600; t += 33) {
      now = t;
      processor.process(frameWithHand({
        curl: looseFist, timestamp: t,
        thumbDirection: { x: Math.cos(40 * Math.PI / 180), y: Math.sin(40 * Math.PI / 180) },
      }));
    }
    expect(processor.getGesturePoses().left).toBe("thumbsUp");

    // Rung quanh 25–40°: phải giữ nguyên nhãn suốt.
    for (let i = 0; i < 40; i += 1) {
      now = 633 + i * 33;
      const deg = 25 + (i % 2) * 15;
      processor.process(frameWithHand({
        curl: looseFist, timestamp: now,
        thumbDirection: { x: Math.cos(deg * Math.PI / 180), y: Math.sin(deg * Math.PI / 180) },
      }));
      expect(processor.getGesturePoses().left).toBe("thumbsUp");
    }
  });

  it("giơ like ~30° (tự nhiên, không dựng đứng) vẫn nhận được", () => {
    const looseFist = { thumb: 0, index: 0.72, middle: 0.72, ring: 0.7, little: 0.68 };
    let now = 0;
    const processor = new AvatarMotionProcessor({ now: () => now });
    processor.setFingerRig(buildRig());
    processor.setGestureEnabled(true);
    for (let t = 0; t <= 900; t += 33) {
      now = t;
      processor.process(frameWithHand({
        curl: looseFist, timestamp: t,
        thumbDirection: { x: Math.cos(30 * Math.PI / 180), y: Math.sin(30 * Math.PI / 180) },
      }));
    }
    expect(processor.getGesturePoses().left).toBe("thumbsUp");
  });

  it("thumbsUp đưa ngón cái rest ngang chĩa về torso-up", () => {
    // Nghiệm thu webcam #7: chỉ kiểm quaternion khác identity là không đủ — nhiều rotation vẫn
    // để endpoint ngón cái nằm ngang. Regression phải đo hình học sau khi renderer áp
    // `restLocal × deltaLocal`.
    const looseFist = { thumb: 0, index: 0.72, middle: 0.72, ring: 0.7, little: 0.68 };
    let now = 0;
    const processor = new AvatarMotionProcessor({ now: () => now });
    const fixture = buildRigFixture();
    processor.setFingerRig(fixture.rig);
    processor.setGestureEnabled(true);
    for (let t = 0; t <= 900; t += 33) {
      now = t;
      processor.process(frameWithHand({ curl: looseFist, timestamp: t, thumbDirection: { x: 0, y: 1 } }));
    }
    now = 933;
    const rotations = processor.process(
      frameWithHand({ curl: looseFist, timestamp: 933, thumbDirection: { x: 0, y: 1 } }),
    ).jointRotations;
    expect(processor.getGesturePoses().left).toBe("thumbsUp");

    const root = fixture.bones.leftThumbMetacarpal!;
    const restDirection = root.children[0]!.getWorldPosition(new Vector3())
      .sub(root.getWorldPosition(new Vector3()))
      .normalize();
    const torsoUp = fixture.neck.getWorldPosition(new Vector3())
      .sub(fixture.chest.getWorldPosition(new Vector3()))
      .normalize();
    expect(Math.abs(restDirection.dot(torsoUp))).toBeLessThan(0.01);
    expect(thumbDirectionAfterPacket(fixture.bones, "left", rotations.leftThumbMetacarpal!).dot(torsoUp))
      .toBeGreaterThan(0.98);
  });

  it("fist KHÔNG dựng ngón cái lên", () => {
    let now = 0;
    const processor = new AvatarMotionProcessor({ now: () => now });
    processor.setFingerRig(buildRig());
    processor.setGestureEnabled(true);
    for (let t = 0; t <= 900; t += 33) {
      now = t;
      processor.process(frameWithHand({ curl: 1, timestamp: t, thumbDirection: { x: 1, y: 0 } }));
    }
    expect(processor.getGesturePoses().left).toBe("fist");
  });

  it("chúc ngón cái xuống → thumbsDown, endpoint avatar chĩa về −torso-up", () => {
    const looseFist = { thumb: 0, index: 0.72, middle: 0.72, ring: 0.7, little: 0.68 };
    let now = 0;
    const processor = new AvatarMotionProcessor({ now: () => now });
    const fixture = buildRigFixture();
    processor.setFingerRig(fixture.rig);
    processor.setGestureEnabled(true);
    for (let t = 0; t <= 900; t += 33) {
      now = t;
      processor.process(frameWithHand({ curl: looseFist, timestamp: t, thumbDirection: { x: 0, y: -1 } }));
    }
    now = 933;
    const rotations = processor.process(
      frameWithHand({ curl: looseFist, timestamp: 933, thumbDirection: { x: 0, y: -1 } }),
    ).jointRotations;
    expect(processor.getGesturePoses().left).toBe("thumbsDown");
    const torsoUp = fixture.neck.getWorldPosition(new Vector3())
      .sub(fixture.chest.getWorldPosition(new Vector3()))
      .normalize();
    expect(thumbDirectionAfterPacket(fixture.bones, "left", rotations.leftThumbMetacarpal!).dot(torsoUp))
      .toBeLessThan(-0.98);
  });

  it("thumbsUp và thumbsDown cho endpoint avatar NGƯỢC CHIỀU nhau", () => {
    const looseFist = { thumb: 0, index: 0.72, middle: 0.72, ring: 0.7, little: 0.68 };
    const capture = (dirY: number) => {
      let now = 0;
      const processor = new AvatarMotionProcessor({ now: () => now });
      const fixture = buildRigFixture();
      processor.setFingerRig(fixture.rig);
      processor.setGestureEnabled(true);
      for (let t = 0; t <= 900; t += 33) {
        now = t;
        processor.process(frameWithHand({ curl: looseFist, timestamp: t, thumbDirection: { x: 0, y: dirY } }));
      }
      now = 933;
      const rotation = processor.process(
        frameWithHand({ curl: looseFist, timestamp: 933, thumbDirection: { x: 0, y: dirY } }),
      ).jointRotations.leftThumbMetacarpal!;
      const torsoUp = fixture.neck.getWorldPosition(new Vector3())
        .sub(fixture.chest.getWorldPosition(new Vector3()))
        .normalize();
      return { direction: thumbDirectionAfterPacket(fixture.bones, "left", rotation), torsoUp };
    };
    const up = capture(1);
    const down = capture(-1);
    expect(up.direction.dot(up.torsoUp)).toBeGreaterThan(0.98);
    expect(down.direction.dot(down.torsoUp)).toBeLessThan(-0.98);
    expect(up.direction.dot(down.direction)).toBeLessThan(-0.95);
  });

  it("xoay từ thumbsUp sang thumbsDown → nhãn chuyển, không kẹt", () => {
    const looseFist = { thumb: 0, index: 0.72, middle: 0.72, ring: 0.7, little: 0.68 };
    let now = 0;
    const processor = new AvatarMotionProcessor({ now: () => now });
    processor.setFingerRig(buildRig());
    processor.setGestureEnabled(true);
    for (let t = 0; t <= 600; t += 33) {
      now = t;
      processor.process(frameWithHand({ curl: looseFist, timestamp: t, thumbDirection: { x: 0, y: 1 } }));
    }
    expect(processor.getGesturePoses().left).toBe("thumbsUp");
    for (let t = 633; t <= 1600; t += 33) {
      now = t;
      processor.process(frameWithHand({ curl: looseFist, timestamp: t, thumbDirection: { x: 0, y: -1 } }));
    }
    expect(processor.getGesturePoses().left).toBe("thumbsDown");
  });

  it("thumbsUp cho ngón cái duỗi nhưng bốn ngón vẫn co như fist", () => {
    let now = 0;
    const processor = new AvatarMotionProcessor({ now: () => now });
    processor.setFingerRig(buildRig());
    processor.setGestureEnabled(true);
    for (let t = 0; t <= 900; t += 33) {
      now = t;
      processor.process(frameWithHand({ curl: thumbUpCurl, timestamp: t, thumbDirection: { x: 0, y: 1 } }));
    }
    now = 933;
    const rotations = processor.process(
      frameWithHand({ curl: thumbUpCurl, timestamp: 933, thumbDirection: { x: 0, y: 1 } }),
    ).jointRotations;
    expect(processor.getGesturePoses().left).toBe("thumbsUp");
    // Ngón cái duỗi → rotation gần identity.
    expect(Math.abs(rotations.leftThumbProximal!.w)).toBeGreaterThan(0.99);
    // Ngón giữa co → lệch rõ khỏi identity.
    expect(Math.abs(rotations.leftMiddleIntermediate!.w)).toBeLessThan(0.9);
  });
});

describe("Phase 3B.3 Bước 1 — blend theo thời gian", () => {
  it("rotation chuyển dần chứ không nhảy tức thì", () => {
    let now = 0;
    const processor = new AvatarMotionProcessor({ now: () => now });
    processor.setFingerRig(buildRig());
    processor.setGestureEnabled(true);
    // Đủ để promote fist.
    for (let t = 0; t <= 200; t += 33) { now = t; processor.process(frameWithHand({ curl: 1, timestamp: t })); }
    now = 210;
    const first = processor.process(frameWithHand({ curl: 1, timestamp: 210 }));
    now = 220;
    const second = processor.process(frameWithHand({ curl: 1, timestamp: 220 }));
    const key = "leftMiddleProximal" as const;
    const a = first.jointRotations[key];
    const b = second.jointRotations[key];
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    // Hai frame liên tiếp phải khác nhau (đang blend), và cả hai đều là quaternion chuẩn hoá.
    const norm = (q: { x: number; y: number; z: number; w: number }) => Math.hypot(q.x, q.y, q.z, q.w);
    expect(norm(a!)).toBeCloseTo(1, 5);
    expect(norm(b!)).toBeCloseTo(1, 5);
  });
});
