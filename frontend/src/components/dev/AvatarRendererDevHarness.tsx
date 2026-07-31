import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { AvatarCanvas } from "../avatar/AvatarCanvas";
import { AvatarMotionProcessor } from "../../lib/avatar-motion/avatarMotionProcessor";
import type { AvatarPosePacketV1 } from "../../lib/avatar-motion/avatarPoseTypes";
import type { AvatarMotionDiagnosticSnapshot } from "../../lib/avatar-motion/avatarMotionDiagnostics";
import type { AvatarRenderer } from "../../lib/avatar-renderer/avatarRenderer";
import { clearDiagnosticHelpers, createDiagnosticHelpers, elbowPlaneNormal, updateDiagnosticHelpers } from "../../lib/avatar-renderer/avatarDiagnostics";
import type { ModelCapabilityReport } from "../../lib/avatar-renderer/modelTypes";
import type { RendererMetricsSnapshot } from "../../lib/avatar-renderer/rendererMetrics";
import { isCurrentModelLoadRequest } from "../../lib/avatar-renderer/modelLoader";
import type { RawTrackingFrameV1 } from "../../lib/tracking/rawTrackingTypes";
import type { TrackingMetricsSnapshot } from "../../lib/tracking/trackingMetrics";
import { useTracking } from "../../lib/tracking/useTracking";
import { DEFAULT_POSE_MODEL, type PoseModelVariant } from "../../lib/tracking/mediaPipeRuntime";
import "./avatarRendererDevHarness.css";

const MODEL_URL = "/models/avatars/reference-avatar-2.vrm";
const DIAGNOSTIC_CONVERSION = "current" as const;
const number = (value: number | null | undefined, digits = 1) => value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits);

export default function AvatarRendererDevHarness() {
  const videoRef = useRef<HTMLVideoElement>(null); const rendererRef = useRef<AvatarRenderer | null>(null); const helpersRef = useRef<Group | null>(null);
  const modelLoadRequestRef = useRef(0);
  const freezeTimerRef = useRef<number | null>(null);
  const processorRef = useRef(new AvatarMotionProcessor()); const latestPacket = useRef<AvatarPosePacketV1 | null>(null); const latestRaw = useRef<RawTrackingFrameV1 | null>(null); const frozenRaw = useRef<RawTrackingFrameV1 | null>(null);
  const [filtered, setFiltered] = useState(true); const [constraints, setConstraints] = useState(true); const [smoothing, setSmoothing] = useState(true);
  const [handTwistEnabled, setHandTwistEnabled] = useState(true);
  const [helpers, setHelpers] = useState(false); const [frozen, setFrozen] = useState(false);
  const [sampleName, setSampleName] = useState("live"); const [frozenSequence, setFrozenSequence] = useState(0);
  const [freezeCountdown, setFreezeCountdown] = useState<number | null>(null);
  const [simulatedLoss, setSimulatedLoss] = useState(false); const [trackingRunning, setTrackingRunning] = useState(false); const [rendererRunning, setRendererRunning] = useState(true);
  const [poseModel, setPoseModel] = useState<PoseModelVariant>(DEFAULT_POSE_MODEL);
  const [zoom, setZoom] = useState(1); const [verticalOffset, setVerticalOffset] = useState(0);
  const [error, setError] = useState<string | null>(null); const [capability, setCapability] = useState<ModelCapabilityReport | null>(null); const [packet, setPacket] = useState<AvatarPosePacketV1 | null>(null);
  const [planeNormals, setPlaneNormals] = useState<Record<string, unknown>>({});
  const [motionDiagnostics, setMotionDiagnostics] = useState<AvatarMotionDiagnosticSnapshot | null>(null);
  const [rendererMetrics, setRendererMetrics] = useState<RendererMetricsSnapshot | null>(null); const [trackingMetrics, setTrackingMetrics] = useState<TrackingMetricsSnapshot | null>(null);
  const [modelLoading, setModelLoading] = useState(false);

  const processInput = useCallback((frame: RawTrackingFrameV1) => {
    const input = simulatedLoss ? { ...frame, face: { ...frame.face, state: "lost" as const }, leftHand: { ...frame.leftHand, state: "lost" as const }, rightHand: { ...frame.rightHand, state: "lost" as const }, pose: { ...frame.pose, state: "lost" as const } } : frame;
    const next = processorRef.current.process(input); latestPacket.current = next; rendererRef.current?.applyPose(next);
  }, [simulatedLoss]);
  const onFrame = useCallback((frame: RawTrackingFrameV1) => { if (frozenRaw.current) return; latestRaw.current = frame; processInput(frame); }, [processInput]);
  const onMetrics = useCallback((value: TrackingMetricsSnapshot) => { setTrackingMetrics(value); }, []);
  const onError = useCallback((reason: unknown) => setError(reason instanceof Error ? reason.message : "Tracking error"), []);
  // Đổi model pose phải dựng lại pipeline (useTracking dispose theo options), nên tracking sẽ
  // dừng khi chuyển lite↔full — bấm "Start tracking" lại để đo biến thể mới.
  const trackingOptions = useMemo(() => ({ profile: "full-rate" as const, resolution: "720p" as const, delegate: "GPU" as const, tasks: { face: true, hands: true, pose: true }, poseModel, onFrame, onMetrics, onError }), [poseModel, onFrame, onMetrics, onError]);
  const tracking = useTracking(trackingOptions);

  useEffect(() => { processorRef.current.setFiltered(filtered); }, [filtered]);
  useEffect(() => { processorRef.current.setConstraints(constraints); }, [constraints]);
  useEffect(() => { processorRef.current.setHandTwistEnabled(handTwistEnabled); }, [handTwistEnabled]);
  useEffect(() => { rendererRef.current?.setSmoothing(smoothing); }, [smoothing]);
  useEffect(() => { rendererRef.current?.setZoom(zoom); }, [zoom]);
  useEffect(() => { rendererRef.current?.setVerticalOffset(verticalOffset); }, [verticalOffset]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const renderer = rendererRef.current; const raw = frozenRaw.current ?? latestRaw.current; setPacket(latestPacket.current); setMotionDiagnostics(processorRef.current.getLastDiagnostics()); if (!renderer) return;
      setRendererMetrics(renderer.getMetrics()); const model = renderer.getDiagnosticModel(); if (!model) return;
      if (raw?.pose.worldLandmarks) { setPlaneNormals({ left: elbowPlaneNormal(raw.pose.worldLandmarks, "left", DIAGNOSTIC_CONVERSION), right: elbowPlaneNormal(raw.pose.worldLandmarks, "right", DIAGNOSTIC_CONVERSION) }); if (helpersRef.current) updateDiagnosticHelpers(helpersRef.current, model.bones, raw.pose.worldLandmarks, DIAGNOSTIC_CONVERSION); }
    }, 400); return () => window.clearInterval(timer);
  }, []);
  useEffect(() => () => { if (freezeTimerRef.current !== null) window.clearInterval(freezeTimerRef.current); if (helpersRef.current) clearDiagnosticHelpers(helpersRef.current); processorRef.current.dispose(); }, []);
  useEffect(() => { const renderer = rendererRef.current; const model = renderer?.getDiagnosticModel(); if (!model) return; if (helpers && !helpersRef.current) helpersRef.current = createDiagnosticHelpers(model.root, model.bones); if (!helpers && helpersRef.current) { clearDiagnosticHelpers(helpersRef.current); helpersRef.current = null; } }, [helpers, capability]);

  const loadRendererModel = useCallback(async (renderer: AvatarRenderer) => {
    const requestId = ++modelLoadRequestRef.current;
    setModelLoading(true);
    setError(null);
    if (helpersRef.current) { clearDiagnosticHelpers(helpersRef.current); helpersRef.current = null; }
    try {
      const report = await renderer.loadModel(MODEL_URL, { licenseStatus: "unknown" });
      if (!report || !isCurrentModelLoadRequest(rendererRef.current, renderer, modelLoadRequestRef.current, requestId)) return;
      const rigProfile = renderer.getRigProfile();
      setCapability(report);
      if (!rigProfile) {
        processorRef.current.setRigProfile(null);
        setError("Model đã tải nhưng không tạo được normalized arm rig profile; face vẫn có thể chạy nhưng tay bị vô hiệu hóa.");
        return;
      }
      processorRef.current.setRigProfile(rigProfile);
    } catch (reason) {
      if (isCurrentModelLoadRequest(rendererRef.current, renderer, modelLoadRequestRef.current, requestId)) {
        setError(`Model blocker: ${reason instanceof Error ? reason.message : String(reason)}`);
      }
    } finally {
      if (isCurrentModelLoadRequest(rendererRef.current, renderer, modelLoadRequestRef.current, requestId)) setModelLoading(false);
    }
  }, []);
  const attachRenderer = useCallback((renderer: AvatarRenderer) => {
    rendererRef.current = renderer; renderer.setSmoothing(smoothing); renderer.setZoom(zoom); renderer.setVerticalOffset(verticalOffset);
    processorRef.current.setRigProfile(null); setCapability(null); void loadRendererModel(renderer);
  }, [loadRendererModel, smoothing, zoom, verticalOffset]);
  const detachRenderer = useCallback((renderer: AvatarRenderer) => {
    if (rendererRef.current !== renderer) return;
    ++modelLoadRequestRef.current;
    if (helpersRef.current) clearDiagnosticHelpers(helpersRef.current);
    helpersRef.current = null; rendererRef.current = null; processorRef.current.setRigProfile(null);
  }, []);
  function reloadModel() { const renderer = rendererRef.current; if (!renderer || modelLoading) return; void loadRendererModel(renderer); }
  async function toggleTracking() { if (!tracking || !videoRef.current) return; if (trackingRunning) { tracking.stop(); setTrackingRunning(false); } else { setError(null); await tracking.start(videoRef.current); setTrackingRunning(true); } }
  function toggleRenderer() { const renderer = rendererRef.current; if (!renderer) return; if (rendererRunning) renderer.stop(); else renderer.start(); setRendererRunning(!rendererRunning); }
  function toggleFreeze() { if (frozenRaw.current) { frozenRaw.current = null; setFrozen(false); setSampleName("live"); return; } if (!latestRaw.current) return; frozenRaw.current = structuredClone(latestRaw.current); setFrozen(true); setFrozenSequence((value) => value + 1); setSampleName("webcam"); processInput(frozenRaw.current); }
  function freezeAfterCountdown() {
    if (frozenRaw.current || freezeTimerRef.current !== null || !latestRaw.current) return;
    let remaining = 5; setFreezeCountdown(remaining);
    freezeTimerRef.current = window.setInterval(() => {
      remaining -= 1; setFreezeCountdown(remaining);
      if (remaining > 0) return;
      window.clearInterval(freezeTimerRef.current!); freezeTimerRef.current = null; setFreezeCountdown(null); toggleFreeze();
    }, 1000);
  }
  const evidenceFrame = frozenRaw.current ?? latestRaw.current; const posePoints = evidenceFrame?.pose.worldLandmarks; const evidenceLandmarks = posePoints ? { leftShoulder: posePoints[11], rightShoulder: posePoints[12], leftElbow: posePoints[13], rightElbow: posePoints[14], leftWrist: posePoints[15], rightWrist: posePoints[16] } : null;

  return <main className="avatar-renderer-dev">
    <header><div><strong>DEV ONLY · LOCAL ONLY</strong><h1>P4-T10 Retargeting Diagnostics</h1></div><p>Không upload, capture hoặc lưu raw frame.</p></header>
    {error && <pre className="dev-error" role="alert">{error}</pre>}
    <section className="dev-controls">
      <button onClick={() => void toggleTracking()}>{trackingRunning ? "Stop tracking" : "Start tracking"}</button><button onClick={toggleRenderer}>{rendererRunning ? "Stop renderer" : "Start renderer"}</button><button onClick={reloadModel} disabled={modelLoading}>{modelLoading ? "Loading model…" : "Reload model"}</button>
      <button onClick={toggleFreeze} disabled={!frozen && !latestRaw.current}>{frozen ? "Unfreeze" : "Freeze current"}</button><button onClick={freezeAfterCountdown} disabled={frozen || freezeCountdown !== null || !latestRaw.current}>{freezeCountdown === null ? "Freeze in 5s" : `Freeze in ${freezeCountdown}s`}</button>
      <label><input type="checkbox" checked={filtered} onChange={(e) => setFiltered(e.target.checked)} /> Filter</label><label><input type="checkbox" checked={constraints} onChange={(e) => setConstraints(e.target.checked)} /> Constraints</label><label><input type="checkbox" checked={handTwistEnabled} onChange={(e) => setHandTwistEnabled(e.target.checked)} /> Hand twist (2B-5)</label><label><input type="checkbox" checked={smoothing} onChange={(e) => setSmoothing(e.target.checked)} /> Smoothing</label><label><input type="checkbox" checked={helpers} onChange={(e) => setHelpers(e.target.checked)} /> Helpers</label><label><input type="checkbox" checked={simulatedLoss} onChange={(e) => setSimulatedLoss(e.target.checked)} /> Simulate loss</label>
      <label>Pose model <select value={poseModel} onChange={(e) => { if (trackingRunning) { tracking?.stop(); setTrackingRunning(false); } setPoseModel(e.target.value as PoseModelVariant); }}><option value="full">full (chính xác hơn)</option><option value="lite">lite (nhẹ hơn)</option></select></label>
      <label>Zoom <input type="range" min="0.5" max="3" step="0.05" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /> {zoom.toFixed(2)}x</label>
      <label>Vị trí trên/dưới <input type="range" min="-0.5" max="0.5" step="0.01" value={verticalOffset} onChange={(e) => setVerticalOffset(Number(e.target.value))} /> {verticalOffset.toFixed(2)}</label>
      <button onClick={() => { setZoom(1); setVerticalOffset(0); }}>Reset khung hình</button>
    </section>
    <section className="dev-stage"><AvatarCanvas onReady={attachRenderer} onDispose={detachRenderer} onError={(reason) => setError(`WebGL: ${reason.message}`)} options={{ smoothing, onContextLost: (reason) => setError(reason.message) }} /><div className="dev-camera-preview"><video ref={videoRef} muted playsInline />{!trackingRunning && <p>Camera chưa bật<br /><small>Bấm Start tracking để dùng webcam</small></p>}</div></section>
    <section className="dev-panels">
      <article><h2>Frozen evidence</h2><p>Mode: {frozen ? "FROZEN" : "LIVE"} · sample: <strong>{sampleName}</strong> · frozen #{frozenSequence}</p><p>Conversion: <strong>{DIAGNOSTIC_CONVERSION}</strong> · raw timestamp {number(evidenceFrame?.frameTimestampMs, 0)} · packet seq {packet?.sequence ?? "—"}</p><p>Solver {filtered ? "+filter" : "raw"} · constraints {constraints ? "on" : "off"} · Hand twist {handTwistEnabled ? "on" : "Pose-only"} · smoothing {smoothing ? "on" : "off"}</p><pre>required world landmarks {JSON.stringify(evidenceLandmarks, null, 2)}</pre><pre>plane normal {JSON.stringify(planeNormals, null, 2)}</pre></article>
      <article><h2>Realtime</h2><p>Tracking/Pipeline: {number(trackingMetrics?.cameraFps)} / {number(trackingMetrics?.pipelineFps)} FPS</p><p>Renderer: {number(rendererMetrics?.fps)} FPS · p95 {number(rendererMetrics?.frameTimeP95Ms)}ms</p><p>Processor→draw: {number(rendererMetrics?.processorInputToDrawMs)}ms</p>
        <p>Pose model: <strong>{trackingMetrics?.poseModel ?? `${poseModel} (chưa chạy)`}</strong> · delegate {trackingMetrics?.selectedDelegate ?? "—"}</p>
        <p>Pose inference: {number(trackingMetrics?.inferenceTimeMs.pose.average)}ms trung bình · p95 {number(trackingMetrics?.inferenceTimeMs.pose.p95)}ms · max {number(trackingMetrics?.inferenceTimeMs.pose.max)}ms</p></article>
      <article><h2>Capability</h2>{modelLoading && <p>Đang tải model mới; model hiện tại vẫn được giữ cho tới khi swap thành công.</p>}{capability ? <pre>{JSON.stringify(capability, null, 2)}</pre> : !modelLoading && <p>Chưa có model sẵn sàng.</p>}</article>
      <article><h2>Tracking state</h2>{packet && Object.entries(packet.tracking).map(([name, state]) => <p key={name}>{name}: {state.sourceState} → {state.outputState}</p>)}</article>
      <article><h2>Phase 3A arm-frame</h2><p>Head: legacy/unverified, excluded from arm acceptance.</p><pre>{JSON.stringify(motionDiagnostics, null, 2)}</pre></article>
    </section>
  </main>;
}
