import { describe, expect, it } from "vitest";
import { buildHandMotionDiagnostics, type HandMotionDiagnosticsInput } from "./handMotionDiagnostics";
import type { HandPoseMatchResult, HandSideMatchResult } from "./handPoseMatching";
import type { HandPalmBasisOutput, HandBasisResult } from "./handPalmBasis";

const validBasis: HandBasisResult = { across: { x: 1, y: 0, z: 0 }, forward: { x: 0, y: 1, z: 0 }, normal: { x: 0, y: 0, z: 1 } };

function matchedSide(candidateArrayIndex = 0, distance = 0.02, matchChanged = true): HandSideMatchResult {
  return { side: "left", matched: true, candidateArrayIndex, candidateSourceIndex: candidateArrayIndex, distance, handedness: "left", handednessScore: 0.9, rejectionReason: null, continuity: matchChanged ? "new" : "continued", matchChanged };
}
function unmatchedSide(reason: HandSideMatchResult["rejectionReason"]): HandSideMatchResult {
  return { side: "left", matched: false, candidateArrayIndex: null, candidateSourceIndex: null, distance: null, handedness: null, handednessScore: null, rejectionReason: reason, continuity: "unmatched", matchChanged: false };
}
function palmOutput(overrides: Partial<HandPalmBasisOutput> = {}): HandPalmBasisOutput {
  return {
    imageBasis: validBasis, imageGeometryQuality: 0.9, imageRejectionReason: null,
    worldBasis: validBasis, worldGeometryQuality: 0.9, worldRejectionReason: null,
    handedness: "left",
    ...overrides,
  };
}

function baseInput(overrides: Partial<HandMotionDiagnosticsInput> = {}): HandMotionDiagnosticsInput {
  const matchResult: HandPoseMatchResult = {
    ranMatching: true,
    left: matchedSide(),
    right: unmatchedSide("wrist-distance-too-large"),
  };
  return {
    handSampledThisFrame: true,
    handSampledAtMs: 100,
    poseSampledAtMs: 100,
    rawHandsCount: 1,
    matchResult,
    palmBasisBySide: { left: palmOutput(), right: null },
    ...overrides,
  };
}

describe("buildHandMotionDiagnostics", () => {
  it("1. valid match with both palm basis valid -> matched", () => {
    const result = buildHandMotionDiagnostics(baseInput());
    expect(result.left.status).toBe("matched");
    expect(result.left.handMatched).toBe(true);
    expect(result.left.imageBasis).toEqual(validBasis);
    expect(result.left.worldBasis).toEqual(validBasis);
  });

  it("2. valid match, image fails but world passes -> matched-partial-palm", () => {
    const result = buildHandMotionDiagnostics(baseInput({
      palmBasisBySide: { left: palmOutput({ imageBasis: null, imageRejectionReason: "area-too-small" }), right: null },
    }));
    expect(result.left.status).toBe("matched-partial-palm");
    expect(result.left.imagePalmRejectionReason).toBe("area-too-small");
    expect(result.left.worldPalmRejectionReason).toBeNull();
  });

  it("3. valid match, both basis fail -> matched-no-palm", () => {
    const result = buildHandMotionDiagnostics(baseInput({
      palmBasisBySide: {
        left: palmOutput({ imageBasis: null, imageRejectionReason: "across-too-small", worldBasis: null, worldRejectionReason: "world-basis-degenerate" }),
        right: null,
      },
    }));
    expect(result.left.status).toBe("matched-no-palm");
    expect(result.left.imagePalmRejectionReason).toBe("across-too-small");
    expect(result.left.worldPalmRejectionReason).toBe("world-basis-degenerate");
  });

  it("4. handSampledThisFrame=false -> not-sampled", () => {
    const result = buildHandMotionDiagnostics(baseInput({
      handSampledThisFrame: false,
      matchResult: { ranMatching: false, left: unmatchedSide("no-candidates"), right: unmatchedSide("no-candidates") },
      rawHandsCount: 0,
      palmBasisBySide: { left: null, right: null },
    }));
    expect(result.left.status).toBe("not-sampled");
    expect(result.right.status).toBe("not-sampled");
  });

  it("5. sampled but no candidates -> no-candidates", () => {
    const result = buildHandMotionDiagnostics(baseInput({
      rawHandsCount: 0,
      matchResult: { ranMatching: true, left: unmatchedSide("no-candidates"), right: unmatchedSide("no-candidates") },
      palmBasisBySide: { left: null, right: null },
    }));
    expect(result.left.status).toBe("no-candidates");
    expect(result.left.handDetected).toBe(false);
  });

  it("6. candidates present but wrist too far -> unmatched", () => {
    const result = buildHandMotionDiagnostics(baseInput({
      rawHandsCount: 2,
      matchResult: { ranMatching: true, left: unmatchedSide("wrist-distance-too-large"), right: unmatchedSide("wrist-distance-too-large") },
      palmBasisBySide: { left: null, right: null },
    }));
    expect(result.left.status).toBe("unmatched");
    expect(result.left.matchingRejectionReason).toBe("wrist-distance-too-large");
  });

  it("7. stale sample -> stale", () => {
    const result = buildHandMotionDiagnostics(baseInput({
      rawHandsCount: 1,
      handSampledAtMs: 100, poseSampledAtMs: 1000,
      matchResult: { ranMatching: true, left: unmatchedSide("stale-frame"), right: unmatchedSide("stale-frame") },
      palmBasisBySide: { left: null, right: null },
    }));
    expect(result.left.status).toBe("stale");
    expect(result.left.matchingRejectionReason).toBe("stale-frame");
  });

  it("8. handDetected=true but handMatched=false (two far candidates)", () => {
    const result = buildHandMotionDiagnostics(baseInput({
      rawHandsCount: 2,
      matchResult: { ranMatching: true, left: unmatchedSide("wrist-distance-too-large"), right: unmatchedSide("wrist-distance-too-large") },
      palmBasisBySide: { left: null, right: null },
    }));
    expect(result.left.handDetected).toBe(true);
    expect(result.left.handMatched).toBe(false);
    expect(result.left.status).toBe("unmatched");
  });

  it("9. timestamp delta computed from real sampledAtMs of hand and pose", () => {
    const result = buildHandMotionDiagnostics(baseInput({ handSampledAtMs: 120, poseSampledAtMs: 150 }));
    expect(result.left.handPoseTimestampDeltaMs).toBe(30);
  });

  it("9b. timestamp delta is null when either sample time is missing", () => {
    const result = buildHandMotionDiagnostics(baseInput({ handSampledAtMs: null }));
    expect(result.left.handPoseTimestampDeltaMs).toBeNull();
  });

  it("10. matcher/image/world rejection reasons stay independent", () => {
    const result = buildHandMotionDiagnostics(baseInput({
      matchResult: { ranMatching: true, left: matchedSide(), right: unmatchedSide("wrist-distance-too-large") },
      palmBasisBySide: { left: palmOutput({ imageBasis: null, imageRejectionReason: "forward-too-small" }), right: null },
    }));
    expect(result.left.matchingRejectionReason).toBeNull();
    expect(result.left.imagePalmRejectionReason).toBe("forward-too-small");
    expect(result.left.worldPalmRejectionReason).toBeNull();
    expect(result.right.matchingRejectionReason).toBe("wrist-distance-too-large");
    expect(result.right.imagePalmRejectionReason).toBeNull();
  });

  it("11. left and right diagnostics do not cross-contaminate", () => {
    const matchResult: HandPoseMatchResult = {
      ranMatching: true,
      left: { side: "left", matched: true, candidateArrayIndex: 0, candidateSourceIndex: 0, distance: 0.01, handedness: "left", handednessScore: 0.9, rejectionReason: null, continuity: "continued", matchChanged: false },
      right: { side: "right", matched: true, candidateArrayIndex: 1, candidateSourceIndex: 1, distance: 0.5, handedness: "right", handednessScore: 0.8, rejectionReason: null, continuity: "new", matchChanged: true },
    };
    const rightBasis: HandBasisResult = { across: { x: 0, y: 1, z: 0 }, forward: { x: 1, y: 0, z: 0 }, normal: { x: 0, y: 0, z: -1 } };
    const result = buildHandMotionDiagnostics(baseInput({
      matchResult,
      palmBasisBySide: { left: palmOutput(), right: palmOutput({ imageBasis: rightBasis, worldBasis: rightBasis, handedness: "right" }) },
    }));
    expect(result.left.candidateSourceIndex).toBe(0);
    expect(result.right.candidateSourceIndex).toBe(1);
    expect(result.left.wristDistance).toBe(0.01);
    expect(result.right.wristDistance).toBe(0.5);
    expect(result.left.imageBasis).toEqual(validBasis);
    expect(result.right.imageBasis).toEqual(rightBasis);
    expect(result.left.poseSide).toBe("left");
    expect(result.right.poseSide).toBe("right");
  });

  it("12. output basis is a plain object, not the mutable object from input", () => {
    const inputBasis: HandBasisResult = { across: { x: 1, y: 0, z: 0 }, forward: { x: 0, y: 1, z: 0 }, normal: { x: 0, y: 0, z: 1 } };
    const palm = palmOutput({ imageBasis: inputBasis, worldBasis: inputBasis });
    const result = buildHandMotionDiagnostics(baseInput({ palmBasisBySide: { left: palm, right: null } }));
    expect(result.left.imageBasis).not.toBe(inputBasis);
    expect(result.left.imageBasis!.across).not.toBe(inputBasis.across);
    // Mutating the input after the call must not affect the returned diagnostic.
    inputBasis.across.x = 999;
    expect(result.left.imageBasis!.across.x).toBe(1);
  });

  it("13. identical input produces a deterministic result", () => {
    const input = baseInput();
    const first = buildHandMotionDiagnostics(input);
    const second = buildHandMotionDiagnostics(input);
    expect(first).toEqual(second);
  });

  it("14. output never contains quaternion, pole or jointRotations fields", () => {
    const result = buildHandMotionDiagnostics(baseInput());
    for (const side of [result.left, result.right]) {
      expect(side).not.toHaveProperty("quaternion");
      expect(side).not.toHaveProperty("pole");
      expect(side).not.toHaveProperty("jointRotations");
    }
  });

  it("mirrorApplied is always false in Mức 2A", () => {
    const result = buildHandMotionDiagnostics(baseInput());
    expect(result.left.mirrorApplied).toBe(false);
    expect(result.right.mirrorApplied).toBe(false);
  });

  it("not-sampled takes priority over no-candidates (does not collapse the two cases)", () => {
    // handSampledThisFrame=false với rawHandsCount=0 phải vẫn báo "not-sampled", không phải "no-candidates".
    const result = buildHandMotionDiagnostics(baseInput({
      handSampledThisFrame: false,
      rawHandsCount: 0,
      matchResult: { ranMatching: false, left: unmatchedSide("no-candidates"), right: unmatchedSide("no-candidates") },
      palmBasisBySide: { left: null, right: null },
    }));
    expect(result.left.status).toBe("not-sampled");
  });

  it("matchChanged reflects the matcher's continuity result, not candidateSourceIndex", () => {
    // matchChanged=true đến trực tiếp từ matcher (Việc 1) khi continuity là "reacquired" — dù
    // candidateSourceIndex ở đây trùng với lần trước, diagnostic vẫn phải báo matchChanged=true
    // vì đó là điều matcher đã kết luận dựa trên vị trí wrist, không phải suy lại từ index.
    const reacquired = buildHandMotionDiagnostics(baseInput({
      matchResult: { ranMatching: true, left: matchedSide(0, 0.02, true), right: unmatchedSide("wrist-distance-too-large") },
    }));
    expect(reacquired.left.matchChanged).toBe(true);

    const continued = buildHandMotionDiagnostics(baseInput({
      matchResult: { ranMatching: true, left: matchedSide(0, 0.02, false), right: unmatchedSide("wrist-distance-too-large") },
    }));
    expect(continued.left.matchChanged).toBe(false);
  });

  it("matchChanged is always false for an unmatched side", () => {
    const result = buildHandMotionDiagnostics(baseInput());
    expect(result.right.handMatched).toBe(false);
    expect(result.right.matchChanged).toBe(false);
  });

  it("handednessScore is copied through from the matcher and null when unmatched", () => {
    const result = buildHandMotionDiagnostics(baseInput());
    expect(result.left.handednessScore).toBe(0.9);
    expect(result.right.handednessScore).toBeNull();
  });

  it("duplicate classification reports no matching continuity and takes priority over candidate data", () => {
    const result = buildHandMotionDiagnostics(baseInput({
      sampleClassification: "duplicate",
      matchResult: { ranMatching: false, left: unmatchedSide("no-candidates"), right: unmatchedSide("no-candidates") },
      palmBasisBySide: { left: null, right: null },
    }));
    expect(result.left).toMatchObject({
      sampleClassification: "duplicate",
      status: "duplicate",
      ranMatching: false,
      matchingContinuity: "not-evaluated",
    });
    expect(result.left.imageBasis).toBeNull();
    expect(result.left.worldBasis).toBeNull();
  });
});
