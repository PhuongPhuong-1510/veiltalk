import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { AvatarCanvas } from "../avatar/AvatarCanvas";
import { AvatarMotionProcessor } from "../../lib/avatar-motion/avatarMotionProcessor";
import type { AvatarPosePacketV1 } from "../../lib/avatar-motion/avatarPoseTypes";
import type { AvatarMotionDiagnosticSnapshot } from "../../lib/avatar-motion/avatarMotionDiagnostics";
import type { FingerRigProfile } from "../../lib/avatar-motion/fingerRig";
import type { GesturePoseLabel } from "../../lib/avatar-motion/gestureClassifier";
import type { AvatarRenderer } from "../../lib/avatar-renderer/avatarRenderer";
import { clearDiagnosticHelpers, createDiagnosticHelpers, elbowPlaneNormal, updateDiagnosticHelpers } from "../../lib/avatar-renderer/avatarDiagnostics";
import type { ModelCapabilityReport } from "../../lib/avatar-renderer/modelTypes";
import type { RendererMetricsSnapshot } from "../../lib/avatar-renderer/rendererMetrics";
import { isCurrentModelLoadRequest } from "../../lib/avatar-renderer/modelLoader";
import type { RawTrackingFrameV1 } from "../../lib/tracking/rawTrackingTypes";
import type { TrackingMetricsSnapshot } from "../../lib/tracking/trackingMetrics";
import { useTracking } from "../../lib/tracking/useTracking";
import { DEFAULT_POSE_MODEL, type PoseModelVariant } from "../../lib/tracking/mediaPipeRuntime";
import { GestureFixtureCollector, reportFixtureGaps, type FixtureGapReport, type GestureFixtureCondition, type GestureFixtureDistance, type GestureFixtureOcclusion, type GestureFixtureOrientation, type GestureFixturePose, type GestureFixtureSplit } from "../../lib/avatar-motion/gestureFixture";
import { DEFAULT_DEV_AVATAR_MODEL_ID, DEV_AVATAR_MODELS, getDevAvatarModel, type DevAvatarModel } from "./devAvatarModels";
import "./avatarRendererDevHarness.css";

const DIAGNOSTIC_CONVERSION = "current" as const;
const number = (value: number | null | undefined, digits = 1) => value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits);

export default function AvatarRendererDevHarness() {
  const videoRef = useRef<HTMLVideoElement>(null); const rendererRef = useRef<AvatarRenderer | null>(null); const helpersRef = useRef<Group | null>(null);
  const modelLoadRequestRef = useRef(0);
  const freezeTimerRef = useRef<number | null>(null);
  const processorRef = useRef(new AvatarMotionProcessor()); const latestPacket = useRef<AvatarPosePacketV1 | null>(null); const latestRaw = useRef<RawTrackingFrameV1 | null>(null); const frozenRaw = useRef<RawTrackingFrameV1 | null>(null);
  const [filtered, setFiltered] = useState(true); const [constraints, setConstraints] = useState(true); const [smoothing, setSmoothing] = useState(true);
  const [handTwistEnabled, setHandTwistEnabled] = useState(true);
  // Phase 3B.3 — mặc định TẮT. Bật là hành động thử nghiệm có chủ đích của người test.
  const [gestureEnabled, setGestureEnabled] = useState(false);
  const [fingerRig, setFingerRig] = useState<FingerRigProfile | null>(null);
  const [gesturePoses, setGesturePoses] = useState<Record<"left" | "right", GesturePoseLabel>>({ left: "rest", right: "rest" });
  const [helpers, setHelpers] = useState(false); const [frozen, setFrozen] = useState(false);
  const [sampleName, setSampleName] = useState("live"); const [frozenSequence, setFrozenSequence] = useState(0);
  const [freezeCountdown, setFreezeCountdown] = useState<number | null>(null);
  const [simulatedLoss, setSimulatedLoss] = useState(false); const [trackingRunning, setTrackingRunning] = useState(false); const [rendererRunning, setRendererRunning] = useState(true);
  const [poseModel, setPoseModel] = useState<PoseModelVariant>(DEFAULT_POSE_MODEL);
  const [avatarModelId, setAvatarModelId] = useState(DEFAULT_DEV_AVATAR_MODEL_ID);
  const [zoom, setZoom] = useState(1); const [verticalOffset, setVerticalOffset] = useState(0);
  const [error, setError] = useState<string | null>(null); const [capability, setCapability] = useState<ModelCapabilityReport | null>(null); const [packet, setPacket] = useState<AvatarPosePacketV1 | null>(null);
  const [planeNormals, setPlaneNormals] = useState<Record<string, unknown>>({});
  const [motionDiagnostics, setMotionDiagnostics] = useState<AvatarMotionDiagnosticSnapshot | null>(null);
  const [rendererMetrics, setRendererMetrics] = useState<RendererMetricsSnapshot | null>(null); const [trackingMetrics, setTrackingMetrics] = useState<TrackingMetricsSnapshot | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  // Phase 3B.3 Việc 0: thu fixture landmark thật. Chỉ thu và xuất; chưa có classifier nào đọc.
  const fixtureRef = useRef(new GestureFixtureCollector());
  const fixtureAutoTimerRef = useRef<number | null>(null);
  const fixtureAutoStateRef = useRef<{ baseCondition: Omit<GestureFixtureCondition, "split">; nextSplitIndex: number; lastHandSampledAtMs: number | null } | null>(null);
  const [fixtureSide, setFixtureSide] = useState<GestureFixtureCondition["side"]>("left");
  const [fixturePose, setFixturePose] = useState<GestureFixturePose>("open");
  const [fixtureOrientation, setFixtureOrientation] = useState<GestureFixtureOrientation>("palm-to-camera");
  const [fixtureDistance, setFixtureDistance] = useState<GestureFixtureDistance>("normal");
  const [fixtureOcclusion, setFixtureOcclusion] = useState<GestureFixtureOcclusion>("none");
  const [fixtureSplit, setFixtureSplit] = useState<GestureFixtureSplit>("calibration");
  const [fixtureCount, setFixtureCount] = useState(0);
  const [fixtureGaps, setFixtureGaps] = useState<FixtureGapReport>(() => reportFixtureGaps([]));
  const [fixtureStatus, setFixtureStatus] = useState<string>("Chưa thu mẫu nào.");

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
  useEffect(() => { processorRef.current.setGestureEnabled(gestureEnabled); }, [gestureEnabled]);
  // Nhãn cử chỉ cần nhịp nhanh hơn panel chung (400ms): ở 400ms người test không thấy được nhãn
  // đổi lúc chuyển tư thế, nên không phân biệt được "nhận sai" với "nhận chậm".
  useEffect(() => {
    if (!gestureEnabled) return;
    const timer = window.setInterval(() => setGesturePoses(processorRef.current.getGesturePoses()), 100);
    return () => window.clearInterval(timer);
  }, [gestureEnabled]);
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
  useEffect(() => () => { if (freezeTimerRef.current !== null) window.clearInterval(freezeTimerRef.current); stopAutoCapture(); if (helpersRef.current) clearDiagnosticHelpers(helpersRef.current); processorRef.current.dispose(); }, []);
  useEffect(() => { const renderer = rendererRef.current; const model = renderer?.getDiagnosticModel(); if (!model) return; if (helpers && !helpersRef.current) helpersRef.current = createDiagnosticHelpers(model.root, model.bones); if (!helpers && helpersRef.current) { clearDiagnosticHelpers(helpersRef.current); helpersRef.current = null; } }, [helpers, capability]);

  const resetModelMotionState = useCallback(() => {
    processorRef.current.setFingerRig(null);
    processorRef.current.setRigProfile(null);
    processorRef.current.reset();
    latestPacket.current = null;
    setPacket(null);
    setMotionDiagnostics(null);
    setPlaneNormals({});
    setFingerRig(null);
    setCapability(null);
    setGesturePoses({ left: "rest", right: "rest" });
  }, []);

  const loadRendererModel = useCallback(async (renderer: AvatarRenderer, model: DevAvatarModel) => {
    const requestId = ++modelLoadRequestRef.current;
    setModelLoading(true);
    setError(null);
    resetModelMotionState();
    if (helpersRef.current) { clearDiagnosticHelpers(helpersRef.current); helpersRef.current = null; }
    try {
      const report = await renderer.loadModel(model.url, { licenseStatus: "unknown" });
      if (!report || !isCurrentModelLoadRequest(rendererRef.current, renderer, modelLoadRequestRef.current, requestId)) return;
      const rigProfile = renderer.getRigProfile();
      setCapability(report);
      if (report.unsupportedFeatures.length > 0) {
        const missingBones = Object.entries(report.requiredBones).filter(([, available]) => !available).map(([bone]) => bone);
        const boneDetail = missingBones.length > 0 ? ` Thiếu bone bắt buộc: ${missingBones.join(", ")}.` : "";
        setError(`${model.label} có capability blocker: ${report.unsupportedFeatures.join(" ")}${boneDetail}`);
      }
      // Phase 3B.3: rig ngón độc lập với arm rig profile — gán trước để model thiếu arm profile
      // vẫn báo đúng capability ngón trên panel.
      const nextFingerRig = renderer.getFingerRig();
      processorRef.current.setFingerRig(nextFingerRig);
      setFingerRig(nextFingerRig);
      if (!rigProfile) {
        processorRef.current.setRigProfile(null);
        setError(`${model.label} đã tải nhưng không tạo được normalized arm rig profile; face vẫn có thể chạy nhưng tay bị vô hiệu hóa.`);
        return;
      }
      processorRef.current.setRigProfile(rigProfile);
    } catch (reason) {
      if (isCurrentModelLoadRequest(rendererRef.current, renderer, modelLoadRequestRef.current, requestId)) {
        setError(`Model blocker (${model.label}): ${reason instanceof Error ? reason.message : String(reason)}`);
      }
    } finally {
      if (isCurrentModelLoadRequest(rendererRef.current, renderer, modelLoadRequestRef.current, requestId)) setModelLoading(false);
    }
  }, [resetModelMotionState]);
  const attachRenderer = useCallback((renderer: AvatarRenderer) => {
    rendererRef.current = renderer; renderer.setSmoothing(smoothing); renderer.setZoom(zoom); renderer.setVerticalOffset(verticalOffset);
    const model = getDevAvatarModel(avatarModelId);
    if (!model) { setError(`Không tìm thấy DEV avatar model: ${avatarModelId}`); return; }
    void loadRendererModel(renderer, model);
  }, [avatarModelId, loadRendererModel, smoothing, zoom, verticalOffset]);
  const detachRenderer = useCallback((renderer: AvatarRenderer) => {
    if (rendererRef.current !== renderer) return;
    ++modelLoadRequestRef.current;
    if (helpersRef.current) clearDiagnosticHelpers(helpersRef.current);
    helpersRef.current = null; rendererRef.current = null;
    // Cleanup có thể chạy khi React đang unmount; chỉ xóa state nội bộ, không set React state.
    processorRef.current.setFingerRig(null);
    processorRef.current.setRigProfile(null);
    processorRef.current.reset();
    latestPacket.current = null;
  }, []);
  function selectAvatarModel(modelId: string) {
    const model = getDevAvatarModel(modelId);
    if (!model) { setError(`Không tìm thấy DEV avatar model: ${modelId}`); return; }
    setAvatarModelId(model.id);
    const renderer = rendererRef.current;
    if (renderer) void loadRendererModel(renderer, model);
  }
  function reloadModel() {
    const renderer = rendererRef.current; const model = getDevAvatarModel(avatarModelId);
    if (!renderer || !model || modelLoading) return;
    void loadRendererModel(renderer, model);
  }
  function refreshFixtureState() {
    setFixtureCount(fixtureRef.current.getSampleCount());
    setFixtureGaps(reportFixtureGaps(fixtureRef.current.getCoverage()));
  }
  function stopAutoCapture(status?: string) {
    if (fixtureAutoTimerRef.current !== null) window.clearInterval(fixtureAutoTimerRef.current);
    fixtureAutoTimerRef.current = null; fixtureAutoStateRef.current = null;
    if (status) setFixtureStatus(status);
  }
  function startAutoCapturePair() {
    const source = latestRaw.current;
    if (frozenRaw.current) { setFixtureStatus("Hãy bỏ Freeze current trước khi tự thu."); return; }
    if (!source) { setFixtureStatus("Chưa có frame live — bấm Start tracking trước."); return; }
    stopAutoCapture();
    const baseCondition: Omit<GestureFixtureCondition, "split"> = { side: fixtureSide, pose: fixturePose, orientation: fixtureOrientation, distance: fixtureDistance, occlusion: fixtureOcclusion };
    const state = { baseCondition, nextSplitIndex: 0, lastHandSampledAtMs: source.handSampledAtMs };
    fixtureAutoStateRef.current = state;
    setFixtureStatus("Đang chờ 2 sample mới: calibration rồi hold-out…");
    fixtureAutoTimerRef.current = window.setInterval(() => {
      const current = fixtureAutoStateRef.current;
      const live = latestRaw.current;
      if (!current || !live || !live.handSampledThisFrame || live.handSampledAtMs === null || live.handSampledAtMs === current.lastHandSampledAtMs) return;
      const split = current.nextSplitIndex === 0 ? "calibration" : "holdout";
      const result = fixtureRef.current.capture(live, { ...current.baseCondition, split }, performance.now());
      current.lastHandSampledAtMs = live.handSampledAtMs;
      if (result.sample) {
        current.nextSplitIndex += 1;
        refreshFixtureState();
        setFixtureStatus(`Tự thu ${split} #${result.sample.index}; đang chờ sample tiếp theo…`);
      } else if (result.rejectionReason === "no-candidate-for-side") {
        setFixtureStatus(`Đang chờ tay ${fixtureSide} rõ hơn…`);
      }
      if (current.nextSplitIndex >= 2) stopAutoCapture("Đã tự thu đủ calibration + hold-out cho pose này.");
    }, 100);
  }
  function captureFixture() {
    // Pose phải được tạo trước khi Freeze current. Khi FROZEN, đây là một detector sample bất biến;
    // không thể dùng lại nó cho split khác vì sẽ làm calibration/holdout bị trùng dữ liệu.
    const source = frozenRaw.current ?? latestRaw.current;
    if (!source) { setFixtureStatus("Chưa có frame nào — bấm Start tracking trước."); return; }
    const condition: GestureFixtureCondition = { side: fixtureSide, pose: fixturePose, orientation: fixtureOrientation, distance: fixtureDistance, occlusion: fixtureOcclusion, split: fixtureSplit };
    const result = fixtureRef.current.capture(source, condition, performance.now());
    if (result.rejectionReason) {
      const reason = result.rejectionReason === "no-hand-sample" ? "frame này không có sample tay mới"
        : result.rejectionReason === "no-candidate-for-side" ? `không thấy tay ${fixtureSide} trong frame`
        : result.rejectionReason === "duplicate-sample" ? "sample detector này đã thu rồi"
        : "landmark không đủ 21 điểm";
      setFixtureStatus(`Bỏ qua: ${reason}.`);
      return;
    }
    setFixtureStatus(`Đã thu mẫu #${result.sample!.index} (${fixtureSide}/${fixturePose}).`);
    refreshFixtureState();
  }
  function undoFixture() {
    setFixtureStatus(fixtureRef.current.undoLast() ? "Đã xoá mẫu gần nhất." : "Không còn mẫu để xoá.");
    refreshFixtureState();
  }
  function clearFixtures() {
    stopAutoCapture();
    fixtureRef.current.clear(); setFixtureStatus("Đã xoá toàn bộ mẫu."); refreshFixtureState();
  }
  function exportFixtures() {
    if (fixtureRef.current.getSampleCount() === 0) { setFixtureStatus("Chưa có mẫu để xuất."); return; }
    const file = fixtureRef.current.toFile(Date.now());
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `gesture-fixture-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    link.click(); URL.revokeObjectURL(url);
    setFixtureStatus(`Đã xuất ${file.sampleCount} mẫu.`);
  }
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
      <label><input type="checkbox" checked={filtered} onChange={(e) => setFiltered(e.target.checked)} /> Filter</label><label><input type="checkbox" checked={constraints} onChange={(e) => setConstraints(e.target.checked)} /> Constraints</label><label><input type="checkbox" checked={handTwistEnabled} onChange={(e) => setHandTwistEnabled(e.target.checked)} /> Hand twist (2B-5)</label><label><input type="checkbox" checked={gestureEnabled} onChange={(e) => setGestureEnabled(e.target.checked)} /> Finger gesture (3B.3)</label><label><input type="checkbox" checked={smoothing} onChange={(e) => setSmoothing(e.target.checked)} /> Smoothing</label><label><input type="checkbox" checked={helpers} onChange={(e) => setHelpers(e.target.checked)} /> Helpers</label><label><input type="checkbox" checked={simulatedLoss} onChange={(e) => setSimulatedLoss(e.target.checked)} /> Simulate loss</label>
      <label>Pose model <select value={poseModel} onChange={(e) => { if (trackingRunning) { tracking?.stop(); setTrackingRunning(false); } setPoseModel(e.target.value as PoseModelVariant); }}><option value="full">full (chính xác hơn)</option><option value="lite">lite (nhẹ hơn)</option></select></label>
      <label>Avatar model <select value={avatarModelId} onChange={(event) => selectAvatarModel(event.target.value)}>{DEV_AVATAR_MODELS.map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</select></label>
      <label>Zoom <input type="range" min="0.5" max="3" step="0.05" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /> {zoom.toFixed(2)}x</label>
      <label>Vị trí trên/dưới <input type="range" min="-0.5" max="0.5" step="0.01" value={verticalOffset} onChange={(e) => setVerticalOffset(Number(e.target.value))} /> {verticalOffset.toFixed(2)}</label>
      <button onClick={() => { setZoom(1); setVerticalOffset(0); }}>Reset khung hình</button>
    </section>
    <section className="dev-stage"><AvatarCanvas onReady={attachRenderer} onDispose={detachRenderer} onError={(reason) => setError(`WebGL: ${reason.message}`)} options={{ smoothing, onContextLost: (reason) => setError(reason.message) }} /><div className="dev-camera-preview"><video ref={videoRef} muted playsInline />{!trackingRunning && <p>Camera chưa bật<br /><small>Bấm Start tracking để dùng webcam</small></p>}</div></section>
    <section className="dev-panels">
      <article><h2>Frozen evidence</h2><p>Mode: {frozen ? "FROZEN" : "LIVE"} · sample: <strong>{sampleName}</strong> · frozen #{frozenSequence}</p><p>Conversion: <strong>{DIAGNOSTIC_CONVERSION}</strong> · raw timestamp {number(evidenceFrame?.frameTimestampMs, 0)} · packet seq {packet?.sequence ?? "—"}</p><p>Solver {filtered ? "+filter" : "raw"} · constraints {constraints ? "on" : "off"} · Hand twist {handTwistEnabled ? "on" : "Pose-only"} · smoothing {smoothing ? "on" : "off"}</p><pre>required world landmarks {JSON.stringify(evidenceLandmarks, null, 2)}</pre><pre>plane normal {JSON.stringify(planeNormals, null, 2)}</pre></article>
      <article><h2>Realtime</h2><p>Avatar: <strong>{getDevAvatarModel(avatarModelId)?.label ?? avatarModelId}</strong>{modelLoading ? " · đang tải…" : ""}</p><p>Tracking/Pipeline: {number(trackingMetrics?.cameraFps)} / {number(trackingMetrics?.pipelineFps)} FPS</p><p>Renderer: {number(rendererMetrics?.fps)} FPS · p95 {number(rendererMetrics?.frameTimeP95Ms)}ms</p><p>Processor→draw: {number(rendererMetrics?.processorInputToDrawMs)}ms</p>
        <p>Pose model: <strong>{trackingMetrics?.poseModel ?? `${poseModel} (chưa chạy)`}</strong> · delegate {trackingMetrics?.selectedDelegate ?? "—"}</p>
        <p>Pose inference: {number(trackingMetrics?.inferenceTimeMs.pose.average)}ms trung bình · p95 {number(trackingMetrics?.inferenceTimeMs.pose.p95)}ms · max {number(trackingMetrics?.inferenceTimeMs.pose.max)}ms</p></article>
      <article><h2>Finger rig (3B.3)</h2>
        <p>Gesture: <strong>{gestureEnabled ? "ON" : "OFF (Phase 3B nguyên trạng)"}</strong></p>
        {gestureEnabled && <p style={{ fontSize: "1.1em" }}>Nhãn — trái: <strong>{gesturePoses.left}</strong> · phải: <strong>{gesturePoses.right}</strong></p>}
        {fingerRig ? <>
          <p>Điều khiển được: trái {fingerRig.left.controllableSegmentCount}/15 · phải {fingerRig.right.controllableSegmentCount}/15</p>
          {([fingerRig.left, fingerRig.right]).map((hand) => (
            <p key={hand.side}>{hand.side === "left" ? "Trái" : "Phải"}: {hand.chains.map((chain) =>
              `${chain.finger} ${chain.segments.length}/3${chain.truncatedAtSegment ? ` (dừng ở ${chain.truncatedAtSegment})` : ""}`).join(" · ")}</p>
          ))}
        </> : <p>Chưa có rig ngón (model chưa tải hoặc không phải VRM).</p>}
      </article>
      <article><h2>Capability</h2>{modelLoading && <p>Đang tải model mới; model hiện tại vẫn được giữ cho tới khi swap thành công.</p>}{capability ? <pre>{JSON.stringify(capability, null, 2)}</pre> : !modelLoading && <p>Chưa có model sẵn sàng.</p>}</article>
      <article><h2>Tracking state</h2>{packet && Object.entries(packet.tracking).map(([name, state]) => <p key={name}>{name}: {state.sourceState} → {state.outputState}</p>)}</article>
      <article><h2>Phase 3B.3 — Thu fixture cử chỉ</h2>
        <p><small>Quy trình: tạo dáng → chờ hand active → Freeze current → chọn nhãn → Thu mẫu. Freeze giữ một sample duy nhất; không lưu ảnh.</small></p>
        <p>
          <label>Tay <select value={fixtureSide} onChange={(e) => setFixtureSide(e.target.value as GestureFixtureCondition["side"])}><option value="left">trái</option><option value="right">phải</option></select></label>{" "}
          <label>Tư thế <select value={fixturePose} onChange={(e) => setFixturePose(e.target.value as GestureFixturePose)}>
            <option value="open">open (xoè)</option><option value="fist">fist (nắm)</option><option value="point">point (chỉ)</option>
            <option value="thumbUp">thumbUp (cái LÊN)</option><option value="thumbSide">thumbSide (cái NGANG)</option><option value="thumbDown">thumbDown (cái XUỐNG)</option>
            <option value="relaxed">relaxed (nghỉ)</option><option value="peace">peace (chữ V)</option>
            <option value="ok">ok (cái+trỏ vòng tròn)</option><option value="rock">rock (trỏ+út)</option>
            <option value="heartFinger">heartFinger (tym 1 tay)</option><option value="callMe">callMe (cái+út)</option>
            <option value="other">other (âm tính khác)</option>
          </select></label>
        </p>
        <p>
          <label>Hướng <select value={fixtureOrientation} onChange={(e) => setFixtureOrientation(e.target.value as GestureFixtureOrientation)}>
            <option value="palm-to-camera">lòng bàn tay</option><option value="back-to-camera">mu bàn tay</option><option value="edge-on">nghiêng cạnh</option>
          </select></label>{" "}
          <label>Khoảng cách <select value={fixtureDistance} onChange={(e) => setFixtureDistance(e.target.value as GestureFixtureDistance)}>
            <option value="near">gần</option><option value="normal">vừa</option><option value="far">xa</option>
          </select></label>{" "}
          <label>Che <select value={fixtureOcclusion} onChange={(e) => setFixtureOcclusion(e.target.value as GestureFixtureOcclusion)}>
            <option value="none">không</option><option value="partial-fingers">che một phần ngón</option>
          </select></label>
          <label>Nhóm <select value={fixtureSplit} onChange={(e) => setFixtureSplit(e.target.value as GestureFixtureSplit)}>
            <option value="calibration">calibration</option><option value="holdout">hold-out</option>
          </select></label>
        </p>
        <p>
          <button onClick={captureFixture}>Thu mẫu</button>{" "}
          <button onClick={startAutoCapturePair} disabled={fixtureAutoTimerRef.current !== null}>Tự thu 2 nhóm (live)</button>{" "}
          <button onClick={() => stopAutoCapture("Đã dừng tự thu.")} disabled={fixtureAutoTimerRef.current === null}>Dừng tự thu</button>{" "}
          <button onClick={undoFixture} disabled={fixtureCount === 0}>Xoá mẫu cuối</button>{" "}
          <button onClick={exportFixtures} disabled={fixtureCount === 0}>Xuất JSON</button>{" "}
          <button onClick={clearFixtures} disabled={fixtureCount === 0}>Xoá hết</button>
        </p>
        <p>Đã thu: <strong>{fixtureCount}</strong> mẫu · {fixtureStatus}</p>
        {fixtureGaps.complete
          ? <p><strong>Đã phủ đủ điều kiện tối thiểu.</strong></p>
          : <p>Còn thiếu:{" "}
              {fixtureGaps.missingSidePose.length > 0 && <>tư thế {fixtureGaps.missingSidePose.map((gap) => `${gap.side}/${gap.pose}/${gap.split}`).join(", ")}. </>}
              {fixtureGaps.missingOrientations.length > 0 && <>hướng {fixtureGaps.missingOrientations.join(", ")}. </>}
              {fixtureGaps.missingDistances.length > 0 && <>khoảng cách {fixtureGaps.missingDistances.join(", ")}. </>}
              {!fixtureGaps.hasPartialOcclusion && <>chưa có mẫu che ngón.</>}
            </p>}
      </article>
      <article><h2>Phase 3B partial-arm</h2>
        {(["left", "right"] as const).map((side) => {
          const arm = motionDiagnostics?.arms[side];
          if (!arm) return <p key={side}>{side}: —</p>;
          const flag = (name: string) => arm.confidenceFlags.includes(name);
          return <p key={side}>
            {arm.spatial && <><small>search {arm.spatial.candidateCount} · face {arm.spatial.faceEvidenceUsed ? (arm.spatial.intentionalFaceContact ? "contact" : "clearance") : "n/a"} · penalty F/H/T {arm.spatial.facePenalty.toFixed(2)}/{arm.spatial.headCollisionPenalty.toFixed(2)}/{arm.spatial.torsoCollisionPenalty.toFixed(2)} · palm {motionDiagnostics?.handTwist[side]?.alignmentMode ?? "legacy"}</small><br /></>}
            <strong>{side}</strong>: upper <em>{arm.segmentLossState.upper}</em> · lower <em>{arm.segmentLossState.lower}</em><br />
            elbow {arm.elbowInference.source} · pole {arm.poleSource}<br />
            wrist {arm.wristEvidence?.source ?? "legacy"} · grace {arm.wristEvidence ? Math.round(arm.wristEvidence.effectiveGraceMs) : "—"}ms
            {arm.wristEvidence?.reconstructionConfidence !== null && arm.wristEvidence?.reconstructionConfidence !== undefined && <> · reconstruct {arm.wristEvidence.reconstructionConfidence.toFixed(2)}</>}
            {arm.wristEvidence?.reconstructionRejectionReason && <> · wrist reject {arm.wristEvidence.reconstructionRejectionReason}</>}
            {flag("elbow-side-flip-prevented") && <> · <strong>side-flip chặn</strong></>}
            {flag("elbow-anatomy-flip") && <> · <strong>deep-inside đổi nhánh</strong></>}
            {flag("observed-elbow-hand-conflict") && <> · <strong>Pose elbow bị Hand bác bỏ</strong></>}
            {flag("elbow-hand-palm-branch") && <> · <strong>palm chọn nhánh</strong></>}
            {arm.hardRejectionReason && <> · reject {arm.hardRejectionReason}</>}
            {arm.observation.lowerRejectionReason && <> · lower {arm.observation.lowerRejectionReason}</>}
            {flag("observed-elbow-head-collision") && <> · <strong>Pose elbow xuyên head bị bác bỏ</strong></>}
            {flag("elbow-face-clearance-branch") && <> · <strong>face-clearance đổi mặt phẳng</strong></>}
            {flag("elbow-rig-collision-branch") && <> · <strong>collision rig đổi mặt phẳng</strong></>}
          </p>;
        })}
      </article>
      <article><h2>Phase 3A arm-frame</h2><p>Head: legacy/unverified, excluded from arm acceptance.</p><pre>{JSON.stringify(motionDiagnostics, null, 2)}</pre></article>
    </section>
  </main>;
}
