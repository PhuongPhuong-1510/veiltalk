import type { RawTrackingFrameV1, RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { AvatarPosePacket, QuaternionData } from "./avatarPoseTypes";

export const MOTION_SCENES = ["static", "overhead", "behind-head", "near-face-no-contact", "crossing", "palms-together", "depth", "partial-arm", "fingers", "restart"] as const;
export type MotionScene = typeof MOTION_SCENES[number];
export interface MotionRecordingV1 {
  version: 1;
  kind: "veiltalk-motion-replay";
  scene: MotionScene;
  createdAt: string;
  metadata: Record<string, unknown>;
  frames: { atMs: number; raw: RawTrackingFrameV1; packet?: AvatarPosePacket; diagnostics?: unknown; finalPose?: unknown }[];
}
const MAX_FRAMES = 1800;
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const object = (v: unknown): v is Record<string, unknown> => Boolean(v && typeof v === "object" && !Array.isArray(v));
const timestamp = (v: unknown) => v === null || finite(v);
function landmarks(v: unknown, max: number): boolean {
  return v === null || Array.isArray(v) && v.length <= max && v.every(p => object(p)
    && finite(p.x) && finite(p.y) && finite(p.z) && timestamp(p.visibility));
}
function validFrame(v: unknown): v is RawTrackingFrameV1 {
  if (!object(v) || v.version !== 1 || !finite(v.frameTimestampMs) || !["full", "partial", "lost"].includes(String(v.overall))) return false;
  if (!timestamp(v.videoWidth) || !timestamp(v.videoHeight) || typeof v.handSampledThisFrame !== "boolean" || !timestamp(v.handSampledAtMs)) return false;
  for (const [key, max] of [["face", 478], ["pose", 33], ["leftHand", 21], ["rightHand", 21]] as const) {
    const part = v[key];
    if (!object(part) || !["tracked", "lost", "not-sampled"].includes(String(part.state)) || !timestamp(part.sampledAtMs) || !landmarks(part.landmarks, max)) return false;
    if (key !== "face" && !landmarks(part.worldLandmarks, max)) return false;
  }
  const face = v.face as Record<string, unknown>;
  if (face.facialTransform !== null && (!object(face.facialTransform) || !Array.isArray(face.facialTransform.data) || face.facialTransform.data.length !== 16 || !face.facialTransform.data.every(finite))) return false;
  if (face.blendshapes !== null && (!object(face.blendshapes) || Object.keys(face.blendshapes).length > 100 || !Object.values(face.blendshapes).every(finite))) return false;
  return Array.isArray(v.rawHands) && v.rawHands.length <= 2 && v.rawHands.every(hand => object(hand) && finite(hand.sourceIndex)
    && finite(hand.sampledAtMs) && ["left", "right", "unknown"].includes(String(hand.handedness)) && timestamp(hand.handednessScore)
    && Array.isArray(hand.landmarks) && Array.isArray(hand.worldLandmarks) && landmarks(hand.landmarks, 21) && landmarks(hand.worldLandmarks, 21));
}

export function parseMotionRecording(json: string): MotionRecordingV1 {
  if (json.length > 25_000_000) throw new Error("Replay quá lớn (tối đa 25 MB).");
  const value: unknown = JSON.parse(json);
  if (!object(value) || value.version !== 1 || value.kind !== "veiltalk-motion-replay" || !MOTION_SCENES.includes(value.scene as MotionScene)
    || typeof value.createdAt !== "string" || !object(value.metadata) || !Array.isArray(value.frames) || !value.frames.length || value.frames.length > MAX_FRAMES) throw new Error("Replay không đúng định dạng VeilTalk.");
  let last = -Infinity;
  for (const entry of value.frames) {
    if (!object(entry) || !finite(entry.atMs) || entry.atMs < last || !validFrame(entry.raw)) throw new Error("Replay chứa frame hoặc thời gian không hợp lệ.");
    last = entry.atMs;
  }
  return value as unknown as MotionRecordingV1;
}

export class MotionRecorder {
  private recording: MotionRecordingV1 | null = null;
  private bytes = 0;
  stoppedByLimit = false;
  active = false;
  start(scene: MotionScene, metadata: Record<string, unknown>): void {
    this.recording = { version: 1, kind: "veiltalk-motion-replay", scene, metadata: structuredClone(metadata), createdAt: new Date().toISOString(), frames: [] };
    this.bytes = new TextEncoder().encode(JSON.stringify(this.recording)).byteLength;
    this.stoppedByLimit = false;
    this.active = true;
  }
  stop(): void { this.active = false; }
  count(): number { return this.recording?.frames.length ?? 0; }
  record(raw: RawTrackingFrameV1, packet: AvatarPosePacket, atMs: number, diagnostics: unknown, finalPose: unknown): void {
    if (!this.active || !this.recording || !Number.isFinite(atMs)) return;
    const entry = structuredClone({ atMs, raw, packet, diagnostics, finalPose });
    const size = new TextEncoder().encode(JSON.stringify(entry)).byteLength + 1;
    if (this.recording.frames.length >= MAX_FRAMES || this.bytes + size > 23_000_000) { this.stoppedByLimit = true; this.stop(); return; }
    this.bytes += size;
    this.recording.frames.push(entry);
  }
  snapshot(): MotionRecordingV1 | null { return this.recording ? structuredClone(this.recording) : null; }
}

/** Preserve all sample ages and cross-detector offsets while moving to a new monotonic clock. */
export function rebaseTrackingFrame(frame: RawTrackingFrameV1, offset: number): RawTrackingFrameV1 {
  const next = structuredClone(frame);
  next.frameTimestampMs += offset;
  for (const key of ["face", "pose", "leftHand", "rightHand"] as const) if (next[key].sampledAtMs !== null) next[key].sampledAtMs! += offset;
  if (next.handSampledAtMs !== null) next.handSampledAtMs += offset;
  next.rawHands.forEach(hand => { hand.sampledAtMs += offset; });
  return next;
}

/** Consecutive quaternion motion: useful as static jitter only on a labeled static window. */
export function rotationStepDegrees(a: QuaternionData, b: QuaternionData): number | null {
  const normA = Math.hypot(a.x, a.y, a.z, a.w), normB = Math.hypot(b.x, b.y, b.z, b.w);
  if (!(normA > 1e-8 && normB > 1e-8)) return null;
  const dot = Math.abs((a.x*b.x+a.y*b.y+a.z*b.z+a.w*b.w)/(normA*normB));
  return 2 * Math.acos(Math.min(1, dot)) * 180 / Math.PI;
}

export function landmarkDistance(a: RawNormalizedLandmarkV1, b: RawNormalizedLandmarkV1): number {
  return Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
}
