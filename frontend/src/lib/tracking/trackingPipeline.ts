import type { FaceLandmarkerResult, HandLandmarkerResult, PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import { CameraController, type CameraResolution } from "./cameraController";
import { MediaPipeRuntime, type DelegateSelection, type PoseModelVariant, type TrackingTaskSelection } from "./mediaPipeRuntime";
import { mapRawTrackingFrame, type MediaPipeFrameResults } from "./rawTrackingMapper";
import type { RawTrackingFrameV1 } from "./rawTrackingTypes";
import { TrackingMetricsCollector, type TrackingMetricsSnapshot } from "./trackingMetrics";

export type TrackingProfile = "full-rate" | "staggered";
export type TrackingPipelineState = "idle" | "starting" | "running" | "stopped" | "disposed" | "error";

export interface TrackingPipelineOptions {
  profile?: TrackingProfile;
  handIntervalMs?: number;
  poseIntervalMs?: number;
  resolution?: CameraResolution;
  delegate?: DelegateSelection;
  tasks?: TrackingTaskSelection;
  poseModel?: PoseModelVariant;
  onFrame: (frame: RawTrackingFrameV1) => void;
  onMetrics?: (metrics: TrackingMetricsSnapshot) => void;
  onError?: (error: unknown) => void;
  now?: () => number;
}

export interface TrackingPipelineDependencies {
  camera: CameraController;
  runtime: MediaPipeRuntime;
  metrics: TrackingMetricsCollector;
}

const defaultDependencies = (options: TrackingPipelineOptions): TrackingPipelineDependencies => ({
  camera: new CameraController(options.resolution),
  runtime: new MediaPipeRuntime(undefined, options.delegate, options.tasks, options.poseModel),
  metrics: new TrackingMetricsCollector(),
});

export class TrackingPipeline {
  private readonly options: TrackingPipelineOptions;
  private readonly dependencies: TrackingPipelineDependencies;
  private readonly now: () => number;
  private stateValue: TrackingPipelineState = "idle";
  private generation = 0;
  private callbackId: number | null = null;
  private callbackKind: "video" | "animation" | null = null;
  private video: HTMLVideoElement | null = null;
  private lastVideoTimestampMs = -1;
  private lastMediaPipeTimestampMs = -1;
  private lastHandSampleMs = -Infinity;
  private lastPoseSampleMs = -Infinity;
  private previousFrame: RawTrackingFrameV1 | undefined;
  private lastMetricsEmitMs = -Infinity;
  private startPromise: Promise<void> | null = null;

  constructor(
    options: TrackingPipelineOptions,
    dependencies?: TrackingPipelineDependencies,
  ) {
    this.options = options;
    this.dependencies = dependencies ?? defaultDependencies(options);
    this.now = options.now ?? (() => performance.now());
  }

  get state(): TrackingPipelineState { return this.stateValue; }
  get cameraSettings(): MediaTrackSettings | null { return this.dependencies.camera.settings; }

  async start(video: HTMLVideoElement): Promise<void> {
    if (this.stateValue === "disposed") throw new Error("Tracking pipeline đã dispose.");
    if (this.stateValue === "running") return;
    if (this.startPromise) return this.startPromise;
    const generation = ++this.generation;
    this.stateValue = "starting";
    this.startPromise = this.startInternal(video, generation).finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  private async startInternal(video: HTMLVideoElement, generation: number): Promise<void> {
    try {
      await this.dependencies.runtime.initialize();
      if (generation !== this.generation) return;
      await this.dependencies.camera.start(video, () => this.handleCameraEnded(generation));
      if (generation !== this.generation) {
        this.dependencies.camera.stop();
        return;
      }
      this.video = video;
      this.lastVideoTimestampMs = -1;
      this.lastHandSampleMs = -Infinity;
      this.lastPoseSampleMs = -Infinity;
      this.previousFrame = undefined;
      this.dependencies.metrics.reset();
      this.stateValue = "running";
      this.dependencies.metrics.startLongTaskObserver();
      this.scheduleNext(generation);
    } catch (error) {
      this.dependencies.camera.stop();
      if (this.stateValue !== "disposed") this.stateValue = "error";
      this.safeError(error);
      throw error;
    }
  }

  stop(): void {
    if (this.stateValue === "disposed") return;
    ++this.generation;
    this.cancelScheduledCallback();
    this.dependencies.metrics.stopLongTaskObserver();
    this.dependencies.camera.stop();
    this.video = null;
    this.previousFrame = undefined;
    this.stateValue = "stopped";
  }

  dispose(): void {
    if (this.stateValue === "disposed") return;
    this.stop();
    this.dependencies.runtime.dispose();
    this.stateValue = "disposed";
  }

  private scheduleNext(generation: number): void {
    const video = this.video;
    if (!video || generation !== this.generation || this.stateValue !== "running") return;
    if (typeof video.requestVideoFrameCallback === "function") {
      this.callbackKind = "video";
      this.callbackId = video.requestVideoFrameCallback((_now, metadata) => {
        this.callbackId = null;
        this.processFrame(metadata.mediaTime * 1000, generation);
      });
    } else {
      this.callbackKind = "animation";
      this.callbackId = requestAnimationFrame(() => {
        this.callbackId = null;
        this.processFrame(video.currentTime * 1000, generation);
      });
    }
  }

  private processFrame(videoTimestampMs: number, generation: number): void {
    if (generation !== this.generation || this.stateValue !== "running" || !this.video) return;
    if (videoTimestampMs <= this.lastVideoTimestampMs) {
      this.scheduleNext(generation);
      return;
    }
    this.lastVideoTimestampMs = videoTimestampMs;
    const startedAt = this.now();
    // Model được giữ qua stop/start, vì vậy timestamp đưa vào MediaPipe cũng phải
    // tăng xuyên suốt các camera session dù video.mediaTime quay lại từ đầu.
    const mediaPipeTimestampMs = Math.max(Math.floor(startedAt), this.lastMediaPipeTimestampMs + 1);
    this.lastMediaPipeTimestampMs = mediaPipeTimestampMs;
    this.dependencies.metrics.recordCameraFrame(startedAt);

    try {
      const results: MediaPipeFrameResults = {};
      results.sampledAtMs = {};
      if (this.video.videoWidth > 0 && this.video.videoHeight > 0) {
        results.videoDimensions = { width: this.video.videoWidth, height: this.video.videoHeight };
      }
      const tasks = this.dependencies.runtime.tasks;
      if (tasks.face) {
        results.face = this.measure("face", () => tasks.face!.detectForVideo(this.video!, mediaPipeTimestampMs));
        results.sampledAtMs.face = this.now();
      }

      const fullRate = (this.options.profile ?? "full-rate") === "full-rate";
      if (tasks.hands && (fullRate || startedAt - this.lastHandSampleMs >= (this.options.handIntervalMs ?? 66.7))) {
        results.hands = this.measure("hands", () => tasks.hands!.detectForVideo(this.video!, mediaPipeTimestampMs));
        results.sampledAtMs.hands = this.now();
        this.lastHandSampleMs = results.sampledAtMs.hands;
      }
      if (tasks.pose && (fullRate || startedAt - this.lastPoseSampleMs >= (this.options.poseIntervalMs ?? 66.7))) {
        results.pose = this.measure("pose", () => tasks.pose!.detectForVideo(this.video!, mediaPipeTimestampMs));
        results.sampledAtMs.pose = this.now();
        this.lastPoseSampleMs = results.sampledAtMs.pose;
      }

      const completedAt = this.now();
      const frame = mapRawTrackingFrame(videoTimestampMs, results, this.previousFrame);
      this.previousFrame = frame;
      this.dependencies.metrics.recordPipeline(completedAt, completedAt - startedAt, frame);
      try { this.options.onFrame(frame); } catch (error) { this.safeError(error); }
      if (completedAt - this.lastMetricsEmitMs >= 500) {
        this.lastMetricsEmitMs = completedAt;
        this.options.onMetrics?.(this.dependencies.metrics.snapshot(completedAt, this.dependencies.runtime.selectedDelegate, this.dependencies.runtime.selectedPoseModel));
      }
    } catch (error) {
      this.safeError(error);
      this.stop();
      this.stateValue = "error";
      return;
    }
    this.scheduleNext(generation);
  }

  private measure<T extends FaceLandmarkerResult | HandLandmarkerResult | PoseLandmarkerResult>(
    group: "face" | "hands" | "pose",
    operation: () => T,
  ): T {
    const startedAt = this.now();
    const result = operation();
    const completedAt = this.now();
    this.dependencies.metrics.recordInference(group, completedAt, completedAt - startedAt);
    return result;
  }

  private cancelScheduledCallback(): void {
    if (this.callbackId === null) return;
    if (this.callbackKind === "video" && this.video?.cancelVideoFrameCallback) {
      this.video.cancelVideoFrameCallback(this.callbackId);
    } else if (this.callbackKind === "animation") {
      cancelAnimationFrame(this.callbackId);
    }
    this.callbackId = null;
    this.callbackKind = null;
  }

  private handleCameraEnded(generation: number): void {
    if (generation !== this.generation) return;
    this.safeError(new Error("Webcam đã bị ngắt."));
    this.stop();
  }

  private safeError(error: unknown): void {
    try { this.options.onError?.(error); } catch { /* Consumer error không được phá lifecycle. */ }
  }
}
