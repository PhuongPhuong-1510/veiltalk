import type { ConfiguredDelegate, PoseModelVariant } from "./mediaPipeRuntime";
import type { RawTrackingFrameV1 } from "./rawTrackingTypes";
import type { HandInputMode, HandRoiReason } from "./handWorkerProtocol";

export type MetricGroup = "face" | "hands" | "pose" | "pipeline";

export interface DistributionMetric {
  average: number;
  p95: number;
  max: number;
}

export const TRACKING_TIMING_NAMES = [
  "videoCallbackIntervalMs", "callbackToPipelineStartMs", "awaitNextVideoCallbackMs",
  "captureVideoBitmapMs", "captureHandBitmapMs", "framePreparationMs",
  "faceInferenceMs", "handsInferenceMs", "poseInferenceMs", "mainThreadInferenceMs",
  "workerWaitMs", "workerRoundTripMs", "workerPostMessageMs",
  "workerRoiPreparationMs", "workerMappingMs", "workerTotalMs", "poseHintAgeMs",
  "mapRawTrackingFrameMs", "motionProcessMs", "avatarApplyMs", "onFrameMs",
  "trackingPublishMs", "pipelineStartToAvatarApplyMs", "callbackToAvatarApplyMs",
  "totalProcessFrameMs",
] as const;
export type TrackingTimingName = typeof TRACKING_TIMING_NAMES[number];
export interface TimingDistribution extends DistributionMetric { p50: number; count: number }
export interface AvatarFrameTiming {
  motionProcessMs: number;
  avatarApplyMs?: number;
  /** Main-thread performance.now() immediately after applyPose; not a draw timestamp. */
  avatarAppliedAtMs?: number;
}
export interface TrackingRuntimeConfig {
  profile: "full-rate" | "staggered";
  handIntervalMs: number;
  poseIntervalMs: number;
  parallelHands: boolean;
  poseGuidedHands: boolean;
  adaptiveHandConfidence: boolean;
  tasks: { face: boolean; hands: boolean; pose: boolean };
  resolution: "720p" | "480p";
  delegate: string;
  poseModel: string | null;
  videoWidth: number;
  videoHeight: number;
  cameraTrackFrameRate: number | null;
}

/** Fixed-size numeric storage; sorting/copying happens only when UI requests a snapshot. */
class TimingBuffer {
  private readonly values: Float64Array;
  private readonly capacity: number;
  constructor(capacity = MAX_SAMPLES) { this.capacity = capacity; this.values = new Float64Array(capacity); }
  private count = 0;
  private cursor = 0;
  push(value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    this.values[this.cursor] = value;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.count = Math.min(this.capacity, this.count + 1);
  }
  reset(): void { this.count = 0; this.cursor = 0; }
  snapshot(): TimingDistribution {
    const values = this.values.slice(0, this.count).sort();
    const percentile = (p: number) => values[Math.max(0, Math.ceil(this.count * p) - 1)] ?? 0;
    return { count: this.count, average: values.reduce((sum, v) => sum + v, 0) / (this.count || 1),
      p50: percentile(.5), p95: percentile(.95), max: values.at(-1) ?? 0 };
  }
}

export interface TrackingMetricsSnapshot {
  measurementId?: number;
  measurementStartedAtMs?: number | null;
  timingSamplesMax?: number;
  measurementCounts?: Record<"videoCallbacks" | "pipelineFrames" | "face" | "hands" | "pose" | "trackingPublish" | "avatarApply", number>;
  measurementPresentedFps?: number | null;
  handDiagnostics?: {
    scope: "cumulative-measurement";
    hintCounts: { absent: number; fresh: number; stale: number; invalidAge: number };
    hintFreshRatio: number | null;
    hintStaleRatio: number | null;
    roiUsageRatio: number | null;
    fullFrameRatio: number | null;
    roiReasonCounts: Partial<Record<HandRoiReason, number>>;
    modes: Partial<Record<HandInputMode, { samples: number; leftTracked: number; rightTracked: number; neitherTracked: number; inferenceMs: TimingDistribution }>>;
  };
  runDurationMs: number;
  cameraFps: number;
  pipelineFps: number;
  inferenceFps: Record<"face" | "hands" | "pose", number>;
  inferenceTimeMs: Record<"face" | "hands" | "pose" | "pipeline", DistributionMetric>;
  sampleAgeMs: Record<"face" | "leftHand" | "rightHand" | "pose", DistributionMetric>;
  mainThreadLongTasks: number;
  mainThreadBlockedMs: number;
  selectedDelegate: ConfiguredDelegate | null;
  handExecution?: "main-thread" | "worker";
  handDelegate?: ConfiguredDelegate | null;
  handWorkerFallback?: string | null;
  handWorkerDroppedSamples?: number;
  handInputMode?: "full-frame" | "single" | "combined" | "split";
  handConfidenceMode?: "normal" | "sensitive";
  adaptiveHandAvailable?: boolean;
  framePreparationMs?: DistributionMetric;
  handWorkerRoundTripMs?: DistributionMetric;
  /** Ghi kèm để so sánh chi phí suy luận giữa `lite` và `full` trong cùng một snapshot. */
  poseModel: PoseModelVariant | null;
  stateRatio: Record<"face" | "leftHand" | "rightHand" | "pose", Record<"tracked" | "lost" | "not-sampled", number>>;
  lossEvents: Record<"face" | "leftHand" | "rightHand" | "pose", number>;
  timings?: Record<TrackingTimingName, TimingDistribution>;
  /** Callback FPS counts callbacks received by this pipeline, not all camera frames. */
  videoCallbackFps?: number;
  videoPresentedFps?: number | null;
  pipelineFrameFps?: number;
  faceSampleFps?: number;
  handSampleFps?: number;
  poseSampleFps?: number;
  trackingPublishFps?: number;
  avatarApplyFps?: number;
  renderFps?: number | null;
  longTaskScope?: "cumulative-session" | "cumulative-measurement";
  longTaskSource?: "observer" | "main-inference-fallback";
  runtimeConfig?: TrackingRuntimeConfig;
}

const WINDOW_MS = 10_000;
const MAX_SAMPLES = 600;

function distribution(values: number[]): DistributionMetric {
  if (!values.length) return { average: 0, p95: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
    p95: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)],
    max: sorted[sorted.length - 1],
  };
}

export class TrackingMetricsCollector {
  private cameraTicks: number[] = [];
  private pipelineTicks: number[] = [];
  private inferenceTicks = { face: [] as number[], hands: [] as number[], pose: [] as number[] };
  private durations = { face: [] as number[], hands: [] as number[], pose: [] as number[], pipeline: [] as number[] };
  private ages = { face: [] as number[], leftHand: [] as number[], rightHand: [] as number[], pose: [] as number[] };
  private observer: PerformanceObserver | null = null;
  private observesLongTasks = false;
  private longTasks = 0;
  private blockedMs = 0;
  private stateCounts = this.emptyStateCounts();
  private lossEvents = { face: 0, leftHand: 0, rightHand: 0, pose: 0 };
  private previousStates: Partial<Record<keyof TrackingMetricsCollector["stateCounts"], string>> = {};
  private runStartedAt: number | null = null;
  private preparations: number[] = [];
  private workerRoundTrips: number[] = [];
  private timings = Object.fromEntries(TRACKING_TIMING_NAMES.map(name => [name, new TimingBuffer()])) as Record<TrackingTimingName, TimingBuffer>;
  private timingCapacity = MAX_SAMPLES;
  private measurementId = 0;
  private measurementStartedAt: number | null = null;
  private measurementCounts = this.emptyMeasurementCounts();
  private firstPresented: { at: number; frames: number } | null = null;
  private lastPresented: { at: number; frames: number } | null = null;
  private hintCounts = { absent: 0, fresh: 0, stale: 0, invalidAge: 0 };
  private roiReasonCounts: Partial<Record<HandRoiReason, number>> = {};
  private handModes: Partial<Record<HandInputMode, { samples: number; leftTracked: number; rightTracked: number; neitherTracked: number; inference: TimingBuffer }>> = {};
  private videoCallbackTicks: number[] = [];
  private avatarApplyTicks: number[] = [];
  private lastVideoCallbackMs: number | null = null;
  private presented: { at: number; frames: number }[] = [];

  reset(): void {
    if (this.timingCapacity !== MAX_SAMPLES) {
      this.timingCapacity = MAX_SAMPLES;
      this.timings = Object.fromEntries(TRACKING_TIMING_NAMES.map(name => [name, new TimingBuffer()])) as Record<TrackingTimingName, TimingBuffer>;
    }
    this.cameraTicks = [];
    this.pipelineTicks = [];
    this.inferenceTicks = { face: [], hands: [], pose: [] };
    this.durations = { face: [], hands: [], pose: [], pipeline: [] };
    this.ages = { face: [], leftHand: [], rightHand: [], pose: [] };
    this.longTasks = 0;
    this.blockedMs = 0;
    this.stateCounts = this.emptyStateCounts();
    this.lossEvents = { face: 0, leftHand: 0, rightHand: 0, pose: 0 };
    this.previousStates = {};
    this.runStartedAt = null;
    this.preparations = []; this.workerRoundTrips = [];
    for (const name of TRACKING_TIMING_NAMES) this.timings[name].reset();
    this.videoCallbackTicks = []; this.avatarApplyTicks = []; this.presented = [];
    this.lastVideoCallbackMs = null;
    this.measurementId = 0; this.measurementStartedAt = null;
    this.measurementCounts = this.emptyMeasurementCounts();
    this.firstPresented = null; this.lastPresented = null;
    this.hintCounts = { absent: 0, fresh: 0, stale: 0, invalidAge: 0 };
    this.roiReasonCounts = {}; this.handModes = {};
  }

  /** DEV benchmark only: clear measurements, never detector state or sampling clocks. */
  beginMeasurement(id: number, now: number): void {
    this.observer?.takeRecords();
    this.reset();
    this.measurementId = id; this.measurementStartedAt = now; this.runStartedAt = now;
    this.timingCapacity = 4096;
    this.timings = Object.fromEntries(TRACKING_TIMING_NAMES.map(name => [name, new TimingBuffer(this.timingCapacity)])) as Record<TrackingTimingName, TimingBuffer>;
  }

  recordHandHint(ageMs: number | null): void {
    if (ageMs === null) this.hintCounts.absent++;
    else if (!Number.isFinite(ageMs) || ageMs < 0) this.hintCounts.invalidAge++;
    else if (ageMs > 120) this.hintCounts.stale++;
    else this.hintCounts.fresh++;
  }

  recordHandInput(mode: HandInputMode, inferenceMs: number, frame: RawTrackingFrameV1, reason?: HandRoiReason): void {
    const group = this.handModes[mode] ??= { samples: 0, leftTracked: 0, rightTracked: 0, neitherTracked: 0, inference: new TimingBuffer(this.timingCapacity) };
    group.samples++;
    const left = frame.leftHand.state === "tracked", right = frame.rightHand.state === "tracked";
    if (left) group.leftTracked++;
    if (right) group.rightTracked++;
    if (!left && !right) group.neitherTracked++;
    group.inference.push(inferenceMs);
    if (reason) this.roiReasonCounts[reason] = (this.roiReasonCounts[reason] ?? 0) + 1;
  }

  private emptyMeasurementCounts() { return { videoCallbacks: 0, pipelineFrames: 0, face: 0, hands: 0, pose: 0, trackingPublish: 0, avatarApply: 0 }; }

  startLongTaskObserver(): void {
    if (typeof PerformanceObserver === "undefined") return;
    try {
      this.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.longTasks += 1;
          this.blockedMs += entry.duration;
        }
      });
      this.observer.observe({ entryTypes: ["longtask"] });
      this.observesLongTasks = true;
    } catch {
      this.observer = null;
      this.observesLongTasks = false;
    }
  }

  stopLongTaskObserver(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.observesLongTasks = false;
  }

  recordCameraFrame(now: number): void {
    this.measurementCounts.pipelineFrames++;
    this.runStartedAt ??= now;
    this.pushTick(this.cameraTicks, now);
  }
  recordTiming(name: TrackingTimingName, duration: number): void { this.timings[name].push(duration); }
  recordVideoCallback(now: number, presentedFrames?: number): void {
    this.measurementCounts.videoCallbacks++;
    this.pushTick(this.videoCallbackTicks, now);
    if (this.lastVideoCallbackMs !== null) this.recordTiming("videoCallbackIntervalMs", now - this.lastVideoCallbackMs);
    this.lastVideoCallbackMs = now;
    if (presentedFrames !== undefined && Number.isFinite(presentedFrames)) {
      if (this.presented.length && presentedFrames < this.presented.at(-1)!.frames) this.presented = [];
      this.presented.push({ at: now, frames: presentedFrames });
      if (!this.lastPresented || presentedFrames < this.lastPresented.frames) this.firstPresented = { at: now, frames: presentedFrames };
      this.lastPresented = { at: now, frames: presentedFrames };
      while (this.presented.length > MAX_SAMPLES || (this.presented.length && this.presented[0].at < now - WINDOW_MS)) this.presented.shift();
    }
  }
  recordAvatarTiming(timing: AvatarFrameTiming, startedAt: number, callbackAt?: number): void {
    this.recordTiming("motionProcessMs", timing.motionProcessMs);
    if (timing.avatarApplyMs !== undefined) this.recordTiming("avatarApplyMs", timing.avatarApplyMs);
    if (timing.avatarAppliedAtMs !== undefined) {
      this.measurementCounts.avatarApply++;
      this.pushTick(this.avatarApplyTicks, timing.avatarAppliedAtMs);
      this.recordTiming("pipelineStartToAvatarApplyMs", timing.avatarAppliedAtMs - startedAt);
      if (callbackAt !== undefined) this.recordTiming("callbackToAvatarApplyMs", timing.avatarAppliedAtMs - callbackAt);
    }
  }
  recordInference(group: "face" | "hands" | "pose", now: number, duration: number, pureInferenceMs = duration): void {
    this.measurementCounts[group]++;
    this.pushTick(this.inferenceTicks[group], now);
    this.push(this.durations[group], duration);
    this.recordTiming(`${group}InferenceMs`, pureInferenceMs);
  }
  recordWorkerFrame(preparationMs: number, roundTripMs: number): void {
    if (preparationMs > 0) this.push(this.preparations, preparationMs);
    if (roundTripMs > 0) this.push(this.workerRoundTrips, roundTripMs);
  }

  recordPipeline(now: number, duration: number, frame: RawTrackingFrameV1, mainThreadDuration = duration): void {
    this.measurementCounts.trackingPublish++;
    this.pushTick(this.pipelineTicks, now);
    this.push(this.durations.pipeline, duration);
    this.recordAge("face", frame.face.sampledAtMs, now);
    this.recordAge("leftHand", frame.leftHand.sampledAtMs, now);
    this.recordAge("rightHand", frame.rightHand.sampledAtMs, now);
    this.recordAge("pose", frame.pose.sampledAtMs, now);
    for (const group of ["face", "leftHand", "rightHand", "pose"] as const) {
      const state = frame[group].state;
      this.stateCounts[group][state] += 1;
      if (state === "lost" && this.previousStates[group] !== "lost") this.lossEvents[group] += 1;
      this.previousStates[group] = state;
    }
    // Firefox chưa hỗ trợ Long Tasks API; dùng pipeline task >=50ms làm fallback có ghi nhãn cùng metric.
    if (!this.observesLongTasks && mainThreadDuration >= 50) {
      this.longTasks += 1;
      this.blockedMs += mainThreadDuration;
    }
  }

  snapshot(now: number, selectedDelegate: ConfiguredDelegate | null, poseModel: PoseModelVariant | null = null): TrackingMetricsSnapshot {
    this.trimTicks(now);
    const fps = (ticks: number[]) => {
      if (ticks.length < 2) return 0;
      const observedMs = Math.min(WINDOW_MS, Math.max(1, now - ticks[0]));
      // N timestamps tạo N-1 khoảng thời gian; dùng interval để tránh báo cao ở đầu run.
      return (ticks.length - 1) / (observedMs / 1000);
    };
    const timingSnapshot = Object.fromEntries(TRACKING_TIMING_NAMES.map(name => [name, this.timings[name].snapshot()])) as Record<TrackingTimingName, TimingDistribution>;
    const firstPresented = this.presented[0], lastPresented = this.presented.at(-1);
    const presentedFps = firstPresented && lastPresented && lastPresented.at > firstPresented.at
      ? (lastPresented.frames - firstPresented.frames) * 1000 / (lastPresented.at - firstPresented.at) : null;
    const hintTotal = Object.values(this.hintCounts).reduce((a, b) => a + b, 0);
    const modeTotal = Object.values(this.handModes).reduce((sum, d) => sum + d.samples, 0);
    return {
      measurementId: this.measurementId, measurementStartedAtMs: this.measurementStartedAt,
      timingSamplesMax: this.timingCapacity, measurementCounts: { ...this.measurementCounts },
      measurementPresentedFps: this.firstPresented && this.lastPresented && this.lastPresented.at > this.firstPresented.at
        ? (this.lastPresented.frames - this.firstPresented.frames) * 1000 / (this.lastPresented.at - this.firstPresented.at) : null,
      handDiagnostics: { scope: "cumulative-measurement", hintCounts: { ...this.hintCounts }, roiReasonCounts: { ...this.roiReasonCounts },
        hintFreshRatio: hintTotal ? this.hintCounts.fresh / hintTotal : null,
        hintStaleRatio: hintTotal ? this.hintCounts.stale / hintTotal : null,
        roiUsageRatio: modeTotal ? 1 - (this.handModes["full-frame"]?.samples ?? 0) / modeTotal : null,
        fullFrameRatio: modeTotal ? (this.handModes["full-frame"]?.samples ?? 0) / modeTotal : null,
        modes: Object.fromEntries(Object.entries(this.handModes).map(([mode, d]) => [mode, { samples: d.samples, leftTracked: d.leftTracked,
          rightTracked: d.rightTracked, neitherTracked: d.neitherTracked, inferenceMs: d.inference.snapshot() }])) },
      runDurationMs: this.runStartedAt === null ? 0 : Math.max(0, now - this.runStartedAt),
      cameraFps: fps(this.cameraTicks),
      pipelineFps: fps(this.pipelineTicks),
      inferenceFps: {
        face: fps(this.inferenceTicks.face),
        hands: fps(this.inferenceTicks.hands),
        pose: fps(this.inferenceTicks.pose),
      },
      inferenceTimeMs: {
        face: distribution(this.durations.face),
        hands: distribution(this.durations.hands),
        pose: distribution(this.durations.pose),
        pipeline: timingSnapshot.totalProcessFrameMs.count ? timingSnapshot.totalProcessFrameMs : distribution(this.durations.pipeline),
      },
      sampleAgeMs: {
        face: distribution(this.ages.face),
        leftHand: distribution(this.ages.leftHand),
        rightHand: distribution(this.ages.rightHand),
        pose: distribution(this.ages.pose),
      },
      mainThreadLongTasks: this.longTasks,
      mainThreadBlockedMs: this.blockedMs,
      selectedDelegate,
      framePreparationMs: distribution(this.preparations),
      handWorkerRoundTripMs: distribution(this.workerRoundTrips),
      poseModel,
      timings: timingSnapshot,
      videoCallbackFps: fps(this.videoCallbackTicks), videoPresentedFps: presentedFps,
      pipelineFrameFps: fps(this.cameraTicks), trackingPublishFps: fps(this.pipelineTicks),
      faceSampleFps: fps(this.inferenceTicks.face), handSampleFps: fps(this.inferenceTicks.hands), poseSampleFps: fps(this.inferenceTicks.pose),
      avatarApplyFps: fps(this.avatarApplyTicks), longTaskScope: this.measurementId ? "cumulative-measurement" : "cumulative-session",
      longTaskSource: this.observesLongTasks ? "observer" : "main-inference-fallback",
      stateRatio: Object.fromEntries((Object.keys(this.stateCounts) as Array<keyof typeof this.stateCounts>).map((group) => {
        const counts = this.stateCounts[group];
        const total = counts.tracked + counts.lost + counts["not-sampled"] || 1;
        return [group, {
          tracked: counts.tracked / total,
          lost: counts.lost / total,
          "not-sampled": counts["not-sampled"] / total,
        }];
      })) as TrackingMetricsSnapshot["stateRatio"],
      lossEvents: { ...this.lossEvents },
    };
  }

  private emptyStateCounts() {
    const empty = () => ({ tracked: 0, lost: 0, "not-sampled": 0 });
    return { face: empty(), leftHand: empty(), rightHand: empty(), pose: empty() };
  }

  private recordAge(group: keyof TrackingMetricsCollector["ages"], sampledAt: number | null, now: number): void {
    if (sampledAt !== null) this.push(this.ages[group], Math.max(0, now - sampledAt));
  }
  private push(values: number[], value: number): void {
    values.push(value);
    if (values.length > MAX_SAMPLES) values.splice(0, values.length - MAX_SAMPLES);
  }
  private pushTick(values: number[], now: number): void {
    values.push(now);
    while (values[0] !== undefined && values[0] < now - WINDOW_MS) values.shift();
  }
  private trimTicks(now: number): void {
    for (const ticks of [this.cameraTicks, this.pipelineTicks, this.videoCallbackTicks, this.avatarApplyTicks, ...Object.values(this.inferenceTicks)]) {
      while (ticks[0] !== undefined && ticks[0] < now - WINDOW_MS) ticks.shift();
    }
    while (this.presented.length && this.presented[0].at < now - WINDOW_MS) this.presented.shift();
  }
}
