import type { TrackingSampleState } from "../tracking/rawTrackingTypes";
import type { HandMotionDiagnosticsSnapshot } from "./handMotionDiagnostics";

export type AvatarSourceTrackingState = TrackingSampleState;
export type AvatarOutputMotionState = "active" | "held" | "returning" | "idle";

export type AvatarJointName =
  | "neck" | "chest"
  | "leftShoulder" | "leftUpperArm" | "leftLowerArm" | "leftHand"
  | "rightShoulder" | "rightUpperArm" | "rightLowerArm" | "rightHand";

export type AvatarFingerName = "thumb" | "index" | "middle" | "ring" | "little";

/**
 * Tên đốt giữa KHÁC NHAU giữa ngón cái và bốn ngón còn lại — đây là chuẩn VRM, không phải lựa
 * chọn của ta. Bốn ngón thường có ba đốt MCP/PIP/DIP → `Proximal`/`Intermediate`/`Distal`. Ngón
 * cái về giải phẫu không có đốt giữa; VRM 1.0 đặt tên theo xương bàn tay:
 * `Metacarpal`/`Proximal`/`Distal`.
 *
 * Dùng chung một tên `Intermediate` cho cả hai sẽ tạo ra `leftThumbIntermediate` — một bone
 * KHÔNG TỒN TẠI trong bất kỳ VRM nào, và `getNormalizedBoneNode` sẽ từ chối ngay ở mức kiểu.
 */
export type AvatarFingerSegment = "Proximal" | "Intermediate" | "Distal";
export type AvatarThumbSegment = "Metacarpal" | "Proximal" | "Distal";

export const AVATAR_FINGER_NAMES: readonly AvatarFingerName[] = ["thumb", "index", "middle", "ring", "little"];
export const AVATAR_FINGER_SEGMENTS: readonly AvatarFingerSegment[] = ["Proximal", "Intermediate", "Distal"];
export const AVATAR_THUMB_SEGMENTS: readonly AvatarThumbSegment[] = ["Metacarpal", "Proximal", "Distal"];

/** Ba đốt theo thứ tự gốc → ngọn của một ngón bất kỳ, đã chọn đúng bộ tên cho ngón cái. */
export function fingerSegmentsOf(finger: AvatarFingerName): readonly (AvatarFingerSegment | AvatarThumbSegment)[] {
  return finger === "thumb" ? AVATAR_THUMB_SEGMENTS : AVATAR_FINGER_SEGMENTS;
}

/**
 * Phase 3B.3 — 30 xương ngón VRM (5 ngón × 3 đốt × 2 tay).
 *
 * Cố ý TÁCH khỏi `AvatarJointName` thay vì mở rộng nó: `AvatarJointName` đang là khoá của rig
 * profile, arm solver, diagnostics và capability report của Phase 3A/3B. Nhét thêm 30 tên vào đó
 * sẽ làm mọi `Record<AvatarJointName, ...>` hiện có thành thiếu key và buộc phải sửa code các
 * task trước — đúng thứ phải tránh. Xương ngón chỉ xuất hiện ở `jointRotations` (union bên dưới)
 * và ở loader/renderer, không đụng vào rig profile arm.
 */
export type AvatarFingerJointName =
  | `${"left" | "right"}Thumb${AvatarThumbSegment}`
  | `${"left" | "right"}${Capitalize<Exclude<AvatarFingerName, "thumb">>}${AvatarFingerSegment}`;

/** Khoá hợp lệ của `jointRotations`: xương arm/thân (cũ) hoặc xương ngón (3B.3). */
export type AvatarPoseJointName = AvatarJointName | AvatarFingerJointName;

const capitalizeFinger = (finger: AvatarFingerName) =>
  `${finger[0].toUpperCase()}${finger.slice(1)}` as Capitalize<AvatarFingerName>;

export function fingerJointName(
  side: "left" | "right",
  finger: AvatarFingerName,
  segment: AvatarFingerSegment | AvatarThumbSegment,
): AvatarFingerJointName {
  return `${side}${capitalizeFinger(finger)}${segment}` as AvatarFingerJointName;
}

/** 30 tên xương ngón theo thứ tự ổn định: side → finger → segment gốc tới ngọn. */
export const AVATAR_FINGER_JOINT_NAMES: readonly AvatarFingerJointName[] = (["left", "right"] as const)
  .flatMap((side) => AVATAR_FINGER_NAMES.flatMap((finger) =>
    fingerSegmentsOf(finger).map((segment) => fingerJointName(side, finger, segment))));

const FINGER_JOINT_NAME_SET: ReadonlySet<string> = new Set(AVATAR_FINGER_JOINT_NAMES);

export function isFingerJointName(name: string): name is AvatarFingerJointName {
  return FINGER_JOINT_NAME_SET.has(name);
}

export interface QuaternionData { x: number; y: number; z: number; w: number }
export interface Vector3Data { x: number; y: number; z: number }

export interface AvatarPartTrackingInfo {
  sourceState: AvatarSourceTrackingState;
  outputState: AvatarOutputMotionState;
  sampledAtMs: number | null;
}

/** Contract plain-data dùng chung cho local renderer và P4-T15. */
export interface AvatarPosePacketV1 {
  version: 1;
  sequence: number;
  sourceFrameTimestampMs: number;
  processedTimestampMs: number;
  tracking: {
    face: AvatarPartTrackingInfo;
    leftHand: AvatarPartTrackingInfo;
    rightHand: AvatarPartTrackingInfo;
    pose: AvatarPartTrackingInfo;
  };
  expressions: Record<string, number>;
  /**
   * LEGACY / UNVERIFIED: quaternion lấy từ MediaPipe facial transform và renderer hiện
   * áp như rest-relative local delta. Phase 3A không thay đổi hành vi hoặc dùng field này
   * trong arm acceptance cho tới khi camera/world-to-parent-local semantic được xác minh.
   */
  headRotation: QuaternionData | null;
  /**
   * Quaternion delta trong normalized humanoid space.
   *
   * Đây là rotation parent-local, rest-relative:
   * appliedLocal = restLocal * deltaLocal.
   *
   * Không phải world rotation, raw-model rotation hoặc accumulated delta.
   */
  jointRotations: Partial<Record<AvatarPoseJointName, QuaternionData>>;
  /**
   * Mức 2A — Việc 4: diagnostic Hand Landmarker matching + palm basis, CHỈ để hiển thị/quan
   * sát. Không có field nào ở đây được dùng để tính `jointRotations` — xem AGENTS.md Mức 2A
   * mục 5/7. null khi chưa có rigProfile (processor chưa chạy phần arm-frame, đối xứng với
   * `jointRotations` rỗng trong trường hợp đó).
   */
  handMotion: HandMotionDiagnosticsSnapshot | null;
}

export const IDENTITY_QUATERNION: QuaternionData = { x: 0, y: 0, z: 0, w: 1 };
