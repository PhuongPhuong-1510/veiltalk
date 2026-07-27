import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { composeSwingTwist, decomposeSwingTwist } from "./swingTwist";

const data = (q: Quaternion) => ({ x: q.x, y: q.y, z: q.z, w: q.w });
const sameOrientation = (a: ReturnType<typeof data>, b: ReturnType<typeof data>) => Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
describe("swing-twist foundation", () => {
  it.each([
    ["identity", new Quaternion()],
    ["pure swing", new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), .7)],
    ["pure twist", new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -.8)],
    ["combined", new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), .7).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -.8))],
    ["near 180-degree swing", new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI - 1e-8)],
  ])("round-trips %s", (_name, q) => {
    const parts = decomposeSwingTwist(data(q), { x: 1, y: 0, z: 0 })!; expect(sameOrientation(composeSwingTwist(parts), data(q))).toBeCloseTo(1, 6);
  });
  it("treats q and -q as the same orientation", () => {
    const q = data(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 1.2)); const negated = { x: -q.x, y: -q.y, z: -q.z, w: -q.w };
    expect(Math.abs(decomposeSwingTwist(q, { x: 1, y: 0, z: 0 })!.twistRadians)).toBeCloseTo(Math.abs(decomposeSwingTwist(negated, { x: 1, y: 0, z: 0 })!.twistRadians));
  });
  it("rejects an invalid twist axis", () => expect(decomposeSwingTwist({ x: 0, y: 0, z: 0, w: 1 }, { x: 0, y: 0, z: 0 })).toBeNull());
});
