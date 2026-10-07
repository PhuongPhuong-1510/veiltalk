import type { HandLandmarkerResult } from "@mediapipe/tasks-vision";
import type { RawPoseSampleV1, RawNormalizedLandmarkV1 } from "./rawTrackingTypes";

export interface HandInputRegion { side: "left" | "right"; x: number; y: number; width: number; height: number; wristX: number; wristY: number }
export interface HandInputPlacement { region: HandInputRegion; x: number; y: number; width: number; height: number }
export interface HandInputPlan { width: number; height: number; shoulderPixels: number; regions: HandInputRegion[]; placements: HandInputPlacement[]; layout: "single" | "combined" | "split" }
export interface HandPoseHint { pose: RawPoseSampleV1; width: number; height: number; ageMs: number }
const CANVAS_SIZE = 512;
export class HandSensitivitySelector {
  private sensitive = false;
  private switchedAtMs = -Infinity;
  reset(): void { this.sensitive = false; this.switchedAtMs = -Infinity; }
  select(plan: HandInputPlan | null, nowMs: number): "normal" | "sensitive" {
    if (!plan) return "normal";
    const ratio = Math.max(plan.width, plan.height) / plan.shoulderPixels;
    const next = this.sensitive ? ratio >= 7 : ratio > 8;
    if (next !== this.sensitive && nowMs - this.switchedAtMs >= 1000) { this.sensitive = next; this.switchedAtMs = nowMs; }
    return this.sensitive ? "sensitive" : "normal";
  }
}
const valid = (point: RawNormalizedLandmarkV1 | undefined) => !!point && [point.x, point.y].every(Number.isFinite)
  && point.visibility !== null && point.visibility >= .6 && point.x >= -.05 && point.x <= 1.05 && point.y >= -.05 && point.y <= 1.05;

/** A plan uses only a recent, reliable Pose measurement; otherwise Hand sees the full frame. */
export function planPoseGuidedHandInput(hint: HandPoseHint | null): HandInputPlan | null {
  if (!hint || hint.pose.state !== "tracked" || hint.ageMs < 0 || hint.ageMs > 120 || !(hint.width > 0 && hint.height > 0)) return null;
  const points = hint.pose.landmarks;
  if (!points || ![11, 12].every(i => valid(points[i]))) return null;
  const width = hint.width, height = hint.height;
  const shoulderPixels = Math.hypot((points[11].x - points[12].x) * width, (points[11].y - points[12].y) * height);
  if (!Number.isFinite(shoulderPixels) || shoulderPixels < 35 || shoulderPixels > Math.max(width, height) * .65) return null;
  const radius = Math.max(48, Math.min(Math.min(width, height) * .38, shoulderPixels * .7 + hint.ageMs * .18));
  const regions: HandInputRegion[] = [];
  for (const [side, index] of [["left", 15], ["right", 16]] as const) {
    const wrist = points[index];
    if (!valid(wrist)) continue;
    const wristX = wrist.x * width, wristY = wrist.y * height;
    const x = Math.max(0, wristX - radius), y = Math.max(0, wristY - radius);
    const right = Math.min(width, wristX + radius), bottom = Math.min(height, wristY + radius);
    if (right - x < 32 || bottom - y < 32) continue;
    regions.push({ side, x, y, width: right - x, height: bottom - y, wristX, wristY });
  }
  if (!regions.length) return null;
  if (regions.length === 1) return { width, height, shoulderPixels, regions, layout: "single", placements: [{ region: regions[0], x: 0, y: 0, width: CANVAS_SIZE, height: CANVAS_SIZE }] };
  const left = Math.min(...regions.map(r => r.x)), top = Math.min(...regions.map(r => r.y));
  const right = Math.max(...regions.map(r => r.x + r.width)), bottom = Math.max(...regions.map(r => r.y + r.height));
  if (right - left <= radius * 3 && bottom - top <= radius * 3) {
    const region: HandInputRegion = { side: "left", x: left, y: top, width: right - left, height: bottom - top, wristX: regions[0].wristX, wristY: regions[0].wristY };
    return { width, height, shoulderPixels, regions, layout: "combined", placements: [{ region, x: 0, y: 0, width: CANVAS_SIZE, height: CANVAS_SIZE }] };
  }
  return { width, height, shoulderPixels, regions, layout: "split", placements: regions.map((region, index) => ({ region, x: index * CANVAS_SIZE / 2, y: 0, width: CANVAS_SIZE / 2, height: CANVAS_SIZE })) };
}

export function drawHandInput(source: CanvasImageSource, plan: HandInputPlan, canvas: OffscreenCanvas | HTMLCanvasElement): void {
  canvas.width = CANVAS_SIZE; canvas.height = CANVAS_SIZE;
  const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!context) throw new Error("Không tạo được canvas vùng tay.");
  context.fillStyle = "black"; context.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  for (const item of plan.placements) {
    const r = item.region;
    const scale = Math.min(item.width / r.width, item.height / r.height);
    const drawnWidth = r.width * scale, drawnHeight = r.height * scale;
    item.x += (item.width - drawnWidth) / 2; item.y += (item.height - drawnHeight) / 2;
    item.width = drawnWidth; item.height = drawnHeight;
    context.drawImage(source, r.x, r.y, r.width, r.height, item.x, item.y, drawnWidth, drawnHeight);
  }
}

/** Restore detector image coordinates; reject detections outside the Pose-supported region. */
export function mapHandResultFromInput(result: HandLandmarkerResult, plan: HandInputPlan): HandLandmarkerResult {
  const landmarks: HandLandmarkerResult["landmarks"] = [];
  const worldLandmarks: HandLandmarkerResult["worldLandmarks"] = [];
  const handedness: HandLandmarkerResult["handedness"] = [];
  const handednesses: HandLandmarkerResult["handednesses"] = [];
  for (let index = 0; index < result.landmarks.length; index++) {
    const points = result.landmarks[index];
    if (points.length !== 21) continue;
    const wristCanvasX = points[0].x * CANVAS_SIZE, wristCanvasY = points[0].y * CANVAS_SIZE;
    const placement = plan.placements.find(p => wristCanvasX >= p.x && wristCanvasX <= p.x + p.width && wristCanvasY >= p.y && wristCanvasY <= p.y + p.height);
    if (!placement) continue;
    const region = placement.region, scale = placement.width / region.width;
    const mapped = points.map(point => ({ ...point, x: (region.x + (point.x * CANVAS_SIZE - placement.x) / scale) / plan.width,
      y: (region.y + (point.y * CANVAS_SIZE - placement.y) / scale) / plan.height,
      z: point.z * CANVAS_SIZE / scale / plan.width }));
    const wristX = mapped[0].x * plan.width, wristY = mapped[0].y * plan.height;
    const nearest = plan.regions.reduce((best, r) => {
      const distance = Math.hypot(wristX - r.wristX, wristY - r.wristY);
      return distance < best.distance ? { distance, region: r } : best;
    }, { distance: Infinity, region: plan.regions[0] });
    if (nearest.distance > plan.shoulderPixels * .75 || nearest.distance > Math.max(plan.width, plan.height) * .3) continue;
    landmarks.push(mapped); worldLandmarks.push(result.worldLandmarks[index] ?? []);
    handedness.push(result.handedness[index] ?? []); handednesses.push(result.handednesses[index] ?? []);
  }
  return { ...result, landmarks, worldLandmarks, handedness, handednesses };
}
