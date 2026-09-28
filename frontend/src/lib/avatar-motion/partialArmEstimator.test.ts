import { describe, expect, it } from "vitest";
import type { EstimatedArmChain, EstimatedJoint, PartialArmHistory } from "./partialArmEstimator";
import { estimatePartialArm } from "./partialArmEstimator";

const joint = (x: number, y: number, z = 0): EstimatedJoint => ({ position: { x, y, z }, source: "pose-observed", confidence: 1, uncertainty: 0, sampledAtMs: 0, ageMs: 0 });
const chain = (): EstimatedArmChain => ({ shoulder: joint(0, 0), elbow: joint(.5, .866), wrist: joint(1, 0), upperLength: 1, lowerLength: 1, bendPole: { x: 0, y: 1, z: 0 }, mode: "fully-observed", observability: "SEW", topologyLocked: false, geometryConfidence: 1, ambiguity: 0, uncertainty: { shoulderPosition: 0, elbowPosition: 0, wristPosition: 0, bendPlaneRadians: 0, depth: 0, topologyAmbiguous: false }, mayUpdateUpper: true, mayUpdateLower: true, mayChangeBendPlane: true, solutionManifold: "none" });
const history = (): PartialArmHistory => ({ chain: chain(), topology: { bendHemisphere: 1, crossBodySide: 1, poleDirection: { x: 0, y: 1, z: 0 }, depthOrdering: 1 }, lastFullyObservedAtMs: 0 });

describe("partial arm estimator", () => {
  it("locks topology and continues the previous elbow branch for S-W", () => {
    const result = estimatePartialArm({ observability: "S-W", shoulder: joint(0, 0), wrist: joint(1, 0), upperLength: 1, lowerLength: 1, nowMs: 100, history: history() });
    expect(result.mode).toBe("partial-continuation"); expect(result.topologyLocked).toBe(true);
    expect(result.elbow.source).toBe("constraint-projected"); expect(result.elbow.position!.y).toBeGreaterThan(0);
    expect(result.mayChangeBendPlane).toBe(false);
  });

  it("does not let a single landmark create arm motion", () => {
    const result = estimatePartialArm({ observability: "--W", wrist: joint(2, 2), upperLength: 1, lowerLength: 1, nowMs: 100, history: history() });
    expect(result.mode).toBe("ambiguous-hold"); expect(result.mayUpdateUpper).toBe(false); expect(result.mayUpdateLower).toBe(false);
  });

  it("enters safe return after long ambiguity", () => {
    const result = estimatePartialArm({ observability: "---", upperLength: 1, lowerLength: 1, nowMs: 1600, history: history() });
    expect(result.mode).toBe("safe-return"); expect(result.uncertainty.topologyAmbiguous).toBe(true);
  });
});
