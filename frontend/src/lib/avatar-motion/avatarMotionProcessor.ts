import type { RawTrackingFrameV1 } from "../tracking/rawTrackingTypes";
import type { AvatarPartTrackingInfo, AvatarPosePacketV1 } from "./avatarPoseTypes";
import { quaternionFromRotationMatrix } from "./coordinateAdapter";
import { mapMediaPipeExpressions } from "./expressionMapper";
import { solveParentLocalArmRotations } from "./jointSolver";
import { validateRigProfile, type ControlledArmJoint, type NormalizedAvatarRigProfile } from "./normalizedRigProfile";
import { DEFAULT_AVATAR_MOTION_CONFIG, type AvatarMotionConfig } from "./motionConfig";
import { OneEuroScalarFilter, OneEuroVectorFilter } from "./oneEuroFilter";
import { TrackingLossStateMachine } from "./trackingLoss";

export interface AvatarMotionProcessorOptions { filtered?: boolean; constraints?: boolean; now?: () => number; config?: AvatarMotionConfig }

export class AvatarMotionProcessor {
  private sequence = 0;
  private readonly expressionFilters = new Map<string, OneEuroScalarFilter>();
  private readonly directionFilters = new Map<ControlledArmJoint, OneEuroVectorFilter>();
  private readonly loss = { face: new TrackingLossStateMachine(), leftHand: new TrackingLossStateMachine(), rightHand: new TrackingLossStateMachine(), pose: new TrackingLossStateMachine() };
  private readonly now: () => number; private readonly config: AvatarMotionConfig;
  private filtered: boolean; private constraints: boolean; private rigProfile: NormalizedAvatarRigProfile | null = null;

  constructor(options: AvatarMotionProcessorOptions = {}) { this.now = options.now ?? (() => performance.now()); this.config = options.config ?? DEFAULT_AVATAR_MOTION_CONFIG; this.filtered = options.filtered ?? true; this.constraints = options.constraints ?? true; }
  setFiltered(enabled: boolean): void { if (this.filtered !== enabled) this.resetFilters(); this.filtered = enabled; }
  setConstraints(enabled: boolean): void { this.constraints = enabled; }
  setRigProfile(profile: NormalizedAvatarRigProfile | null): void { if (profile && !validateRigProfile(profile)) throw new Error("Normalized avatar rig profile không hợp lệ."); if (this.rigProfile === profile) return; this.rigProfile = profile; this.resetFilters(); }

  process(frame: RawTrackingFrameV1): AvatarPosePacketV1 {
    const processedTimestampMs = this.now();
    const tracking = {
      face: this.part("face", frame.face.state, frame.face.sampledAtMs, processedTimestampMs, this.config.freshnessMs.face),
      leftHand: this.part("leftHand", frame.leftHand.state, frame.leftHand.sampledAtMs, processedTimestampMs, this.config.freshnessMs.hand),
      rightHand: this.part("rightHand", frame.rightHand.state, frame.rightHand.sampledAtMs, processedTimestampMs, this.config.freshnessMs.hand),
      pose: this.part("pose", frame.pose.state, frame.pose.sampledAtMs, processedTimestampMs, this.config.freshnessMs.pose),
    };
    const semantic = frame.face.blendshapes && tracking.face.outputState === "active" ? mapMediaPipeExpressions(frame.face.blendshapes) : {};
    const expressions = this.filtered && frame.face.sampledAtMs !== null && frame.face.state === "tracked" ? Object.fromEntries(Object.entries(semantic).map(([name, value]) => [name, this.expressionFilter(name).filter(value, frame.face.sampledAtMs!)])) : semantic;
    const headRotation = tracking.face.outputState === "active" && frame.face.facialTransform ? quaternionFromRotationMatrix(frame.face.facialTransform.data) : null;
    const canSolvePose = this.rigProfile && tracking.pose.outputState === "active" && frame.pose.state === "tracked" && frame.pose.sampledAtMs !== null && frame.pose.worldLandmarks;
    const jointRotations = canSolvePose ? solveParentLocalArmRotations(frame.pose.worldLandmarks!, this.rigProfile!, this.constraints, this.filtered ? (name, direction) => this.directionFilter(name).filter(direction, frame.pose.sampledAtMs!) : undefined).deltas : {};
    return { version: 1, sequence: ++this.sequence, sourceFrameTimestampMs: frame.frameTimestampMs, processedTimestampMs, tracking, expressions, headRotation, jointRotations };
  }

  reset(): void { this.sequence = 0; this.resetFilters(); Object.values(this.loss).forEach((machine) => machine.reset()); }
  dispose(): void { this.rigProfile = null; this.reset(); }
  private part(key: keyof AvatarMotionProcessor["loss"], sourceState: AvatarPartTrackingInfo["sourceState"], sampledAtMs: number | null, now: number, freshness: number): AvatarPartTrackingInfo { return { sourceState, sampledAtMs, outputState: this.loss[key].update(sourceState, sampledAtMs, now, freshness, this.config.loss.holdMs, this.config.loss.returnMs) }; }
  private expressionFilter(name: string): OneEuroScalarFilter { let filter = this.expressionFilters.get(name); if (!filter) { filter = new OneEuroScalarFilter(this.config.filter.expressions, this.config.filter.maxTimestampGapMs); this.expressionFilters.set(name, filter); } return filter; }
  private directionFilter(name: ControlledArmJoint): OneEuroVectorFilter { let filter = this.directionFilters.get(name); if (!filter) { const parameters = name.endsWith("LowerArm") ? this.config.filter.wrist : this.config.filter.arms; filter = new OneEuroVectorFilter(parameters, this.config.filter.maxTimestampGapMs); this.directionFilters.set(name, filter); } return filter; }
  private resetFilters(): void { this.expressionFilters.clear(); this.directionFilters.clear(); }
}
