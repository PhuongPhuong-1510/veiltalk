import { describe, expect, it } from "vitest";
import {
  createUni2005QuantizedCandidate,
  evaluateAudioModelQualification,
  parseIndexedVocabulary,
  summarizeDurations,
  validateAudioModelCandidate,
  type AudioModelBenchmarkResult,
} from "./audioModelQualification";

const labels = Array.from({ length: 230 }, (_, index) => index === 0 ? "<blank>" : `phone-${index}`);

function result(): AudioModelBenchmarkResult {
  return {
    backend: "wasm",
    wasmThreads: 2,
    crossOriginIsolated: true,
    modelBytes: 11_225_320,
    sha256: "b078a37029c2b9e074b0efe699b751d80fc70b325c1648295f290a239399b8af",
    loadMs: 400,
    warmupRuns: 3,
    measuredRuns: 30,
    inference: { averageMs: 20, p50Ms: 19, p95Ms: 24, maxMs: 28 },
    inputMetadata: [{ name: "mfcc", type: "float32", shape: ["batch", "time", 120] }],
    outputMetadata: [{ name: "logits", type: "float32", shape: ["batch", "time", 230] }],
    outputDimensions: [1, 32, 230],
  };
}

describe("F5-0 audio model qualification", () => {
  it("parses a contiguous token-to-index vocabulary in index order", () => {
    expect(parseIndexedVocabulary('{"b":2,"<blank>":0,"a":1}')).toEqual(["<blank>", "a", "b"]);
    expect(() => parseIndexedVocabulary('{"<blank>":0,"b":2}')).toThrow(/liên tục/);
    expect(() => parseIndexedVocabulary('{"a":0,"b":0}')).toThrow(/trùng index/);
  });

  it("locks the measured Uni2005 INT8 artifact contract", () => {
    const candidate = createUni2005QuantizedCandidate(labels);
    expect(() => validateAudioModelCandidate(candidate)).not.toThrow();
    expect(candidate.probe.inputDimensions).toEqual([1, 32, 120]);
    expect(candidate.probe.outputMetadataShape).toEqual([null, null, 230]);
    expect(candidate.license.redistributionStatus).toBe("review-required");
  });

  it("rejects a missing or mismatched label inventory", () => {
    expect(() => validateAudioModelCandidate(createUni2005QuantizedCandidate([]))).toThrow(/label inventory/);
    expect(() => validateAudioModelCandidate(createUni2005QuantizedCandidate(labels.slice(1)))).toThrow(/không khớp/);
  });

  it("computes deterministic percentile statistics", () => {
    expect(summarizeDurations([4, 1, 3, 2, 100])).toEqual({
      averageMs: 22,
      p50Ms: 3,
      p95Ms: 100,
      maxMs: 100,
    });
    expect(() => summarizeDurations([])).toThrow(/timings/);
    expect(() => summarizeDurations([1, Number.NaN])).toThrow(/timings/);
  });

  it("separates automatic graph/performance gates from manual license/language gates", () => {
    const gates = evaluateAudioModelQualification(createUni2005QuantizedCandidate(labels), result());
    expect(gates.find((gate) => gate.name === "artifact-sha256")?.status).toBe("pass");
    expect(gates.find((gate) => gate.name === "onnx-contract")?.status).toBe("pass");
    expect(gates.find((gate) => gate.name === "inference-p95")?.status).toBe("pass");
    expect(gates.find((gate) => gate.name === "license-redistribution")?.status).toBe("manual");
    expect(gates.find((gate) => gate.name === "vietnamese-viseme-fixtures")?.status).toBe("manual");
  });

  it("fails changed artifacts, graph shapes and slow inference", () => {
    const changed = result();
    changed.sha256 = "0".repeat(64);
    changed.inference = { ...changed.inference, p95Ms: 25.01 };
    changed.outputMetadata = [{ name: "logits", type: "float32", shape: ["batch", "time", 229] }];
    const gates = evaluateAudioModelQualification(createUni2005QuantizedCandidate(labels), changed);
    expect(gates.find((gate) => gate.name === "artifact-sha256")?.status).toBe("fail");
    expect(gates.find((gate) => gate.name === "onnx-contract")?.status).toBe("fail");
    expect(gates.find((gate) => gate.name === "inference-p95")?.status).toBe("fail");
  });
});
