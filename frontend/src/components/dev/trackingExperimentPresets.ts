import type { TrackingExperiments } from "../../lib/tracking/trackingScheduler";

export const TRACKING_EXPERIMENT_PRESETS = [
  { id: "baseline-v1", label: "Baseline — full-rate", description: "Cấu hình production hiện tại; mọi thử nghiệm tắt.", experiments: {} },
  { id: "callback-ahead-v1", label: "B2 — Callback ahead", description: "Đăng ký callback sớm, bỏ callback khi bận; không lưu backlog.", experiments: { callbackAhead: true } },
  { id: "bounded-pose-v1", label: "B2 — Bounded Pose", description: "Có thể bỏ tối đa một lượt Pose nếu dự kiến mẫu vẫn mới; cần kiểm tra vai/khuỷu/cổ tay.", experiments: { boundedPose: true } },
  { id: "roi-recovery-v1", label: "B4 — ROI recovery", description: "Probe full-frame khi thiếu riêng một vùng tay hoặc đến hạn định kỳ.", experiments: { handRoiRecovery: true } },
  { id: "cached-hint-v1", label: "B4 — Cached Pose hint", description: "Cho phép geometry not-sampled còn ≤120ms; không đổi state. Full-rate có thể không kích hoạt nhánh này.", experiments: { cachedPoseHint: true } },
  { id: "pose-cached-hint-v1", label: "B2+B4 — Pose + cached hint", description: "So với Bounded Pose để cô lập tác động cached hint; chú ý tay chuyển động nhanh.", experiments: { boundedPose: true, cachedPoseHint: true } },
  { id: "combined-v1", label: "B2+B4 — Combined (experimental)", description: "Chỉ thử sau các cấu hình đơn; không suy ra lợi ích cộng dồn.", experiments: { callbackAhead: true, boundedPose: true, cachedPoseHint: true, handRoiRecovery: true } },
] satisfies Array<{ id: string; label: string; description: string; experiments: TrackingExperiments }>;
