import type { RawTrackingFrameV1 } from "../tracking/rawTrackingTypes";
import { IDENTITY_QUATERNION, type AvatarFingerJointName, type AvatarPartTrackingInfo, type AvatarPosePacketV1, type QuaternionData } from "./avatarPoseTypes";
import type { FingerRigProfile } from "./fingerRig";
import { computeHandFingerFeatures } from "./fingerFeatures";
import { classifyGesture, type GestureClassification, type GesturePoseLabel } from "./gestureClassifier";
import { INITIAL_GESTURE_TEMPORAL_STATE, updateGestureTemporal, type GestureTemporalState } from "./gestureTemporal";
import { planFingerPose } from "./fingerPosePlanner";
import { createFingerPoseTemporalState, updateFingerPoseTemporal, type FingerPoseTemporalState } from "./fingerPoseTemporal";
import { quaternionFromRotationMatrix } from "./coordinateAdapter";
import { mapMediaPipeExpressions } from "./expressionMapper";
import { solveAnatomicalArmFrames, type ArmSpatialEvidence, type GeometryDiagnostic, type HandElbowBranchEvidence } from "./armFrameSolver";
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
import { composePoseLowerArmWithHandTwist, computeAbsoluteRigPalmTwist, HAND_TWIST_RIG_CONVENTION_V1, normalizePalmBasisForTwist } from "./handTwistRig";
import { DEFAULT_HAND_MATCH_CONFIG } from "./handPoseMatching";
import type { HandTwistRigDiagnostic } from "./avatarMotionDiagnostics";
import { INITIAL_HAND_TWIST_STABILIZATION_STATE, resetHandTwistStabilizationKeepingNeutral, updateHandTwistStabilization, type HandTwistStabilizationResult, type HandTwistStabilizationState } from "./handTwistStabilization";
import { createWristEvidenceState, updateWristEvidence, type WristEvidenceOutput, type WristEvidenceState } from "./wristEvidence";
import { estimateShoulderImageToWorldScale, reconstructPointOnSphereFromImage, type WristReconstructionResult } from "./wristReconstruction";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import { buildFaceArmSpatialEvidence } from "./faceArmSpatialEvidence";

export interface AvatarMotionProcessorOptions { filtered?: boolean; constraints?: boolean; handTwistEnabled?: boolean; gestureEnabled?: boolean; now?: () => number; config?: AvatarMotionConfig }

interface HandMotionContext {
  diagnostics: HandMotionDiagnosticsSnapshot;
  matchResult: HandPoseMatchResult;
  palmBasisBySide: Record<ArmSide, HandPalmBasisOutput | null>;
  sampleClassification: HandSampleClassification;
}

interface CachedHandElbowBranchEvidence {
  evidence: HandElbowBranchEvidence;
  imageLandmarks: RawNormalizedLandmarkV1[];
  sampledAtMs: number;
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
  neutralPreservedAcrossEpoch: boolean;
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

interface PreparedArmPoseEvidence {
  worldLandmarks: RawNormalizedLandmarkV1[];
  imageLandmarks: RawNormalizedLandmarkV1[];
  wrist: Record<ArmSide, WristEvidenceOutput>;
  reconstruction: Record<ArmSide, WristReconstructionResult | null>;
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
    neutralPreservedAcrossEpoch: false,
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
    neutralTwistRadians: state.stabilization.neutralInitialized ? state.stabilization.neutralUnwrappedRadians : null,
    neutralInitialized: state.stabilization.neutralInitialized, neutralReanchored: false,
    neutralReanchorReason: null, neutralPreservedAcrossEpoch: state.neutralPreservedAcrossEpoch, neutralPreservedOnReacquire: false,
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
  private gestureEnabled: boolean;
  private rigProfile: NormalizedAvatarRigProfile | null = null;
  private fingerRig: FingerRigProfile | null = null;
  /**
   * Phase 3B.3: những joint ngón đã TỪNG được ghi rotation. Khi tắt gesture hoặc về `rest`, không
   * thể chỉ bỏ key khỏi packet — renderer giữ nguyên rotation cũ của bone khi key biến mất, nên
   * ngón sẽ đóng băng ở tư thế cuối. Phải phát identity một lần cho đúng những joint này.
   */
  private ownedFingerJoints = new Set<AvatarFingerJointName>();
  private pendingFingerClear = false;
  private readonly gestureState: Record<ArmSide, GestureTemporalState> = {
    left: { ...INITIAL_GESTURE_TEMPORAL_STATE }, right: { ...INITIAL_GESTURE_TEMPORAL_STATE },
  };
  private readonly fingerPoseState: Record<ArmSide, FingerPoseTemporalState> = {
    left: createFingerPoseTemporalState(), right: createFingerPoseTemporalState(),
  };
  private readonly lastGesturePose: Record<ArmSide, GesturePoseLabel> = { left: "rest", right: "rest" };
  private readonly armState: Record<ArmSide, ArmTemporalState> = { left: createArmTemporalState(), right: createArmTemporalState() };
  private readonly wristEvidenceState: Record<ArmSide, WristEvidenceState> = { left: createWristEvidenceState(), right: createWristEvidenceState() };
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
  private readonly handElbowBranchEvidence: Record<ArmSide, CachedHandElbowBranchEvidence | null> = { left: null, right: null };
  private readonly handTwistState: Record<ArmSide, HandTwistProcessorState> = { left: createHandTwistProcessorState(), right: createHandTwistProcessorState() };
  private readonly armStabilityState: Record<ArmSide, ArmStabilityProcessorState> = { left: createArmStabilityProcessorState(), right: createArmStabilityProcessorState() };
  private lastClassifiedHandSampledAtMs: number | null = null;

  constructor(options: AvatarMotionProcessorOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.config = options.config ?? DEFAULT_AVATAR_MOTION_CONFIG;
    this.filtered = options.filtered ?? true;
    this.constraints = options.constraints ?? true;
    this.handTwistEnabled = options.handTwistEnabled ?? true;
    // Mặc định TẮT: 3B.3 là tính năng đang nghiệm thu, không được đổi hành vi mặc định của
    // Phase 3B cho tới khi bốn cử chỉ đã qua manual webcam gate.
    this.gestureEnabled = options.gestureEnabled ?? false;
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
      state.neutralPreservedAcrossEpoch = false;
      this.armStabilityState[currentSide].previousHandRawTwistRadians = null;
      this.armStabilityState[currentSide].previousHandAppliedTwistRadians = null;
    }
  }
  /**
   * Bật/tắt toàn bộ pipeline cử chỉ ngón. Tắt phải trả avatar về đúng hành vi Phase 3B: một lần
   * phát identity cho các joint đã sở hữu để nhả ngón, sau đó không ghi khoá ngón nào nữa.
   */
  setGestureEnabled(enabled: boolean): void {
    if (this.gestureEnabled === enabled) return;
    this.gestureEnabled = enabled;
    if (!enabled && this.ownedFingerJoints.size > 0) this.pendingFingerClear = true;
  }
  isGestureEnabled(): boolean { return this.gestureEnabled; }
  /** Rig ngón đến từ model đang tải; đổi model thì phải nhả pose cũ vì chuỗi xương có thể khác. */
  setFingerRig(rig: FingerRigProfile | null): void {
    if (this.fingerRig === rig) return;
    this.fingerRig = rig;
    if (this.ownedFingerJoints.size > 0) this.pendingFingerClear = true;
  }
  getFingerRig(): FingerRigProfile | null { return this.fingerRig; }
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
        if (poseDiscontinuity[side]) {
          // Timestamp discontinuity làm matching/raw unwrap cũ không còn đáng tin, nhưng không
          // đổi rig hoặc mốc neutral của session. Giữ calibration để re-entry không
          // âm thầm lấy tư thế đang chuyển động làm zero mới.
          this.resetHandTrackingSide(side, "tracking-discontinuity", processedTimestampMs, { preserveNeutralCalibration: true });
        }
      }
    }
    const handSampleClassification = this.classifyHandSample(frame);
    if (handSampleClassification === "new-sample" && frame.handSampledAtMs !== null) {
      for (const side of ["left", "right"] as const) {
        const previousHandSample = this.handTwistState[side].lastAcceptedHandSampledAtMs;
        if (previousHandSample !== null && frame.handSampledAtMs <= previousHandSample) {
          this.resetHandTrackingSide(side, "tracking-discontinuity", processedTimestampMs, { preserveNeutralCalibration: true });
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
      const preparedEvidence = frame.pose.worldLandmarks && frame.pose.landmarks
        ? this.prepareArmPoseEvidence(frame, handContext, isNewSample, processedTimestampMs)
        : null;
      const handElbowEvidence = this.currentHandElbowBranchEvidence(frame, processedTimestampMs);
      const solved = isNewSample && preparedEvidence ? solveAnatomicalArmFrames(preparedEvidence.worldLandmarks, preparedEvidence.imageLandmarks, this.rigProfile, {
        left: { previousPole: this.armState.left.previousPole, previousPoleWasFresh: this.armState.left.poleSource === "fresh", previousDepthDegenerate: this.armState.left.depthDegenerate, lastValidPoleAtMs: this.armState.left.lastValidPoleAtMs, previousPrimary: this.armState.left.previousPrimary, previousSecondary: this.armState.left.previousSecondary, calibratedLength: this.armState.left.calibratedLength, previousObservedElbow: this.armState.left.previousObservedElbow, inferenceStartedAtMs: this.armState.left.inferenceStartedAtMs, elbowWasVisible: this.armState.left.elbowWasVisible, wristWasVisible: this.armState.left.wristWasVisible, previousElbowDirection: this.armState.left.previousElbowDirection },
        right: { previousPole: this.armState.right.previousPole, previousPoleWasFresh: this.armState.right.poleSource === "fresh", previousDepthDegenerate: this.armState.right.depthDegenerate, lastValidPoleAtMs: this.armState.right.lastValidPoleAtMs, previousPrimary: this.armState.right.previousPrimary, previousSecondary: this.armState.right.previousSecondary, calibratedLength: this.armState.right.calibratedLength, previousObservedElbow: this.armState.right.previousObservedElbow, inferenceStartedAtMs: this.armState.right.inferenceStartedAtMs, elbowWasVisible: this.armState.right.elbowWasVisible, wristWasVisible: this.armState.right.wristWasVisible, previousElbowDirection: this.armState.right.previousElbowDirection },
      }, processedTimestampMs, this.config.armFrame, this.constraints, this.filtered
        ? (name, direction) => this.directionFilter(name).filter(direction, sampledAtMs!) : undefined,
      this.filtered ? (side, pole) => this.poleFilter(side).filter(pole, sampledAtMs!) : undefined,
      this.lastTorso ?? undefined,
      handElbowEvidence) : null;
      if (solved?.torsoWasObserved) this.lastTorso = solved.torso;
      const torso = solved?.torso ?? this.lastTorso ?? {
        right: this.rigProfile.torsoReference.rightWorld, up: this.rigProfile.torsoReference.upWorld,
        forward: this.rigProfile.torsoReference.forwardWorld, worldRotation: this.rigProfile.torsoReference.worldRotation,
      };
      const torsoSource: TorsoBasisSource = solved?.torsoWasObserved ? "fresh" : this.lastTorso ? "previous" : "rest";
      const armDiagnostics = {} as AvatarMotionDiagnosticSnapshot["arms"];
      for (const side of ["left", "right"] as const) {
        const state = this.armState[side]; const geometry = solved?.sides[side] ?? null;
        const wristEvidence = preparedEvidence?.wrist[side] ?? updateWristEvidence(this.wristEvidenceState[side], {
          nowMs: processedTimestampMs, poseSampledAtMs: frame.pose.sampledAtMs, poseObservationIsNew: false, poseValid: false,
          poseWorld: null, poseImage: null, handObservationIsNew: false, handMatched: false,
          handSampledAtMs: frame.handSampledAtMs, handImage: null,
        }, this.config.wristEvidence);
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
          if (elbowSourceChanged || poleSourceUpgraded || chainTrackingReacquired || wristEvidence.requiresReacquireBlend) { trackingReacquired = true; for (const segment of ["upper", "lower"] as const) { state.segments[segment].lossState = "recovering"; state.segments[segment].recoveryStartedAtMs = null; } }
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
            : updateSegmentTemporalOutput(state.segments[segment], solvedDelta, Boolean(solvedDelta && isNewSample), processedTimestampMs, this.config.loss.holdMs, this.config.loss.returnMs, this.config.loss.recoveryMs, wristEvidence.effectiveGraceMs, this.idlePose?.[side][segment], trackingReacquired);
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
        const twistResult = this.applyHandTwist(side, poseLowerDelta, geometry?.targetWorldRotations[names.lower] ?? this.lastGeometryDiagnostics[side]?.lowerTargetWorld ?? null, handContext, frame, processedTimestampMs, freshLowerGeometryValid, armChainOutputValid, wristEvidence.effectiveGraceMs);
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
            calibratedUpperLength: state.calibratedLength.upper, calibratedLowerLength: state.calibratedLength.lower },
          wristEvidence: {
            source: wristEvidence.source,
            sourceChanged: wristEvidence.sourceChanged,
            effectiveGraceMs: wristEvidence.effectiveGraceMs,
            reconstructionConfidence: preparedEvidence?.reconstruction[side]?.accepted ? preparedEvidence.reconstruction[side]!.confidence : null,
            reconstructionRejectionReason: preparedEvidence?.reconstruction[side]?.rejectionReason ?? null,
          } };
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
    // Phase 3B.3: chạy SAU nhánh arm và chỉ GHI THÊM khoá xương ngón. Không đọc, không sửa, không
    // ghi đè bất kỳ khoá arm nào ở trên — kể cả `leftHand`/`rightHand` (wrist thuộc Phase 3B).
    this.applyFingerGesture(jointRotations, frame, handContext, processedTimestampMs);
    return { version: 1, sequence: ++this.sequence, sourceFrameTimestampMs: frame.frameTimestampMs, processedTimestampMs, tracking, expressions, headRotation, jointRotations, handMotion: handContext.diagnostics };
  }

  /**
   * Mức 2A — Việc 4: rawHands → Hand↔Pose matching → palm basis (candidate đã match) →
   * diagnostic. Đọc `frame.pose.landmarks` CHỈ để lấy wrist image-space làm mục tiêu matching
   * (index 15/16 — cùng convention với `armFrameSolver.ts`). Phase 3B.4 cache thêm palm-forward
   * image-space ngắn hạn cho bước chọn nhánh khuỷu phía sau; hàm này vẫn không trực tiếp tạo hay
   * sửa `jointRotations`.
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
    const matchablePoseWrist = (side: ArmSide, index: number): RawNormalizedLandmarkV1 | null => {
      const point = frame.pose.landmarks?.[index];
      if (!point || point.visibility === null) return null;
      const threshold = this.armState[side].wristWasVisible ? this.config.armFrame.visibilityExit : this.config.armFrame.visibilityEnter;
      const margin = this.config.armFrame.wristOuterBoundsMargin;
      return point.visibility >= threshold && point.x >= -margin && point.x <= 1 + margin && point.y >= -margin && point.y <= 1 + margin
        ? point
        : null;
    };
    const poseWristImage = {
      left: matchablePoseWrist("left", 15),
      right: matchablePoseWrist("right", 16),
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
      const palm = computeHandPalmBasis(candidate.landmarks, candidate.worldLandmarks, candidate.handedness, videoWidth, videoHeight);
      palmBasisBySide[side] = palm;
      if (palm.imageBasis && frame.handSampledAtMs !== null) {
        this.handElbowBranchEvidence[side] = {
          evidence: { forwardImage: palm.imageBasis.forward, geometryQuality: palm.imageGeometryQuality },
          imageLandmarks: candidate.landmarks.map((point) => ({ ...point })),
          sampledAtMs: frame.handSampledAtMs,
        };
      }
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

  private currentHandElbowBranchEvidence(
    frame: RawTrackingFrameV1,
    nowMs: number,
  ): Partial<Record<ArmSide, ArmSpatialEvidence | null>> {
    const output: Partial<Record<ArmSide, ArmSpatialEvidence | null>> = {};
    const width = frame.videoWidth ?? 0, height = frame.videoHeight ?? 0;
    const scale = frame.pose.worldLandmarks && frame.pose.landmarks ? estimateShoulderImageToWorldScale({
      leftShoulderWorld: frame.pose.worldLandmarks[11], rightShoulderWorld: frame.pose.worldLandmarks[12],
      leftShoulderImage: frame.pose.landmarks[11], rightShoulderImage: frame.pose.landmarks[12],
      videoWidth: width, videoHeight: height,
    }) : null;
    const faceFresh = frame.face.state === "tracked" && frame.face.sampledAtMs !== null
      && nowMs - frame.face.sampledAtMs >= 0 && nowMs - frame.face.sampledAtMs <= this.config.freshnessMs.face;
    for (const side of ["left", "right"] as const) {
      const cached = this.handElbowBranchEvidence[side];
      if (!cached) continue;
      const ageMs = nowMs - cached.sampledAtMs;
      const poseDeltaMs = frame.pose.sampledAtMs === null ? Number.POSITIVE_INFINITY : Math.abs(frame.pose.sampledAtMs - cached.sampledAtMs);
      if (ageMs < 0 || ageMs > this.config.wristEvidence.handMaxAgeMs || poseDeltaMs > this.config.wristEvidence.poseHandMaxDeltaMs) continue;
      output[side] = {
        hand: cached.evidence,
        face: faceFresh ? buildFaceArmSpatialEvidence(frame.face.landmarks, cached.imageLandmarks, width, height) : null,
        imageToWorldScale: scale,
        imageAspectRatio: width > 0 && height > 0 ? height / width : 1,
      };
    }
    return output;
  }

  /**
   * Phase 3B.4 — tạo bản sao Pose chỉ khi Hand wrist thật sự được chọn và reconstruct thành
   * công. Raw frame gốc không bị sửa; nếu bất kỳ gate nào thất bại, arm solver nhận đúng Pose
   * ban đầu và temporal layer thực hiện hold/return như trước.
   */
  private prepareArmPoseEvidence(
    frame: RawTrackingFrameV1,
    hand: HandMotionContext,
    poseObservationIsNew: boolean,
    nowMs: number,
  ): PreparedArmPoseEvidence {
    const originalWorld = frame.pose.worldLandmarks!;
    const originalImage = frame.pose.landmarks!;
    let worldLandmarks = originalWorld;
    let imageLandmarks = originalImage;
    const wrist = {} as Record<ArmSide, WristEvidenceOutput>;
    const reconstruction: Record<ArmSide, WristReconstructionResult | null> = { left: null, right: null };
    const videoWidth = frame.videoWidth ?? 0, videoHeight = frame.videoHeight ?? 0;
    const scale = estimateShoulderImageToWorldScale({
      leftShoulderWorld: originalWorld[11], rightShoulderWorld: originalWorld[12],
      leftShoulderImage: originalImage[11], rightShoulderImage: originalImage[12],
      videoWidth, videoHeight,
    });
    const semantic = (point: RawNormalizedLandmarkV1) => ({ x: point.x, y: -point.y, z: -point.z });
    const visible = (point: RawNormalizedLandmarkV1 | undefined, wasVisible: boolean) => Boolean(point && point.visibility !== null && (
      wasVisible ? point.visibility >= this.config.armFrame.visibilityExit : point.visibility >= this.config.armFrame.visibilityEnter
    ));
    const inBounds = (point: RawNormalizedLandmarkV1 | undefined, margin: number) => Boolean(point && point.x >= -margin && point.x <= 1 + margin && point.y >= -margin && point.y <= 1 + margin);
    const shoulderWidthWorld = originalWorld[11] && originalWorld[12]
      ? Math.hypot(originalWorld[11].x - originalWorld[12].x, originalWorld[11].y - originalWorld[12].y, originalWorld[11].z - originalWorld[12].z)
      : 0;

    for (const side of ["left", "right"] as const) {
      const indices = side === "left" ? { shoulder: 11, elbow: 13, wrist: 15 } : { shoulder: 12, elbow: 14, wrist: 16 };
      const poseWristImage = originalImage[indices.wrist] ?? null;
      const poseWristWorld = originalWorld[indices.wrist] ?? null;
      const poseValid = Boolean(
        poseWristWorld && poseWristImage &&
        visible(poseWristImage, this.armState[side].wristWasVisible) &&
        inBounds(poseWristImage, this.config.armFrame.wristOuterBoundsMargin),
      );
      const match = hand.matchResult[side];
      const candidate = hand.sampleClassification === "new-sample" && match.matched && match.candidateArrayIndex !== null
        ? frame.rawHands[match.candidateArrayIndex] ?? null
        : null;
      const handImage = candidate?.landmarks[0] ?? null;
      const selected = updateWristEvidence(this.wristEvidenceState[side], {
        nowMs,
        poseSampledAtMs: frame.pose.sampledAtMs,
        poseObservationIsNew,
        poseValid,
        poseWorld: poseWristWorld,
        poseImage: poseWristImage,
        handObservationIsNew: hand.sampleClassification === "new-sample",
        handMatched: Boolean(match.matched),
        handSampledAtMs: frame.handSampledAtMs,
        handImage,
      }, this.config.wristEvidence);
      wrist[side] = selected;
      if (selected.source !== "hand-image" || !selected.handImage || scale === null || !(shoulderWidthWorld > 0)) continue;

      const shoulderWorldRaw = originalWorld[indices.shoulder], shoulderImage = originalImage[indices.shoulder];
      const elbowWorldRaw = originalWorld[indices.elbow], elbowImage = originalImage[indices.elbow];
      if (!shoulderWorldRaw || !shoulderImage) continue;
      const observedLowerLength = this.armState[side].calibratedLength.lower ?? shoulderWidthWorld * 0.65;
      const observedUpperLength = this.armState[side].calibratedLength.upper ?? shoulderWidthWorld * 0.65;
      const elbowValid = Boolean(elbowWorldRaw && elbowImage && visible(elbowImage, this.armState[side].elbowWasVisible) && inBounds(elbowImage, this.config.armFrame.elbowOuterBoundsMargin));
      let result: WristReconstructionResult | null = null;
      if (elbowValid && this.armState[side].previousPrimary.lower) {
        result = reconstructPointOnSphereFromImage({
          anchorWorld: semantic(elbowWorldRaw!), anchorImage: elbowImage!, targetImage: selected.handImage as RawNormalizedLandmarkV1,
          targetDistance: observedLowerLength, imageToWorldScale: scale,
          previousDirection: this.armState[side].previousPrimary.lower,
          videoWidth, videoHeight, reachSlackRatio: this.config.armFrame.elbowInferenceReachSlackRatio,
        });
      } else if (this.armState[side].previousPrimary.upper && this.armState[side].previousPrimary.lower) {
        const upper = this.armState[side].previousPrimary.upper, lower = this.armState[side].previousPrimary.lower;
        const offset = {
          x: upper.x * observedUpperLength + lower.x * observedLowerLength,
          y: upper.y * observedUpperLength + lower.y * observedLowerLength,
          z: upper.z * observedUpperLength + lower.z * observedLowerLength,
        };
        const distance = Math.hypot(offset.x, offset.y, offset.z);
        result = reconstructPointOnSphereFromImage({
          anchorWorld: semantic(shoulderWorldRaw), anchorImage: shoulderImage, targetImage: selected.handImage as RawNormalizedLandmarkV1,
          targetDistance: distance, imageToWorldScale: scale, previousDirection: offset,
          videoWidth, videoHeight, reachSlackRatio: this.config.armFrame.elbowInferenceReachSlackRatio,
        });
      }
      reconstruction[side] = result;
      if (!result?.accepted || !result.point) continue;
      if (worldLandmarks === originalWorld) worldLandmarks = [...originalWorld];
      if (imageLandmarks === originalImage) imageLandmarks = [...originalImage];
      worldLandmarks[indices.wrist] = { x: result.point.x, y: -result.point.y, z: -result.point.z, visibility: 1 };
      imageLandmarks[indices.wrist] = { x: selected.handImage.x, y: selected.handImage.y, z: selected.handImage.z, visibility: 1 };
    }
    return { worldLandmarks, imageLandmarks, wrist, reconstruction };
  }

  private applyHandTwist(
    side: ArmSide,
    poseLowerDelta: QuaternionData,
    lowerTargetWorldRotation: QuaternionData | null,
    hand: HandMotionContext,
    frame: RawTrackingFrameV1,
    nowMs: number,
    freshLowerGeometryValid: boolean | null,
    armChainOutputValid: boolean,
    geometryGraceMs: number,
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
    const restPalmNormalWorld = this.fingerRig?.[side].restPalmNormalWorld ?? null;
    const forearmAxis = this.armState[side].previousPrimary.lower;
    const referenceDirection = this.armState[side].previousSecondary.lower;
    if (freshLowerGeometryValid === false) {
      if (state.lowerArmGeometryValid !== false) {
        state.lowerArmGeometryValid = false;
        state.lowerArmGeometryInvalidSinceMs = nowMs;
        state.lowerArmGeometryInvalidConfirmed = false;
      } else if (
        state.lowerArmGeometryInvalidSinceMs !== null &&
        nowMs - state.lowerArmGeometryInvalidSinceMs >= geometryGraceMs
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
        // Epoch boundary nằm ở recovery đã xác nhận. Chỉ reset matching/temporal/raw unwrap;
        // mốc neutral calibration của cùng rig phải được giữ, nếu không frame vừa re-entry sẽ
        // biến thành zero mới và làm cùng một tư thế vật lý lệch dần qua các lần hạ/nâng tay.
        this.resetLowerArmTransportHistory(side);
        this.resetHandTrackingSide(side, "invalid-lower-arm-profile-or-geometry", nowMs, { preserveNeutralCalibration: true });
        state.lowerArmGeometryValid = true;
        const diagnostic = inactiveHandTwistDiagnostic(side, this.config, frame.handSampledThisFrame, hand.sampleClassification, state, "invalid-lower-arm-profile-or-geometry");
        this.consumeMatchingResetMarker(state);
        return { output: poseLowerDelta, diagnostic };
      }
    } else if (freshLowerGeometryValid === true) {
      state.lowerArmGeometryValid = true;
    }
    const absoluteRigAvailable = Boolean(profileJoint && forearmAxis && restPalmNormalWorld && lowerTargetWorldRotation);
    if (!profileJoint || !forearmAxis || (!referenceDirection && !absoluteRigAvailable) || state.lowerArmGeometryValid === false) {
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
    let alignmentMode: NonNullable<HandTwistRigDiagnostic["alignmentMode"]> = absoluteRigAvailable ? "rig-absolute" : "session-relative";

    if (isNewHandSample) {
      if (match.matched && palm?.worldBasis) {
        const normalized = normalizePalmBasisForTwist(side, palm.worldBasis);
        chiralityCorrectionApplied = normalized.chiralityCorrectionApplied;
        const twist = computeHandForearmTwist({
          side, forearmAxis, palmBasis: normalized.basis, palmBasisQuality: palm.worldGeometryQuality,
          palmDirectionAxis: HAND_TWIST_RIG_CONVENTION_V1.selectedPalmAxis,
          referenceDirection: referenceDirection ?? normalized.basis.normal, positiveSign: HAND_TWIST_RIG_CONVENTION_V1.configuredPositiveSign[side],
        });
        const absoluteTwist = absoluteRigAvailable ? computeAbsoluteRigPalmTwist({
          forearmAxisWorld: forearmAxis!, observedPalmNormalWorld: normalized.basis.normal,
          restPalmNormalWorld: restPalmNormalWorld!, lowerRestWorldRotation: profileJoint.restWorldRotation,
          lowerTargetWorldRotation: lowerTargetWorldRotation!,
        }) : null;
        alignmentMode = absoluteTwist?.accepted ? "rig-absolute" : "session-relative";
        rawWrappedTwistRadians = absoluteTwist?.accepted ? absoluteTwist.twistRadians : twist.twistRadians;
        const confidence = computeHandTwistConfidence({
          handMatched: match.matched, twistAccepted: absoluteTwist?.accepted ?? twist.accepted,
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
        rejectionReason = (absoluteTwist && !absoluteTwist.accepted ? absoluteTwist.rejectionReason : twist.rejectionReason) ?? confidence.rejectionReason;
        if (trusted && rawWrappedTwistRadians !== null) {
          const observationDtSeconds = state.lastAcceptedObservationAtMs === null ? 1 / 60 : Math.max(1 / 240, (nowMs - state.lastAcceptedObservationAtMs) / 1000);
          const limits = this.config.handTwist.correctionLimits[side];
          const nextStabilization = updateHandTwistStabilization(state.stabilization, {
            rawWrappedTwistRadians, nowMs, dtSeconds: observationDtSeconds,
            // Short reacquire giữ neutral cũ. Reset/discontinuity/model/profile đã xóa state trước khi tới đây.
            reanchorNeutral: false, reanchorReason: state.pendingNeutralReanchorReason,
            ...(alignmentMode === "rig-absolute" ? { neutralOverrideRadians: 0 } : {}),
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
            if (nextStabilization.neutralReanchored) {
              state.neutralAnchoredForEpochId = state.trackingEpochId;
              state.neutralPreservedAcrossEpoch = false;
            }
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
      this.resetHandTrackingSide(side, "long-loss-temporal-reset", nowMs, { preserveNeutralCalibration: true });
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
      alignmentMode,
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
      neutralPreservedAcrossEpoch: state.neutralPreservedAcrossEpoch,
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
      Object.assign(this.wristEvidenceState[side], createWristEvidenceState());
      Object.assign(this.armStabilityState[side], createArmStabilityProcessorState());
    }
    this.lastTorso = null; this.diagnostics = null;
  }
  private resetMatchingSide(side: ArmSide): void {
    this.handMatchPrevious[side].wristPosition = null;
    this.handMatchPrevious[side].lastMatchedAtMs = null;
    this.handElbowBranchEvidence[side] = null;
  }
  private resetHandTrackingSide(
    side: ArmSide,
    reason: HandTrackingEpochResetReason,
    nowMs: number | null = null,
    options: { preserveNeutralCalibration?: boolean } = {},
  ): void {
    const previous = this.handTwistState[side];
    const previousEpochId = previous.trackingEpochId;
    const fresh = createHandTwistProcessorState(previousEpochId + 1, reason);
    if (options.preserveNeutralCalibration && previous.stabilization.neutralInitialized) {
      fresh.stabilization = resetHandTwistStabilizationKeepingNeutral(previous.stabilization);
      // `neutralAnchoredForEpochId` giữ epoch gốc của calibration; diagnostic riêng cho biết
      // nó được carry sang epoch mới, tránh hiểu nhầm đây là một re-anchor từ frame re-entry.
      fresh.neutralAnchoredForEpochId = previous.neutralAnchoredForEpochId;
      fresh.neutralPreservedAcrossEpoch = fresh.stabilization.neutralInitialized;
      fresh.pendingNeutralReanchorReason = "none";
    }
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
  /** Chỉ gọi sau confirmed lower-arm geometry loss, không áp vào Hand-only loss để tránh Pose snap. */
  private resetLowerArmTransportHistory(side: ArmSide): void {
    this.armState[side].previousPrimary.lower = null;
    this.armState[side].previousSecondary.lower = null;
  }
  /**
   * Phase 3B.3 — điểm nối duy nhất của pipeline cử chỉ vào packet.
   *
   * Bước 0 mới chỉ dựng đường ống và cơ chế nhả pose; classifier/preset được nối ở các bước sau.
   * Bất biến phải giữ qua mọi bước tiếp theo: hàm này CHỈ được ghi khoá xương ngón, và khi tắt
   * thì packet phải không còn khoá ngón nào (sau đúng một frame phát identity để nhả).
   */
  private applyFingerGesture(
    jointRotations: AvatarPosePacketV1["jointRotations"],
    frame: RawTrackingFrameV1,
    hand: HandMotionContext,
    nowMs: number,
  ): void {
    if (this.pendingFingerClear) {
      for (const joint of this.ownedFingerJoints) jointRotations[joint] = IDENTITY_QUATERNION;
      this.ownedFingerJoints.clear();
      this.pendingFingerClear = false;
      for (const side of ["left", "right"] as const) {
        this.gestureState[side] = { ...INITIAL_GESTURE_TEMPORAL_STATE };
        this.fingerPoseState[side] = createFingerPoseTemporalState();
      }
      return;
    }
    if (!this.gestureEnabled || !this.fingerRig) return;

    for (const side of ["left", "right"] as const) {
      const rig = side === "left" ? this.fingerRig.left : this.fingerRig.right;
      if (rig.controllableSegmentCount === 0) continue;

      // Chỉ sample MỚI mới sinh quan sát. Sample trùng đi vào nhánh classification=null để temporal
      // không coi nó là bằng chứng mới — đây là điều kiện giữ bất biến FPS.
      const match = hand.matchResult[side];
      const palm = hand.palmBasisBySide[side];
      const isNewSample = hand.sampleClassification === "new-sample";
      const candidate = isNewSample && match.matched && match.candidateArrayIndex !== null
        ? frame.rawHands[match.candidateArrayIndex] ?? null
        : null;

      let classification: GestureClassification | null = null;
      if (candidate) {
        // Truyền cả image landmark + kích thước video: hướng ngón cái của `thumbsUp` phải đo
        // trong không gian ẢNH ("lên" theo người xem), không phải world/palm-local — xoay cổ tay
        // 180° trong palm-local sẽ biến thumbsUp thành thumbsDown mà giá trị đo không đổi.
        const features = computeHandFingerFeatures(candidate.worldLandmarks, undefined, {
          landmarks: candidate.landmarks,
          videoWidth: frame.videoWidth ?? 0,
          videoHeight: frame.videoHeight ?? 0,
        });
        classification = classifyGesture({
          features,
          // Dùng chất lượng palm basis đã có sẵn từ Phase 3B làm cổng quan sát tối thiểu. Gate đa
          // tiêu chí đầy đủ (§3.1) thuộc bước hoàn thiện; ở đây chỉ cần đủ để loại hình học hỏng.
          observabilityQuality: palm?.worldGeometryQuality ?? 0,
          // Hysteresis hướng ngón cái: nhãn đang phát quyết định dùng ngưỡng vào hay ngưỡng nhả.
          activePose: this.gestureState[side].activePose,
        }, this.config.gesture.classifier);
      }

      const temporal = updateGestureTemporal(this.gestureState[side], {
        classification,
        // `matched` phản ánh bàn tay có được gán cho side này không. Không match trong khi vẫn còn
        // trong thời gian ân hạn thì temporal tự giữ nhãn; quá hạn mới về rest.
        handPresent: match.matched,
        observationAtMs: candidate ? candidate.sampledAtMs : null,
        nowMs,
      }, this.config.gesture.temporal);
      this.gestureState[side] = temporal.state;
      this.lastGesturePose[side] = temporal.pose;

      // `rest` nghĩa là không điều khiển ngón: plan rỗng để temporal blend mọi joint về identity
      // rồi nhả quyền sở hữu, thay vì giữ một tư thế "duỗi thẳng" cứng.
      const plan = temporal.pose === "rest" ? {} : planFingerPose(rig, temporal.pose);
      const blended = updateFingerPoseTemporal(this.fingerPoseState[side], plan, nowMs, this.config.gesture.pose);
      this.fingerPoseState[side] = blended.state;

      for (const [joint, rotation] of Object.entries(blended.output) as Array<[AvatarFingerJointName, QuaternionData]>) {
        jointRotations[joint] = rotation;
        this.ownedFingerJoints.add(joint);
      }
      // Joint đã blend xong về identity thì temporal đã nhả; bỏ khỏi tập sở hữu để lần tắt tính
      // năng sau không phát identity thừa cho chúng.
      //
      // Chỉ xét joint CỦA CHÍNH SIDE NÀY. `ownedFingerJoints` chứa cả hai tay, còn
      // `blended.state.current` chỉ có tay đang xử lý — quét toàn bộ tập sẽ xoá nhầm joint của
      // tay kia ở mỗi lượt và cuối vòng lặp không còn joint nào để clear khi tắt tính năng.
      const sidePrefix = side === "left" ? "left" : "right";
      for (const joint of [...this.ownedFingerJoints]) {
        if (!joint.startsWith(sidePrefix)) continue;
        if (!blended.state.current.has(joint)) this.ownedFingerJoints.delete(joint);
      }
    }
  }
  /** Nhãn cử chỉ đang phát mỗi bên — DEV panel/diagnostic, không tham gia tính rotation. */
  getGesturePoses(): Record<ArmSide, GesturePoseLabel> { return { ...this.lastGesturePose }; }
  private resetHandSampleClassification(): void { this.lastClassifiedHandSampledAtMs = null; }
  private consumeMatchingResetMarker(state: HandTwistProcessorState): void {
    state.matchingStateReset = false;
    state.matchingStateResetReason = null;
  }
}
