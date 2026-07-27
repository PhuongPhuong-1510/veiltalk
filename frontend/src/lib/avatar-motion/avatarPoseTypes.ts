import type { TrackingSampleState } from "../tracking/rawTrackingTypes";

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
   * áp như rest-relative local delta. Field này chưa được xác minh semantic đầy đủ và không
   * thuộc arm acceptance Phase 2 cho tới khi camera/world-to-parent-local được kiểm chứng.
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
}

export const IDENTITY_QUATERNION: QuaternionData = { x: 0, y: 0, z: 0, w: 1 };
