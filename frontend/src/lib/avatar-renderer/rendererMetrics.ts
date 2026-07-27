import type { WebGLRenderer } from "three";

export interface RendererMetricsSnapshot {
  fps: number; frameTimeAverageMs: number; frameTimeP95Ms: number; maxFrameGapMs: number;
  appliedSequence: number | null; processorInputToDrawMs: number | null; poseAgeMs: number | null;
  renderFramesWithoutNewTarget: number; geometries: number; textures: number; programs: number;
}

export class RendererMetricsCollector {
  private ticks: number[] = []; private durations: number[] = []; private lastTick: number | null = null;
  private maxGap = 0; private staleFrames = 0; private lastSequence: number | null = null;
  private processorLatency: number | null = null; private poseAge: number | null = null;
  recordDraw(now: number, duration: number, sequence: number | null, processedAt: number | null, sampledAt: number | null): void {
    if (this.lastTick !== null) this.maxGap = Math.max(this.maxGap, now - this.lastTick);
    this.lastTick = now; this.ticks.push(now); this.durations.push(duration);
    if (sequence !== null && sequence === this.lastSequence) this.staleFrames += 1;
    if (sequence !== null) this.lastSequence = sequence;
    this.processorLatency = processedAt === null ? null : now - processedAt;
    this.poseAge = sampledAt === null ? null : now - sampledAt;
    const cutoff = now - 10_000; while (this.ticks[0] < cutoff) this.ticks.shift();
    if (this.durations.length > 600) this.durations.shift();
  }
  snapshot(renderer: WebGLRenderer): RendererMetricsSnapshot {
    const sorted = [...this.durations].sort((a, b) => a - b); const avg = this.durations.reduce((a, b) => a + b, 0) / (this.durations.length || 1);
    return { fps: this.ticks.length > 1 ? (this.ticks.length - 1) * 1000 / (this.ticks.at(-1)! - this.ticks[0]) : 0,
      frameTimeAverageMs: avg, frameTimeP95Ms: sorted[Math.max(0, Math.ceil(sorted.length * .95) - 1)] ?? 0,
      maxFrameGapMs: this.maxGap, appliedSequence: this.lastSequence, processorInputToDrawMs: this.processorLatency,
      poseAgeMs: this.poseAge, renderFramesWithoutNewTarget: this.staleFrames, geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures, programs: renderer.info.programs?.length ?? 0 };
  }
  reset(): void { this.ticks = []; this.durations = []; this.lastTick = null; this.maxGap = 0; this.staleFrames = 0; this.lastSequence = null; }
}

