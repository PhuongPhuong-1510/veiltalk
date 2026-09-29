import { describe, expect, it } from "vitest";
import { createArmDepthTrackerState, generateReachShellCandidateSets, updateArmDepthTracker, updateArmDepthTrackerCandidates } from "./armDepthTracker";
import type { WristDepthCandidateSet } from "./wristReconstruction";

const generated = (positiveZ: number, negativeZ: number): WristDepthCandidateSet => ({
  accepted: true, feasibilityConfidence: 1, imageToWorldScale: 1, planarDistance: 0, rawPlanarDistance: 0,
  reachViolation: 0, projectedImage: { x: .5, y: .5, z: 0 },
  branchSeparation: Math.abs(positiveZ - negativeZ), rejectionReason: null,
  candidates: [
    { point: { x: 0, y: 0, z: positiveZ }, branch: 1, depthDelta: positiveZ, direction:{x:0,y:0,z:1}, targetDistance:.5 },
    { point: { x: 0, y: 0, z: negativeZ }, branch: -1, depthDelta: negativeZ, direction:{x:0,y:0,z:-1}, targetDistance:.5 },
  ],
});

describe("arm depth tracker", () => {
  it("does not switch a committed branch on one contrary sample", () => {
    const state = createArmDepthTrackerState();
    const first = updateArmDepthTracker(state, generated(.5, -.5), { anchorWorld:{x:0,y:0,z:0}, targetDistance:.5, previousDirection:{x:0,y:0,z:1}, sampledAtMs:0 });
    expect(first.selectedBranch).toBe(1);
    const contrary = updateArmDepthTracker(state, generated(.5, -.5), { anchorWorld:{x:0,y:0,z:0}, targetDistance:.5, previousDirection:{x:0,y:0,z:-1}, sampledAtMs:33 });
    expect(contrary.selectedBranch).toBe(1);
  });

  it("switches after consecutive strong contrary samples", () => {
    const state = createArmDepthTrackerState();
    updateArmDepthTracker(state, generated(.5, -.5), { anchorWorld:{x:0,y:0,z:0}, targetDistance:.5, previousDirection:{x:0,y:0,z:1}, sampledAtMs:0 });
    updateArmDepthTracker(state, generated(.5, -.5), { anchorWorld:{x:0,y:0,z:0}, targetDistance:.5, previousDirection:{x:0,y:0,z:-1}, sampledAtMs:500 });
    const switched = updateArmDepthTracker(state, generated(.5, -.5), { anchorWorld:{x:0,y:0,z:0}, targetDistance:.5, previousDirection:{x:0,y:0,z:-1}, sampledAtMs:533 });
    expect(switched.selectedBranch).toBe(-1);
  });

  it("treats coincident branches as low-risk rather than maximally ambiguous", () => {
    const state = createArmDepthTrackerState();
    const result = updateArmDepthTracker(state, generated(.001, -.001), { anchorWorld:{x:0,y:0,z:0}, targetDistance:.5, previousDirection:{x:1,y:0,z:0}, sampledAtMs:0 });
    expect(result.depthAmbiguity).toBeLessThan(.01);
  });

  it("samples a reachable shell instead of freezing shoulder-to-wrist reach",()=>{
    const sets=generateReachShellCandidateSets({anchorWorld:{x:0,y:0,z:0},anchorImage:{x:.5,y:.5,z:0,visibility:1},targetImage:{x:.7,y:.5,z:0,visibility:1},minimumDistance:.05,maximumDistance:.6,preferredDistance:.3,imageToWorldScale:1,videoWidth:100,videoHeight:100,reachSlackRatio:.1});
    expect(new Set(sets.flatMap(set=>set.candidates.map(candidate=>candidate.targetDistance))).size).toBeGreaterThan(2);
    const state=createArmDepthTrackerState();
    const result=updateArmDepthTrackerCandidates(state,sets,{anchorWorld:{x:0,y:0,z:0},targetDistance:.3,previousDirection:{x:1,y:0,z:0},sampledAtMs:0},"shoulder-shell");
    expect(result.accepted).toBe(true);
  });

  it("drops stale positional history instead of letting it lock a reacquired branch",()=>{
    const state=createArmDepthTrackerState();
    updateArmDepthTracker(state,generated(.5,-.5),{anchorWorld:{x:0,y:0,z:0},targetDistance:.5,previousDirection:{x:0,y:0,z:1},sampledAtMs:0});
    updateArmDepthTracker(state,generated(.5,-.5),{anchorWorld:{x:0,y:0,z:0},targetDistance:.5,previousDirection:{x:0,y:0,z:-1},sampledAtMs:1000});
    const result=updateArmDepthTracker(state,generated(.5,-.5),{anchorWorld:{x:0,y:0,z:0},targetDistance:.5,previousDirection:{x:0,y:0,z:-1},sampledAtMs:1033});
    expect(result.selectedBranch).toBe(-1);
  });
});
