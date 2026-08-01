/**
 * Mức 2B-5 Stabilization: module DUY NHẤT sở hữu raw wrapped→unwrapped, neutral-relative
 * correction, dead zone, dt-based target filter và correction clamp. Không tạo quaternion.
 */

export interface HandTwistStabilizationConfig {
  deadZoneRadians: number;
  targetFilterTimeConstantSeconds: number;
  minCorrectionRadians: number;
  maxCorrectionRadians: number;
}

export interface HandTwistStabilizationState {
  rawInitialized: boolean;
  previousRawWrappedRadians: number;
  rawUnwrappedRadians: number;
  neutralInitialized: boolean;
  neutralUnwrappedRadians: number;
  neutralInitializedAtMs: number | null;
  filterInitialized: boolean;
  filteredTargetRadians: number;
}

export const INITIAL_HAND_TWIST_STABILIZATION_STATE: HandTwistStabilizationState = {
  rawInitialized: false,
  previousRawWrappedRadians: 0,
  rawUnwrappedRadians: 0,
  neutralInitialized: false,
  neutralUnwrappedRadians: 0,
  neutralInitializedAtMs: null,
  filterInitialized: false,
  filteredTargetRadians: 0,
};

/**
 * Xóa lịch sử observation/unwrap/filter nhưng giữ mốc calibration của cùng rig/session.
 *
 * Mất Hand Landmarker không làm đổi hệ tọa độ của rig hay ý nghĩa giải phẫu của neutral. Nếu lấy
 * frame đầu tiên lúc tay vừa quay lại làm neutral mới, cùng một tư thế vật lý sẽ ra góc khác nhau
 * sau mỗi lần mất tracking. State trả về cố ý để `rawInitialized=false`: observation mới sẽ được
 * unwrap vào nhánh gần neutral cũ nhất, thay vì nối với raw sample đã cũ.
 */
export function resetHandTwistStabilizationKeepingNeutral(
  state: HandTwistStabilizationState,
): HandTwistStabilizationState {
  if (
    !state.neutralInitialized ||
    !Number.isFinite(state.neutralUnwrappedRadians) ||
    (state.neutralInitializedAtMs !== null && !Number.isFinite(state.neutralInitializedAtMs))
  ) return { ...INITIAL_HAND_TWIST_STABILIZATION_STATE };

  return {
    ...INITIAL_HAND_TWIST_STABILIZATION_STATE,
    neutralInitialized: true,
    neutralUnwrappedRadians: state.neutralUnwrappedRadians,
    neutralInitializedAtMs: state.neutralInitializedAtMs,
  };
}

export interface HandTwistStabilizationInput {
  rawWrappedTwistRadians: number;
  nowMs: number;
  dtSeconds: number;
  reanchorNeutral: boolean;
  reanchorReason: string | null;
}

export interface HandTwistStabilizationResult {
  state: HandTwistStabilizationState;
  rawUnwrappedTwistRadians: number;
  neutralTwistRadians: number;
  neutralReanchored: boolean;
  neutralReanchorReason: string | null;
  correctedTwistRadians: number;
  deadZoneOutputRadians: number;
  filteredTargetTwistRadians: number;
  clampedTwistRadians: number;
  clampApplied: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function wrapAngle(value: number): number {
  return Math.atan2(Math.sin(value), Math.cos(value));
}

function shortestAngleDelta(fromWrapped: number, toWrapped: number): number {
  return wrapAngle(toWrapped - fromWrapped);
}

/** Dead zone liên tục tại biên: ngoài vùng chết chỉ bỏ đi đúng độ rộng dead zone. */
export function applyContinuousDeadZone(value: number, deadZoneRadians: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(deadZoneRadians) || deadZoneRadians < 0) return 0;
  const magnitude = Math.max(0, Math.abs(value) - deadZoneRadians);
  return Math.sign(value) * magnitude;
}

export function updateHandTwistStabilization(
  state: HandTwistStabilizationState,
  input: HandTwistStabilizationInput,
  config: HandTwistStabilizationConfig,
): HandTwistStabilizationResult | null {
  if (
    !Number.isFinite(input.rawWrappedTwistRadians) || !Number.isFinite(input.nowMs) ||
    !Number.isFinite(input.dtSeconds) || input.dtSeconds <= 0 ||
    !Number.isFinite(config.deadZoneRadians) || config.deadZoneRadians < 0 ||
    !Number.isFinite(config.targetFilterTimeConstantSeconds) || config.targetFilterTimeConstantSeconds < 0 ||
    !Number.isFinite(config.minCorrectionRadians) || !Number.isFinite(config.maxCorrectionRadians) ||
    config.minCorrectionRadians > config.maxCorrectionRadians
  ) return null;

  const rawWrapped = wrapAngle(input.rawWrappedTwistRadians);
  const rawUnwrapped = state.rawInitialized
    ? state.rawUnwrappedRadians + shortestAngleDelta(state.previousRawWrappedRadians, rawWrapped)
    // Sau tracking reset có thể giữ neutral nhưng không được giữ raw history. Chọn biểu diễn
    // wrapped của sample mới gần neutral cũ nhất để `corrected` vẫn là góc ngắn nhất quanh mốc
    // calibration, không nhảy thêm ±2π chỉ vì detector vừa bắt lại tay.
    : state.neutralInitialized
      ? state.neutralUnwrappedRadians + shortestAngleDelta(wrapAngle(state.neutralUnwrappedRadians), rawWrapped)
      : rawWrapped;
  const shouldAnchor = !state.neutralInitialized || input.reanchorNeutral;
  const neutral = shouldAnchor ? rawUnwrapped : state.neutralUnwrappedRadians;
  const corrected = rawUnwrapped - neutral;
  const deadZoneOutput = applyContinuousDeadZone(corrected, config.deadZoneRadians);
  const filterShouldReset = shouldAnchor || !state.filterInitialized;
  const alpha = config.targetFilterTimeConstantSeconds === 0
    ? 1
    : 1 - Math.exp(-input.dtSeconds / config.targetFilterTimeConstantSeconds);
  const filtered = filterShouldReset
    ? deadZoneOutput
    : state.filteredTargetRadians + alpha * (deadZoneOutput - state.filteredTargetRadians);
  const clamped = clamp(filtered, config.minCorrectionRadians, config.maxCorrectionRadians);
  const nextState: HandTwistStabilizationState = {
    rawInitialized: true,
    previousRawWrappedRadians: rawWrapped,
    rawUnwrappedRadians: rawUnwrapped,
    neutralInitialized: true,
    neutralUnwrappedRadians: neutral,
    neutralInitializedAtMs: shouldAnchor ? input.nowMs : state.neutralInitializedAtMs,
    filterInitialized: true,
    filteredTargetRadians: filtered,
  };
  return {
    state: nextState,
    rawUnwrappedTwistRadians: rawUnwrapped,
    neutralTwistRadians: neutral,
    neutralReanchored: shouldAnchor,
    neutralReanchorReason: shouldAnchor ? (input.reanchorReason ?? "first-trusted-after-reset") : null,
    correctedTwistRadians: corrected,
    deadZoneOutputRadians: deadZoneOutput,
    filteredTargetTwistRadians: filtered,
    clampedTwistRadians: clamped,
    clampApplied: clamped !== filtered,
  };
}
