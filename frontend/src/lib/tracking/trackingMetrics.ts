import type { ConfiguredDelegate, PoseModelVariant } from "./mediaPipeRuntime";
import type { RawTrackingFrameV1 } from "./rawTrackingTypes";

export type MetricGroup = "face" | "hands" | "pose" | "pipeline";

export interface DistributionMetric {
  average: number;
  p95: number;
  max: number;
}

export interface TrackingMetricsSnapshot {
  runDurationMs: number;
  cameraFps: number;
  pipelineFps: number;
  inferenceFps: Record<"face" | "hands" | "pose", number>;
  inferenceTimeMs: Record<"face" | "hands" | "pose" | "pipeline", DistributionMetric>;
  sampleAgeMs: Record<"face" | "leftHand" | "rightHand" | "pose", DistributionMetric>;
  mainThreadLongTasks: number;
  mainThreadBlockedMs: number;
  selectedDelegate: ConfiguredDelegate | null;
  /** Ghi kèm để so sánh chi phí suy luận giữa `lite` và `full` trong cùng một snapshot. */
  poseModel: PoseModelVariant | null;
  stateRatio: Record<"face" | "leftHand" | "rightHand" | "pose", Record<"tracked" | "lost" | "not-sampled", number>>;
  lossEvents: Record<"face" | "leftHand" | "rightHand" | "pose", number>;
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

  reset(): void {
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
  }

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
    this.runStartedAt ??= now;
    this.pushTick(this.cameraTicks, now);
  }
  recordInference(group: "face" | "hands" | "pose", now: number, duration: number): void {
    this.pushTick(this.inferenceTicks[group], now);
    this.push(this.durations[group], duration);
  }
  recordPipeline(now: number, duration: number, frame: RawTrackingFrameV1): void {
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
    if (!this.observesLongTasks && duration >= 50) {
      this.longTasks += 1;
      this.blockedMs += duration;
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
    return {
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
        pipeline: distribution(this.durations.pipeline),
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
      poseModel,
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
    for (const ticks of [this.cameraTicks, this.pipelineTicks, ...Object.values(this.inferenceTicks)]) {
      while (ticks[0] !== undefined && ticks[0] < now - WINDOW_MS) ticks.shift();
    }
  }
}
