import type { RawHandCandidateV1, RawTrackingFrameV1 } from "../tracking/rawTrackingTypes";

/**
 * Phase 3B.3 — Việc 0: thu fixture landmark THẬT từ webcam trước khi viết classifier.
 *
 * Lý do tồn tại của module này: Phase 3B đạt 390/390 automated PASS nhưng webcam vẫn lộ hai lỗi
 * (tay rơi sau timeout, cẳng tay xuyên thân) mà không test tổng hợp nào bắt được. Nếu classifier
 * cử chỉ chỉ được kiểm bằng bàn tay dựng bằng tay ("đẹp", đúng trục, không che), mọi ngưỡng sẽ
 * PASS trong khi thực tế sai. Fixture ở đây là để ngưỡng được chọn từ PHÂN BỐ THẬT, không phải
 * từ phỏng đoán.
 *
 * Ràng buộc riêng tư (NFR-06): chỉ lưu toạ độ landmark đã chuẩn hoá, KHÔNG lưu ảnh, khung hình
 * hay bất kỳ dữ liệu nào tái dựng được khuôn mặt. Xuất file là hành động thủ công của người dùng
 * trong DEV harness; không tự động upload đi đâu.
 */

/** Nhãn tình huống thu mẫu. Không phải nhãn cử chỉ đầu ra của classifier. */
export type GestureFixturePose =
  // Bốn nhãn cốt lõi mà classifier phải nhận ra.
  | "open" | "fist" | "point" | "thumbUp"
  // Hai biến thể hướng ngón cái — hình dạng bàn tay GIỐNG HỆT `thumbUp`, chỉ khác hướng. Đây là
  // dữ liệu quyết định để chứng minh điều kiện hướng hoạt động (lỗi lớn nhất của plan v1).
  | "thumbSide" | "thumbDown"
  // Tư thế không thuộc nhãn cốt lõi. Dùng làm ca `unknown-observed`: bàn tay hiện rõ nhưng không
  // khớp nhãn nào, avatar phải NHẢ cử chỉ cũ thay vì giữ mãi.
  | "relaxed" | "peace" | "ok" | "rock" | "heartFinger" | "callMe"
  | "other";
export type GestureFixtureOrientation = "palm-to-camera" | "back-to-camera" | "edge-on";
export type GestureFixtureDistance = "near" | "normal" | "far";
export type GestureFixtureOcclusion = "none" | "partial-fingers";
export type GestureFixtureSplit = "calibration" | "holdout";

/** Điều kiện thu của một mẫu — do người thu khai báo, dùng làm ground truth khi phân tích. */
export interface GestureFixtureCondition {
  side: "left" | "right";
  pose: GestureFixturePose;
  orientation: GestureFixtureOrientation;
  distance: GestureFixtureDistance;
  occlusion: GestureFixtureOcclusion;
  split: GestureFixtureSplit;
}

export interface GestureFixtureSample {
  /** Thứ tự thu, để truy vết thứ tự thời gian sau khi xuất. */
  index: number;
  capturedAtMs: number;
  condition: GestureFixtureCondition;
  handedness: RawHandCandidateV1["handedness"];
  handednessScore: number | null;
  sourceIndex: number;
  sampledAtMs: number;
  /** 21 landmark image-space đã chuẩn hoá. */
  landmarks: Array<{ x: number; y: number; z: number; visibility: number | null }>;
  /** 21 landmark world-space. */
  worldLandmarks: Array<{ x: number; y: number; z: number }>;
  /** Kích thước video nguồn — cần để sửa aspect ratio khi phân tích lại. */
  videoSize: { width: number; height: number } | null;
}

export interface GestureFixtureFile {
  version: 1;
  kind: "veiltalk-gesture-fixture";
  exportedAtMs: number;
  sampleCount: number;
  /** Thống kê nhanh số mẫu theo từng tổ hợp điều kiện, để biết còn thiếu ca nào. */
  coverage: GestureFixtureCoverageEntry[];
  samples: GestureFixtureSample[];
}

export interface GestureFixtureCoverageEntry {
  side: GestureFixtureCondition["side"];
  pose: GestureFixturePose;
  orientation: GestureFixtureOrientation;
  distance: GestureFixtureDistance;
  occlusion: GestureFixtureOcclusion;
  split: GestureFixtureSplit;
  count: number;
}

const conditionKey = (condition: GestureFixtureCondition): string =>
  `${condition.side}|${condition.pose}|${condition.orientation}|${condition.distance}|${condition.occlusion}|${condition.split}`;

/**
 * Chọn candidate ứng với bên tay đang thu.
 *
 * Cố ý KHÔNG dùng `handPoseMatching` ở đây: matcher gắn candidate với wrist của Pose, nên nó phụ
 * thuộc chất lượng Pose. Việc 0 chỉ cần bàn tay, và người thu đã tự khai bên tay — dùng nhãn
 * handedness thô giữ cho fixture độc lập với pipeline Pose. Nếu có nhiều candidate cùng nhãn,
 * lấy candidate có handednessScore cao nhất.
 */
export function selectFixtureCandidate(frame: RawTrackingFrameV1, side: "left" | "right"): RawHandCandidateV1 | null {
  const matching = frame.rawHands.filter((candidate) => candidate.handedness === side);
  if (matching.length === 0) return null;
  return matching.reduce((best, candidate) =>
    (candidate.handednessScore ?? 0) > (best.handednessScore ?? 0) ? candidate : best);
}

/** Số landmark MediaPipe Hand trả về; mẫu thiếu/thừa bị loại để không làm bẩn phân tích. */
export const HAND_LANDMARK_COUNT = 21;

export interface FixtureCaptureResult {
  sample: GestureFixtureSample | null;
  rejectionReason: "no-hand-sample" | "no-candidate-for-side" | "incomplete-landmarks" | "duplicate-sample" | null;
}

/**
 * Bộ thu fixture. Giữ mẫu trong bộ nhớ; người dùng chủ động xuất JSON khi thu xong.
 */
export class GestureFixtureCollector {
  private samples: GestureFixtureSample[] = [];
  private nextIndex = 0;
  private readonly acceptedSampleKeys = new Set<string>();

  /**
   * Thu một mẫu từ frame hiện tại.
   *
   * Chỉ chấp nhận frame mà Hand Landmarker THỰC SỰ chạy (`handSampledThisFrame`). Frame
   * duplicate mang lại đúng landmark cũ; nếu nhận, phân bố feature sẽ bị lệch về phía những tư
   * thế người dùng giữ lâu — đúng loại thiên lệch làm hỏng việc chọn ngưỡng.
   */
  capture(frame: RawTrackingFrameV1, condition: GestureFixtureCondition, nowMs: number): FixtureCaptureResult {
    if (!frame.handSampledThisFrame) return { sample: null, rejectionReason: "no-hand-sample" };
    const candidate = selectFixtureCandidate(frame, condition.side);
    if (!candidate) return { sample: null, rejectionReason: "no-candidate-for-side" };
    if (candidate.landmarks.length !== HAND_LANDMARK_COUNT || candidate.worldLandmarks.length !== HAND_LANDMARK_COUNT) {
      return { sample: null, rejectionReason: "incomplete-landmarks" };
    }
    const sampleKey = `${condition.side}|${candidate.sampledAtMs}|${candidate.sourceIndex}`;
    if (this.acceptedSampleKeys.has(sampleKey)) return { sample: null, rejectionReason: "duplicate-sample" };
    const sample: GestureFixtureSample = {
      index: this.nextIndex++,
      capturedAtMs: nowMs,
      condition: { ...condition },
      handedness: candidate.handedness,
      handednessScore: candidate.handednessScore,
      sourceIndex: candidate.sourceIndex,
      sampledAtMs: candidate.sampledAtMs,
      landmarks: candidate.landmarks.map((point) => ({ x: point.x, y: point.y, z: point.z, visibility: point.visibility })),
      worldLandmarks: candidate.worldLandmarks.map((point) => ({ x: point.x, y: point.y, z: point.z })),
      videoSize: frame.videoWidth !== null && frame.videoHeight !== null
        ? { width: frame.videoWidth, height: frame.videoHeight }
        : null,
    };
    this.samples.push(sample);
    this.acceptedSampleKeys.add(sampleKey);
    return { sample, rejectionReason: null };
  }

  /** Số mẫu theo từng tổ hợp điều kiện — dùng để biết còn thiếu ca nào trước khi dừng thu. */
  getCoverage(): GestureFixtureCoverageEntry[] {
    const counts = new Map<string, GestureFixtureCoverageEntry>();
    for (const sample of this.samples) {
      const key = conditionKey(sample.condition);
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { ...sample.condition, count: 1 });
    }
    return [...counts.values()].sort((a, b) => conditionKey(a).localeCompare(conditionKey(b)));
  }

  getSampleCount(): number { return this.samples.length; }
  /** Bản sao nông theo thứ tự thu; đủ cho hiển thị và xuất file. */
  getSamples(): readonly GestureFixtureSample[] { return this.samples; }

  /** Xoá mẫu gần nhất — dùng khi người thu bấm nhầm tư thế. */
  undoLast(): boolean {
    if (this.samples.length === 0) return false;
    const removed = this.samples.pop()!;
    this.acceptedSampleKeys.delete(`${removed.condition.side}|${removed.sampledAtMs}|${removed.sourceIndex}`);
    this.nextIndex -= 1;
    return true;
  }

  clear(): void { this.samples = []; this.nextIndex = 0; this.acceptedSampleKeys.clear(); }

  toFile(exportedAtMs: number): GestureFixtureFile {
    return {
      version: 1,
      kind: "veiltalk-gesture-fixture",
      exportedAtMs,
      sampleCount: this.samples.length,
      coverage: this.getCoverage(),
      samples: this.samples,
    };
  }
}

/**
 * Ma trận điều kiện cần phủ trước khi phân tích ngưỡng.
 *
 * `other` cố ý KHÔNG nằm trong danh sách bắt buộc: nó là nhãn thoát cho tư thế ngẫu nhiên, không
 * phải một ca cần phủ. Bắt người thu phải thu "other" cho đủ 2 side × 2 split là vô nghĩa.
 */
export const REQUIRED_FIXTURE_POSES: GestureFixturePose[] = [
  "open", "fist", "point", "thumbUp", "thumbSide", "thumbDown",
  "relaxed", "peace", "ok", "rock", "heartFinger", "callMe",
];
export const REQUIRED_FIXTURE_SPLITS: GestureFixtureSplit[] = ["calibration", "holdout"];
export const REQUIRED_FIXTURE_ORIENTATIONS: GestureFixtureOrientation[] = ["palm-to-camera", "back-to-camera", "edge-on"];
export const REQUIRED_FIXTURE_DISTANCES: GestureFixtureDistance[] = ["near", "normal", "far"];

export interface FixtureGapReport {
  /** Tổ hợp side × pose chưa có mẫu nào — mức tối thiểu phải phủ hết. */
  missingSidePose: Array<{ side: "left" | "right"; pose: GestureFixturePose; split: GestureFixtureSplit }>;
  /** Hướng bàn tay chưa từng thu, bất kể tư thế. */
  missingOrientations: GestureFixtureOrientation[];
  /** Khoảng cách chưa từng thu, bất kể tư thế. */
  missingDistances: GestureFixtureDistance[];
  /** Đã thu mẫu có ngón bị che một phần chưa. */
  hasPartialOcclusion: boolean;
  complete: boolean;
}

/**
 * Báo còn thiếu ca nào. Cố ý chỉ yêu cầu phủ side×pose×split ở mức tối thiểu thay vì đòi đủ tích
 * Đề-các (2×8×3×3×2×2 = 576 tổ hợp) — đòi đủ sẽ khiến việc thu trở nên bất khả thi và người thu bỏ cuộc.
 * Hướng, khoảng cách và che khuất được kiểm riêng ở mức "đã từng thu".
 */
export function reportFixtureGaps(coverage: readonly GestureFixtureCoverageEntry[]): FixtureGapReport {
  const seenSidePose = new Set(coverage.map((entry) => `${entry.side}|${entry.pose}|${entry.split}`));
  const seenOrientations = new Set(coverage.map((entry) => entry.orientation));
  const seenDistances = new Set(coverage.map((entry) => entry.distance));
  const missingSidePose: FixtureGapReport["missingSidePose"] = [];
  for (const side of ["left", "right"] as const) {
    for (const pose of REQUIRED_FIXTURE_POSES) {
      for (const split of REQUIRED_FIXTURE_SPLITS) {
        if (!seenSidePose.has(`${side}|${pose}|${split}`)) missingSidePose.push({ side, pose, split });
      }
    }
  }
  const missingOrientations = REQUIRED_FIXTURE_ORIENTATIONS.filter((value) => !seenOrientations.has(value));
  const missingDistances = REQUIRED_FIXTURE_DISTANCES.filter((value) => !seenDistances.has(value));
  const hasPartialOcclusion = coverage.some((entry) => entry.occlusion === "partial-fingers");
  return {
    missingSidePose,
    missingOrientations,
    missingDistances,
    hasPartialOcclusion,
    complete: missingSidePose.length === 0 && missingOrientations.length === 0 && missingDistances.length === 0 && hasPartialOcclusion,
  };
}
