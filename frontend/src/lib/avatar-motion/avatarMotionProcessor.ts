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
import type { ArmSide, AvatarMotionDiagnosticSnapshot, MotionSampleDisposition, TorsoBasisSource } from "./avatarMotionDiagnostics";
import type { TorsoBasis } from "./torsoBasis";

export interface AvatarMotionProcessorOptions { filtered?: boolean; constraints?: boolean; now?: () => number; config?: AvatarMotionConfig }

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
  private rigProfile: NormalizedAvatarRigProfile | null = null;
  private readonly armState: Record<ArmSide, ArmTemporalState> = { left: createArmTemporalState(), right: createArmTemporalState() };
  private readonly lastGeometryDiagnostics: Partial<Record<ArmSide, GeometryDiagnostic>> = {};
  private lastTorso: TorsoBasis | null = null;
  private diagnostics: AvatarMotionDiagnosticSnapshot | null = null;

  constructor(options: AvatarMotionProcessorOptions = {}) {
    this.now = options.now ?? (() => performance.now());
    this.config = options.config ?? DEFAULT_AVATAR_MOTION_CONFIG;
    this.filtered = options.filtered ?? true;
    this.constraints = options.constraints ?? true;
  }

  setFiltered(enabled: boolean): void { if (this.filtered !== enabled) this.resetFilters(); this.filtered = enabled; }
  setConstraints(enabled: boolean): void { this.constraints = enabled; }
  setRigProfile(profile: NormalizedAvatarRigProfile | null): void {
    if (profile && !validateRigProfile(profile)) throw new Error("Normalized avatar rig profile không hợp lệ.");
    if (this.rigProfile === profile) return; this.rigProfile = profile; this.resetArmState(); this.resetFilters();
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
    let jointRotations: AvatarPosePacketV1["jointRotations"] = {};
    if (this.rigProfile) {
      const sampledAtMs = frame.pose.sampledAtMs;
      const isTrackedDuplicate = canUpdateDirections && (["left", "right"] as const).every((side) => this.armState[side].lastConsumedPoseSampledAtMs === sampledAtMs);
      const isNewSample = tracking.pose.outputState === "active" && canUpdateDirections && !isTrackedDuplicate;
      const sampleDisposition: MotionSampleDisposition = isNewSample ? "new" : isTrackedDuplicate ? "duplicate-timestamp" : frame.pose.state === "lost" ? "lost" : "not-sampled";
      if (sampledAtMs !== null && isNewSample) for (const side of ["left", "right"] as const) {
        const previous = this.armState[side].lastConsumedPoseSampledAtMs;
        if (previous !== null && (sampledAtMs <= previous || sampledAtMs - previous > this.config.armFrame.longGapDiscontinuityMs)) Object.assign(this.armState[side], createArmTemporalState());
      }
      const solved = isNewSample && frame.pose.worldLandmarks && frame.pose.landmarks ? solveAnatomicalArmFrames(frame.pose.worldLandmarks, frame.pose.landmarks, this.rigProfile, {
        left: { previousPole: this.armState.left.previousPole, previousPoleWasFresh: this.armState.left.poleSource === "fresh", previousDepthDegenerate: this.armState.left.depthDegenerate, lastValidPoleAtMs: this.armState.left.lastValidPoleAtMs, previousPrimary: this.armState.left.previousPrimary, previousSecondary: this.armState.left.previousSecondary, calibratedLength: this.armState.left.calibratedLength, previousObservedElbow: this.armState.left.previousObservedElbow, inferenceStartedAtMs: this.armState.left.inferenceStartedAtMs },
        right: { previousPole: this.armState.right.previousPole, previousPoleWasFresh: this.armState.right.poleSource === "fresh", previousDepthDegenerate: this.armState.right.depthDegenerate, lastValidPoleAtMs: this.armState.right.lastValidPoleAtMs, previousPrimary: this.armState.right.previousPrimary, previousSecondary: this.armState.right.previousSecondary, calibratedLength: this.armState.right.calibratedLength, previousObservedElbow: this.armState.right.previousObservedElbow, inferenceStartedAtMs: this.armState.right.inferenceStartedAtMs },
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
        if (isNewSample) state.lastConsumedPoseSampledAtMs = sampledAtMs;
        if (isNewSample && !geometry) { state.invalidCandidateStartedAtMs ??= processedTimestampMs; state.validCandidateStartedAtMs = null; }
        if (geometry) { state.invalidCandidateStartedAtMs = null; state.validCandidateStartedAtMs ??= processedTimestampMs; state.depthDegenerate = geometry.depthDegenerate; }
        const confirmationElapsed = state.validCandidateStartedAtMs === null ? 0 : processedTimestampMs - state.validCandidateStartedAtMs;
        const geometryConfirmed = Boolean(geometry && (state.lossState === "active" || state.lastValidOutput === null || confirmationElapsed >= this.config.armFrame.validRecoveryConfirmMs));
        if (geometry?.acceptedFreshPole) { state.previousPole = geometry.acceptedPole; state.lastValidPoleAtMs = processedTimestampMs; }
        if (geometry) state.poleSource = geometry.poleSource;
        if (geometry) {
          if (state.elbowSource !== "unavailable" && state.elbowSource !== geometry.elbowSource) for (const segment of ["upper", "lower"] as const) { state.segments[segment].lossState = "recovering"; state.segments[segment].recoveryStartedAtMs = null; }
          state.elbowSource = geometry.elbowSource;
          state.previousPrimary = geometry.primary; state.previousSecondary = geometry.secondary;
          if (geometry.elbowSource === "observed") { state.previousObservedElbow = geometry.elbowPosition; state.inferenceStartedAtMs = null; if (geometry.observedLengths) this.updateLengthCalibration(state, geometry.observedLengths); }
          else state.inferenceStartedAtMs ??= processedTimestampMs;
        } else if (solved?.diagnostics[side].hardRejectionReason?.startsWith("elbow-inference")) state.inferenceStartedAtMs ??= processedTimestampMs;
        const names = side === "left" ? { upper: "leftUpperArm" as const, lower: "leftLowerArm" as const } : { upper: "rightUpperArm" as const, lower: "rightLowerArm" as const };
        const segmentTemporal = {} as Record<"upper" | "lower", { output: QuaternionData; state: ArmLossState; progress: number }>;
        for (const segment of ["upper", "lower"] as const) {
          const name = names[segment]; const solvedDelta = geometryConfirmed && geometry?.segmentValidity[segment] ? geometry.deltas[name] ?? null : null;
          segmentTemporal[segment] = isTrackedDuplicate
            ? { output: state.segments[segment].currentOutputDelta, state: state.segments[segment].lossState, progress: this.diagnostics?.arms[side].transitionProgress ?? 1 }
            : updateSegmentTemporalOutput(state.segments[segment], solvedDelta, Boolean(solvedDelta && isNewSample), processedTimestampMs, this.config.loss.holdMs, this.config.loss.returnMs, this.config.loss.recoveryMs, this.config.armFrame.invalidGraceMs);
          jointRotations[name] = segmentTemporal[segment].output;
        }
        const temporalState = segmentTemporal.lower.state === "active" ? segmentTemporal.upper.state : segmentTemporal.lower.state;
        const temporalProgress = Math.min(segmentTemporal.upper.progress, segmentTemporal.lower.progress);
        if (solved?.diagnostics[side]) this.lastGeometryDiagnostics[side] = solved.diagnostics[side];
        const base = this.lastGeometryDiagnostics[side] ?? { side, pole: state.previousPole, poleSource: state.poleSource, elbowOffsetMagnitude: null, normalizedElbowOffset: null, planeNormal: null, upperTargetWorld: null, lowerTargetWorld: null, armValidity: "rejected" as const, hardRejectionReason: "no-sampled-pose", confidenceFlags: [], imageBounds: { shoulder: null, elbow: null, wrist: null }, upperSegmentLength: null, lowerSegmentLength: null, segmentRatio: null, depthAlignment: null, candidatePole: null, filteredPole: null, projectedPole: null, poleAngularVelocity: null,
          observation: { upperDirectionValid: false, lowerDirectionValid: false, poleValid: false, twistObservable: false, upperRejectionReason: "no-sampled-pose", lowerRejectionReason: "no-sampled-pose", poleRejectionReason: "no-sampled-pose" },
          elbowInference: { source: "unavailable" as const, confidence: 0, durationMs: 0, inferredPosition: null, calibratedUpperLength: state.calibratedLength.upper, calibratedLowerLength: state.calibratedLength.lower, shoulderWristDistance: null, reachRatio: null, distanceFromPreviousElbow: null } };
        armDiagnostics[side] = { ...base, lossState: temporalState, transitionProgress: temporalProgress,
          invalidDurationMs: state.invalidCandidateStartedAtMs === null ? 0 : processedTimestampMs - state.invalidCandidateStartedAtMs,
          validRecoveryDurationMs: state.validCandidateStartedAtMs === null ? 0 : processedTimestampMs - state.validCandidateStartedAtMs,
          sampleDisposition, segmentLossState: { upper: segmentTemporal.upper.state, lower: segmentTemporal.lower.state },
          elbowInference: { ...base.elbowInference,
            source: geometry?.elbowSource ?? (temporalState === "held" ? "held" : temporalState === "returning" ? "returning" : "unavailable"),
            durationMs: state.inferenceStartedAtMs === null ? 0 : processedTimestampMs - state.inferenceStartedAtMs,
            calibratedUpperLength: state.calibratedLength.upper, calibratedLowerLength: state.calibratedLength.lower } };
      }
      this.diagnostics = { version: 1, processedAtMs: processedTimestampMs, torso: { right: torso.right, up: torso.up, forward: torso.forward, source: torsoSource }, arms: armDiagnostics, headRotationSemantic: "legacy-unverified" };
    } else this.diagnostics = null;
    return { version: 1, sequence: ++this.sequence, sourceFrameTimestampMs: frame.frameTimestampMs, processedTimestampMs, tracking, expressions, headRotation, jointRotations };
  }

  reset(): void {
    this.sequence = 0; this.resetArmState(); this.resetFilters(); Object.values(this.loss).forEach((machine) => machine.reset());
  }
  dispose(): void { this.rigProfile = null; this.reset(); }

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
  private resetArmState(): void { for (const side of ["left", "right"] as const) { Object.assign(this.armState[side], createArmTemporalState()); delete this.lastGeometryDiagnostics[side]; } this.lastTorso = null; this.diagnostics = null; }
}
