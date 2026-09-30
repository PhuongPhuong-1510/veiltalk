import { describe, expect, it } from "vitest";
import type { RawHandCandidateV1, RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import { matchHandsToPose } from "./handPoseMatching";

const point = (x: number, y = 0.5): RawNormalizedLandmarkV1 => ({ x, y, z: 0, visibility: 1 });
const hand = (
  x: number,
  handedness: RawHandCandidateV1["handedness"] = "unknown",
  handednessScore: number | null = null,
  sourceIndex = 0,
): RawHandCandidateV1 => {
  const landmarks = Array.from({ length: 21 }, () => point(x));
  return {
    landmarks,
    worldLandmarks: landmarks.map((value) => ({ ...value })),
    handedness,
    handednessScore,
    sourceIndex,
    sampledAtMs: 1000,
  } as RawHandCandidateV1;
};

const run = (input: {
  hands: RawHandCandidateV1[];
  leftPose: RawNormalizedLandmarkV1 | null;
  rightPose: RawNormalizedLandmarkV1 | null;
  previous?: Parameters<typeof matchHandsToPose>[0]["previous"];
}) => matchHandsToPose({
  handSampledThisFrame: true,
  rawHands: input.hands,
  poseWristImage: { left: input.leftPose, right: input.rightPose },
  poseSampledAtMs: 1000,
  handSampledAtMs: 1000,
  videoWidth: 1280,
  videoHeight: 720,
  previous: input.previous ?? {},
});

describe("bimanual Hand↔Pose matching regression", () => {
  it("bootstraps the missing Pose side from the remaining clear candidate", () => {
    const result = run({
      hands: [hand(0.31, "left", 0.95, 0), hand(0.72, "right", 0.95, 1)],
      leftPose: point(0.30),
      rightPose: null,
    });
    expect(result.left.matched).toBe(true);
    expect(result.right.matched).toBe(true);
    expect(result.right.matchSource).toBe("bimanual-bootstrap");
    expect(result.right.matchQuality).toBeGreaterThanOrEqual(0.55);
    expect(result.right.matchQuality).toBeLessThanOrEqual(0.82);
  });

  it("does not bootstrap through a strong contradictory handedness label", () => {
    const result = run({
      hands: [hand(0.31, "left", 0.95, 0), hand(0.72, "left", 0.95, 1)],
      leftPose: point(0.30),
      rightPose: null,
    });
    expect(result.left.matched).toBe(true);
    expect(result.right.matched).toBe(false);
  });

  it("preserves identities through a transient two-wrist crossing instead of swapping on tiny cost changes", () => {
    const aspectY = 720 / 1280;
    const result = run({
      hands: [hand(0.48, "unknown", null, 0), hand(0.52, "unknown", null, 1)],
      leftPose: point(0.505),
      rightPose: point(0.495),
      previous: {
        left: { wristPosition: { x: 0.30, y: 0.5 * aspectY }, lastMatchedAtMs: 990 },
        right: { wristPosition: { x: 0.70, y: 0.5 * aspectY }, lastMatchedAtMs: 990 },
      },
    });
    expect(result.left.candidateArrayIndex).toBe(0);
    expect(result.right.candidateArrayIndex).toBe(1);
    expect(result.left.continuity).toBe("continued");
    expect(result.right.continuity).toBe("continued");
  });

  it("is independent of rawHands array order when geometry/continuity identify both hands", () => {
    const aspectY = 720 / 1280;
    const previous = {
      left: { wristPosition: { x: 0.30, y: 0.5 * aspectY }, lastMatchedAtMs: 990 },
      right: { wristPosition: { x: 0.70, y: 0.5 * aspectY }, lastMatchedAtMs: 990 },
    };
    const a = run({ hands: [hand(0.32, "left", 0.9, 5), hand(0.68, "right", 0.9, 9)], leftPose: point(0.32), rightPose: point(0.68), previous });
    const b = run({ hands: [hand(0.68, "right", 0.9, 9), hand(0.32, "left", 0.9, 5)], leftPose: point(0.32), rightPose: point(0.68), previous });
    expect(a.left.candidateSourceIndex).toBe(5);
    expect(a.right.candidateSourceIndex).toBe(9);
    expect(b.left.candidateSourceIndex).toBe(5);
    expect(b.right.candidateSourceIndex).toBe(9);
  });
});
