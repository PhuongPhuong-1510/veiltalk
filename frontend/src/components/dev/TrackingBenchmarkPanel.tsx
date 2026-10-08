import { useEffect, useRef, useState } from "react";
import type { TrackingPipeline } from "../../lib/tracking/trackingPipeline";
import type { TrackingMetricsSnapshot } from "../../lib/tracking/trackingMetrics";
import { BENCHMARK_PROFILES, BenchmarkSession, getBenchmarkProfile, type BenchmarkActivity, type BenchmarkProfileId, type BenchmarkResult } from "./trackingBenchmark";

interface Props {
  profileId: BenchmarkProfileId; onProfileChange: (id: BenchmarkProfileId) => void;
  pipeline: TrackingPipeline | null; metrics: TrackingMetricsSnapshot | null;
  readinessError: string | null; context: BenchmarkResult["context"];
  onActiveChange: (active: boolean) => void;
}
export function TrackingBenchmarkPanel(props: Props) {
  const session = useRef(new BenchmarkSession());
  const latest = useRef(props); latest.current = props;
  const [activity, setActivity] = useState<BenchmarkActivity>("stationary");
  const [qualityNotes, setQualityNotes] = useState("");
  const [result, setResult] = useState<BenchmarkResult | null>(null);
  const [, refresh] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const active = ["warmup", "waiting-reset", "measuring"].includes(session.current.stage);
  const metrics = props.metrics;
  useEffect(() => {
    const timer = window.setInterval(() => {
      const s = session.current, p = latest.current;
      if (!["warmup", "waiting-reset", "measuring"].includes(s.stage)) return;
      if (document.hidden || p.readinessError || p.pipeline?.state !== "running") {
        s.abort(document.hidden ? "Tab đã bị ẩn; lượt này không hợp lệ." : p.readinessError ?? "Tracking đã dừng.");
        p.onActiveChange(false);
      } else {
        try { s.tick(performance.now(), () => p.pipeline!.requestMeasurementReset()); }
        catch (error) { s.abort(String(error)); p.onActiveChange(false); }
        if (s.stage === "aborted") p.onActiveChange(false);
      }
      setRemaining(s.remainingSeconds(performance.now())); refresh(v => v + 1);
    }, 500);
    const onVisibility = () => {
      if (document.hidden && ["warmup", "waiting-reset", "measuring"].includes(session.current.stage)) {
        session.current.abort("Tab đã bị ẩn; lượt này không hợp lệ."); latest.current.onActiveChange(false); refresh(v => v + 1);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);
  useEffect(() => {
    if (!metrics) return;
    const current = latest.current;
    session.current.accept(metrics);
    setRemaining(session.current.remainingSeconds(performance.now()));
    if (session.current.stage === "complete" && !result) {
      setResult(session.current.result(getBenchmarkProfile(current.profileId), activity, current.context, qualityNotes));
      current.onActiveChange(false);
    }
    refresh(v => v + 1);
  }, [metrics, activity, qualityNotes, result]);
  const download = () => {
    if (!result) return;
    const payload = { ...result, qualityNotes };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url;
    link.download = `tracking-b1-${result.profile.id}-${result.activity}-${Date.now()}.json`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="tracking-performance">
    <h2>Benchmark B1 — DEV</h2>
    <label>Cấu hình <select value={props.profileId} disabled={active || props.pipeline?.state === "starting"} onChange={e => { setResult(null); session.current = new BenchmarkSession(); props.onProfileChange(e.target.value as BenchmarkProfileId); }}>
      {BENCHMARK_PROFILES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
    </select></label>
    <p>{getBenchmarkProfile(props.profileId).limitation}</p>
    <label>Lượt đo <select value={activity} disabled={active} onChange={e => setActivity(e.target.value as BenchmarkActivity)}><option value="stationary">Đứng yên</option><option value="movement">Chuyển động</option></select></label>{" "}
    <button disabled={active || !!props.readinessError || props.pipeline?.state !== "running"} onClick={() => { session.current.start(performance.now()); setResult(null); setRemaining(10); props.onActiveChange(true); refresh(v => v + 1); }}>Bắt đầu 10s warm-up + 60s đo</button>{" "}
    {active && <button onClick={() => { session.current.abort("Người dùng hủy lượt đo."); props.onActiveChange(false); refresh(v => v + 1); }}>Hủy lượt đo</button>}
    <p role="status">{session.current.stage === "warmup" ? `Warm-up: còn ${remaining}s. Chưa lấy mẫu benchmark.`
      : session.current.stage === "waiting-reset" ? "Đợi ranh giới frame để reset số liệu…"
      : session.current.stage === "measuring" ? `Đang đo ${activity === "stationary" ? "đứng yên" : "chuyển động"}: còn ${remaining}s.`
      : session.current.stage === "complete" ? `Hoàn tất ${result?.measuredSeconds.toFixed(1) ?? "60"}s. Tải JSON trước khi đổi cấu hình.`
      : session.current.stage === "aborted" ? session.current.error : "Chọn A–E → Start tracking → bắt đầu lượt đo. Mỗi lượt tự loại 10s warm-up."}</p>
    {props.readinessError && <p>{props.readinessError}</p>}
    <p>Giữ 1280×720, GPU, cùng avatar/ánh sáng/render. A và E: thử nâng/hạ tay, gập/che khuỷu, tay qua thân, xoay cổ tay, mất/nhận lại tay, vai và nói nhanh.</p>
    <label>Ghi chú chất lượng/điều kiện <textarea value={qualityNotes} onChange={e => setQualityNotes(e.target.value)} placeholder="Ánh sáng, tay có trong khung không, vai/khuỷu/cổ tay rung hoặc lệch, mouth khi nói nhanh…" /></label>{" "}
    <button disabled={!result} onClick={download}>Tải kết quả B1 JSON</button>
    {result && <p>Kết quả đã lưu trong màn này; có thể Stop tracking trước khi tải. Profile {result.profile.id} · {result.activity} · publish toàn lượt {result.overallFps.trackingPublish?.toFixed(2)} FPS.</p>}
  </section>;
}
