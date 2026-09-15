import { clamp01 } from "./coordinateAdapter";

export interface EyeBrowExpressionConfig {
  blinkEnter: number;
  blinkExit: number;
  unilateralConfirmMs: number;
  browEmotionFallbackGain: number;
  browInputOnset: number;
  browInputFull: number;
}

export interface EyeBrowExpressionSnapshot {
  blinkLeft: number;
  blinkRight: number;
  leftClosed: boolean;
  rightClosed: boolean;
  unilateralCandidate: "left" | "right" | null;
  browDown: number;
  browUp: number;
  eyeWide: number;
}

interface EyeTemporalState { closed: boolean; unilateralCandidateSinceMs: number | null }

const initialEyeState = (): EyeTemporalState => ({ closed: false, unilateralCandidateSinceMs: null });
const average = (left: number, right: number) => (left + right) / 2;
const remapActivation = (value: number, onset: number, full: number) => clamp01((value - onset) / Math.max(1e-4, full - onset));

/**
 * F2 eye/brow temporal layer. Blink hai mắt đi ngay; blink một mắt phải tồn tại đủ lâu để loại spike
 * detector một-frame nhưng vẫn giữ được wink chủ động. Các kênh trái/phải luôn được giữ riêng.
 */
export class EyeBrowExpressionProcessor {
  private readonly eyes = { left: initialEyeState(), right: initialEyeState() };
  private lastSnapshot: EyeBrowExpressionSnapshot = {
    blinkLeft: 0, blinkRight: 0, leftClosed: false, rightClosed: false,
    unilateralCandidate: null, browDown: 0, browUp: 0, eyeWide: 0,
  };
  private readonly config: EyeBrowExpressionConfig;

  constructor(config: EyeBrowExpressionConfig) { this.config = config; }

  process(input: Readonly<Record<string, number>>, sampledAtMs: number): Record<string, number> {
    const rawLeft = clamp01(input.eyeBlinkLeft ?? 0);
    const rawRight = clamp01(input.eyeBlinkRight ?? 0);
    const leftSquint = clamp01(input.eyeSquintLeft ?? 0);
    const rightSquint = clamp01(input.eyeSquintRight ?? 0);
    const bilateral = rawLeft >= this.config.blinkEnter && rawRight >= this.config.blinkEnter;

    const blinkLeft = this.updateEye("left", rawLeft, rawRight, bilateral, sampledAtMs);
    const blinkRight = this.updateEye("right", rawRight, rawLeft, bilateral, sampledAtMs);
    // Squint and blink are independent evidence. Promoting squint into blink couples
    // lip presses (m/b/p often spike MediaPipe squint) to eyelid closure.
    const visibleBlinkLeft = blinkLeft;
    const visibleBlinkRight = blinkRight;

    const browDownLeft = clamp01(input.browDownLeft ?? 0);
    const browDownRight = clamp01(input.browDownRight ?? 0);
    const browInnerUp = clamp01(input.browInnerUp ?? 0);
    const browOuterUpLeft = clamp01(input.browOuterUpLeft ?? 0);
    const browOuterUpRight = clamp01(input.browOuterUpRight ?? 0);
    const eyeWideLeft = clamp01(input.eyeWideLeft ?? 0);
    const eyeWideRight = clamp01(input.eyeWideRight ?? 0);
    const browDown = clamp01(remapActivation(Math.max(browDownLeft, browDownRight), this.config.browInputOnset, this.config.browInputFull) * this.config.browEmotionFallbackGain);
    const browUp = clamp01(remapActivation(Math.max(
      browInnerUp,
      average(browOuterUpLeft, browOuterUpRight),
    ), this.config.browInputOnset, this.config.browInputFull) * this.config.browEmotionFallbackGain);
    const eyeWide = Math.max(eyeWideLeft, eyeWideRight);

    this.lastSnapshot = {
      blinkLeft: visibleBlinkLeft,
      blinkRight: visibleBlinkRight,
      leftClosed: this.eyes.left.closed,
      rightClosed: this.eyes.right.closed,
      unilateralCandidate: this.eyes.left.unilateralCandidateSinceMs !== null ? "left" : this.eyes.right.unilateralCandidateSinceMs !== null ? "right" : null,
      browDown,
      browUp,
      eyeWide,
    };

    return {
      eyeBlinkLeft: visibleBlinkLeft,
      eyeBlinkRight: visibleBlinkRight,
      blinkLeft: visibleBlinkLeft,
      blinkRight: visibleBlinkRight,
      eyeSquintLeft: leftSquint,
      eyeSquintRight: rightSquint,
      eyeWideLeft,
      eyeWideRight,
      browDownLeft,
      browDownRight,
      browInnerUp,
      browOuterUpLeft,
      browOuterUpRight,
      browDown,
      browUp,
      eyeWide,
    };
  }

  snapshot(): EyeBrowExpressionSnapshot { return { ...this.lastSnapshot }; }

  reset(): void {
    Object.assign(this.eyes.left, initialEyeState());
    Object.assign(this.eyes.right, initialEyeState());
    this.lastSnapshot = { blinkLeft: 0, blinkRight: 0, leftClosed: false, rightClosed: false, unilateralCandidate: null, browDown: 0, browUp: 0, eyeWide: 0 };
  }

  private updateEye(side: "left" | "right", raw: number, oppositeRaw: number, bilateral: boolean, sampledAtMs: number): number {
    const state = this.eyes[side];
    if (state.closed) {
      if (raw <= this.config.blinkExit) state.closed = false;
    } else if (raw >= this.config.blinkEnter) {
      if (bilateral || oppositeRaw >= this.config.blinkExit) {
        state.closed = true;
      } else if (state.unilateralCandidateSinceMs === null) {
        state.unilateralCandidateSinceMs = sampledAtMs;
      } else if (sampledAtMs - state.unilateralCandidateSinceMs >= this.config.unilateralConfirmMs) {
        state.closed = true;
      }
    }
    if (raw < this.config.blinkEnter || state.closed) state.unilateralCandidateSinceMs = null;
    if (!state.closed) return 0;
    return clamp01((raw - this.config.blinkExit) / Math.max(1e-4, this.config.blinkEnter - this.config.blinkExit));
  }
}
