import type { ConfiguredDelegate, DelegateSelection } from "./mediaPipeRuntime";
import type { HandTrackingExecutor, HandWorkerRequest, HandWorkerResponse, HandWorkerSample, HandWorkerExperiments } from "./handWorkerProtocol";
import type { HandPoseHint } from "./poseGuidedHandInput";

type WorkerHandle = Pick<Worker, "postMessage" | "terminate" | "onmessage" | "onerror" | "onmessageerror">;
interface Pending {
  id: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (value: HandWorkerResponse) => void;
  reject: (reason: Error) => void;
  postMessageMs: number;
}

/** Persistent, bounded request/response transport. Termination invalidates all old results. */
export class HandTrackingWorker implements HandTrackingExecutor {
  private worker: WorkerHandle | null = null;
  private pending: Pending | null = null;
  private initPromise: Promise<void> | null = null;
  private lastTimestampMs = -Infinity;
  private lastSampledAtMs = -Infinity;
  private nextId = 0;
  selectedDelegate: ConfiguredDelegate | null = null;
  adaptiveAvailable = false;
  private readonly assetBase: string;
  private readonly delegate: DelegateSelection;
  private readonly createWorker: () => WorkerHandle;
  private readonly timeoutMs: number;
  private readonly adaptiveHandConfidence: boolean;
  private readonly experiments: HandWorkerExperiments;

  constructor(
    assetBase: string,
    delegate: DelegateSelection = "AUTO",
    createWorker: () => WorkerHandle = () => new Worker(new URL("./handTracking.worker.ts", import.meta.url), { type: "module", name: "veiltalk-hands" }),
    timeoutMs = 350,
    adaptiveHandConfidence = false,
    experiments: HandWorkerExperiments = {},
  ) { this.assetBase = assetBase; this.delegate = delegate; this.createWorker = createWorker; this.timeoutMs = timeoutMs; this.adaptiveHandConfidence = adaptiveHandConfidence; this.experiments = experiments; }

  async initialize(): Promise<void> {
    if (this.selectedDelegate) return;
    if (this.initPromise) return this.initPromise;
    const worker = this.createWorker();
    this.worker = worker;
    worker.onmessage = (event: MessageEvent<HandWorkerResponse>) => {
      if (this.worker !== worker) return;
      const response = event.data, pending = this.pending;
      if (!pending || response.id !== pending.id) return;
      clearTimeout(pending.timer); this.pending = null;
      if (response.kind === "error") pending.reject(new Error(response.message));
      else pending.resolve(response.kind === "result" ? { ...response, postMessageMs: pending.postMessageMs } : response);
    };
    worker.onerror = (event) => { event.preventDefault(); if (this.worker === worker) this.fail(new Error(event.message || "Hand worker lỗi.")); };
    worker.onmessageerror = () => { if (this.worker === worker) this.fail(new Error("Không đọc được kết quả Hand worker.")); };
    const initialization = this.request({ kind: "initialize", id: ++this.nextId, assetBase: this.assetBase, delegate: this.delegate, adaptiveHandConfidence: this.adaptiveHandConfidence, experiments: this.experiments }, 30_000).then(response => {
      if (response.kind !== "ready" || this.worker !== worker) throw new Error("Hand worker trả sai phản hồi khởi tạo hoặc đã dừng.");
      this.selectedDelegate = response.delegate;
      this.adaptiveAvailable = response.adaptiveAvailable ?? false;
    }).catch(error => { if (this.worker === worker) this.dispose(); throw error; }).finally(() => {
      if (this.initPromise === initialization) this.initPromise = null;
    });
    this.initPromise = initialization;
    return initialization;
  }

  async detect(bitmap: ImageBitmap, timestampMs: number, sampledAtMs: number, poseHint?: HandPoseHint | null, poseGuidedHands = false): Promise<HandWorkerSample> {
    if (!this.selectedDelegate || !this.worker || this.pending) {
      bitmap.close(); throw new Error("Hand worker chưa sẵn sàng hoặc đang bận.");
    }
    if (!Number.isFinite(timestampMs) || !Number.isFinite(sampledAtMs)
      || timestampMs <= this.lastTimestampMs || sampledAtMs <= this.lastSampledAtMs) {
      bitmap.close(); throw new Error("Hand worker từ chối timestamp trùng hoặc đảo thứ tự.");
    }
    this.lastTimestampMs = timestampMs; this.lastSampledAtMs = sampledAtMs;
    const response = await this.request({ kind: "detect", id: ++this.nextId, bitmap, timestampMs, sampledAtMs, poseHint, poseGuidedHands }, this.timeoutMs, bitmap);
    if (response.kind !== "result" || response.timestampMs !== timestampMs || response.sampledAtMs !== sampledAtMs) throw new Error("Hand worker trả sai frame.");
    return response;
  }

  dispose(): void { this.fail(new Error("Hand worker đã dừng.")); }

  private fail(reason: Error): void {
    const pending = this.pending;
    this.pending = null;
    this.initPromise = null;
    if (pending) { clearTimeout(pending.timer); pending.reject(reason); }
    this.worker?.terminate(); this.worker = null; this.selectedDelegate = null; this.adaptiveAvailable = false;
  }

  private request(message: HandWorkerRequest, timeoutMs: number, bitmap?: ImageBitmap): Promise<HandWorkerResponse> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending?.id === message.id) this.fail(new Error(`Hand worker quá hạn ${timeoutMs} ms.`));
      }, timeoutMs);
      const pending = { id: message.id, timer, resolve, reject, postMessageMs: 0 };
      this.pending = pending;
      try {
        const startedAt = performance.now();
        this.worker!.postMessage(message, bitmap ? [bitmap] : []);
        pending.postMessageMs = performance.now() - startedAt;
      }
      catch (error) { bitmap?.close(); this.fail(error instanceof Error ? error : new Error(String(error))); }
    });
  }
}
