import type { ArmSide } from "./avatarMotionDiagnostics";
import type { HandMotionDiagnosticsSnapshot, HandMotionSideDiagnostics } from "./handMotionDiagnostics";
import type { Vector3Data } from "./avatarPoseTypes";

/**
 * Mức 2B-1 — Hand Calibration Test: module THUẦN cho việc thu thập nhiều frame
 * `HandMotionDiagnosticsSnapshot` theo từng bước hướng dẫn (giơ tay phải, tay trái, lòng bàn
 * tay, mu bàn tay, edge-on, bắt chéo, đo hiệu năng) rồi tổng hợp thành số liệu + PASS/WARN/FAIL.
 *
 * Đây CHỈ là công cụ validation cho dev harness — không tạo quaternion, không đọc/sửa
 * `jointRotations`, không điều khiển VRM, không khởi động thuật toán twist nào (AGENTS.md
 * Mức 2A/2B). Input là diagnostic đã có sẵn từ `AvatarMotionProcessor`; hàm ở đây chỉ đọc lại.
 */

export type HandCalibrationStepId =
  | "right-hand-only"
  | "left-hand-only"
  | "right-palm-forward"
  | "right-back-forward"
  | "right-edge-on"
  | "cross-hands"
  | "performance";

export interface HandCalibrationStepDefinition {
  id: HandCalibrationStepId;
  title: string;
  instruction: string;
  durationMs: number;
}

export const HAND_CALIBRATION_STEPS: HandCalibrationStepDefinition[] = [
  { id: "right-hand-only", title: "Bước 1 — Chỉ tay phải", instruction: "Chỉ giơ tay phải lên, giữ yên.", durationMs: 3000 },
  { id: "left-hand-only", title: "Bước 2 — Chỉ tay trái", instruction: "Chỉ giơ tay trái lên, giữ yên.", durationMs: 3000 },
  { id: "right-palm-forward", title: "Bước 3 — Lòng bàn tay phải hướng camera", instruction: "Giơ tay phải, xoay lòng bàn tay hướng thẳng vào camera.", durationMs: 3000 },
  { id: "right-back-forward", title: "Bước 4 — Mu bàn tay phải hướng camera", instruction: "Giơ tay phải, xoay mu bàn tay hướng thẳng vào camera.", durationMs: 3000 },
  { id: "right-edge-on", title: "Bước 5 — Tay phải nhìn cạnh", instruction: "Giơ tay phải, xoay cạnh bàn tay hướng camera (như chém tay).", durationMs: 3000 },
  { id: "cross-hands", title: "Bước 6 — Bắt chéo hai tay", instruction: "Giơ cả hai tay và bắt chéo qua lại CHẬM RÃI.", durationMs: 6000 },
  { id: "performance", title: "Bước 7 — Đo hiệu năng", instruction: "Giữ tự nhiên, di chuyển tay nhẹ nhàng để đo hiệu năng pipeline.", durationMs: 12000 },
];

/** Một mẫu thô thu trong lúc chạy bước — đủ để tổng hợp lại, KHÔNG giữ toàn bộ raw frame gốc. */
export interface HandCalibrationSample {
  atMs: number;
  handMotion: HandMotionDiagnosticsSnapshot;
  pipelineFps: number | null;
  poseInferenceMs: number | null;
  handInferenceMs: number | null;
  totalProcessingMs: number | null;
}

export type CalibrationVerdict = "PASS" | "WARN" | "FAIL";

export interface SideSampleSummary {
  frameCount: number;
  /** Số frame side này thực sự match được — dùng làm cỡ mẫu cho các số liệu chỉ có ý nghĩa khi matched (wristDistance, geometry quality, world normal jitter/flip). */
  matchedFrameCount: number;
  handDetectedRatio: number;
  handMatchedRatio: number;
  dominantReportedHandedness: "left" | "right" | "unknown" | null;
  dominantMatchedPoseSide: ArmSide | null;
  handednessConsistency: number;
  wristDistanceMedian: number | null;
  wristDistanceP95: number | null;
  handPoseTimestampDeltaMedianMs: number | null;
  handPoseTimestampDeltaP95Ms: number | null;
  imageGeometryQualityMedian: number | null;
  imageGeometryQualityP10: number | null;
  worldGeometryQualityMedian: number | null;
  worldGeometryQualityP10: number | null;
  averageWorldNormal: Vector3Data | null;
  worldNormalJitterDeg: number | null;
  abnormalNormalFlipCount: number;
  matchChangedCount: number;
}

export interface StepAnalysisResult {
  stepId: HandCalibrationStepId;
  frameCount: number;
  left: SideSampleSummary;
  right: SideSampleSummary;
  /** Số lần left/right assignment hoán đổi cho nhau giữa hai frame liên tiếp trong bước này. */
  leftRightSwapCount: number;
  performance: {
    pipelineFpsMedian: number | null;
    pipelineFpsP10: number | null;
    poseInferenceP95: number | null;
    handInferenceP95: number | null;
    totalProcessingP95: number | null;
  } | null;
  verdict: CalibrationVerdict;
  reasons: string[];
}

export interface HandCalibrationReport {
  generatedAtMs: number;
  videoWidth: number | null;
  videoHeight: number | null;
  profile: "full-rate" | "staggered";
  steps: StepAnalysisResult[];
  overallVerdict: CalibrationVerdict;
  inferredConventions: {
    /** true nếu bước 1 (chỉ tay phải) match ổn định vào Pose side "right". */
    rightHandMatchesRightSide: boolean | null;
    /** true nếu bước 2 (chỉ tay trái) match ổn định vào Pose side "left". */
    leftHandMatchesLeftSide: boolean | null;
  };
  /** Mẫu thô GIỚI HẠN số lượng để tham khảo, không xuất toàn bộ frame đã thu (yêu cầu #9). */
  rawSampleExcerpt: HandCalibrationSample[];
}

const MAX_RAW_SAMPLE_EXCERPT = 40;
/** Ngưỡng góc lệch normal giữa hai frame liên tiếp để coi là "flip bất thường" khi người dùng đang giữ yên (không phải xoay chủ ý). */
const ABNORMAL_NORMAL_FLIP_DEG = 90;
/**
 * Số frame match được tối thiểu trước khi coi worldNormalJitterDeg/abnormalNormalFlipCount là
 * đủ tin cậy để cảnh báo. Với 2-4 frame matched, một cú jitter/flip đơn lẻ (do góc tay chuyển
 * động tự nhiên lúc bắt đầu/kết thúc giữ pose, hoặc noise của candidate hiếm hoi) sẽ thổi phồng
 * trung bình lên rất cao — không phản ánh việc "giữ yên nhưng vẫn dao động" như tên gọi mô tả.
 */
const MIN_MATCHED_FRAMES_FOR_JITTER_CHECK = 10;

function percentile(sortedValues: number[], p: number): number | null {
  if (sortedValues.length === 0) return null;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * p) - 1));
  return sortedValues[index];
}
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return percentile(sorted, 0.5);
}
function sortedOf(values: number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

function vectorLength(v: Vector3Data): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}
function normalize(v: Vector3Data): Vector3Data | null {
  const length = vectorLength(v);
  if (!Number.isFinite(length) || length < 1e-8) return null;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}
function dot(a: Vector3Data, b: Vector3Data): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}
function angleBetweenDeg(a: Vector3Data, b: Vector3Data): number | null {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na || !nb) return null;
  const clamped = Math.max(-1, Math.min(1, dot(na, nb)));
  return (Math.acos(clamped) * 180) / Math.PI;
}

function mostFrequent<T extends string>(values: T[]): T | null {
  if (values.length === 0) return null;
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: T | null = null;
  let bestCount = -1;
  for (const [value, count] of counts) if (count > bestCount) { best = value; bestCount = count; }
  return best;
}

/**
 * Tổng hợp số liệu cho MỘT side trong MỘT bước. Chỉ đọc lại field có sẵn trong
 * `HandMotionSideDiagnostics` — không tính lại matching/palm basis.
 */
function summarizeSide(sides: HandMotionSideDiagnostics[]): SideSampleSummary {
  const frameCount = sides.length;
  const handDetectedCount = sides.filter((s) => s.handDetected).length;
  const handMatchedCount = sides.filter((s) => s.handMatched).length;
  const reportedHandednessValues = sides.map((s) => s.reportedHandedness).filter((v): v is "left" | "right" | "unknown" => v !== null);
  const dominantReportedHandedness = mostFrequent(reportedHandednessValues);
  const matchedPoseSideValues = sides.filter((s) => s.handMatched).map((s) => s.poseSide);
  const dominantMatchedPoseSide = mostFrequent(matchedPoseSideValues);
  const handednessConsistency = reportedHandednessValues.length === 0
    ? 0
    : reportedHandednessValues.filter((v) => v === dominantReportedHandedness).length / reportedHandednessValues.length;

  const wristDistances = sortedOf(sides.map((s) => s.wristDistance).filter((v): v is number => v !== null));
  const timestampDeltas = sortedOf(sides.map((s) => s.handPoseTimestampDeltaMs).filter((v): v is number => v !== null));
  const matchedSides = sides.filter((s) => s.handMatched);
  const imageQualities = sortedOf(matchedSides.map((s) => s.imageGeometryQuality));
  const worldQualities = sortedOf(matchedSides.map((s) => s.worldGeometryQuality));

  const worldNormals = matchedSides.map((s) => s.worldBasis?.normal).filter((v): v is Vector3Data => v !== null && v !== undefined);
  let averageWorldNormal: Vector3Data | null = null;
  if (worldNormals.length > 0) {
    const sum = worldNormals.reduce((acc, v) => ({ x: acc.x + v.x, y: acc.y + v.y, z: acc.z + v.z }), { x: 0, y: 0, z: 0 });
    averageWorldNormal = normalize({ x: sum.x / worldNormals.length, y: sum.y / worldNormals.length, z: sum.z / worldNormals.length });
  }

  let jitterSumDeg = 0;
  let jitterSamples = 0;
  let abnormalFlipCount = 0;
  for (let i = 1; i < worldNormals.length; i += 1) {
    const angle = angleBetweenDeg(worldNormals[i - 1], worldNormals[i]);
    if (angle === null) continue;
    jitterSumDeg += angle;
    jitterSamples += 1;
    if (angle >= ABNORMAL_NORMAL_FLIP_DEG) abnormalFlipCount += 1;
  }
  const worldNormalJitterDeg = jitterSamples > 0 ? jitterSumDeg / jitterSamples : null;

  const matchChangedCount = sides.filter((s) => s.matchChanged).length;

  return {
    frameCount,
    matchedFrameCount: handMatchedCount,
    handDetectedRatio: frameCount === 0 ? 0 : handDetectedCount / frameCount,
    handMatchedRatio: frameCount === 0 ? 0 : handMatchedCount / frameCount,
    dominantReportedHandedness,
    dominantMatchedPoseSide,
    handednessConsistency,
    wristDistanceMedian: median(wristDistances),
    wristDistanceP95: percentile(wristDistances, 0.95),
    handPoseTimestampDeltaMedianMs: median(timestampDeltas),
    handPoseTimestampDeltaP95Ms: percentile(timestampDeltas, 0.95),
    imageGeometryQualityMedian: median(imageQualities),
    imageGeometryQualityP10: percentile(imageQualities, 0.10),
    worldGeometryQualityMedian: median(worldQualities),
    worldGeometryQualityP10: percentile(worldQualities, 0.10),
    averageWorldNormal,
    worldNormalJitterDeg,
    abnormalNormalFlipCount: abnormalFlipCount,
    matchChangedCount,
  };
}

function countLeftRightSwaps(samples: HandCalibrationSample[]): number {
  let swaps = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const previous = samples[i - 1].handMotion;
    const current = samples[i].handMotion;
    const previousLeftSource = previous.left.handMatched ? previous.left.candidateSourceIndex : null;
    const previousRightSource = previous.right.handMatched ? previous.right.candidateSourceIndex : null;
    const currentLeftSource = current.left.handMatched ? current.left.candidateSourceIndex : null;
    const currentRightSource = current.right.handMatched ? current.right.candidateSourceIndex : null;
    // "Swap" thật sự: candidate mà left đang giữ chuyển sang được right giữ (và ngược lại) —
    // không phải chỉ đơn thuần sourceIndex đổi (đã có continuity ở Việc 1 xử lý việc đó).
    if (
      previousLeftSource !== null && previousRightSource !== null &&
      currentLeftSource === previousRightSource && currentRightSource === previousLeftSource
    ) swaps += 1;
  }
  return swaps;
}

function evaluateStep(stepId: HandCalibrationStepId, samples: HandCalibrationSample[]): StepAnalysisResult {
  const leftSummary = summarizeSide(samples.map((s) => s.handMotion.left));
  const rightSummary = summarizeSide(samples.map((s) => s.handMotion.right));
  const leftRightSwapCount = countLeftRightSwaps(samples);

  const performance = stepId === "performance" ? (() => {
    const fps = sortedOf(samples.map((s) => s.pipelineFps).filter((v): v is number => v !== null));
    const poseInference = sortedOf(samples.map((s) => s.poseInferenceMs).filter((v): v is number => v !== null));
    const handInference = sortedOf(samples.map((s) => s.handInferenceMs).filter((v): v is number => v !== null));
    const total = sortedOf(samples.map((s) => s.totalProcessingMs).filter((v): v is number => v !== null));
    return {
      pipelineFpsMedian: median(fps),
      pipelineFpsP10: percentile(fps, 0.10),
      poseInferenceP95: percentile(poseInference, 0.95),
      handInferenceP95: percentile(handInference, 0.95),
      totalProcessingP95: percentile(total, 0.95),
    };
  })() : null;

  const reasons: string[] = [];
  let verdict: CalibrationVerdict = "PASS";
  const downgrade = (next: CalibrationVerdict, reason: string) => {
    reasons.push(reason);
    if (next === "FAIL" || verdict === "PASS") verdict = next;
  };

  if (samples.length === 0) {
    downgrade("FAIL", "Không thu được frame nào trong bước này.");
    return { stepId, frameCount: 0, left: leftSummary, right: rightSummary, leftRightSwapCount, performance, verdict, reasons };
  }

  switch (stepId) {
    case "right-hand-only": {
      if (rightSummary.handMatchedRatio < 0.5) downgrade("FAIL", `Tay phải chỉ match ${(rightSummary.handMatchedRatio * 100).toFixed(0)}% frame.`);
      else if (rightSummary.handMatchedRatio < 0.85) downgrade("WARN", `Tay phải match ${(rightSummary.handMatchedRatio * 100).toFixed(0)}% frame, chưa thật ổn định.`);
      if (rightSummary.dominantMatchedPoseSide !== "right") downgrade("FAIL", `Tay phải match vào Pose side "${rightSummary.dominantMatchedPoseSide ?? "none"}" thay vì "right".`);
      if (rightSummary.matchChangedCount > Math.ceil(rightSummary.frameCount * 0.2)) downgrade("WARN", "Side assignment đổi quá nhiều lần khi giữ yên một tay.");
      if (leftSummary.handMatchedRatio > 0.3) downgrade("WARN", "Có candidate bị match nhầm vào side trái dù chỉ giơ tay phải.");
      break;
    }
    case "left-hand-only": {
      if (leftSummary.handMatchedRatio < 0.5) downgrade("FAIL", `Tay trái chỉ match ${(leftSummary.handMatchedRatio * 100).toFixed(0)}% frame.`);
      else if (leftSummary.handMatchedRatio < 0.85) downgrade("WARN", `Tay trái match ${(leftSummary.handMatchedRatio * 100).toFixed(0)}% frame, chưa thật ổn định.`);
      if (leftSummary.dominantMatchedPoseSide !== "left") downgrade("FAIL", `Tay trái match vào Pose side "${leftSummary.dominantMatchedPoseSide ?? "none"}" thay vì "left".`);
      if (leftSummary.matchChangedCount > Math.ceil(leftSummary.frameCount * 0.2)) downgrade("WARN", "Side assignment đổi quá nhiều lần khi giữ yên một tay.");
      if (rightSummary.handMatchedRatio > 0.3) downgrade("WARN", "Có candidate bị match nhầm vào side phải dù chỉ giơ tay trái.");
      break;
    }
    case "right-palm-forward":
    case "right-back-forward": {
      if (rightSummary.handMatchedRatio < 0.5) downgrade("FAIL", "Tay phải không match đủ ổn định để đánh giá palm orientation.");
      // Jitter/flip chỉ đáng tin khi có đủ frame matched liên tiếp — vài frame lẻ tẻ (do detector
      // miss xen kẽ) làm trung bình bị thổi phồng, không phản ánh "giữ yên vẫn dao động" thật.
      if (rightSummary.matchedFrameCount < MIN_MATCHED_FRAMES_FOR_JITTER_CHECK) {
        downgrade("WARN", `Chỉ ${rightSummary.matchedFrameCount} frame matched — chưa đủ để đánh giá độ ổn định palm normal (cần >= ${MIN_MATCHED_FRAMES_FOR_JITTER_CHECK}).`);
      } else {
        if (rightSummary.worldNormalJitterDeg !== null && rightSummary.worldNormalJitterDeg > 30) downgrade("WARN", `World normal dao động ${rightSummary.worldNormalJitterDeg.toFixed(1)}° trung bình giữa các frame liên tiếp khi giữ yên.`);
        if (rightSummary.abnormalNormalFlipCount > 0) downgrade("WARN", `Phát hiện ${rightSummary.abnormalNormalFlipCount} lần world normal đổi hướng đột ngột (>=${ABNORMAL_NORMAL_FLIP_DEG}°) khi giữ yên.`);
      }
      break;
    }
    case "right-edge-on": {
      if (rightSummary.handMatchedRatio < 0.5) downgrade("WARN", "Tay phải không match đủ để đánh giá vùng edge-on.");
      // Edge-on kỳ vọng chất lượng geometry THẤP HƠN các bước palm/back — chỉ cảnh báo (không fail)
      // nếu quality vẫn cao bất thường, vì có thể do webcam chưa thực sự ở góc edge-on.
      if (rightSummary.worldGeometryQualityMedian !== null && rightSummary.worldGeometryQualityMedian > 0.8) {
        downgrade("WARN", "worldGeometryQuality vẫn cao dù đang test edge-on — kiểm tra lại góc tay có thực sự edge-on chưa.");
      }
      break;
    }
    case "cross-hands": {
      if (leftRightSwapCount > 0) downgrade("FAIL", `Phát hiện ${leftRightSwapCount} lần left/right assignment bị hoán đổi khi bắt chéo tay.`);
      if (leftSummary.matchChangedCount + rightSummary.matchChangedCount > samples.length) downgrade("WARN", "matchChanged xảy ra rất thường xuyên trong lúc bắt chéo tay — có thể continuity chưa đủ ổn định.");
      break;
    }
    case "performance": {
      if (performance) {
        if (performance.pipelineFpsMedian !== null && performance.pipelineFpsMedian < 24) downgrade("FAIL", `pipelineFps median ${performance.pipelineFpsMedian.toFixed(1)} < 24.`);
        else if (performance.pipelineFpsP10 !== null && performance.pipelineFpsP10 < 24) downgrade("WARN", `pipelineFps p10 ${performance.pipelineFpsP10.toFixed(1)} < 24 dù median đạt.`);
        if (performance.totalProcessingP95 !== null && performance.totalProcessingP95 > 100) downgrade("FAIL", `Total processing p95 ${performance.totalProcessingP95.toFixed(1)}ms > 100ms.`);
      }
      break;
    }
  }

  return { stepId, frameCount: samples.length, left: leftSummary, right: rightSummary, leftRightSwapCount, performance, verdict, reasons };
}

function combineVerdicts(verdicts: CalibrationVerdict[]): CalibrationVerdict {
  if (verdicts.includes("FAIL")) return "FAIL";
  if (verdicts.includes("WARN")) return "WARN";
  return "PASS";
}

export function analyzeHandCalibrationRun(
  samplesByStep: Record<HandCalibrationStepId, HandCalibrationSample[]>,
  context: { videoWidth: number | null; videoHeight: number | null; profile: "full-rate" | "staggered"; nowMs: number },
): HandCalibrationReport {
  const steps = HAND_CALIBRATION_STEPS.map((definition) => evaluateStep(definition.id, samplesByStep[definition.id] ?? []));
  const overallVerdict = combineVerdicts(steps.map((s) => s.verdict));

  const rightHandStep = steps.find((s) => s.stepId === "right-hand-only") ?? null;
  const leftHandStep = steps.find((s) => s.stepId === "left-hand-only") ?? null;

  const allSamples = HAND_CALIBRATION_STEPS.flatMap((definition) => samplesByStep[definition.id] ?? []);
  const rawSampleExcerpt = allSamples.length <= MAX_RAW_SAMPLE_EXCERPT
    ? allSamples
    : allSamples.filter((_, index) => index % Math.ceil(allSamples.length / MAX_RAW_SAMPLE_EXCERPT) === 0).slice(0, MAX_RAW_SAMPLE_EXCERPT);

  return {
    generatedAtMs: context.nowMs,
    videoWidth: context.videoWidth,
    videoHeight: context.videoHeight,
    profile: context.profile,
    steps,
    overallVerdict,
    inferredConventions: {
      rightHandMatchesRightSide: rightHandStep ? rightHandStep.right.dominantMatchedPoseSide === "right" && rightHandStep.right.handMatchedRatio >= 0.5 : null,
      leftHandMatchesLeftSide: leftHandStep ? leftHandStep.left.dominantMatchedPoseSide === "left" && leftHandStep.left.handMatchedRatio >= 0.5 : null,
    },
    rawSampleExcerpt,
  };
}

export function formatHandCalibrationReportText(report: HandCalibrationReport): string {
  const lines: string[] = [];
  lines.push(`Hand Calibration Report — ${new Date(report.generatedAtMs).toISOString()}`);
  lines.push(`Video: ${report.videoWidth ?? "?"}x${report.videoHeight ?? "?"} · profile: ${report.profile}`);
  lines.push(`Overall: ${report.overallVerdict}`);
  lines.push("");
  for (const step of report.steps) {
    const definition = HAND_CALIBRATION_STEPS.find((d) => d.id === step.stepId);
    lines.push(`[${step.verdict}] ${definition?.title ?? step.stepId} — ${step.frameCount} frames`);
    for (const reason of step.reasons) lines.push(`    - ${reason}`);
  }
  return lines.join("\n");
}
