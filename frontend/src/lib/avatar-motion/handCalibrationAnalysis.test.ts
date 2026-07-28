import { describe, expect, it } from "vitest";
import {
  analyzeHandCalibrationRun,
  formatHandCalibrationReportText,
  type HandCalibrationSample,
  type HandCalibrationStepId,
} from "./handCalibrationAnalysis";
import type { HandMotionDiagnosticsSnapshot, HandMotionSideDiagnostics, HandMotionStatus } from "./handMotionDiagnostics";
import type { ArmSide } from "./avatarMotionDiagnostics";
import type { Vector3Data } from "./avatarPoseTypes";

function side(overrides: Partial<HandMotionSideDiagnostics> = {}): HandMotionSideDiagnostics {
  return {
    poseSide: "left",
    handSampledThisFrame: true,
    sampleClassification: "new-sample",
    handSampledAtMs: 100,
    poseSampledAtMs: 100,
    handPoseTimestampDeltaMs: 0,
    candidatesCount: 1,
    handDetected: true,
    handMatched: false,
    candidateSourceIndex: null,
    reportedHandedness: null,
    handednessScore: null,
    wristDistance: null,
    matchingCost: null,
    matchChanged: false,
    matchingContinuity: "continued",
    ranMatching: true,
    imageBasis: null,
    worldBasis: null,
    imageGeometryQuality: 0,
    worldGeometryQuality: 0,
    imagePalmRejectionReason: null,
    worldPalmRejectionReason: null,
    matchingRejectionReason: null,
    status: "unmatched" as HandMotionStatus,
    mirrorApplied: false,
    ...overrides,
  };
}

function matchedSide(poseSide: ArmSide, sourceIndex: number, normal: Vector3Data, options: Partial<HandMotionSideDiagnostics> = {}): HandMotionSideDiagnostics {
  return side({
    poseSide,
    handMatched: true,
    candidateSourceIndex: sourceIndex,
    reportedHandedness: poseSide,
    handednessScore: 0.9,
    wristDistance: 0.02,
    imageGeometryQuality: 0.9,
    worldGeometryQuality: 0.85,
    worldBasis: { across: { x: 1, y: 0, z: 0 }, forward: { x: 0, y: 1, z: 0 }, normal },
    imageBasis: { across: { x: 1, y: 0, z: 0 }, forward: { x: 0, y: 1, z: 0 }, normal },
    status: "matched",
    ...options,
  });
}

function sample(
  atMs: number,
  left: HandMotionSideDiagnostics,
  right: HandMotionSideDiagnostics,
  perf: Partial<Pick<HandCalibrationSample, "pipelineFps" | "poseInferenceMs" | "handInferenceMs" | "totalProcessingMs">> = {},
): HandCalibrationSample {
  const handMotion: HandMotionDiagnosticsSnapshot = { left, right };
  return {
    atMs,
    handMotion,
    pipelineFps: perf.pipelineFps ?? null,
    poseInferenceMs: perf.poseInferenceMs ?? null,
    handInferenceMs: perf.handInferenceMs ?? null,
    totalProcessingMs: perf.totalProcessingMs ?? null,
  };
}

const FORWARD_NORMAL: Vector3Data = { x: 0, y: 0, z: 1 };
const BACKWARD_NORMAL: Vector3Data = { x: 0, y: 0, z: -1 };

function emptySamples(): Record<HandCalibrationStepId, HandCalibrationSample[]> {
  return {
    "right-hand-only": [], "left-hand-only": [], "right-palm-forward": [], "right-back-forward": [],
    "right-edge-on": [], "cross-hands": [], performance: [],
  };
}

const CONTEXT = { videoWidth: 1280, videoHeight: 720, profile: "full-rate" as const, nowMs: 1_700_000_000_000 };

describe("analyzeHandCalibrationRun", () => {
  it("right-hand-only: stable match onto right pose side -> PASS", () => {
    const samples = Array.from({ length: 30 }, (_, i) => sample(i * 33, side({ handDetected: false }), matchedSide("right", 0, FORWARD_NORMAL)));
    const samplesByStep = emptySamples(); samplesByStep["right-hand-only"] = samples;
    const report = analyzeHandCalibrationRun(samplesByStep, CONTEXT);
    const step = report.steps.find((s) => s.stepId === "right-hand-only")!;
    expect(step.verdict).toBe("PASS");
    expect(step.right.handMatchedRatio).toBe(1);
    expect(step.right.dominantMatchedPoseSide).toBe("right");
    expect(report.inferredConventions.rightHandMatchesRightSide).toBe(true);
  });

  it("right-hand-only: mostly unmatched -> FAIL", () => {
    const samples = Array.from({ length: 20 }, (_, i) => sample(i * 33, side(), i < 5 ? matchedSide("right", 0, FORWARD_NORMAL) : side({ handDetected: true, handMatched: false, poseSide: "right", status: "unmatched" })));
    const samplesByStep = emptySamples(); samplesByStep["right-hand-only"] = samples;
    const report = analyzeHandCalibrationRun(samplesByStep, CONTEXT);
    const step = report.steps.find((s) => s.stepId === "right-hand-only")!;
    expect(step.verdict).toBe("FAIL");
    expect(step.reasons.length).toBeGreaterThan(0);
  });

  it("left-hand-only: stable match onto left pose side -> PASS, right side stays unmatched", () => {
    const samples = Array.from({ length: 30 }, (_, i) => sample(i * 33, matchedSide("left", 0, FORWARD_NORMAL), side({ handDetected: false })));
    const samplesByStep = emptySamples(); samplesByStep["left-hand-only"] = samples;
    const report = analyzeHandCalibrationRun(samplesByStep, CONTEXT);
    const step = report.steps.find((s) => s.stepId === "left-hand-only")!;
    expect(step.verdict).toBe("PASS");
    expect(report.inferredConventions.leftHandMatchesLeftSide).toBe(true);
  });

  it("does not report jitter/flip as a reliable WARN when too few frames matched (avoids false alarm on a tiny sample)", () => {
    // Chỉ 3 frame matched (dưới ngưỡng tối thiểu) với một cú "flip" duy nhất — không đủ để kết
    // luận "dao động khi giữ yên", vì một sample hiếm hoi không phản ánh xu hướng thật.
    const tinySample = [
      sample(0, side({ handDetected: false }), matchedSide("right", 0, FORWARD_NORMAL)),
      sample(33, side({ handDetected: false }), matchedSide("right", 0, BACKWARD_NORMAL)),
      sample(66, side({ handDetected: false }), matchedSide("right", 0, FORWARD_NORMAL)),
    ];
    const samplesByStep = emptySamples(); samplesByStep["right-palm-forward"] = tinySample;
    const report = analyzeHandCalibrationRun(samplesByStep, CONTEXT);
    const step = report.steps.find((s) => s.stepId === "right-palm-forward")!;
    expect(step.right.matchedFrameCount).toBeLessThan(10);
    // Verdict vẫn WARN (báo thiếu dữ liệu) nhưng lý do phải nói rõ "chưa đủ frame", không phải
    // khẳng định palm normal thật sự dao động bất thường.
    expect(step.verdict).toBe("WARN");
    expect(step.reasons.some((r) => r.includes("chưa đủ") || r.includes("Chỉ"))).toBe(true);
    expect(step.reasons.some((r) => r.includes("dao động"))).toBe(false);
  });

  it("no frames collected in a step -> FAIL", () => {
    const samplesByStep = emptySamples();
    const report = analyzeHandCalibrationRun(samplesByStep, CONTEXT);
    for (const step of report.steps) {
      expect(step.verdict).toBe("FAIL");
      expect(step.frameCount).toBe(0);
    }
    expect(report.overallVerdict).toBe("FAIL");
  });

  it("palm-forward vs back-forward produce systematically different average world normals", () => {
    const palmSamples = Array.from({ length: 20 }, (_, i) => sample(i * 33, side({ handDetected: false }), matchedSide("right", 0, FORWARD_NORMAL)));
    const backSamples = Array.from({ length: 20 }, (_, i) => sample(i * 33, side({ handDetected: false }), matchedSide("right", 0, BACKWARD_NORMAL)));
    const samplesByStep = emptySamples();
    samplesByStep["right-palm-forward"] = palmSamples;
    samplesByStep["right-back-forward"] = backSamples;
    const report = analyzeHandCalibrationRun(samplesByStep, CONTEXT);
    const palmStep = report.steps.find((s) => s.stepId === "right-palm-forward")!;
    const backStep = report.steps.find((s) => s.stepId === "right-back-forward")!;
    expect(palmStep.right.averageWorldNormal).toEqual(FORWARD_NORMAL);
    expect(backStep.right.averageWorldNormal).toEqual(BACKWARD_NORMAL);
    expect(palmStep.verdict).toBe("PASS");
    expect(backStep.verdict).toBe("PASS");
  });

  it("normal jitter while holding still (random small variation) does not trigger abnormal flip, but large random flips do", () => {
    const jittery = Array.from({ length: 10 }, (_, i) => sample(i * 33, side({ handDetected: false }), matchedSide("right", 0, { x: 0.02 * (i % 2 === 0 ? 1 : -1), y: 0, z: 1 })));
    const samplesByStep1 = emptySamples(); samplesByStep1["right-palm-forward"] = jittery;
    const stableReport = analyzeHandCalibrationRun(samplesByStep1, CONTEXT);
    const stableStep = stableReport.steps.find((s) => s.stepId === "right-palm-forward")!;
    expect(stableStep.right.abnormalNormalFlipCount).toBe(0);

    const flipping = [
      sample(0, side({ handDetected: false }), matchedSide("right", 0, FORWARD_NORMAL)),
      sample(33, side({ handDetected: false }), matchedSide("right", 0, BACKWARD_NORMAL)),
      sample(66, side({ handDetected: false }), matchedSide("right", 0, FORWARD_NORMAL)),
    ];
    const samplesByStep2 = emptySamples(); samplesByStep2["right-palm-forward"] = flipping;
    const flippingReport = analyzeHandCalibrationRun(samplesByStep2, CONTEXT);
    const flippingStep = flippingReport.steps.find((s) => s.stepId === "right-palm-forward")!;
    expect(flippingStep.right.abnormalNormalFlipCount).toBeGreaterThan(0);
    expect(flippingStep.verdict).toBe("WARN");
  });

  it("edge-on with degraded quality data is not penalized, but suspiciously high quality is flagged", () => {
    const trulyEdgeOn = Array.from({ length: 20 }, (_, i) => sample(i * 33, side({ handDetected: false }), matchedSide("right", 0, FORWARD_NORMAL, { worldGeometryQuality: 0.1, imageGeometryQuality: 0.1 })));
    const samplesByStep1 = emptySamples(); samplesByStep1["right-edge-on"] = trulyEdgeOn;
    const goodReport = analyzeHandCalibrationRun(samplesByStep1, CONTEXT);
    expect(goodReport.steps.find((s) => s.stepId === "right-edge-on")!.verdict).toBe("PASS");

    const suspiciouslyHighQuality = Array.from({ length: 20 }, (_, i) => sample(i * 33, side({ handDetected: false }), matchedSide("right", 0, FORWARD_NORMAL, { worldGeometryQuality: 0.95, imageGeometryQuality: 0.95 })));
    const samplesByStep2 = emptySamples(); samplesByStep2["right-edge-on"] = suspiciouslyHighQuality;
    const warnReport = analyzeHandCalibrationRun(samplesByStep2, CONTEXT);
    expect(warnReport.steps.find((s) => s.stepId === "right-edge-on")!.verdict).toBe("WARN");
  });

  it("cross-hands: left/right assignment swap detected -> FAIL", () => {
    const before = sample(0, matchedSide("left", 0, FORWARD_NORMAL), matchedSide("right", 1, FORWARD_NORMAL));
    // Candidate sourceIndex 0 (trước đó là left) giờ được gán cho right, và ngược lại -> swap thật.
    const swapped = sample(33, matchedSide("left", 1, FORWARD_NORMAL), matchedSide("right", 0, FORWARD_NORMAL));
    const samplesByStep = emptySamples(); samplesByStep["cross-hands"] = [before, swapped];
    const report = analyzeHandCalibrationRun(samplesByStep, CONTEXT);
    const step = report.steps.find((s) => s.stepId === "cross-hands")!;
    expect(step.leftRightSwapCount).toBe(1);
    expect(step.verdict).toBe("FAIL");
  });

  it("cross-hands: no swap when both hands keep their assigned side -> PASS", () => {
    const samples = Array.from({ length: 10 }, (_, i) => sample(i * 33, matchedSide("left", 0, FORWARD_NORMAL), matchedSide("right", 1, FORWARD_NORMAL)));
    const samplesByStep = emptySamples(); samplesByStep["cross-hands"] = samples;
    const report = analyzeHandCalibrationRun(samplesByStep, CONTEXT);
    const step = report.steps.find((s) => s.stepId === "cross-hands")!;
    expect(step.leftRightSwapCount).toBe(0);
    expect(step.verdict).toBe("PASS");
  });

  it("performance: pipelineFps below 24 -> FAIL", () => {
    const samples = Array.from({ length: 20 }, (_, i) => sample(i * 33, side({ handDetected: false }), matchedSide("right", 0, FORWARD_NORMAL), { pipelineFps: 18, poseInferenceMs: 10, handInferenceMs: 8, totalProcessingMs: 20 }));
    const samplesByStep = emptySamples(); samplesByStep.performance = samples;
    const report = analyzeHandCalibrationRun(samplesByStep, CONTEXT);
    const step = report.steps.find((s) => s.stepId === "performance")!;
    expect(step.verdict).toBe("FAIL");
    expect(step.performance?.pipelineFpsMedian).toBe(18);
  });

  it("performance: total processing p95 over 100ms budget -> FAIL", () => {
    const samples = Array.from({ length: 20 }, (_, i) => sample(i * 33, side({ handDetected: false }), matchedSide("right", 0, FORWARD_NORMAL), { pipelineFps: 30, poseInferenceMs: 10, handInferenceMs: 8, totalProcessingMs: 150 }));
    const samplesByStep = emptySamples(); samplesByStep.performance = samples;
    const report = analyzeHandCalibrationRun(samplesByStep, CONTEXT);
    const step = report.steps.find((s) => s.stepId === "performance")!;
    expect(step.verdict).toBe("FAIL");
  });

  it("performance: healthy numbers -> PASS", () => {
    const samples = Array.from({ length: 20 }, (_, i) => sample(i * 33, side({ handDetected: false }), matchedSide("right", 0, FORWARD_NORMAL), { pipelineFps: 30, poseInferenceMs: 10, handInferenceMs: 8, totalProcessingMs: 25 }));
    const samplesByStep = emptySamples(); samplesByStep.performance = samples;
    const report = analyzeHandCalibrationRun(samplesByStep, CONTEXT);
    const step = report.steps.find((s) => s.stepId === "performance")!;
    expect(step.verdict).toBe("PASS");
  });

  it("overall verdict is the worst verdict across all steps", () => {
    const samplesByStep = emptySamples();
    samplesByStep["right-hand-only"] = Array.from({ length: 10 }, (_, i) => sample(i * 33, side({ handDetected: false }), matchedSide("right", 0, FORWARD_NORMAL)));
    samplesByStep["left-hand-only"] = []; // FAIL: no frames.
    const report = analyzeHandCalibrationRun(samplesByStep, CONTEXT);
    expect(report.overallVerdict).toBe("FAIL");
  });

  it("raw sample excerpt is capped and does not dump thousands of frames", () => {
    const samplesByStep = emptySamples();
    samplesByStep.performance = Array.from({ length: 5000 }, (_, i) => sample(i, side({ handDetected: false }), matchedSide("right", 0, FORWARD_NORMAL), { pipelineFps: 30, totalProcessingMs: 20 }));
    const report = analyzeHandCalibrationRun(samplesByStep, CONTEXT);
    expect(report.rawSampleExcerpt.length).toBeLessThanOrEqual(40);
    expect(report.rawSampleExcerpt.length).toBeGreaterThan(0);
  });

  it("report JSON contains video dimensions, profile, per-step results and verdicts", () => {
    const samplesByStep = emptySamples();
    samplesByStep["right-hand-only"] = [sample(0, side({ handDetected: false }), matchedSide("right", 0, FORWARD_NORMAL))];
    const report = analyzeHandCalibrationRun(samplesByStep, CONTEXT);
    const json = JSON.parse(JSON.stringify(report));
    expect(json.videoWidth).toBe(1280);
    expect(json.videoHeight).toBe(720);
    expect(json.profile).toBe("full-rate");
    expect(Array.isArray(json.steps)).toBe(true);
    expect(json.steps.length).toBe(7);
    expect(typeof json.overallVerdict).toBe("string");
  });

  it("formatHandCalibrationReportText produces a short human-readable summary, not per-frame logs", () => {
    const samplesByStep = emptySamples();
    samplesByStep["right-hand-only"] = Array.from({ length: 5 }, (_, i) => sample(i, side({ handDetected: false }), matchedSide("right", 0, FORWARD_NORMAL)));
    const report = analyzeHandCalibrationRun(samplesByStep, CONTEXT);
    const text = formatHandCalibrationReportText(report);
    expect(text).toContain("Overall:");
    expect(text.split("\n").length).toBeLessThan(60);
  });

  it("does not include quaternion, pole or jointRotations fields anywhere in the report", () => {
    const samplesByStep = emptySamples();
    samplesByStep["right-hand-only"] = [sample(0, side({ handDetected: false }), matchedSide("right", 0, FORWARD_NORMAL))];
    const report = analyzeHandCalibrationRun(samplesByStep, CONTEXT);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toMatch(/jointRotations|"pole"|quaternion/i);
  });
});
