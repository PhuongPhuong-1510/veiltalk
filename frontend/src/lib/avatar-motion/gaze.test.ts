import { describe, expect, it } from "vitest";
import { GazeProcessor, gazeTarget } from "./gaze";
describe("gaze processor", () => {
  it("converts MediaPipe inward/outward pairs to conjugate signed gaze", () => {
    expect(gazeTarget({ eyeLookInLeft: 1, eyeLookOutRight: 1 })).toEqual({ yaw: 1, pitch: 0 });
    expect(gazeTarget({ eyeLookOutLeft: 1, eyeLookInRight: 1 })).toEqual({ yaw: -1, pitch: 0 });
    expect(gazeTarget({ eyeLookUpLeft: 1, eyeLookUpRight: 1 })).toEqual({ yaw: 0, pitch: -1 });
  });
  it("removes neutral jitter and clamps malformed values", () => {
    const p = new GazeProcessor(); expect(p.process({ eyeLookInLeft: .04 }, 0)).toEqual({ yaw: 0, pitch: 0 }); expect(gazeTarget({ eyeLookInLeft: 4, eyeLookOutLeft: Number.NaN }).yaw).toBe(.5);
  });
  it("smooths movement and returns toward center on tracking loss", () => {
    const p = new GazeProcessor(); p.process({}, 0); const moved = p.process({ eyeLookInLeft: 1, eyeLookOutRight: 1 }, 20); expect(moved.yaw).toBeGreaterThan(0); expect(moved.yaw).toBeLessThan(1); const lost = p.process({}, 60, false); expect(lost.yaw).toBeLessThan(moved.yaw); p.reset(); expect(p.snapshot()).toBeNull();
  });
});
