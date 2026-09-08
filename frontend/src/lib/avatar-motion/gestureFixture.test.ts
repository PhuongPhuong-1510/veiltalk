import { describe, expect, it } from "vitest";
import type { RawHandCandidateV1, RawTrackingFrameV1 } from "../tracking/rawTrackingTypes";
import {
  GestureFixtureCollector,
  HAND_LANDMARK_COUNT,
  reportFixtureGaps,
  selectFixtureCandidate,
  REQUIRED_FIXTURE_POSES,
  type GestureFixtureCondition,
} from "./gestureFixture";

const landmarks = (count = HAND_LANDMARK_COUNT) =>
  Array.from({ length: count }, (_, index) => ({ x: index * .01, y: index * .02, z: index * .03, visibility: 1 }));
const worldLandmarks = (count = HAND_LANDMARK_COUNT) =>
  Array.from({ length: count }, (_, index) => ({ x: index * .1, y: index * .2, z: index * .3, visibility: null }));

const candidate = (overrides: Partial<RawHandCandidateV1> = {}): RawHandCandidateV1 => ({
  sourceIndex: 0,
  sampledAtMs: 100,
  handedness: "left",
  handednessScore: .9,
  landmarks: landmarks(),
  worldLandmarks: worldLandmarks(),
  ...overrides,
});

const frame = (overrides: Partial<RawTrackingFrameV1> = {}): RawTrackingFrameV1 => ({
  version: 1,
  frameTimestampMs: 100,
  overall: "tracked",
  face: { state: "lost", sampledAtMs: null, landmarks: null, blendshapes: null, facialTransform: null },
  leftHand: { state: "lost", sampledAtMs: null, landmarks: null, worldLandmarks: null, handednessScore: null },
  rightHand: { state: "lost", sampledAtMs: null, landmarks: null, worldLandmarks: null, handednessScore: null },
  rawHands: [candidate()],
  handSampledThisFrame: true,
  handSampledAtMs: 100,
  pose: { state: "lost", sampledAtMs: null, landmarks: null, worldLandmarks: null },
  videoWidth: 1280,
  videoHeight: 720,
  ...overrides,
} as RawTrackingFrameV1);

const condition = (overrides: Partial<GestureFixtureCondition> = {}): GestureFixtureCondition => ({
  side: "left",
  pose: "open",
  orientation: "palm-to-camera",
  distance: "normal",
  occlusion: "none",
  split: "calibration",
  ...overrides,
});

describe("gestureFixture — Phase 3B.3 Việc 0", () => {
  it("captures a sample with landmarks and source video size", () => {
    const collector = new GestureFixtureCollector();
    const result = collector.capture(frame(), condition(), 500);
    expect(result.rejectionReason).toBeNull();
    expect(result.sample?.landmarks).toHaveLength(HAND_LANDMARK_COUNT);
    expect(result.sample?.worldLandmarks).toHaveLength(HAND_LANDMARK_COUNT);
    expect(result.sample?.videoSize).toEqual({ width: 1280, height: 720 });
    expect(collector.getSampleCount()).toBe(1);
  });

  it("rejects the same detector sample even when captured under another split", () => {
    const collector = new GestureFixtureCollector();
    expect(collector.capture(frame(), condition(), 500).rejectionReason).toBeNull();
    expect(collector.capture(frame(), condition({ split: "holdout" }), 540).rejectionReason).toBe("duplicate-sample");
    expect(collector.getSampleCount()).toBe(1);
  });

  // Frame duplicate mang lại đúng landmark cũ. Nếu nhận, phân bố feature sẽ lệch về phía tư thế
  // người dùng giữ lâu — đúng loại thiên lệch làm hỏng việc chọn ngưỡng sau này.
  it("rejects frames where the hand detector did not actually run", () => {
    const collector = new GestureFixtureCollector();
    const result = collector.capture(frame({ handSampledThisFrame: false }), condition(), 500);
    expect(result.rejectionReason).toBe("no-hand-sample");
    expect(collector.getSampleCount()).toBe(0);
  });

  it("rejects when no candidate matches the side being captured", () => {
    const collector = new GestureFixtureCollector();
    const result = collector.capture(frame(), condition({ side: "right" }), 500);
    expect(result.rejectionReason).toBe("no-candidate-for-side");
    expect(collector.getSampleCount()).toBe(0);
  });

  it("rejects incomplete landmark sets instead of storing a malformed sample", () => {
    const collector = new GestureFixtureCollector();
    const truncated = frame({ rawHands: [candidate({ landmarks: landmarks(12) })] });
    expect(collector.capture(truncated, condition(), 500).rejectionReason).toBe("incomplete-landmarks");
    expect(collector.getSampleCount()).toBe(0);
  });

  it("picks the highest-scoring candidate when several share a handedness label", () => {
    const chosen = candidate({ sourceIndex: 1, handednessScore: .95 });
    const selected = selectFixtureCandidate(
      frame({ rawHands: [candidate({ sourceIndex: 0, handednessScore: .4 }), chosen] }),
      "left",
    );
    expect(selected?.sourceIndex).toBe(1);
  });

  it("stores an immutable copy of the capture condition", () => {
    const collector = new GestureFixtureCollector();
    const shared = condition();
    collector.capture(frame(), shared, 500);
    shared.pose = "fist";
    expect(collector.getSamples()[0].condition.pose).toBe("open");
  });

  it("counts coverage per condition combination", () => {
    const collector = new GestureFixtureCollector();
    collector.capture(frame({ handSampledAtMs: 100, rawHands: [candidate({ sampledAtMs: 100 })] }), condition(), 500);
    collector.capture(frame({ handSampledAtMs: 200, rawHands: [candidate({ sampledAtMs: 200 })] }), condition(), 540);
    collector.capture(frame({ handSampledAtMs: 300, rawHands: [candidate({ sampledAtMs: 300 })] }), condition({ pose: "fist" }), 580);
    const coverage = collector.getCoverage();
    expect(coverage).toHaveLength(2);
    expect(coverage.find((entry) => entry.pose === "open")?.count).toBe(2);
    expect(coverage.find((entry) => entry.pose === "fist")?.count).toBe(1);
  });

  it("undoes the most recent sample and reuses its index", () => {
    const collector = new GestureFixtureCollector();
    collector.capture(frame({ handSampledAtMs: 100, rawHands: [candidate({ sampledAtMs: 100 })] }), condition(), 500);
    collector.capture(frame({ handSampledAtMs: 200, rawHands: [candidate({ sampledAtMs: 200 })] }), condition({ pose: "fist" }), 540);
    expect(collector.undoLast()).toBe(true);
    expect(collector.getSampleCount()).toBe(1);
    collector.capture(frame({ handSampledAtMs: 300, rawHands: [candidate({ sampledAtMs: 300 })] }), condition({ pose: "point" }), 580);
    expect(collector.getSamples().map((sample) => sample.index)).toEqual([0, 1]);
  });

  it("reports an empty collector as incomplete", () => {
    const gaps = reportFixtureGaps([]);
    expect(gaps.complete).toBe(false);
    expect(gaps.missingSidePose).toHaveLength(REQUIRED_FIXTURE_POSES.length * 2 * 2);
    expect(gaps.hasPartialOcclusion).toBe(false);
  });

  it("reports remaining gaps until every required condition has been seen", () => {
    const collector = new GestureFixtureCollector();
    for (const side of ["left", "right"] as const) {
      for (const pose of REQUIRED_FIXTURE_POSES) {
        collector.capture(frame({ handSampledAtMs: 100 + REQUIRED_FIXTURE_POSES.indexOf(pose), rawHands: [candidate({ handedness: side, sampledAtMs: 100 + REQUIRED_FIXTURE_POSES.indexOf(pose) })] }), condition({ side, pose, split: "calibration" }), 500);
        collector.capture(frame({ handSampledAtMs: 200 + REQUIRED_FIXTURE_POSES.indexOf(pose), rawHands: [candidate({ handedness: side, sampledAtMs: 200 + REQUIRED_FIXTURE_POSES.indexOf(pose) })] }), condition({ side, pose, split: "holdout" }), 500);
      }
    }
    const afterPoses = reportFixtureGaps(collector.getCoverage());
    expect(afterPoses.missingSidePose).toHaveLength(0);
    // Mới thu ở palm-to-camera / normal / không che → vẫn còn thiếu.
    expect(afterPoses.missingOrientations).toEqual(["back-to-camera", "edge-on"]);
    expect(afterPoses.missingDistances).toEqual(["near", "far"]);
    expect(afterPoses.complete).toBe(false);

    collector.capture(frame({ handSampledAtMs: 1000, rawHands: [candidate({ sampledAtMs: 1000 })] }), condition({ orientation: "back-to-camera" }), 600);
    collector.capture(frame({ handSampledAtMs: 1100, rawHands: [candidate({ sampledAtMs: 1100 })] }), condition({ orientation: "edge-on" }), 640);
    collector.capture(frame({ handSampledAtMs: 1200, rawHands: [candidate({ sampledAtMs: 1200 })] }), condition({ distance: "near" }), 680);
    collector.capture(frame({ handSampledAtMs: 1300, rawHands: [candidate({ sampledAtMs: 1300 })] }), condition({ distance: "far" }), 720);
    collector.capture(frame({ handSampledAtMs: 1400, rawHands: [candidate({ sampledAtMs: 1400 })] }), condition({ occlusion: "partial-fingers" }), 760);
    expect(reportFixtureGaps(collector.getCoverage()).complete).toBe(true);
  });

  it("exports a self-describing file with coverage and samples", () => {
    const collector = new GestureFixtureCollector();
    collector.capture(frame(), condition(), 500);
    const file = collector.toFile(9_000);
    expect(file.kind).toBe("veiltalk-gesture-fixture");
    expect(file.version).toBe(1);
    expect(file.exportedAtMs).toBe(9_000);
    expect(file.sampleCount).toBe(1);
    expect(file.coverage).toHaveLength(1);
    expect(file.samples).toHaveLength(1);
  });

  // NFR-06: fixture chỉ được chứa toạ độ landmark, không có ảnh hay dữ liệu tái dựng khuôn mặt.
  it("never serialises image data", () => {
    const collector = new GestureFixtureCollector();
    collector.capture(frame(), condition(), 500);
    const serialised = JSON.stringify(collector.toFile(9_000));
    expect(serialised).not.toContain("data:image");
    expect(serialised).not.toContain("blendshape");
    expect(serialised).not.toContain("facialTransform");
  });

  it("clears every sample and restarts indexing", () => {
    const collector = new GestureFixtureCollector();
    collector.capture(frame(), condition(), 500);
    collector.clear();
    expect(collector.getSampleCount()).toBe(0);
    collector.capture(frame(), condition(), 540);
    expect(collector.getSamples()[0].index).toBe(0);
  });
});
