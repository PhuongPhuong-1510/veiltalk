import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CameraResolution } from "../../lib/tracking/cameraController";
import type { DelegateSelection, TrackingTaskSelection } from "../../lib/tracking/mediaPipeRuntime";
import type { RawTrackingFrameV1 } from "../../lib/tracking/rawTrackingTypes";
import type { TrackingMetricsSnapshot } from "../../lib/tracking/trackingMetrics";
import { useTracking } from "../../lib/tracking/useTracking";
import type { TrackingPipelineState, TrackingProfile } from "../../lib/tracking/trackingPipeline";
import "./trackingDevHarness.css";

const emptyMetrics: TrackingMetricsSnapshot = {
  runDurationMs: 0,
  cameraFps: 0,
  pipelineFps: 0,
  inferenceFps: { face: 0, hands: 0, pose: 0 },
  inferenceTimeMs: {
    face: { average: 0, p95: 0, max: 0 },
    hands: { average: 0, p95: 0, max: 0 },
    pose: { average: 0, p95: 0, max: 0 },
    pipeline: { average: 0, p95: 0, max: 0 },
  },
  sampleAgeMs: {
    face: { average: 0, p95: 0, max: 0 },
    leftHand: { average: 0, p95: 0, max: 0 },
    rightHand: { average: 0, p95: 0, max: 0 },
    pose: { average: 0, p95: 0, max: 0 },
  },
  mainThreadLongTasks: 0,
  mainThreadBlockedMs: 0,
  selectedDelegate: null,
  stateRatio: {
    face: { tracked: 0, lost: 0, "not-sampled": 0 },
    leftHand: { tracked: 0, lost: 0, "not-sampled": 0 },
    rightHand: { tracked: 0, lost: 0, "not-sampled": 0 },
    pose: { tracked: 0, lost: 0, "not-sampled": 0 },
  },
  lossEvents: { face: 0, leftHand: 0, rightHand: 0, pose: 0 },
};

const number = (value: number) => Number.isFinite(value) ? value.toFixed(1) : "—";

export default function TrackingDevHarness() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [profile, setProfile] = useState<TrackingProfile>("full-rate");
  const [resolution, setResolution] = useState<CameraResolution>("720p");
  const [delegate, setDelegate] = useState<DelegateSelection>("GPU");
  const [taskMode, setTaskMode] = useState<"all" | "face" | "hands" | "pose">("all");
  const [previewVisible, setPreviewVisible] = useState(true);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [pipelineState, setPipelineState] = useState<TrackingPipelineState>("idle");
  const [frame, setFrame] = useState<RawTrackingFrameV1 | null>(null);
  const [metrics, setMetrics] = useState(emptyMetrics);
  const [error, setError] = useState<string | null>(null);
  const [handednessMistakes, setHandednessMistakes] = useState(0);
  const [actualVideoSize, setActualVideoSize] = useState("—");
  const [actualCameraFps, setActualCameraFps] = useState("—");

  const onFrame = useCallback((next: RawTrackingFrameV1) => setFrame(next), []);
  const onMetrics = useCallback((next: TrackingMetricsSnapshot) => setMetrics(next), []);
  const onError = useCallback((reason: unknown) => {
    setError(reason instanceof Error ? (reason.stack ?? reason.message) : "Tracking gặp lỗi không xác định.");
    setPipelineState("error");
  }, []);
  const tasks = useMemo<TrackingTaskSelection>(() => ({
    face: taskMode === "all" || taskMode === "face",
    hands: taskMode === "all" || taskMode === "hands",
    pose: taskMode === "all" || taskMode === "pose",
  }), [taskMode]);
  const trackingOptions = useMemo(() => ({ profile, resolution, delegate, tasks, onFrame, onMetrics, onError }), [profile, resolution, delegate, tasks, onFrame, onMetrics, onError]);
  const pipeline = useTracking(trackingOptions);

  useEffect(() => { if (pipeline) setPipelineState("idle"); }, [pipeline]);

  useEffect(() => {
    const canvas = overlayRef.current; const video = videoRef.current;
    if (!canvas || !video || !frame || !overlayVisible || !video.videoWidth) return;
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const point = (landmark: { x: number; y: number }, color: string, radius: number) => {
      context.beginPath(); context.fillStyle = color;
      context.arc((1 - landmark.x) * canvas.width, landmark.y * canvas.height, radius, 0, Math.PI * 2); context.fill();
    };
    for (const landmark of frame.face.landmarks ?? []) point(landmark, "#55d8ff", 1.3);
    for (const landmark of frame.pose.landmarks ?? []) point(landmark, "#ffe66d", 3);
    for (const landmark of frame.leftHand.landmarks ?? []) point(landmark, "#71f79f", 3);
    for (const landmark of frame.rightHand.landmarks ?? []) point(landmark, "#ff7aa2", 3);
    context.font = "bold 18px sans-serif";
    const label = (sample: typeof frame.leftHand, text: string, color: string) => {
      const anchor = sample.landmarks?.[0]; if (!anchor) return;
      context.fillStyle = color; context.fillText(text, (1 - anchor.x) * canvas.width + 8, anchor.y * canvas.height - 8);
    };
    label(frame.leftHand, `LEFT (${frame.leftHand.state})`, "#71f79f");
    label(frame.rightHand, `RIGHT (${frame.rightHand.state})`, "#ff7aa2");
  }, [frame, overlayVisible]);

  async function start() {
    if (!videoRef.current || !pipeline) return;
    setError(null);
    setMetrics(emptyMetrics);
    setHandednessMistakes(0);
    setPipelineState("starting");
    try {
      await pipeline.start(videoRef.current);
      setActualVideoSize(`${videoRef.current.videoWidth}×${videoRef.current.videoHeight}`);
      setActualCameraFps(pipeline.cameraSettings?.frameRate?.toFixed(1) ?? "unknown");
      setPipelineState(pipeline.state);
    } catch {
      setPipelineState(pipeline.state);
    }
  }

  function stop() {
    if (!pipeline) return;
    pipeline.stop();
    setPipelineState(pipeline.state);
  }

  return (
    <main className="tracking-dev">
      <header>
        <div><strong>DEV ONLY</strong><h1>MediaPipe Tracking Spike</h1></div>
        <p>Webcam và raw landmarks chỉ được xử lý cục bộ trong trình duyệt.</p>
      </header>

      <section className="tracking-dev-controls">
        {(["Resolution", "Delegate", "Tasks"] as const).map((label) => label === "Resolution" ? (
          <label key={label}>{label}<select value={resolution} disabled={!pipeline || pipelineState === "running" || pipelineState === "starting"} onChange={(e) => setResolution(e.target.value as CameraResolution)}><option value="720p">1280×720</option><option value="480p">640×480</option></select></label>
        ) : label === "Delegate" ? (
          <label key={label}>{label}<select value={delegate} disabled={!pipeline || pipelineState === "running" || pipelineState === "starting"} onChange={(e) => setDelegate(e.target.value as DelegateSelection)}><option value="GPU">GPU</option><option value="CPU">CPU</option></select></label>
        ) : (
          <label key={label}>{label}<select value={taskMode} disabled={!pipeline || pipelineState === "running" || pipelineState === "starting"} onChange={(e) => setTaskMode(e.target.value as typeof taskMode)}><option value="all">All three</option><option value="face">Face only</option><option value="hands">Hands only</option><option value="pose">Pose only</option></select></label>
        ))}
        <label>Profile
          <select value={profile} disabled={!pipeline || pipelineState === "running" || pipelineState === "starting"}
            onChange={(event) => setProfile(event.target.value as TrackingProfile)}>
            <option value="full-rate">Full-rate</option>
            <option value="staggered">Staggered</option>
          </select>
        </label>
        <button onClick={() => void start()} disabled={!pipeline || pipelineState === "running" || pipelineState === "starting"}>Start</button>
        <button onClick={stop} disabled={!pipeline || pipelineState !== "running"}>Stop</button>
        <button onClick={() => setPreviewVisible((visible) => !visible)}>{previewVisible ? "Ẩn webcam" : "Hiện webcam"}</button>
        <button onClick={() => setOverlayVisible((visible) => !visible)}>{overlayVisible ? "Ẩn overlay" : "Hiện overlay"}</button>
        <span>State: <b>{pipelineState}</b></span>
        <span>Actual video: <b>{actualVideoSize}</b> @ <b>{actualCameraFps} FPS</b> · Overlay: <b>{overlayVisible ? "ON" : "OFF"}</b></span>
      </section>

      {error && <div className="tracking-dev-error" role="alert">{error}</div>}

      <section className="tracking-dev-grid">
        <div className="tracking-dev-preview">
          <h2>Webcam preview</h2>
          <div className={previewVisible ? "tracking-preview-stage" : "tracking-preview-stage is-hidden"}>
            <video ref={videoRef} aria-label="Webcam local preview" />
            <canvas ref={overlayRef} className={overlayVisible ? "" : "is-hidden"} aria-label="Landmark overlay local-only" />
          </div>
          {!previewVisible && <p>Preview đang ẩn; pipeline vẫn có thể tiếp tục chạy.</p>}
        </div>

        <div>
          <h2>Tracking state</h2>
          <dl>
            <dt>Overall</dt><dd>{frame?.overall ?? "—"}</dd>
            <dt>Face</dt><dd>{frame?.face.state ?? "—"}</dd>
            <dt>Left hand</dt><dd>{frame?.leftHand.state ?? "—"}</dd>
            <dt>Right hand</dt><dd>{frame?.rightHand.state ?? "—"}</dd>
            <dt>Pose</dt><dd>{frame?.pose.state ?? "—"}</dd>
          </dl>
          <button onClick={() => setHandednessMistakes((count) => count + 1)}>Đánh dấu handedness sai</button>
          <p>Handedness sai đã quan sát: <b>{handednessMistakes}</b></p>
        </div>
      </section>

      <section>
        <h2>Performance (FPS: 10s; distributions: rolling samples)</h2>
        <table><thead><tr><th>Group</th><th>Inference FPS</th><th>Avg ms</th><th>P95 ms</th><th>Age avg/p95/max ms</th></tr></thead>
          <tbody>
            <tr><td>Face</td><td>{number(metrics.inferenceFps.face)}</td><td>{number(metrics.inferenceTimeMs.face.average)}</td><td>{number(metrics.inferenceTimeMs.face.p95)}</td><td>{number(metrics.sampleAgeMs.face.average)} / {number(metrics.sampleAgeMs.face.p95)} / {number(metrics.sampleAgeMs.face.max)}</td></tr>
            <tr><td>Hands</td><td>{number(metrics.inferenceFps.hands)}</td><td>{number(metrics.inferenceTimeMs.hands.average)}</td><td>{number(metrics.inferenceTimeMs.hands.p95)}</td><td>L {number(metrics.sampleAgeMs.leftHand.average)} / {number(metrics.sampleAgeMs.leftHand.p95)} / {number(metrics.sampleAgeMs.leftHand.max)} · R {number(metrics.sampleAgeMs.rightHand.average)} / {number(metrics.sampleAgeMs.rightHand.p95)} / {number(metrics.sampleAgeMs.rightHand.max)}</td></tr>
            <tr><td>Pose</td><td>{number(metrics.inferenceFps.pose)}</td><td>{number(metrics.inferenceTimeMs.pose.average)}</td><td>{number(metrics.inferenceTimeMs.pose.p95)}</td><td>{number(metrics.sampleAgeMs.pose.average)} / {number(metrics.sampleAgeMs.pose.p95)} / {number(metrics.sampleAgeMs.pose.max)}</td></tr>
          </tbody>
        </table>
        <p>Run: <b>{number(metrics.runDurationMs / 1000)}s</b> · Camera FPS: <b>{number(metrics.cameraFps)}</b> · Pipeline FPS: <b>{number(metrics.pipelineFps)}</b> · Configured delegate: <b>{metrics.selectedDelegate ?? "—"}</b></p>
        <p>Main-thread long tasks: <b>{metrics.mainThreadLongTasks}</b> · blocked: <b>{number(metrics.mainThreadBlockedMs)} ms</b></p>
        <h3>Tracking quality ratios</h3>
        <table><thead><tr><th>Group</th><th>Tracked</th><th>Lost</th><th>Not sampled</th><th>Loss events</th></tr></thead><tbody>
          {(["face", "leftHand", "rightHand", "pose"] as const).map((group) => <tr key={group}><td>{group}</td><td>{number(metrics.stateRatio[group].tracked * 100)}%</td><td>{number(metrics.stateRatio[group].lost * 100)}%</td><td>{number(metrics.stateRatio[group]["not-sampled"] * 100)}%</td><td>{metrics.lossEvents[group]}</td></tr>)}
        </tbody></table>
      </section>
    </main>
  );
}
