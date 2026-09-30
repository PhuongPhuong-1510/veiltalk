import type { QuaternionData } from "./avatarPoseTypes";
import type { ArmSide, ElbowSource, PoleSource } from "./avatarMotionDiagnostics";
import type { ControlledArmJoint } from "./normalizedRigProfile";
import { IDENTITY_QUATERNION } from "./avatarPoseTypes";
import { slerpQuaternionData } from "./motionMath";
import { createRobustMeasurementState, type RobustMeasurementState } from "./adaptiveBodyProfile";

/**
 * Mức 1B-1 (theo tư vấn chuyên gia): `q` và `-q` biểu diễn cùng một rotation nhưng khi gán
 * trực tiếp (không qua slerp — đúng nhánh solver trả kết quả mới liên tiếp, không recovering)
 * dấu có thể đảo bất chợt giữa hai frame liền kề. Renderer có tự xử lý hemisphere khi
 * smoothing bật, nhưng khi tắt smoothing (`rotationAlpha=1`, dùng cho preset/debug xác định)
 * giá trị được gán thẳng — cú lật dấu tại nguồn vẫn lộ ra. Đảo dấu `next` cho cùng hemisphere
 * với `previous` trước khi lưu, để output liên tục về dấu bất kể tầng nào đọc nó sau này.
 */
function sameHemisphere(previous: QuaternionData | null, next: QuaternionData): QuaternionData {
  if (!previous) return next;
  const dot = previous.x * next.x + previous.y * next.y + previous.z * next.z + previous.w * next.w;
  return dot < 0 ? { x: -next.x, y: -next.y, z: -next.z, w: -next.w } : next;
}

export type ArmLossState = "idle" | "active" | "held" | "returning" | "recovering";
export type ArmDeltaOutput = Partial<Record<ControlledArmJoint, QuaternionData>>;
export interface SegmentTemporalState {
  lastValidDelta: QuaternionData | null; currentOutputDelta: QuaternionData;
  lossState: ArmLossState; lastValidAtMs: number | null; recoveryOrigin: QuaternionData | null; recoveryStartedAtMs: number | null;
  /** Timestamp của solver sample gần nhất; chỉ tiến trên sample mới, không phụ thuộc render FPS. */
  lastSolvedAtMs: number | null;
  /** Raw solver target from the previous detector sample, never the smoothed output. */
  previousTargetDelta: QuaternionData | null;
  angularVelocityRadiansPerSecond: number | null;
  staticMode: boolean;
  staticCandidateSinceMs: number | null;
}
export const createSegmentTemporalState = (resting: QuaternionData = IDENTITY_QUATERNION): SegmentTemporalState => ({
  lastValidDelta: null, currentOutputDelta: resting, lossState: "idle", lastValidAtMs: null, recoveryOrigin: null, recoveryStartedAtMs: null, lastSolvedAtMs: null,
  previousTargetDelta: null, angularVelocityRadiansPerSecond: null, staticMode: false, staticCandidateSinceMs: null,
});

/**
 * Stabilizer cho output arm sau geometry solver. Mục tiêu là triệt jitter khi người giữ tư thế
 * nhưng không làm tay bị "lụt" khi chuyển động chủ động. Các ngưỡng ở đây là angular delta
 * của quaternion đã solve, không phải landmark pixel threshold.
 */
export interface ArmSegmentStabilityConfig {
  /** Bỏ hoàn toàn rung cực nhỏ ở tư thế đứng yên. */
  deadZoneRadians: number;
  /** Dưới vùng này dùng smoothing mạnh. */
  lowMotionRadians: number;
  /** Trên vùng này phản hồi nhanh. */
  highMotionRadians: number;
  /** Time constant khi gần đứng yên. */
  stableTimeConstantMs: number;
  /** Time constant khi đang chuyển động rõ. */
  movingTimeConstantMs: number;
  /** Chặn một sample outlier làm xương quay quá nhanh. */
  maxAngularVelocityRadiansPerSecond: number;
  staticEnterVelocityRadiansPerSecond: number;
  staticExitVelocityRadiansPerSecond: number;
  staticEnterDelayMs: number;
  lowMotionVelocityRadiansPerSecond: number;
  highMotionVelocityRadiansPerSecond: number;
  staticDeadZoneMultiplier: number;
  staticTimeConstantMs: number;
}

export const DEFAULT_ARM_SEGMENT_STABILITY: ArmSegmentStabilityConfig = {
  deadZoneRadians: 0.006,          // ~0.34°
  lowMotionRadians: 0.028,         // ~1.6°
  highMotionRadians: 0.21,         // ~12°
  stableTimeConstantMs: 95,
  movingTimeConstantMs: 18,
  maxAngularVelocityRadiansPerSecond: 14, // ~800°/s; chỉ chặn snap/outlier lớn
  staticEnterVelocityRadiansPerSecond: 0.18,
  staticExitVelocityRadiansPerSecond: 0.7,
  staticEnterDelayMs: 160,
  lowMotionVelocityRadiansPerSecond: 0.2,
  highMotionVelocityRadiansPerSecond: 2.2,
  staticDeadZoneMultiplier: 2.5,
  staticTimeConstantMs: 150,
};

function quaternionAngularDistance(a: QuaternionData, b: QuaternionData): number {
  const dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return 2 * Math.acos(Math.max(-1, Math.min(1, dot)));
}

function smoothstep01(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function stabilizeActiveSample(
  previous: QuaternionData, target: QuaternionData, dtMs: number, angularVelocity: number,
  staticMode: boolean, config: ArmSegmentStabilityConfig,
): QuaternionData {
  const angle = quaternionAngularDistance(previous, target);
  // Quiet sub-degree changes accumulate behind the existing low-motion threshold. A genuinely
  // moving target bypasses that wider rest deadband even when detector FPS is high.
  const quietDeadZone = angularVelocity < config.staticExitVelocityRadiansPerSecond
    ? Math.max(config.deadZoneRadians, config.lowMotionRadians * 0.5)
    : config.deadZoneRadians;
  const deadZone = quietDeadZone * (staticMode ? config.staticDeadZoneMultiplier : 1);
  if (!Number.isFinite(angle) || angle <= deadZone) return previous;

  const range = Math.max(1e-6, config.highMotionVelocityRadiansPerSecond - config.lowMotionVelocityRadiansPerSecond);
  const motion = smoothstep01((angularVelocity - config.lowMotionVelocityRadiansPerSecond) / range);
  const baseTauMs = config.stableTimeConstantMs + (config.movingTimeConstantMs - config.stableTimeConstantMs) * motion;
  const tauMs = staticMode ? Math.max(baseTauMs, config.staticTimeConstantMs) : baseTauMs;
  const dt = Math.max(1, Math.min(100, Number.isFinite(dtMs) ? dtMs : 33));
  const alpha = Math.max(0, Math.min(1, 1 - Math.exp(-dt / Math.max(1, tauMs))));
  let output = slerpQuaternionData(previous, target, alpha);

  // Velocity cap chạy SAU adaptive smoothing. Nó chỉ tác động lên discontinuity lớn;
  // chuyển động bình thường ở 24–30 FPS vẫn được theo nhanh.
  const appliedAngle = quaternionAngularDistance(previous, output);
  const maxStep = Math.max(0, config.maxAngularVelocityRadiansPerSecond) * dt / 1000;
  if (maxStep > 0 && appliedAngle > maxStep) output = slerpQuaternionData(previous, output, maxStep / appliedAngle);
  return output;
}

export interface ArmTemporalState {
  previousPole: { x: number; y: number; z: number } | null;
  poleSource: PoleSource;
  depthDegenerate: boolean;
  lastValidPoleAtMs: number | null;
  lastValidOutput: ArmDeltaOutput | null;
  lastEmittedOutput: ArmDeltaOutput | null;
  lastValidPoseAtMs: number | null;
  lastConsumedPoseSampledAtMs: number | null;
  lossState: ArmLossState;
  recoveryOrigin: ArmDeltaOutput | null;
  recoveryStartedAtMs: number | null;
  invalidCandidateStartedAtMs: number | null;
  validCandidateStartedAtMs: number | null;
  segments: { upper: SegmentTemporalState; lower: SegmentTemporalState };
  previousPrimary: { upper: { x: number; y: number; z: number } | null; lower: { x: number; y: number; z: number } | null };
  previousSecondary: { upper: { x: number; y: number; z: number } | null; lower: { x: number; y: number; z: number } | null };
  lengthSamples: { upper: number[]; lower: number[] };
  calibratedLength: { upper: number | null; lower: number | null };
  /** Robust per-segment calibration consumed by AvatarMotionProcessor. */
  lengthProfile: { upper: RobustMeasurementState; lower: RobustMeasurementState };
  previousObservedElbow: { x: number; y: number; z: number } | null;
  /** Phase 3B partial-arm: mỏ neo phía gập khuỷu, giữ qua các frame để elbow inference không lật phía. */
  previousElbowDirection: { x: number; y: number; z: number } | null;
  inferenceStartedAtMs: number | null;
  elbowSource: ElbowSource;
  /** P0-4/5: trạng thái hysteresis visibility, mang theo giữa các frame. */
  elbowWasVisible: boolean;
  wristWasVisible: boolean;
}

export const createArmTemporalState = (): ArmTemporalState => ({
  previousPole: null, poleSource: "unavailable", depthDegenerate: false, lastValidPoleAtMs: null, lastValidOutput: null, lastEmittedOutput: null,
  lastValidPoseAtMs: null, lastConsumedPoseSampledAtMs: null, lossState: "idle", recoveryOrigin: null, recoveryStartedAtMs: null,
  invalidCandidateStartedAtMs: null, validCandidateStartedAtMs: null,
  segments: { upper: createSegmentTemporalState(), lower: createSegmentTemporalState() },
  previousPrimary: { upper: null, lower: null }, previousSecondary: { upper: null, lower: null },
  lengthSamples: { upper: [], lower: [] }, calibratedLength: { upper: null, lower: null }, previousObservedElbow: null, previousElbowDirection: null, inferenceStartedAtMs: null,
  lengthProfile: { upper: createRobustMeasurementState(), lower: createRobustMeasurementState() },
  elbowSource: "unavailable", elbowWasVisible: false, wristWasVisible: false,
});

export function updateSegmentTemporalOutput(
  state: SegmentTemporalState, solved: QuaternionData | null, isNewSample: boolean, nowMs: number,
  holdMs: number, returnMs: number, recoveryMs: number, invalidGraceMs = 0,
  restingDelta: QuaternionData = IDENTITY_QUATERNION, forceReacquireBlend = false,
  stability: ArmSegmentStabilityConfig = DEFAULT_ARM_SEGMENT_STABILITY,
): { output: QuaternionData; state: ArmLossState; progress: number } {
  if (solved && isNewSample) {
    const continuityReference = state.currentOutputDelta;
    const solvedContinuous = sameHemisphere(continuityReference, solved);
    const previousSolvedAtMs = state.lastSolvedAtMs;
    state.lastSolvedAtMs = nowMs;
    const sampleDtMs = previousSolvedAtMs === null ? null : Math.max(1, Math.min(250, nowMs - previousSolvedAtMs));
    const targetAngle = state.previousTargetDelta === null
      ? null
      : quaternionAngularDistance(state.previousTargetDelta, solvedContinuous);
    const angularVelocity = targetAngle === null || sampleDtMs === null ? 0 : targetAngle / (sampleDtMs / 1000);
    state.angularVelocityRadiansPerSecond = Number.isFinite(angularVelocity) ? angularVelocity : null;
    state.previousTargetDelta = solvedContinuous;

    // A dwell time prevents one quiet detector sample from locking the arm. Exit is immediate so
    // deliberate movement stays responsive. The separated thresholds provide hysteresis.
    if (state.staticCandidateSinceMs !== null && nowMs - state.staticCandidateSinceMs >= stability.staticEnterDelayMs) {
      state.staticMode = true;
    }
    if (angularVelocity >= stability.staticExitVelocityRadiansPerSecond) {
      state.staticMode = false;
      state.staticCandidateSinceMs = null;
    } else if (angularVelocity <= stability.staticEnterVelocityRadiansPerSecond) {
      state.staticCandidateSinceMs ??= nowMs;
      if (nowMs - state.staticCandidateSinceMs >= stability.staticEnterDelayMs) state.staticMode = true;
    } else {
      // Once static, velocities inside the hysteresis band keep the lock. Before entry they reset
      // the dwell so intermittent movement cannot accidentally accumulate quiet time.
      if (!state.staticMode) state.staticCandidateSinceMs = null;
    }

    // Source/branch reacquire vẫn blend có chủ đích. Ở active bình thường, thêm adaptive
    // quaternion stabilization để landmark jitter không đi thẳng ra renderer.
    const recovering = (state.lastValidDelta !== null && state.lossState !== "active") ||
      (state.lastValidDelta !== null && forceReacquireBlend);
    if (recovering && state.recoveryStartedAtMs === null) {
      state.recoveryStartedAtMs = nowMs;
      state.recoveryOrigin = state.currentOutputDelta;
    }

    const progress = recovering
      ? Math.min(1, (nowMs - state.recoveryStartedAtMs!) / Math.max(1, recoveryMs))
      : 1;

    if (recovering) {
      // Giữ contract recovery cũ để không đổi cảm giác reacquire của toàn pipeline.
      state.currentOutputDelta = slerpQuaternionData(state.recoveryOrigin!, solvedContinuous, progress);
    } else if (previousSolvedAtMs === null) {
      state.currentOutputDelta = solvedContinuous;
    } else {
      state.currentOutputDelta = stabilizeActiveSample(
        state.currentOutputDelta, solvedContinuous, nowMs - previousSolvedAtMs,
        angularVelocity, state.staticMode, stability,
      );
    }

    // Hold phải giữ đúng OUTPUT người dùng vừa thấy, không giữ raw solver target ở phía sau
    // stabilizer; nếu không frame đầu tiên mất tracking có thể tự tạo một cú snap.
    state.lastValidDelta = state.currentOutputDelta;
    state.lastValidAtMs = nowMs;
    state.lossState = progress < 1 ? "recovering" : "active";
    if (progress >= 1) { state.recoveryOrigin = null; state.recoveryStartedAtMs = null; }
    return { output: state.currentOutputDelta, state: state.lossState, progress };
  }
  if (state.lastValidDelta && state.lastValidAtMs !== null) {
    const lostFor = nowMs - state.lastValidAtMs;
    if (lostFor <= invalidGraceMs) { state.lossState = "active"; state.currentOutputDelta = state.lastValidDelta; return { output: state.currentOutputDelta, state: state.lossState, progress: lostFor / Math.max(1, invalidGraceMs) }; }
    if (lostFor <= holdMs) { state.lossState = "held"; state.currentOutputDelta = state.lastValidDelta; return { output: state.currentOutputDelta, state: state.lossState, progress: lostFor / Math.max(1, holdMs) }; }
    if (lostFor <= holdMs + returnMs) { const progress = (lostFor - holdMs) / Math.max(1, returnMs); state.lossState = "returning"; state.currentOutputDelta = slerpQuaternionData(state.lastValidDelta, restingDelta, progress); return { output: state.currentOutputDelta, state: state.lossState, progress }; }
  }
  // Mất theo dõi lâu thì về tư thế buông tay, không phải T-pose dang ngang của rest pose.
  state.lossState = "idle"; state.currentOutputDelta = restingDelta; return { output: state.currentOutputDelta, state: state.lossState, progress: 1 };
}

const names = (side: ArmSide): ControlledArmJoint[] => side === "left" ? ["leftUpperArm", "leftLowerArm"] : ["rightUpperArm", "rightLowerArm"];
const identityOutput = (side: ArmSide): ArmDeltaOutput => Object.fromEntries(names(side).map((name) => [name, IDENTITY_QUATERNION]));
const blend = (side: ArmSide, from: ArmDeltaOutput | null, to: ArmDeltaOutput, alpha: number): ArmDeltaOutput => Object.fromEntries(names(side).map((name) => [name, slerpQuaternionData(from?.[name] ?? IDENTITY_QUATERNION, to[name] ?? IDENTITY_QUATERNION, alpha)]));

export function updateArmTemporalOutput(
  side: ArmSide, state: ArmTemporalState, solved: ArmDeltaOutput | null, isNewSample: boolean, nowMs: number,
  holdMs: number, returnMs: number, recoveryMs: number, invalidGraceMs = 0,
): { output: ArmDeltaOutput; state: ArmLossState; progress: number } {
  if (solved && isNewSample) {
    const recovering = state.lossState !== "active" && state.lastEmittedOutput !== null;
    if (recovering && state.recoveryStartedAtMs === null) { state.recoveryStartedAtMs = nowMs; state.recoveryOrigin = state.lastEmittedOutput; }
    state.lastValidOutput = solved; state.lastValidPoseAtMs = nowMs;
    const progress = recovering ? Math.min(1, (nowMs - state.recoveryStartedAtMs!) / Math.max(1, recoveryMs)) : 1;
    const output = recovering ? blend(side, state.recoveryOrigin, solved, progress) : solved;
    state.lossState = progress < 1 ? "recovering" : "active"; state.lastEmittedOutput = output;
    if (progress >= 1) { state.recoveryOrigin = null; state.recoveryStartedAtMs = null; }
    return { output, state: state.lossState, progress };
  }
  if (state.lastValidOutput && state.lastValidPoseAtMs !== null) {
    const lostFor = nowMs - state.lastValidPoseAtMs;
    if (lostFor <= invalidGraceMs) { state.lossState = "active"; state.lastEmittedOutput = state.lastValidOutput; return { output: state.lastValidOutput, state: "active", progress: lostFor / Math.max(1, invalidGraceMs) }; }
    if (lostFor <= holdMs) { state.lossState = "held"; state.lastEmittedOutput = state.lastValidOutput; return { output: state.lastValidOutput, state: "held", progress: lostFor / Math.max(1, holdMs) }; }
    if (lostFor <= holdMs + returnMs) {
      const progress = (lostFor - holdMs) / Math.max(1, returnMs); const output = blend(side, state.lastValidOutput, identityOutput(side), progress);
      state.lossState = "returning"; state.lastEmittedOutput = output; return { output, state: "returning", progress };
    }
  }
  const output = identityOutput(side); state.lossState = "idle"; state.lastEmittedOutput = output;
  return { output, state: "idle", progress: 1 };
}
