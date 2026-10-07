import { describe, expect, it } from "vitest";
import type { PoseLandmarkerResult } from "@mediapipe/tasks-vision";
import { mapRawTrackingFrame } from "../tracking/rawTrackingMapper";
import { PoseDepthConditioner } from "./poseDepthConditioning";

const frame = (at: number, z = 0) => {
  const points = Array.from({ length: 33 }, (_, i) => ({ x: i / 50, y: i / 60, z, visibility: 1 }));
  return mapRawTrackingFrame(at, {
    pose: { landmarks: [points], worldLandmarks: [structuredClone(points)] } as PoseLandmarkerResult,
    sampledAtMs: { pose: at }, videoDimensions: { width: 1280, height: 720 },
  });
};

describe("Pose Z measurement conditioning", () => {
  it("reduces stationary depth jitter while preserving XY, visibility, timestamps and raw data", () => {
    const filter = new PoseDepthConditioner();
    let rawEnergy = 0, filteredEnergy = 0;
    for (let i = 0; i < 90; i++) {
      const raw = frame(i * 33, i % 2 ? .02 : -.02), before = structuredClone(raw);
      const result = filter.condition(raw);
      expect(raw).toEqual(before);
      expect(result.pose.sampledAtMs).toBe(raw.pose.sampledAtMs);
      for (const key of ["landmarks", "worldLandmarks"] as const) {
        result.pose[key]!.forEach((p, index) => {
          expect([p.x, p.y, p.visibility]).toEqual([raw.pose[key]![index].x, raw.pose[key]![index].y, raw.pose[key]![index].visibility]);
        });
        if (i > 10) { rawEnergy += raw.pose[key]![13].z ** 2; filteredEnergy += result.pose[key]![13].z ** 2; }
      }
    }
    expect(Math.sqrt(filteredEnergy / rawEnergy)).toBeLessThan(.65);
  });

  it("follows a real depth step without permanent bias", () => {
    const filter = new PoseDepthConditioner(); filter.condition(frame(0));
    let result = frame(0);
    for (let i = 1; i <= 6; i++) result = filter.condition(frame(i * 33, .5));
    expect(result.pose.worldLandmarks![13].z).toBeGreaterThan(.48);
    expect(result.pose.worldLandmarks![13].z).toBeLessThanOrEqual(.5);
  });

  it("does not advance on duplicate or not-sampled frames, including cached raw measurements", () => {
    const filter = new PoseDepthConditioner(); filter.condition(frame(0));
    const raw = frame(33, .1), result = filter.condition(raw);
    expect(filter.condition(raw).pose).toEqual(result.pose);
    const skipped = { ...raw, frameTimestampMs: 66, pose: { ...raw.pose, state: "not-sampled" as const } };
    const held = filter.condition(skipped);
    expect(held.pose.worldLandmarks).toEqual(result.pose.worldLandmarks);
    expect(held.pose.state).toBe("not-sampled");
    expect(held.pose.sampledAtMs).toBe(33);
  });

  it("resets on loss, long gaps, reversed time, camera geometry changes and explicit session reset", () => {
    for (const mode of ["loss", "gap", "reverse", "geometry", "reset"] as const) {
      const filter = new PoseDepthConditioner(); filter.condition(frame(100)); filter.condition(frame(133, .1));
      if (mode === "loss") filter.condition({ ...frame(150), pose: { state: "lost", sampledAtMs: 150, landmarks: null, worldLandmarks: null } });
      if (mode === "reset") filter.reset();
      const fresh = frame(mode === "gap" ? 1000 : mode === "reverse" ? 90 : 166, .4);
      if (mode === "geometry") fresh.videoWidth = 640;
      expect(filter.condition(fresh).pose).toEqual(fresh.pose);
    }
  });

  it("does not learn low-confidence or invalid depths and reacquires that point without old history", () => {
    const filter = new PoseDepthConditioner(); filter.condition(frame(0));
    const weak = frame(33, .8); weak.pose.landmarks![13].visibility = .2;
    const output = filter.condition(weak);
    expect(output.pose.landmarks![13]).toEqual(weak.pose.landmarks![13]);
    expect(output.pose.worldLandmarks![13]).toEqual(weak.pose.worldLandmarks![13]);
    expect(filter.condition(frame(66, .4)).pose.worldLandmarks![13].z).toBe(.4);
    const invalid = frame(99, .8); invalid.pose.worldLandmarks![13].z = NaN;
    expect(Number.isNaN(filter.condition(invalid).pose.worldLandmarks![13].z)).toBe(true);
    expect(filter.condition(frame(132, .2)).pose.worldLandmarks![13].z).toBe(.2);
  });
});
