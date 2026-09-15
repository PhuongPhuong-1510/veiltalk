import type { AvatarOutputMotionState, QuaternionData } from "./avatarPoseTypes";
import { IDENTITY_QUATERNION } from "./avatarPoseTypes";
import type { OneEuroParameters } from "./motionConfig";
import { OneEuroVectorFilter } from "./oneEuroFilter";
import { quaternionExp, quaternionLog } from "./quaternionDistribution";
import { slerpQuaternionData } from "./motionMath";

export interface UpperBodyTemporalConfig {
  filter: OneEuroParameters;
  maximumTimestampGapMs: number;
  holdMs: number;
  returnMs: number;
  reacquireMs: number;
}

export interface UpperBodyTemporalOutput {
  rotation: QuaternionData;
  state: AvatarOutputMotionState | "reacquiring";
  progress: number;
  sampleDisposition: "new" | "duplicate" | "reversed" | "missing";
}

export class UpperBodyQuaternionTemporal {
  private readonly filter: OneEuroVectorFilter;
  private lastSampledAtMs: number | null = null;
  private lastValidAtMs: number | null = null;
  private lastValid = IDENTITY_QUATERNION;
  private output = IDENTITY_QUATERNION;
  private state: UpperBodyTemporalOutput["state"] = "idle";
  private reacquireOrigin: QuaternionData | null = null;
  private reacquireStartedAtMs: number | null = null;
  private readonly config: UpperBodyTemporalConfig;

  constructor(config: UpperBodyTemporalConfig) {
    this.config = config;
    this.filter = new OneEuroVectorFilter(config.filter, config.maximumTimestampGapMs);
  }

  update(observation: QuaternionData | null, sampledAtMs: number | null, nowMs: number, filtered = true): UpperBodyTemporalOutput {
    if (observation && sampledAtMs !== null) {
      if (this.lastSampledAtMs !== null && sampledAtMs <= this.lastSampledAtMs) {
        return this.current(sampledAtMs === this.lastSampledAtMs ? "duplicate" : "reversed");
      }
      const vector = quaternionLog(observation);
      if (vector) {
        const hadLoss = this.state === "held" || this.state === "returning" || this.state === "idle";
        const next = filtered ? quaternionExp(this.filter.filter(vector, sampledAtMs))! : observation;
        if (hadLoss && this.lastValidAtMs !== null) {
          this.reacquireOrigin = this.output; this.reacquireStartedAtMs = nowMs; this.state = "reacquiring";
        }
        this.lastSampledAtMs = sampledAtMs; this.lastValidAtMs = nowMs; this.lastValid = next;
        if (this.reacquireStartedAtMs !== null && this.reacquireOrigin) {
          const progress = Math.min(1, (nowMs - this.reacquireStartedAtMs) / Math.max(1, this.config.reacquireMs));
          this.output = slerpQuaternionData(this.reacquireOrigin, next, progress);
          if (progress < 1) return { rotation: this.output, state: "reacquiring", progress, sampleDisposition: "new" };
          this.reacquireOrigin = null; this.reacquireStartedAtMs = null;
        } else this.output = next;
        this.state = "active";
        return { rotation: this.output, state: "active", progress: 1, sampleDisposition: "new" };
      }
    }
    if (this.lastValidAtMs !== null) {
      const elapsed = Math.max(0, nowMs - this.lastValidAtMs);
      if (elapsed <= this.config.holdMs) { this.state = "held"; this.output = this.lastValid; return this.current("missing", elapsed / Math.max(1, this.config.holdMs)); }
      const returnElapsed = elapsed - this.config.holdMs;
      if (returnElapsed < this.config.returnMs) {
        const progress = returnElapsed / Math.max(1, this.config.returnMs);
        this.state = "returning"; this.output = slerpQuaternionData(this.lastValid, IDENTITY_QUATERNION, progress);
        return this.current("missing", progress);
      }
    }
    this.state = "idle"; this.output = IDENTITY_QUATERNION;
    return this.current("missing", 1);
  }

  reset(): void {
    this.filter.reset(); this.lastSampledAtMs = null; this.lastValidAtMs = null; this.lastValid = IDENTITY_QUATERNION;
    this.output = IDENTITY_QUATERNION; this.state = "idle"; this.reacquireOrigin = null; this.reacquireStartedAtMs = null;
  }

  private current(sampleDisposition: UpperBodyTemporalOutput["sampleDisposition"], progress = 1): UpperBodyTemporalOutput {
    return { rotation: this.output, state: this.state, progress, sampleDisposition };
  }
}

export class TorsoRelativeSourceSelector {
  private mode: "face-only" | "torso-relative" = "face-only";
  private lastChangedAtMs = -Infinity;
  private readonly enterMs: number; private readonly exitMs: number; private readonly minimumDwellMs: number;
  constructor(enterMs = 60, exitMs = 90, minimumDwellMs = 180) {
    this.enterMs = enterMs; this.exitMs = exitMs; this.minimumDwellMs = minimumDwellMs;
  }
  update(faceAt: number | null, poseAt: number | null, nowMs: number): "face-only" | "torso-relative" {
    const age = poseAt === null ? Infinity : Math.max(0, nowMs - poseAt);
    const skew = faceAt === null || poseAt === null ? Infinity : Math.abs(faceAt - poseAt);
    if (nowMs - this.lastChangedAtMs < this.minimumDwellMs) return this.mode;
    if (this.mode === "face-only" && age <= this.enterMs && skew <= this.enterMs) { this.mode = "torso-relative"; this.lastChangedAtMs = nowMs; }
    else if (this.mode === "torso-relative" && (age >= this.exitMs || skew >= this.exitMs)) { this.mode = "face-only"; this.lastChangedAtMs = nowMs; }
    return this.mode;
  }
  reset(): void { this.mode = "face-only"; this.lastChangedAtMs = -Infinity; }
}

export class UpperBodySourceTransition {
  private mode: "face-only"|"torso-relative"="face-only";private output=IDENTITY_QUATERNION;private origin=IDENTITY_QUATERNION;private startedAtMs:number|null=null;
  update(mode:"face-only"|"torso-relative",target:QuaternionData,nowMs:number,durationMs=180):QuaternionData{
    if(mode!==this.mode){this.mode=mode;this.origin=this.output;this.startedAtMs=nowMs;}
    if(this.startedAtMs!==null){const progress=Math.min(1,(nowMs-this.startedAtMs)/Math.max(1,durationMs));this.output=slerpQuaternionData(this.origin,target,progress);if(progress>=1)this.startedAtMs=null;}
    else this.output=target;
    return this.output;
  }
  reset():void{this.mode="face-only";this.output=IDENTITY_QUATERNION;this.origin=IDENTITY_QUATERNION;this.startedAtMs=null;}
}

/** Blend quan sát torso khi full hips tạm mất; không đổi calibration mode giữa phiên. */
export class TorsoObservationTransition {
  private mode: "shoulder-only" | "full-torso" = "shoulder-only";
  private output = IDENTITY_QUATERNION;
  private origin = IDENTITY_QUATERNION;
  private startedAtMs: number | null = null;

  update(mode: "shoulder-only" | "full-torso", target: QuaternionData, nowMs: number, durationMs = 220): QuaternionData {
    if (mode !== this.mode) { this.mode = mode; this.origin = this.output; this.startedAtMs = nowMs; }
    if (this.startedAtMs !== null) {
      const progress = Math.min(1, (nowMs - this.startedAtMs) / Math.max(1, durationMs));
      this.output = slerpQuaternionData(this.origin, target, progress);
      if (progress >= 1) this.startedAtMs = null;
    } else this.output = target;
    return this.output;
  }

  reset(): void { this.mode = "shoulder-only"; this.output = IDENTITY_QUATERNION; this.origin = IDENTITY_QUATERNION; this.startedAtMs = null; }
}

export interface UpperBodyScalarTemporalConfig {
  maximumTimestampGapMs: number;
  attackMs: number;
  releaseMs: number;
  holdMs: number;
  returnMs: number;
  reacquireMs: number;
}

export interface UpperBodyScalarTemporalOutput {
  value: number;
  state: AvatarOutputMotionState | "reacquiring";
  sampleDisposition: "new" | "duplicate" | "reversed" | "missing";
}

/** Temporal scalar theo observation timestamp; renderer chỉ áp full-state snapshot, không lọc lần hai. */
export class UpperBodyScalarTemporal {
  private lastSampledAtMs: number | null = null;
  private lastValidAtMs: number | null = null;
  private filteredValue = 0;
  private lastValid = 0;
  private output = 0;
  private state: UpperBodyScalarTemporalOutput["state"] = "idle";
  private reacquireOrigin: number | null = null;
  private reacquireStartedAtMs: number | null = null;
  private readonly config: UpperBodyScalarTemporalConfig;
  constructor(config: UpperBodyScalarTemporalConfig) { this.config = config; }

  update(observation: number | null, sampledAtMs: number | null, nowMs: number, filtered = true): UpperBodyScalarTemporalOutput {
    if (observation !== null && Number.isFinite(observation) && sampledAtMs !== null) {
      if (this.lastSampledAtMs !== null && sampledAtMs <= this.lastSampledAtMs) {
        return this.current(sampledAtMs === this.lastSampledAtMs ? "duplicate" : "reversed");
      }
      const target = Math.max(-1, Math.min(1, observation));
      const hadLoss = this.state === "held" || this.state === "returning" || this.state === "idle";
      const dt = this.lastSampledAtMs === null || sampledAtMs - this.lastSampledAtMs > this.config.maximumTimestampGapMs
        ? Infinity : Math.max(0, sampledAtMs - this.lastSampledAtMs);
      const timeConstant = Math.abs(target) > Math.abs(this.filteredValue) ? this.config.attackMs : this.config.releaseMs;
      const alpha = !filtered || !Number.isFinite(dt) ? 1 : 1 - Math.exp(-dt / Math.max(1, timeConstant));
      this.filteredValue += alpha * (target - this.filteredValue);
      this.lastSampledAtMs = sampledAtMs; this.lastValidAtMs = nowMs;
      if (hadLoss && this.state !== "idle") {
        this.reacquireOrigin = this.output; this.reacquireStartedAtMs = nowMs; this.state = "reacquiring";
      }
      if (this.reacquireStartedAtMs !== null && this.reacquireOrigin !== null) {
        const progress = Math.min(1, (nowMs - this.reacquireStartedAtMs) / Math.max(1, this.config.reacquireMs));
        this.output = this.reacquireOrigin + (this.filteredValue - this.reacquireOrigin) * progress;
        this.lastValid = this.output;
        if (progress < 1) return this.current("new");
        this.reacquireOrigin = null; this.reacquireStartedAtMs = null;
      } else this.output = this.filteredValue;
      this.lastValid = this.output; this.state = "active";
      return this.current("new");
    }
    if (this.lastValidAtMs !== null) {
      const elapsed = Math.max(0, nowMs - this.lastValidAtMs);
      if (elapsed <= this.config.holdMs) { this.state = "held"; this.output = this.lastValid; return this.current("missing"); }
      const returnElapsed = elapsed - this.config.holdMs;
      if (returnElapsed < this.config.returnMs) {
        this.state = "returning";
        this.output = this.lastValid * (1 - returnElapsed / Math.max(1, this.config.returnMs));
        return this.current("missing");
      }
    }
    this.state = "idle"; this.output = 0;
    return this.current("missing");
  }

  reset(): void {
    this.lastSampledAtMs = null; this.lastValidAtMs = null; this.filteredValue = 0; this.lastValid = 0; this.output = 0;
    this.state = "idle"; this.reacquireOrigin = null; this.reacquireStartedAtMs = null;
  }

  private current(sampleDisposition: UpperBodyScalarTemporalOutput["sampleDisposition"]): UpperBodyScalarTemporalOutput {
    return { value: this.output, state: this.state, sampleDisposition };
  }
}
