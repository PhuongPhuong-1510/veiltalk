import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { absoluteLocalFromRestDelta } from "./avatarRenderer";

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
});
