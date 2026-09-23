import type { Object3D } from "three";
import { Quaternion, Vector3 } from "three";
import {
  AVATAR_FINGER_NAMES,
  fingerJointName,
  fingerSegmentsOf,
  type AvatarFingerJointName,
  type AvatarFingerName,
  type AvatarFingerSegment,
  type AvatarThumbSegment,
  type QuaternionData,
  type Vector3Data,
} from "./avatarPoseTypes";

/**
 * Phase 3B.3 — Bước 0.4: rig ngón theo từng model.
 *
 * Ba việc, đều phải làm theo model chứ không hardcode:
 *
 * 1. **Capability theo CHUỖI.** VRM 1.0 khai báo 15 xương ngón mỗi tay nhưng tất cả đều optional,
 *    và một xương con chỉ có nghĩa khi xương cha tồn tại. Nếu proximal thiếu mà distal có, ghi
 *    rotation vào distal là ghi vào một đốt đang treo lơ lửng — kết quả biến dạng. Nên ta chỉ
 *    nhận phần chuỗi LIÊN TỤC tính từ gốc, đứt ở đâu dừng ở đó.
 *
 * 2. **Flex axis theo model.** Trục gập ngón khác nhau giữa các VRM (§3.6 của plan). Hardcode
 *    `rotationX = -60°` sẽ đúng ở model này và sai hoàn toàn ở model khác. Ta suy trục gập từ
 *    hình học rest pose của chính model đang tải.
 *
 * 3. **Hướng semantic của ngón cái.** Thumbs-up/down cần chạm torso-up/torso-down, không chỉ
 *    quay một góc cố định quanh trục phụ. Rig lưu swing rest-relative riêng cho từng model.
 */

export interface FingerSegmentRig {
  joint: AvatarFingerJointName;
  /**
   * Trục gập trong không gian LOCAL của chính xương đó (đơn vị). Xoay quanh trục này với góc
   * dương làm ngón cong lại phía lòng bàn tay.
   */
  flexAxisLocal: Vector3Data;
  /** Trục xoè/khép MCP trong bone-local; chỉ có ở đốt gốc bốn ngón khi rig quan sát được. */
  abductionAxisLocal?: Vector3Data;
  /** Góc xoè giải phẫu đã có sẵn trong rest pose của model; chỉ có ở root bốn ngón thường. */
  restAbductionRad?: number;
  /** Đổi dấu semantic-abduction sang chiều dương quanh `abductionAxisLocal`, suy bằng probe thực. */
  abductionDirectionSign?: 1 | -1;
  /**
   * Swing semantic đã hiệu chuẩn từ hướng rest của đốt gốc ngón cái tới trục lên/xuống của
   * avatar. Chỉ có ở `ThumbMetacarpal`; các đốt ngọn chỉ nhận flexion nhẹ.
   *
   * Không thể biểu diễn thumbs-up/down đáng tin cậy bằng một scalar quanh một trục abduction:
   * rest thumb mỗi model lệch khác nhau, và trục đó có thể không chứa hướng torso-up. Hai
   * quaternion này được suy ra từ hình học rest pose khi tải chính model, không phải preset
   * quaternion dùng chung giữa các VRM.
   */
  directionalSwingLocal?: { up: QuaternionData; down: QuaternionData };
  /** Có xương con nối tiếp để suy hướng không. Đốt cuối chuỗi dùng trục kế thừa từ đốt cha. */
  hasChild: boolean;
}

export interface FingerChainRig {
  finger: AvatarFingerName;
  /** Các đốt điều khiển được, theo thứ tự gốc → ngọn, LIÊN TỤC (không có lỗ hổng). */
  segments: FingerSegmentRig[];
  /**
   * Đốt đầu tiên KHÔNG điều khiển được, tính từ gốc ra. null nghĩa là đủ cả ba đốt.
   *
   * Giữ nguyên tên đốt VRM (`Metacarpal` cho ngón cái, `Intermediate` cho bốn ngón còn lại) để
   * panel DEV chỉ đúng bone bị thiếu thay vì một tên chuẩn hoá không tra được trong model.
   */
  truncatedAtSegment: AvatarFingerSegment | AvatarThumbSegment | null;
}

export interface HandFingerRig {
  side: "left" | "right";
  chains: FingerChainRig[];
  /** Pháp tuyến lòng bàn tay rest-pose suy từ chính VRM; null nếu hình học ngón không đủ tin cậy. */
  restPalmNormalWorld?: Vector3Data | null;
  /** Số đốt điều khiển được của cả bàn tay — dùng cho panel DEV. */
  controllableSegmentCount: number;
}

export interface FingerRigProfile {
  version: 1 | 2;
  modelGeneration: number;
  /** V2 guard: bone-local quaternion chỉ portable khi fingerprint/version trùng. */
  modelFingerprint?: string | null;
  left: HandFingerRig;
  right: HandFingerRig;
}

const EPSILON = 1e-6;

const quaternionData = (quaternion: Quaternion): QuaternionData => ({
  x: quaternion.x,
  y: quaternion.y,
  z: quaternion.z,
  w: quaternion.w,
});

/**
 * Trục gập của một đốt ngón, ĐÃ neo dấu theo hướng lòng bàn tay.
 *
 * Bài học từ nghiệm thu webcam lần 1: ngón duỗi thẳng và bẻ ngược ra sau như móng vuốt, dù nhãn
 * `fist` hoàn toàn đúng. Hai nguyên nhân, cả hai đều là **dấu trục không xác định**:
 *
 * 1. `cross(palmNormal, boneDirection)` cho trục vuông góc đúng, nhưng CHIỀU phụ thuộc dấu của
 *    `palmNormal` — vốn được suy từ thứ tự index→little rồi lật tay phải theo giả định. Giả định
 *    đó không kiểm chứng được trên model thật.
 * 2. Nhánh `cross(bone, child)` còn tệ hơn: dấu của nó phụ thuộc hoàn toàn vào hướng cong NGẪU
 *    NHIÊN của rest pose. Model có ngón hơi ưỡn ra sau ở rest sẽ cho trục ngược hẳn.
 *
 * Cách sửa: không suy đoán dấu nữa. Trục gập vẫn lấy vuông góc với hướng ngón, nhưng CHIỀU được
 * neo bằng một kiểm tra vật lý — quay thử một góc nhỏ quanh trục, nếu đầu ngón tiến về phía lòng
 * bàn tay thì dấu đúng, ngược lại thì lật. Kiểm tra này đúng với mọi model bất kể quy ước trục.
 */
function resolveFlexAxisWorld(
  boneDirectionWorld: Vector3,
  targetDirectionWorld: Vector3,
): Vector3 {
  // Trục gập vuông góc với cả hướng ngón lẫn hướng đích: đó là trục mà khi quay quanh nó, đầu
  // ngón di chuyển trong mặt phẳng chứa hai hướng đó — đúng mặt phẳng gập giải phẫu.
  const axis = new Vector3().crossVectors(boneDirectionWorld, targetDirectionWorld);
  if (axis.lengthSq() <= 1e-8) return new Vector3(0, 0, 0);
  axis.normalize();

  // Neo dấu bằng kiểm tra vật lý: quay hướng ngón một góc nhỏ quanh trục vừa dựng. Nếu kết quả
  // nghiêng về phía hướng đích (tích vô hướng tăng) thì dấu đúng.
  const probe = boneDirectionWorld.clone().applyAxisAngle(axis, 0.1);
  if (probe.dot(targetDirectionWorld) < boneDirectionWorld.dot(targetDirectionWorld)) axis.negate();
  return axis;
}

/**
 * Tạo swing ở local-rest space để đưa một hướng xương rest sang hướng semantic mục tiêu.
 *
 * `Quaternion.setFromUnitVectors` giải được mọi góc thông thường. Riêng ca đối song song, vô số
 * trục quay 180° đều đưa đầu ngón tới cùng một hướng nhưng có thể tạo roll da khác nhau; ta chọn
 * flex axis đã hiệu chuẩn làm tie-break giải phẫu thay vì để thư viện chọn một trục tùy ý.
 */
function resolveDirectionalSwingLocal(
  boneDirectionWorld: Vector3,
  targetDirectionWorld: Vector3,
  restWorldRotation: Quaternion,
  flexAxisWorld: Vector3,
): QuaternionData | null {
  const from = boneDirectionWorld.clone().normalize();
  const target = targetDirectionWorld.clone().normalize();
  if (from.lengthSq() <= EPSILON || target.lengthSq() <= EPSILON) return null;

  const dot = Math.max(-1, Math.min(1, from.dot(target)));
  let worldSwing: Quaternion;
  if (dot < -1 + 1e-6) {
    // Tie-break 180°: lấy trục gập, bỏ thành phần dọc theo hướng xương để chắc chắn vuông góc.
    const axis = flexAxisWorld.clone().addScaledVector(from, -flexAxisWorld.dot(from));
    if (axis.lengthSq() <= EPSILON) {
      // Fallback xác định, chỉ dùng cho rig suy biến hiếm gặp.
      axis.set(1, 0, 0).addScaledVector(from, -from.x);
      if (axis.lengthSq() <= EPSILON) axis.set(0, 0, 1).addScaledVector(from, -from.z);
    }
    if (axis.lengthSq() <= EPSILON) return null;
    worldSwing = new Quaternion().setFromAxisAngle(axis.normalize(), Math.PI);
  } else {
    worldSwing = new Quaternion().setFromUnitVectors(from, target);
  }

  // `deltaLocal` là rest-relative local. Nếu S là swing diễn ra trong world rest frame R,
  // delta cần lưu là R⁻¹ × S × R để renderer vẫn áp `restLocal × deltaLocal`.
  const localSwing = restWorldRotation.clone().invert().multiply(worldSwing).multiply(restWorldRotation).normalize();
  if (![localSwing.x, localSwing.y, localSwing.z, localSwing.w].every(Number.isFinite)) return null;
  return quaternionData(localSwing);
}

/**
 * Hướng mà đầu ngón phải tiến về khi gập — KHÁC NHAU giữa ngón cái và bốn ngón còn lại.
 *
 * Bốn ngón thường cuộn thẳng vào lòng bàn tay, nên hướng đích là `palmDirection`.
 *
 * Ngón cái thì không. Về giải phẫu nó gập **ngang qua lòng bàn tay** về phía ngón út (đối chiếu,
 * opposition), chứ không cuộn vào lòng. Quan trọng hơn: `palmDirection` được định nghĩa BẰNG CHÍNH
 * vị trí ngón cái, nên hướng ngón cái gần như song song với nó — tích có hướng suy biến, trục
 * bằng 0, và ngón cái đứng thẳng đơ không quay được. Đó chính là hiện tượng quan sát ở nghiệm thu
 * lần 2: bốn ngón cuộn đúng, riêng ngón cái thẳng.
 */
function resolveFlexTargetWorld(
  finger: AvatarFingerName,
  side: "left" | "right",
  palmDirectionWorld: Vector3,
  lookup: BoneLookup,
): Vector3 {
  if (finger !== "thumb") return palmDirectionWorld;

  // Ngón cái: hướng đích là "ngang qua lòng bàn tay", từ phía ngón trỏ sang phía ngón út.
  const indexBone = lookup(fingerJointName(side, "index", "Proximal"));
  const littleBone = lookup(fingerJointName(side, "little", "Proximal"));
  if (indexBone && littleBone) {
    const across = worldPosition(littleBone).sub(worldPosition(indexBone));
    if (across.lengthSq() > EPSILON) {
      across.normalize();
      // Pha thêm một phần hướng lòng bàn tay: ngón cái thật vừa vắt ngang vừa hơi cuộn vào trong,
      // chứ không quét thuần ngang. Tỉ lệ 1 : 0.5 cho tư thế nắm trông tự nhiên.
      across.addScaledVector(palmDirectionWorld, 0.5);
      if (across.lengthSq() > EPSILON) return across.normalize();
    }
  }
  return palmDirectionWorld;
}

interface BoneLookup {
  (joint: AvatarFingerJointName): Object3D | null | undefined;
}

function worldPosition(bone: Object3D): Vector3 {
  bone.updateWorldMatrix(true, false);
  return bone.getWorldPosition(new Vector3());
}

/**
 * "Lên" của avatar phải theo torso rest của model, không theo một trục local đoán trước. Model
 * VRM hợp lệ thường có cả chest/neck; +Y chỉ là fallback cho rig tối giản sau khi VRM0 đã được
 * loader chuẩn hóa về Three.js Y-up.
 */
function resolveAvatarUpWorld(bones: Partial<Record<string, Object3D>>): Vector3 {
  const chest = bones.chest;
  const neck = bones.neck;
  if (chest && neck) {
    const up = worldPosition(neck).sub(worldPosition(chest));
    if (up.lengthSq() > EPSILON) return up.normalize();
  }
  return new Vector3(0, 1, 0);
}

/**
 * Hướng "về phía lòng bàn tay" ở rest pose — vector mà đầu ngón phải tiến về khi nắm tay.
 *
 * Neo vào NGÓN CÁI thay vì suy từ thứ tự index→little. Lý do: ngón cái luôn nằm ở phía lòng bàn
 * tay, với mọi model và cả hai tay. Đây là dữ kiện giải phẫu quan sát được trực tiếp từ hình học
 * model, không phải một quy ước trục cần đoán — nên nó không bị lật sai như cách cũ.
 *
 * Cách đo: lấy thành phần của vector (gốc ngón cái − gốc ngón giữa) vuông góc với hướng các ngón.
 * Ngón cái lệch sang bên VÀ về phía lòng; bỏ phần "lệch sang bên" (song song với trục ngang bàn
 * tay) thì phần còn lại chính là "về phía lòng".
 */
function resolvePalmDirectionWorld(
  side: "left" | "right",
  handBone: Object3D | null | undefined,
  lookup: BoneLookup,
): Vector3 {
  if (!handBone) return new Vector3(0, 0, 0);
  const wrist = worldPosition(handBone);
  const thumbBone = lookup(fingerJointName(side, "thumb", "Metacarpal"))
    ?? lookup(fingerJointName(side, "thumb", "Proximal"));
  const middleBone = lookup(fingerJointName(side, "middle", "Proximal"));
  const indexBone = lookup(fingerJointName(side, "index", "Proximal"));
  const littleBone = lookup(fingerJointName(side, "little", "Proximal"));

  if (thumbBone && middleBone) {
    // Hướng các ngón mọc ra (cổ tay → gốc ngón giữa).
    const fingerAxis = worldPosition(middleBone).sub(wrist);
    if (fingerAxis.lengthSq() > EPSILON) {
      fingerAxis.normalize();
      const toThumb = worldPosition(thumbBone).sub(worldPosition(middleBone));
      // Bỏ thành phần dọc theo hướng ngón — chỉ giữ phần lệch ngang + lệch về phía lòng.
      toThumb.addScaledVector(fingerAxis, -toThumb.dot(fingerAxis));
      if (indexBone && littleBone) {
        // Bỏ nốt thành phần "ngang bàn tay" (trỏ→út). Phần còn lại thuần tuý là hướng lòng bàn tay.
        const acrossAxis = worldPosition(indexBone).sub(worldPosition(littleBone));
        if (acrossAxis.lengthSq() > EPSILON) {
          acrossAxis.normalize();
          toThumb.addScaledVector(acrossAxis, -toThumb.dot(acrossAxis));
        }
      }
      if (toThumb.lengthSq() > EPSILON) return toThumb.normalize();
    }
  }

  // Không có ngón cái để neo: lùi về pháp tuyến mặt phẳng bàn tay, dựng từ hai gốc ngón bất kỳ
  // còn lại. Dấu ở nhánh này vẫn là suy đoán theo chirality — kém tin cậy hơn hẳn cách neo bằng
  // ngón cái, nhưng nó chỉ chạy khi model thiếu ngón cái, và DEV panel vẫn báo capability.
  const radialOrder = ["index", "middle", "ring", "little"] as const;
  for (let first = 0; first < radialOrder.length; first += 1) {
    for (let second = radialOrder.length - 1; second > first; second -= 1) {
      const radialBone = lookup(fingerJointName(side, radialOrder[first], "Proximal"));
      const ulnarBone = lookup(fingerJointName(side, radialOrder[second], "Proximal"));
      if (!radialBone || !ulnarBone) continue;
      const toRadial = worldPosition(radialBone).sub(wrist);
      const toUlnar = worldPosition(ulnarBone).sub(wrist);
      if (toRadial.lengthSq() <= EPSILON || toUlnar.lengthSq() <= EPSILON) continue;
      // Chuẩn hoá trước khi lấy tích có hướng: bàn tay VRM rộng vài centimet nên tích có hướng
      // thô chỉ cỡ 1e-4 và ngưỡng tuyệt đối sẽ loại nhầm hình học hợp lệ. Sau chuẩn hoá đại lượng
      // đo là sin(góc giữa hai ngón), độc lập kích thước model.
      const normal = new Vector3().crossVectors(toRadial.normalize(), toUlnar.normalize());
      if (normal.lengthSq() <= 4e-4) continue;
      normal.normalize();
      return side === "right" ? normal.negate() : normal;
    }
  }
  return new Vector3(0, 0, 0);
}

/**
 * Dựng chuỗi điều khiển được của một ngón.
 *
 * Quy tắc chuỗi liên tục: duyệt từ proximal ra distal, gặp xương thiếu là DỪNG. Không "nhảy qua"
 * để lấy đốt xa hơn.
 */
function buildFingerChain(
  side: "left" | "right",
  finger: AvatarFingerName,
  palmDirectionWorld: Vector3,
  avatarUpWorld: Vector3,
  lookup: BoneLookup,
  restPalmAcrossWorld: Vector3,
  restPalmForwardWorld: Vector3,
): FingerChainRig {
  type Segment = AvatarFingerSegment | AvatarThumbSegment;
  const present: Array<{ segment: Segment; joint: AvatarFingerJointName; bone: Object3D }> = [];
  let truncatedAtSegment: Segment | null = null;
  for (const segment of fingerSegmentsOf(finger)) {
    const joint = fingerJointName(side, finger, segment);
    const bone = lookup(joint);
    // Chuỗi liên tục: gặp xương thiếu là dừng hẳn, KHÔNG nhảy qua để lấy đốt xa hơn — đốt xa mà
    // thiếu đốt cha là đốt treo lơ lửng, ghi rotation vào đó sẽ làm ngón biến dạng.
    if (!bone) { truncatedAtSegment = segment; break; }
    present.push({ segment, joint, bone });
  }

  // Ngón cái gập theo mặt phẳng khác bốn ngón còn lại; tính một lần cho cả chuỗi.
  const flexTargetWorld = resolveFlexTargetWorld(finger, side, palmDirectionWorld, lookup);

  const segments: FingerSegmentRig[] = [];
  for (let i = 0; i < present.length; i += 1) {
    const current = present[i];
    const next = present[i + 1];
    const origin = worldPosition(current.bone);
    // Hướng của đốt: từ chính nó tới đốt kế. Đốt cuối chuỗi không có đốt kế trong `present`, nên
    // thử lấy child thật trong scene graph (đốt distal thường có node đầu ngón).
    const nextPosition = next
      ? worldPosition(next.bone)
      : current.bone.children[0]
        ? worldPosition(current.bone.children[0])
        : null;
    const boneDirection = nextPosition ? nextPosition.clone().sub(origin) : null;
    if (!boneDirection || boneDirection.lengthSq() < EPSILON) {
      // Không suy được hướng riêng: kế thừa trục của đốt cha đã tính. Đốt gốc không có cha thì
      // ngón này không điều khiển được — dừng chuỗi tại đây thay vì đoán bừa một trục.
      const inherited = segments[segments.length - 1];
      if (!inherited) { truncatedAtSegment ??= current.segment; break; }
      segments.push({
        joint: current.joint, flexAxisLocal: inherited.flexAxisLocal, hasChild: false,
      });
      continue;
    }
    boneDirection.normalize();
    const flexAxisWorld = resolveFlexAxisWorld(boneDirection, flexTargetWorld);
    if (flexAxisWorld.lengthSq() < EPSILON) {
      const inherited = segments[segments.length - 1];
      if (!inherited) { truncatedAtSegment ??= current.segment; break; }
      segments.push({
        joint: current.joint, flexAxisLocal: inherited.flexAxisLocal, hasChild: Boolean(next),
      });
      continue;
    }
    // Đưa trục về local space của chính xương: renderer áp rotation là parent-local rest-relative
    // delta, nên trục quay phải nằm trong hệ quy chiếu của xương đó ở rest.
    const restWorldRotation = current.bone.getWorldQuaternion(new Quaternion()).normalize();
    const inverseRestWorld = restWorldRotation.clone().invert();
    const flexAxisLocal = flexAxisWorld.clone().applyQuaternion(inverseRestWorld).normalize();
    const abductionAxisLocal = i === 0 && palmDirectionWorld.lengthSq() > EPSILON
      ? palmDirectionWorld.clone().applyQuaternion(inverseRestWorld).normalize() : null;
    let restAbductionRad: number | undefined;
    let abductionDirectionSign: 1 | -1 | undefined;
    if (finger !== "thumb" && i === 0 && abductionAxisLocal && restPalmAcrossWorld.lengthSq() > EPSILON && restPalmForwardWorld.lengthSq() > EPSILON) {
      const semanticAngle = (direction: Vector3) => Math.atan2(
        direction.dot(restPalmAcrossWorld),
        Math.max(1e-6, direction.dot(restPalmForwardWorld)),
      );
      restAbductionRad = semanticAngle(boneDirection);
      const probed = boneDirection.clone().applyAxisAngle(palmDirectionWorld, 0.05);
      let change = semanticAngle(probed) - restAbductionRad;
      if (change > Math.PI) change -= 2 * Math.PI;
      if (change < -Math.PI) change += 2 * Math.PI;
      abductionDirectionSign = change >= 0 ? 1 : -1;
    }

    // Chỉ đốt gốc thumb nhận directional swing. Đây là joint có ý nghĩa giải phẫu để dựng/chúc
    // cả ngón; xoay đốt ngọn để đổi hướng sẽ cho dáng cong vẹo thay vì thumbs-up/down tự nhiên.
    const directionalSwingLocal = finger === "thumb" && i === 0
      ? (() => {
        const up = resolveDirectionalSwingLocal(boneDirection, avatarUpWorld, restWorldRotation, flexAxisWorld);
        const down = resolveDirectionalSwingLocal(boneDirection, avatarUpWorld.clone().negate(), restWorldRotation, flexAxisWorld);
        return up && down ? { up, down } : undefined;
      })()
      : undefined;
    segments.push({
      joint: current.joint,
      flexAxisLocal: { x: flexAxisLocal.x, y: flexAxisLocal.y, z: flexAxisLocal.z },
      ...(abductionAxisLocal ? { abductionAxisLocal: { x: abductionAxisLocal.x, y: abductionAxisLocal.y, z: abductionAxisLocal.z } } : {}),
      ...(restAbductionRad !== undefined ? { restAbductionRad, abductionDirectionSign } : {}),
      directionalSwingLocal,
      hasChild: Boolean(next),
    });
  }

  // Chuỗi bị cắt ngắn ngay trong vòng lặp dựng trục (thiếu hướng/trục suy biến) chứ không phải
  // vì thiếu bone: ghi nhận đốt đầu tiên không điều khiển được để panel DEV báo đúng.
  const expectedSegments = fingerSegmentsOf(finger);
  if (truncatedAtSegment === null && segments.length < expectedSegments.length) {
    truncatedAtSegment = expectedSegments[segments.length];
  }
  return { finger, segments, truncatedAtSegment };
}

export function buildHandFingerRig(
  side: "left" | "right",
  handBone: Object3D | null | undefined,
  lookup: BoneLookup,
  avatarUpWorld: Vector3 = new Vector3(0, 1, 0),
): HandFingerRig {
  const palmDirectionWorld = resolvePalmDirectionWorld(side, handBone, lookup);
  const restPalmAcrossWorld = new Vector3();
  const restPalmForwardWorld = new Vector3();
  const indexRoot = lookup(fingerJointName(side, "index", "Proximal"));
  const middleRoot = lookup(fingerJointName(side, "middle", "Proximal"));
  const littleRoot = lookup(fingerJointName(side, "little", "Proximal"));
  if (handBone && indexRoot && middleRoot && littleRoot) {
    restPalmAcrossWorld.copy(worldPosition(indexRoot)).sub(worldPosition(littleRoot));
    restPalmForwardWorld.copy(worldPosition(middleRoot)).sub(worldPosition(handBone));
    if (restPalmAcrossWorld.lengthSq() > EPSILON) {
      restPalmAcrossWorld.normalize();
      restPalmForwardWorld.addScaledVector(restPalmAcrossWorld, -restPalmForwardWorld.dot(restPalmAcrossWorld));
      if (restPalmForwardWorld.lengthSq() > EPSILON) restPalmForwardWorld.normalize(); else restPalmAcrossWorld.set(0,0,0);
    }
  }
  const chains = AVATAR_FINGER_NAMES.map((finger) => buildFingerChain(side, finger, palmDirectionWorld, avatarUpWorld, lookup, restPalmAcrossWorld, restPalmForwardWorld));
  return {
    side,
    chains,
    restPalmNormalWorld: palmDirectionWorld.lengthSq() > EPSILON
      ? { x: palmDirectionWorld.x, y: palmDirectionWorld.y, z: palmDirectionWorld.z }
      : null,
    controllableSegmentCount: chains.reduce((total, chain) => total + chain.segments.length, 0),
  };
}

export function buildFingerRigProfile(
  modelGeneration: number,
  bones: Partial<Record<string, Object3D>>,
  modelFingerprint: string | null = null,
): FingerRigProfile {
  const lookup: BoneLookup = (joint) => bones[joint];
  const avatarUpWorld = resolveAvatarUpWorld(bones);
  return {
    version: 2,
    modelGeneration,
    modelFingerprint,
    left: buildHandFingerRig("left", bones.leftHand, lookup, avatarUpWorld),
    right: buildHandFingerRig("right", bones.rightHand, lookup, avatarUpWorld),
  };
}

/** Tra cứu nhanh chuỗi của một ngón; planner dùng để biết được phép ghi tới đốt nào. */
export function findFingerChain(rig: HandFingerRig, finger: AvatarFingerName): FingerChainRig | null {
  return rig.chains.find((chain) => chain.finger === finger) ?? null;
}

/** Toàn bộ joint mà rig này điều khiển được — dùng để clear pose về identity khi tắt/rest. */
export function listControllableFingerJoints(profile: FingerRigProfile): AvatarFingerJointName[] {
  return [profile.left, profile.right].flatMap((hand) => hand.chains.flatMap((chain) => chain.segments.map((segment) => segment.joint)));
}
