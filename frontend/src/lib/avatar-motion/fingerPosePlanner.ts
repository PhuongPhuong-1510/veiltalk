import { Quaternion, Vector3 } from "three";
import type { AvatarFingerJointName, QuaternionData } from "./avatarPoseTypes";
import { IDENTITY_QUATERNION } from "./avatarPoseTypes";
import type { GesturePoseLabel } from "./gestureClassifier";
import type { FingerChainRig, HandFingerRig } from "./fingerRig";
import { FINGER_FLEXION_RANGE_RADIANS, getFingerPosePreset, type FingerFlexionTarget } from "./fingerPosePresets";

/**
 * Phase 3B.3 — Bước 1: đổi preset semantic thành quaternion cho model đang tải.
 *
 * KHÔNG có state. Cùng một nhãn + cùng một rig luôn cho cùng kết quả. State (blend theo thời gian)
 * nằm ở `fingerPoseTemporal`, tách riêng để dễ kiểm chứng từng phần.
 *
 * Hai ràng buộc bắt buộc:
 * - Chỉ ghi vào xương nằm trong chuỗi điều khiển được của `fingerRig`. Xương ngoài chuỗi chưa bao
 *   giờ được sở hữu nên không được ghi, kể cả identity.
 * - Không bao giờ đụng `leftHand`/`rightHand` — cổ tay thuộc Phase 3B (hand twist).
 */

export type FingerJointPlan = Partial<Record<AvatarFingerJointName, QuaternionData>>;

/** Thứ tự đốt trong chuỗi ứng với ba trường FLEXION của `FingerFlexionTarget`. */
const SEGMENT_ORDER = ["proximal", "intermediate", "distal"] as const;

function flexionQuaternion(axis: { x: number; y: number; z: number }, radians: number): QuaternionData {
  const vector = new Vector3(axis.x, axis.y, axis.z);
  if (vector.lengthSq() < 1e-12 || !Number.isFinite(radians)) return IDENTITY_QUATERNION;
  const quaternion = new Quaternion().setFromAxisAngle(vector.normalize(), radians).normalize();
  return { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w };
}

function multiplyQuaternions(a: QuaternionData, b: QuaternionData): QuaternionData {
  const result = new Quaternion(a.x, a.y, a.z, a.w)
    .multiply(new Quaternion(b.x, b.y, b.z, b.w))
    .normalize();
  return { x: result.x, y: result.y, z: result.z, w: result.w };
}

function planChain(chain: FingerChainRig, target: FingerFlexionTarget, plan: FingerJointPlan): void {
  const range = FINGER_FLEXION_RANGE_RADIANS[chain.finger];
  chain.segments.forEach((segment, index) => {
    // Chuỗi có thể ngắn hơn ba đốt (model thiếu xương). Đọc theo VỊ TRÍ trong chuỗi để đốt thứ
    // nhất luôn nhận giá trị `proximal`, không lệch khi chuỗi bị cắt.
    const key = SEGMENT_ORDER[index];
    if (!key) return;
    const amount = Math.max(0, Math.min(1, target[key]));
    const flex = flexionQuaternion(segment.flexAxisLocal, amount * range[key]);

    // Directional swing chỉ áp ở ĐỐT GỐC ngón cái. Một trục abduction scalar không thể đảm bảo
    // chạm torso-up/down cho mọi rest pose; rig đã precompute quaternion `up`/`down` riêng từng
    // model. Nếu rig suy biến không dựng được swing, vẫn phát flexion an toàn thay vì đoán trục.
    const direction = index === 0 ? target.direction : undefined;
    const swing = direction ? segment.directionalSwingLocal?.[direction] : undefined;
    // `swing × flex`: flex (bên phải) được áp trước trong local-rest space, sau đó swing đã
    // calibration đưa toàn bộ đốt gốc và các đốt con tới hướng semantic yêu cầu.
    plan[segment.joint] = swing ? multiplyQuaternions(swing, flex) : flex;
  });
}

/**
 * Dựng rotation cho một bàn tay.
 *
 * Trả về plan chỉ chứa các joint điều khiển được. Joint ngoài chuỗi không xuất hiện — planner
 * không được phép "dọn dẹp" thứ nó chưa bao giờ sở hữu.
 */
export function planFingerPose(rig: HandFingerRig, label: GesturePoseLabel): FingerJointPlan {
  const preset = getFingerPosePreset(label);
  const plan: FingerJointPlan = {};
  for (const chain of rig.chains) {
    if (chain.segments.length === 0) continue;
    planChain(chain, preset[chain.finger], plan);
  }
  return plan;
}

/** Mọi joint mà rig này điều khiển được — dùng để phát identity khi nhả pose. */
export function listPlannableJoints(rig: HandFingerRig): AvatarFingerJointName[] {
  return rig.chains.flatMap((chain) => chain.segments.map((segment) => segment.joint));
}
