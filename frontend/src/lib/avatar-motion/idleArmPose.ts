import { Quaternion, Vector3 } from "three";
import type { QuaternionData } from "./avatarPoseTypes";
import type { ArmSide } from "./avatarMotionDiagnostics";
import type { ControlledArmJoint, NormalizedAvatarRigProfile } from "./normalizedRigProfile";
import { inverseQuaternion, multiplyQuaternions, rotateVector, vector } from "./motionMath";

/**
 * Tư thế nghỉ khi mất theo dõi: tay buông dọc thân thay vì T-pose dang ngang.
 * Rest pose của rig humanoid là T-pose, nên identity delta cho ra hai tay dang ngang —
 * dáng đứng không ai làm khi ngồi trước webcam. Ở đây dựng delta đưa cánh tay xuống.
 */

/**
 * Góc hạ so với rest T-pose, khớp chính xác preset `armsDown` trong bảng Frozen presets của
 * dev harness: cánh tay trên hạ thẳng đứng 90° so với T-pose, cẳng tay thẳng hàng với cánh
 * tay trên (0° gập thêm) — đo trực tiếp từ world landmark của preset đó, không phải ước lượng.
 */
export const IDLE_ARM_ANGLES = { upperDownDegrees: 90, lowerDownDegrees: 0 } as const;

const IDENTITY: QuaternionData = { x: 0, y: 0, z: 0, w: 1 };
const quaternionData = (value: Quaternion): QuaternionData => ({ x: value.x, y: value.y, z: value.z, w: value.w });

/**
 * Delta local đưa xương từ hướng rest xuống hướng buông. Xoay quanh trục vuông góc với mặt
 * phẳng chứa hướng rest và hướng xuống, biểu diễn trong không gian local của khớp để khớp
 * đúng quy ước `restLocal × delta` mà renderer áp dụng.
 */
function downwardDelta(
  profile: NormalizedAvatarRigProfile,
  joint: ControlledArmJoint,
  parentTargetWorld: QuaternionData,
  degrees: number,
): QuaternionData {
  // 0° nghĩa là "giữ nguyên hướng cha", tức không xoay thêm gì trong local space — đúng cho
  // cẳng tay thẳng hàng với cánh tay trên bất kể cánh tay trên đã hạ bao nhiêu độ.
  if (degrees === 0) return IDENTITY;
  const rest = profile.joints[joint];
  const restDirection = vector(rest.restWorldDirection).normalize();
  const down = new Vector3(0, -1, 0);
  const axis = restDirection.clone().cross(down);
  // Hướng rest đã trùng phương thẳng đứng thì không có trục xoay xác định; giữ nguyên.
  if (axis.lengthSq() < 1e-8) return IDENTITY;
  axis.normalize();
  const worldRotation = new Quaternion().setFromAxisAngle(axis, (degrees * Math.PI) / 180);
  // Xoay world rest-direction thẳng xuống dưới (trọng lực), không phụ thuộc cách vai/ancestor
  // đang nghiêng — tay buông luôn hướng xuống đất, đúng ý định của tư thế nghỉ.
  const targetWorld = multiplyQuaternions(quaternionData(worldRotation), rest.restWorldRotation);
  const targetLocal = multiplyQuaternions(inverseQuaternion(parentTargetWorld), targetWorld);
  return multiplyQuaternions(inverseQuaternion(rest.restLocalRotation), targetLocal);
}

export interface IdleArmPose { upper: QuaternionData; lower: QuaternionData }

/**
 * Dựng tư thế buông tay cho một bên. Cẳng tay tính sau cánh tay trên vì nó nối tiếp trong
 * chuỗi khớp: parent world của nó là kết quả đã xoay của cánh tay trên.
 */
export function buildIdleArmPose(profile: NormalizedAvatarRigProfile, side: ArmSide): IdleArmPose {
  const names: Record<ArmSide, { upper: ControlledArmJoint; lower: ControlledArmJoint }> = {
    left: { upper: "leftUpperArm", lower: "leftLowerArm" },
    right: { upper: "rightUpperArm", lower: "rightLowerArm" },
  };
  const { upper: upperName, lower: lowerName } = names[side];
  const upperJoint = profile.joints[upperName];
  const upper = downwardDelta(profile, upperName, upperJoint.parentRestWorldRotation, IDLE_ARM_ANGLES.upperDownDegrees);
  const upperTargetWorld = multiplyQuaternions(
    upperJoint.parentRestWorldRotation,
    multiplyQuaternions(upperJoint.restLocalRotation, upper),
  );
  const lower = downwardDelta(profile, lowerName, upperTargetWorld, IDLE_ARM_ANGLES.lowerDownDegrees);
  return { upper, lower };
}

/** Hướng thế giới của xương sau khi áp delta — dùng để kiểm chứng tay thật sự hạ xuống. */
export function idleWorldDirection(
  profile: NormalizedAvatarRigProfile,
  joint: ControlledArmJoint,
  parentTargetWorld: QuaternionData,
  delta: QuaternionData,
): Vector3 {
  const rest = profile.joints[joint];
  const targetWorld = multiplyQuaternions(parentTargetWorld, multiplyQuaternions(rest.restLocalRotation, delta));
  const local = rotateVector(inverseQuaternion(rest.restWorldRotation), rest.restWorldDirection);
  return vector(rotateVector(targetWorld, local)).normalize();
}
