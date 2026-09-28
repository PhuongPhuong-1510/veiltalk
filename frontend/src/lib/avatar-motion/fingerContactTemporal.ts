import type {
  FingerContactFeatures,
  FingerContactPairEvidence,
  FingerPairKey,
} from "./fingerContactFeatures";
import { FINGER_TIP_PAIRS } from "./fingerContactFeatures";

export interface FingerContactTemporalConfig {
  /** A pair must be this close before an inactive contact can enter. */
  enterDistance: number;
  /** Active contact is allowed to remain until this wider distance. */
  releaseDistance: number;
  /** Brief observation loss is tolerated for this long. */
  occlusionHoldMs: number;
  /** Contact strength smoothing time constant approximation. */
  strengthBlendMs: number;
}

export const DEFAULT_FINGER_CONTACT_TEMPORAL_CONFIG: FingerContactTemporalConfig = {
  enterDistance: 0.13,
  releaseDistance: 0.22,
  occlusionHoldMs: 110,
  strengthBlendMs: 55,
};

export interface FingerContactPairState {
  active: boolean;
  strength: number;
  enteredAtMs: number | null;
  lastObservedAtMs: number | null;
  lastSampledAtMs: number | null;
  previousDistance: number | null;
  approaching: boolean;
  separating: boolean;
}

export type FingerContactTemporalSnapshot = Record<FingerPairKey, FingerContactPairState>;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smoothstep = (value: number): number => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

function createPairState(): FingerContactPairState {
  return {
    active: false,
    strength: 0,
    enteredAtMs: null,
    lastObservedAtMs: null,
    lastSampledAtMs: null,
    previousDistance: null,
    approaching: false,
    separating: false,
  };
}

function createSnapshot(): FingerContactTemporalSnapshot {
  return Object.fromEntries(FINGER_TIP_PAIRS.map(([key]) => [key, createPairState()])) as FingerContactTemporalSnapshot;
}

function targetStrength(
  pair: FingerContactPairEvidence,
  active: boolean,
  config: FingerContactTemporalConfig,
): number {
  if (!pair.valid) return 0;
  const outer = active ? config.releaseDistance : config.enterDistance;
  const inner = Math.min(config.enterDistance, outer) * 0.65;
  const span = Math.max(1e-6, outer - inner);
  return 1 - smoothstep((pair.normalizedDistance - inner) / span);
}

export class FingerContactTemporal {
  private state: FingerContactTemporalSnapshot = createSnapshot();

  reset(): void {
    this.state = createSnapshot();
  }

  update(
    features: FingerContactFeatures | null,
    sampledAtMs: number | null,
    nowMs: number,
    config: FingerContactTemporalConfig = DEFAULT_FINGER_CONTACT_TEMPORAL_CONFIG,
  ): FingerContactTemporalSnapshot {
    for (const [key] of FINGER_TIP_PAIRS) {
      const previous = this.state[key];
      const pair = features?.pairs[key] ?? null;
      const hasNewSample = sampledAtMs !== null && sampledAtMs > (previous.lastSampledAtMs ?? -Infinity);

      let active = previous.active;
      let enteredAtMs = previous.enteredAtMs;
      let lastObservedAtMs = previous.lastObservedAtMs;
      let lastSampledAtMs = previous.lastSampledAtMs;
      let previousDistance = previous.previousDistance;
      let approaching = false;
      let separating = false;
      let desiredStrength = previous.strength;

      if (hasNewSample) {
        lastSampledAtMs = sampledAtMs;
        if (pair?.valid) {
          const distance = pair.normalizedDistance;
          if (previousDistance !== null) {
            const delta = distance - previousDistance;
            approaching = delta < -0.004;
            separating = delta > 0.004;
          }
          previousDistance = distance;
          lastObservedAtMs = sampledAtMs;

          if (!active && distance <= config.enterDistance) {
            active = true;
            enteredAtMs = sampledAtMs;
          } else if (active && distance >= config.releaseDistance) {
            active = false;
            enteredAtMs = null;
          }

          desiredStrength = targetStrength(pair, active, config);
        }
      } else if (active) {
        const observationAge = lastObservedAtMs === null ? Infinity : nowMs - lastObservedAtMs;
        if (observationAge > config.occlusionHoldMs) {
          active = false;
          enteredAtMs = null;
          desiredStrength = 0;
        }
      }

      if (!active && (!pair?.valid || (pair.normalizedDistance >= config.releaseDistance))) {
        desiredStrength = 0;
      }

      const elapsed = previous.lastSampledAtMs === null
        ? config.strengthBlendMs
        : Math.max(0, (sampledAtMs ?? nowMs) - previous.lastSampledAtMs);
      const blend = config.strengthBlendMs <= 0 ? 1 : clamp01(elapsed / config.strengthBlendMs);
      const strength = previous.strength + (desiredStrength - previous.strength) * blend;

      this.state[key] = {
        active,
        strength: clamp01(strength),
        enteredAtMs,
        lastObservedAtMs,
        lastSampledAtMs,
        previousDistance,
        approaching,
        separating,
      };
    }

    return this.snapshot();
  }

  snapshot(): FingerContactTemporalSnapshot {
    return Object.fromEntries(
      FINGER_TIP_PAIRS.map(([key]) => [key, { ...this.state[key] }]),
    ) as FingerContactTemporalSnapshot;
  }
}
