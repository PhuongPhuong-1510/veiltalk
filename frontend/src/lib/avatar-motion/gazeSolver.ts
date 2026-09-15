import type { QuaternionData } from "./avatarPoseTypes";
import { observeGaze, validateGazeObservationConfig, type GazeObservation, type GazeObservationConfig } from "./gazeObservation";
import { GazeTemporal, type GazeTemporalConfig } from "./gazeTemporal";
import { DEFAULT_GAZE_CINEMATIC_CONFIG, GazeCinematicLayer, type GazeCinematicConfig, type GazeCinematicOutput } from "./gazeCinematic";
import { GazeMetricsCollector, type GazeMetricsSnapshot } from "./gazeMetrics";

export interface GazeSolverConfig {
  observation: GazeObservationConfig;
  temporal: GazeTemporalConfig;
  limits: { yawLeft: number; yawRight: number; pitchUp: number; pitchDown: number };
  cinematic?: GazeCinematicConfig;
}

export interface GazeDiagnostics {
  outputState: "active" | "held" | "returning" | "idle";
  quality: number;
  rejectReason: GazeObservation["rejectReason"];
  rawLeft: GazeObservation["left"] | null;
  rawRight: GazeObservation["right"] | null;
  fused: { yaw: number; pitch: number };
  head: { yaw: number; pitch: number } | null;
  finalSemantic: { yaw: number; pitch: number };
  sampleDisposition: "fresh" | "duplicate" | "reversed" | "loss";
  clampApplied: boolean;
  mode: "faithful" | "cinematic";
  cinematic: GazeCinematicOutput;
}

export class GazeSolver {
  private readonly config: GazeSolverConfig;
  private readonly temporal: GazeTemporal;
  private readonly cinematic: GazeCinematicLayer;
  private readonly metrics = new GazeMetricsCollector();
  private diagnostics: GazeDiagnostics = emptyDiagnostics();
  private lastSampledAtMs: number | null = null;
  private lastBase = { yaw: 0, pitch: 0 };
  private mode: "faithful" | "cinematic" = "faithful";
  private attentionStrength = 0;
  constructor(config: GazeSolverConfig) {
    validateGazeObservationConfig(config.observation);
    if (!Object.values(config.limits).every((value) => Number.isFinite(value) && value > 0 && value <= 1)) throw new Error("Giới hạn semantic gaze không hợp lệ.");
    this.config = config; this.temporal = new GazeTemporal(config.temporal); this.cinematic = new GazeCinematicLayer(config.cinematic ?? DEFAULT_GAZE_CINEMATIC_CONFIG);
  }

  setMode(mode: "faithful" | "cinematic"): void { this.mode = mode; this.cinematic.setEnabled(mode === "cinematic"); }
  getMode(): "faithful" | "cinematic" { return this.mode; }
  setAttentionStrength(strength: number): void { this.attentionStrength = Number.isFinite(strength) ? Math.min(1, Math.max(0, strength)) : 0; }

  processFresh(input: Readonly<Record<string, number>>, sampledAtMs: number, headRotation: QuaternionData | null, filtered: boolean, nowMs = sampledAtMs) {
    if (this.lastSampledAtMs !== null && sampledAtMs <= this.lastSampledAtMs) {
      const disposition = sampledAtMs === this.lastSampledAtMs ? "duplicate" as const : "reversed" as const;
      if (this.diagnostics.rejectReason) {
        const temporal = this.temporal.processLoss(nowMs);
        this.lastBase = { yaw: temporal.yaw, pitch: temporal.pitch };
        return this.finish(this.lastBase, nowMs, false, this.diagnostics.quality, disposition, temporal.outputState);
      }
      return this.finish(this.lastBase, nowMs, this.diagnostics.outputState === "active", this.diagnostics.quality, disposition, this.diagnostics.outputState);
    }
    this.lastSampledAtMs = sampledAtMs;
    const observation = observeGaze(input, this.config.observation);
    const head = headRotation ? quaternionYawPitch(headRotation) : null;
    if (observation.rejectReason) {
      const temporal = this.temporal.processLoss(nowMs);
      this.lastBase = { yaw: temporal.yaw, pitch: temporal.pitch };
      this.diagnostics = { ...this.diagnostics, outputState: temporal.outputState, quality: observation.quality, rejectReason: observation.rejectReason, rawLeft: observation.left, rawRight: observation.right, fused: { yaw: observation.yaw, pitch: observation.pitch }, head, sampleDisposition: temporal.sampleDisposition, clampApplied: false };
      return this.finish(this.lastBase, nowMs, false, observation.quality, "fresh", temporal.outputState);
    }
    const clamped = clampGaze(observation.yaw, observation.pitch, this.config.limits);
    const temporal = this.temporal.processFresh(clamped.yaw, clamped.pitch, sampledAtMs, filtered);
    this.lastBase = { yaw: temporal.yaw, pitch: temporal.pitch };
    this.diagnostics = { ...this.diagnostics, outputState: temporal.outputState, quality: observation.quality, rejectReason: null, rawLeft: observation.left, rawRight: observation.right, fused: { yaw: observation.yaw, pitch: observation.pitch }, head, sampleDisposition: temporal.sampleDisposition, clampApplied: clamped.clampApplied };
    return this.finish(this.lastBase, nowMs, true, observation.quality, temporal.sampleDisposition, temporal.outputState);
  }

  processLoss(nowMs: number) {
    const temporal = this.temporal.processLoss(nowMs);
    this.lastBase = { yaw: temporal.yaw, pitch: temporal.pitch };
    return this.finish(this.lastBase, nowMs, false, this.diagnostics.quality, "loss", temporal.outputState);
  }

  snapshot(): GazeDiagnostics { return structuredClone(this.diagnostics); }
  metricsSnapshot(nowMs?: number): GazeMetricsSnapshot { return this.metrics.snapshot(nowMs); }
  reset(): void { this.lastSampledAtMs = null; this.lastBase = { yaw: 0, pitch: 0 }; this.temporal.reset(); this.cinematic.reset(); this.cinematic.setEnabled(this.mode === "cinematic"); this.metrics.reset(); this.diagnostics = emptyDiagnostics(this.mode); }

  private finish(base: { yaw: number; pitch: number }, nowMs: number, active: boolean, quality: number, sampleDisposition: GazeDiagnostics["sampleDisposition"], outputState: GazeDiagnostics["outputState"]) {
    const cinematic = this.cinematic.apply(base, nowMs, active, quality, this.attentionStrength);
    const final = clampGaze(cinematic.yaw, cinematic.pitch, this.config.limits);
    this.diagnostics = { ...this.diagnostics, outputState, sampleDisposition, mode: this.mode, cinematic, finalSemantic: { yaw: final.yaw, pitch: final.pitch }, clampApplied: this.diagnostics.clampApplied || final.clampApplied };
    this.metrics.record(this.diagnostics, nowMs);
    return outputState === "idle" ? null : { version: 1 as const, yaw: final.yaw, pitch: final.pitch };
  }
}

export function clampGaze(yaw: number, pitch: number, limits: GazeSolverConfig["limits"]) {
  const yawLimit = yaw >= 0 ? limits.yawRight : limits.yawLeft;
  const pitchLimit = pitch >= 0 ? limits.pitchUp : limits.pitchDown;
  const radiusSquared = (yaw / yawLimit) ** 2 + (pitch / pitchLimit) ** 2;
  const scale = radiusSquared > 1 ? 1 / Math.sqrt(radiusSquared) : 1;
  return { yaw: yaw * scale, pitch: pitch * scale, clampApplied: scale < 1 };
}

export function quaternionYawPitch(value: QuaternionData): { yaw: number; pitch: number } | null {
  const magnitude = Math.hypot(value.x, value.y, value.z, value.w);
  if (!Number.isFinite(magnitude) || magnitude < 1e-8) return null;
  const x = value.x / magnitude, y = value.y / magnitude, z = value.z / magnitude, w = value.w / magnitude;
  const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (w * x - y * z))));
  const yaw = Math.atan2(2 * (w * y + x * z), 1 - 2 * (x * x + y * y));
  return { yaw, pitch };
}

function emptyDiagnostics(mode: "faithful" | "cinematic" = "faithful"): GazeDiagnostics {
  return { outputState: "idle", quality: 0, rejectReason: null, rawLeft: null, rawRight: null, fused: { yaw: 0, pitch: 0 }, head: null, finalSemantic: { yaw: 0, pitch: 0 }, sampleDisposition: "loss", clampApplied: false, mode, cinematic: { yaw: 0, pitch: 0, proceduralBlink: 0, blend: 0, attentionBias: { yaw: 0, pitch: 0 }, saccade: { yaw: 0, pitch: 0 } } };
}
