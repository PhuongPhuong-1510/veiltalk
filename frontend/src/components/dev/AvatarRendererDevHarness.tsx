import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AvatarCanvas } from "../avatar/AvatarCanvas";
import { AvatarMotionProcessor } from "../../lib/avatar-motion/avatarMotionProcessor";
import type { AvatarPosePacketV1 } from "../../lib/avatar-motion/avatarPoseTypes";
import type { AvatarRenderer } from "../../lib/avatar-renderer/avatarRenderer";
import type { ModelCapabilityReport } from "../../lib/avatar-renderer/modelTypes";
import type { RendererMetricsSnapshot } from "../../lib/avatar-renderer/rendererMetrics";
import { isCurrentModelLoadRequest } from "../../lib/avatar-renderer/modelLoader";
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
import type { AvatarMotionDiagnosticSnapshot } from "../../lib/avatar-motion/avatarMotionDiagnostics";
import { Quaternion, Vector3 } from "three";

const MODEL_URL = "/models/avatars/reference-avatar-4.vrm";
const number = (value: number | null | undefined, digits = 1) => value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits);
const degrees = (radians: number | null | undefined) => radians === null || radians === undefined || !Number.isFinite(radians) ? null : radians * 180 / Math.PI;

function emptyCalibrationSamples(): Record<HandCalibrationStepId, HandCalibrationSample[]> {
  return {
    "right-hand-only": [], "left-hand-only": [], "right-palm-forward": [], "right-back-forward": [],
    "right-edge-on": [], "cross-hands": [], performance: [],
  };
}

export default function AvatarRendererDevHarness() {
  const videoRef = useRef<HTMLVideoElement>(null); const rendererRef = useRef<AvatarRenderer | null>(null);
  const modelLoadRequestRef = useRef(0);
  // Hand twist là một phần của pipeline đã nghiệm thu, không còn phụ thuộc công tắc DEV.
  // Sample Hand đáng tin đầu tiên tự neo neutral; model/geometry không hỗ trợ vẫn tự rơi về Pose-only.
  const processorRef = useRef(new AvatarMotionProcessor({ handTwistEnabled: true })); const latestPacket = useRef<AvatarPosePacketV1 | null>(null); const latestRaw = useRef<RawTrackingFrameV1 | null>(null); const frozenRaw = useRef<RawTrackingFrameV1 | null>(null);
  const [filtered, setFiltered] = useState(true); const [constraints, setConstraints] = useState(true); const [smoothing, setSmoothing] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [simulatedLoss] = useState(false); const [simulatedFaceLoss, setSimulatedFaceLoss] = useState(false); const [trackingRunning, setTrackingRunning] = useState(false); const [rendererRunning, setRendererRunning] = useState(true);
  const [poseModel] = useState<PoseModelVariant>(DEFAULT_POSE_MODEL);
  const [zoom, setZoom] = useState(1); const [verticalOffset, setVerticalOffset] = useState(0);
  const [error, setError] = useState<string | null>(null); const [capability, setCapability] = useState<ModelCapabilityReport | null>(null); const [packet, setPacket] = useState<AvatarPosePacketV1 | null>(null);
  const [rendererMetrics, setRendererMetrics] = useState<RendererMetricsSnapshot | null>(null); const [trackingMetrics, setTrackingMetrics] = useState<TrackingMetricsSnapshot | null>(null);
  const [motionDiagnostics, setMotionDiagnostics] = useState<AvatarMotionDiagnosticSnapshot | null>(null);
  const [modelLoading, setModelLoading] = useState(false);

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
    const input = simulatedLoss ? { ...frame, face: { ...frame.face, state: "lost" as const }, leftHand: { ...frame.leftHand, state: "lost" as const }, rightHand: { ...frame.rightHand, state: "lost" as const }, pose: { ...frame.pose, state: "lost" as const } } : simulatedFaceLoss ? { ...frame, face: { ...frame.face, state: "lost" as const } } : frame;
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
  }, [simulatedFaceLoss, simulatedLoss]);
  const onFrame = useCallback((frame: RawTrackingFrameV1) => { if (frozenRaw.current) return; latestRaw.current = frame; processInput(frame); }, [processInput]);
  const onMetrics = useCallback((value: TrackingMetricsSnapshot) => { latestTrackingMetricsRef.current = value; setTrackingMetrics(value); }, []);
  const onError = useCallback((reason: unknown) => setError(reason instanceof Error ? reason.message : "Tracking error"), []);
  // Đổi model pose phải dựng lại pipeline (useTracking dispose theo options), nên tracking sẽ
  // dừng khi chuyển lite↔full — bấm "Start tracking" lại để đo biến thể mới.
  const trackingOptions = useMemo(() => ({ profile: "full-rate" as const, resolution: "720p" as const, delegate: "GPU" as const, tasks: { face: true, hands: true, pose: true }, poseModel, onFrame, onMetrics, onError }), [poseModel, onFrame, onMetrics, onError]);
  const tracking = useTracking(trackingOptions);

  useEffect(() => { processorRef.current.setFiltered(filtered); }, [filtered]);
  useEffect(() => { processorRef.current.setConstraints(constraints); }, [constraints]);
  useEffect(() => { rendererRef.current?.setSmoothing(smoothing); }, [smoothing]);
  useEffect(() => { rendererRef.current?.setZoom(zoom); }, [zoom]);
  useEffect(() => { rendererRef.current?.setVerticalOffset(verticalOffset); }, [verticalOffset]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const renderer = rendererRef.current; setPacket(latestPacket.current); setMotionDiagnostics(processorRef.current.getLastDiagnostics()); if (!renderer) return;
      setRendererMetrics(renderer.getMetrics());
    }, 400); return () => window.clearInterval(timer);
  }, []);
  useEffect(() => () => { processorRef.current.dispose(); }, []);

  const loadRendererModel = useCallback(async (renderer: AvatarRenderer) => {
    const requestId = ++modelLoadRequestRef.current;
    setModelLoading(true);
    setError(null);
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
    rendererRef.current = null; processorRef.current.setRigProfile(null);
  }, []);
  function reloadModel() { const renderer = rendererRef.current; if (!renderer || modelLoading) return; void loadRendererModel(renderer); }
  function probeTorsoBone() {
    const renderer = rendererRef.current; if (!renderer) return; const report = capability?.torsoShoulder; const name = report?.bones.upperChest ? "upperChest" : report?.bones.chest ? "chest" : report?.bones.spine ? "spine" : report?.bones.hips ? "hips" : null;
    if (!name) { setError("Model không có torso bone để chạy synthetic probe."); return; }
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 15 * Math.PI / 180); renderer.setDiagnosticBoneRotationOverride(name, { x: q.x, y: q.y, z: q.z, w: q.w });
  }
  function clearTorsoProbe() { const renderer = rendererRef.current; if (!renderer || !capability) return; for (const name of ["hips", "spine", "chest", "upperChest", "leftShoulder", "rightShoulder"] as const) renderer.setDiagnosticBoneRotationOverride(name, null); }
  async function toggleTracking() { if (!tracking || !videoRef.current) return; if (trackingRunning) { tracking.stop(); setTrackingRunning(false); } else { setError(null); processorRef.current.resetFaceCalibration(); processorRef.current.resetTorsoCalibration(); await tracking.start(videoRef.current); processorRef.current.startFaceCalibration(); processorRef.current.startTorsoCalibration(); setTrackingRunning(true); } }
  function toggleRenderer() { const renderer = rendererRef.current; if (!renderer) return; if (rendererRunning) renderer.stop(); else renderer.start(); setRendererRunning(!rendererRunning); }
  function toggleFreeze() { if (frozenRaw.current) { frozenRaw.current = null; setFrozen(false); return; } if (!latestRaw.current) return; frozenRaw.current = structuredClone(latestRaw.current); setFrozen(true); processInput(frozenRaw.current); }
  function replay() {
    if (!frozenRaw.current) return;
    const replayed = structuredClone(frozenRaw.current); const timestamp = performance.now();
    replayed.frameTimestampMs = timestamp;
    if (replayed.pose.state === "tracked") replayed.pose.sampledAtMs = timestamp;
    processInput(replayed);
  }

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
      <button onClick={() => void toggleTracking()}>{trackingRunning ? "Stop tracking" : "Start tracking"}</button><button onClick={toggleRenderer}>{rendererRunning ? "Stop renderer" : "Start renderer"}</button><button onClick={reloadModel} disabled={modelLoading}>{modelLoading ? "Loading model…" : "Reload model"}</button>
      <button onClick={toggleFreeze} disabled={!frozen && !latestRaw.current}>{frozen ? "Unfreeze" : "Freeze current"}</button><button onClick={replay} disabled={!frozen}>Replay as new sample</button>
      <button onClick={probeTorsoBone} disabled={!capability}>Probe torso +15°</button><button onClick={clearTorsoProbe} disabled={!capability}>Clear torso probe</button>
      <label><input type="checkbox" checked={filtered} onChange={(e) => setFiltered(e.target.checked)} /> Filter</label><label><input type="checkbox" checked={constraints} onChange={(e) => setConstraints(e.target.checked)} /> Constraints</label><label><input type="checkbox" checked={smoothing} onChange={(e) => setSmoothing(e.target.checked)} /> Smoothing</label><label><input type="checkbox" checked={simulatedFaceLoss} onChange={(e) => setSimulatedFaceLoss(e.target.checked)} /> Simulate Face loss</label>
      <label>Zoom <input type="range" min="0.5" max="3" step="0.05" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} /> {zoom.toFixed(2)}x</label>
      <label>Vị trí trên/dưới <input type="range" min="-0.5" max="0.5" step="0.01" value={verticalOffset} onChange={(e) => setVerticalOffset(Number(e.target.value))} /> {verticalOffset.toFixed(2)}</label>
      <button onClick={() => { setZoom(1); setVerticalOffset(0); }}>Reset khung hình</button>
    </section>
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
    <section className="dev-stage"><AvatarCanvas onReady={attachRenderer} onDispose={detachRenderer} onError={(reason) => setError(`WebGL: ${reason.message}`)} options={{ smoothing, onContextLost: (reason) => setError(reason.message) }} /><div className="dev-camera-preview"><video ref={videoRef} muted playsInline />{!trackingRunning && <p>Camera chưa bật<br /><small>Dùng webcam hoặc preset cố định</small></p>}</div></section>
    <section className="dev-panels">
      <article><h2>Realtime</h2><p>Tracking/Pipeline: {number(trackingMetrics?.cameraFps)} / {number(trackingMetrics?.pipelineFps)} FPS</p><p>Renderer: {number(rendererMetrics?.fps)} FPS · p95 {number(rendererMetrics?.frameTimeP95Ms)}ms</p><p>Processor→draw: {number(rendererMetrics?.processorInputToDrawMs)}ms</p>
        <p>Pose model: <strong>{trackingMetrics?.poseModel ?? `${poseModel} (chưa chạy)`}</strong> · delegate {trackingMetrics?.selectedDelegate ?? "—"}</p>
        <p>Pose inference: {number(trackingMetrics?.inferenceTimeMs.pose.average)}ms trung bình · p95 {number(trackingMetrics?.inferenceTimeMs.pose.p95)}ms · max {number(trackingMetrics?.inferenceTimeMs.pose.max)}ms</p></article>
      <article><h2>Head/neck capability</h2>{modelLoading && <p>Đang tải model mới; model hiện tại vẫn được giữ cho tới khi swap thành công.</p>}{capability ? <><p>Format: <strong>{capability.format}</strong> · VRM {capability.vrmVersion ?? "—"}</p><p>Humanoid: <strong>{capability.humanoidRig ? "yes" : "no"}</strong> · rest {capability.restPose}</p><p>Head: <strong>{capability.requiredBones.head ? "supported" : "missing"}</strong></p><p>Neck: <strong>{capability.requiredBones.neck ? "supported" : "missing"}</strong></p></> : !modelLoading && <p>Chưa có model sẵn sàng.</p>}</article>
      <article><h2>3E torso/shoulder baseline</h2>{capability ? <><p>Torso chain: <strong>{capability.torsoShoulder.hierarchy}</strong></p><p>Bones: {Object.entries(capability.torsoShoulder.bones).map(([name, present]) => `${name}=${present ? "yes" : "no"}`).join(" · ")}</p><p>Shoulders: L={capability.torsoShoulder.shoulderStatus.left} · R={capability.torsoShoulder.shoulderStatus.right}</p><p>Upper-arm parent: L/R={capability.torsoShoulder.upperArmParentMode.left}</p></> : <p>Chưa có capability.</p>}{motionDiagnostics && <><p>Basis source: <strong>{motionDiagnostics.torso.source}</strong> · observation {motionDiagnostics.torso.observationRejectionReason ?? "—"}</p><p>Calibration: <strong>{motionDiagnostics.torso.calibration.status}</strong> · {motionDiagnostics.torso.calibration.acceptedSamples} accepted/{motionDiagnostics.torso.calibration.rejectedSamples} rejected · solve {motionDiagnostics.torso.rejectionReason ?? "ready"}</p><p>Visibility: LS {number(motionDiagnostics.torso.visibility.leftShoulder, 2)} · RS {number(motionDiagnostics.torso.visibility.rightShoulder, 2)} · LH {number(motionDiagnostics.torso.visibility.leftHip, 2)} · RH {number(motionDiagnostics.torso.visibility.rightHip, 2)}</p><p>Input Y/P/R: {number(motionDiagnostics.torso.inputEulerDegrees?.yaw, 1)} / {number(motionDiagnostics.torso.inputEulerDegrees?.pitch, 1)} / {number(motionDiagnostics.torso.inputEulerDegrees?.roll, 1)}</p><p>Output Y/P/R: {number(motionDiagnostics.torso.outputEulerDegrees?.yaw, 1)} / {number(motionDiagnostics.torso.outputEulerDegrees?.pitch, 1)} / {number(motionDiagnostics.torso.outputEulerDegrees?.roll, 1)}</p></>}</article>
      {/* Phase 3B: số liệu để nghiệm thu twist bằng webcam. Góc hiển thị theo ĐỘ vì manual
          matrix so trực tiếp với góc tay thật; `applied` là góc cuối cùng ghi vào lowerArm. */}
      <article><h2>3B hand twist (độ)</h2>{motionDiagnostics ? <table><thead><tr><th></th><th>trái</th><th>phải</th></tr></thead><tbody>
        {([
          ["reference", (side: "left" | "right") => motionDiagnostics.handTwist[side].twistReferenceSource],
          ["raw", (side: "left" | "right") => number(degrees(motionDiagnostics.handTwist[side].rawWrappedTwistRadians))],
          ["corrected", (side: "left" | "right") => number(degrees(motionDiagnostics.handTwist[side].correctedTwistRadians))],
          ["applied", (side: "left" | "right") => number(degrees(motionDiagnostics.handTwist[side].appliedTwistRadians))],
          ["clamp", (side: "left" | "right") => motionDiagnostics.handTwist[side].clampApplied ? "CLAMPED" : "—"],
          ["temporal", (side: "left" | "right") => motionDiagnostics.handTwist[side].temporalTrackingState],
          ["observation", (side: "left" | "right") => motionDiagnostics.handTwist[side].observationMode],
          ["neutral", (side: "left" | "right") => motionDiagnostics.handTwist[side].neutralReanchorReason ?? (motionDiagnostics.handTwist[side].neutralInitialized ? "anchored" : "—")],
          ["rejection", (side: "left" | "right") => motionDiagnostics.handTwist[side].rejectionReason ?? "—"],
        ] as const).map(([label, read]) => <tr key={label}><td>{label}</td><td><strong>{read("left")}</strong></td><td><strong>{read("right")}</strong></td></tr>)}
      </tbody></table> : <p>Chưa có motion diagnostics.</p>}</article>
      <article><h2>3E semantic mode</h2>{motionDiagnostics ? <><p>Mode: <strong>{motionDiagnostics.torso.observationMode}</strong></p><p>Pitch: <strong>{motionDiagnostics.torso.pitchObservable ? "live" : "held-neutral"}</strong></p><p>Runtime: <strong>{motionDiagnostics.torso.distribution?.mode ?? "unsupported"}</strong> · loss {motionDiagnostics.torso.loss.state} · hierarchy-safe parent targets</p></> : <p>Chưa có torso observation.</p>}</article>
      <article><h2>Tracking state</h2>{packet && Object.entries(packet.tracking).map(([name, state]) => <p key={name}>{name}: {state.sourceState} → {state.outputState}</p>)}</article>
    </section>
  </main>;
}
