import type { GazeStateV1 } from "./avatarPoseTypes";

export interface GazeEyelidSupport {
  handlesVerticalEyelid: boolean;
  targets: Readonly<{
    downLeft: boolean;
    downRight: boolean;
    upLeft: boolean;
    upRight: boolean;
  }>;
}

export interface GazeEyelidConfig {
  onset: number;
  full: number;
  downCap: number;
  upCap: number;
}

export interface GazeEyelidDiagnostic {
  status: "applied" | "not-applicable" | "no-gaze";
  reason: "adapter-handles-eyelid" | "no-production-safe-target" | "no-gaze" | null;
  outputs: Readonly<Record<string, number>>;
}

export const DEFAULT_GAZE_EYELID_CONFIG: GazeEyelidConfig = { onset: .12, full: .7, downCap: .14, upCap: .1 };
export const NO_GAZE_EYELID_SUPPORT: GazeEyelidSupport = Object.freeze({
  handlesVerticalEyelid: false,
  targets: Object.freeze({ downLeft: false, downRight: false, upLeft: false, upRight: false }),
});

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const activate = (value: number, config: GazeEyelidConfig) => {
  const x = clamp01((value - config.onset) / (config.full - config.onset));
  return x * x * (3 - 2 * x);
};

export function validateGazeEyelidConfig(config: GazeEyelidConfig): void {
  if (![config.onset, config.full, config.downCap, config.upCap].every(Number.isFinite)
      || config.onset < 0 || config.onset >= config.full || config.full > 1
      || config.downCap < 0 || config.downCap > 1 || config.upCap < 0 || config.upCap > 1) {
    throw new Error("Cấu hình eyelid coupling không hợp lệ.");
  }
}

/**
 * T02 chỉ phát semantic đã được profile model xác nhận. Blink F2 là primary và triệt phần
 * secondary theo từng bên; không bao giờ fallback sang blink/squint/full-face preset.
 */
export function computeGazeEyelidCoupling(
  gaze: GazeStateV1 | null,
  blink: Readonly<{ left: number; right: number }>,
  support: GazeEyelidSupport,
  config: GazeEyelidConfig = DEFAULT_GAZE_EYELID_CONFIG,
): GazeEyelidDiagnostic {
  if (!gaze) return { status: "no-gaze", reason: "no-gaze", outputs: {} };
  if (support.handlesVerticalEyelid) return { status: "not-applicable", reason: "adapter-handles-eyelid", outputs: {} };
  if (!Object.values(support.targets).some(Boolean)) return { status: "not-applicable", reason: "no-production-safe-target", outputs: {} };

  const down = config.downCap * activate(Math.max(0, -gaze.pitch), config);
  const up = config.upCap * activate(Math.max(0, gaze.pitch), config);
  const outputs: Record<string, number> = {};
  const set = (enabled: boolean, name: string, value: number, blinkValue: number) => {
    if (enabled) outputs[name] = value * (1 - clamp01(blinkValue));
  };
  set(support.targets.downLeft, "eyeLidDownLeft", down, blink.left);
  set(support.targets.downRight, "eyeLidDownRight", down, blink.right);
  set(support.targets.upLeft, "eyeLidUpLeft", up, blink.left);
  set(support.targets.upRight, "eyeLidUpRight", up, blink.right);
  return { status: "applied", reason: null, outputs };
}
