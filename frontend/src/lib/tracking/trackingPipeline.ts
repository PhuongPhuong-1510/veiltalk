import type { FaceLandmarkerResult, HandLandmarkerResult, PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import { CameraController, type CameraResolution } from "./cameraController";
import { MediaPipeRuntime, type DelegateSelection, type PoseModelVariant, type TrackingTaskSelection } from "./mediaPipeRuntime";
import { mapRawTrackingFrame, type MediaPipeFrameResults } from "./rawTrackingMapper";
import type { RawTrackingFrameV1 } from "./rawTrackingTypes";
import { TrackingMetricsCollector, type AvatarFrameTiming, type TrackingMetricsSnapshot } from "./trackingMetrics";
import { HandTrackingWorker } from "./handTrackingWorker";
import type { HandTrackingExecutor, HandWorkerSample } from "./handWorkerProtocol";
import { drawHandInput, HandSensitivitySelector, mapHandResultFromInput, planPoseGuidedHandInput, type HandPoseHint } from "./poseGuidedHandInput";

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
  parallelHands?: boolean;
  poseGuidedHands?: boolean;
  adaptiveHandConfidence?: boolean;
  onFrame: (frame: RawTrackingFrameV1) => AvatarFrameTiming | void;
  onMetrics?: (metrics: TrackingMetricsSnapshot) => void;
  onError?: (error: unknown) => void;
  now?: () => number;
}

export interface TrackingPipelineDependencies {
  camera: CameraController;
  runtime: MediaPipeRuntime;
  metrics: TrackingMetricsCollector;
  handWorker?: HandTrackingExecutor;
  captureFrame?: (source: HTMLVideoElement | ImageBitmap) => Promise<ImageBitmap>;
}

const defaultDependencies = (options: TrackingPipelineOptions): TrackingPipelineDependencies => {
  const tasks = options.tasks ?? { face: true, hands: true, pose: true };
  const parallel = options.parallelHands && tasks.hands;
  return {
    camera: new CameraController(options.resolution),
    runtime: new MediaPipeRuntime(undefined, options.delegate, { ...tasks, hands: tasks.hands && !parallel }, options.poseModel),
    metrics: new TrackingMetricsCollector(),
    handWorker: parallel ? new HandTrackingWorker(new URL(`${import.meta.env.BASE_URL}mediapipe/`, document.baseURI).href, options.delegate, undefined, 350, options.adaptiveHandConfidence) : undefined,
    captureFrame: (source) => createImageBitmap(source),
  };
};

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
  private workerEnabled = false;
  private workerFallback: string | null = null;
  private workerDroppedSamples = 0;
  private readonly sensitivity = new HandSensitivitySelector();
  private handCanvas: OffscreenCanvas | HTMLCanvasElement | null = null;
  private handInputMode: "full-frame" | "single" | "combined" | "split" = "full-frame";
  private handConfidenceMode: "normal" | "sensitive" = "normal";
  private handRoiMisses = 0;
  private nextMeasurementId = 0;
  private pendingMeasurementId: number | null = null;

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

  /** Applied between frames; changes measurements only, never tracking state/scheduling. */
  requestMeasurementReset(): number {
    if (this.stateValue !== "running") throw new Error("Bật tracking trước khi đo benchmark.");
    this.pendingMeasurementId = ++this.nextMeasurementId;
    return this.pendingMeasurementId;
  }

  private applyMeasurementReset(at: number): boolean {
    if (this.pendingMeasurementId === null) return false;
    this.dependencies.metrics.beginMeasurement(this.pendingMeasurementId, at);
    this.workerDroppedSamples = 0;
    this.pendingMeasurementId = null;
    return true;
  }

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
      this.workerEnabled = false; this.workerFallback = null; this.workerDroppedSamples = 0;
      if (this.dependencies.handWorker) {
        try {
          await this.dependencies.handWorker.initialize();
          if (generation !== this.generation) return;
          this.dependencies.runtime.releaseHands();
          this.workerEnabled = true;
        } catch (error) {
          if (generation !== this.generation) return;
          await this.fallbackHands(error);
          if (generation !== this.generation) return;
        }
      }
      if (this.options.adaptiveHandConfidence && !this.workerEnabled) {
        try { await this.dependencies.runtime.initializeSensitiveHands(); }
        catch { /* Normal Hand remains usable if a second model exceeds device capacity. */ }
      }
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
      this.sensitivity.reset();
      this.handInputMode = "full-frame"; this.handConfidenceMode = "normal";
      this.handRoiMisses = 0;
      this.dependencies.metrics.reset();
      this.lastMetricsEmitMs = -Infinity;
      this.stateValue = "running";
      this.dependencies.metrics.startLongTaskObserver();
      this.scheduleNext(generation);
    } catch (error) {
      if (generation !== this.generation) return;
      this.dependencies.camera.stop();
      if (this.stateValue !== "disposed") this.stateValue = "error";
      this.safeError(error);
      throw error;
    }
  }

  stop(): void {
    if (this.stateValue === "disposed") return;
    ++this.generation;
    this.pendingMeasurementId = null;
    this.dependencies.handWorker?.dispose();
    this.workerEnabled = false;
    this.cancelScheduledCallback();
    this.dependencies.metrics.stopLongTaskObserver();
    this.dependencies.camera.stop();
    this.video = null;
    this.previousFrame = undefined;
    this.sensitivity.reset(); this.handCanvas = null;
    this.handRoiMisses = 0;
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
      const scheduledAt = this.now();
      this.callbackId = video.requestVideoFrameCallback((_now, metadata) => {
        this.callbackId = null;
        const callbackAt = this.now();
        if (generation === this.generation && this.stateValue === "running") {
          const measurementReset = this.applyMeasurementReset(callbackAt);
          this.dependencies.metrics.recordVideoCallback?.(callbackAt, metadata.presentedFrames);
          // Registration of this first callback predates the measurement boundary.
          if (!measurementReset) this.dependencies.metrics.recordTiming?.("awaitNextVideoCallbackMs", callbackAt - scheduledAt);
        }
        void this.processFrame(metadata.mediaTime * 1000, generation, callbackAt);
      });
    } else {
      this.callbackKind = "animation";
      this.callbackId = requestAnimationFrame(() => {
        this.callbackId = null;
        void this.processFrame(video.currentTime * 1000, generation);
      });
    }
  }

  private async processFrame(videoTimestampMs: number, generation: number, callbackAt?: number): Promise<void> {
    const startedAt = this.now();
    if (generation !== this.generation || this.stateValue !== "running" || !this.video) return;
    if (callbackAt === undefined) this.applyMeasurementReset(startedAt);
    if (videoTimestampMs <= this.lastVideoTimestampMs) {
      this.scheduleNext(generation);
      return;
    }
    this.lastVideoTimestampMs = videoTimestampMs;
    const video = this.video;
    // Model được giữ qua stop/start, vì vậy timestamp đưa vào MediaPipe cũng phải
    // tăng xuyên suốt các camera session dù video.mediaTime quay lại từ đầu.
    const mediaPipeTimestampMs = Math.max(Math.floor(startedAt), this.lastMediaPipeTimestampMs + 1);
    this.lastMediaPipeTimestampMs = mediaPipeTimestampMs;
    this.dependencies.metrics.recordCameraFrame(startedAt);
    if (callbackAt !== undefined) this.dependencies.metrics.recordTiming?.("callbackToPipelineStartMs", startedAt - callbackAt);

    let snapshot: ImageBitmap | null = null;
    let preparationMs = 0, mainThreadMs = 0, roundTripMs = 0;
    let capturing = false;
    let published = false;
    let handObservation: HandWorkerSample | null = null;
    let workerJob: Promise<{ sample: HandWorkerSample; elapsed: number } | { error: unknown }> | null = null;
    try {
      const results: MediaPipeFrameResults = {};
      results.sampledAtMs = {};
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        results.videoDimensions = { width: video.videoWidth, height: video.videoHeight };
      }
      const fullRate = (this.options.profile ?? "full-rate") === "full-rate";
      const sampleHands = fullRate || startedAt - this.lastHandSampleMs >= (this.options.handIntervalMs ?? 66.7);
      const previous = this.previousFrame;
      const poseHint: HandPoseHint | null = (this.options.poseGuidedHands || this.options.adaptiveHandConfidence) && previous && previous.pose.sampledAtMs !== null
        && previous.videoWidth === video.videoWidth && previous.videoHeight === video.videoHeight
        ? { pose: previous.pose, width: video.videoWidth, height: video.videoHeight, ageMs: startedAt - previous.pose.sampledAtMs } : null;
      const handPlan = this.options.poseGuidedHands || this.options.adaptiveHandConfidence ? planPoseGuidedHandInput(poseHint) : null;
      if (poseHint) this.dependencies.metrics.recordTiming?.("poseHintAgeMs", poseHint.ageMs);
      if (sampleHands && (this.workerEnabled || this.dependencies.runtime.tasks.hands)) this.dependencies.metrics.recordHandHint?.(poseHint?.ageMs ?? null);
      // A single immutable capture feeds both threads. Transfer a copy to Hand,
      // then run Face/Pose while it is processing. Only one frame is in flight.
      if (this.workerEnabled && sampleHands) {
        capturing = true;
        const capture = this.dependencies.captureFrame!;
        const videoCaptureAt = this.now();
        snapshot = await capture(video);
        const videoCaptureEndedAt = this.now();
        if (generation !== this.generation) return;
        this.dependencies.metrics.recordTiming?.("captureVideoBitmapMs", videoCaptureEndedAt - videoCaptureAt);
        const handCaptureAt = this.now();
        const handBitmap = await capture(snapshot);
        const handCaptureEndedAt = this.now();
        if (generation !== this.generation) { handBitmap.close(); return; }
        this.dependencies.metrics.recordTiming?.("captureHandBitmapMs", handCaptureEndedAt - handCaptureAt);
        preparationMs = this.now() - startedAt;
        this.dependencies.metrics.recordTiming?.("framePreparationMs", preparationMs);
        results.videoDimensions = { width: snapshot.width, height: snapshot.height };
        const sentAt = this.now();
        workerJob = this.dependencies.handWorker!.detect(handBitmap, mediaPipeTimestampMs, startedAt, poseHint, this.options.poseGuidedHands).then(
          sample => ({ sample, elapsed: this.now() - sentAt }), error => ({ error }),
        );
        capturing = false;
      }
      const source = snapshot ?? video;
      const tasks = this.dependencies.runtime.tasks;
      const mainStartedAt = this.now();
      if (tasks.face) {
        results.face = this.measure("face", () => tasks.face!.detectForVideo(source, mediaPipeTimestampMs));
        // Các detector bên dưới cùng đọc một camera frame. `sampledAtMs` là thời điểm
        // lấy frame, không phải lúc từng inference kết thúc; nếu không Face -> Hands ->
        // Pose chạy nối tiếp sẽ tạo skew giả và làm calibration theo cặp bị kẹt.
        results.sampledAtMs.face = startedAt;
      }

      if (!this.workerEnabled && tasks.hands && sampleHands) {
        const mode = this.options.adaptiveHandConfidence ? this.sensitivity.select(handPlan, startedAt) : "normal";
        const handTask = this.dependencies.runtime.getHandTask?.(mode === "sensitive") ?? tasks.hands;
        let handSource: HTMLVideoElement | ImageBitmap | OffscreenCanvas | HTMLCanvasElement = source;
        let usedPlan = null;
        if (this.options.poseGuidedHands && handPlan && this.handRoiMisses < 2) {
          try {
            this.handCanvas ??= typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(512, 512) : document.createElement("canvas");
            drawHandInput(source, handPlan, this.handCanvas);
            handSource = this.handCanvas; usedPlan = handPlan;
          } catch { handSource = source; }
        }
        const rawHands = this.measure("hands", () => handTask.detectForVideo(handSource, mediaPipeTimestampMs));
        results.hands = usedPlan ? mapHandResultFromInput(rawHands, usedPlan) : rawHands;
        this.handRoiMisses = usedPlan ? results.hands.landmarks.length ? 0 : this.handRoiMisses + 1 : 0;
        this.handInputMode = usedPlan?.layout ?? "full-frame";
        this.handConfidenceMode = mode === "sensitive" && this.dependencies.runtime.hasSensitiveHands ? "sensitive" : "normal";
        results.sampledAtMs.hands = startedAt;
        this.lastHandSampleMs = results.sampledAtMs.hands;
      }
      if (tasks.pose && (fullRate || startedAt - this.lastPoseSampleMs >= (this.options.poseIntervalMs ?? 66.7))) {
        results.pose = this.measure("pose", () => tasks.pose!.detectForVideo(source, mediaPipeTimestampMs));
        results.sampledAtMs.pose = startedAt;
        this.lastPoseSampleMs = results.sampledAtMs.pose;
      }
      mainThreadMs = this.now() - mainStartedAt;
      this.dependencies.metrics.recordTiming?.("mainThreadInferenceMs", mainThreadMs);
      if (workerJob) {
        const waitStartedAt = this.now();
        const outcome = await workerJob;
        const waitEndedAt = this.now();
        if (generation !== this.generation) return;
        this.dependencies.metrics.recordTiming?.("workerWaitMs", waitEndedAt - waitStartedAt);
        if ("error" in outcome) {
          await this.fallbackHands(outcome.error);
          if (generation !== this.generation) return;
          // Do not publish this old frame after loading the fallback model.
          this.scheduleNext(generation); return;
        }
        roundTripMs = outcome.elapsed;
        this.dependencies.metrics.recordTiming?.("workerRoundTripMs", roundTripMs);
        const workerTiming = outcome.sample.timings;
        if (workerTiming) {
          this.dependencies.metrics.recordTiming?.("workerRoiPreparationMs", workerTiming.roiPreparationMs);
          this.dependencies.metrics.recordTiming?.("workerMappingMs", workerTiming.mappingMs);
          this.dependencies.metrics.recordTiming?.("workerTotalMs", workerTiming.workerTotalMs);
        }
        if (outcome.sample.postMessageMs !== undefined) this.dependencies.metrics.recordTiming?.("workerPostMessageMs", outcome.sample.postMessageMs);
        this.handInputMode = outcome.sample.inputMode ?? "full-frame";
        this.handConfidenceMode = outcome.sample.confidenceMode ?? "normal";
        this.dependencies.metrics.recordInference("hands", this.now(), outcome.sample.inferenceMs, workerTiming?.inferenceMs);
        this.lastHandSampleMs = startedAt;
        if (outcome.sample.sampledAtMs === startedAt && this.now() - startedAt <= 150) {
          results.hands = outcome.sample.result;
          handObservation = outcome.sample;
          results.sampledAtMs.hands = outcome.sample.sampledAtMs;
        } else this.workerDroppedSamples++;
      }

      const mappingStartedAt = this.now();
      const frame = mapRawTrackingFrame(videoTimestampMs, results, this.previousFrame);
      const completedAt = this.now();
      if (handObservation) this.dependencies.metrics.recordHandInput?.(handObservation.inputMode ?? "full-frame",
        handObservation.timings?.inferenceMs ?? handObservation.inferenceMs, frame, handObservation.roiReason);
      this.dependencies.metrics.recordTiming?.("mapRawTrackingFrameMs", completedAt - mappingStartedAt);
      this.dependencies.metrics.recordTiming?.("trackingPublishMs", completedAt - startedAt);
      published = true;
      this.previousFrame = frame;
      this.dependencies.metrics.recordPipeline(completedAt, completedAt - startedAt, frame, mainThreadMs);
      this.dependencies.metrics.recordWorkerFrame?.(preparationMs, roundTripMs);
      const onFrameStartedAt = this.now();
      let avatarTiming: AvatarFrameTiming | void = undefined;
      try {
        avatarTiming = this.options.onFrame(frame);
      } catch (error) { this.safeError(error); }
      this.dependencies.metrics.recordTiming?.("onFrameMs", this.now() - onFrameStartedAt);
      if (avatarTiming) this.dependencies.metrics.recordAvatarTiming?.(avatarTiming, startedAt, callbackAt);
      if (generation !== this.generation) return;
      if (completedAt - this.lastMetricsEmitMs >= 500) {
        this.lastMetricsEmitMs = completedAt;
        this.options.onMetrics?.({ ...this.dependencies.metrics.snapshot(this.now(), this.dependencies.runtime.selectedDelegate, this.dependencies.runtime.selectedPoseModel),
          handExecution: this.workerEnabled ? "worker" : "main-thread",
          handDelegate: this.workerEnabled ? this.dependencies.handWorker!.selectedDelegate : this.dependencies.runtime.selectedDelegate,
          handWorkerFallback: this.workerFallback, handWorkerDroppedSamples: this.workerDroppedSamples,
          handInputMode: this.handInputMode, handConfidenceMode: this.handConfidenceMode,
          adaptiveHandAvailable: this.workerEnabled ? this.dependencies.handWorker?.adaptiveAvailable ?? false : this.dependencies.runtime.hasSensitiveHands ?? false,
          runtimeConfig: {
            profile: this.options.profile ?? "full-rate", handIntervalMs: this.options.handIntervalMs ?? 66.7,
            poseIntervalMs: this.options.poseIntervalMs ?? 66.7, parallelHands: !!this.options.parallelHands,
            poseGuidedHands: !!this.options.poseGuidedHands, adaptiveHandConfidence: !!this.options.adaptiveHandConfidence,
            tasks: this.options.tasks ?? { face: true, hands: true, pose: true },
            resolution: this.options.resolution ?? "720p", delegate: this.options.delegate ?? "AUTO",
            poseModel: this.dependencies.runtime.selectedPoseModel ?? null,
            videoWidth: video.videoWidth, videoHeight: video.videoHeight,
            cameraTrackFrameRate: this.cameraSettings?.frameRate ?? null,
          },
        });
      }
    } catch (error) {
      if (generation !== this.generation) return;
      if (this.workerEnabled && capturing && !workerJob) {
        // Bitmap capture is also capability-dependent. Fall back once, visibly.
        try { await this.fallbackHands(error); }
        catch (fallbackError) { if (generation === this.generation) { this.safeError(fallbackError); this.stop(); this.stateValue = "error"; } return; }
        if (generation === this.generation) this.scheduleNext(generation);
        return;
      }
      this.safeError(error);
      this.stop();
      this.stateValue = "error";
      return;
    } finally {
      snapshot?.close();
      // Final wall-clock measurement includes mapping, onFrame, diagnostics and bitmap
      // cleanup. UI snapshots emitted above see this sample at the next metrics tick.
      if (published && generation === this.generation) this.dependencies.metrics.recordTiming?.("totalProcessFrameMs", this.now() - startedAt);
    }
    this.scheduleNext(generation);
  }

  private async fallbackHands(error: unknown): Promise<void> {
    this.workerEnabled = false;
    this.workerFallback = error instanceof Error ? error.message : String(error);
    this.dependencies.handWorker?.dispose();
    await this.dependencies.runtime.initializeHands();
    if (this.options.adaptiveHandConfidence) {
      try { await this.dependencies.runtime.initializeSensitiveHands(); }
      catch { /* Continue with the normal model. */ }
    }
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
