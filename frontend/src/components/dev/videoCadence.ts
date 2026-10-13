/** Browser presentation cadence, not sensor capture FPS. Runs independently of inference. */
export class VideoCadence {
  private samples: Array<{ at: number; frames: number }> = [];
  private callbacks = 0;
  private startedAt = 0;
  private id = 0;
  reset(now: number) { this.samples = []; this.callbacks = 0; this.startedAt = now; this.id++; }
  record(at: number, frames: number) {
    if (!Number.isFinite(at) || !Number.isFinite(frames)) return;
    const last = this.samples.at(-1);
    if (last && (at <= last.at || frames < last.frames)) this.samples = [];
    this.samples.push({ at, frames }); this.callbacks++;
    while (this.samples.length && this.samples[0].at < at - 10000) this.samples.shift();
  }
  snapshot(now: number) {
    while (this.samples.length && this.samples[0].at < now - 10000) this.samples.shift();
    const first = this.samples[0], last = this.samples.at(-1);
    const seconds = first && last ? (last.at - first.at) / 1000 : 0;
    return { measurementId: this.id, durationMs: now - this.startedAt, callbacks: this.callbacks,
      windowSeconds: 10, presentedFps: seconds > 0 ? (last!.frames - first.frames) / seconds : null,
      callbackFps: seconds > 0 ? (this.samples.length - 1) / seconds : null };
  }
}
