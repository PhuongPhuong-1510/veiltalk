export type AudioFeatureType = "pcm" | "mfcc" | "log-mel";
export type AudioQualificationBackend = "wasm" | "webgpu";
export type RedistributionStatus = "approved" | "review-required" | "blocked";

export interface AudioVisemeProviderDescriptor {
  modelId: string;
  sampleRateHz: number;
  frameHopMs: number;
  contextMs: number;
  featureType: AudioFeatureType;
  labels: readonly string[];
}

export interface AudioModelQualificationCandidate {
  descriptor: AudioVisemeProviderDescriptor;
  artifact: {
    variant: string;
    expectedBytes: number;
    maximumBytes: number;
    expectedSha256: string;
    sourceUrl: string;
    modelCardUrl: string;
  };
  license: {
    spdx: string;
    sourceUrl: string;
    redistributionStatus: RedistributionStatus;
    note: string;
  };
  probe: {
    inputName: string;
    inputType: "float32";
    inputMetadataShape: readonly (number | null)[];
    inputDimensions: readonly number[];
    outputName: string;
    outputType: "float32";
    outputMetadataShape: readonly (number | null)[];
  };
}

export interface OrtTensorMetadataSnapshot {
  name: string;
  type: string;
  shape: readonly (number | string)[];
}

export interface TimingSummary {
  averageMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface AudioModelBenchmarkResult {
  backend: AudioQualificationBackend;
  wasmThreads: number | null;
  crossOriginIsolated: boolean;
  modelBytes: number;
  sha256: string;
  loadMs: number;
  warmupRuns: number;
  measuredRuns: number;
  inference: TimingSummary;
  inputMetadata: readonly OrtTensorMetadataSnapshot[];
  outputMetadata: readonly OrtTensorMetadataSnapshot[];
  outputDimensions: readonly number[];
}

export interface AudioModelBenchmarkWorkerRequest {
  kind: "benchmark";
  requestId: number;
  candidate: AudioModelQualificationCandidate;
  backend: AudioQualificationBackend;
  wasmThreads: number;
  warmupRuns: number;
  measuredRuns: number;
  minimumMeasureMs: number;
  maximumRuns: number;
  modelBuffer: ArrayBuffer;
}

export type AudioModelBenchmarkWorkerResponse =
  | { kind: "result"; requestId: number; result: AudioModelBenchmarkResult }
  | { kind: "error"; requestId: number; message: string };

export interface QualificationGate {
  name: string;
  status: "pass" | "fail" | "manual";
  detail: string;
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function createUni2005QuantizedCandidate(labels: readonly string[]): AudioModelQualificationCandidate {
  return {
    descriptor: {
      modelId: "KitsuMate/uni2005-onnx:model_quantized",
      sampleRateHz: 8_000,
      frameHopMs: 30,
      contextMs: 960,
      featureType: "mfcc",
      labels: [...labels],
    },
    artifact: {
      variant: "onnx/model_quantized.onnx",
      expectedBytes: 11_225_320,
      maximumBytes: 25 * 1024 * 1024,
      expectedSha256: "b078a37029c2b9e074b0efe699b751d80fc70b325c1648295f290a239399b8af",
      sourceUrl: "https://huggingface.co/KitsuMate/uni2005-onnx/resolve/main/onnx/model_quantized.onnx",
      modelCardUrl: "https://huggingface.co/KitsuMate/uni2005-onnx",
    },
    license: {
      spdx: "GPL-3.0",
      sourceUrl: "https://huggingface.co/KitsuMate/uni2005-onnx/blob/main/LICENSE",
      redistributionStatus: "review-required",
      note: "Chỉ dùng qualification; chưa được phép đóng gói vào production trước khi duyệt nghĩa vụ GPL.",
    },
    probe: {
      inputName: "mfcc",
      inputType: "float32",
      inputMetadataShape: [null, null, 120],
      inputDimensions: [1, 32, 120],
      outputName: "logits",
      outputType: "float32",
      outputMetadataShape: [null, null, 230],
    },
  };
}

export function parseIndexedVocabulary(source: string): readonly string[] {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error("Vocab không phải JSON hợp lệ.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Vocab phải là object token → index.");
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const indexedLabels = new Map<number, string>();
  for (const [label, index] of entries) {
    if (!label || !Number.isInteger(index) || (index as number) < 0) {
      throw new Error("Vocab chứa token hoặc index không hợp lệ.");
    }
    const numericIndex = index as number;
    if (numericIndex > 10_000) throw new Error("Vocab index vượt giới hạn qualification.");
    if (indexedLabels.has(numericIndex)) throw new Error(`Vocab trùng index ${numericIndex}.`);
    indexedLabels.set(numericIndex, label);
  }
  const maximumIndex = Math.max(-1, ...indexedLabels.keys());
  if (!indexedLabels.size || indexedLabels.size !== maximumIndex + 1) {
    throw new Error("Vocab phải có index liên tục từ 0.");
  }
  return Array.from({ length: maximumIndex + 1 }, (_, index) => indexedLabels.get(index)!);
}

export function validateAudioModelCandidate(candidate: AudioModelQualificationCandidate): void {
  const { descriptor, artifact, probe } = candidate;
  for (const [name, value] of [
    ["sampleRateHz", descriptor.sampleRateHz],
    ["frameHopMs", descriptor.frameHopMs],
    ["contextMs", descriptor.contextMs],
    ["expectedBytes", artifact.expectedBytes],
    ["maximumBytes", artifact.maximumBytes],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} phải hữu hạn và lớn hơn 0.`);
  }
  if (!descriptor.modelId || !probe.inputName || !probe.outputName) throw new Error("Candidate thiếu model/input/output ID.");
  if (!SHA256_PATTERN.test(artifact.expectedSha256)) throw new Error("Candidate SHA-256 không hợp lệ.");
  if (artifact.expectedBytes > artifact.maximumBytes) throw new Error("Candidate vượt model size budget.");
  if (!descriptor.labels.length) throw new Error("Candidate chưa có label inventory.");
  const outputWidth = probe.outputMetadataShape.at(-1);
  if (outputWidth !== descriptor.labels.length) {
    throw new Error(`Vocab ${descriptor.labels.length} labels không khớp output width ${String(outputWidth)}.`);
  }
  if (probe.inputDimensions.some((dimension) => !Number.isInteger(dimension) || dimension <= 0)) {
    throw new Error("Probe input dimensions phải là số nguyên dương.");
  }
}

export function summarizeDurations(samples: readonly number[]): TimingSummary {
  if (!samples.length || samples.some((sample) => !Number.isFinite(sample) || sample < 0)) {
    throw new Error("Benchmark timings phải là danh sách số hữu hạn không âm.");
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const percentile = (ratio: number) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
  return {
    averageMs: samples.reduce((sum, sample) => sum + sample, 0) / samples.length,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: sorted[sorted.length - 1],
  };
}

function metadataMatches(
  metadata: readonly OrtTensorMetadataSnapshot[],
  name: string,
  type: string,
  expectedShape: readonly (number | null)[],
): boolean {
  const tensor = metadata.find((entry) => entry.name === name);
  if (!tensor || tensor.type !== type || tensor.shape.length !== expectedShape.length) return false;
  return expectedShape.every((expected, index) => expected === null || tensor.shape[index] === expected);
}

export function evaluateAudioModelQualification(
  candidate: AudioModelQualificationCandidate,
  result: AudioModelBenchmarkResult,
): readonly QualificationGate[] {
  const inputMatches = metadataMatches(
    result.inputMetadata,
    candidate.probe.inputName,
    candidate.probe.inputType,
    candidate.probe.inputMetadataShape,
  );
  const outputMatches = metadataMatches(
    result.outputMetadata,
    candidate.probe.outputName,
    candidate.probe.outputType,
    candidate.probe.outputMetadataShape,
  );
  const outputRuntimeMatches = candidate.probe.outputMetadataShape.length === result.outputDimensions.length
    && candidate.probe.outputMetadataShape.every((expected, index) => expected === null || expected === result.outputDimensions[index]);

  return [
    {
      name: "artifact-size",
      status: result.modelBytes === candidate.artifact.expectedBytes && result.modelBytes <= candidate.artifact.maximumBytes ? "pass" : "fail",
      detail: `${result.modelBytes} bytes; expected ${candidate.artifact.expectedBytes}; max ${candidate.artifact.maximumBytes}`,
    },
    {
      name: "artifact-sha256",
      status: result.sha256.toLowerCase() === candidate.artifact.expectedSha256 ? "pass" : "fail",
      detail: result.sha256.toLowerCase(),
    },
    {
      name: "onnx-contract",
      status: inputMatches && outputMatches && outputRuntimeMatches ? "pass" : "fail",
      detail: `input ${inputMatches ? "ok" : "mismatch"}; output metadata ${outputMatches ? "ok" : "mismatch"}; runtime ${outputRuntimeMatches ? "ok" : "mismatch"}`,
    },
    {
      name: "inference-p95",
      status: result.inference.p95Ms <= 25 ? "pass" : "fail",
      detail: `${result.inference.p95Ms.toFixed(2)} ms; budget 25 ms`,
    },
    {
      name: "license-redistribution",
      status: candidate.license.redistributionStatus === "approved" ? "pass" : "manual",
      detail: `${candidate.license.spdx}: ${candidate.license.note}`,
    },
    {
      name: "vietnamese-viseme-fixtures",
      status: "manual",
      detail: "Chưa có MFCC + phone→viseme mapper và fixture giọng Việt trong F5-0.",
    },
  ];
}
