import type {
  AudioModelBenchmarkResult,
  AudioModelBenchmarkWorkerRequest,
  AudioModelBenchmarkWorkerResponse,
  AudioModelQualificationCandidate,
  AudioQualificationBackend,
} from "./audioModelQualification";

export interface AudioQualificationRunOptions {
  candidate: AudioModelQualificationCandidate;
  backend: AudioQualificationBackend;
  wasmThreads: number;
  modelBuffer: ArrayBuffer;
  warmupRuns?: number;
  measuredRuns?: number;
  minimumMeasureMs?: number;
  maximumRuns?: number;
  timeoutMs?: number;
}

let nextRequestId = 0;

export function runAudioModelQualification(options: AudioQualificationRunOptions): Promise<AudioModelBenchmarkResult> {
  const worker = new Worker(new URL("./audioQualification.worker.ts", import.meta.url), {
    type: "module",
    name: "veil-talk-audio-model-qualification",
  });
  const requestId = ++nextRequestId;
  const timeoutMs = options.timeoutMs ?? 60_000;

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      worker.terminate();
      reject(new Error(`Audio model benchmark quá hạn ${timeoutMs} ms.`));
    }, timeoutMs);
    const finish = () => {
      window.clearTimeout(timeout);
      worker.terminate();
    };

    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || "Audio qualification Worker lỗi."));
    };
    worker.onmessage = (event: MessageEvent<AudioModelBenchmarkWorkerResponse>) => {
      const response = event.data;
      if (response.requestId !== requestId) return;
      finish();
      if (response.kind === "error") reject(new Error(response.message));
      else resolve(response.result);
    };

    const request: AudioModelBenchmarkWorkerRequest = {
      kind: "benchmark",
      requestId,
      candidate: options.candidate,
      backend: options.backend,
      wasmThreads: options.wasmThreads,
      warmupRuns: options.warmupRuns ?? 3,
      measuredRuns: options.measuredRuns ?? 60,
      minimumMeasureMs: options.minimumMeasureMs ?? 5_000,
      maximumRuns: options.maximumRuns ?? 5_000,
      modelBuffer: options.modelBuffer,
    };
    worker.postMessage(request, [request.modelBuffer]);
  });
}
