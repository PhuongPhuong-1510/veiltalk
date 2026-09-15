import { describe, expect, it } from "vitest";
import type { VRM } from "@pixiv/three-vrm";
import { buildFacialCapabilityManifest, clampFacialPreviewWeight } from "./facialCapability";

function vrmStub(options: {
  expressions?: Record<string, number>;
  lookAt?: boolean;
  eyeBones?: readonly ("leftEye" | "rightEye")[];
} = {}): VRM {
  const eyeBones = new Set(options.eyeBones ?? []);
  return {
    meta: { metaVersion: "1" },
    expressionManager: {
      expressionMap: Object.fromEntries(Object.entries(options.expressions ?? {}).map(([name, bindCount]) => [name, { binds: Array.from({ length: bindCount }, () => ({})) }])),
    },
    humanoid: { getNormalizedBoneNode: (name: string) => eyeBones.has(name as "leftEye" | "rightEye") ? {} : null },
    lookAt: options.lookAt ? {} : null,
  } as unknown as VRM;
}

describe("facial capability manifest", () => {
  it("distinguishes a bound VRM expression from a same-name zero-bind expression", () => {
    const manifest = buildFacialCapabilityManifest(vrmStub({ expressions: { aa: 2, blinkLeft: 0 } }), new Map(), "avatar#1");
    expect(manifest.standard.aa).toMatchObject({ status: "bound", expressionName: "aa", bindCount: 2, productionReady: true });
    expect(manifest.standard.blinkLeft).toMatchObject({ status: "zero-bind", expressionName: "blinkLeft", bindCount: 0, productionReady: false });
    expect(manifest.warnings[0]).toContain("blinkLeft");
  });

  it("reports raw aliases as DEV candidates without promoting them to production", () => {
    const morphs = new Map<string, unknown>([["Fcl_MTH_Close", {}], ["Fcl_MTH_Large", {}], ["jawLeft", {}], ["unrelated", {}]]);
    const manifest = buildFacialCapabilityManifest(vrmStub(), morphs, "avatar#raw");
    expect(manifest.advanced.mouthClose).toMatchObject({ status: "raw-candidate", productionReady: false, rawMorphCandidates: ["Fcl_MTH_Close"] });
    expect(manifest.advanced.mouthWide.rawMorphCandidates).toEqual(["Fcl_MTH_Large"]);
    expect(manifest.advanced.jawLeft.rawMorphCandidates).toEqual(["jawLeft"]);
    expect(manifest.advanced.mouthFunnel.status).toBe("unsupported");
    expect(manifest.rawMorphTargets).toEqual(["Fcl_MTH_Close", "Fcl_MTH_Large", "jawLeft", "unrelated"]);
  });

  it("reports look-at and eye-bone capability independently", () => {
    const gaze = { kind: "vrm-look-at-expression" as const, yawLeftLimit: 30, yawRightLimit: 30, pitchUpLimit: 20, pitchDownLimit: 15, handlesVerticalEyelid: true };
    const manifest = buildFacialCapabilityManifest(vrmStub({ lookAt: true, eyeBones: ["leftEye"] }), new Map(), "avatar#eyes", gaze);
    expect(manifest.lookAt).toEqual({ supported: true, leftEyeBone: true, rightEyeBone: false });
    expect(manifest.gaze).toEqual(gaze);
  });

  it("returns immutable plain manifest data and clamps preview values", () => {
    const manifest = buildFacialCapabilityManifest(null, new Map([["Blink", {}]]), "avatar#none");
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.standard)).toBe(true);
    expect(Object.isFrozen(manifest.standard.blink.rawMorphCandidates)).toBe(true);
    expect(JSON.parse(JSON.stringify(manifest)).modelFingerprint).toBe("avatar#none");
    expect(clampFacialPreviewWeight(-2)).toBe(0);
    expect(clampFacialPreviewWeight(.65)).toBe(.65);
    expect(clampFacialPreviewWeight(3)).toBe(1);
    expect(clampFacialPreviewWeight(Number.NaN)).toBe(0);
  });
});
