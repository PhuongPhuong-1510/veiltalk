import { STANDARD_FACIAL_CHANNELS } from "./facialCapability";

const STANDARD = new Set<string>(STANDARD_FACIAL_CHANNELS);
const VOWELS = ["aa", "ih", "ou", "ee", "oh"] as const;
const RAW_VERTICAL = ["mouthUpperUp", "mouthLowerDown"] as const;
const RAW_SHAPE = ["mouthWide", "mouthNarrow", "mouthPucker", "mouthFunnel"] as const;
const RAW_SMILE = ["mouthSmileClosed", "mouthSmileOpen", "mouthFrown"] as const;

const clamp01 = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

/**
 * Model-facing expression plan.
 *
 * The processor is intentionally model-independent and can emit more semantic evidence than a
 * particular avatar can render. The old renderer forwarded every semantic directly, which caused
 * two problems on VRoid models:
 *  1) unsupported MediaPipe semantics were treated as if they were render channels;
 *  2) verified raw lip morphs could stack at full strength on top of A/I/U/E/O presets, making
 *     the mouth look rigid/over-constrained.
 *
 * This adapter keeps standard VRM expressions plus explicitly verified/profile-mapped raw morphs,
 * then reduces redundant raw lip deformation while a vowel already owns the mouth shape.
 */
export function retargetFacialExpressions(
  input: Readonly<Record<string, number>>,
  expressionMap: Readonly<Record<string, string>>,
): Record<string, number> {
  const output: Record<string, number> = {};

  for (const [semantic, value] of Object.entries(input)) {
    // Standard VRM expressions can be consumed by ExpressionManager. Non-standard semantics are
    // production-renderable only when the loader verified/profile-mapped them to a raw morph.
    if (!STANDARD.has(semantic) && !(semantic in expressionMap)) continue;
    output[semantic] = clamp01(value);
  }

  const vowelActivity = clamp01(VOWELS.reduce((sum, name) => sum + (output[name] ?? 0), 0));
  if (vowelActivity <= 0) return output;

  // A/I/U/E/O already contain vertical and width/round deformation. Retain only a supporting
  // fraction of raw morphs to avoid pulling the same lip vertices twice.
  const verticalRetention = 1 - 0.65 * vowelActivity;
  const shapeRetention = 1 - 0.55 * vowelActivity;
  const smileRetention = 1 - 0.28 * vowelActivity;

  for (const name of RAW_VERTICAL) if (name in output) output[name] *= verticalRetention;
  for (const name of RAW_SHAPE) if (name in output) output[name] *= shapeRetention;
  // A speaking smile still needs its base expression, so smile is reduced much less than detail.
  for (const name of RAW_SMILE) if (name in output) output[name] *= smileRetention;

  return output;
}
