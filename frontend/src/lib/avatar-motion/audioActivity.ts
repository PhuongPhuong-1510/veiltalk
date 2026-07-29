export interface AudioActivitySource { getActivity(nowMs: number): number | null; dispose?(): void }
export class NullAudioActivitySource implements AudioActivitySource { getActivity(): null { return null; } }
export class SimulatedAudioActivitySource implements AudioActivitySource {
  private value: number | null = null;
  setActivity(value: number | null): void { this.value = value === null ? null : Math.min(1, Math.max(0, value)); }
  getActivity(): number | null { return this.value; }
}
export class WebAudioActivitySource implements AudioActivitySource {
  private readonly source: MediaStreamAudioSourceNode; private readonly analyser: AnalyserNode; private readonly samples: Float32Array<ArrayBuffer>; private readonly ownsContext: boolean; private readonly context: AudioContext;
  private output = 0; private lastAtMs: number | null = null;
  constructor(stream: MediaStream, context?: AudioContext) {
    this.context = context ?? new AudioContext(); this.ownsContext = context === undefined; this.source = this.context.createMediaStreamSource(stream); this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 256; this.source.connect(this.analyser); this.samples = new Float32Array(this.analyser.fftSize);
  }
  getActivity(nowMs: number): number { this.analyser.getFloatTimeDomainData(this.samples); const target = rmsActivity(this.samples); const dt = this.lastAtMs === null ? 0 : Math.max(0, nowMs - this.lastAtMs); this.lastAtMs = nowMs; const time = target > this.output ? 20 : 80; this.output += (target - this.output) * (dt === 0 ? 1 : 1 - Math.exp(-dt / time)); return this.output; }
  dispose(): void { this.source.disconnect(); this.analyser.disconnect(); if (this.ownsContext) void this.context.close(); }
}
export function rmsActivity(samples: Float32Array, noiseFloor = .015): number {
  if (samples.length === 0) return 0; let sum = 0; for (const sample of samples) sum += sample * sample;
  const rms = Math.sqrt(sum / samples.length); return Math.min(1, Math.max(0, (rms - noiseFloor) / Math.max(1e-6, 1 - noiseFloor)));
}
