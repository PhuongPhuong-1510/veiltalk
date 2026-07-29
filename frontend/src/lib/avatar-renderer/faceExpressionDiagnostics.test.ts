import { describe, expect, it } from "vitest";
import { DERIVED_FACE_EXPRESSION_NAMES, MEDIA_PIPE_SEMANTIC_COUNT } from "../avatar-motion/expressionMapper";
import { buildFaceExpressionCapabilityMatrix, buildFaceExpressionRenderRows, resolveFaceExpression } from "./faceExpressionDiagnostics";

describe("face expression diagnostics", () => {
  it("uses portable VRM emotion presets only when detailed brow/frown targets are absent", () => {
    expect(resolveFaceExpression("browDownLeft", new Set(["angry"]))).toMatchObject({ support: "fallback", modelExpression: "angry" });
    expect(resolveFaceExpression("browInnerUp", new Set(["surprised", "sad"]))).toMatchObject({ support: "fallback", modelExpression: "surprised" });
    expect(resolveFaceExpression("mouthFrownRight", new Set(["sad"]))).toMatchObject({ support: "fallback", modelExpression: "sad" });
    expect(resolveFaceExpression("cheekPuff", new Set(["happy", "angry", "sad", "surprised"]))).toMatchObject({ support: "unsupported", modelExpression: null });
  });

  it("prefers discovered detailed VRoid morph aliases over whole-face VRM presets", () => {
    const available = new Set(["Fcl_BRW_Angry", "Fcl_BRW_Surprised", "Fcl_MTH_Sorrow", "angry", "surprised", "sad"]);
    expect(resolveFaceExpression("browDownLeft", available)).toMatchObject({ support: "fallback", modelExpression: "Fcl_BRW_Angry" });
    expect(resolveFaceExpression("browOuterUpRight", available)).toMatchObject({ support: "fallback", modelExpression: "Fcl_BRW_Surprised" });
    expect(resolveFaceExpression("mouthFrownLeft", available)).toMatchObject({ support: "fallback", modelExpression: "Fcl_MTH_Sorrow" });
  });
  it("classifies same-name, declared fallback and unsupported expressions", () => {
    const available = new Set(["eyeBlinkLeft", "blinkRight", "aa"]);
    expect(resolveFaceExpression("eyeBlinkLeft", available)).toMatchObject({ support: "mapped", modelExpression: "eyeBlinkLeft" });
    expect(resolveFaceExpression("eyeBlinkRight", available)).toMatchObject({ support: "fallback", modelExpression: "blinkRight" });
    expect(resolveFaceExpression("jawOpen", available)).toMatchObject({ support: "fallback", modelExpression: "aa" });
    expect(resolveFaceExpression("cheekPuff", available)).toMatchObject({ support: "unsupported", modelExpression: null });
  });

  it("uses the O vowel before U as the declared funnel fallback", () => {
    expect(resolveFaceExpression("mouthFunnel", new Set(["ou", "oh"])))
      .toMatchObject({ support: "fallback", modelExpression: "oh" });
  });

  it("does not silently fall back when an explicit profile target is missing", () => {
    expect(resolveFaceExpression("jawOpen", new Set(["aa"]), { jawOpen: "customJaw" }))
      .toEqual({ semantic: "jawOpen", support: "unsupported", modelExpression: null, reason: "explicit-target-missing:customJaw" });
  });

  it("builds one capability row for every MediaPipe face semantic", () => {
    const rows = buildFaceExpressionCapabilityMatrix(["aa"]);
    expect(rows.length).toBe(MEDIA_PIPE_SEMANTIC_COUNT + DERIVED_FACE_EXPRESSION_NAMES.length);
    expect(new Set(rows.map((row) => row.semantic)).size).toBe(rows.length);
  });

  it("keeps raw, processed and rendered values distinct", () => {
    const capability = [resolveFaceExpression("jawOpen", new Set(["aa"]))];
    expect(buildFaceExpressionRenderRows(capability, { jawOpen: .8 }, { jawOpen: .6 }, { jawOpen: .4 })[0])
      .toMatchObject({ rawValue: .8, processedValue: .6, renderedValue: .4 });
  });
});
