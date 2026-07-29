export interface EyeExpressionConfig {
  blinkAttackMs: number; blinkReleaseMs: number; blinkEnter: number; blinkExit: number;
  blinkMinimumHoldMs: number; blinkMinimumOutput: number; wideDeadZone: number;
  cheekSquintWeight: number; smileSquintStart: number; smileSquintMaximum: number; maximumDeltaMs: number;
}
export const DEFAULT_EYE_EXPRESSION_CONFIG: EyeExpressionConfig = {
  blinkAttackMs: 16, blinkReleaseMs: 42, blinkEnter: .52, blinkExit: .22,
  blinkMinimumHoldMs: 45, blinkMinimumOutput: .82, wideDeadZone: .06,
  cheekSquintWeight: .8, smileSquintStart: .65, smileSquintMaximum: .22, maximumDeltaMs: 100,
};
export const EYE_EXPRESSION_NAMES = ["eyeBlinkLeft", "eyeBlinkRight", "blinkLeft", "blinkRight", "eyeWideLeft", "eyeWideRight", "eyeSquintLeft", "eyeSquintRight"] as const;
type Side = "Left" | "Right";
interface BlinkState { output: number; latched: boolean; holdUntilMs: number }
export interface EyeExpressionDiagnostics { left: EyeSideDiagnostics; right: EyeSideDiagnostics; dtMs: number }
export interface EyeSideDiagnostics { rawBlink: number; outputBlink: number; latched: boolean; rawWide: number; outputWide: number; rawSquint: number; cheekSquint: number; smileContribution: number; outputSquint: number }
const clamp01 = (v: number | undefined) => Math.min(1, Math.max(0, Number.isFinite(v) ? v! : 0));
const alpha = (dt: number, time: number) => time <= 0 ? 1 : 1 - Math.exp(-dt / time);
const deadZone = (v: number, zone: number) => v <= zone ? 0 : (v - zone) / Math.max(1e-6, 1 - zone);
export class EyeExpressionProcessor {
  private readonly state: Record<Side, BlinkState> = { Left: { output: 0, latched: false, holdUntilMs: 0 }, Right: { output: 0, latched: false, holdUntilMs: 0 } };
  private lastAtMs: number | null = null; private diagnostics: EyeExpressionDiagnostics | null = null;
  private readonly config: EyeExpressionConfig;
  constructor(config: EyeExpressionConfig = DEFAULT_EYE_EXPRESSION_CONFIG) { this.config = config; }
  process(values: Readonly<Record<string, number>>, nowMs: number, tracked = true): Record<string, number> {
    const dt = Math.min(this.config.maximumDeltaMs, Math.max(0, this.lastAtMs === null ? 0 : nowMs - this.lastAtMs)); this.lastAtMs = nowMs;
    const output = { ...values }; const smile = (clamp01(values.mouthSmileLeft) + clamp01(values.mouthSmileRight)) / 2;
    const smileContribution = smile <= this.config.smileSquintStart ? 0 : Math.min(this.config.smileSquintMaximum, (smile - this.config.smileSquintStart) / (1 - this.config.smileSquintStart) * this.config.smileSquintMaximum);
    const sideDiagnostics = {} as Record<Side, EyeSideDiagnostics>;
    for (const side of ["Left", "Right"] as const) {
      const state = this.state[side]; const rawBlink = tracked ? clamp01(values[`eyeBlink${side}`]) : 0;
      if (rawBlink >= this.config.blinkEnter) { state.latched = true; state.holdUntilMs = Math.max(state.holdUntilMs, nowMs + this.config.blinkMinimumHoldMs); }
      else if (rawBlink <= this.config.blinkExit && nowMs >= state.holdUntilMs) state.latched = false;
      const target = state.latched ? Math.max(rawBlink, this.config.blinkMinimumOutput) : rawBlink;
      const time = target > state.output ? this.config.blinkAttackMs : this.config.blinkReleaseMs;
      state.output += (target - state.output) * (dt === 0 ? 1 : alpha(dt, time)); state.output = clamp01(state.output);
      const rawWide = tracked ? clamp01(values[`eyeWide${side}`]) : 0;
      const rawSquint = tracked ? clamp01(values[`eyeSquint${side}`]) : 0;
      const cheekSquint = tracked ? clamp01(values[`cheekSquint${side}`]) : 0;
      const squint = Math.max(rawSquint, cheekSquint * this.config.cheekSquintWeight, smileContribution) * (1 - state.output);
      const wide = deadZone(rawWide, this.config.wideDeadZone) * (1 - state.output);
      output[`eyeBlink${side}`] = state.output; output[`blink${side}`] = state.output;
      output[`eyeWide${side}`] = clamp01(wide); output[`eyeSquint${side}`] = clamp01(squint);
      sideDiagnostics[side] = { rawBlink, outputBlink: state.output, latched: state.latched, rawWide, outputWide: clamp01(wide), rawSquint, cheekSquint, smileContribution, outputSquint: clamp01(squint) };
    }
    this.diagnostics = { left: sideDiagnostics.Left, right: sideDiagnostics.Right, dtMs: dt }; return output;
  }
  snapshot(): EyeExpressionDiagnostics | null { return this.diagnostics ? structuredClone(this.diagnostics) : null; }
  reset(): void { for (const state of Object.values(this.state)) { state.output = 0; state.latched = false; state.holdUntilMs = 0; } this.lastAtMs = null; this.diagnostics = null; }
}
