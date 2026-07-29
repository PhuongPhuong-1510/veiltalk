import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { absoluteLocalFromRestDelta, eyeBoneLocalFromRest, isProcessorTimedExpression } from "./avatarRenderer";

const data = (value: Quaternion) => ({ x: value.x, y: value.y, z: value.z, w: value.w });
describe("renderer rest-relative application", () => {
  it("applies rest times delta as an absolute local target", () => {
    const rest = data(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), .4)); const delta = data(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), .7));
    const expected = data(new Quaternion(rest.x, rest.y, rest.z, rest.w).multiply(new Quaternion(delta.x, delta.y, delta.z, delta.w)));
    expect(absoluteLocalFromRestDelta(rest, delta)).toEqual(expected);
  });
  it("is deterministic for repeated packet and A-B-A", () => {
    const rest = data(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), .2)); const a = data(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), .5)); const b = data(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), .8));
    const firstA = absoluteLocalFromRestDelta(rest, a); expect(absoluteLocalFromRestDelta(rest, a)).toEqual(firstA); absoluteLocalFromRestDelta(rest, b); expect(absoluteLocalFromRestDelta(rest, a)).toEqual(firstA);
  });
  it("does not apply renderer smoothing to processor-owned mouth timing channels", () => {
    expect(isProcessorTimedExpression("jawOpen")).toBe(true);
    expect(isProcessorTimedExpression("aa")).toBe(true);
    expect(isProcessorTimedExpression("mouthClose")).toBe(true);
    expect(isProcessorTimedExpression("happy")).toBe(true);
    expect(isProcessorTimedExpression("mouthPucker")).toBe(true);
    expect(isProcessorTimedExpression("smile")).toBe(false);
  });
  it("applies bounded gaze as a rest-relative eye-bone rotation", () => {
    const rest = { x: 0, y: 0, z: 0, w: 1 }; const neutral = eyeBoneLocalFromRest(rest, 0, 0); const moved = eyeBoneLocalFromRest(rest, 1, -1);
    expect(neutral).toEqual(rest); expect(moved).not.toEqual(rest); expect(Math.hypot(moved.x, moved.y, moved.z, moved.w)).toBeCloseTo(1);
  });
});
