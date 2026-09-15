import { describe, expect, it } from "vitest";
import { assertUniqueFacialExpressionTargets, buildVerifiedFacialExpressionMap } from "./facialExpressionProfile";

describe("verified facial expression profile", () => {
  it("recognizes exact and exporter-prefixed VRoid morph suffixes", () => {
    expect(buildVerifiedFacialExpressionMap([
      "Face.M_F00_000_00_Fcl_BRW_Angry", "Fcl_BRW_Surprised", "Fcl_EYE_Spread",
      "Fcl_EYE_Joy_L", "Fcl_EYE_Joy_R",
      "Fcl_MTH_Close", "Fcl_MTH_Up", "Fcl_MTH_Down", "Fcl_MTH_Small", "Fcl_MTH_Large",
      "Fcl_MTH_Fun", "Fcl_MTH_Joy", "Fcl_MTH_Sorrow",
    ])).toEqual({
      browDown: "Face.M_F00_000_00_Fcl_BRW_Angry",
      browUp: "Fcl_BRW_Surprised",
      eyeWide: "Fcl_EYE_Spread",
      mouthClose: "Fcl_MTH_Close",
      mouthUpperUp: "Fcl_MTH_Up",
      mouthLowerDown: "Fcl_MTH_Down",
      mouthNarrow: "Fcl_MTH_Small",
      mouthWide: "Fcl_MTH_Large",
      mouthSmileClosed: "Fcl_MTH_Fun",
      mouthSmileOpen: "Fcl_MTH_Joy",
      mouthFrown: "Fcl_MTH_Sorrow",
    });
  });

  it("does not guess unrelated raw morphs", () => {
    expect(buildVerifiedFacialExpressionMap(["Smile", "UnknownBrow", "Fcl_ALL_Angry"])).toEqual({});
  });

  it("maps the manually verified numeric VRM 0 targets only for reference-avatar-2", () => {
    const names = Array.from({ length: 56 }, (_, index) => String(index));
    expect(buildVerifiedFacialExpressionMap(
      names,
      "/models/avatars/reference-avatar-2.vrm#vrm:0",
    )).toEqual({
      browDown: "6",
      browUp: "10",
      eyeWide: "22",
      mouthUpperUp: "26",
      mouthLowerDown: "27",
      mouthSmileClosed: "30",
      mouthSmileOpen: "31",
      mouthFrown: "32",
    });
  });

  it("uses the separate verified numeric profile for reference-avatar", () => {
    const names = Array.from({ length: 57 }, (_, index) => String(index));
    expect(buildVerifiedFacialExpressionMap(
      names,
      "/models/avatars/reference-avatar.vrm#vrm:0",
    )).toMatchObject({
      browDown: "6", browUp: "10", eyeWide: "22",
      mouthClose: "25", mouthUpperUp: "26", mouthLowerDown: "27",
      mouthNarrow: "29", mouthWide: "30",
      mouthSmileClosed: "32", mouthSmileOpen: "33", mouthFrown: "34",
    });
  });

  it("does not guess semantic meaning for numeric morphs from an unknown model", () => {
    const names = Array.from({ length: 56 }, (_, index) => String(index));
    expect(buildVerifiedFacialExpressionMap(names, "unknown.vrm#vrm:0")).toEqual({});
  });

  it("does not publish a verified target that is absent from the loaded mesh", () => {
    expect(buildVerifiedFacialExpressionMap(
      ["6", "10"],
      "/models/avatars/reference-avatar-2.vrm#vrm:0",
    )).toEqual({ browDown: "6", browUp: "10" });
  });

  it("rejects two semantic channels owning the same raw target", () => {
    expect(() => assertUniqueFacialExpressionTargets({ mouthWide: "30", mouthNarrow: "30" }))
      .toThrow(/gán trùng/);
    expect(() => assertUniqueFacialExpressionTargets({ mouthWide: "30", mouthNarrow: "29" }))
      .not.toThrow();
  });
});
