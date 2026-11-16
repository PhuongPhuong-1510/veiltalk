import type { Material } from "three";

interface AuraTintState {
  enabled: number;
  uniform: { value: number } | null;
}

const STATE_KEY = "veiltalkAuraTint";

export function configureAvatarAuraTint(material: Material): void {
  if (material.userData[STATE_KEY]) return;

  const state: AuraTintState = { enabled: 0, uniform: null };
  const originalOnBeforeCompile = material.onBeforeCompile.bind(material);
  const originalProgramCacheKey = material.customProgramCacheKey.bind(material);
  material.userData[STATE_KEY] = state;
  material.onBeforeCompile = (shader, renderer) => {
    originalOnBeforeCompile(shader, renderer);
    state.uniform = { value: state.enabled };
    shader.uniforms.avatarAuraTintEnabled = state.uniform;
    shader.fragmentShader = shader.fragmentShader
      .replace("void main() {", "uniform float avatarAuraTintEnabled;\nvoid main() {")
      .replace(
        "diffuseColor *= sampledDiffuseColor;",
        `float avatarAuraLuminance = dot(sampledDiffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, vec3(avatarAuraLuminance), avatarAuraTintEnabled);
        diffuseColor *= sampledDiffuseColor;`,
      );
  };
  material.customProgramCacheKey = () => `${originalProgramCacheKey()}|veiltalk-aura-luminance-v1`;
  material.needsUpdate = true;
}

export function setAvatarAuraTintEnabled(material: Material, enabled: boolean): void {
  configureAvatarAuraTint(material);
  const state = material.userData[STATE_KEY] as AuraTintState;
  state.enabled = enabled ? 1 : 0;
  if (state.uniform) state.uniform.value = state.enabled;
}
