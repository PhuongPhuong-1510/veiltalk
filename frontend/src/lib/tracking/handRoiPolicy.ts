import type { HandLandmarkerResult } from "@mediapipe/tasks-vision";
import type { HandInputPlan, HandPoseHint } from "./poseGuidedHandInput";

export type HandHintStatus = "missing" | "lost" | "stale" | "invalid-age" | "cached-disabled" | "unreliable-geometry" | "fresh-tracked" | "fresh-cached";
export type HandRoiReason = "disabled" | "no-plan" | "roi" | "miss-limit" | "recovery" | "periodic" | "draw-failed";
export interface HandInputDiagnostics {
  hintStatus: HandHintStatus;
  roiReason: HandRoiReason;
  /** Pose-region coverage, not persistent hand identity or downstream match quality. */
  expectedSides: Array<"left" | "right">;
  coveredSides: Array<"left" | "right">;
}
export function describeHandHint(hint: HandPoseHint | null, plan: HandInputPlan | null, allowCached = false): HandHintStatus {
  if (!hint) return "missing";
  if (!Number.isFinite(hint.ageMs) || hint.ageMs < 0) return "invalid-age";
  if (hint.ageMs > 120) return "stale";
  if (hint.pose.state === "lost") return "lost";
  if (hint.pose.state === "not-sampled" && !allowCached) return "cached-disabled";
  if (!plan) return "unreliable-geometry";
  return hint.pose.state === "not-sampled" ? "fresh-cached" : "fresh-tracked";
}

/** A candidate covers at most one Pose wrist. Ambiguity triggers more searching,
 * never a change to handedness/candidates delivered to the motion processor. */
export function handRegionCoverage(result: HandLandmarkerResult, plan: HandInputPlan | null): Array<"left" | "right"> {
  if (!plan) return [];
  const covered = new Set<"left" | "right">();
  for (const points of result.landmarks) {
    const wrist = points[0];
    if (!wrist || !Number.isFinite(wrist.x) || !Number.isFinite(wrist.y)) continue;
    const distances = plan.regions.map(region => ({ side: region.side,
      distance: Math.hypot(wrist.x * plan.width - region.wristX, wrist.y * plan.height - region.wristY) })).sort((a, b) => a.distance - b.distance);
    const nearest = distances[0];
    if (nearest && nearest.distance <= Math.min(plan.shoulderPixels * .75, Math.max(plan.width, plan.height) * .3)) covered.add(nearest.side);
  }
  return [...covered];
}

/** Experimental: bounded full-frame probes even when only one hand disappears.
 * Full-frame probes reset misses so an intentionally absent hand cannot force
 * every frame to full-frame. Eight ROI samples / 500ms bounds lock-in duration.
 */
export class HandRoiRecovery {
  private misses = { left: 0, right: 0 };
  private roiSamples = 0;
  private lastFullFrameMs = -Infinity;
  reset(): void { this.misses = { left: 0, right: 0 }; this.roiSamples = 0; this.lastFullFrameMs = -Infinity; }
  reason(plan: HandInputPlan | null, nowMs: number): "roi" | "recovery" | "periodic" {
    if (plan?.regions.some(region => this.misses[region.side] >= 2)) return "recovery";
    return this.roiSamples >= 8 || nowMs - this.lastFullFrameMs >= 500 ? "periodic" : "roi";
  }
  observe(usedRoi: boolean, plan: HandInputPlan | null, covered: Array<"left" | "right">, nowMs: number): void {
    if (!usedRoi) { this.misses = { left: 0, right: 0 }; this.roiSamples = 0; this.lastFullFrameMs = nowMs; return; }
    ++this.roiSamples;
    for (const side of ["left", "right"] as const) {
      this.misses[side] = plan?.regions.some(region => region.side === side) && !covered.includes(side) ? this.misses[side] + 1 : 0;
    }
  }
}
