import { describe, expect, it } from "vitest";
import { buildFaceExpressionApplyPlan, findStaleFaceExpressionTargets, type FaceExpressionBinding } from "./faceExpressionApplyPlan";

const binding = (semantic: string, support: FaceExpressionBinding["support"], key: string, physicalTargetIds = [key]): FaceExpressionBinding => ({
  semantic, support, target: { key, type: key.startsWith("vrm:") ? "vrm-expression" : "raw-morph", name: key, physicalTargetIds },
});

describe("face expression apply plan", () => {
  it("allows bounded overdrive only when a model binding explicitly declares it", () => {
    const normal = binding("browDownLeft", "fallback", "normal");
    const boosted: FaceExpressionBinding = { ...binding("browDownLeft", "fallback", "boosted"), modelGain: 1.6, outputMax: 1.6 };
    expect(buildFaceExpressionApplyPlan({ browDownLeft: 1 }, [normal]).entries[0].value).toBe(1);
    expect(buildFaceExpressionApplyPlan({ browDownLeft: 1 }, [boosted]).entries[0].value).toBe(1.6);
    expect(buildFaceExpressionApplyPlan({ browDownLeft: 2 }, [boosted]).entries[0].value).toBe(1.6);
  });
  it("lets an exact mapped semantic own a target instead of its fallback alias", () => {
    const plan = buildFaceExpressionApplyPlan({ jawOpen: .8, aa: .6 }, [binding("jawOpen", "fallback", "vrm:aa"), binding("aa", "mapped", "vrm:aa")]);
    expect(plan.entries.map((entry) => entry.semantic)).toEqual(["aa"]);
    expect(plan.rejected).toEqual([{ semantic: "jawOpen", reason: "physical-target-owned", owner: "aa" }]);
  });

  it("deduplicates a VRM expression and raw morph that share a physical target", () => {
    const shared = ["morph:mesh-1:2"];
    const plan = buildFaceExpressionApplyPlan({ happy: .7, mouthSmileLeft: .9 }, [
      binding("mouthSmileLeft", "mapped", "morph:Smile_L", shared),
      binding("happy", "mapped", "vrm:happy", shared),
    ]);
    expect(plan.entries.map((entry) => entry.semantic)).toEqual(["mouthSmileLeft"]);
    expect(plan.rejected[0]).toMatchObject({ semantic: "happy", owner: "mouthSmileLeft" });
  });

  it("does not apply aggregate happy when a direct detailed smile is available", () => {
    const plan = buildFaceExpressionApplyPlan({ mouthSmileLeft: .8, happy: .6 }, [
      binding("mouthSmileLeft", "mapped", "morph:Smile_L"),
      binding("happy", "mapped", "vrm:happy"),
    ]);
    expect(plan.entries.map((entry) => entry.semantic)).toEqual(["mouthSmileLeft"]);
    expect(plan.rejected).toContainEqual({ semantic: "happy", reason: "detailed-smile-owned", owner: "mouthSmileLeft" });
  });

  it("keeps independent physical targets and clamps their values", () => {
    const plan = buildFaceExpressionApplyPlan({ blinkLeft: 2, blinkRight: -.2 }, [binding("blinkLeft", "mapped", "vrm:left"), binding("blinkRight", "mapped", "vrm:right")]);
    expect(plan.entries.map(({ semantic, value }) => ({ semantic, value }))).toEqual([{ semantic: "blinkLeft", value: 1 }, { semantic: "blinkRight", value: 0 }]);
  });

  it("lets the stronger synonym own a shared fallback target", () => {
    const plan = buildFaceExpressionApplyPlan({ mouthPucker: .1, mouthFunnel: .8 }, [
      binding("mouthPucker", "fallback", "vrm:ou"), binding("mouthFunnel", "fallback", "vrm:ou"),
    ]);
    expect(plan.entries).toEqual([expect.objectContaining({ semantic: "mouthFunnel", value: .8 })]);
    expect(plan.rejected).toContainEqual({ semantic: "mouthPucker", reason: "physical-target-owned", owner: "mouthFunnel" });
  });

  it("identifies a previously owned target that disappeared from the current frame", () => {
    const previousBinding = binding("jawOpen", "mapped", "vrm:aa");
    const current = buildFaceExpressionApplyPlan({ blinkLeft: 1 }, [binding("blinkLeft", "mapped", "vrm:blink")]);
    expect(findStaleFaceExpressionTargets(new Map([[previousBinding.target.key, previousBinding.target]]), current))
      .toEqual([previousBinding.target]);
  });
});
