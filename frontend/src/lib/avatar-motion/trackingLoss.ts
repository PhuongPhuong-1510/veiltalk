import type { TrackingSampleState } from "../tracking/rawTrackingTypes";
import type { AvatarOutputMotionState } from "./avatarPoseTypes";

export class TrackingLossStateMachine {
  private lastTrackedAtMs: number | null = null;
  update(source: TrackingSampleState, sampledAtMs: number | null, nowMs: number, freshnessMs: number, holdMs: number, returnMs: number): AvatarOutputMotionState {
    if (source === "tracked" && sampledAtMs !== null && nowMs - sampledAtMs <= freshnessMs) {
      this.lastTrackedAtMs = sampledAtMs;
      return "active";
    }
    if (source === "not-sampled" && this.lastTrackedAtMs !== null && nowMs - this.lastTrackedAtMs <= freshnessMs) return "active";
    if (this.lastTrackedAtMs === null) return "idle";
    const lostFor = nowMs - this.lastTrackedAtMs;
    if (lostFor <= holdMs) return "held";
    if (lostFor <= holdMs + returnMs) return "returning";
    return "idle";
  }
  reset(): void { this.lastTrackedAtMs = null; }
}

