import { describe, expect, it } from "vitest";
import { MeshBasicMaterial } from "three";
import { configureAvatarAuraTint, setAvatarAuraTintEnabled } from "./avatarAuraTint";

describe("avatar aura tint", () => {
  it("injects an optional luminance tint while preserving reset", () => {
    const material = new MeshBasicMaterial();
    let originalHookCalled = false;
    material.onBeforeCompile = () => { originalHookCalled = true; };
    material.customProgramCacheKey = () => "original-material";
    configureAvatarAuraTint(material);
    const shader = {
      uniforms: {},
      fragmentShader: "void main() { diffuseColor *= sampledDiffuseColor; }",
    };

    material.onBeforeCompile(shader as never, {} as never);
    expect(originalHookCalled).toBe(true);
    expect(material.customProgramCacheKey()).toBe("original-material|veiltalk-aura-luminance-v1");
    expect(shader.fragmentShader).toContain("avatarAuraLuminance");
    expect(shader.uniforms).toHaveProperty("avatarAuraTintEnabled.value", 0);

    setAvatarAuraTintEnabled(material, true);
    expect(shader.uniforms).toHaveProperty("avatarAuraTintEnabled.value", 1);
    setAvatarAuraTintEnabled(material, false);
    expect(shader.uniforms).toHaveProperty("avatarAuraTintEnabled.value", 0);
  });
});
