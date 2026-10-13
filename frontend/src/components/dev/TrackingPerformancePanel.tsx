import { TRACKING_TIMING_NAMES, type TrackingMetricsSnapshot, type TrackingTimingName } from "../../lib/tracking/trackingMetrics";
import { useState } from "react";
import "./trackingPerformancePanel.css";

const definitions: Record<TrackingTimingName, string> = {
  videoCallbackIntervalMs: "Khoảng cách giữa các video callback mà pipeline nhận; gồm cả xử lý frame trước và chờ browser.",
  callbackToPipelineStartMs: "Video callback thực thi → bắt đầu processFrame; cùng đồng hồ main thread.",
  awaitNextVideoCallbackMs: "Đăng ký callback → callback kế tiếp thực thi; không khẳng định toàn bộ là idle.",
  captureVideoBitmapMs: "Thời gian await createImageBitmap(video).",
  captureHandBitmapMs: "Thời gian await createImageBitmap(snapshot) để chuyển cho Hands.",
  framePreparationMs: "Pipeline start → trước dispatch Hand; gồm lập kế hoạch và hai lần capture.",
  faceInferenceMs: "Chỉ Face detectForVideo.",
  handsInferenceMs: "Chỉ Hand detectForVideo nếu worker có timing mới; tách ROI và mapping.",
  poseInferenceMs: "Chỉ Pose detectForVideo.",
  mainThreadInferenceMs: "Nhánh Face → Hands nếu không dùng worker → Pose; gồm preparation nội bộ và ghi inference metrics.",
  workerWaitMs: "Thời gian await Hand sau khi nhánh main-thread đã xong; không cộng lại round-trip vào critical path.",
  workerRoundTripMs: "Main thread gọi detect → promise continuation nhận kết quả; gồm dispatch, worker và chờ main thread.",
  workerPostMessageMs: "Thời gian gọi postMessage trên main thread; không phải transfer completion hay queue latency.",
  workerRoiPreparationMs: "Worker chọn confidence, lập ROI và vẽ input trước detectForVideo.",
  workerMappingMs: "Worker ánh xạ kết quả detectForVideo về ảnh nguồn.",
  workerTotalMs: "Worker nhận message → response-ready; không gồm truyền response và đóng bitmap.",
  poseHintAgeMs: "Tuổi Pose mẫu trước dùng để lập hand hint; ROI chỉ chấp nhận hint ≤120ms và đáng tin.",
  mapRawTrackingFrameMs: "Thời gian tạo RawTrackingFrameV1.",
  motionProcessMs: "Thời gian gọi AvatarMotionProcessor.process, gồm toàn bộ solver/filter hiện tại.",
  avatarApplyMs: "Thời gian gọi AvatarRenderer.applyPose để đặt target; không phải cập nhật bone/draw thực tế.",
  onFrameMs: "Thời gian callback onFrame; gồm motion, apply và các tác vụ consumer khác.",
  trackingPublishMs: "Pipeline start → RawTrackingFrame được tạo xong; không gồm onFrame.",
  pipelineStartToAvatarApplyMs: "Pipeline start → applyPose trả về; không phải camera sensor latency.",
  callbackToAvatarApplyMs: "Video callback thực thi → applyPose trả về; không phải camera sensor latency.",
  totalProcessFrameMs: "Pipeline start → ngay trước scheduleNext; gồm mapping, onFrame, snapshot/UI handler và đóng bitmap. Snapshot UI thấy mẫu tổng này ở tick kế tiếp.",
};
const format = (value: number | null | undefined) => value == null || !Number.isFinite(value) ? "—" : value.toFixed(2);

export function TrackingPerformancePanel({ metrics, context, onResetMeasurement }: { metrics: TrackingMetricsSnapshot | null; context?: Record<string, string | boolean>; onResetMeasurement?: () => boolean }) {
  const [scenario, setScenario] = useState("still");
  const [resetMessage, setResetMessage] = useState("");
  if (!metrics?.timings) return <p className="tracking-performance-empty">Phase A: bật camera để xem metrics.</p>;
  const timings = metrics.timings;
  const observations = metrics.observations;
  const completedHandCalls = Object.values(observations?.byInputMode ?? {}).reduce((sum, mode) => sum + mode.attempts, 0);
  const invalidReasons = [
    ...(metrics.handWorkerFallback ? [`Worker fallback: ${metrics.handWorkerFallback}`] : []),
    ...(!metrics.measurement?.id ? ["Chưa Reset Measurement sau warm-up."] : []),
    ...(["frozen", "simulatedLoss", "recordingActive", "replayActive"].filter(key => context?.[key] === true).map(key => `${key} đang bật.`)),
    ...(context?.rendererRunning === false ? ["Renderer đang dừng."] : []),
  ];
  const download = () => {
    const report = { phase: "B", schemaVersion: 1, sourceHash: import.meta.env.VITE_MOTION_SOURCE_HASH ?? null,
      capturedAtUtc: new Date().toISOString(), page: window.location.pathname, scenario,
      environment: { userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency, crossOriginIsolated: globalThis.crossOriginIsolated, devicePixelRatio: window.devicePixelRatio },
      benchmark: { validForControlledComparison: invalidReasons.length === 0, invalidReasons, webcamQualityVerified: false },
      windows: { fpsSeconds: 10, timingSamplesMax: 600, counts: "since-measurement-start", longTasks: "since-measurement-start" },
      limitations: ["Video callbacks are those received by the pipeline, not an independent camera loop.",
        "Video presented FPS is estimated from presentedFrames deltas at received callbacks; no sensor capture timestamp.",
        "Worker timings use local durations; no cross-thread queue-time inference.",
        "applyPose accepts a target; actual bone updates and draw occur in the renderer loop.",
        "totalProcessFrameMs includes instrumentation; its current frame enters the next UI snapshot.",
        "Detector-label coverage is not downstream hand identity or manually labelled recall; reacquire uses new accepted observations only.",
        "Render FPS retains the renderer's own measurement window. No sensor-to-display latency is measured.",
        "Comparison validity checks configuration only; equal lighting, motion, camera cadence and warm-up still require operator verification."],
      definitions, context, metrics };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = `tracking-phase-b-${scenario}-${Date.now()}.json`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const fpsRows = [
    ["Video presented (diagnostic)", metrics.videoPresentedFps],
    ["Video callbacks nhận được", metrics.videoCallbackFps],
    ["Pipeline frames nhận xử lý", metrics.pipelineFrameFps],
    ["Face sample", metrics.faceSampleFps], ["Hands sample", metrics.handSampleFps], ["Pose sample", metrics.poseSampleFps],
    ["Accepted Hands observation", observations?.acceptedHandFps],
    ["Tracking publish", metrics.trackingPublishFps], ["Avatar apply", metrics.avatarApplyFps],
    ["Render (cửa sổ mẫu renderer)", metrics.renderFps],
  ] as const;
  return <details className="tracking-performance">
    <summary>Performance – Phase B · publish {format(metrics.trackingPublishFps)} FPS · accepted Hands {format(observations?.acceptedHandFps)} Hz</summary>
    <p>UI ~2 Hz. FPS: 10 giây; timing: tối đa 600 mẫu mỗi bước. “—” = chưa có mẫu/không áp dụng. Render dùng collector hiện có.</p>
    <p>Callback/presented frame không phải thời điểm cảm biến chụp ảnh. Hands worker chạy song song: không cộng Face + Pose + Hands thành tổng.</p>
    <button type="button" onClick={download}>Tải metrics JSON</button>
    {onResetMeasurement && <button type="button" onClick={() => setResetMessage(onResetMeasurement() ? "Đã yêu cầu reset ở frame mới kế tiếp; xem Measurement ID tăng bên dưới." : "Bật tracking trước khi reset.")}>Reset Measurement sau warm-up</button>}
    <label>Kịch bản <select aria-label="Measurement scenario" value={scenario} onChange={e => setScenario(e.target.value)}><option value="still">Đứng yên</option><option value="moving">Chuyển động</option><option value="occlusion">Che tay / reacquire</option><option value="crossing">Giao tay</option></select></label>
    <p role="status">{resetMessage} Measurement ID: {metrics.measurement?.id ?? 0} · {format((metrics.measurement?.durationMs ?? 0) / 1000)} s · mẫu Hands được nhận: {observations?.acceptedHandSamples ?? 0}</p>
    {invalidReasons.length > 0 && <p role="alert">Chưa dùng lượt này để kết luận A/B: {invalidReasons.join(" ")}</p>}
    {context && <p>{Object.entries(context).map(([name, value]) => `${name}: ${String(value)}`).join(" · ")}</p>}
    <div className="tracking-performance-tables">
      <table><caption>FPS / Hz</caption><thead><tr><th>Loại</th><th>FPS</th></tr></thead><tbody>
        {fpsRows.map(([name, value]) => <tr key={name}><td>{name}</td><td>{format(value)}</td></tr>)}
      </tbody></table>
      <table><caption>Thời gian (ms) — rê chuột lên tên để xem định nghĩa</caption><thead><tr><th>Metric</th><th>Avg</th><th>P50</th><th>P95</th><th>Mẫu</th></tr></thead><tbody>
        {TRACKING_TIMING_NAMES.map(name => { const d = timings[name]; return <tr key={name}><td title={definitions[name]}>{name}</td>
          <td>{d.count ? format(d.average) : "—"}</td><td>{d.count ? format(d.p50) : "—"}</td><td>{d.count ? format(d.p95) : "—"}</td><td>{d.count}</td></tr>; })}
      </tbody></table>
    </div>
    <p>Long tasks (từ Start/Reset Measurement): {metrics.mainThreadLongTasks} · blocked {format(metrics.mainThreadBlockedMs)} ms · nguồn {metrics.longTaskSource} · Hand samples quá cũ: {metrics.handWorkerDroppedSamples ?? 0}</p>
    <p>Hands: {metrics.handExecution ?? "—"} / {metrics.handDelegate ?? "—"} · ROI {metrics.handInputMode ?? "—"} · confidence {metrics.handConfidenceMode ?? "—"} · adaptive available {String(metrics.adaptiveHandAvailable ?? false)}</p>
    {metrics.runtimeConfig && <pre>{JSON.stringify(metrics.runtimeConfig, null, 2)}</pre>}
    {observations && <>
      <p>Callback bỏ khi bận: {observations.busyCallbacks} · trùng/không hợp lệ: {observations.duplicateCallbacks} · Worker errors: {observations.workerErrors} · Hand–Pose skew p95: {format(observations.handPoseSkewMs.p95)} ms</p>
      <table><caption>Hands theo input mode — lượt hoàn tất kể cả kết quả bị loại vì quá cũ; L/R theo nhãn detector</caption><thead><tr><th>Mode</th><th>Lượt / nhận</th><th>Tỷ lệ sử dụng</th><th>Có tay / L / R</th><th>ROI prep avg/p95</th><th>Inference avg/p95</th><th>Mapping avg/p95</th></tr></thead><tbody>{Object.entries(observations.byInputMode).map(([mode, stats]) => <tr key={mode}><td>{mode}</td><td>{stats.attempts} / {stats.accepted}</td><td>{completedHandCalls ? format(stats.attempts * 100 / completedHandCalls) : "—"}%</td><td>{stats.withAnyHand} / {stats.leftDetected} / {stats.rightDetected}</td><td>{format(stats.preparationMs.average)} / {format(stats.preparationMs.p95)}</td><td>{format(stats.inferenceMs.average)} / {format(stats.inferenceMs.p95)}</td><td>{format(stats.mappingMs.average)} / {format(stats.mappingMs.p95)}</td></tr>)}</tbody></table>
      <table><caption>Coverage nhãn detector trên observation mới được nhận — không phải recall được gán nhãn hoặc Hand–Pose match</caption><thead><tr><th>Tay</th><th>Tracked / observations</th><th>Loss / reacquire</th><th>Reacquire avg/p95 ms</th></tr></thead><tbody>{Object.entries(observations.detectorLabelCoverage).map(([side, stats]) => <tr key={side}><td>{side}</td><td>{stats.tracked} / {stats.observed}</td><td>{stats.lossEvents} / {stats.reacquireEvents}</td><td>{format(stats.reacquireMs.average)} / {format(stats.reacquireMs.p95)}</td></tr>)}</tbody></table>
      <table><caption>Tuổi mẫu tại publish (ms)</caption><thead><tr><th>Nhóm</th><th>Avg</th><th>P95</th></tr></thead><tbody>{Object.entries(metrics.sampleAgeMs).map(([group, age]) => <tr key={group}><td>{group}</td><td>{format(age.average)}</td><td>{format(age.p95)}</td></tr>)}</tbody></table>
      <pre>{JSON.stringify({ hintStatus: observations.hintStatus, roiReason: observations.roiReason, confidence: observations.confidence }, null, 2)}</pre>
    </>}
    {metrics.runtimeConfig?.profile === "full-rate" && !metrics.runtimeConfig.experiments?.boundedPose && <p>Full-rate: cả ba model được yêu cầu trên mỗi frame đủ điều kiện. Các interval chỉ áp dụng cho staggered.</p>}
    <p>Giữ cấu hình, ánh sáng và chuyển động tương đương. Warm-up rồi Reset Measurement, chờ ID tăng và đo từng kịch bản riêng. Không đổi kịch bản giữa một cửa sổ đo.</p>
  </details>;
}
