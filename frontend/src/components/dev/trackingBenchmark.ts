import type { TrackingTaskSelection, PoseModelVariant } from "../../lib/tracking/mediaPipeRuntime";
import type { TrackingMetricsSnapshot } from "../../lib/tracking/trackingMetrics";

export type BenchmarkProfileId = "A" | "B" | "C" | "D" | "E";
export interface BenchmarkProfile { id: BenchmarkProfileId; label: string; tasks: TrackingTaskSelection; poseModel: PoseModelVariant; limitation: string }
export const BENCHMARK_PROFILES: readonly BenchmarkProfile[] = [
  { id: "A", label: "A – Baseline (Face + Hands + Pose Full)", tasks: { face: true, hands: true, pose: true }, poseModel: "full", limitation: "Baseline; đánh giá performance và chất lượng toàn bộ motion." },
  { id: "B", label: "B – No Hands", tasks: { face: true, hands: false, pose: true }, poseModel: "full", limitation: "Không có Hands/worker/copy bitmap cho Hands; không kết luận chất lượng ngón hoặc wrist reconstruction." },
  { id: "C", label: "C – No Pose", tasks: { face: true, hands: true, pose: false }, poseModel: "full", limitation: "Không có Pose hint nên Hands dùng full-frame; không phải phép đo chỉ bỏ riêng chi phí Pose. Không đánh giá arm/elbow motion." },
  { id: "D", label: "D – Face Only", tasks: { face: true, hands: false, pose: false }, poseModel: "full", limitation: "Chỉ xác định giới hạn Face khi render avatar; không đánh giá chất lượng tay/vai." },
  { id: "E", label: "E – Pose Lite", tasks: { face: true, hands: true, pose: true }, poseModel: "lite", limitation: "So sánh với A cả performance và độ ổn định shoulder/elbow/wrist; chưa chọn Lite làm mặc định." },
];
export const getBenchmarkProfile = (id: BenchmarkProfileId) => BENCHMARK_PROFILES.find(p => p.id === id)!;

export type BenchmarkActivity = "stationary" | "movement";
export interface BenchmarkResult {
  phase: "B1"; profile: BenchmarkProfile; activity: BenchmarkActivity;
  warmupSeconds: 10; targetSeconds: 60; measuredSeconds: number;
  capturedAtUtc: string; context: Record<string, string | number | boolean>;
  overallFps: Record<string, number | null>;
  metrics: TrackingMetricsSnapshot; snapshots: TrackingMetricsSnapshot[];
  qualityNotes: string;
  limitations: string[];
}

/** Pure controller so warm-up, boundary reset, stale snapshots and abort are testable. */
export class BenchmarkSession {
  stage: "idle" | "warmup" | "waiting-reset" | "measuring" | "complete" | "aborted" = "idle";
  private warmupAt = 0;
  private resetRequestedAt = 0;
  private measurementId: number | null = null;
  private latest: TrackingMetricsSnapshot | null = null;
  private history: TrackingMetricsSnapshot[] = [];
  error = "";
  start(now: number): void { this.stage = "warmup"; this.warmupAt = now; this.measurementId = null; this.latest = null; this.history = []; this.error = ""; }
  abort(reason: string): void { this.stage = "aborted"; this.error = reason; }
  tick(now: number, requestReset: () => number): void {
    if (this.stage === "warmup" && now - this.warmupAt >= 10_000) {
      this.measurementId = requestReset(); this.resetRequestedAt = now; this.stage = "waiting-reset";
    }
    const lastDataAt = this.latest?.measurementStartedAtMs == null ? this.resetRequestedAt
      : this.latest.measurementStartedAtMs + this.latest.runDurationMs;
    if (["waiting-reset", "measuring"].includes(this.stage) && now - lastDataAt > 5000) this.abort("Không nhận được metrics mới trong 5 giây; lượt đo không hoàn tất.");
  }
  accept(snapshot: TrackingMetricsSnapshot): void {
    if (snapshot.measurementId !== this.measurementId || snapshot.measurementStartedAtMs == null) return;
    if (this.stage === "waiting-reset") this.stage = "measuring";
    if (this.stage !== "measuring") return;
    this.latest = snapshot;
    this.history.push(snapshot);
    if (this.history.length > 180) this.history.shift();
    if (snapshot.runDurationMs >= 60_000) this.stage = "complete";
  }
  remainingSeconds(now: number): number {
    if (this.stage === "warmup") return Math.max(0, Math.ceil((10_000 - now + this.warmupAt) / 1000));
    if (this.stage === "measuring" && this.latest?.measurementStartedAtMs != null) return Math.max(0, Math.ceil((60_000 - now + this.latest.measurementStartedAtMs) / 1000));
    return 0;
  }
  result(profile: BenchmarkProfile, activity: BenchmarkActivity, context: BenchmarkResult["context"], qualityNotes: string): BenchmarkResult | null {
    if (this.stage !== "complete" || !this.latest) return null;
    const metrics = this.latest, seconds = metrics.runDurationMs / 1000;
    return { phase: "B1", profile, activity, warmupSeconds: 10, targetSeconds: 60, measuredSeconds: seconds,
      capturedAtUtc: new Date().toISOString(), context, qualityNotes, metrics, snapshots: [...this.history],
      overallFps: { ...Object.fromEntries(Object.entries(metrics.measurementCounts ?? {}).map(([name, count]) => [name, count / seconds])),
        videoPresented: metrics.measurementPresentedFps ?? null, render: null },
      limitations: [profile.limitation,
        "Overall event FPS = measurement count / actual duration. Presented FPS uses counter deltas over received callbacks; not sensor FPS.",
        "Snapshot FPS uses a rolling 10s window; renderer FPS uses its existing window, not a whole-run event counter.",
        "Timings retain at most 4096 samples per metric/mode (enough for 60s at 30fps); sample counts reveal inactive tasks. No summation of parallel branches.",
        "Measurement finishes at the first metrics emission >=60s (up to roughly one UI interval later). Total timing omits the current in-flight frame until the next snapshot.",
        "Coverage counts tracked outputs, not ground-truth hand visibility. ROI correlations are observational, not causal.",
        "DEV harness adds existing diagnostics; compare all A–E in this same harness. No raw landmarks/video are exported.",
        "Long tasks are cumulative since measurement reset; an observer entry spanning the boundary may include work just before it."] };
  }
}
