import { describe, expect, it } from "vitest";
import { Object3D, Quaternion, Vector3 } from "three";
import { buildFingerRigProfile, buildHandFingerRig, findFingerChain, listControllableFingerJoints } from "./fingerRig";
import { AVATAR_FINGER_JOINT_NAMES, fingerJointName, type AvatarFingerJointName } from "./avatarPoseTypes";

/**
 * Dựng bàn tay giả theo hình học thật: cổ tay ở gốc, các ngón trải theo trục X, mỗi đốt nối dài
 * theo trục Y. Lòng bàn tay nằm trong mặt phẳng XY nên pháp tuyến là trục Z.
 */
function buildHandBones(options: {
  side: "left" | "right";
  omit?: AvatarFingerJointName[];
} ): { hand: Object3D; bones: Partial<Record<string, Object3D>> } {
  const omit = new Set(options.omit ?? []);
  const hand = new Object3D();
  hand.name = `${options.side}Hand`;
  const bones: Partial<Record<string, Object3D>> = { [`${options.side}Hand`]: hand };

  const fingers = ["thumb", "index", "middle", "ring", "little"] as const;
  fingers.forEach((finger, fingerIndex) => {
    const segments = finger === "thumb"
      ? (["Metacarpal", "Proximal", "Distal"] as const)
      : (["Proximal", "Intermediate", "Distal"] as const);
    let parent = hand;
    segments.forEach((segment, segmentIndex) => {
      const joint = fingerJointName(options.side, finger, segment);
      if (omit.has(joint)) return;
      const bone = new Object3D();
      bone.name = joint;
      // Đốt gốc lệch theo X để năm ngón nằm cạnh nhau; các đốt sau nối dài theo Y.
      //
      // Ngón cái lệch thêm theo -Z: bàn tay thật có ngón cái nằm PHÍA LÒNG chứ không đồng phẳng
      // với bốn ngón kia. Bàn tay giả phẳng lì sẽ không xác định được hướng lòng bàn tay, và
      // trục gập dựng từ nó sẽ vô nghĩa — đúng cái bẫy làm ngón bẻ ngược trên model thật.
      const thumbPalmOffset = finger === "thumb" && segmentIndex === 0 ? -0.025 : 0;
      // Tay phải là ảnh gương của tay trái qua mặt phẳng X=0 — đúng như hai bàn tay thật. Dựng
      // hai tay giống hệt nhau sẽ không kiểm được chirality, mà đó chính là thứ dễ sai nhất.
      const mirror = options.side === "right" ? -1 : 1;
      bone.position.set(segmentIndex === 0 ? fingerIndex * 0.02 * mirror : 0, 0.03, thumbPalmOffset);
      parent.add(bone);
      bones[joint] = bone;
      parent = bone;
    });
    // Đầu ngón: cho đốt distal có child để suy được hướng.
    const distal = bones[fingerJointName(options.side, finger, "Distal")];
    if (distal) {
      const tip = new Object3D();
      tip.position.set(0, 0.02, 0);
      distal.add(tip);
    }
  });
  hand.updateMatrixWorld(true);
  return { hand, bones };
}

/**
 * Cùng bàn tay giả ở trên, nhưng đặt dưới chest/neck thật để test hướng semantic của avatar.
 * Các ca thông thường dùng `thumbRestDirection` nằm ngang; quay rest-local của đốt gốc thay vì
 * chỉ sửa vị trí child để regression đi qua đúng contract `restLocalRotation × deltaLocal`.
 */
function buildDirectionalThumbFixture(options: {
  side: "left" | "right";
  thumbRestDirection: Vector3;
  requireHorizontalRest?: boolean;
}): { chest: Object3D; neck: Object3D; hand: Object3D; bones: Partial<Record<string, Object3D>> } {
  const { hand, bones } = buildHandBones({ side: options.side });
  const chest = new Object3D();
  chest.name = "chest";
  const neck = new Object3D();
  neck.name = "neck";
  neck.position.set(0, 0.25, 0);
  chest.add(neck);
  chest.add(hand);
  hand.position.set(options.side === "left" ? -0.18 : 0.18, 0.08, 0);

  const root = bones[fingerJointName(options.side, "thumb", "Metacarpal")]!;
  const horizontal = options.thumbRestDirection.clone().normalize();
  // Mỗi ca regression phải thật sự có thumb rest nằm ngang, nếu không "đưa lên" có thể pass
  // bằng identity khi rest pose vô tình đã trùng torso-up.
  if (options.requireHorizontalRest ?? true) expect(Math.abs(horizontal.y)).toBeLessThan(1e-6);
  root.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), horizontal);

  bones.chest = chest;
  bones.neck = neck;
  chest.updateMatrixWorld(true);
  return { chest, neck, hand, bones };
}

/** Áp đúng contract renderer: `restLocalRotation × deltaLocal`, rồi đo hướng child trong world. */
function directionAfterRestRelativeDelta(
  bone: Object3D,
  child: Object3D,
  delta: { x: number; y: number; z: number; w: number },
): Vector3 {
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

describe("fingerRig — capability theo chuỗi", () => {
  it("model đủ xương cho chuỗi ba đốt mỗi ngón", () => {
    const { hand, bones } = buildHandBones({ side: "left" });
    const rig = buildHandFingerRig("left", hand, (joint) => bones[joint]);
    expect(rig.chains).toHaveLength(5);
    for (const chain of rig.chains) {
      expect(chain.segments).toHaveLength(3);
      expect(chain.truncatedAtSegment).toBeNull();
    }
    expect(rig.controllableSegmentCount).toBe(15);
    expect(rig.restPalmNormalWorld).not.toBeNull();
    expect(Math.hypot(rig.restPalmNormalWorld!.x, rig.restPalmNormalWorld!.y, rig.restPalmNormalWorld!.z)).toBeCloseTo(1);
  });

  it("thiếu proximal thì KHÔNG điều khiển đốt nào của ngón đó", () => {
    const { hand, bones } = buildHandBones({ side: "left", omit: ["leftIndexProximal"] });
    const rig = buildHandFingerRig("left", hand, (joint) => bones[joint]);
    const index = findFingerChain(rig, "index");
    expect(index?.segments).toHaveLength(0);
    expect(index?.truncatedAtSegment).toBe("Proximal");
    // Các ngón khác không bị ảnh hưởng.
    expect(findFingerChain(rig, "middle")?.segments).toHaveLength(3);
  });

  it("có proximal, thiếu intermediate, CÓ distal → chỉ tới proximal, không ghi vào distal", () => {
    // Đây là ca §3.7 của plan: đốt distal tồn tại nhưng cha nó thiếu. Nhảy qua để lấy distal sẽ
    // làm ngón biến dạng vì đốt đó đang treo lơ lửng.
    const { hand, bones } = buildHandBones({ side: "left", omit: ["leftIndexIntermediate"] });
    // Dựng lại distal như con trực tiếp của proximal để mô phỏng rig malformed.
    const proximal = bones.leftIndexProximal!;
    const distal = new Object3D();
    distal.name = "leftIndexDistal";
    distal.position.set(0, 0.03, 0);
    proximal.add(distal);
    bones.leftIndexDistal = distal;
    hand.updateMatrixWorld(true);

    const rig = buildHandFingerRig("left", hand, (joint) => bones[joint]);
    const index = findFingerChain(rig, "index");
    expect(index?.segments.map((segment) => segment.joint)).toEqual(["leftIndexProximal"]);
    expect(index?.truncatedAtSegment).toBe("Intermediate");
    expect(listControllableFingerJoints({ version: 1, modelGeneration: 0, left: rig, right: rig }))
      .not.toContain("leftIndexDistal");
  });

  it("ngón cái dùng Metacarpal, không bao giờ sinh tên leftThumbIntermediate", () => {
    const { hand, bones } = buildHandBones({ side: "left" });
    const rig = buildHandFingerRig("left", hand, (joint) => bones[joint]);
    const thumb = findFingerChain(rig, "thumb");
    expect(thumb?.segments.map((segment) => segment.joint))
      .toEqual(["leftThumbMetacarpal", "leftThumbProximal", "leftThumbDistal"]);
    expect(AVATAR_FINGER_JOINT_NAMES).not.toContain("leftThumbIntermediate" as AvatarFingerJointName);
  });

  it("thiếu ngón trỏ KHÔNG làm mất trục gập của các ngón còn lại", () => {
    // Pháp tuyến lòng bàn tay dựng từ một cặp gốc ngón. Nếu chỉ thử đúng cặp index↔little thì
    // model thiếu một trong hai ngón đó sẽ mất trục gập của CẢ bàn tay, dù các ngón khác lành.
    const { hand, bones } = buildHandBones({
      side: "left",
      omit: ["leftIndexProximal", "leftIndexIntermediate", "leftIndexDistal"],
    });
    const rig = buildHandFingerRig("left", hand, (joint) => bones[joint]);
    expect(findFingerChain(rig, "index")?.segments).toHaveLength(0);
    for (const finger of ["middle", "ring", "little"] as const) {
      expect(findFingerChain(rig, finger)?.segments).toHaveLength(3);
    }
  });

  it("chỉ còn hai ngón vẫn dựng được trục gập", () => {
    const { hand, bones } = buildHandBones({
      side: "left",
      omit: [
        "leftThumbMetacarpal", "leftThumbProximal", "leftThumbDistal",
        "leftRingProximal", "leftRingIntermediate", "leftRingDistal",
        "leftLittleProximal", "leftLittleIntermediate", "leftLittleDistal",
      ],
    });
    const rig = buildHandFingerRig("left", hand, (joint) => bones[joint]);
    expect(findFingerChain(rig, "index")?.segments).toHaveLength(3);
    expect(findFingerChain(rig, "middle")?.segments).toHaveLength(3);
    expect(rig.controllableSegmentCount).toBe(6);
  });

  it("model không có xương ngón nào → rig rỗng, không ném lỗi", () => {
    const hand = new Object3D();
    const rig = buildHandFingerRig("left", hand, () => null);
    expect(rig.controllableSegmentCount).toBe(0);
    for (const chain of rig.chains) expect(chain.truncatedAtSegment).toBe(chain.finger === "thumb" ? "Metacarpal" : "Proximal");
  });
});

describe("fingerRig — flex axis", () => {
  it("trục gập là vector đơn vị hữu hạn cho mọi đốt điều khiển được", () => {
    const { hand, bones } = buildHandBones({ side: "left" });
    const rig = buildHandFingerRig("left", hand, (joint) => bones[joint]);
    for (const chain of rig.chains) {
      for (const segment of chain.segments) {
        const { x, y, z } = segment.flexAxisLocal;
        expect(Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)).toBe(true);
        expect(new Vector3(x, y, z).length()).toBeCloseTo(1, 5);
      }
    }
  });

  it("ngón duỗi thẳng (rest pose) vẫn suy được trục gập từ pháp tuyến lòng bàn tay", () => {
    // Bàn tay giả có mọi đốt thẳng hàng theo Y — tích có hướng giữa hai đốt suy biến. Nếu code
    // chỉ dựa vào tích có hướng đó thì trục sẽ là vector 0 và ngón không gập được.
    const { hand, bones } = buildHandBones({ side: "left" });
    const rig = buildHandFingerRig("left", hand, (joint) => bones[joint]);
    const index = findFingerChain(rig, "index");
    expect(index?.segments).toHaveLength(3);
    const axis = index!.segments[0].flexAxisLocal;
    expect(new Vector3(axis.x, axis.y, axis.z).length()).toBeCloseTo(1, 5);
  });

  it("NGÓN CÁI có trục gập khác 0 — không được suy biến", () => {
    // Nghiệm thu webcam lần 2: bốn ngón cuộn đúng nhưng ngón cái đứng thẳng đơ. Nguyên nhân là
    // hướng lòng bàn tay được định nghĩa BẰNG CHÍNH vị trí ngón cái, nên với ngón cái hai vector
    // gần song song, tích có hướng suy biến và trục bằng 0. Ngón cái phải có mặt phẳng gập riêng.
    for (const side of ["left", "right"] as const) {
      const { hand, bones } = buildHandBones({ side });
      const rig = buildHandFingerRig(side, hand, (joint) => bones[joint]);
      const thumb = findFingerChain(rig, "thumb")!;
      expect(thumb.segments).toHaveLength(3);
      for (const segment of thumb.segments) {
        const axis = new Vector3(segment.flexAxisLocal.x, segment.flexAxisLocal.y, segment.flexAxisLocal.z);
        expect(axis.length()).toBeCloseTo(1, 5);
      }
    }
  });

  it("ngón cái gập theo mặt phẳng KHÁC bốn ngón còn lại", () => {
    // Ngón cái vắt ngang qua lòng bàn tay; bốn ngón kia cuộn thẳng vào lòng. Trục gập trùng nhau
    // nghĩa là ngón cái đang bị đối xử như ngón thường — sẽ cho tư thế nắm sai giải phẫu.
    const { hand, bones } = buildHandBones({ side: "left" });
    const rig = buildHandFingerRig("left", hand, (joint) => bones[joint]);
    const toWorld = (joint: string, local: { x: number; y: number; z: number }) =>
      new Vector3(local.x, local.y, local.z)
        .applyQuaternion(bones[joint]!.getWorldQuaternion(new Quaternion()))
        .normalize();
    const thumbSeg = findFingerChain(rig, "thumb")!.segments[0];
    const indexSeg = findFingerChain(rig, "index")!.segments[0];
    const thumbAxis = toWorld(thumbSeg.joint, thumbSeg.flexAxisLocal);
    const indexAxis = toWorld(indexSeg.joint, indexSeg.flexAxisLocal);
    expect(Math.abs(thumbAxis.dot(indexAxis))).toBeLessThan(0.95);
  });

  it("directional swing chỉ tồn tại ở ThumbMetacarpal", () => {
    const fixture = buildDirectionalThumbFixture({ side: "left", thumbRestDirection: new Vector3(1, 0, 0) });
    const rig = buildFingerRigProfile(1, fixture.bones).left;
    const thumb = findFingerChain(rig, "thumb")!;

    expect(thumb.segments[0]?.joint).toBe("leftThumbMetacarpal");
    expect(thumb.segments[0]?.directionalSwingLocal).toBeDefined();
    for (const chain of rig.chains) {
      for (const segment of chain.segments) {
        if (segment.joint === "leftThumbMetacarpal") continue;
        expect(segment.directionalSwingLocal).toBeUndefined();
      }
    }
  });

  it("thumb ngang ở hai rest orientation, hai tay → directional swing chạm ±torso-up", () => {
    // Đây là regression hình học của lỗi webcam: test không được chỉ nhìn quaternion khác
    // identity. Nó áp rotation theo đúng renderer rồi đo thật sự đầu ngón có chĩa lên/xuống theo
    // chest→neck hay không. Hai hướng rest ngang bắt lỗi hardcode một mặt phẳng/model cụ thể.
    const orientations = [new Vector3(1, 0, 0), new Vector3(0, 0, 1)];
    for (const side of ["left", "right"] as const) {
      for (const orientation of orientations) {
        const restDirection = orientation.clone().multiplyScalar(side === "left" ? 1 : -1);
        const fixture = buildDirectionalThumbFixture({ side, thumbRestDirection: restDirection });
        const handRig = buildFingerRigProfile(1, fixture.bones)[side];
        const root = findFingerChain(handRig, "thumb")!.segments[0]!;
        const swing = root.directionalSwingLocal;
        expect(swing).toBeDefined();

        const bone = fixture.bones[root.joint]!;
        const child = bone.children[0]!;
        const torsoUp = fixture.neck.getWorldPosition(new Vector3())
          .sub(fixture.chest.getWorldPosition(new Vector3()))
          .normalize();
        const rest = child.getWorldPosition(new Vector3())
          .sub(bone.getWorldPosition(new Vector3()))
          .normalize();
        expect(Math.abs(rest.dot(torsoUp))).toBeLessThan(0.01);

        const up = directionAfterRestRelativeDelta(bone, child, swing!.up);
        const down = directionAfterRestRelativeDelta(bone, child, swing!.down);
        expect(up.dot(torsoUp)).toBeGreaterThan(0.995);
        expect(down.dot(torsoUp)).toBeLessThan(-0.995);
      }
    }
  });

  it("thumb rest đối song song −torso-up → fallback 180° vẫn chĩa đúng +torso-up, không NaN", () => {
    // `Quaternion.setFromUnitVectors` có ca đặc biệt khi hai ray đối song song: có vô số trục
    // quay 180°. Rig phải dùng flex axis làm tie-break ổn định, rồi vẫn giữ chính xác convention
    // renderer `rest × delta`; không được rơi vào zero quaternion hay NaN.
    const fixture = buildDirectionalThumbFixture({
      side: "left",
      thumbRestDirection: new Vector3(0, -1, 0),
      requireHorizontalRest: false,
    });
    const root = findFingerChain(buildFingerRigProfile(1, fixture.bones).left, "thumb")!.segments[0]!;
    const upSwing = root.directionalSwingLocal?.up;
    expect(upSwing).toBeDefined();
    expect(Object.values(upSwing!).every(Number.isFinite)).toBe(true);

    const bone = fixture.bones[root.joint]!;
    const child = bone.children[0]!;
    const torsoUp = fixture.neck.getWorldPosition(new Vector3())
      .sub(fixture.chest.getWorldPosition(new Vector3()))
      .normalize();
    const rest = child.getWorldPosition(new Vector3())
      .sub(bone.getWorldPosition(new Vector3()))
      .normalize();
    expect(rest.dot(torsoUp)).toBeLessThan(-0.999);

    const after = directionAfterRestRelativeDelta(bone, child, upSwing!);
    expect(after.dot(torsoUp)).toBeGreaterThan(0.995);
    expect([after.x, after.y, after.z].every(Number.isFinite)).toBe(true);
  });

  it("quay quanh trục gập đưa đầu ngón VỀ PHÍA LÒNG BÀN TAY, cả hai tay", () => {
    // Đây là bất biến thật sự cần giữ, thay cho việc so dấu trục giữa hai tay: nghiệm thu webcam
    // lần 1 cho thấy ngón duỗi thẳng rồi bẻ NGƯỢC ra sau như móng vuốt, dù nhãn `fist` đã đúng.
    // Nguyên nhân là dấu trục gập không xác định. Test này quay thử và kiểm hướng di chuyển thật.
    for (const side of ["left", "right"] as const) {
      const { hand, bones } = buildHandBones({ side });
      const rig = buildHandFingerRig(side, hand, (joint) => bones[joint]);
      // Lòng bàn tay ở phía -Z theo cách dựng bàn tay giả (ngón cái lệch -Z).
      const palmDirection = new Vector3(0, 0, -1);

      for (const fingerName of ["index", "middle", "ring", "little"] as const) {
        const chain = findFingerChain(rig, fingerName)!;
        const segment = chain.segments[0];
        const bone = bones[segment.joint]!;
        const child = bone.children[0]!;

        const boneWorld = bone.getWorldPosition(new Vector3());
        const before = child.getWorldPosition(new Vector3()).sub(boneWorld).normalize();
        // Trục lưu ở local space của xương; đổi sang world để quay hướng world.
        const axisWorld = new Vector3(segment.flexAxisLocal.x, segment.flexAxisLocal.y, segment.flexAxisLocal.z)
          .applyQuaternion(bone.getWorldQuaternion(new Quaternion()))
          .normalize();
        const after = before.clone().applyAxisAngle(axisWorld, 0.5);

        // Gập phải làm đầu ngón tiến VỀ phía lòng bàn tay, không phải rời xa nó.
        expect(after.dot(palmDirection)).toBeGreaterThan(before.dot(palmDirection));
      }
    }
  });
});

describe("fingerRig — profile hai tay", () => {
  it("dựng được cả hai tay và liệt kê đúng joint điều khiển được", () => {
    const left = buildHandBones({ side: "left" });
    const right = buildHandBones({ side: "right" });
    const profile = buildFingerRigProfile(7, { ...left.bones, ...right.bones });
    expect(profile.modelGeneration).toBe(7);
    expect(profile.left.controllableSegmentCount).toBe(15);
    expect(profile.right.controllableSegmentCount).toBe(15);
    expect(listControllableFingerJoints(profile)).toHaveLength(30);
  });

  it("model thiếu hẳn một tay vẫn dựng được tay còn lại", () => {
    const left = buildHandBones({ side: "left" });
    const profile = buildFingerRigProfile(1, left.bones);
    expect(profile.left.controllableSegmentCount).toBe(15);
    expect(profile.right.controllableSegmentCount).toBe(0);
  });
});
