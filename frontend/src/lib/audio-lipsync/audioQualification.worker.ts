import type { InferenceSession } from "onnxruntime-web";
import {
  summarizeDurations,
  validateAudioModelCandidate,
  type AudioModelBenchmarkWorkerRequest,
  type AudioModelBenchmarkWorkerResponse,
  type OrtTensorMetadataSnapshot,
} from "./audioModelQualification";

interface QualificationWorkerScope {
  onmessage: ((event: MessageEvent<AudioModelBenchmarkWorkerRequest>) => void) | null;
  postMessage(message: AudioModelBenchmarkWorkerResponse): void;
}

const workerScope = self as unknown as QualificationWorkerScope;

function finiteInteger(value: number, name: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} phải là số nguyên trong [${minimum}, ${maximum}].`);
  }
  return value;
}

function metadataSnapshot(metadata: readonly InferenceSession.ValueMetadata[]): readonly OrtTensorMetadataSnapshot[] {
  return metadata.map((entry) => entry.isTensor
    ? { name: entry.name, type: entry.type, shape: [...entry.shape] }
    : { name: entry.name, type: "non-tensor", shape: [] });
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

workerScope.onmessage = (event) => {
  const request = event.data;
  if (request.kind !== "benchmark") return;
  void runBenchmark(request).then(
    (result) => workerScope.postMessage({ kind: "result", requestId: request.requestId, result }),
    (error: unknown) => workerScope.postMessage({
      kind: "error",
      requestId: request.requestId,
      message: error instanceof Error ? error.message : "Audio model benchmark thất bại.",
    }),
  );
};

async function runBenchmark(request: AudioModelBenchmarkWorkerRequest) {
  validateAudioModelCandidate(request.candidate);
  const warmupRuns = finiteInteger(request.warmupRuns, "warmupRuns", 1, 20);
  const measuredRuns = finiteInteger(request.measuredRuns, "measuredRuns", 5, 300);
  const minimumMeasureMs = finiteInteger(request.minimumMeasureMs, "minimumMeasureMs", 0, 30_000);
  const maximumRuns = finiteInteger(request.maximumRuns, "maximumRuns", measuredRuns, 10_000);
  const wasmThreads = finiteInteger(request.wasmThreads, "wasmThreads", 0, 16);
  const modelBytes = request.modelBuffer.byteLength;
  const digest = await sha256(request.modelBuffer);

  const runtime = request.backend === "webgpu"
    ? await import("onnxruntime-web/webgpu")
    : await import("onnxruntime-web");
  if (request.backend === "wasm") runtime.env.wasm.numThreads = wasmThreads;

  const loadStartedAt = performance.now();
  const session = await runtime.InferenceSession.create(request.modelBuffer, {
    executionProviders: [request.backend],
    graphOptimizationLevel: "all",
  });
  const loadMs = performance.now() - loadStartedAt;

  try {
    const { probe } = request.candidate;
    const elementCount = probe.inputDimensions.reduce((total, dimension) => total * dimension, 1);
    const input = new runtime.Tensor(probe.inputType, new Float32Array(elementCount), [...probe.inputDimensions]);
    const feeds = { [probe.inputName]: input };

    for (let index = 0; index < warmupRuns; index += 1) await session.run(feeds);

    const timings: number[] = [];
    let outputDimensions: readonly number[] = [];
    const measurementStartedAt = performance.now();
    for (let index = 0; index < maximumRuns; index += 1) {
      const startedAt = performance.now();
      const output = await session.run(feeds);
      timings.push(performance.now() - startedAt);
      const tensor = output[probe.outputName];
      if (!tensor) throw new Error(`Model không trả output ${probe.outputName}.`);
      outputDimensions = [...tensor.dims];
      if (timings.length >= measuredRuns && performance.now() - measurementStartedAt >= minimumMeasureMs) break;
    }

    return {
      backend: request.backend,
      wasmThreads: request.backend === "wasm" ? wasmThreads : null,
      crossOriginIsolated: globalThis.crossOriginIsolated === true,
      modelBytes,
      sha256: digest,
      loadMs,
      warmupRuns,
      measuredRuns: timings.length,
      inference: summarizeDurations(timings),
      inputMetadata: metadataSnapshot(session.inputMetadata),
      outputMetadata: metadataSnapshot(session.outputMetadata),
      outputDimensions,
    };
  } finally {
    await session.release();
  }
}
