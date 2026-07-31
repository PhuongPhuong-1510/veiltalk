import type { RawTrackingFrameV1 } from "../tracking/rawTrackingTypes";
import type { AvatarPartTrackingInfo, AvatarPosePacketV1, QuaternionData } from "./avatarPoseTypes";
import { quaternionFromRotationMatrix } from "./coordinateAdapter";
import { mapMediaPipeExpressions } from "./expressionMapper";
import { solveAnatomicalArmFrames, type GeometryDiagnostic } from "./armFrameSolver";
import { validateRigProfile, type NormalizedAvatarRigProfile } from "./normalizedRigProfile";
import { DEFAULT_AVATAR_MOTION_CONFIG, type AvatarMotionConfig } from "./motionConfig";
import { OneEuroScalarFilter, OneEuroVectorFilter } from "./oneEuroFilter";
import type { AvatarJointName } from "./avatarPoseTypes";
import { TrackingLossStateMachine } from "./trackingLoss";
import { createArmTemporalState, updateSegmentTemporalOutput, type ArmTemporalState, type ArmLossState } from "./armTemporalState";
import { angularDeltaDegrees, vectorAngularDeltaDegrees } from "./motionMath";
import { buildIdleArmPose, type IdleArmPose } from "./idleArmPose";
import type { ArmSide, AvatarMotionDiagnosticSnapshot, HandSampleClassification, HandTrackingEpochResetReason, MotionSampleDisposition, PoleSource, TorsoBasisSource } from "./avatarMotionDiagnostics";
import type { TorsoBasis } from "./torsoBasis";
import { matchHandsToPose, type HandMatchPreviousState, type HandPoseMatchResult, type HandSideMatchResult } from "./handPoseMatching";
import { computeHandPalmBasis, type HandPalmBasisOutput } from "./handPalmBasis";
import { buildHandMotionDiagnostics, type HandMotionDiagnosticsSnapshot } from "./handMotionDiagnostics";
import type { RawHandCandidateV1 } from "../tracking/rawTrackingTypes";
import { computeHandForearmTwist } from "./handForearmTwist";
import { computeHandTwistConfidence } from "./handTwistConfidence";
import { DEFAULT_HAND_TWIST_TEMPORAL_CONFIG, INITIAL_HAND_TWIST_TEMPORAL_STATE, updateHandTwistTemporal, type HandTwistTemporalState } from "./handTwistTemporal";
import { composePoseLowerArmWithHandTwist, HAND_TWIST_RIG_CONVENTION_V1, normalizePalmBasisForTwist } from "./handTwistRig";
import { DEFAULT_HAND_MATCH_CONFIG } from "./handPoseMatching";
import type { HandTwistRigDiagnostic } from "./avatarMotionDiagnostics";
import { INITIAL_HAND_TWIST_STABILIZATION_STATE, updateHandTwistStabilization, type HandTwistStabilizationResult, type HandTwistStabilizationState } from "./handTwistStabilization";

export interface AvatarMotionProcessorOptions { filtered?: boolean; constraints?: boolean; handTwistEnabled?: boolean; now?: () => number; config?: AvatarMotionConfig }

interface HandMotionContext {
  diagnostics: HandMotionDiagnosticsSnapshot;
  matchResult: HandPoseMatchResult;
  palmBasisBySide: Record<ArmSide, HandPalmBasisOutput | null>;
  sampleClassification: HandSampleClassification;
}

interface HandTwistProcessorState {
  temporal: HandTwistTemporalState;
  stabilization: HandTwistStabilizationState;
  previousTrusted: boolean;
  lastUpdatedAtMs: number | null;
  lastAcceptedObservationAtMs: number | null;
  lastAcceptedHandSampledAtMs: number | null;
  missingSinceMs: number | null;
  lastStabilizationResult: HandTwistStabilizationResult | null;
  pendingNeutralReanchorReason: string;
  trackingEpochId: number;
  trackingEpochStartedAtMs: number | null;
  trackingEpochResetReason: HandTrackingEpochResetReason;
  matchingStateReset: boolean;
  matchingStateResetReason: HandTrackingEpochResetReason | null;
  neutralAnchoredForEpochId: number | null;
  lowerArmGeometryValid: boolean | null;
  lowerArmGeometryInvalidSinceMs: number | null;
  lowerArmGeometryInvalidConfirmed: boolean;
}

interface ArmStabilityProcessorState {
  previousPoseUpperTarget: QuaternionData | null;
  previousPoseLowerTarget: QuaternionData | null;
  previousPoseUpperApplied: QuaternionData | null;
  previousPoseLowerApplied: QuaternionData | null;
  previousHandRawTwistRadians: number | null;
  previousHandAppliedTwistRadians: number | null;
  previousFrameAtMs: number | null;
}

function createArmStabilityProcessorState(): ArmStabilityProcessorState {
  return {
    previousPoseUpperTarget: null, previousPoseLowerTarget: null,
    previousPoseUpperApplied: null, previousPoseLowerApplied: null,
    previousHandRawTwistRadians: null, previousHandAppliedTwistRadians: null,
    previousFrameAtMs: null,
  };
}

function quaternionAngularDeltaRadians(previous: QuaternionData | null, current: QuaternionData | null): number | null {
  if (!previous || !current) return null;
  const dot = Math.abs(previous.x * current.x + previous.y * current.y + previous.z * current.z + previous.w * current.w);
  return 2 * Math.acos(Math.max(-1, Math.min(1, dot)));
}

function shortestScalarAngleDeltaRadians(previous: number | null, current: number | null): number | null {
  if (previous === null || current === null || !Number.isFinite(previous) || !Number.isFinite(current)) return null;
  return Math.abs(Math.atan2(Math.sin(current - previous), Math.cos(current - previous)));
}

function poleBranch(source: PoleSource): "observed" | "history" | "rest" | "unavailable" {
  if (source === "fresh" || source === "hand") return "observed";
  if (source === "previous") return "history";
  if (source === "rest") return "rest";
  return "unavailable";
}

function sidePoseConfidence(frame: RawTrackingFrameV1, side: ArmSide): number | null {
  const indices = side === "left" ? [11, 13, 15] : [12, 14, 16];
  const values = indices.map((index) => frame.pose.landmarks?.[index]?.visibility).filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  return values.length === indices.length ? Math.max(0, Math.min(1, Math.min(...values))) : null;
}

function createHandTwistProcessorState(
  trackingEpochId = 0,
  trackingEpochResetReason: HandTrackingEpochResetReason = "processor-initialization",
): HandTwistProcessorState {
  return {
    temporal: { ...INITIAL_HAND_TWIST_TEMPORAL_STATE },
    stabilization: { ...INITIAL_HAND_TWIST_STABILIZATION_STATE },
    previousTrusted: false,
    lastUpdatedAtMs: null,
    lastAcceptedObservationAtMs: null,
    lastAcceptedHandSampledAtMs: null,
    missingSinceMs: null,
    lastStabilizationResult: null,
    pendingNeutralReanchorReason: trackingEpochResetReason,
    trackingEpochId,
    trackingEpochStartedAtMs: null,
    trackingEpochResetReason,
    matchingStateReset: false,
    matchingStateResetReason: null,
    neutralAnchoredForEpochId: null,
    lowerArmGeometryValid: null,
    lowerArmGeometryInvalidSinceMs: null,
    lowerArmGeometryInvalidConfirmed: false,
  };
}

function inactiveHandTwistDiagnostic(
  side: ArmSide,
  config: AvatarMotionConfig,
  handSampledThisFrame: boolean,
  sampleClassification: HandSampleClassification,
  state: HandTwistProcessorState,
  reason: string | null = "feature-disabled",
): HandTwistRigDiagnostic {
  const limits = config.handTwist.correctionLimits[side];
  return {
    selectedPalmAxis: HAND_TWIST_RIG_CONVENTION_V1.selectedPalmAxis,
    chiralityCorrectionApplied: HAND_TWIST_RIG_CONVENTION_V1.chiralityNormalMultiplier[side] === -1,
    configuredPositiveSign: HAND_TWIST_RIG_CONVENTION_V1.configuredPositiveSign[side],
    rigApplicationSign: HAND_TWIST_RIG_CONVENTION_V1.rigApplicationSign[side],
    handSampledThisFrame, sampleClassification,
    matchingContinuity: "not-evaluated",
    trackingEpochId: state.trackingEpochId,
    trackingEpochStartedAtMs: state.trackingEpochStartedAtMs,
    trackingEpochResetReason: state.trackingEpochResetReason,
    matchingStateReset: state.matchingStateReset,
    matchingStateResetReason: state.matchingStateResetReason,
    neutralAnchoredForEpochId: state.neutralAnchoredForEpochId,
    observationMode: sampleClassification === "duplicate" ? "duplicate" : sampleClassification === "unsampled" ? "unsampled" : "missing",
    observationWasNew: false, duplicateTimestampIgnored: false,
    missingSinceMs: null, missingDurationMs: 0, temporalAdvancedWithoutNewObservation: false,
    rawWrappedTwistRadians: null, rawUnwrappedTwistRadians: null,
    neutralTwistRadians: null, neutralInitialized: false, neutralReanchored: false,
    neutralReanchorReason: null, neutralPreservedOnReacquire: false,
    correctedTwistRadians: null, deadZoneOutputRadians: null, filteredTargetTwistRadians: null,
    clampedTwistRadians: null, clampApplied: false,
    clampMinRadians: limits.minRadians, clampMaxRadians: limits.maxRadians,
    targetInfluenceWeight: 0, temporalInfluenceWeight: 0, trusted: false,
    temporalTrackingState: "inactive", appliedTwistRadians: 0, lastAppliedTwistRadians: 0, handTwistApplied: false,
    rejectionReason: reason, unwrapOwner: "handTwistStabilization",
  };
}

function skippedHandSide(side: ArmSide): HandSideMatchResult {
  return {
    side, matched: false, candidateArrayIndex: null, candidateSourceIndex: null, distance: null,
    handedness: null, handednessScore: null, rejectionReason: "no-candidates",
    continuity: "unmatched", matchChanged: false,
  };
}

function skippedHandMatchResult(): HandPoseMatchResult {
  return { ranMatching: false, left: skippedHandSide("left"), right: skippedHandSide("right") };
}

/**
 * Mức 1B-2: thứ hạng độ tin cậy của từng nguồn pole, dùng để phát hiện "nâng cấp" (ví dụ
 * rest→fresh) cần reacquire blend. `unavailable` không xếp hạng vì đó là trạng thái khởi tạo,
 * không phải một nguồn thực — chuyển từ `unavailable` sang bất kỳ nguồn nào là lần đầu có dữ
 * liệu, không phải "nâng cấp" cần blend (không có gì trước đó để giữ liên tục).
 */
function poleSourceStrength(source: PoleSource): number {
  switch (source) {
    case "fresh": return 3;
    case "hand": return 2;
    case "previous": return 1;
    case "rest": return 0;
    case "unavailable": return -1;
  }
}

export class AvatarMotionProcessor {
  private sequence = 0;
  private readonly expressionFilters = new Map<string, OneEuroScalarFilter>();
  private readonly directionFilters = new Map<AvatarJointName, OneEuroVectorFilter>();
  private readonly poleFilters = new Map<ArmSide, OneEuroVectorFilter>();
  private readonly loss = {
    face: new TrackingLossStateMachine(), leftHand: new TrackingLossStateMachine(),
    rightHand: new TrackingLossStateMachine(), pose: new TrackingLossStateMachine(),
  };
  private readonly now: () => number;
  private readonly config: AvatarMotionConfig;
  private filtered: boolean;
  private constraints: boolean;
  private handTwistEnabled: boolean;
  private rigProfile: NormalizedAvatarRigProfile | null = null;
  private readonly armState: Record<ArmSide, ArmTemporalState> = { left: createArmTemporalState(), right: createArmTemporalState() };
  private readonly lastGeometryDiagnostics: Partial<Record<ArmSide, GeometryDiagnostic>> = {};
  private lastTorso: TorsoBasis | null = null;
  private diagnostics: AvatarMotionDiagnosticSnapshot | null = null;
  // Tư thế buông tay dựng từ rig hiện tại; mất theo dõi thì trả về đây thay vì T-pose.
  private idlePose: Record<ArmSide, IdleArmPose> | null = null;
  /**
   * Mức 2A — Việc 4: state cho Hand↔Pose matching, tách hoàn toàn khỏi `armState`. Chỉ giữ vị
   * trí wrist (image space, đã aspect-correct) của lần match gần nhất mỗi side — dùng làm
   * continuity reference cho `matchHandsToPose` (KHÔNG dùng `sourceIndex` làm identity xuyên
   * frame, xem handPoseMatching.ts). Không có gì ở đây ảnh hưởng `jointRotations`.
   */
  private readonly handMatchPrevious: Record<ArmSide, HandMatchPreviousState> = { left: { wristPosition: null, lastMatchedAtMs: null }, right: { wristPosition: null, lastMatchedAtMs: null } };
  private readonly handTwistState: Record<ArmSide, HandTwistProcessorState> = { left: createHandTwistProcessorState(), right: createHandTwistProcessorState() };
  private readonly armStabilityState: Record<ArmSide, ArmStabilityProcessorState> = { left: createArmStabilityProcessorState(), right: createArmStabilityProcessorState() };
  private lastClassifiedHandSampledAtMs: number | null = null;

  constructor(options: AvatarMotionProcessorOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.config = options.config ?? DEFAULT_AVATAR_MOTION_CONFIG;
    this.filtered = options.filtered ?? true;
    this.constraints = options.constraints ?? true;
    this.handTwistEnabled = options.handTwistEnabled ?? true;
  }

  setFiltered(enabled: boolean): void { if (this.filtered !== enabled) this.resetFilters(); this.filtered = enabled; }
  setConstraints(enabled: boolean): void { this.constraints = enabled; }
  setHandTwistEnabled(enabled: boolean): void {
    if (this.handTwistEnabled === enabled) return;
    this.handTwistEnabled = enabled;
    // Feature toggle không phải tracking-epoch boundary. Chỉ xóa output temporal để OFF luôn
    // Pose-only tuyệt đối; neutral/matching/epoch vẫn được giữ cho lần bật lại.
    for (const side of ["left", "right"] as const) {
      const state = this.handTwistState[side];
      state.temporal = { ...INITIAL_HAND_TWIST_TEMPORAL_STATE };
      state.previousTrusted = false;
      state.lastUpdatedAtMs = null;
      state.lastAcceptedObservationAtMs = null;
      state.missingSinceMs = null;
    }
    for (const side of ["left", "right"] as const) {
      this.armStabilityState[side].previousHandRawTwistRadians = null;
      this.armStabilityState[side].previousHandAppliedTwistRadians = null;
    }
  }
  /**
   * Người dùng giữ cạnh bàn tay ở neutral rồi yêu cầu neo lại. Frame Hand đáng tin kế tiếp trở
   * thành zero; matching và tracking epoch vẫn được giữ vì đây không phải mất tracking/đổi rig.
   */
  calibrateHandTwistNeutral(side: ArmSide | "both" = "both"): void {
    const sides: readonly ArmSide[] = side === "both" ? ["left", "right"] : [side];
    for (const currentSide of sides) {
      const state = this.handTwistState[currentSide];
      state.stabilization = { ...INITIAL_HAND_TWIST_STABILIZATION_STATE };
      state.temporal = { ...INITIAL_HAND_TWIST_TEMPORAL_STATE };
      state.previousTrusted = false;
      state.lastUpdatedAtMs = null;
      state.lastAcceptedObservationAtMs = null;
      state.lastAcceptedHandSampledAtMs = null;
      state.missingSinceMs = null;
      state.lastStabilizationResult = null;
      state.pendingNeutralReanchorReason = "manual-neutral-calibration";
      state.neutralAnchoredForEpochId = null;
      this.armStabilityState[currentSide].previousHandRawTwistRadians = null;
      this.armStabilityState[currentSide].previousHandAppliedTwistRadians = null;
    }
  }
  setRigProfile(profile: NormalizedAvatarRigProfile | null): void {
    if (profile && !validateRigProfile(profile)) throw new Error("Normalized avatar rig profile không hợp lệ.");
    if (this.rigProfile === profile) return;
    this.rigProfile = profile;
    this.idlePose = profile ? { left: buildIdleArmPose(profile, "left"), right: buildIdleArmPose(profile, "right") } : null;
    this.resetArmState(); this.resetHandTrackingState("rig-profile-change"); this.resetHandSampleClassification(); this.resetFilters();
  }
  getLastDiagnostics(): AvatarMotionDiagnosticSnapshot | null { return this.diagnostics ? structuredClone(this.diagnostics) : null; }

  process(frame: RawTrackingFrameV1): AvatarPosePacketV1 {
    const processedTimestampMs = this.now();
    const tracking = {
      face: this.part("face", frame.face.state, frame.face.sampledAtMs, processedTimestampMs, this.config.freshnessMs.face),
      leftHand: this.part("leftHand", frame.leftHand.state, frame.leftHand.sampledAtMs, processedTimestampMs, this.config.freshnessMs.hand),
      rightHand: this.part("rightHand", frame.rightHand.state, frame.rightHand.sampledAtMs, processedTimestampMs, this.config.freshnessMs.hand),
      pose: this.part("pose", frame.pose.state, frame.pose.sampledAtMs, processedTimestampMs, this.config.freshnessMs.pose),
    };
    const semantic = frame.face.blendshapes && tracking.face.outputState === "active"
      ? mapMediaPipeExpressions(frame.face.blendshapes) : {};
    const expressions = this.filtered && frame.face.sampledAtMs !== null && frame.face.state === "tracked"
      ? Object.fromEntries(Object.entries(semantic).map(([name, value]) => [name, this.expressionFilter(name).filter(value, frame.face.sampledAtMs!)]))
      : semantic;
    const headRotation = tracking.face.outputState === "active" && frame.face.facialTransform
      ? quaternionFromRotationMatrix(frame.face.facialTransform.data) : null;
    const canUpdateDirections = frame.pose.state === "tracked" && frame.pose.sampledAtMs !== null;
    const poseDiscontinuity: Record<ArmSide, boolean> = { left: false, right: false };
    const poseIsTrackedDuplicate = canUpdateDirections && (["left", "right"] as const).every(
      (side) => this.armState[side].lastConsumedPoseSampledAtMs === frame.pose.sampledAtMs,
    );
    if (canUpdateDirections && frame.pose.sampledAtMs !== null && !poseIsTrackedDuplicate) {
      for (const side of ["left", "right"] as const) {
        const previous = this.armState[side].lastConsumedPoseSampledAtMs;
        poseDiscontinuity[side] = previous !== null && (
          frame.pose.sampledAtMs <= previous ||
          frame.pose.sampledAtMs - previous > this.config.armFrame.longGapDiscontinuityMs
        );
        // Matching phải được reset trước khi sample Hand mới của frame này được gán.
        if (poseDiscontinuity[side]) this.resetHandTrackingSide(side, "tracking-discontinuity", processedTimestampMs);
      }
    }
    const handSampleClassification = this.classifyHandSample(frame);
    if (handSampleClassification === "new-sample" && frame.handSampledAtMs !== null) {
      for (const side of ["left", "right"] as const) {
        const previousHandSample = this.handTwistState[side].lastAcceptedHandSampledAtMs;
        if (previousHandSample !== null && frame.handSampledAtMs <= previousHandSample) {
          this.resetHandTrackingSide(side, "tracking-discontinuity", processedTimestampMs);
        }
      }
    }
    const handContext = handSampleClassification === "new-sample"
      ? this.computeHandMotion(frame, handSampleClassification)
      : this.computeSkippedHandMotion(frame, handSampleClassification);
    const handTwistDiagnostics: Record<ArmSide, HandTwistRigDiagnostic> = {
      left: inactiveHandTwistDiagnostic("left", this.config, frame.handSampledThisFrame, handSampleClassification, this.handTwistState.left),
      right: inactiveHandTwistDiagnostic("right", this.config, frame.handSampledThisFrame, handSampleClassification, this.handTwistState.right),
    };
    const armStabilityDiagnostics = {} as AvatarMotionDiagnosticSnapshot["armStability"];
    let jointRotations: AvatarPosePacketV1["jointRotations"] = {};
    if (this.rigProfile) {
      const sampledAtMs = frame.pose.sampledAtMs;
      const isTrackedDuplicate = poseIsTrackedDuplicate;
      const isNewSample = tracking.pose.outputState === "active" && canUpdateDirections && !isTrackedDuplicate;
      const sampleDisposition: MotionSampleDisposition = isNewSample ? "new" : isTrackedDuplicate ? "duplicate-timestamp" : frame.pose.state === "lost" ? "lost" : "not-sampled";
      if (sampledAtMs !== null && isNewSample) for (const side of ["left", "right"] as const) {
        if (poseDiscontinuity[side]) {
          Object.assign(this.armState[side], createArmTemporalState());
        }
      }
      const solved = isNewSample && frame.pose.worldLandmarks && frame.pose.landmarks ? solveAnatomicalArmFrames(frame.pose.worldLandmarks, frame.pose.landmarks, this.rigProfile, {
        left: { previousPole: this.armState.left.previousPole, previousPoleWasFresh: this.armState.left.poleSource === "fresh", previousDepthDegenerate: this.armState.left.depthDegenerate, lastValidPoleAtMs: this.armState.left.lastValidPoleAtMs, previousPrimary: this.armState.left.previousPrimary, previousSecondary: this.armState.left.previousSecondary, calibratedLength: this.armState.left.calibratedLength, previousObservedElbow: this.armState.left.previousObservedElbow, inferenceStartedAtMs: this.armState.left.inferenceStartedAtMs, elbowWasVisible: this.armState.left.elbowWasVisible, wristWasVisible: this.armState.left.wristWasVisible, previousElbowDirection: this.armState.left.previousElbowDirection },
        right: { previousPole: this.armState.right.previousPole, previousPoleWasFresh: this.armState.right.poleSource === "fresh", previousDepthDegenerate: this.armState.right.depthDegenerate, lastValidPoleAtMs: this.armState.right.lastValidPoleAtMs, previousPrimary: this.armState.right.previousPrimary, previousSecondary: this.armState.right.previousSecondary, calibratedLength: this.armState.right.calibratedLength, previousObservedElbow: this.armState.right.previousObservedElbow, inferenceStartedAtMs: this.armState.right.inferenceStartedAtMs, elbowWasVisible: this.armState.right.elbowWasVisible, wristWasVisible: this.armState.right.wristWasVisible, previousElbowDirection: this.armState.right.previousElbowDirection },
      }, processedTimestampMs, this.config.armFrame, this.constraints, this.filtered
        ? (name, direction) => this.directionFilter(name).filter(direction, sampledAtMs!) : undefined,
      this.filtered ? (side, pole) => this.poleFilter(side).filter(pole, sampledAtMs!) : undefined,
      this.lastTorso ?? undefined) : null;
      if (solved?.torsoWasObserved) this.lastTorso = solved.torso;
      const torso = solved?.torso ?? this.lastTorso ?? {
        right: this.rigProfile.torsoReference.rightWorld, up: this.rigProfile.torsoReference.upWorld,
        forward: this.rigProfile.torsoReference.forwardWorld, worldRotation: this.rigProfile.torsoReference.worldRotation,
      };
      const torsoSource: TorsoBasisSource = solved?.torsoWasObserved ? "fresh" : this.lastTorso ? "previous" : "rest";
      const armDiagnostics = {} as AvatarMotionDiagnosticSnapshot["arms"];
      for (const side of ["left", "right"] as const) {
        const state = this.armState[side]; const geometry = solved?.sides[side] ?? null;
        const stabilityState = this.armStabilityState[side];
        const names = side === "left" ? { upper: "leftUpperArm" as const, lower: "leftLowerArm" as const } : { upper: "rightUpperArm" as const, lower: "rightLowerArm" as const };
        // Phase 3B (bổ sung) — Partial arm tracking: hai đoạn xương được nghiệm thu ĐỘC LẬP.
        //
        // Trước đây một cánh tay chỉ dùng được khi cả upper và lower cùng hợp lệ, vì lo rằng
        // nhận upper mới trong khi lower giữ giá trị cũ sẽ ghép hai thời điểm khác nhau và
        // kéo forearm quét ngang mặt. Nhưng nỗi lo đó chỉ đúng nếu hold lưu WORLD rotation.
        // `updateSegmentTemporalOutput` giữ parent-local rest-relative delta (xem
        // armTemporalState.ts), nên lower bị hold vẫn xoay theo upper như một khối cứng và
        // giữ nguyên góc gập — không có chuyện quét ngang mặt. Ràng buộc cũ đổi lại làm mất
        // cả cánh tay trên mỗi khi cổ tay bị che, dù vai và khuỷu vẫn quan sát rõ: upper bị
        // ép null → hold → return về tư thế buông tay.
        //
        // `chainGeometryValid` giờ chỉ hỏi "chuỗi tay còn gốc hợp lệ không" (vai→khuỷu). Mất
        // riêng cổ tay không còn giết cả chain; nó chỉ vô hiệu hóa đúng đoạn lower.
        const chainGeometryValid = Boolean(geometry?.segmentValidity.upper);
        const lowerGeometryValid = Boolean(geometry?.segmentValidity.lower);
        const currentUpperTarget = isNewSample && chainGeometryValid ? geometry?.deltas[names.upper] ?? null : null;
        const currentLowerTarget = isNewSample && lowerGeometryValid ? geometry?.deltas[names.lower] ?? null : null;
        const poseUpperTargetAngularDeltaRadians = quaternionAngularDeltaRadians(stabilityState.previousPoseUpperTarget, currentUpperTarget);
        const poseLowerTargetAngularDeltaRadians = quaternionAngularDeltaRadians(stabilityState.previousPoseLowerTarget, currentLowerTarget);
        if (isNewSample) state.lastConsumedPoseSampledAtMs = sampledAtMs;
        if (solved) { state.elbowWasVisible = solved.visibilityStates[side].elbow; state.wristWasVisible = solved.visibilityStates[side].wrist; }
        if (isNewSample && !chainGeometryValid) {
          state.invalidCandidateStartedAtMs ??= processedTimestampMs;
          state.validCandidateStartedAtMs = null;
        } else if (isNewSample && state.invalidCandidateStartedAtMs !== null) {
          state.validCandidateStartedAtMs ??= processedTimestampMs;
        }
        const confirmationElapsed = state.validCandidateStartedAtMs === null ? 0 : processedTimestampMs - state.validCandidateStartedAtMs;
        const recoveringFromChainLoss = state.invalidCandidateStartedAtMs !== null;
        const geometryConfirmed = Boolean(
          geometry && chainGeometryValid && (
            !recoveringFromChainLoss || confirmationElapsed >= this.config.armFrame.validRecoveryConfirmMs
          ),
        );
        const chainTrackingReacquired = geometryConfirmed && recoveringFromChainLoss;
        if (geometryConfirmed) {
          state.depthDegenerate = geometry!.depthDegenerate;
          if (chainTrackingReacquired) {
            state.invalidCandidateStartedAtMs = null;
            state.validCandidateStartedAtMs = null;
          }
        }
        // Mức 1B-2 (theo tư vấn chuyên gia): "reacquire" phải trigger khi NGUỒN dữ liệu hình
        // học đổi loại, không chỉ khi lossState mất/còn — vì geometry vẫn solved liên tục mỗi
        // frame cả khi poleSource đổi (rest→fresh), nên lossState không hề rời "active". Đo
        // được cú nhảy 57.94° khi elbowSource giữ nguyên "observed" nhưng poleSource đổi
        // rest→fresh mà không có cơ chế nào chặn trước sửa này.
        // Mức 1B-3: chụp lại trước khi cập nhật state, dùng để tính diagnostic angular-delta.
        const previousPoleSourceForDiagnostic = state.poleSource;
        const previousElbowSourceForStability = state.elbowSource;
        const previousPoleValueForDiagnostic = state.previousPole;
        const previousUpperOutput = state.segments.upper.currentOutputDelta;
        const previousLowerOutput = state.segments.lower.currentOutputDelta;
        const previousPoleSourceStrength = poleSourceStrength(state.poleSource);
        const acceptedGeometry = geometryConfirmed ? geometry : null;
        const poleSourceUpgraded = Boolean(acceptedGeometry) && poleSourceStrength(acceptedGeometry!.poleSource) > previousPoleSourceStrength && state.poleSource !== "unavailable";
        let trackingReacquired = chainTrackingReacquired;
        if (acceptedGeometry?.acceptedFreshPole) { state.previousPole = acceptedGeometry.acceptedPole; state.lastValidPoleAtMs = processedTimestampMs; }
        if (acceptedGeometry) state.poleSource = acceptedGeometry.poleSource;
        if (acceptedGeometry) {
          const elbowSourceChanged = state.elbowSource !== "unavailable" && state.elbowSource !== acceptedGeometry.elbowSource;
          if (elbowSourceChanged || poleSourceUpgraded || chainTrackingReacquired) { trackingReacquired = true; for (const segment of ["upper", "lower"] as const) { state.segments[segment].lossState = "recovering"; state.segments[segment].recoveryStartedAtMs = null; } }
          state.elbowSource = acceptedGeometry.elbowSource;
          state.previousPrimary = acceptedGeometry.primary; state.previousSecondary = acceptedGeometry.secondary;
          // Phase 3B partial-arm: mỏ neo phía gập chỉ được cập nhật khi frame này còn xác định được mặt
          // phẳng gập (solver trả null khi tay gần duỗi thẳng). Giữ mỏ neo cũ trong các frame
          // suy biến — đó chính là lúc cần nó nhất để elbow inference không lật phía.
          if (acceptedGeometry.elbowDirection) state.previousElbowDirection = acceptedGeometry.elbowDirection;
          if (acceptedGeometry.elbowSource === "observed") { state.previousObservedElbow = acceptedGeometry.elbowPosition; state.inferenceStartedAtMs = null; if (acceptedGeometry.observedLengths) this.updateLengthCalibration(state, acceptedGeometry.observedLengths); }
          else state.inferenceStartedAtMs ??= processedTimestampMs;
        } else if (solved?.diagnostics[side].hardRejectionReason?.startsWith("elbow-inference")) state.inferenceStartedAtMs ??= processedTimestampMs;
        const segmentTemporal = {} as Record<"upper" | "lower", { output: QuaternionData; state: ArmLossState; progress: number }>;
        for (const segment of ["upper", "lower"] as const) {
          // Lower chỉ nhận target mới khi chính đoạn đó có nghiệm hình học; mất cổ tay thì
          // solvedDelta=null đưa riêng lower vào hold (giữ local delta) trong khi upper vẫn
          // được cập nhật bình thường từ vai→khuỷu.
          const name = names[segment];
          const segmentGeometryValid = segment === "upper" ? chainGeometryValid : lowerGeometryValid;
          const solvedDelta = segmentGeometryValid ? acceptedGeometry?.deltas[name] ?? null : null;
          segmentTemporal[segment] = isTrackedDuplicate
            ? { output: state.segments[segment].currentOutputDelta, state: state.segments[segment].lossState, progress: this.diagnostics?.arms[side].transitionProgress ?? 1 }
            : updateSegmentTemporalOutput(state.segments[segment], solvedDelta, Boolean(solvedDelta && isNewSample), processedTimestampMs, this.config.loss.holdMs, this.config.loss.returnMs, this.config.loss.recoveryMs, this.config.armFrame.invalidGraceMs, this.idlePose?.[side][segment]);
          jointRotations[name] = segmentTemporal[segment].output;
        }
        const lowerName = names.lower;
        const poseLowerDelta = segmentTemporal.lower.output;
        // Hand twist bám vào lower-arm frame, nên gate theo chính lower chứ không theo chain:
        // mất cổ tay thì lower đang hold, twist phải freeze theo (nếu không twist sẽ tiếp tục
        // xoay một đoạn xương đã đóng băng).
        const freshLowerGeometryValid = isNewSample
          ? lowerGeometryValid
          : null;
        const armChainOutputValid = state.invalidCandidateStartedAtMs === null;
        const twistResult = this.applyHandTwist(side, poseLowerDelta, handContext, frame, processedTimestampMs, freshLowerGeometryValid, armChainOutputValid);
        handTwistDiagnostics[side] = twistResult.diagnostic;
        if (twistResult.output !== poseLowerDelta) jointRotations[lowerName] = twistResult.output;
        const temporalState = segmentTemporal.lower.state === "active" ? segmentTemporal.upper.state : segmentTemporal.lower.state;
        const temporalProgress = Math.min(segmentTemporal.upper.progress, segmentTemporal.lower.progress);
        if (solved?.diagnostics[side]) this.lastGeometryDiagnostics[side] = solved.diagnostics[side];
        const base = this.lastGeometryDiagnostics[side] ?? { side, pole: state.previousPole, poleSource: state.poleSource, elbowOffsetMagnitude: null, normalizedElbowOffset: null, planeNormal: null, upperTargetWorld: null, lowerTargetWorld: null, armValidity: "rejected" as const, hardRejectionReason: "no-sampled-pose", confidenceFlags: [], imageBounds: { shoulder: null, elbow: null, wrist: null }, upperSegmentLength: null, lowerSegmentLength: null, segmentRatio: null, depthAlignment: null, candidatePole: null, filteredPole: null, projectedPole: null, poleAngularVelocity: null, depthQuality: null, bendPlaneQuality: null, elbowBendDegrees: null, handPoleRejectionReason: null,
          upperArmAngularDeltaDeg: null, lowerArmAngularDeltaDeg: null, poleAngularDeltaDeg: null, poleSourceChanged: false, trackingReacquired: false,
          observation: { upperDirectionValid: false, lowerDirectionValid: false, poleValid: false, twistObservable: false, upperRejectionReason: "no-sampled-pose", lowerRejectionReason: "no-sampled-pose", poleRejectionReason: "no-sampled-pose" },
          elbowInference: { source: "unavailable" as const, confidence: 0, durationMs: 0, inferredPosition: null, calibratedUpperLength: state.calibratedLength.upper, calibratedLowerLength: state.calibratedLength.lower, shoulderWristDistance: null, reachRatio: null, distanceFromPreviousElbow: null } };
        armDiagnostics[side] = { ...base, lossState: temporalState, transitionProgress: temporalProgress,
          invalidDurationMs: state.invalidCandidateStartedAtMs === null ? 0 : processedTimestampMs - state.invalidCandidateStartedAtMs,
          validRecoveryDurationMs: state.validCandidateStartedAtMs === null ? 0 : processedTimestampMs - state.validCandidateStartedAtMs,
          sampleDisposition, segmentLossState: { upper: segmentTemporal.upper.state, lower: segmentTemporal.lower.state },
          // Mức 1B-3: đo trên OUTPUT thực tế (đã qua hemisphere continuity + reacquire blend),
          // không phải deltas thô — phản ánh đúng những gì renderer thực sự nhận mỗi frame.
          upperArmAngularDeltaDeg: angularDeltaDegrees(previousUpperOutput, segmentTemporal.upper.output),
          lowerArmAngularDeltaDeg: angularDeltaDegrees(previousLowerOutput, segmentTemporal.lower.output),
          poleAngularDeltaDeg: previousPoleValueForDiagnostic && acceptedGeometry?.acceptedPole ? vectorAngularDeltaDegrees(previousPoleValueForDiagnostic, acceptedGeometry.acceptedPole) : null,
          poleSourceChanged: Boolean(acceptedGeometry) && acceptedGeometry!.poleSource !== previousPoleSourceForDiagnostic,
          trackingReacquired,
          elbowInference: { ...base.elbowInference,
            // Phase 3B partial-arm: frame duplicate (không phải sample mới) không có `geometry`, nhưng cánh
            // tay vẫn đang chạy trên nghiệm của sample gần nhất. Lùi về `state.elbowSource` thay
            // vì báo "unavailable" — nếu không, ở FPS thấp phần lớn frame hiển thị sai trạng
            // thái và che mất nguồn lỗi thật khi chẩn đoán.
            source: geometry?.elbowSource ?? (temporalState === "held" ? "held" : temporalState === "returning" ? "returning" : state.elbowSource),
            durationMs: state.inferenceStartedAtMs === null ? 0 : processedTimestampMs - state.inferenceStartedAtMs,
            calibratedUpperLength: state.calibratedLength.upper, calibratedLowerLength: state.calibratedLength.lower } };
        const currentElbowSource = armDiagnostics[side].elbowInference.source;
        const currentPoleSource = armDiagnostics[side].poleSource;
        const rawTwist = twistResult.diagnostic.observationWasNew ? twistResult.diagnostic.rawWrappedTwistRadians : null;
        const frameDtMs = stabilityState.previousFrameAtMs === null ? null : Math.max(0, processedTimestampMs - stabilityState.previousFrameAtMs);
        const poleQuality = armDiagnostics[side].depthQuality === null || armDiagnostics[side].bendPlaneQuality === null
          ? null : armDiagnostics[side].depthQuality * armDiagnostics[side].bendPlaneQuality;
        armStabilityDiagnostics[side] = {
          poseUpperTargetAngularDeltaRadians,
          poseLowerTargetAngularDeltaRadians,
          poseUpperAppliedAngularDeltaRadians: quaternionAngularDeltaRadians(stabilityState.previousPoseUpperApplied, segmentTemporal.upper.output),
          poseLowerAppliedAngularDeltaRadians: quaternionAngularDeltaRadians(stabilityState.previousPoseLowerApplied, segmentTemporal.lower.output),
          elbowSource: currentElbowSource,
          elbowSourceChanged: previousElbowSourceForStability !== "unavailable" && currentElbowSource !== previousElbowSourceForStability,
          poleSource: currentPoleSource,
          poleQuality,
          poleBranchChanged: previousPoleSourceForDiagnostic !== "unavailable" && poleBranch(currentPoleSource) !== poleBranch(previousPoleSourceForDiagnostic),
          poseConfidence: sidePoseConfidence(frame, side),
          poseTrackingState: tracking.pose.outputState,
          handRawTwistDeltaRadians: shortestScalarAngleDeltaRadians(stabilityState.previousHandRawTwistRadians, rawTwist),
          handAppliedTwistDeltaRadians: stabilityState.previousHandAppliedTwistRadians === null
            ? null : Math.abs(twistResult.diagnostic.appliedTwistRadians - stabilityState.previousHandAppliedTwistRadians),
          trusted: twistResult.diagnostic.trusted,
          targetInfluenceWeight: twistResult.diagnostic.targetInfluenceWeight,
          temporalInfluenceWeight: twistResult.diagnostic.temporalInfluenceWeight,
          neutralReanchored: twistResult.diagnostic.neutralReanchored,
          observationMode: twistResult.diagnostic.observationMode,
          frameDtMs,
          poseSampleAgeMs: frame.pose.sampledAtMs === null ? null : Math.max(0, processedTimestampMs - frame.pose.sampledAtMs),
          handSampleAgeMs: frame.handSampledAtMs === null ? null : Math.max(0, processedTimestampMs - frame.handSampledAtMs),
        };
        if (currentUpperTarget) stabilityState.previousPoseUpperTarget = currentUpperTarget;
        if (currentLowerTarget) stabilityState.previousPoseLowerTarget = currentLowerTarget;
        stabilityState.previousPoseUpperApplied = segmentTemporal.upper.output;
        stabilityState.previousPoseLowerApplied = segmentTemporal.lower.output;
        if (rawTwist !== null) stabilityState.previousHandRawTwistRadians = rawTwist;
        stabilityState.previousHandAppliedTwistRadians = twistResult.diagnostic.appliedTwistRadians;
        stabilityState.previousFrameAtMs = processedTimestampMs;
      }
      this.diagnostics = { version: 1, processedAtMs: processedTimestampMs, torso: { right: torso.right, up: torso.up, forward: torso.forward, source: torsoSource }, arms: armDiagnostics, handTwist: handTwistDiagnostics, armStability: armStabilityDiagnostics, headRotationSemantic: "legacy-unverified" };
    } else this.diagnostics = null;
    return { version: 1, sequence: ++this.sequence, sourceFrameTimestampMs: frame.frameTimestampMs, processedTimestampMs, tracking, expressions, headRotation, jointRotations, handMotion: handContext.diagnostics };
  }

  /**
   * Mức 2A — Việc 4: rawHands → Hand↔Pose matching → palm basis (candidate đã match) →
   * diagnostic. Đọc `frame.pose.landmarks` CHỈ để lấy wrist image-space làm mục tiêu matching
   * (index 15/16 — cùng convention với `armFrameSolver.ts`); không đọc/ghi `armState`, không
   * đụng pole, không tạo hay sửa `jointRotations`.
   */
  private classifyHandSample(frame: RawTrackingFrameV1): HandSampleClassification {
    if (!frame.handSampledThisFrame || frame.handSampledAtMs === null) return "unsampled";
    if (frame.handSampledAtMs === this.lastClassifiedHandSampledAtMs) return "duplicate";
    this.lastClassifiedHandSampledAtMs = frame.handSampledAtMs;
    return "new-sample";
  }

  private computeSkippedHandMotion(frame: RawTrackingFrameV1, sampleClassification: Exclude<HandSampleClassification, "new-sample">): HandMotionContext {
    const matchResult = skippedHandMatchResult();
    const palmBasisBySide: Record<ArmSide, HandPalmBasisOutput | null> = { left: null, right: null };
    const diagnostics = buildHandMotionDiagnostics({
      handSampledThisFrame: frame.handSampledThisFrame,
      handSampledAtMs: frame.handSampledAtMs,
      poseSampledAtMs: frame.pose.sampledAtMs,
      rawHandsCount: frame.rawHands.length,
      sampleClassification,
      matchResult,
      palmBasisBySide,
    });
    return { diagnostics, matchResult, palmBasisBySide, sampleClassification };
  }

  private computeHandMotion(frame: RawTrackingFrameV1, sampleClassification: "new-sample"): HandMotionContext {
    const videoWidth = frame.videoWidth ?? 0;
    const videoHeight = frame.videoHeight ?? 0;
    const poseWristImage = {
      left: frame.pose.landmarks?.[15] ?? null,
      right: frame.pose.landmarks?.[16] ?? null,
    };

    const matchResult = matchHandsToPose({
      handSampledThisFrame: frame.handSampledThisFrame,
      rawHands: frame.rawHands,
      poseWristImage,
      poseSampledAtMs: frame.pose.sampledAtMs,
      handSampledAtMs: frame.handSampledAtMs,
      videoWidth: videoWidth > 0 ? videoWidth : 1,
      videoHeight: videoHeight > 0 ? videoHeight : 1,
      previous: this.handMatchPrevious,
    });

    // Chỉ cập nhật continuity reference khi ĐÃ chạy matching mới và side đó thực sự match được
    // — không sample thì giữ nguyên lịch sử (yêu cầu #2); sampled nhưng no-candidates/unmatched
    // cũng giữ nguyên tới khi tự nhiên stale theo `continuityTimeoutMs` của matcher (yêu cầu #3).
    if (matchResult.ranMatching) {
      for (const side of ["left", "right"] as const) {
        const match = matchResult[side];
        if (!match.matched || match.candidateArrayIndex === null) continue;
        // `candidateArrayIndex` là vị trí trong MẢNG `frame.rawHands` của CHÍNH lần gọi này —
        // đúng khoá để truy cập trực tiếp (yêu cầu #1/#5). `candidateSourceIndex` (nếu cần) chỉ
        // dùng hiển thị diagnostic, không dùng để tra cứu ở đây.
        const candidate = frame.rawHands[match.candidateArrayIndex];
        if (!candidate) continue;
        const wrist = candidate.landmarks[0];
        if (wrist && videoHeight > 0 && videoWidth > 0) {
          this.handMatchPrevious[side] = {
            wristPosition: { x: wrist.x, y: wrist.y * (videoHeight / videoWidth) },
            lastMatchedAtMs: frame.handSampledAtMs,
          };
        }
      }
    }

    const palmBasisBySide: Record<ArmSide, HandPalmBasisOutput | null> = { left: null, right: null };
    for (const side of ["left", "right"] as const) {
      const match = matchResult[side];
      if (!match.matched || match.candidateArrayIndex === null) continue;
      const candidate: RawHandCandidateV1 | undefined = frame.rawHands[match.candidateArrayIndex];
      if (!candidate) continue;
      palmBasisBySide[side] = computeHandPalmBasis(candidate.landmarks, candidate.worldLandmarks, candidate.handedness, videoWidth, videoHeight);
    }

    const diagnostics = buildHandMotionDiagnostics({
      handSampledThisFrame: frame.handSampledThisFrame,
      handSampledAtMs: frame.handSampledAtMs,
      poseSampledAtMs: frame.pose.sampledAtMs,
      rawHandsCount: frame.rawHands.length,
      sampleClassification,
      matchResult,
      palmBasisBySide,
    });
    return { diagnostics, matchResult, palmBasisBySide, sampleClassification };
  }

  private applyHandTwist(
    side: ArmSide,
    poseLowerDelta: QuaternionData,
    hand: HandMotionContext,
    frame: RawTrackingFrameV1,
    nowMs: number,
    freshLowerGeometryValid: boolean | null,
    armChainOutputValid: boolean,
  ): { output: QuaternionData; diagnostic: HandTwistRigDiagnostic } {
    const state = this.handTwistState[side];
    state.trackingEpochStartedAtMs ??= nowMs;
    if (!this.handTwistEnabled) {
      const diagnostic = inactiveHandTwistDiagnostic(side, this.config, frame.handSampledThisFrame, hand.sampleClassification, state);
      this.consumeMatchingResetMarker(state);
      return { output: poseLowerDelta, diagnostic };
    }
    const dtSeconds = state.lastUpdatedAtMs === null ? 1 / 60 : (nowMs - state.lastUpdatedAtMs) / 1000;
    if (Number.isFinite(dtSeconds) && dtSeconds > 0) state.lastUpdatedAtMs = nowMs;

    const lowerName = side === "left" ? "leftLowerArm" : "rightLowerArm";
    const profileJoint = this.rigProfile?.joints[lowerName];
    const forearmAxis = this.armState[side].previousPrimary.lower;
    const referenceDirection = this.armState[side].previousSecondary.lower;
    if (freshLowerGeometryValid === false) {
      if (state.lowerArmGeometryValid !== false) {
        state.lowerArmGeometryValid = false;
        state.lowerArmGeometryInvalidSinceMs = nowMs;
        state.lowerArmGeometryInvalidConfirmed = false;
      } else if (
        state.lowerArmGeometryInvalidSinceMs !== null &&
        nowMs - state.lowerArmGeometryInvalidSinceMs >= this.config.armFrame.invalidGraceMs
      ) {
        // Chỉ observation invalid mới xác nhận loss; thời gian trôi qua trên frame unsampled không đủ.
        state.lowerArmGeometryInvalidConfirmed = true;
      }
    } else if (freshLowerGeometryValid === true && state.lowerArmGeometryValid === false) {
      const recoveredFromConfirmedInvalid = state.lowerArmGeometryInvalidConfirmed;
      state.lowerArmGeometryValid = true;
      state.lowerArmGeometryInvalidSinceMs = null;
      state.lowerArmGeometryInvalidConfirmed = false;
      if (recoveredFromConfirmedInvalid) {
        // Epoch boundary nằm ở recovery đã xác nhận. Frame recovery chỉ fallback Pose-only; sample
        // Hand mới kế tiếp sẽ chạy matching từ state sạch và anchor neutral đúng một lần.
        this.resetHandTrackingSide(side, "invalid-lower-arm-profile-or-geometry", nowMs);
        state.lowerArmGeometryValid = true;
        const diagnostic = inactiveHandTwistDiagnostic(side, this.config, frame.handSampledThisFrame, hand.sampleClassification, state, "invalid-lower-arm-profile-or-geometry");
        this.consumeMatchingResetMarker(state);
        return { output: poseLowerDelta, diagnostic };
      }
    } else if (freshLowerGeometryValid === true) {
      state.lowerArmGeometryValid = true;
    }
    if (!profileJoint || !forearmAxis || !referenceDirection || state.lowerArmGeometryValid === false) {
      state.trackingEpochStartedAtMs ??= nowMs;
      const diagnostic = inactiveHandTwistDiagnostic(side, this.config, frame.handSampledThisFrame, hand.sampleClassification, state, "invalid-lower-arm-profile-or-geometry");
      this.consumeMatchingResetMarker(state);
      return { output: poseLowerDelta, diagnostic };
    }

    const duplicateTimestamp = hand.sampleClassification === "duplicate";
    const isNewHandSample = hand.sampleClassification === "new-sample";
    const match = hand.matchResult[side];
    const palm = hand.palmBasisBySide[side];
    let observationMode: HandTwistRigDiagnostic["observationMode"] = hand.sampleClassification === "unsampled" ? "unsampled" : duplicateTimestamp ? "duplicate" : "missing";
    let rawWrappedTwistRadians: number | null = null;
    let trusted = state.previousTrusted;
    let targetInfluenceWeight = state.temporal.acceptedTargetInfluenceWeight;
    let rejectionReason: string | null = observationMode === "missing" ? "invalid-hand-observation" : null;
    let chiralityCorrectionApplied = HAND_TWIST_RIG_CONVENTION_V1.chiralityNormalMultiplier[side] === -1;
    let stabilizationResult: HandTwistStabilizationResult | null = state.lastStabilizationResult;
    let neutralPreservedOnReacquire = false;

    if (isNewHandSample) {
      if (match.matched && palm?.worldBasis) {
        const normalized = normalizePalmBasisForTwist(side, palm.worldBasis);
        chiralityCorrectionApplied = normalized.chiralityCorrectionApplied;
        const twist = computeHandForearmTwist({
          side, forearmAxis, palmBasis: normalized.basis, palmBasisQuality: palm.worldGeometryQuality,
          palmDirectionAxis: HAND_TWIST_RIG_CONVENTION_V1.selectedPalmAxis,
          referenceDirection, positiveSign: HAND_TWIST_RIG_CONVENTION_V1.configuredPositiveSign[side],
        });
        rawWrappedTwistRadians = twist.twistRadians;
        const confidence = computeHandTwistConfidence({
          handMatched: match.matched, twistAccepted: twist.accepted,
          matchQuality: match.distance === null ? 0 : Math.max(0, 1 - match.distance / DEFAULT_HAND_MATCH_CONFIG.maxWristDistance),
          palmGeometryQuality: palm.worldGeometryQuality,
          palmProjectionRatio: twist.palmProjectionRatio, referenceProjectionRatio: twist.referenceProjectionRatio,
          handAgeMs: frame.handSampledAtMs === null ? null : Math.max(0, nowMs - frame.handSampledAtMs),
          poseHandTimestampDeltaMs: frame.pose.sampledAtMs === null || frame.handSampledAtMs === null ? null : Math.abs(frame.pose.sampledAtMs - frame.handSampledAtMs),
          handednessScore: match.handednessScore, previousTrusted: state.previousTrusted,
        });
        trusted = confidence.trusted;
        // Confidence là cổng tin cậy. Khi observation đã trusted, giữ đủ biên độ; temporal
        // influence chỉ phục vụ acquire/hold/fade, không co góc liên tục theo chất lượng landmark.
        targetInfluenceWeight = confidence.trusted ? 1 : 0;
        rejectionReason = twist.rejectionReason ?? confidence.rejectionReason;
        if (trusted && rawWrappedTwistRadians !== null) {
          const observationDtSeconds = state.lastAcceptedObservationAtMs === null ? 1 / 60 : Math.max(1 / 240, (nowMs - state.lastAcceptedObservationAtMs) / 1000);
          const limits = this.config.handTwist.correctionLimits[side];
          const nextStabilization = updateHandTwistStabilization(state.stabilization, {
            rawWrappedTwistRadians, nowMs, dtSeconds: observationDtSeconds,
            // Short reacquire giữ neutral cũ. Reset/discontinuity/model/profile đã xóa state trước khi tới đây.
            reanchorNeutral: false, reanchorReason: state.pendingNeutralReanchorReason,
          }, {
            deadZoneRadians: this.config.handTwist.deadZoneRadians,
            targetFilterTimeConstantSeconds: this.config.handTwist.targetFilterTimeConstantSeconds,
            minCorrectionRadians: limits.minRadians,
            maxCorrectionRadians: limits.maxRadians,
          });
          if (nextStabilization) {
            stabilizationResult = nextStabilization;
            state.stabilization = nextStabilization.state;
            state.lastStabilizationResult = nextStabilization;
            state.lastAcceptedObservationAtMs = nowMs;
            state.lastAcceptedHandSampledAtMs = frame.handSampledAtMs;
            state.pendingNeutralReanchorReason = "none";
            if (nextStabilization.neutralReanchored) state.neutralAnchoredForEpochId = state.trackingEpochId;
            state.missingSinceMs = null;
            observationMode = "valid";
            neutralPreservedOnReacquire = match.continuity === "reacquired" && !nextStabilization.neutralReanchored;
            rejectionReason = null;
          } else {
            trusted = false;
            rejectionReason = "stabilization-rejected";
          }
        }
      } else {
        trusted = false;
        rejectionReason = !match.matched ? (match.rejectionReason ?? "hand-unmatched") : (palm?.worldRejectionReason ?? "missing-world-palm-basis");
      }
      if (observationMode !== "valid") state.missingSinceMs ??= nowMs;
      state.previousTrusted = observationMode === "valid" && trusted;
    }
    if (observationMode === "missing" && frame.handSampledThisFrame && !duplicateTimestamp) {
      state.missingSinceMs ??= nowMs;
      state.previousTrusted = false;
    }

    const missingDurationMs = state.missingSinceMs === null ? 0 : Math.max(0, nowMs - state.missingSinceMs);
    const temporal = updateHandTwistTemporal(state.temporal, {
      observationMode,
      targetCorrectionRadians: observationMode === "valid" ? stabilizationResult?.clampedTwistRadians ?? null : null,
      targetInfluenceWeight: observationMode === "valid" ? targetInfluenceWeight : null,
      missingDurationSeconds: missingDurationMs / 1000,
      dtSeconds,
    }, {
      ...DEFAULT_HAND_TWIST_TEMPORAL_CONFIG,
      missingHoldSeconds: this.config.handTwist.missingHoldMs / 1000,
      fallRatePerSecond: 1_000 / Math.max(1, this.config.handTwist.missingFadeMs),
    });
    state.temporal = temporal.state;
    if (temporal.resetOccurred) {
      this.resetHandTrackingSide(side, "long-loss-temporal-reset", nowMs);
      stabilizationResult = null;
    }
    const effectiveTemporal = temporal.resetOccurred
      ? { stabilizedTwistRadians: 0, influenceWeight: 0, trackingState: "inactive" as const }
      : temporal;
    const anatomicalAppliedTwistRadians = effectiveTemporal.stabilizedTwistRadians * effectiveTemporal.influenceWeight;
    const appliedTwistRadians = anatomicalAppliedTwistRadians * HAND_TWIST_RIG_CONVENTION_V1.rigApplicationSign[side];
    const canApply = armChainOutputValid && temporal.influenceWeight > 0 && Math.abs(appliedTwistRadians) > 1e-12 && Number.isFinite(appliedTwistRadians);
    const composed = canApply ? composePoseLowerArmWithHandTwist(poseLowerDelta, profileJoint.anatomicalRestBasis.primaryLocal, appliedTwistRadians) : null;
    const handTwistApplied = composed !== null;
    const finalApplied = handTwistApplied ? appliedTwistRadians : 0;
    const limits = this.config.handTwist.correctionLimits[side];
    const diagnostic: HandTwistRigDiagnostic = {
      selectedPalmAxis: HAND_TWIST_RIG_CONVENTION_V1.selectedPalmAxis,
      chiralityCorrectionApplied,
      configuredPositiveSign: HAND_TWIST_RIG_CONVENTION_V1.configuredPositiveSign[side],
      rigApplicationSign: HAND_TWIST_RIG_CONVENTION_V1.rigApplicationSign[side],
      handSampledThisFrame: frame.handSampledThisFrame,
      sampleClassification: hand.sampleClassification,
      matchingContinuity: hand.matchResult.ranMatching ? match.continuity : "not-evaluated",
      trackingEpochId: state.trackingEpochId,
      trackingEpochStartedAtMs: state.trackingEpochStartedAtMs,
      trackingEpochResetReason: state.trackingEpochResetReason,
      matchingStateReset: state.matchingStateReset,
      matchingStateResetReason: state.matchingStateResetReason,
      neutralAnchoredForEpochId: state.neutralAnchoredForEpochId,
      observationMode,
      observationWasNew: isNewHandSample,
      duplicateTimestampIgnored: duplicateTimestamp,
      missingSinceMs: state.missingSinceMs,
      missingDurationMs,
      temporalAdvancedWithoutNewObservation: temporal.temporalAdvancedWithoutNewObservation,
      rawWrappedTwistRadians,
      rawUnwrappedTwistRadians: stabilizationResult?.rawUnwrappedTwistRadians ?? null,
      neutralTwistRadians: stabilizationResult?.neutralTwistRadians ?? null,
      neutralInitialized: state.stabilization.neutralInitialized,
      neutralReanchored: observationMode === "valid" && Boolean(stabilizationResult?.neutralReanchored),
      neutralReanchorReason: observationMode === "valid" ? stabilizationResult?.neutralReanchorReason ?? null : null,
      neutralPreservedOnReacquire,
      correctedTwistRadians: stabilizationResult?.correctedTwistRadians ?? null,
      deadZoneOutputRadians: stabilizationResult?.deadZoneOutputRadians ?? null,
      filteredTargetTwistRadians: stabilizationResult?.filteredTargetTwistRadians ?? null,
      clampedTwistRadians: stabilizationResult?.clampedTwistRadians ?? null,
      clampApplied: stabilizationResult?.clampApplied ?? false,
      clampMinRadians: limits.minRadians,
      clampMaxRadians: limits.maxRadians,
      targetInfluenceWeight: state.temporal.acceptedTargetInfluenceWeight,
      temporalInfluenceWeight: effectiveTemporal.influenceWeight,
      trusted: state.previousTrusted,
      temporalTrackingState: effectiveTemporal.trackingState,
      appliedTwistRadians: finalApplied,
      lastAppliedTwistRadians: finalApplied,
      handTwistApplied,
      rejectionReason: rejectionReason ?? (!armChainOutputValid ? "arm-chain-recovery-pending" : temporal.rejectionReason === "none" ? null : temporal.rejectionReason),
      unwrapOwner: "handTwistStabilization",
    };
    this.consumeMatchingResetMarker(state);
    return { output: composed ?? poseLowerDelta, diagnostic };
  }

  reset(): void {
    this.sequence = 0; this.resetArmState(); this.resetHandTrackingState("processor-reset"); this.resetHandSampleClassification(); this.resetFilters(); Object.values(this.loss).forEach((machine) => machine.reset());
  }
  dispose(): void {
    this.rigProfile = null;
    this.sequence = 0; this.resetArmState(); this.resetHandTrackingState("dispose"); this.resetHandSampleClassification(); this.resetFilters(); Object.values(this.loss).forEach((machine) => machine.reset());
  }

  private part(key: keyof AvatarMotionProcessor["loss"], sourceState: AvatarPartTrackingInfo["sourceState"], sampledAtMs: number | null, now: number, freshness: number): AvatarPartTrackingInfo {
    return { sourceState, sampledAtMs, outputState: this.loss[key].update(sourceState, sampledAtMs, now, freshness, this.config.loss.holdMs, this.config.loss.returnMs) };
  }
  private expressionFilter(name: string): OneEuroScalarFilter {
    let filter = this.expressionFilters.get(name);
    if (!filter) { filter = new OneEuroScalarFilter(this.config.filter.expressions, this.config.filter.maxTimestampGapMs); this.expressionFilters.set(name, filter); }
    return filter;
  }
  private updateLengthCalibration(state: ArmTemporalState, lengths: { upper: number; lower: number }): void {
    for (const segment of ["upper", "lower"] as const) {
      const samples = state.lengthSamples[segment]; samples.push(lengths[segment]);
      if (samples.length > this.config.armFrame.calibrationWindowSamples) samples.shift();
      if (samples.length >= this.config.armFrame.calibrationMinimumSamples) {
        const sorted = [...samples].sort((a, b) => a - b); const middle = Math.floor(sorted.length / 2);
        state.calibratedLength[segment] = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
      }
    }
  }
  private directionFilter(name: AvatarJointName): OneEuroVectorFilter {
    let filter = this.directionFilters.get(name);
    if (!filter) {
      const parameters = name.endsWith("Hand") ? this.config.filter.wrist : this.config.filter.arms;
      filter = new OneEuroVectorFilter(parameters, this.config.filter.maxTimestampGapMs); this.directionFilters.set(name, filter);
    }
    return filter;
  }
  private poleFilter(side: ArmSide): OneEuroVectorFilter {
    let filter = this.poleFilters.get(side); if (!filter) { filter = new OneEuroVectorFilter(this.config.filter.pole, this.config.filter.maxTimestampGapMs); this.poleFilters.set(side, filter); } return filter;
  }
  private resetFilters(): void { this.expressionFilters.clear(); this.directionFilters.clear(); this.poleFilters.clear(); }
  private resetArmState(): void {
    for (const side of ["left", "right"] as const) {
      const fresh = createArmTemporalState();
      // Khởi tạo ngay ở tư thế buông tay để lúc chưa có sample nào avatar không đứng T-pose.
      for (const segment of ["upper", "lower"] as const) fresh.segments[segment].currentOutputDelta = this.idlePose?.[side][segment] ?? fresh.segments[segment].currentOutputDelta;
      Object.assign(this.armState[side], fresh); delete this.lastGeometryDiagnostics[side];
      Object.assign(this.armStabilityState[side], createArmStabilityProcessorState());
    }
    this.lastTorso = null; this.diagnostics = null;
  }
  private resetMatchingSide(side: ArmSide): void {
    this.handMatchPrevious[side].wristPosition = null;
    this.handMatchPrevious[side].lastMatchedAtMs = null;
  }
  private resetHandTrackingSide(side: ArmSide, reason: HandTrackingEpochResetReason, nowMs: number | null = null): void {
    const previousEpochId = this.handTwistState[side].trackingEpochId;
    const fresh = createHandTwistProcessorState(previousEpochId + 1, reason);
    fresh.trackingEpochStartedAtMs = nowMs;
    fresh.matchingStateReset = true;
    fresh.matchingStateResetReason = reason;
    Object.assign(this.handTwistState[side], fresh);
    this.resetMatchingSide(side);
  }
  private resetHandTrackingState(reason: HandTrackingEpochResetReason): void {
    this.resetHandTrackingSide("left", reason);
    this.resetHandTrackingSide("right", reason);
  }
  private resetHandSampleClassification(): void { this.lastClassifiedHandSampledAtMs = null; }
  private consumeMatchingResetMarker(state: HandTwistProcessorState): void {
    state.matchingStateReset = false;
    state.matchingStateResetReason = null;
  }
}
