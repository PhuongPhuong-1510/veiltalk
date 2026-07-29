import { clamp01 } from "./coordinateAdapter";

export interface BrowCheekExpressionConfig {
  puffDeadZone: number;
  puffEnter: number;
  puffExit: number;
  puffAttackMs: number;
  puffReleaseMs: number;
  speechSuppressionStart: number;
  speechSuppressionFull: number;
  strongPuffBypassStart: number;
  strongPuffBypassFull: number;
}

export const DEFAULT_BROW_CHEEK_EXPRESSION_CONFIG: BrowCheekExpressionConfig = {
  puffDeadZone: .08,
  puffEnter: .2,
  puffExit: .06,
  puffAttackMs: 36,
  puffReleaseMs: 90,
  speechSuppressionStart: .15,
  speechSuppressionFull: .55,
  strongPuffBypassStart: .55,
  strongPuffBypassFull: .8,
};

export const BROW_CHEEK_EXPRESSION_NAMES = [
  "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
  "mouthFrownLeft", "mouthFrownRight", "cheekPuff",
] as const;

export interface BrowCheekExpressionDiagnostics {
  rawPuff: number;
  deadZonePuff: number;
  speechEvidence: number;
  speechSuppression: number;
  strongPuffBypass: number;
  puffLatched: boolean;
  targetPuff: number;
  outputPuff: number;
}

const smoothstep = (start: number, end: number, value: number): number => {
  const t = clamp01((value - start) / Math.max(1e-6, end - start));
  return t * t * (3 - 2 * t);
};

export class BrowCheekExpressionProcessor {
  private readonly config: BrowCheekExpressionConfig;
  private puffLatched = false;
  private outputPuff = 0;
  private lastAtMs: number | null = null;
  private diagnostics: BrowCheekExpressionDiagnostics | null = null;

  constructor(config: BrowCheekExpressionConfig = DEFAULT_BROW_CHEEK_EXPRESSION_CONFIG) { this.config = config; }

  process(values: Readonly<Record<string, number>>, atMs: number): Record<string, number> {
    const output = { ...values };
    for (const name of BROW_CHEEK_EXPRESSION_NAMES) if (name !== "cheekPuff" && name in output) output[name] = clamp01(output[name]);
    const rawPuff = clamp01(values.cheekPuff);
    const deadZonePuff = smoothstep(this.config.puffDeadZone, 1, rawPuff);
    if (this.puffLatched ? deadZonePuff <= this.config.puffExit : deadZonePuff >= this.config.puffEnter) this.puffLatched = !this.puffLatched;
    const speechEvidence = Math.max(clamp01(values.jawOpen), clamp01(values.aa), clamp01(values.mouthLowerDownLeft), clamp01(values.mouthLowerDownRight));
    const speechSuppression = smoothstep(this.config.speechSuppressionStart, this.config.speechSuppressionFull, speechEvidence);
    const strongPuffBypass = smoothstep(this.config.strongPuffBypassStart, this.config.strongPuffBypassFull, rawPuff);
    const targetPuff = this.puffLatched ? deadZonePuff * (1 - speechSuppression * (1 - strongPuffBypass)) : 0;
    const elapsed = this.lastAtMs === null || !Number.isFinite(atMs) || atMs < this.lastAtMs ? Infinity : atMs - this.lastAtMs;
    const timeConstant = targetPuff > this.outputPuff ? this.config.puffAttackMs : this.config.puffReleaseMs;
    const alpha = elapsed === Infinity ? 1 : 1 - Math.exp(-elapsed / Math.max(1, timeConstant));
    this.outputPuff += (targetPuff - this.outputPuff) * alpha;
    if (Math.abs(this.outputPuff) < 1e-4) this.outputPuff = 0;
    output.cheekPuff = clamp01(this.outputPuff);
    this.lastAtMs = Number.isFinite(atMs) ? atMs : this.lastAtMs;
    this.diagnostics = { rawPuff, deadZonePuff, speechEvidence, speechSuppression, strongPuffBypass, puffLatched: this.puffLatched, targetPuff, outputPuff: output.cheekPuff };
    return output;
  }

  snapshot(): BrowCheekExpressionDiagnostics | null { return this.diagnostics ? { ...this.diagnostics } : null; }
  reset(): void { this.puffLatched = false; this.outputPuff = 0; this.lastAtMs = null; this.diagnostics = null; }
}
