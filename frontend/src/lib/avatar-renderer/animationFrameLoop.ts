export class AnimationFrameLoop {
  private frameId: number | null = null;
  private active = false;
  private readonly callback: FrameRequestCallback;
  private readonly request: typeof requestAnimationFrame;
  private readonly cancel: typeof cancelAnimationFrame;
  constructor(
    callback: FrameRequestCallback,
    request: typeof requestAnimationFrame = (next) => window.requestAnimationFrame(next),
    cancel: typeof cancelAnimationFrame = (id) => window.cancelAnimationFrame(id),
  ) { this.callback = callback; this.request = request; this.cancel = cancel; }
  get running(): boolean { return this.active; }
  start(): void { if (this.active) return; this.active = true; this.frameId = this.request(this.tick); }
  stop(): void { this.active = false; if (this.frameId !== null) this.cancel(this.frameId); this.frameId = null; }
  private readonly tick: FrameRequestCallback = (time) => { if (!this.active) return; this.frameId = null; this.callback(time); if (this.active) this.frameId = this.request(this.tick); };
}
