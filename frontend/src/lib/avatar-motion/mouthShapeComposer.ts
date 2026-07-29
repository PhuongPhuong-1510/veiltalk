export interface MouthShapeConfig {
  conflictStart: number;
  conflictFull: number;
  conflictMaximumSuppression: number;
  closeStart: number;
  closeFull: number;
  happyOpenStart: number;
  happyOpenFull: number;
  happyVerticalOpenStart: number;
  happyVerticalOpenFull: number;
}

export const DEFAULT_MOUTH_SHAPE_CONFIG: MouthShapeConfig = {
  conflictStart: .2,
  conflictFull: .8,
  conflictMaximumSuppression: .9,
  closeStart: .2,
  closeFull: .65,
  happyOpenStart: .08,
  happyOpenFull: .28,
  happyVerticalOpenStart: .18,
  happyVerticalOpenFull: .45,
};

export const MOUTH_SHAPE_EXPRESSION_NAMES = [
  "mouthPucker", "mouthFunnel", "mouthPressLeft", "mouthPressRight", "mouthRollUpper",
  "mouthRollLower", "mouthClose", "mouthSmileLeft", "mouthSmileRight", "mouthStretchLeft",
  "mouthStretchRight", "mouthDimpleLeft", "mouthDimpleRight", "happy",
] as const;

export interface MouthShapeDiagnostics {
  closeOrPressStrength: number;
  puckerGroupStrength: number;
  horizontalGroupStrength: number;
  puckerSuppressionWeight: number;
  horizontalSuppressionWeight: number;
  happyOpenWeight: number;
  happyOpenEvidence: number;
  happyOpenSource: "none" | "jaw" | "upper-lip" | "lower-lip";
  happyCloseWeight: number;
  outputHappy: number;
  happySuppressionReason: "none" | "mouth-closed" | "close-or-press" | "no-smile";
}

const clamp01 = (value: number | undefined): number => Math.min(1, Math.max(0, Number.isFinite(value) ? value! : 0));
const smoothstep = (start: number, end: number, value: number): number => {
  const x = clamp01((value - start) / Math.max(1e-6, end - start));
  return x * x * (3 - 2 * x);
};
const maximum = (values: Record<string, number>, names: readonly string[]): number => Math.max(0, ...names.map((name) => clamp01(values[name])));

export class MouthShapeComposer {
  private diagnostics: MouthShapeDiagnostics | null = null;
  private readonly config: MouthShapeConfig;
  constructor(config: MouthShapeConfig = DEFAULT_MOUTH_SHAPE_CONFIG) { this.config = config; }

  compose(values: Readonly<Record<string, number>>): Record<string, number> {
    const output = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, clamp01(value)]));
    const close = maximum(output, ["mouthClose", "mouthPressLeft", "mouthPressRight", "mouthRollUpper", "mouthRollLower"]);
    const pucker = maximum(output, ["mouthPucker", "mouthFunnel"]);
    const horizontal = maximum(output, ["mouthSmileLeft", "mouthSmileRight", "mouthStretchLeft", "mouthStretchRight", "mouthDimpleLeft", "mouthDimpleRight"]);
    const puckerWins = pucker >= horizontal;
    const puckerConflict = puckerWins ? smoothstep(this.config.conflictStart, this.config.conflictFull, pucker) * this.config.conflictMaximumSuppression : 0;
    const horizontalConflict = puckerWins ? 0 : smoothstep(this.config.conflictStart, this.config.conflictFull, horizontal) * this.config.conflictMaximumSuppression;

    for (const name of ["mouthPucker", "mouthFunnel"]) output[name] = clamp01(output[name]) * (1 - horizontalConflict);
    for (const name of ["mouthSmileLeft", "mouthSmileRight", "mouthStretchLeft", "mouthStretchRight", "mouthDimpleLeft", "mouthDimpleRight"]) output[name] = clamp01(output[name]) * (1 - puckerConflict);

    const smile = (clamp01(values.mouthSmileLeft) + clamp01(values.mouthSmileRight)) / 2;
    const jawEvidence = clamp01(values.jawOpen);
    const upperEvidence = (clamp01(values.mouthUpperUpLeft) + clamp01(values.mouthUpperUpRight)) / 2;
    const lowerEvidence = (clamp01(values.mouthLowerDownLeft) + clamp01(values.mouthLowerDownRight)) / 2;
    const jawOpenWeight = smoothstep(this.config.happyOpenStart, this.config.happyOpenFull, jawEvidence);
    const upperOpenWeight = smoothstep(this.config.happyVerticalOpenStart, this.config.happyVerticalOpenFull, upperEvidence);
    const lowerOpenWeight = smoothstep(this.config.happyVerticalOpenStart, this.config.happyVerticalOpenFull, lowerEvidence);
    const openWeight = Math.max(jawOpenWeight, upperOpenWeight, lowerOpenWeight);
    const openSource: MouthShapeDiagnostics["happyOpenSource"] = openWeight === 0 ? "none"
      : openWeight === jawOpenWeight ? "jaw" : openWeight === upperOpenWeight ? "upper-lip" : "lower-lip";
    const openEvidence = Math.max(jawEvidence, upperEvidence, lowerEvidence);
    const closeWeight = smoothstep(this.config.closeStart, this.config.closeFull, close);
    output.happy = clamp01(smile * openWeight * (1 - closeWeight));
    output.aa = clamp01(values.aa ?? values.jawOpen);
    output.jawOpen = clamp01(values.jawOpen);

    this.diagnostics = {
      closeOrPressStrength: close, puckerGroupStrength: pucker, horizontalGroupStrength: horizontal,
      puckerSuppressionWeight: horizontalConflict, horizontalSuppressionWeight: puckerConflict,
      happyOpenWeight: openWeight, happyOpenEvidence: openEvidence, happyOpenSource: openSource,
      happyCloseWeight: closeWeight, outputHappy: output.happy,
      happySuppressionReason: smile <= 0 ? "no-smile" : closeWeight > 0 ? "close-or-press" : openWeight < 1 ? "mouth-closed" : "none",
    };
    return output;
  }

  snapshot(): MouthShapeDiagnostics | null { return this.diagnostics ? { ...this.diagnostics } : null; }
  reset(): void { this.diagnostics = null; }
}
