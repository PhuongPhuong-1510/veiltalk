import { clamp01 } from "./coordinateAdapter";

const DIRECT_EXPRESSIONS = [
  "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
  "cheekPuff", "cheekSquintLeft", "cheekSquintRight", "eyeBlinkLeft", "eyeBlinkRight",
  "eyeLookDownLeft", "eyeLookDownRight", "eyeLookInLeft", "eyeLookInRight", "eyeLookOutLeft",
  "eyeLookOutRight", "eyeLookUpLeft", "eyeLookUpRight", "eyeSquintLeft", "eyeSquintRight",
  "eyeWideLeft", "eyeWideRight", "jawForward", "jawLeft", "jawOpen", "jawRight",
  "mouthClose", "mouthDimpleLeft", "mouthDimpleRight", "mouthFrownLeft", "mouthFrownRight",
  "mouthFunnel", "mouthLeft", "mouthLowerDownLeft", "mouthLowerDownRight", "mouthPressLeft",
  "mouthPressRight", "mouthPucker", "mouthRight", "mouthRollLower", "mouthRollUpper",
  "mouthShrugLower", "mouthShrugUpper", "mouthSmileLeft", "mouthSmileRight", "mouthStretchLeft",
  "mouthStretchRight", "mouthUpperUpLeft", "mouthUpperUpRight", "noseSneerLeft", "noseSneerRight",
] as const;

/** Giữ profile semantic tách khỏi tên expression cụ thể của model. */
export const mapMediaPipeExpressions = (input: Record<string, number>): Record<string, number> => {
  const output: Record<string, number> = {};
  for (const name of DIRECT_EXPRESSIONS) if (name in input) output[name] = clamp01(input[name]);
  output.blinkLeft = output.eyeBlinkLeft ?? 0;
  output.blinkRight = output.eyeBlinkRight ?? 0;
  output.happy = clamp01(((output.mouthSmileLeft ?? 0) + (output.mouthSmileRight ?? 0)) / 2);
  output.aa = output.jawOpen ?? 0;
  return output;
};

export const MEDIA_PIPE_SEMANTIC_COUNT = DIRECT_EXPRESSIONS.length;

