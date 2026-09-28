import type { BimanualHandFeatures } from "./bimanualHandFeatures";
import type { BimanualGestureEvidence } from "./bimanualGestureEvidence";
import { EMPTY_BIMANUAL_GESTURE_EVIDENCE } from "./bimanualGestureEvidence";

export type BimanualInteractionMode = "none" | "heart" | "palmsTogether" | "clasp" | "interlace";

export interface BimanualTemporalConfig {
  enterThreshold: number;
  releaseThreshold: number;
  enterConfirmMs: number;
  releaseConfirmMs: number;
  /** Render/detector gap below this is normal cadence, not occlusion. */
  unsampledGraceMs: number;
  occlusionGraceMs: number;
  confidenceAttackMs: number;
  confidenceReleaseMs: number;
}

export const DEFAULT_BIMANUAL_TEMPORAL_CONFIG: BimanualTemporalConfig = {
  enterThreshold: 0.62,
  releaseThreshold: 0.34,
  enterConfirmMs: 90,
  releaseConfirmMs: 150,
  unsampledGraceMs: 100,
  occlusionGraceMs: 280,
  confidenceAttackMs: 80,
  confidenceReleaseMs: 220,
};

export interface BimanualTemporalSnapshot {
  mode: BimanualInteractionMode;
  confidence: number;
  occluded: boolean;
  lastObservedAtMs: number | null;
  lastSampledAtMs: number | null;
  modeSinceMs: number | null;
  evidence: BimanualGestureEvidence;
  features: BimanualHandFeatures | null;
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function winner(evidence: BimanualGestureEvidence): { mode: Exclude<BimanualInteractionMode, "none">; score: number } {
  // Interlace is more specific than clasp; heart and palmsTogether have distinct orientation gates.
  const values: Array<{ mode: Exclude<BimanualInteractionMode, "none">; score: number }> = [
    { mode: "interlace", score: evidence.interlace },
    { mode: "heart", score: evidence.heart },
    { mode: "palmsTogether", score: evidence.palmsTogether },
    { mode: "clasp", score: evidence.clasp },
  ];
  return values.reduce((best, value) => value.score > best.score ? value : best, values[0]);
}

export class BimanualHandTemporal {
  private snapshotState: BimanualTemporalSnapshot = {
    mode: "none",
    confidence: 0,
    occluded: false,
    lastObservedAtMs: null,
    lastSampledAtMs: null,
    modeSinceMs: null,
    evidence: { ...EMPTY_BIMANUAL_GESTURE_EVIDENCE },
    features: null,
  };
  private pendingMode: Exclude<BimanualInteractionMode, "none"> | null = null;
  private pendingSinceMs: number | null = null;
  private releaseSinceMs: number | null = null;

  reset(): void {
    this.snapshotState = {
      mode: "none", confidence: 0, occluded: false,
      lastObservedAtMs: null, lastSampledAtMs: null, modeSinceMs: null,
      evidence: { ...EMPTY_BIMANUAL_GESTURE_EVIDENCE }, features: null,
    };
    this.pendingMode = null;
    this.pendingSinceMs = null;
    this.releaseSinceMs = null;
  }

  update(
    features: BimanualHandFeatures | null,
    evidence: BimanualGestureEvidence,
    sampledAtMs: number | null,
    nowMs: number,
    config: BimanualTemporalConfig = DEFAULT_BIMANUAL_TEMPORAL_CONFIG,
  ): BimanualTemporalSnapshot {
    const previous = this.snapshotState;
    const isNewSample = sampledAtMs !== null && (previous.lastSampledAtMs === null || sampledAtMs > previous.lastSampledAtMs);
    let mode = previous.mode;
    let modeSinceMs = previous.modeSinceMs;
    let lastObservedAtMs = previous.lastObservedAtMs;
    let lastSampledAtMs = previous.lastSampledAtMs;
    let storedFeatures = previous.features;
    let storedEvidence = previous.evidence;
    let occluded = false;

    if (isNewSample) {
      lastSampledAtMs = sampledAtMs;
      if (features?.valid) {
        lastObservedAtMs = sampledAtMs;
        storedFeatures = features;
        storedEvidence = { ...evidence };
        const best = winner(evidence);

        if (mode === "none") {
          if (best.score >= config.enterThreshold) {
            if (this.pendingMode !== best.mode) {
              this.pendingMode = best.mode;
              this.pendingSinceMs = sampledAtMs;
            }
            if (sampledAtMs - (this.pendingSinceMs ?? sampledAtMs) >= config.enterConfirmMs) {
              mode = best.mode;
              modeSinceMs = sampledAtMs;
              this.pendingMode = null;
              this.pendingSinceMs = null;
            }
          } else {
            this.pendingMode = null;
            this.pendingSinceMs = null;
          }
        } else {
          const currentScore = evidence[mode];
          if (best.mode !== mode && best.score >= config.enterThreshold + 0.10 && best.score >= currentScore + 0.18) {
            if (this.pendingMode !== best.mode) {
              this.pendingMode = best.mode;
              this.pendingSinceMs = sampledAtMs;
            }
            if (sampledAtMs - (this.pendingSinceMs ?? sampledAtMs) >= config.enterConfirmMs) {
              mode = best.mode;
              modeSinceMs = sampledAtMs;
              this.releaseSinceMs = null;
              this.pendingMode = null;
              this.pendingSinceMs = null;
            }
          } else {
            this.pendingMode = null;
            this.pendingSinceMs = null;
          }

          const updatedScore = evidence[mode];
          if (updatedScore < config.releaseThreshold) {
            this.releaseSinceMs ??= sampledAtMs;
            if (sampledAtMs - this.releaseSinceMs >= config.releaseConfirmMs) {
              mode = "none";
              modeSinceMs = sampledAtMs;
              this.releaseSinceMs = null;
            }
          } else {
            this.releaseSinceMs = null;
          }
        }
      } else if (mode !== "none") {
        const age = lastObservedAtMs === null ? Infinity : nowMs - lastObservedAtMs;
        occluded = age <= config.occlusionGraceMs;
        if (!occluded) {
          mode = "none";
          modeSinceMs = nowMs;
          this.pendingMode = null;
          this.pendingSinceMs = null;
          this.releaseSinceMs = null;
        }
      }
    } else if (mode !== "none") {
      const age = lastObservedAtMs === null ? Infinity : nowMs - lastObservedAtMs;
      // Do not call ordinary Hand-Landmarker cadence an occlusion. Only start contact hold after
      // the expected unsampled gap; this avoids freezing fingers between normal detector ticks.
      occluded = age > config.unsampledGraceMs && age <= config.occlusionGraceMs;
      if (age > config.occlusionGraceMs) {
        mode = "none";
        modeSinceMs = nowMs;
      }
    }

    const targetConfidence = mode === "none" ? 0 : occluded
      ? Math.max(0, 1 - (lastObservedAtMs === null ? config.occlusionGraceMs : nowMs - lastObservedAtMs) / config.occlusionGraceMs) * previous.confidence
      : storedEvidence[mode];
    const elapsed = previous.lastSampledAtMs === null
      ? config.confidenceAttackMs
      : Math.max(0, (sampledAtMs ?? nowMs) - previous.lastSampledAtMs);
    const duration = targetConfidence > previous.confidence ? config.confidenceAttackMs : config.confidenceReleaseMs;
    const blend = duration <= 0 ? 1 : clamp01(elapsed / duration);
    const confidence = previous.confidence + (targetConfidence - previous.confidence) * blend;

    this.snapshotState = {
      mode,
      confidence: clamp01(confidence),
      occluded,
      lastObservedAtMs,
      lastSampledAtMs,
      modeSinceMs,
      evidence: storedEvidence,
      features: storedFeatures,
    };
    return this.snapshot();
  }

  snapshot(): BimanualTemporalSnapshot {
    return structuredClone(this.snapshotState);
  }
}
