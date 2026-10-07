import type { ConfiguredDelegate, DelegateSelection } from "./mediaPipeRuntime";
import type { HandTrackingExecutor, HandWorkerRequest, HandWorkerResponse, HandWorkerSample } from "./handWorkerProtocol";
import type { HandPoseHint } from "./poseGuidedHandInput";

type WorkerHandle = Pick<Worker, "postMessage" | "terminate" | "onmessage" | "onerror" | "onmessageerror">;
interface Pending {
  id: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (value: HandWorkerResponse) => void;
  reject: (reason: Error) => void;
}

/** Persistent, bounded request/response transport. Termination invalidates all old results. */
export class HandTrackingWorker implements HandTrackingExecutor {
  private worker: WorkerHandle | null = null;
  private pending: Pending | null = null;
  private nextId = 0;
  selectedDelegate: ConfiguredDelegate | null = null;
  adaptiveAvailable = false;
  private readonly assetBase: string;
  private readonly delegate: DelegateSelection;
  private readonly createWorker: () => WorkerHandle;
  private readonly timeoutMs: number;
  private readonly adaptiveHandConfidence: boolean;

  constructor(
    assetBase: string,
    delegate: DelegateSelection = "AUTO",
    createWorker: () => WorkerHandle = () => new Worker(new URL("./handTracking.worker.ts", import.meta.url), { type: "module", name: "veiltalk-hands" }),
    timeoutMs = 350,
    adaptiveHandConfidence = false,
  ) { this.assetBase = assetBase; this.delegate = delegate; this.createWorker = createWorker; this.timeoutMs = timeoutMs; this.adaptiveHandConfidence = adaptiveHandConfidence; }

  async initialize(): Promise<void> {
    if (this.selectedDelegate) return;
    this.worker = this.createWorker();
    this.worker.onmessage = (event: MessageEvent<HandWorkerResponse>) => {
      const response = event.data, pending = this.pending;
      if (!pending || response.id !== pending.id) return;
      clearTimeout(pending.timer); this.pending = null;
      if (response.kind === "error") pending.reject(new Error(response.message));
      else pending.resolve(response);
    };
    this.worker.onerror = (event) => { event.preventDefault(); this.fail(new Error(event.message || "Hand worker lỗi.")); };
    this.worker.onmessageerror = () => this.fail(new Error("Không đọc được kết quả Hand worker."));
    try {
      const response = await this.request({ kind: "initialize", id: ++this.nextId, assetBase: this.assetBase, delegate: this.delegate, adaptiveHandConfidence: this.adaptiveHandConfidence }, 30_000);
      if (response.kind !== "ready" || !this.worker) throw new Error("Hand worker trả sai phản hồi khởi tạo hoặc đã dừng.");
      this.selectedDelegate = response.delegate;
      this.adaptiveAvailable = response.adaptiveAvailable ?? false;
    } catch (error) { this.dispose(); throw error; }
  }

  async detect(bitmap: ImageBitmap, timestampMs: number, sampledAtMs: number, poseHint?: HandPoseHint | null, poseGuidedHands = false): Promise<HandWorkerSample> {
    if (!this.selectedDelegate || !this.worker || this.pending) {
      bitmap.close(); throw new Error("Hand worker chưa sẵn sàng hoặc đang bận.");
    }
    const response = await this.request({ kind: "detect", id: ++this.nextId, bitmap, timestampMs, sampledAtMs, poseHint, poseGuidedHands }, this.timeoutMs, bitmap);
    if (response.kind !== "result" || response.sampledAtMs !== sampledAtMs) throw new Error("Hand worker trả sai frame.");
    return response;
  }

  dispose(): void { this.fail(new Error("Hand worker đã dừng.")); }

  private fail(reason: Error): void {
    const pending = this.pending;
    this.pending = null;
    if (pending) { clearTimeout(pending.timer); pending.reject(reason); }
    this.worker?.terminate(); this.worker = null; this.selectedDelegate = null; this.adaptiveAvailable = false;
  }

  private request(message: HandWorkerRequest, timeoutMs: number, bitmap?: ImageBitmap): Promise<HandWorkerResponse> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error(`Hand worker quá hạn ${timeoutMs} ms.`)), timeoutMs);
      this.pending = { id: message.id, timer, resolve, reject };
      try { this.worker!.postMessage(message, bitmap ? [bitmap] : []); }
      catch (error) { bitmap?.close(); this.fail(error instanceof Error ? error : new Error(String(error))); }
    });
  }
}
