/** A hemisphere belongs to its anchor and recent observation, never to a side forever. */
export class WristDepthMemory {
  private sample: { sign: -1 | 1; at: number; anchor: "elbow" | "shoulder"; source: "pose" | "reconstructed" } | null = null;
  reset(): void { this.sample = null; }
  preferred(now: number, anchor: "elbow" | "shoulder"): -1 | 1 | null {
    const sample = this.sample;
    if (!sample || sample.anchor !== anchor || now < sample.at || now - sample.at > 600) return null;
    return sample.sign;
  }
  observe(deltaZ: number, at: number, anchor: "elbow" | "shoulder"): void {
    if (!Number.isFinite(deltaZ) || !Number.isFinite(at) || Math.abs(deltaZ) < 1e-4) return;
    this.sample = { sign: deltaZ >= 0 ? 1 : -1, at, anchor, source: "pose" };
  }
  accept(sign: -1 | 1 | null, at: number, anchor: "elbow" | "shoulder", confidence: number, ambiguity: number): void {
    if (sign === null || !Number.isFinite(at) || confidence < 0.5 || ambiguity > 0.95) return;
    // Reconstruction can maintain a branch during a short gap, but cannot renew observed trust
    // indefinitely. A fresh Pose observation is needed to restart its lifetime.
    const previous = this.sample;
    const acquiredAt = previous?.anchor === anchor ? previous.at : at;
    this.sample = { sign, at: acquiredAt, anchor, source: "reconstructed" };
  }
}
