import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createSegmentTemporalState, updateSegmentTemporalOutput } from "./armTemporalState";

const rotation = (angle: number) => {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle);
  return { x: q.x, y: q.y, z: q.z, w: q.w };
};

const angleBetween = (a: ReturnType<typeof rotation>, b: ReturnType<typeof rotation>) =>
  new Quaternion(a.x, a.y, a.z, a.w).angleTo(new Quaternion(b.x, b.y, b.z, b.w));

describe("arm active-output stability", () => {
  it("suppresses sub-dead-zone solver noise while a pose is held", () => {
    const state = createSegmentTemporalState();
    const first = updateSegmentTemporalOutput(state, rotation(0.6), true, 0, 250, 500, 180);
    const jitter = updateSegmentTemporalOutput(state, rotation(0.603), true, 33, 250, 500, 180);

    expect(angleBetween(first.output, jitter.output)).toBeLessThan(1e-6);
  });

  it("damps small real angular noise instead of copying it directly to the avatar", () => {
    const state = createSegmentTemporalState();
    const first = updateSegmentTemporalOutput(state, rotation(0.6), true, 0, 250, 500, 180);
    const rawTarget = rotation(0.62);
    const filtered = updateSegmentTemporalOutput(state, rawTarget, true, 33, 250, 500, 180);

    const rawStep = angleBetween(first.output, rawTarget);
    const appliedStep = angleBetween(first.output, filtered.output);
    expect(appliedStep).toBeGreaterThan(0);
    expect(appliedStep).toBeLessThan(rawStep);
  });

  it("still follows a deliberate fast movement without becoming sluggish", () => {
    const state = createSegmentTemporalState();
    const first = updateSegmentTemporalOutput(state, rotation(0.2), true, 0, 250, 500, 180);
    const target = rotation(0.8);
    const moved = updateSegmentTemporalOutput(state, target, true, 33, 250, 500, 180);

    const appliedStep = angleBetween(first.output, moved.output);
    expect(appliedStep).toBeGreaterThan(0.2);
    expect(appliedStep).toBeLessThanOrEqual(0.6);
  });

  it("holds the applied stabilized pose, not an unseen raw solver target", () => {
    const state = createSegmentTemporalState();
    updateSegmentTemporalOutput(state, rotation(0.6), true, 0, 250, 500, 180, 80);
    const filtered = updateSegmentTemporalOutput(state, rotation(0.64), true, 33, 250, 500, 180, 80);
    const held = updateSegmentTemporalOutput(state, null, false, 70, 250, 500, 180, 80);

    expect(held.output).toEqual(filtered.output);
  });
});
