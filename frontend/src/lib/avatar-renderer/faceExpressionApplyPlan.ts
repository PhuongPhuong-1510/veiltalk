import type { FaceExpressionSupport } from "./faceExpressionDiagnostics";

export type FaceExpressionTargetType = "vrm-expression" | "raw-morph";

export interface FaceExpressionTarget {
  key: string;
  type: FaceExpressionTargetType;
  name: string;
  physicalTargetIds: string[];
}

export interface FaceExpressionBinding {
  semantic: string;
  support: Exclude<FaceExpressionSupport, "unsupported">;
  target: FaceExpressionTarget;
  modelGain?: number;
  outputMax?: number;
}

export interface FaceExpressionApplyEntry extends FaceExpressionBinding {
  value: number;
}

export interface FaceExpressionApplyPlan {
  entries: FaceExpressionApplyEntry[];
  rejected: Array<{ semantic: string; reason: "physical-target-owned" | "detailed-smile-owned"; owner: string }>;
}

const supportPriority = (support: FaceExpressionBinding["support"]): number => support === "mapped" ? 2 : 1;

/**
 * Tạo kế hoạch áp dụng duy nhất trước renderer. Thứ tự binding là tie-break có chủ đích:
 * semantic chi tiết từ MediaPipe đứng trước alias tổng hợp do capability matrix tạo sau.
 */
export function buildFaceExpressionApplyPlan(
  values: Readonly<Record<string, number>>,
  bindings: readonly FaceExpressionBinding[],
): FaceExpressionApplyPlan {
  const order = new Map(bindings.map((binding, index) => [binding.semantic, index]));
  const detailedSmileOwner = bindings.find((binding) => binding.support === "mapped"
    && (binding.semantic === "mouthSmileLeft" || binding.semantic === "mouthSmileRight")
    && Number.isFinite(values[binding.semantic]));
  const rejected: FaceExpressionApplyPlan["rejected"] = detailedSmileOwner && Number.isFinite(values.happy)
    ? [{ semantic: "happy", reason: "detailed-smile-owned", owner: detailedSmileOwner.semantic }]
    : [];
  const candidates = bindings
    .filter((binding) => Number.isFinite(values[binding.semantic]) && !(binding.semantic === "happy" && detailedSmileOwner))
    .map((binding) => {
      const gain = Number.isFinite(binding.modelGain) ? Math.max(0, binding.modelGain!) : 1;
      const outputMax = Number.isFinite(binding.outputMax) ? Math.max(1, binding.outputMax!) : 1;
      return { ...binding, value: Math.min(outputMax, Math.max(0, values[binding.semantic] * gain)) };
    })
    .sort((a, b) => supportPriority(b.support) - supportPriority(a.support)
      || b.value - a.value
      || (order.get(a.semantic) ?? 0) - (order.get(b.semantic) ?? 0));
  const owners = new Map<string, string>();
  const entries: FaceExpressionApplyEntry[] = [];
  for (const candidate of candidates) {
    const collision = candidate.target.physicalTargetIds.find((id) => owners.has(id));
    if (collision) {
      rejected.push({ semantic: candidate.semantic, reason: "physical-target-owned", owner: owners.get(collision)! });
      continue;
    }
    for (const id of candidate.target.physicalTargetIds) owners.set(id, candidate.semantic);
    entries.push(candidate);
  }
  return { entries, rejected };
}

export function findStaleFaceExpressionTargets(
  previous: ReadonlyMap<string, FaceExpressionTarget>,
  plan: FaceExpressionApplyPlan,
): FaceExpressionTarget[] {
  const currentKeys = new Set(plan.entries.map((entry) => entry.target.key));
  return [...previous.entries()].filter(([key]) => !currentKeys.has(key)).map(([, target]) => target);
}
