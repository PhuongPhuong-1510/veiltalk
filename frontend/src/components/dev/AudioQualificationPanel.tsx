import { useEffect, useRef, useState } from "react";
import {
  createUni2005QuantizedCandidate,
  evaluateAudioModelQualification,
  parseIndexedVocabulary,
  validateAudioModelCandidate,
  type AudioModelBenchmarkResult,
  type AudioQualificationBackend,
  type QualificationGate,
} from "../../lib/audio-lipsync/audioModelQualification";
import { runAudioModelQualification } from "../../lib/audio-lipsync/audioQualificationController";
import "./audioQualificationPanel.css";

export interface AudioQualificationAppMetrics {
  rendererFps: number | null;
  trackingFps: number | null;
  pipelineFps: number | null;
  processorToDrawMs: number | null;
  trackingToRenderMs: number | null;
}

interface QualificationReport {
  benchmark: AudioModelBenchmarkResult;
  gates: readonly QualificationGate[];
  before: AudioQualificationAppMetrics;
  after: AudioQualificationAppMetrics;
}

function number(value: number | null, digits = 1): string {
  return value === null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

function wholeAppGates(metrics: AudioQualificationAppMetrics): readonly QualificationGate[] {
  const available = [metrics.rendererFps, metrics.trackingFps, metrics.pipelineFps]
    .filter((value): value is number => value !== null && value > 0);
  if (available.length < 3) {
    return [
      { name: "whole-app-fps", status: "manual", detail: "Hãy bật renderer và tracking trước khi benchmark." },
      { name: "tracking-to-render", status: "manual", detail: "Chưa có LIVE pose-age metric." },
    ];
  }
  const minimum = Math.min(...available);
  return [
    {
      name: "whole-app-fps",
      status: minimum >= 24 ? "pass" : "fail",
      detail: `renderer/tracking/pipeline ${number(metrics.rendererFps)}/${number(metrics.trackingFps)}/${number(metrics.pipelineFps)} FPS; min 24`,
    },
    metrics.trackingToRenderMs === null
      ? { name: "tracking-to-render", status: "manual", detail: "Chưa có LIVE pose-age metric." }
      : {
        name: "tracking-to-render",
        status: metrics.trackingToRenderMs < 100 ? "pass" : "fail",
        detail: `${number(metrics.trackingToRenderMs)} ms; budget <100 ms; không đo khi Frozen`,
      },
  ];
}

export function AudioQualificationPanel({ metrics }: { metrics: AudioQualificationAppMetrics }) {
  const latestMetrics = useRef(metrics);
  const [modelFile, setModelFile] = useState<File | null>(null);
  const [vocabFile, setVocabFile] = useState<File | null>(null);
  const [backend, setBackend] = useState<AudioQualificationBackend>("wasm");
  const [wasmThreads, setWasmThreads] = useState(1);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<QualificationReport | null>(null);
  const webGpuAvailable = typeof navigator !== "undefined" && "gpu" in navigator;
  const isolated = globalThis.crossOriginIsolated === true;

  useEffect(() => { latestMetrics.current = metrics; }, [metrics]);

  async function runQualification() {
    if (!modelFile || !vocabFile || running) return;
    setRunning(true);
    setError(null);
    setReport(null);
    try {
      const labels = parseIndexedVocabulary(await vocabFile.text());
      const candidate = createUni2005QuantizedCandidate(labels);
      validateAudioModelCandidate(candidate);
      const before = { ...latestMetrics.current };
      const benchmark = await runAudioModelQualification({
        candidate,
        backend,
        wasmThreads,
        modelBuffer: await modelFile.arrayBuffer(),
      });
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      const after = { ...latestMetrics.current };
      setReport({
        benchmark,
        before,
        after,
        gates: [...evaluateAudioModelQualification(candidate, benchmark), ...wholeAppGates(after)],
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Không thể benchmark model.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <article className="audio-qualification-panel">
      <h2>F5-0 audio model qualification</h2>
      <p><strong>LOCAL FILES ONLY.</strong> File được đọc trong browser, không upload, không lưu và chưa nối facial pipeline.</p>
      <p>Candidate: Uni2005 INT8 · expected 11,225,320 bytes · GPL-3.0 <strong>review-required</strong>.</p>
      <p>Đã tải local tại <code>frontend/dev-assets/audio/candidates/uni2005-int8/</code>.</p>
      <p><a href="https://huggingface.co/KitsuMate/uni2005-onnx" target="_blank" rel="noreferrer">Model card + tải model/vocab</a></p>
      <label>ONNX candidate
        <input type="file" accept=".onnx,application/octet-stream" onChange={(event) => setModelFile(event.target.files?.[0] ?? null)} />
      </label>
      <label>Vocab token→index
        <input type="file" accept=".json,application/json" onChange={(event) => setVocabFile(event.target.files?.[0] ?? null)} />
      </label>
      <div className="audio-qualification-options">
        <label>Backend
          <select value={backend} onChange={(event) => setBackend(event.target.value as AudioQualificationBackend)}>
            <option value="wasm">WASM</option>
            <option value="webgpu" disabled={!webGpuAvailable}>WebGPU {!webGpuAvailable ? "(không hỗ trợ)" : ""}</option>
          </select>
        </label>
        <label>WASM threads
          <select value={wasmThreads} disabled={backend !== "wasm"} onChange={(event) => setWasmThreads(Number(event.target.value))}>
            <option value={1}>1</option>
            <option value={2} disabled={!isolated}>2 {!isolated ? "(cần cross-origin isolation)" : ""}</option>
            <option value={0}>auto</option>
          </select>
        </label>
        <button disabled={!modelFile || !vocabFile || running} onClick={() => void runQualification()}>
          {running ? "Đang benchmark…" : "Run 3 warmup + ≥5s measured"}
        </button>
      </div>
      <p>Cross-origin isolated: <strong>{isolated ? "yes — cho phép benchmark nhiều WASM thread" : "no — chỉ tin kết quả 1 thread"}</strong></p>
      <p>App hiện tại — renderer/tracking/pipeline: <strong>{number(metrics.rendererFps)} / {number(metrics.trackingFps)} / {number(metrics.pipelineFps)} FPS</strong></p>
      {error && <p className="audio-qualification-error" role="alert">{error}</p>}
      {report && <>
        <p>Backend: <strong>{report.benchmark.backend}{report.benchmark.wasmThreads === null ? "" : `/${report.benchmark.wasmThreads || "auto"}`}</strong> · cross-origin isolated: {report.benchmark.crossOriginIsolated ? "yes" : "no"}</p>
        <p>Load {number(report.benchmark.loadMs)} ms · {report.benchmark.measuredRuns} runs · inference avg/p50/p95/max: <strong>{number(report.benchmark.inference.averageMs, 2)} / {number(report.benchmark.inference.p50Ms, 2)} / {number(report.benchmark.inference.p95Ms, 2)} / {number(report.benchmark.inference.maxMs, 2)} ms</strong></p>
        <p>FPS trước → sau: renderer {number(report.before.rendererFps)} → {number(report.after.rendererFps)} · tracking {number(report.before.trackingFps)} → {number(report.after.trackingFps)} · pipeline {number(report.before.pipelineFps)} → {number(report.after.pipelineFps)}</p>
        <ul>{report.gates.map((gate) => <li className={`gate-${gate.status}`} key={gate.name}><strong>{gate.status.toUpperCase()}</strong> {gate.name}: {gate.detail}</li>)}</ul>
        <details><summary>Numeric audit (không có PCM)</summary><pre>{JSON.stringify(report.benchmark, null, 2)}</pre></details>
      </>}
    </article>
  );
}
