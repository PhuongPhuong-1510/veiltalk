import type { TrackingSampleState } from "../tracking/rawTrackingTypes";
import type { HandMotionDiagnosticsSnapshot } from "./handMotionDiagnostics";

export type AvatarSourceTrackingState = TrackingSampleState;
export type AvatarOutputMotionState = "active" | "held" | "returning" | "idle";

export type AvatarJointName =
  | "neck" | "chest"
  | "leftShoulder" | "leftUpperArm" | "leftLowerArm" | "leftHand"
  | "rightShoulder" | "rightUpperArm" | "rightLowerArm" | "rightHand";

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
  jointRotations: Partial<Record<AvatarJointName, QuaternionData>>;
  /**
   * Mức 2A — Việc 4: diagnostic Hand Landmarker matching + palm basis, CHỈ để hiển thị/quan
   * sát. Không có field nào ở đây được dùng để tính `jointRotations` — xem AGENTS.md Mức 2A
   * mục 5/7. null khi chưa có rigProfile (processor chưa chạy phần arm-frame, đối xứng với
   * `jointRotations` rỗng trong trường hợp đó).
   */
  handMotion: HandMotionDiagnosticsSnapshot | null;
}

export const IDENTITY_QUATERNION: QuaternionData = { x: 0, y: 0, z: 0, w: 1 };
