import { Group, Object3D } from "three";
import { describe, expect, it } from "vitest";
import type { VRM } from "@pixiv/three-vrm";
import { inspectModel } from "./modelCapability";

function vrmWith(nodes: Record<string, Object3D>): VRM {
  return { meta: { metaVersion: "1" }, humanoid: { getNormalizedBoneNode: (name: string) => nodes[name] ?? null }, expressionManager: null, lookAt: null, materials: [] } as unknown as VRM;
}

describe("3E model capability baseline", () => {
  it("reports full torso hierarchy, independent shoulders and the existing fixed-rest arm parent", () => {
    const root = new Group(); const names = ["hips", "spine", "chest", "upperChest", "neck", "head", "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand", "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand"];
    const nodes = Object.fromEntries(names.map((name) => [name, Object.assign(new Object3D(), { name })])) as Record<string, Object3D>;
    root.add(nodes.hips); nodes.hips.add(nodes.spine); nodes.spine.add(nodes.chest); nodes.chest.add(nodes.upperChest); nodes.upperChest.add(nodes.neck, nodes.leftShoulder, nodes.rightShoulder); nodes.neck.add(nodes.head);
    nodes.leftShoulder.add(nodes.leftUpperArm); nodes.leftUpperArm.add(nodes.leftLowerArm); nodes.leftLowerArm.add(nodes.leftHand); nodes.rightShoulder.add(nodes.rightUpperArm); nodes.rightUpperArm.add(nodes.rightLowerArm); nodes.rightLowerArm.add(nodes.rightHand);
    const report = inspectModel(root, undefined, "avatar.vrm", 1, null, "unknown", vrmWith(nodes));
    expect(report.torsoShoulder).toMatchObject({ hierarchy: "full", parents: { spine: "hips", chest: "spine", upperChest: "chest", leftShoulder: "upperChest", rightShoulder: "upperChest" }, shoulderStatus: { left: "available", right: "available" }, upperArmParentMode: { left: "fixed-rest", right: "fixed-rest" } });
  });
  it("reports missing upperChest fallback and broken shoulders per side", () => {
    const root = new Group(); const hips = new Object3D(); const spine = new Object3D(); const chest = new Object3D(); const leftShoulder = new Object3D(); const leftUpperArm = new Object3D();
    root.add(hips); hips.add(spine); spine.add(chest); chest.add(leftShoulder); root.add(leftUpperArm);
    const report = inspectModel(root, undefined, "avatar.vrm", 1, null, "unknown", vrmWith({ hips, spine, chest, leftShoulder, leftUpperArm }));
    expect(report.torsoShoulder.hierarchy).toBe("without-upper-chest"); expect(report.torsoShoulder.shoulderStatus).toEqual({ left: "invalid-parent", right: "missing" });
  });
});
