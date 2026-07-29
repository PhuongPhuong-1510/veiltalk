export type GazeControllerMode = "vrm-look-at" | "eye-morph" | "eye-bones" | "unsupported";
export interface GazeCapability { mode: GazeControllerMode; reason: string }
const MORPH_NAMES = ["lookLeft", "lookRight", "lookUp", "lookDown", "eyeLookInLeft", "eyeLookInRight", "eyeLookOutLeft", "eyeLookOutRight"];
export function selectGazeCapability(input: { hasVrmLookAt: boolean; expressions: readonly string[]; hasLeftEyeBone: boolean; hasRightEyeBone: boolean }): GazeCapability {
  if (input.hasVrmLookAt) return { mode: "vrm-look-at", reason: "vrm-look-at" };
  if (MORPH_NAMES.some((name) => input.expressions.includes(name))) return { mode: "eye-morph", reason: "declared-eye-expression" };
  if (input.hasLeftEyeBone && input.hasRightEyeBone) return { mode: "eye-bones", reason: "humanoid-eye-bones" };
  return { mode: "unsupported", reason: "no-gaze-controller" };
}
