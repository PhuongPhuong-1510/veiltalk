import type { AvatarOutputMotionState } from "./avatarPoseTypes";
import { createFacialExpressionMixer, safeExpressionWeight, type FacialExpressionMixerConfig, type FacialExpressionMixerSnapshot } from "./facialExpressionMixer";
import { createNeutralMouthSpeechCorrectiveSnapshot, MouthSpeechCorrective, validateMouthSpeechCorrectiveConfig, type MouthSpeechCorrectiveConfig, type MouthSpeechCorrectiveSnapshot, type MouthSpeechEvidence } from "./mouthSpeechCorrective";

export type FacialDynamicsGroupName =
  | "eyelid" | "eyeShape" | "gaze" | "lipClosure" | "vowel"
  | "jawLipShape" | "lipDetail" | "brow" | "cheekNose" | "emotion" | "other";

export interface FacialDynamicsTimeConstants { attackMs: number; releaseMs: number }

export interface FacialExpressionDynamicsConfig {
  initialStepMs: number;
  dtMaxMs: number;
  maxContinuousGapMs: number;
  groups: Record<FacialDynamicsGroupName, FacialDynamicsTimeConstants>;
  mixer: FacialExpressionMixerConfig;
  mouthSpeechCorrective: MouthSpeechCorrectiveConfig;
}

export type FacialDynamicsLifecycle = AvatarOutputMotionState | "reacquiring";
export type FacialSampleDisposition = "fresh" | "duplicate" | "reversed" | "unsampled" | "missing" | "reset";

export interface FacialExpressionDynamicsSnapshot {
  lifecycle: FacialDynamicsLifecycle;
  sampleDisposition: FacialSampleDisposition;
  filtered: boolean;
  dtMs: number;
  gapRebased: boolean;
  raw: Readonly<Record<string, number>>;
  desired: Readonly<Record<string, number>>;
  dynamic: Readonly<Record<string, number>>;
  final: Readonly<Record<string, number>>;
  preMix: FacialExpressionMixerSnapshot;
  postMix: FacialExpressionMixerSnapshot;
  mouthCorrective: MouthSpeechCorrectiveSnapshot;
}

const EMPTY_MIXER_SNAPSHOT: FacialExpressionMixerSnapshot = Object.freeze({ conflicts: Object.freeze([]), budgets: Object.freeze({}) });

function clone(values: Readonly<Record<string, number>>): Record<string, number> { return { ...values }; }
function zeroLike(values: Readonly<Record<string, number>>): Record<string, number> {
  return Object.fromEntries(Object.keys(values).map((name) => [name, 0]));
}

function groupFor(name: string): FacialDynamicsGroupName {
  if (["blink", "blinkLeft", "blinkRight", "eyeBlinkLeft", "eyeBlinkRight"].includes(name) || name.startsWith("eyeLid")) return "eyelid";
  if (name.startsWith("eyeWide") || name.startsWith("eyeSquint")) return "eyeShape";
  if (name.startsWith("eyeLook")) return "gaze";
  if (name === "mouthClose" || name.startsWith("mouthPress")) return "lipClosure";
  if (["aa", "ih", "ou", "ee", "oh"].includes(name)) return "vowel";
  if (name.startsWith("jaw") || ["mouthPucker", "mouthFunnel", "mouthNarrow", "mouthWide", "mouthLeft", "mouthRight"].includes(name)) return "jawLipShape";
  if (name.startsWith("mouth")) return "lipDetail";
  if (name.startsWith("brow")) return "brow";
  if (name.startsWith("cheek") || name.startsWith("nose")) return "cheekNose";
  if (["happy", "angry", "sad", "surprised"].includes(name)) return "emotion";
  return "other";
}

export function validateFacialExpressionDynamicsConfig(config: FacialExpressionDynamicsConfig): void {
  for (const [name, value] of [["initialStepMs", config.initialStepMs], ["dtMaxMs", config.dtMaxMs], ["maxContinuousGapMs", config.maxContinuousGapMs]] as const) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`Facial dynamics ${name} phải hữu hạn và > 0.`);
  }
  if (config.dtMaxMs > config.maxContinuousGapMs) throw new RangeError("Facial dynamics dtMaxMs không được lớn hơn maxContinuousGapMs.");
  for (const [group, constants] of Object.entries(config.groups)) {
    if (![constants.attackMs, constants.releaseMs].every((value) => Number.isFinite(value) && value > 0)) {
      throw new RangeError(`Facial dynamics group ${group} phải có attack/release hữu hạn và > 0.`);
    }
  }
  validateMouthSpeechCorrectiveConfig(config.mouthSpeechCorrective);
  createFacialExpressionMixer(config.mixer);
}

export function asymmetricExpressionStep(previous: number, target: number, dtMs: number, constants: FacialDynamicsTimeConstants): number {
  if (dtMs <= 0) return previous;
  const tauMs = target > previous ? constants.attackMs : constants.releaseMs;
  const alpha = 1 - Math.exp(-dtMs / tauMs);
  return previous + alpha * (target - previous);
}

export class FacialExpressionDynamics {
  private readonly mix: ReturnType<typeof createFacialExpressionMixer>;
  private readonly mouthSpeechCorrective: MouthSpeechCorrective;
  private readonly config: FacialExpressionDynamicsConfig;
  private output: Record<string, number> = {};
  private lastSampleTimestampMs: number | null = null;
  private hasTracked = false;
  private lastLifecycle: FacialDynamicsLifecycle = "idle";
  private returnStartedAtMs: number | null = null;
  private returnStartVector: Record<string, number> | null = null;
  private lastSnapshot: FacialExpressionDynamicsSnapshot = {
    lifecycle: "idle", sampleDisposition: "reset", filtered: true, dtMs: 0, gapRebased: false,
    raw: {}, desired: {}, dynamic: {}, final: {}, preMix: EMPTY_MIXER_SNAPSHOT, postMix: EMPTY_MIXER_SNAPSHOT,
    mouthCorrective: createNeutralMouthSpeechCorrectiveSnapshot(),
  };

  constructor(config: FacialExpressionDynamicsConfig) {
    validateFacialExpressionDynamicsConfig(config);
    this.config = config;
    this.mix = createFacialExpressionMixer(config.mixer);
    this.mouthSpeechCorrective = new MouthSpeechCorrective(config.mouthSpeechCorrective);
  }

  processFresh(raw: Readonly<Record<string, number>>, sampledAtMs: number, filtered: boolean, mouthEvidence?: Readonly<MouthSpeechEvidence>): Record<string, number> {
    if (!Number.isFinite(sampledAtMs)) return this.hold("active", "reversed", filtered);
    if (this.lastSampleTimestampMs !== null && sampledAtMs === this.lastSampleTimestampMs) return this.hold("active", "duplicate", filtered);
    if (this.lastSampleTimestampMs !== null && sampledAtMs < this.lastSampleTimestampMs) return this.hold("active", "reversed", filtered);

    const gapMs = this.lastSampleTimestampMs === null ? null : sampledAtMs - this.lastSampleTimestampMs;
    const gapRebased = gapMs !== null && gapMs > this.config.maxContinuousGapMs;
    const dtMs = gapMs === null || gapRebased
      ? this.config.initialStepMs
      : Math.min(gapMs, this.config.dtMaxMs);
    const safeRaw = Object.fromEntries(Object.entries(raw).map(([name, value]) => [name, safeExpressionWeight(value)]));
    const correctedRaw = mouthEvidence
      ? this.mouthSpeechCorrective.process(safeRaw, mouthEvidence, sampledAtMs, filtered)
      : safeRaw;
    const pre = this.mix(correctedRaw);
    const names = new Set([...Object.keys(this.output), ...Object.keys(pre.expressions)]);
    const dynamic: Record<string, number> = {};
    for (const name of names) {
      const target = pre.expressions[name] ?? 0;
      const previous = this.output[name] ?? 0;
      dynamic[name] = filtered
        ? asymmetricExpressionStep(previous, target, dtMs, this.config.groups[groupFor(name)])
        : target;
    }
    const post = this.mix(dynamic);
    const wasInactive = this.hasTracked && this.lastLifecycle !== "active" && this.lastLifecycle !== "reacquiring";
    this.output = clone(post.expressions);
    this.lastSampleTimestampMs = sampledAtMs;
    this.hasTracked = true;
    this.returnStartedAtMs = null;
    this.returnStartVector = null;
    this.lastLifecycle = wasInactive ? "reacquiring" : "active";
    this.lastSnapshot = {
      lifecycle: this.lastLifecycle, sampleDisposition: "fresh", filtered, dtMs, gapRebased,
      raw: safeRaw, desired: clone(pre.expressions), dynamic: clone(dynamic), final: clone(this.output),
      preMix: pre.snapshot, postMix: post.snapshot, mouthCorrective: this.mouthSpeechCorrective.snapshot(),
    };
    return clone(this.output);
  }

  hold(lifecycle: AvatarOutputMotionState, disposition: FacialSampleDisposition, filtered: boolean): Record<string, number> {
    this.lastLifecycle = lifecycle;
    this.lastSnapshot = { ...this.lastSnapshot, lifecycle, sampleDisposition: disposition, filtered, dtMs: 0, gapRebased: false, final: clone(this.output) };
    return clone(this.output);
  }

  processLoss(
    lifecycle: AvatarOutputMotionState,
    nowMs: number,
    lastTrackedAtMs: number | null,
    holdMs: number,
    returnMs: number,
    filtered: boolean,
  ): Record<string, number> {
    if (lifecycle === "active" || lifecycle === "held") return this.hold(lifecycle, lifecycle === "active" ? "unsampled" : "missing", filtered);
    if (lifecycle === "returning" && lastTrackedAtMs !== null) {
      // Không cho peak khẩu hình ẩn sống qua giai đoạn face đã thực sự returning.
      this.mouthSpeechCorrective.reset();
      const expectedStart = lastTrackedAtMs + holdMs;
      if (this.returnStartedAtMs === null) {
        this.returnStartedAtMs = expectedStart;
        this.returnStartVector = clone(this.output);
      }
      const u = returnMs <= 0 ? 1 : Math.min(1, Math.max(0, (nowMs - this.returnStartedAtMs) / returnMs));
      const envelope = 1 - u * u * (3 - 2 * u);
      const start = this.returnStartVector ?? this.output;
      this.output = Object.fromEntries(Object.entries(start).map(([name, value]) => [name, value * envelope]));
      this.lastLifecycle = "returning";
      this.lastSnapshot = {
        ...this.lastSnapshot, lifecycle: "returning", sampleDisposition: "missing", filtered,
        dtMs: 0, gapRebased: false, dynamic: clone(this.output), final: clone(this.output),
        mouthCorrective: this.mouthSpeechCorrective.snapshot(),
      };
      return clone(this.output);
    }

    this.output = zeroLike(this.output);
    this.mouthSpeechCorrective.reset();
    this.lastSampleTimestampMs = null;
    this.returnStartedAtMs = null;
    this.returnStartVector = null;
    this.lastLifecycle = "idle";
    this.lastSnapshot = {
      ...this.lastSnapshot, lifecycle: "idle", sampleDisposition: "missing", filtered,
      dtMs: 0, gapRebased: false, dynamic: clone(this.output), final: clone(this.output),
      mouthCorrective: this.mouthSpeechCorrective.snapshot(),
    };
    return clone(this.output);
  }

  snapshot(): FacialExpressionDynamicsSnapshot {
    return structuredClone(this.lastSnapshot);
  }

  reset(): void {
    this.output = {};
    this.lastSampleTimestampMs = null;
    this.hasTracked = false;
    this.lastLifecycle = "idle";
    this.returnStartedAtMs = null;
    this.returnStartVector = null;
    this.lastSnapshot = {
      lifecycle: "idle", sampleDisposition: "reset", filtered: true, dtMs: 0, gapRebased: false,
      raw: {}, desired: {}, dynamic: {}, final: {}, preMix: EMPTY_MIXER_SNAPSHOT, postMix: EMPTY_MIXER_SNAPSHOT,
      mouthCorrective: createNeutralMouthSpeechCorrectiveSnapshot(),
    };
    this.mouthSpeechCorrective.reset();
  }
}
