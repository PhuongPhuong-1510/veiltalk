export interface GazeConfig { deadZone: number; timeConstantMs: number; maximumDeltaMs: number }
export const DEFAULT_GAZE_CONFIG: GazeConfig = { deadZone: .06, timeConstantMs: 45, maximumDeltaMs: 100 };
export interface AvatarGazeV1 { yaw: number; pitch: number }
export interface GazeDiagnostics extends AvatarGazeV1 { rawYaw: number; rawPitch: number; dtMs: number }
const clampSigned = (v: number) => Math.min(1, Math.max(-1, Number.isFinite(v) ? v : 0));
const clamp01 = (v: number | undefined) => Math.min(1, Math.max(0, Number.isFinite(v) ? v! : 0));
const deadZone = (v: number, zone: number) => Math.abs(v) <= zone ? 0 : Math.sign(v) * (Math.abs(v) - zone) / Math.max(1e-6, 1 - zone);
export function gazeTarget(values: Readonly<Record<string, number>>): AvatarGazeV1 {
  const right = (clamp01(values.eyeLookInLeft) + clamp01(values.eyeLookOutRight)) / 2;
  const left = (clamp01(values.eyeLookOutLeft) + clamp01(values.eyeLookInRight)) / 2;
  const down = (clamp01(values.eyeLookDownLeft) + clamp01(values.eyeLookDownRight)) / 2;
  const up = (clamp01(values.eyeLookUpLeft) + clamp01(values.eyeLookUpRight)) / 2;
  return { yaw: clampSigned(right - left), pitch: clampSigned(down - up) };
}
export class GazeProcessor {
  private yaw = 0; private pitch = 0; private lastAtMs: number | null = null; private diagnostics: GazeDiagnostics | null = null;
  private readonly config: GazeConfig;
  constructor(config: GazeConfig = DEFAULT_GAZE_CONFIG) { this.config = config; }
  process(values: Readonly<Record<string, number>>, nowMs: number, tracked = true): AvatarGazeV1 {
    const raw = tracked ? gazeTarget(values) : { yaw: 0, pitch: 0 }; const dt = Math.min(this.config.maximumDeltaMs, Math.max(0, this.lastAtMs === null ? 0 : nowMs - this.lastAtMs)); this.lastAtMs = nowMs;
    const targetYaw = deadZone(raw.yaw, this.config.deadZone), targetPitch = deadZone(raw.pitch, this.config.deadZone); const a = dt === 0 ? 1 : 1 - Math.exp(-dt / this.config.timeConstantMs);
    this.yaw += (targetYaw - this.yaw) * a; this.pitch += (targetPitch - this.pitch) * a;
    this.diagnostics = { rawYaw: raw.yaw, rawPitch: raw.pitch, yaw: this.yaw, pitch: this.pitch, dtMs: dt }; return { yaw: this.yaw, pitch: this.pitch };
  }
  snapshot(): GazeDiagnostics | null { return this.diagnostics ? { ...this.diagnostics } : null; }
  reset(): void { this.yaw = 0; this.pitch = 0; this.lastAtMs = null; this.diagnostics = null; }
}
