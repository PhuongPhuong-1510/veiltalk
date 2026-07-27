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
import "./avatarRendererDevHarness.css";

const MODEL_URL = "/models/avatars/reference-avatar.vrm";
const PRESETS: DebugPresetName[] = ["tPose", "armsDown", "leftArmUp", "rightArmUp", "leftElbow90", "rightElbow90", "bothForward", "twistReferenceA", "twistReferenceB"];
const number = (value: number | null | undefined, digits = 1) => value === null || value === undefined || !Number.isFinite(value) ? "—" : value.toFixed(digits);

export default function AvatarRendererDevHarness() {
  const videoRef = useRef<HTMLVideoElement>(null); const rendererRef = useRef<AvatarRenderer | null>(null); const helpersRef = useRef<Group | null>(null);
  const freezeTimerRef = useRef<number | null>(null);
  const processorRef = useRef(new AvatarMotionProcessor()); const latestPacket = useRef<AvatarPosePacketV1 | null>(null); const latestRaw = useRef<RawTrackingFrameV1 | null>(null); const frozenRaw = useRef<RawTrackingFrameV1 | null>(null);
  const [filtered, setFiltered] = useState(false); const [constraints, setConstraints] = useState(false); const [smoothing, setSmoothing] = useState(false);
  const [helpers, setHelpers] = useState(false); const [frozen, setFrozen] = useState(false); const [conversion, setConversion] = useState<CoordinateConversion>("current");
  const [sampleName, setSampleName] = useState("live"); const [sampleDraft, setSampleDraft] = useState("Pose A — T-pose"); const [frozenSequence, setFrozenSequence] = useState(0);
  const [freezeCountdown, setFreezeCountdown] = useState<number | null>(null);
  const [simulatedLoss, setSimulatedLoss] = useState(false); const [trackingRunning, setTrackingRunning] = useState(false); const [rendererRunning, setRendererRunning] = useState(true);
  const [error, setError] = useState<string | null>(null); const [capability, setCapability] = useState<ModelCapabilityReport | null>(null); const [packet, setPacket] = useState<AvatarPosePacketV1 | null>(null);
  const [restRows, setRestRows] = useState<RestBasisRow[]>([]); const [jointRows, setJointRows] = useState<JointDiagnosticRow[]>([]); const [planeNormals, setPlaneNormals] = useState<Record<string, unknown>>({});
  const [motionDiagnostics, setMotionDiagnostics] = useState<AvatarMotionDiagnosticSnapshot | null>(null);
  const [rendererMetrics, setRendererMetrics] = useState<RendererMetricsSnapshot | null>(null); const [trackingMetrics, setTrackingMetrics] = useState<TrackingMetricsSnapshot | null>(null); const [reload, setReload] = useState(0);

  const processInput = useCallback((frame: RawTrackingFrameV1) => {
    const input = simulatedLoss ? { ...frame, face: { ...frame.face, state: "lost" as const }, leftHand: { ...frame.leftHand, state: "lost" as const }, rightHand: { ...frame.rightHand, state: "lost" as const }, pose: { ...frame.pose, state: "lost" as const } } : frame;
    const next = processorRef.current.process(input); latestPacket.current = next; rendererRef.current?.applyPose(next);
  }, [simulatedLoss]);
  const onFrame = useCallback((frame: RawTrackingFrameV1) => { if (frozenRaw.current) return; latestRaw.current = frame; processInput(frame); }, [processInput]);
  const onMetrics = useCallback((value: TrackingMetricsSnapshot) => setTrackingMetrics(value), []); const onError = useCallback((reason: unknown) => setError(reason instanceof Error ? reason.message : "Tracking error"), []);
  const trackingOptions = useMemo(() => ({ profile: "full-rate" as const, resolution: "720p" as const, delegate: "GPU" as const, tasks: { face: true, hands: true, pose: true }, onFrame, onMetrics, onError }), [onFrame, onMetrics, onError]);
  const tracking = useTracking(trackingOptions);

  useEffect(() => { processorRef.current.setFiltered(filtered); }, [filtered]);
  useEffect(() => { processorRef.current.setConstraints(constraints); }, [constraints]);
  useEffect(() => { rendererRef.current?.setSmoothing(smoothing); }, [smoothing]);
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
    rendererRef.current = renderer; renderer.setSmoothing(smoothing); processorRef.current.setRigProfile(null);
    void renderer.loadModel(MODEL_URL, { licenseStatus: "unknown" }).then((report) => { setCapability(report); processorRef.current.setRigProfile(renderer.getRigProfile()); const model = renderer.getDiagnosticModel(); if (model) setRestRows(inspectRestBasis(model.bones)); }).catch((reason) => setError(`Model blocker: ${reason instanceof Error ? reason.message : String(reason)}`));
  }, [smoothing]);
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

  return <main className="avatar-renderer-dev">
    <header><div><strong>DEV ONLY · LOCAL ONLY</strong><h1>P4-T10 Retargeting Diagnostics</h1></div><p>Không upload, capture hoặc lưu raw frame.</p></header>
    {error && <pre className="dev-error" role="alert">{error}</pre>}
    <section className="dev-controls">
      <button onClick={() => void toggleTracking()}>{trackingRunning ? "Stop tracking" : "Start tracking"}</button><button onClick={toggleRenderer}>{rendererRunning ? "Stop renderer" : "Start renderer"}</button><button onClick={() => setReload((v) => v + 1)}>Reload model</button>
      <label>Sample <input value={sampleDraft} onChange={(event) => setSampleDraft(event.target.value)} /></label><button onClick={toggleFreeze} disabled={!frozen && !latestRaw.current}>{frozen ? "Unfreeze" : "Freeze current"}</button><button onClick={freezeAfterCountdown} disabled={frozen || freezeCountdown !== null || !latestRaw.current}>{freezeCountdown === null ? "Freeze in 5s" : `Freeze in ${freezeCountdown}s`}</button><button onClick={replay} disabled={!frozen}>Replay as new sample</button>
      <label><input type="checkbox" checked={filtered} onChange={(e) => setFiltered(e.target.checked)} /> Filter</label><label><input type="checkbox" checked={constraints} onChange={(e) => setConstraints(e.target.checked)} /> Constraints</label><label><input type="checkbox" checked={smoothing} onChange={(e) => setSmoothing(e.target.checked)} /> Smoothing</label><label><input type="checkbox" checked={helpers} onChange={(e) => setHelpers(e.target.checked)} /> Helpers</label><label><input type="checkbox" checked={simulatedLoss} onChange={(e) => setSimulatedLoss(e.target.checked)} /> Simulate loss</label>
      <label>Conversion <select value={conversion} onChange={(e) => setConversion(e.target.value as CoordinateConversion)}><option value="current">current (-Y,-Z)</option><option value="none">none</option><option value="flipY">-Y</option><option value="flipZ">-Z</option></select></label>
    </section>
    <section className="dev-controls"><strong>Frozen presets</strong>{PRESETS.map((name) => <button key={name} onClick={() => applyPreset(name)}>{name}</button>)}</section>
    <section className="dev-stage"><AvatarCanvas key={reload} onReady={attachRenderer} onDispose={() => { if (helpersRef.current) clearDiagnosticHelpers(helpersRef.current); helpersRef.current = null; rendererRef.current = null; processorRef.current.setRigProfile(null); }} onError={(reason) => setError(`WebGL: ${reason.message}`)} options={{ smoothing, onContextLost: (reason) => setError(reason.message) }} /><div className="dev-camera-preview"><video ref={videoRef} muted playsInline />{!trackingRunning && <p>Camera chưa bật<br /><small>Dùng webcam hoặc preset cố định</small></p>}</div></section>
    <section className="dev-panels">
      <article><h2>Frozen evidence</h2><p>Mode: {frozen ? "FROZEN" : "LIVE"} · sample: <strong>{sampleName}</strong> · frozen #{frozenSequence}</p><p>Conversion: <strong>{conversion}</strong> · raw timestamp {number(evidenceFrame?.frameTimestampMs, 0)} · packet seq {packet?.sequence ?? "—"}</p><p>Solver {filtered ? "+filter" : "raw"} · constraints {constraints ? "on" : "off"} · smoothing {smoothing ? "on" : "off"}</p><pre>required world landmarks {JSON.stringify(evidenceLandmarks, null, 2)}</pre><pre>plane normal {JSON.stringify(planeNormals, null, 2)}</pre></article>
      <article><h2>Realtime</h2><p>Tracking/Pipeline: {number(trackingMetrics?.cameraFps)} / {number(trackingMetrics?.pipelineFps)} FPS</p><p>Renderer: {number(rendererMetrics?.fps)} FPS · p95 {number(rendererMetrics?.frameTimeP95Ms)}ms</p><p>Processor→draw: {number(rendererMetrics?.processorInputToDrawMs)}ms</p></article>
      <article><h2>Capability</h2>{capability ? <pre>{JSON.stringify(capability, null, 2)}</pre> : <p>Đang chờ model.</p>}</article>
      <article><h2>Tracking state</h2>{packet && Object.entries(packet.tracking).map(([name, state]) => <p key={name}>{name}: {state.sourceState} → {state.outputState}</p>)}</article>
      <article><h2>Phase 3A arm-frame</h2><p>Head: legacy/unverified, excluded from arm acceptance.</p><pre>{JSON.stringify(motionDiagnostics, null, 2)}</pre></article>
    </section>
    <section className="dev-diagnostic"><h2>H1/H6 angular evidence</h2><table><thead><tr><th>Joint</th><th>Tracked before</th><th>Tracked after</th><th>Result world</th><th>Error</th><th>Parent world q</th><th>Packet deltaLocal</th><th>Target local</th><th>Applied local</th></tr></thead><tbody>{jointRows.map((row) => <tr key={row.joint}><td>{row.joint}</td><td><code>{JSON.stringify(row.trackedBefore)}</code></td><td><code>{JSON.stringify(row.trackedAfter)}</code></td><td><code>{JSON.stringify(row.resultingWorldDirection)}</code></td><td>{number(row.angularErrorDeg, 2)}°</td><td><code>{JSON.stringify(row.parentWorldQuaternion)}</code></td><td><code>{JSON.stringify(row.packetDeltaLocalQuaternion)}</code></td><td><code>{JSON.stringify(row.targetLocalQuaternion)}</code></td><td><code>{JSON.stringify(row.appliedLocalQuaternion)}</code></td></tr>)}</tbody></table></section>
    <section className="dev-diagnostic"><h2>Normalized rest basis (H3)</h2><table><thead><tr><th>Bone/node</th><th>UUID / parent</th><th>Local rest</th><th>World rest</th><th>Rest dir</th><th>Hard-coded</th><th>dot / angle</th></tr></thead><tbody>{restRows.map((row) => <tr key={row.bone}><td>{row.bone}<br />{row.nodeName}</td><td><small>{row.uuid}<br />{row.parentName}</small></td><td><code>p={JSON.stringify(row.localPosition)}<br />q={JSON.stringify(row.localQuaternion)}</code></td><td><code>p={JSON.stringify(row.worldPosition)}<br />q={JSON.stringify(row.worldQuaternion)}</code></td><td><code>{JSON.stringify(row.restDirection)}</code></td><td><code>{JSON.stringify(row.hardCodedDirection)}</code></td><td>{number(row.dot, 3)} / {number(row.angleDeg, 2)}°</td></tr>)}</tbody></table></section>
  </main>;
}
