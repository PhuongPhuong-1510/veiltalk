export interface GazeObservationConfig {
  activationOnset: number;
  activationFull: number;
  maximumConjugateDisagreement: number;
  minimumQuality: number;
}

export interface GazeObservation {
  yaw: number;
  pitch: number;
  quality: number;
  left: { horizontal: number; vertical: number; weight: number };
  right: { horizontal: number; vertical: number; weight: number };
  rejectReason: "missing-eye-look-channels" | "nonfinite-eye-look" | "eyes-closed" | "conjugate-disagreement" | null;
}

export const DEFAULT_GAZE_OBSERVATION_CONFIG: GazeObservationConfig = {
  activationOnset: 0.04,
  activationFull: 0.6,
  maximumConjugateDisagreement: 1.25,
  minimumQuality: 0.18,
};

const KEYS = [
  "eyeLookInLeft", "eyeLookOutLeft", "eyeLookUpLeft", "eyeLookDownLeft",
  "eyeLookInRight", "eyeLookOutRight", "eyeLookUpRight", "eyeLookDownRight",
] as const;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smoothstep = (value: number) => { const x = clamp01(value); return x * x * (3 - 2 * x); };

function activate(value: number, config: GazeObservationConfig): number {
  return smoothstep((clamp01(value) - config.activationOnset) / (config.activationFull - config.activationOnset));
}

export function validateGazeObservationConfig(config: GazeObservationConfig): void {
  if (![config.activationOnset, config.activationFull, config.maximumConjugateDisagreement, config.minimumQuality].every(Number.isFinite)
      || config.activationOnset < 0 || config.activationOnset >= config.activationFull || config.activationFull > 1
      || config.maximumConjugateDisagreement <= 0 || config.minimumQuality < 0 || config.minimumQuality > 1) {
    throw new Error("Cấu hình gaze observation không hợp lệ.");
  }
}

/**
 * AR3-T01: chuyển coefficient MediaPipe đã neutral-calibrate thành gaze đồng hướng. Disparity
 * giữa hai mắt chỉ hạ quality; v1 không đổi disparity thành convergence.
 */
export function observeGaze(
  input: Readonly<Record<string, number>>,
  config: GazeObservationConfig = DEFAULT_GAZE_OBSERVATION_CONFIG,
): GazeObservation {
  if (!KEYS.every((key) => key in input)) return neutralObservation("missing-eye-look-channels");
  if (!KEYS.every((key) => Number.isFinite(input[key]))) return neutralObservation("nonfinite-eye-look");

  const left = {
    horizontal: activate(input.eyeLookOutLeft, config) - activate(input.eyeLookInLeft, config),
    vertical: activate(input.eyeLookUpLeft, config) - activate(input.eyeLookDownLeft, config),
    weight: 1 - activate(input.eyeBlinkLeft ?? 0, config),
  };
  const right = {
    horizontal: activate(input.eyeLookInRight, config) - activate(input.eyeLookOutRight, config),
    vertical: activate(input.eyeLookUpRight, config) - activate(input.eyeLookDownRight, config),
    weight: 1 - activate(input.eyeBlinkRight ?? 0, config),
  };
  const weightSum = left.weight + right.weight;
  const yaw = weightSum > 1e-6 ? (left.horizontal * left.weight + right.horizontal * right.weight) / weightSum : 0;
  const pitch = weightSum > 1e-6 ? (left.vertical * left.weight + right.vertical * right.weight) / weightSum : 0;
  const disagreement = Math.hypot(left.horizontal - right.horizontal, left.vertical - right.vertical);
  const agreement = clamp01(1 - disagreement / config.maximumConjugateDisagreement);
  const openness = clamp01(weightSum / 2);
  const quality = agreement * openness;
  return {
    yaw, pitch, quality, left, right,
    rejectReason: quality < config.minimumQuality
      ? openness < config.minimumQuality ? "eyes-closed" : "conjugate-disagreement"
      : null,
  };
}

function neutralObservation(rejectReason: GazeObservation["rejectReason"]): GazeObservation {
  return {
    yaw: 0, pitch: 0, quality: 0,
    left: { horizontal: 0, vertical: 0, weight: 0 },
    right: { horizontal: 0, vertical: 0, weight: 0 },
    rejectReason,
  };
}
