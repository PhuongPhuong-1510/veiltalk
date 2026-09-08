import { Quaternion } from "three";
import type { AvatarFingerJointName, QuaternionData } from "./avatarPoseTypes";
import { IDENTITY_QUATERNION } from "./avatarPoseTypes";
import type { FingerJointPlan } from "./fingerPosePlanner";

/**
 * Phase 3B.3 — Bước 1: blend từ tư thế ngón hiện tại sang tư thế đích theo THỜI GIAN.
 *
 * Đây là owner duy nhất của việc làm mượt ngón (§3.5 của plan) — renderer đã được sửa để bỏ qua
 * smoothing chung cho finger joint. Hai nơi cùng làm mượt sẽ cộng dồn độ trễ và làm cử chỉ nhão
 * đúng lúc cần dứt khoát.
 *
 * Blend theo elapsed time chứ không theo số frame: cùng một khoảng thời gian phải cho cùng một
 * mức chuyển tiếp bất kể máy chạy 15 hay 60 FPS.
 */

export interface FingerPoseTemporalConfig {
  /** Thời gian chuyển tiếp giữa hai tư thế, tính bằng ms. */
  blendMs: number;
}

/**
 * 140ms: đủ nhanh để nắm tay trông dứt khoát, đủ chậm để không giật. Cử chỉ rời rạc nên chuyển
 * tiếp cần *cảm giác có chủ ý*, khác với tracking liên tục vốn cần bám sát.
 */
export const DEFAULT_FINGER_POSE_TEMPORAL_CONFIG: FingerPoseTemporalConfig = { blendMs: 140 };

export interface FingerPoseTemporalState {
  /** Rotation đang phát cho từng joint. Khoá ở đây chính là tập joint đang được sở hữu. */
  current: Map<AvatarFingerJointName, QuaternionData>;
  lastUpdatedAtMs: number | null;
}

export function createFingerPoseTemporalState(): FingerPoseTemporalState {
  return { current: new Map(), lastUpdatedAtMs: null };
}

/**
 * Slerp có xử lý hemisphere continuity.
 *
 * q và −q biểu diễn cùng một phép quay. Nếu tích vô hướng âm mà không lật dấu, slerp sẽ đi vòng
 * đường dài — ngón sẽ quay ngược gần trọn vòng thay vì chuyển tiếp ngắn nhất.
 */
function slerp(from: QuaternionData, to: QuaternionData, t: number): QuaternionData {
  const a = new Quaternion(from.x, from.y, from.z, from.w).normalize();
  const b = new Quaternion(to.x, to.y, to.z, to.w).normalize();
  if (a.dot(b) < 0) b.set(-b.x, -b.y, -b.z, -b.w);
  const result = a.slerp(b, Math.max(0, Math.min(1, t))).normalize();
  return { x: result.x, y: result.y, z: result.z, w: result.w };
}

export interface FingerPoseTemporalResult {
  state: FingerPoseTemporalState;
  /** Rotation phát ra packet ở frame này. */
  output: FingerJointPlan;
}

/**
 * Tiến một bước blend về phía `target`.
 *
 * `target` là tập joint mà planner muốn điều khiển ở frame này. Joint đang được sở hữu nhưng
 * KHÔNG có trong target sẽ được blend về identity rồi bỏ khỏi state — nếu chỉ bỏ khoá khỏi packet
 * thì renderer sẽ giữ nguyên rotation cũ và ngón đóng băng ở tư thế cuối.
 */
export function updateFingerPoseTemporal(
  previous: FingerPoseTemporalState,
  target: FingerJointPlan,
  nowMs: number,
  config: FingerPoseTemporalConfig = DEFAULT_FINGER_POSE_TEMPORAL_CONFIG,
): FingerPoseTemporalResult {
  const elapsedMs = previous.lastUpdatedAtMs === null ? config.blendMs : Math.max(0, nowMs - previous.lastUpdatedAtMs);
  // Hệ số blend theo thời gian thực. blendMs <= 0 nghĩa là chuyển tức thì.
  const t = config.blendMs <= 0 ? 1 : Math.max(0, Math.min(1, elapsedMs / config.blendMs));

  const current = new Map(previous.current);
  const output: FingerJointPlan = {};

  for (const [joint, targetRotation] of Object.entries(target) as Array<[AvatarFingerJointName, QuaternionData]>) {
    const from = current.get(joint) ?? IDENTITY_QUATERNION;
    const value = slerp(from, targetRotation, t);
    current.set(joint, value);
    output[joint] = value;
  }

  // Joint từng sở hữu nhưng không còn trong target: đưa về identity một cách có kiểm soát.
  for (const joint of previous.current.keys()) {
    if (joint in target) continue;
    const from = current.get(joint) ?? IDENTITY_QUATERNION;
    const value = slerp(from, IDENTITY_QUATERNION, t);
    // Đã đủ gần identity thì nhả hẳn quyền sở hữu; giữ lại sẽ ghi rotation vô nghĩa mãi mãi.
    const settled = Math.abs(value.w) > 0.9999;
    if (settled) {
      current.delete(joint);
      output[joint] = IDENTITY_QUATERNION;
    } else {
      current.set(joint, value);
      output[joint] = value;
    }
  }

  return { state: { current, lastUpdatedAtMs: nowMs }, output };
}

/** Nhả toàn bộ pose ngay lập tức — dùng khi tắt tính năng hoặc đổi model. */
export function clearFingerPoseTemporal(previous: FingerPoseTemporalState): FingerPoseTemporalResult {
  const output: FingerJointPlan = {};
  for (const joint of previous.current.keys()) output[joint] = IDENTITY_QUATERNION;
  return { state: createFingerPoseTemporalState(), output };
}
