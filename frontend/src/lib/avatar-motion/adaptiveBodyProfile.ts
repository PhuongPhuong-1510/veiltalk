export interface RobustMeasurementState {
  samples: number[];
  value: number | null;
  medianAbsoluteDeviation: number | null;
  acceptedSamples: number;
  rejectedSamples: number;
  confidence: number;
}

export interface RobustMeasurementConfig {
  minimumSamples: number;
  windowSamples: number;
  outlierSigma: number;
  minimumRelativeTolerance: number;
}

export interface RobustMeasurementUpdate {
  accepted: boolean;
  reason: "accepted" | "non-finite" | "non-positive" | "outlier";
  state: RobustMeasurementState;
}

export const createRobustMeasurementState = (): RobustMeasurementState => ({
  samples: [], value: null, medianAbsoluteDeviation: null,
  acceptedSamples: 0, rejectedSamples: 0, confidence: 0,
});

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * Passive body measurement with a rolling median and MAD outlier gate. The relative
 * tolerance is deliberately retained when MAD collapses near zero, otherwise one
 * repeated pose would make the profile reject every later legitimate observation.
 */
export function updateRobustMeasurement(
  state: RobustMeasurementState,
  sample: number,
  config: RobustMeasurementConfig,
): RobustMeasurementUpdate {
  if (!Number.isFinite(sample)) {
    state.rejectedSamples += 1;
    return { accepted: false, reason: "non-finite", state };
  }
  if (sample <= 0) {
    state.rejectedSamples += 1;
    return { accepted: false, reason: "non-positive", state };
  }

  if (state.samples.length >= config.minimumSamples) {
    const center = median(state.samples);
    const mad = median(state.samples.map((value) => Math.abs(value - center)));
    const robustSigma = 1.4826 * mad;
    const tolerance = Math.max(center * config.minimumRelativeTolerance, robustSigma * config.outlierSigma);
    if (Math.abs(sample - center) > tolerance) {
      state.rejectedSamples += 1;
      state.medianAbsoluteDeviation = mad;
      return { accepted: false, reason: "outlier", state };
    }
  }

  state.samples.push(sample);
  if (state.samples.length > config.windowSamples) state.samples.shift();
  state.acceptedSamples += 1;
  state.value = median(state.samples);
  state.medianAbsoluteDeviation = median(state.samples.map((value) => Math.abs(value - state.value!)));
  state.confidence = Math.min(1, state.acceptedSamples / Math.max(1, config.minimumSamples * 4));
  return { accepted: true, reason: "accepted", state };
}
