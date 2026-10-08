import { TRACKING_TIMING_NAMES, type TrackingMetricsSnapshot, type TrackingTimingName } from "../../lib/tracking/trackingMetrics";
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

export function TrackingPerformancePanel({ metrics, context }: { metrics: TrackingMetricsSnapshot | null; context?: Record<string, string | boolean> }) {
  if (!metrics?.timings) return <p className="tracking-performance-empty">Phase A: bật camera để xem metrics.</p>;
  const timings = metrics.timings;
  const download = () => {
    const report = { phase: "A", capturedAtUtc: new Date().toISOString(), page: window.location.pathname,
      windows: { fpsSeconds: 10, timingSamplesMax: metrics.timingSamplesMax ?? 600, longTasks: metrics.longTaskScope },
      limitations: ["Video callbacks are those received by the pipeline, not an independent camera loop.",
        "Video presented FPS is estimated from presentedFrames deltas at received callbacks; no sensor capture timestamp.",
        "Worker timings use local durations; no cross-thread queue-time inference.",
        "applyPose accepts a target; actual bone updates and draw occur in the renderer loop.",
        "totalProcessFrameMs includes instrumentation; its current frame enters the next UI snapshot."],
      definitions, context, metrics };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = `tracking-phase-a-${Date.now()}.json`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const fpsRows = [
    ["Video presented (diagnostic)", metrics.videoPresentedFps],
    ["Video callbacks nhận được", metrics.videoCallbackFps],
    ["Pipeline frames nhận xử lý", metrics.pipelineFrameFps],
    ["Face sample", metrics.faceSampleFps], ["Hands sample", metrics.handSampleFps], ["Pose sample", metrics.poseSampleFps],
    ["Tracking publish", metrics.trackingPublishFps], ["Avatar apply", metrics.avatarApplyFps],
    ["Render (cửa sổ mẫu renderer)", metrics.renderFps],
  ] as const;
  return <details className="tracking-performance">
    <summary>Performance – Phase A · publish {format(metrics.trackingPublishFps)} FPS · total avg {timings.totalProcessFrameMs.count ? format(timings.totalProcessFrameMs.average) : "—"} ms</summary>
    <p>UI ~2 Hz. FPS: 10 giây; timing: tối đa {metrics.timingSamplesMax ?? 600} mẫu mỗi bước. “—” = chưa có mẫu/không áp dụng. Render dùng collector hiện có.</p>
    <p>Callback/presented frame không phải thời điểm cảm biến chụp ảnh. Hands worker chạy song song: không cộng Face + Pose + Hands thành tổng.</p>
    <button type="button" onClick={download}>Tải metrics JSON</button>
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
    <p>Long tasks (cộng dồn từ {metrics.measurementId ? "reset benchmark" : "Start"}): {metrics.mainThreadLongTasks} · blocked {format(metrics.mainThreadBlockedMs)} ms · nguồn {metrics.longTaskSource} · Hand samples quá cũ: {metrics.handWorkerDroppedSamples ?? 0}</p>
    {metrics.handDiagnostics && <details><summary>Pose hint / ROI theo mode (cộng dồn từ lần reset số liệu)</summary>
      <p>Fresh = tuổi 0–120ms; chưa có nghĩa landmark đủ tin cậy để dùng ROI. Coverage là output tracked, chưa đối chiếu tay thực sự trong khung.</p>
      <pre>{JSON.stringify(metrics.handDiagnostics, null, 2)}</pre></details>}
    <p>Hands: {metrics.handExecution ?? "—"} / {metrics.handDelegate ?? "—"} · ROI {metrics.handInputMode ?? "—"} · confidence {metrics.handConfidenceMode ?? "—"} · adaptive available {String(metrics.adaptiveHandAvailable ?? false)}</p>
    {metrics.runtimeConfig && <pre>{JSON.stringify(metrics.runtimeConfig, null, 2)}</pre>}
    {metrics.runtimeConfig?.profile === "full-rate" && <p>Full-rate: cả ba model được yêu cầu trên mỗi frame đủ điều kiện. Các interval trong config là giá trị dự phòng cho staggered, không giới hạn tần suất trong lượt này.</p>}
    <p>Giữ nguyên cấu hình và ánh sáng trong một lượt đo. Dừng rồi bật camera để bắt đầu lượt mới; báo cáo JSON chứa cả tuổi mẫu, lost/reacquire và runtime config.</p>
  </details>;
}
