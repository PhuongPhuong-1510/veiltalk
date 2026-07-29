import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Group } from "three";
import { AvatarCanvas } from "../avatar/AvatarCanvas";
import { AvatarMotionProcessor } from "../../lib/avatar-motion/avatarMotionProcessor";
import type { AvatarPosePacketV1 } from "../../lib/avatar-motion/avatarPoseTypes";
import type { AvatarMotionDiagnosticSnapshot } from "../../lib/avatar-motion/avatarMotionDiagnostics";
import type { AvatarRenderer } from "../../lib/avatar-renderer/avatarRenderer";
import { clearDiagnosticHelpers, createDebugPreset, createDiagnosticHelpers, diagnoseJoints, elbowPlaneNormal, inspectRestBasis, updateDiagnosticHelpers, type CoordinateConversion, type DebugPresetName, type JointDiagnosticRow, type RestBasisRow } from "../../lib/avatar-renderer/avatarDiagnostics";
import type { ModelCapabilityReport } from "../../lib/avatar-renderer/modelTypes";
import type { RendererMetricsSnapshot } from "../../lib/avatar-renderer/rendererMetrics";
import type { RawTrackingFrameV1 } from "../../lib/tracking/rawTrackingTypes";
import type { TrackingMetricsSnapshot } from "../../lib/tracking/trackingMetrics";
import { useTracking } from "../../lib/tracking/useTracking";
import { DEFAULT_POSE_MODEL, type PoseModelVariant } from "../../lib/tracking/mediaPipeRuntime";
import {
  HAND_CALIBRATION_STEPS,
  analyzeHandCalibrationRun,
  formatHandCalibrationReportText,
  type HandCalibrationReport,
  type HandCalibrationSample,
  type HandCalibrationStepId,
} from "../../lib/avatar-motion/handCalibrationAnalysis";
import "./avatarRendererDevHarness.css";

const MODEL_URL = "/models/avatars/reference-avatar-2.vrm";
const PRESETS: DebugPresetName[] = ["tPose", "armsDown", "leftArmUp", "rightArmUp", "leftElbow90", "rightElbow90", "bothForward", "twistReferenceA", "twistReferenceB"];
const number = (value: number | null | undefined, digits = 1) => value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits);

function emptyCalibrationSamples(): Record<HandCalibrationStepId, HandCalibrationSample[]> {
  return {
    "right-hand-only": [], "left-hand-only": [], "right-palm-forward": [], "right-back-forward": [],
    "right-edge-on": [], "cross-hands": [], performance: [],
  };
}

export default function AvatarRendererDevHarness() {
  const videoRef = useRef<HTMLVideoElement>(null); const rendererRef = useRef<AvatarRenderer | null>(null); const helpersRef = useRef<Group | null>(null);
  const freezeTimerRef = useRef<number | null>(null);
  const processorRef = useRef(new AvatarMotionProcessor()); const latestPacket = useRef<AvatarPosePacketV1 | null>(null); const latestRaw = useRef<RawTrackingFrameV1 | null>(null); const frozenRaw = useRef<RawTrackingFrameV1 | null>(null);
  const [filtered, setFiltered] = useState(false); const [constraints, setConstraints] = useState(false); const [smoothing, setSmoothing] = useState(false);
  const [handTwistEnabled, setHandTwistEnabled] = useState(false);
  const [helpers, setHelpers] = useState(false); const [frozen, setFrozen] = useState(false); const [conversion, setConversion] = useState<CoordinateConversion>("current");
  const [sampleName, setSampleName] = useState("live"); const [sampleDraft, setSampleDraft] = useState("Pose A — T-pose"); const [frozenSequence, setFrozenSequence] = useState(0);
  const [freezeCountdown, setFreezeCountdown] = useState<number | null>(null);
  const [simulatedLoss, setSimulatedLoss] = useState(false); const [trackingRunning, setTrackingRunning] = useState(false); const [rendererRunning, setRendererRunning] = useState(true);
  const [poseModel, setPoseModel] = useState<PoseModelVariant>(DEFAULT_POSE_MODEL);
  const [zoom, setZoom] = useState(1); const [verticalOffset, setVerticalOffset] = useState(0);
  const [error, setError] = useState<string | null>(null); const [capability, setCapability] = useState<ModelCapabilityReport | null>(null); const [packet, setPacket] = useState<AvatarPosePacketV1 | null>(null);
  const [restRows, setRestRows] = useState<RestBasisRow[]>([]); const [jointRows, setJointRows] = useState<JointDiagnosticRow[]>([]); const [planeNormals, setPlaneNormals] = useState<Record<string, unknown>>({});
  const [motionDiagnostics, setMotionDiagnostics] = useState<AvatarMotionDiagnosticSnapshot | null>(null);
  const [rendererMetrics, setRendererMetrics] = useState<RendererMetricsSnapshot | null>(null); const [trackingMetrics, setTrackingMetrics] = useState<TrackingMetricsSnapshot | null>(null); const [reload, setReload] = useState(0);

  // Mức 2B-1 — Hand Calibration Test: chỉ thu thập diagnostic đã có sẵn (packet.handMotion,
  // trackingMetrics), KHÔNG tính pole/quaternion/jointRotations mới, KHÔNG điều khiển VRM.
  const [calibrationRunning, setCalibrationRunning] = useState(false);
  const [calibrationStepIndex, setCalibrationStepIndex] = useState<number | null>(null);
  const [calibrationCountdownMs, setCalibrationCountdownMs] = useState<number | null>(null);
  const [calibrationReport, setCalibrationReport] = useState<HandCalibrationReport | null>(null);
  const [calibrationCopyStatus, setCalibrationCopyStatus] = useState<string | null>(null);
  const calibrationSamplesRef = useRef<Record<HandCalibrationStepId, HandCalibrationSample[]>>(emptyCalibrationSamples());
  const calibrationTimerRef = useRef<number | null>(null);
  const calibrationStepStartedAtRef = useRef<number>(0);
  const calibrationActiveStepIdRef = useRef<HandCalibrationStepId | null>(null);

  const stopCalibrationTimer = useCallback(() => {
    if (calibrationTimerRef.current !== null) { window.clearInterval(calibrationTimerRef.current); calibrationTimerRef.current = null; }
  }, []);

  const finishCalibration = useCallback(() => {
    stopCalibrationTimer();
    calibrationActiveStepIdRef.current = null;
    setCalibrationStepIndex(null);
    setCalibrationCountdownMs(null);
    setCalibrationRunning(false);
    const report = analyzeHandCalibrationRun(calibrationSamplesRef.current, {
      videoWidth: videoRef.current?.videoWidth || null,
      videoHeight: videoRef.current?.videoHeight || null,
      profile: "full-rate",
      nowMs: Date.now(),
    });
    setCalibrationReport(report);
    // eslint-disable-next-line no-console
    console.log("[hand-calibration] report ready:", report.overallVerdict, report);
  }, [stopCalibrationTimer]);

  const runCalibrationStep = useCallback((stepIndex: number) => {
    if (stepIndex >= HAND_CALIBRATION_STEPS.length) { finishCalibration(); return; }
    const definition = HAND_CALIBRATION_STEPS[stepIndex];
    calibrationActiveStepIdRef.current = definition.id;
    calibrationStepStartedAtRef.current = performance.now();
    setCalibrationStepIndex(stepIndex);
    setCalibrationCountdownMs(definition.durationMs);
    // eslint-disable-next-line no-console
    console.log(`[hand-calibration] step ${stepIndex + 1}/${HAND_CALIBRATION_STEPS.length}: ${definition.title}`);
    stopCalibrationTimer();
    calibrationTimerRef.current = window.setInterval(() => {
      const elapsed = performance.now() - calibrationStepStartedAtRef.current;
      const remaining = definition.durationMs - elapsed;
      if (remaining <= 0) { runCalibrationStep(stepIndex + 1); return; }
      setCalibrationCountdownMs(remaining);
    }, 100);
  }, [finishCalibration, stopCalibrationTimer]);

  const startCalibration = useCallback(() => {
    if (!trackingRunning) { setError("Bật tracking (webcam) trước khi chạy Hand Calibration Test."); return; }
    calibrationSamplesRef.current = emptyCalibrationSamples();
    setCalibrationReport(null);
    setCalibrationCopyStatus(null);
    setCalibrationRunning(true);
    runCalibrationStep(0);
  }, [runCalibrationStep, trackingRunning]);

  const cancelCalibration = useCallback(() => {
    stopCalibrationTimer();
    calibrationActiveStepIdRef.current = null;
    setCalibrationRunning(false);
    setCalibrationStepIndex(null);
    setCalibrationCountdownMs(null);
  }, [stopCalibrationTimer]);

  useEffect(() => () => stopCalibrationTimer(), [stopCalibrationTimer]);

  const latestTrackingMetricsRef = useRef<TrackingMetricsSnapshot | null>(null);
  const processInput = useCallback((frame: RawTrackingFrameV1) => {
    const input = simulatedLoss ? { ...frame, face: { ...frame.face, state: "lost" as const }, leftHand: { ...frame.leftHand, state: "lost" as const }, rightHand: { ...frame.rightHand, state: "lost" as const }, pose: { ...frame.pose, state: "lost" as const } } : frame;
    const next = processorRef.current.process(input); latestPacket.current = next; rendererRef.current?.applyPose(next);
    const activeStepId = calibrationActiveStepIdRef.current;
    if (activeStepId && next.handMotion) {
      const metrics = latestTrackingMetricsRef.current;
      calibrationSamplesRef.current[activeStepId].push({
        atMs: next.processedTimestampMs,
        handMotion: next.handMotion,
        pipelineFps: metrics?.pipelineFps ?? null,
        poseInferenceMs: metrics?.inferenceTimeMs.pose.p95 ?? null,
        handInferenceMs: metrics?.inferenceTimeMs.hands.p95 ?? null,
        totalProcessingMs: metrics?.inferenceTimeMs.pipeline.p95 ?? null,
      });
    }
  }, [simulatedLoss]);
  const onFrame = useCallback((frame: RawTrackingFrameV1) => { if (frozenRaw.current) return; latestRaw.current = frame; processInput(frame); }, [processInput]);
  const onMetrics = useCallback((value: TrackingMetricsSnapshot) => { latestTrackingMetricsRef.current = value; setTrackingMetrics(value); }, []);
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
      if (restRows.length === 0) setRestRows(inspectRestBasis(model.bones));
      if (raw?.pose.worldLandmarks) { setJointRows(diagnoseJoints(model.bones, raw.pose.worldLandmarks, conversion, latestPacket.current?.jointRotations, renderer.getRigProfile())); setPlaneNormals({ left: elbowPlaneNormal(raw.pose.worldLandmarks, "left", conversion), right: elbowPlaneNormal(raw.pose.worldLandmarks, "right", conversion) }); if (helpersRef.current) updateDiagnosticHelpers(helpersRef.current, model.bones, raw.pose.worldLandmarks, conversion); }
    }, 400); return () => window.clearInterval(timer);
  }, [conversion, restRows.length]);
  useEffect(() => () => { if (freezeTimerRef.current !== null) window.clearInterval(freezeTimerRef.current); if (helpersRef.current) clearDiagnosticHelpers(helpersRef.current); processorRef.current.dispose(); }, []);
  useEffect(() => { const renderer = rendererRef.current; const model = renderer?.getDiagnosticModel(); if (!model) return; if (helpers && !helpersRef.current) helpersRef.current = createDiagnosticHelpers(model.root, model.bones); if (!helpers && helpersRef.current) { clearDiagnosticHelpers(helpersRef.current); helpersRef.current = null; } }, [helpers, capability]);

  const attachRenderer = useCallback((renderer: AvatarRenderer) => {
    rendererRef.current = renderer; renderer.setSmoothing(smoothing); renderer.setZoom(zoom); renderer.setVerticalOffset(verticalOffset); processorRef.current.setRigProfile(null);
    void renderer.loadModel(MODEL_URL, { licenseStatus: "unknown" }).then((report) => { setCapability(report); processorRef.current.setRigProfile(renderer.getRigProfile()); const model = renderer.getDiagnosticModel(); if (model) setRestRows(inspectRestBasis(model.bones)); }).catch((reason) => setError(`Model blocker: ${reason instanceof Error ? reason.message : String(reason)}`));
  }, [smoothing, zoom, verticalOffset]);
  async function toggleTracking() { if (!tracking || !videoRef.current) return; if (trackingRunning) { tracking.stop(); setTrackingRunning(false); } else { setError(null); await tracking.start(videoRef.current); setTrackingRunning(true); } }
  function toggleRenderer() { const renderer = rendererRef.current; if (!renderer) return; if (rendererRunning) renderer.stop(); else renderer.start(); setRendererRunning(!rendererRunning); }
  function toggleFreeze() { if (frozenRaw.current) { frozenRaw.current = null; setFrozen(false); setSampleName("live"); return; } if (!latestRaw.current) return; frozenRaw.current = structuredClone(latestRaw.current); setFrozen(true); setFrozenSequence((value) => value + 1); setSampleName(sampleDraft.trim() || "webcam"); processInput(frozenRaw.current); }
  function freezeAfterCountdown() {
    if (frozenRaw.current || freezeTimerRef.current !== null || !latestRaw.current) return;
    let remaining = 5; setFreezeCountdown(remaining);
    freezeTimerRef.current = window.setInterval(() => {
      remaining -= 1; setFreezeCountdown(remaining);
      if (remaining > 0) return;
      window.clearInterval(freezeTimerRef.current!); freezeTimerRef.current = null; setFreezeCountdown(null); toggleFreeze();
    }, 1000);
  }
  function replay() {
    if (!frozenRaw.current) return;
    const replayed = structuredClone(frozenRaw.current); const timestamp = performance.now();
    replayed.frameTimestampMs = timestamp;
    if (replayed.pose.state === "tracked") replayed.pose.sampledAtMs = timestamp;
    processInput(replayed);
  }
  function applyPreset(name: DebugPresetName) { const value = createDebugPreset(name, performance.now()); latestRaw.current = value; frozenRaw.current = value; setFrozen(true); setFrozenSequence((current) => current + 1); setSampleName(name); processInput(value); }
  const evidenceFrame = frozenRaw.current ?? latestRaw.current; const posePoints = evidenceFrame?.pose.worldLandmarks; const evidenceLandmarks = posePoints ? { leftShoulder: posePoints[11], rightShoulder: posePoints[12], leftElbow: posePoints[13], rightElbow: posePoints[14], leftWrist: posePoints[15], rightWrist: posePoints[16] } : null;

  async function copyCalibrationReport() {
    if (!calibrationReport) return;
    const text = formatHandCalibrationReportText(calibrationReport);
    try { await navigator.clipboard.writeText(text); setCalibrationCopyStatus("Đã copy vào clipboard."); }
    catch { setCalibrationCopyStatus("Copy thất bại — trình duyệt chặn clipboard."); }
  }
  function exportCalibrationJson() {
    if (!calibrationReport) return;
    const blob = new Blob([JSON.stringify(calibrationReport, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `hand-calibration-${calibrationReport.generatedAtMs}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return <main className="avatar-renderer-dev">
    <header><div><strong>DEV ONLY · LOCAL ONLY</strong><h1>P4-T10 Retargeting Diagnostics</h1></div><p>Không upload, capture hoặc lưu raw frame.</p></header>
    {error && <pre className="dev-error" role="alert">{error}</pre>}
    <section className="dev-controls">
      <button onClick={() => void toggleTracking()}>{trackingRunning ? "Stop tracking" : "Start tracking"}</button><button onClick={toggleRenderer}>{rendererRunning ? "Stop renderer" : "Start renderer"}</button><button onClick={() => setReload((v) => v + 1)}>Reload model</button>
      <label>Sample <input value={sampleDraft} onChange={(event) => setSampleDraft(event.target.value)} /></label><button onClick={toggleFreeze} disabled={!frozen && !latestRaw.current}>{frozen ? "Unfreeze" : "Freeze current"}</button><button onClick={freezeAfterCountdown} disabled={frozen || freezeCountdown !== null || !latestRaw.current}>{freezeCountdown === null ? "Freeze in 5s" : `Freeze in ${freezeCountdown}s`}</button><button onClick={replay} disabled={!frozen}>Replay as new sample</button>
      <label><input type="checkbox" checked={filtered} onChange={(e) => setFiltered(e.target.checked)} /> Filter</label><label><input type="checkbox" checked={constraints} onChange={(e) => setConstraints(e.target.checked)} /> Constraints</label><label><input type="checkbox" checked={handTwistEnabled} onChange={(e) => setHandTwistEnabled(e.target.checked)} /> Hand twist (2B-5)</label><label><input type="checkbox" checked={smoothing} onChange={(e) => setSmoothing(e.target.checked)} /> Smoothing</label><label><input type="checkbox" checked={helpers} onChange={(e) => setHelpers(e.target.checked)} /> Helpers</label><label><input type="checkbox" checked={simulatedLoss} onChange={(e) => setSimulatedLoss(e.target.checked)} /> Simulate loss</label>
      <button onClick={() => processorRef.current.calibrateHandTwistNeutral("left")} disabled={!trackingRunning || !handTwistEnabled}>Neo neutral tay trái</button>
      <button onClick={() => processorRef.current.calibrateHandTwistNeutral("right")} disabled={!trackingRunning || !handTwistEnabled}>Neo neutral tay phải</button>
      <button onClick={() => processorRef.current.calibrateHandTwistNeutral("both")} disabled={!trackingRunning || !handTwistEnabled}>Neo neutral hai tay</button>
      <label>Conversion <select value={conversion} onChange={(e) => setConversion(e.target.value as CoordinateConversion)}><option value="current">current (-Y,-Z)</option><option value="none">none</option><option value="flipY">-Y</option><option value="flipZ">-Z</option></select></label>
      <label>Pose model <select value={poseModel} onChange={(e) => { if (trackingRunning) { tracking?.stop(); setTrackingRunning(false); } setPoseModel(e.target.value as PoseModelVariant); }}><option value="full">full (chính xác hơn)</option><option value="lite">lite (nhẹ hơn)</option></select></label>
      <label>Zoom <input type="range" min="0.5" max="3" step="0.05" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /> {zoom.toFixed(2)}x</label>
      <label>Vị trí trên/dưới <input type="range" min="-0.5" max="0.5" step="0.01" value={verticalOffset} onChange={(e) => setVerticalOffset(Number(e.target.value))} /> {verticalOffset.toFixed(2)}</label>
      <button onClick={() => { setZoom(1); setVerticalOffset(0); }}>Reset khung hình</button>
    </section>
    <section className="dev-controls"><strong>Frozen presets</strong>{PRESETS.map((name) => <button key={name} onClick={() => applyPreset(name)}>{name}</button>)}</section>
    <section className="dev-controls dev-hand-calibration">
      <strong>Mức 2B-1 — Hand Calibration Test</strong>
      {!calibrationRunning
        ? <button onClick={startCalibration}>Start Hand Calibration Test</button>
        : <button onClick={cancelCalibration}>Cancel calibration</button>}
      {calibrationRunning && calibrationStepIndex !== null && <p className="dev-hand-calibration-banner">
        <strong>{HAND_CALIBRATION_STEPS[calibrationStepIndex].title}</strong> — {HAND_CALIBRATION_STEPS[calibrationStepIndex].instruction}
        {" "}({number((calibrationCountdownMs ?? 0) / 1000, 1)}s còn lại)
      </p>}
      {calibrationReport && <>
        <p>Kết quả tổng thể: <strong className={`verdict-${calibrationReport.overallVerdict}`}>{calibrationReport.overallVerdict}</strong>
          {" · "}Video {calibrationReport.videoWidth ?? "?"}x{calibrationReport.videoHeight ?? "?"} · profile {calibrationReport.profile}</p>
        <table className="dev-hand-calibration-table">
          <thead><tr><th>Bước</th><th>Verdict</th><th>Frames</th><th>Left match%</th><th>Right match%</th><th>Ghi chú</th></tr></thead>
          <tbody>{calibrationReport.steps.map((step) => {
            const definition = HAND_CALIBRATION_STEPS.find((d) => d.id === step.stepId)!;
            return <tr key={step.stepId}>
              <td>{definition.title}</td>
              <td><strong className={`verdict-${step.verdict}`}>{step.verdict}</strong></td>
              <td>{step.frameCount}</td>
              <td>{number(step.left.handMatchedRatio * 100, 0)}%</td>
              <td>{number(step.right.handMatchedRatio * 100, 0)}%</td>
              <td>{step.reasons.length === 0 ? "—" : step.reasons.join("; ")}</td>
            </tr>;
          })}</tbody>
        </table>
        <button onClick={() => void copyCalibrationReport()}>Copy Report</button>
        <button onClick={exportCalibrationJson}>Export JSON</button>
        {calibrationCopyStatus && <span> {calibrationCopyStatus}</span>}
      </>}
    </section>
    <section className="dev-stage"><AvatarCanvas key={reload} onReady={attachRenderer} onDispose={() => { if (helpersRef.current) clearDiagnosticHelpers(helpersRef.current); helpersRef.current = null; rendererRef.current = null; processorRef.current.setRigProfile(null); }} onError={(reason) => setError(`WebGL: ${reason.message}`)} options={{ smoothing, onContextLost: (reason) => setError(reason.message) }} /><div className="dev-camera-preview"><video ref={videoRef} muted playsInline />{!trackingRunning && <p>Camera chưa bật<br /><small>Dùng webcam hoặc preset cố định</small></p>}</div></section>
    <section className="dev-panels">
      <article><h2>Frozen evidence</h2><p>Mode: {frozen ? "FROZEN" : "LIVE"} · sample: <strong>{sampleName}</strong> · frozen #{frozenSequence}</p><p>Conversion: <strong>{conversion}</strong> · raw timestamp {number(evidenceFrame?.frameTimestampMs, 0)} · packet seq {packet?.sequence ?? "—"}</p><p>Solver {filtered ? "+filter" : "raw"} · constraints {constraints ? "on" : "off"} · Hand twist {handTwistEnabled ? "on" : "Pose-only"} · smoothing {smoothing ? "on" : "off"}</p><pre>required world landmarks {JSON.stringify(evidenceLandmarks, null, 2)}</pre><pre>plane normal {JSON.stringify(planeNormals, null, 2)}</pre></article>
      <article><h2>Realtime</h2><p>Tracking/Pipeline: {number(trackingMetrics?.cameraFps)} / {number(trackingMetrics?.pipelineFps)} FPS</p><p>Renderer: {number(rendererMetrics?.fps)} FPS · p95 {number(rendererMetrics?.frameTimeP95Ms)}ms</p><p>Processor→draw: {number(rendererMetrics?.processorInputToDrawMs)}ms</p>
        <p>Pose model: <strong>{trackingMetrics?.poseModel ?? `${poseModel} (chưa chạy)`}</strong> · delegate {trackingMetrics?.selectedDelegate ?? "—"}</p>
        <p>Pose inference: {number(trackingMetrics?.inferenceTimeMs.pose.average)}ms trung bình · p95 {number(trackingMetrics?.inferenceTimeMs.pose.p95)}ms · max {number(trackingMetrics?.inferenceTimeMs.pose.max)}ms</p></article>
      <article><h2>Capability</h2>{capability ? <pre>{JSON.stringify(capability, null, 2)}</pre> : <p>Đang chờ model.</p>}</article>
      <article><h2>Tracking state</h2>{packet && Object.entries(packet.tracking).map(([name, state]) => <p key={name}>{name}: {state.sourceState} → {state.outputState}</p>)}</article>
      <article><h2>Phase 3A arm-frame</h2><p>Head: legacy/unverified, excluded from arm acceptance.</p><pre>{JSON.stringify(motionDiagnostics, null, 2)}</pre></article>
    </section>
    <section className="dev-diagnostic"><h2>H1/H6 angular evidence</h2><table><thead><tr><th>Joint</th><th>Tracked before</th><th>Tracked after</th><th>Result world</th><th>Error</th><th>Parent world q</th><th>Packet deltaLocal</th><th>Target local</th><th>Applied local</th></tr></thead><tbody>{jointRows.map((row) => <tr key={row.joint}><td>{row.joint}</td><td><code>{JSON.stringify(row.trackedBefore)}</code></td><td><code>{JSON.stringify(row.trackedAfter)}</code></td><td><code>{JSON.stringify(row.resultingWorldDirection)}</code></td><td>{number(row.angularErrorDeg, 2)}°</td><td><code>{JSON.stringify(row.parentWorldQuaternion)}</code></td><td><code>{JSON.stringify(row.packetDeltaLocalQuaternion)}</code></td><td><code>{JSON.stringify(row.targetLocalQuaternion)}</code></td><td><code>{JSON.stringify(row.appliedLocalQuaternion)}</code></td></tr>)}</tbody></table></section>
    <section className="dev-diagnostic"><h2>Normalized rest basis (H3)</h2><table><thead><tr><th>Bone/node</th><th>UUID / parent</th><th>Local rest</th><th>World rest</th><th>Rest dir</th><th>Hard-coded</th><th>dot / angle</th></tr></thead><tbody>{restRows.map((row) => <tr key={row.bone}><td>{row.bone}<br />{row.nodeName}</td><td><small>{row.uuid}<br />{row.parentName}</small></td><td><code>p={JSON.stringify(row.localPosition)}<br />q={JSON.stringify(row.localQuaternion)}</code></td><td><code>p={JSON.stringify(row.worldPosition)}<br />q={JSON.stringify(row.worldQuaternion)}</code></td><td><code>{JSON.stringify(row.restDirection)}</code></td><td><code>{JSON.stringify(row.hardCodedDirection)}</code></td><td>{number(row.dot, 3)} / {number(row.angleDeg, 2)}°</td></tr>)}</tbody></table></section>
  </main>;
}
