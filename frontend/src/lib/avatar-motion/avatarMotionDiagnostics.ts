import type { QuaternionData, Vector3Data } from "./avatarPoseTypes";

export type ArmSide = "left" | "right";
export type PoleSource = "fresh" | "previous" | "rest" | "unavailable";
export type MotionSampleDisposition = "new" | "duplicate-timestamp" | "not-sampled" | "lost";
export type TorsoBasisSource = "fresh" | "previous" | "rest";
export type ElbowSource = "observed" | "inferred-history" | "inferred-rest-prior" | "held" | "returning" | "unavailable";

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
  /** headRotation vẫn là legacy/unverified; không thuộc acceptance arm Phase 3A. */
  headRotationSemantic: "legacy-unverified";
}
