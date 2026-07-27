import type { QuaternionData } from "./avatarPoseTypes";
import type { ArmSide, ElbowSource, PoleSource } from "./avatarMotionDiagnostics";
import type { ControlledArmJoint } from "./normalizedRigProfile";
import { IDENTITY_QUATERNION } from "./avatarPoseTypes";
import { slerpQuaternionData } from "./motionMath";

export type ArmLossState = "idle" | "active" | "held" | "returning" | "recovering";
export type ArmDeltaOutput = Partial<Record<ControlledArmJoint, QuaternionData>>;
export interface SegmentTemporalState {
  lastValidDelta: QuaternionData | null; currentOutputDelta: QuaternionData;
  lossState: ArmLossState; lastValidAtMs: number | null; recoveryOrigin: QuaternionData | null; recoveryStartedAtMs: number | null;
}
export const createSegmentTemporalState = (): SegmentTemporalState => ({ lastValidDelta: null, currentOutputDelta: IDENTITY_QUATERNION, lossState: "idle", lastValidAtMs: null, recoveryOrigin: null, recoveryStartedAtMs: null });

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
  previousObservedElbow: { x: number; y: number; z: number } | null;
  inferenceStartedAtMs: number | null;
  elbowSource: ElbowSource;
}

export const createArmTemporalState = (): ArmTemporalState => ({
  previousPole: null, poleSource: "unavailable", depthDegenerate: false, lastValidPoleAtMs: null, lastValidOutput: null, lastEmittedOutput: null,
  lastValidPoseAtMs: null, lastConsumedPoseSampledAtMs: null, lossState: "idle", recoveryOrigin: null, recoveryStartedAtMs: null,
  invalidCandidateStartedAtMs: null, validCandidateStartedAtMs: null,
  segments: { upper: createSegmentTemporalState(), lower: createSegmentTemporalState() },
  previousPrimary: { upper: null, lower: null }, previousSecondary: { upper: null, lower: null },
  lengthSamples: { upper: [], lower: [] }, calibratedLength: { upper: null, lower: null }, previousObservedElbow: null, inferenceStartedAtMs: null,
  elbowSource: "unavailable",
});

export function updateSegmentTemporalOutput(state: SegmentTemporalState, solved: QuaternionData | null, isNewSample: boolean, nowMs: number, holdMs: number, returnMs: number, recoveryMs: number, invalidGraceMs = 0): { output: QuaternionData; state: ArmLossState; progress: number } {
  if (solved && isNewSample) {
    const recovering = state.lastValidDelta !== null && state.lossState !== "active";
    if (recovering && state.recoveryStartedAtMs === null) { state.recoveryStartedAtMs = nowMs; state.recoveryOrigin = state.currentOutputDelta; }
    state.lastValidDelta = solved; state.lastValidAtMs = nowMs;
    const progress = recovering ? Math.min(1, (nowMs - state.recoveryStartedAtMs!) / Math.max(1, recoveryMs)) : 1;
    state.currentOutputDelta = recovering ? slerpQuaternionData(state.recoveryOrigin!, solved, progress) : solved;
    state.lossState = progress < 1 ? "recovering" : "active";
    if (progress >= 1) { state.recoveryOrigin = null; state.recoveryStartedAtMs = null; }
    return { output: state.currentOutputDelta, state: state.lossState, progress };
  }
  if (state.lastValidDelta && state.lastValidAtMs !== null) {
    const lostFor = nowMs - state.lastValidAtMs;
    if (lostFor <= invalidGraceMs) { state.lossState = "active"; state.currentOutputDelta = state.lastValidDelta; return { output: state.currentOutputDelta, state: state.lossState, progress: lostFor / Math.max(1, invalidGraceMs) }; }
    if (lostFor <= holdMs) { state.lossState = "held"; state.currentOutputDelta = state.lastValidDelta; return { output: state.currentOutputDelta, state: state.lossState, progress: lostFor / Math.max(1, holdMs) }; }
    if (lostFor <= holdMs + returnMs) { const progress = (lostFor - holdMs) / Math.max(1, returnMs); state.lossState = "returning"; state.currentOutputDelta = slerpQuaternionData(state.lastValidDelta, IDENTITY_QUATERNION, progress); return { output: state.currentOutputDelta, state: state.lossState, progress }; }
  }
  state.lossState = "idle"; state.currentOutputDelta = IDENTITY_QUATERNION; return { output: state.currentOutputDelta, state: state.lossState, progress: 1 };
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
