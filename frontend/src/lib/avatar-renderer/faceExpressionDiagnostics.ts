import { DERIVED_FACE_EXPRESSION_NAMES, MEDIA_PIPE_FACE_EXPRESSION_NAMES } from "../avatar-motion/expressionMapper";

export type FaceExpressionSupport = "mapped" | "fallback" | "unsupported";

export interface FaceExpressionCapabilityRow {
  semantic: string;
  support: FaceExpressionSupport;
  modelExpression: string | null;
  reason: string;
  targetType?: "vrm-expression" | "raw-morph";
  physicalTargetIds?: string[];
}

export interface FaceExpressionRenderRow extends FaceExpressionCapabilityRow {
  rawValue: number | null;
  processedValue: number | null;
  renderedValue: number | null;
}

const FALLBACKS: Readonly<Record<string, readonly string[]>> = {
  eyeBlinkLeft: ["blinkLeft", "blink"],
  eyeBlinkRight: ["blinkRight", "blink"],
  mouthSmileLeft: ["happy"],
  mouthSmileRight: ["happy"],
  browDownLeft: ["Fcl_BRW_Angry", "angry"],
  browDownRight: ["Fcl_BRW_Angry", "angry"],
  browInnerUp: ["Fcl_BRW_Surprised", "surprised", "Fcl_BRW_Sorrow", "sad"],
  browOuterUpLeft: ["Fcl_BRW_Surprised", "surprised"],
  browOuterUpRight: ["Fcl_BRW_Surprised", "surprised"],
  mouthFrownLeft: ["Fcl_MTH_Sorrow", "sad"],
  mouthFrownRight: ["Fcl_MTH_Sorrow", "sad"],
  jawOpen: ["aa"],
  mouthPucker: ["ou"],
  mouthFunnel: ["oh", "ou"],
  eyeLookOutLeft: ["lookLeft"], eyeLookInRight: ["lookLeft"],
  eyeLookInLeft: ["lookRight"], eyeLookOutRight: ["lookRight"],
  eyeLookUpLeft: ["lookUp"], eyeLookUpRight: ["lookUp"],
  eyeLookDownLeft: ["lookDown"], eyeLookDownRight: ["lookDown"],
};

export function resolveFaceExpression(
  semantic: string,
  availableExpressions: ReadonlySet<string>,
  explicitMap: Readonly<Record<string, string>> = {},
): FaceExpressionCapabilityRow {
  const explicit = explicitMap[semantic];
  if (explicit) {
    if (availableExpressions.has(explicit)) return { semantic, support: "mapped", modelExpression: explicit, reason: "explicit-profile" };
    return { semantic, support: "unsupported", modelExpression: null, reason: `explicit-target-missing:${explicit}` };
  }
  if (availableExpressions.has(semantic)) return { semantic, support: "mapped", modelExpression: semantic, reason: "same-name" };
  const fallback = FALLBACKS[semantic]?.find((name) => availableExpressions.has(name));
  if (fallback) return { semantic, support: "fallback", modelExpression: fallback, reason: `declared-fallback:${fallback}` };
  return { semantic, support: "unsupported", modelExpression: null, reason: "no-declared-target" };
}

export function buildFaceExpressionCapabilityMatrix(
  availableExpressions: readonly string[],
  explicitMap: Readonly<Record<string, string>> = {},
): FaceExpressionCapabilityRow[] {
  const available = new Set(availableExpressions);
  return [...MEDIA_PIPE_FACE_EXPRESSION_NAMES, ...DERIVED_FACE_EXPRESSION_NAMES]
    .map((semantic) => resolveFaceExpression(semantic, available, explicitMap));
}

export function buildFaceExpressionRenderRows(
  capability: readonly FaceExpressionCapabilityRow[],
  raw: Readonly<Record<string, number>> | null,
  processed: Readonly<Record<string, number>> | null,
  rendered: Readonly<Record<string, number>> | null,
): FaceExpressionRenderRow[] {
  return capability.map((row) => ({
    ...row,
    rawValue: raw?.[row.semantic] ?? null,
    processedValue: processed?.[row.semantic] ?? null,
    renderedValue: rendered?.[row.semantic] ?? null,
  }));
}
