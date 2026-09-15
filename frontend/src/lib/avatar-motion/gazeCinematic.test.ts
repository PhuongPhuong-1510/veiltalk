import { describe, expect, it } from "vitest";
import { DEFAULT_GAZE_CINEMATIC_CONFIG, GazeCinematicLayer } from "./gazeCinematic";

describe("GazeCinematicLayer", () => {
  it("is exact faithful output while disabled", () => {
    const layer = new GazeCinematicLayer();
    expect(layer.apply({ yaw: .2, pitch: -.1 }, 1_000, true, 1, 1)).toMatchObject({ yaw: .2, pitch: -.1, proceduralBlink: 0, blend: 0 });
  });

  it("is deterministic for the same timestamp trajectory and bounded", () => {
    const a = new GazeCinematicLayer(), b = new GazeCinematicLayer(); a.setEnabled(true); b.setEnabled(true);
    let left, right;
    for (const now of [0, 60, 120, 180, 1_200]) { left = a.apply({ yaw: .05, pitch: 0 }, now, true, 1, .8); right = b.apply({ yaw: .05, pitch: 0 }, now, true, 1, .8); }
    expect(left).toEqual(right); expect(Math.abs(left!.yaw - .05)).toBeLessThan(.05);
  });

  it("suppresses auxiliary motion during loss and blends mode transitions", () => {
    const layer = new GazeCinematicLayer(); layer.setEnabled(true);
    layer.apply({ yaw: 0, pitch: 0 }, 0, true, 1, 0);
    layer.apply({ yaw: 0, pitch: 0 }, 100, true, 1, 0);
    const active = layer.apply({ yaw: 0, pitch: 0 }, DEFAULT_GAZE_CINEMATIC_CONFIG.transitionMs, true, 1, 0);
    expect(active.blend).toBe(1);
    expect(layer.apply({ yaw: .2, pitch: .1 }, 200, false, 1, 1)).toMatchObject({ yaw: .2, pitch: .1, proceduralBlink: 0 });
    layer.setEnabled(false); expect(layer.apply({ yaw: 0, pitch: 0 }, 290, true, 1, 0).blend).toBeCloseTo(.5);
  });
});
