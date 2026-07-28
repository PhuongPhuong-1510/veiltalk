import type { AvatarOutputMotionState, QuaternionData, Vector3Data } from "./avatarPoseTypes";
import type { HandMatchContinuity } from "./handPoseMatching";

export type ArmSide = "left" | "right";
export type PoleSource = "fresh" | "hand" | "previous" | "rest" | "unavailable";
export type MotionSampleDisposition = "new" | "duplicate-timestamp" | "not-sampled" | "lost";
export type TorsoBasisSource = "fresh" | "previous" | "rest";
export type ElbowSource = "observed" | "inferred-history" | "inferred-rest-prior" | "held" | "returning" | "unavailable";
export type HandSampleClassification = "unsampled" | "duplicate" | "new-sample";
export type HandTrackingEpochResetReason =
  | "processor-initialization"
  | "processor-reset"
  | "dispose"
  | "rig-profile-change"
  | "tracking-discontinuity"
  | "invalid-lower-arm-profile-or-geometry"
  | "long-loss-temporal-reset"
  | "matching-state-reset";

export interface HandTwistRigDiagnostic {
  selectedPalmAxis: "normal";
  chiralityCorrectionApplied: boolean;
  configuredPositiveSign: 1;
  rigApplicationSign: 1 | -1;
  handSampledThisFrame: boolean;
  sampleClassification: HandSampleClassification;
  matchingContinuity: HandMatchContinuity | "not-evaluated";
  trackingEpochId: number;
  trackingEpochStartedAtMs: number | null;
  trackingEpochResetReason: HandTrackingEpochResetReason;
  matchingStateReset: boolean;
  matchingStateResetReason: HandTrackingEpochResetReason | null;
  neutralAnchoredForEpochId: number | null;
  observationMode: "unsampled" | "duplicate" | "valid" | "missing";
  observationWasNew: boolean;
  duplicateTimestampIgnored: boolean;
  missingSinceMs: number | null;
  missingDurationMs: number;
  temporalAdvancedWithoutNewObservation: boolean;
  rawWrappedTwistRadians: number | null;
  rawUnwrappedTwistRadians: number | null;
  neutralTwistRadians: number | null;
  neutralInitialized: boolean;
  neutralReanchored: boolean;
  neutralReanchorReason: string | null;
  neutralPreservedOnReacquire: boolean;
  correctedTwistRadians: number | null;
  deadZoneOutputRadians: number | null;
  filteredTargetTwistRadians: number | null;
  clampedTwistRadians: number | null;
  clampApplied: boolean;
  clampMinRadians: number;
  clampMaxRadians: number;
  /** Target cuối temporal đã chấp nhận; không phải quality của observation bị reject ở frame hiện tại. */
  targetInfluenceWeight: number;
  temporalInfluenceWeight: number;
  trusted: boolean;
  temporalTrackingState: "inactive" | "acquiring" | "tracking" | "holding" | "fading";
  appliedTwistRadians: number;
  /** Derived output (`temporal angle × temporal influence`), never a second control state. */
  lastAppliedTwistRadians: number;
  handTwistApplied: boolean;
  rejectionReason: string | null;
  unwrapOwner: "handTwistStabilization";
}

/** 2B-5D: snapshot chẩn đoán, không tham gia quyết định motion và được dev harness poll 400 ms. */
export interface ArmStabilityDiagnostic {
  poseUpperTargetAngularDeltaRadians: number | null;
  poseLowerTargetAngularDeltaRadians: number | null;
  poseUpperAppliedAngularDeltaRadians: number | null;
  poseLowerAppliedAngularDeltaRadians: number | null;
  elbowSource: ElbowSource;
  elbowSourceChanged: boolean;
  poleSource: PoleSource;
  poleQuality: number | null;
  poleBranchChanged: boolean;
  poseConfidence: number | null;
  poseTrackingState: AvatarOutputMotionState;
  handRawTwistDeltaRadians: number | null;
  handAppliedTwistDeltaRadians: number | null;
  trusted: boolean;
  targetInfluenceWeight: number;
  temporalInfluenceWeight: number;
  neutralReanchored: boolean;
  observationMode: HandTwistRigDiagnostic["observationMode"];
  frameDtMs: number | null;
  poseSampleAgeMs: number | null;
  handSampleAgeMs: number | null;
}

export interface ArmFrameDiagnostic {
  side: ArmSide;
  pole: Vector3Data | null;
  poleSource: PoleSource;
  elbowOffsetMagnitude: number | null;
  planeNormal: Vector3Data | null;
  upperTargetWorld: QuaternionData | null;
  lowerTargetWorld: QuaternionData | null;
  lossState: "idle" | "active" | "held" | "returning" | "recovering";
  transitionProgress: number;
  armValidity: "accepted" | "rejected";
  hardRejectionReason: string | null;
  confidenceFlags: string[];
  imageBounds: { shoulder: Vector3Data | null; elbow: Vector3Data | null; wrist: Vector3Data | null };
  upperSegmentLength: number | null;
  lowerSegmentLength: number | null;
  segmentRatio: number | null;
  normalizedElbowOffset: number | null;
  depthAlignment: number | null;
  candidatePole: Vector3Data | null;
  filteredPole: Vector3Data | null;
  projectedPole: Vector3Data | null;
  poleAngularVelocity: number | null;
  /**
   * A1 (chẩn đoán trước khi đổi logic, theo tư vấn chuyên gia): độ tin cậy liên tục của pole
   * quan sát, tách theo từng nguồn suy biến — để biết pole yếu vì hướng camera hay vì tay
   * duỗi thẳng hay vì landmark kém, trước khi quyết định cách blend ở các bước sau.
   */
  depthQuality: number | null;
  bendPlaneQuality: number | null;
  elbowBendDegrees: number | null;
  /**
   * A5-diag: lý do handPalmPole() không dùng được, để phân biệt "chưa thử vì elbow-offset đã
   * đủ" với "đã thử nhưng index/pinky bị che" — hai tình huống dễ nhầm khi chỉ nhìn poleSource.
   */
  handPoleRejectionReason: "not-attempted" | "missing-index" | "missing-pinky" | "low-index-visibility" | "low-pinky-visibility" | "degenerate-geometry" | null;
  /**
   * Mức 1B-3 (theo tư vấn chuyên gia): góc lệch OUTPUT thực tế giữa frame này và frame trước
   * — đo trên giá trị đã qua `updateSegmentTemporalOutput` (kể cả hemisphere continuity và
   * reacquire blend), không phải trên `deltas` thô của solver. Đây là con số phản ánh đúng
   * những gì renderer thực sự nhận được mỗi frame, dùng để phát hiện residual spike sau khi
   * đã áp Việc 1+2, hoặc để log khi điều tra giật trong tương lai.
   */
  upperArmAngularDeltaDeg: number | null;
  lowerArmAngularDeltaDeg: number | null;
  poleAngularDeltaDeg: number | null;
  /** true đúng frame mà poleSource đổi so với frame trước (bất kể hướng nâng/hạ cấp). */
  poleSourceChanged: boolean;
  /** true đúng frame mà reacquire blend (Việc 2) được kích hoạt do đổi nguồn hình học. */
  trackingReacquired: boolean;
  invalidDurationMs: number;
  validRecoveryDurationMs: number;
  /** Geometry belongs to the most recent sampled pose; temporal state may continue on a missing sample. */
  sampleDisposition: MotionSampleDisposition;
  observation: {
    upperDirectionValid: boolean;
    lowerDirectionValid: boolean;
    poleValid: boolean;
    twistObservable: boolean;
    upperRejectionReason: string | null;
    lowerRejectionReason: string | null;
    poleRejectionReason: string | null;
  };
  segmentLossState: { upper: ArmFrameDiagnostic["lossState"]; lower: ArmFrameDiagnostic["lossState"] };
  elbowInference: {
    source: ElbowSource; confidence: number; durationMs: number; inferredPosition: Vector3Data | null;
    calibratedUpperLength: number | null; calibratedLowerLength: number | null;
    shoulderWristDistance: number | null; reachRatio: number | null; distanceFromPreviousElbow: number | null;
  };
}

export interface AvatarMotionDiagnosticSnapshot {
  version: 1;
  processedAtMs: number;
  torso: { right: Vector3Data; up: Vector3Data; forward: Vector3Data; source: TorsoBasisSource };
  arms: Record<ArmSide, ArmFrameDiagnostic>;
  handTwist: Record<ArmSide, HandTwistRigDiagnostic>;
  armStability: Record<ArmSide, ArmStabilityDiagnostic>;
  /** headRotation vẫn là legacy/unverified; không thuộc acceptance arm Phase 3A. */
  headRotationSemantic: "legacy-unverified";
}
