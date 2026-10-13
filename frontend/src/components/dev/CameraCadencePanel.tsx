import { useEffect, useRef, useState, type RefObject } from "react";
import type { TrackingMetricsSnapshot } from "../../lib/tracking/trackingMetrics";
import { VideoCadence } from "./videoCadence";
import "./cameraCadencePanel.css";

export function CameraCadencePanel({ videoRef, running, mode, context, metrics, onReset }: {
  videoRef: RefObject<HTMLVideoElement | null>; running: boolean;
  mode: "camera-only" | "tracking-only" | "tracking-avatar";
  context: Record<string, string | boolean>; metrics?: TrackingMetricsSnapshot | null;
  onReset?: () => boolean;
}) {
  const collector = useRef(new VideoCadence());
  const resetPipelineId = useRef(0);
  const hiddenDuringMeasurement = useRef(false);
  const [sample, setSample] = useState(() => collector.current.snapshot(performance.now()));
  const [resetDone, setResetDone] = useState(false);
  const [supported, setSupported] = useState(false);
  const [scenario, setScenario] = useState("still");
  useEffect(() => {
    if (!running) return;
    const video = videoRef.current;
    collector.current = new VideoCadence(); collector.current.reset(performance.now());
    setResetDone(false); setSample(collector.current.snapshot(performance.now()));
    hiddenDuringMeasurement.current = document.visibilityState !== "visible";
    const available = !!video && typeof video.requestVideoFrameCallback === "function";
    setSupported(available);
    if (!video || !available) return;
    let active = true, callbackId: number;
    const next = () => { callbackId = video.requestVideoFrameCallback((_now, metadata) => {
      if (!active) return;
      collector.current.record(performance.now(), metadata.presentedFrames); next();
    }); };
    next();
    const visibility = () => { if (document.visibilityState !== "visible") hiddenDuringMeasurement.current = true; };
    document.addEventListener("visibilitychange", visibility);
    const timer = window.setInterval(() => setSample(collector.current.snapshot(performance.now())), 500);
    return () => { active = false; video.cancelVideoFrameCallback(callbackId); window.clearInterval(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [running, videoRef]);
  const reset = () => {
    if (mode !== "camera-only" && !onReset?.()) return;
    resetPipelineId.current = metrics?.measurement?.id ?? 0;
    hiddenDuringMeasurement.current = document.visibilityState !== "visible";
    collector.current.reset(performance.now()); setResetDone(true);
    setSample(collector.current.snapshot(performance.now()));
  };
  const download = () => {
    const track = (videoRef.current?.srcObject as MediaStream | null)?.getVideoTracks()[0];
    const settings = track?.getSettings();
    const cadence = collector.current.snapshot(performance.now());
    const invalidReasons = [
      ...(!resetDone ? ["Reset measurement after warm-up first."] : []),
      ...(!supported || cadence.presentedFps === null ? ["Video cadence unavailable."] : []),
      ...(mode !== "camera-only" && (metrics?.measurement?.id ?? 0) <= resetPipelineId.current ? ["Pipeline reset pending."] : []),
      ...(metrics?.handWorkerFallback ? ["Hand worker fallback."] : []),
      ...(["frozen", "simulatedLoss", "recordingActive", "replayActive"].filter(k => context[k] === true).map(k => `${k} active.`)),
      ...(mode === "tracking-avatar" && context.rendererRunning !== true ? ["Renderer stopped."] : []),
      ...(hiddenDuringMeasurement.current ? ["Page hidden during measurement."] : []),
    ];
    const report = { phase: "camera-cadence", schemaVersion: 1, sourceHash: import.meta.env.VITE_MOTION_SOURCE_HASH ?? null,
      capturedAtUtc: new Date().toISOString(), page: window.location.pathname, mode, scenario, context,
      camera: { width: settings?.width, height: settings?.height, configuredFrameRate: settings?.frameRate },
      environment: { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, crossOriginIsolated: globalThis.crossOriginIsolated, devicePixelRatio: window.devicePixelRatio },
      benchmark: { validForControlledComparison: invalidReasons.length === 0, invalidReasons, webcamQualityVerified: false },
      cadence, metrics: mode === "camera-only" ? null : metrics,
      limitations: ["Independent video callback subscription, still shares browser main thread and presentation scheduling.",
        "Presented FPS is not sensor capture FPS; configuredFrameRate is a track setting.",
        "Cadence resets immediately; pipeline resets on next accepted frame. Measurement boundaries can differ.",
        "Equal lighting, movement, visible preview and warm-up require operator verification."] };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `camera-cadence-${mode}-${scenario}-${Date.now()}.json`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="camera-cadence-panel" aria-label="Camera cadence diagnostics">
    <h2>Đo camera / tracking / avatar</h2>
    <p>Chế độ: <b>{mode}</b> · Video presented: <b>{running && sample.presentedFps != null ? sample.presentedFps.toFixed(2) : "—"} FPS</b> · Callback nhận được: {running && sample.callbackFps != null ? sample.callbackFps.toFixed(2) : "—"} Hz</p>
    <p>Đo video độc lập với vòng inference; vẫn chịu ảnh hưởng main thread. Không phải FPS cảm biến. Warm-up 20–30 giây, reset, đo 30 giây rồi export trước Stop.</p>
    <label>Kịch bản <select value={scenario} disabled={running && resetDone} onChange={e => setScenario(e.target.value)}><option value="still">Đứng yên</option><option value="moving">Chuyển động</option></select></label>
    <button disabled={!running} onClick={reset}>Reset camera measurement</button>
    <button disabled={!running || !resetDone || !supported || sample.presentedFps === null} onClick={download}>Xuất camera comparison JSON</button>
    <p role="status">{running ? `${resetDone ? "Đang đo" : "Warm-up — chưa reset"}: ${(sample.durationMs / 1000).toFixed(1)} s` : "Bấm Start để đo."}{running && !supported ? " Trình duyệt không hỗ trợ phép đo video này." : ""}</p>
  </section>;
}
