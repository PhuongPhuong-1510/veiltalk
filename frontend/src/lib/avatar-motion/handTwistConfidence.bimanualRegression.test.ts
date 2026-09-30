import { describe, expect, it } from "vitest";
import { computeHandTwistConfidence } from "./handTwistConfidence";

describe("hand twist confidence bimanual regression", () => {
  it("uses assigned-side handedness compatibility instead of rewarding a confident wrong label", () => {
    const result = computeHandTwistConfidence({
      handMatched: true,
      twistAccepted: true,
      matchQuality: 0.9,
      palmGeometryQuality: 0.9,
      palmProjectionRatio: 0.9,
      referenceProjectionRatio: 0.9,
      handAgeMs: 0,
      poseHandTimestampDeltaMs: 0,
      handednessScore: 0.99,
      handednessCompatibilityQuality: 0.01,
      previousTrusted: false,
    });
    expect(result.components.handednessQuality).toBeCloseTo(0.01);
  });

  it("allows accepted absolute-rig geometry to own projection confidence", () => {
    const result = computeHandTwistConfidence({
      handMatched: true,
      twistAccepted: true,
      matchQuality: 0.9,
      palmGeometryQuality: 0.9,
      palmProjectionRatio: 0,
      referenceProjectionRatio: 0,
      projectionQualityOverride: 0.9,
      handAgeMs: 0,
      poseHandTimestampDeltaMs: 0,
      handednessScore: null,
      previousTrusted: false,
    });
    expect(result.components.projectionQuality).toBeCloseTo(0.9);
    expect(result.trusted).toBe(true);
  });

  it("still fails closed when neither generic nor override projection is observable", () => {
    const result = computeHandTwistConfidence({
      handMatched: true,
      twistAccepted: true,
      matchQuality: 0.9,
      palmGeometryQuality: 0.9,
      palmProjectionRatio: 0,
      referenceProjectionRatio: 0,
      handAgeMs: 0,
      poseHandTimestampDeltaMs: 0,
      handednessScore: null,
      previousTrusted: false,
    });
    expect(result.trusted).toBe(false);
    expect(result.rejectionReason).toBe("projection-degenerate");
  });
});
