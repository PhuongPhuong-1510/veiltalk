import { describe, expect, it } from "vitest";
import { Object3D, Quaternion, Vector3 } from "three";
import { AvatarMotionProcessor } from "../avatar-motion/avatarMotionProcessor";
import { angularErrorDeg, appliedWorldDirection, childDirection, clearDiagnosticHelpers, convertDirection, createDebugPreset, createDiagnosticHelpers, inspectRestBasis } from "./avatarDiagnostics";

function armHierarchy() {
  const root = new Object3D(); root.name = "root";
  const leftUpperArm = new Object3D(); leftUpperArm.name = "leftUpperArm"; leftUpperArm.position.set(-1, 0, 0);
  const leftLowerArm = new Object3D(); leftLowerArm.name = "leftLowerArm"; leftLowerArm.position.set(-1, 0, 0);
  const leftHand = new Object3D(); leftHand.name = "leftHand"; leftHand.position.set(-1, 0, 0);
  root.add(leftUpperArm); leftUpperArm.add(leftLowerArm); leftLowerArm.add(leftHand); root.updateMatrixWorld(true);
  return { root, bones: { leftUpperArm, leftLowerArm, leftHand } };
}

describe("avatar diagnostics", () => {
  it("extracts normalized rest direction from hierarchy", () => {
    const { bones } = armHierarchy();
    expect(childDirection(bones.leftUpperArm, bones.leftLowerArm)).toEqual({ x: -1, y: 0, z: 0 });
    const row = inspectRestBasis(bones).find((value) => value.bone === "leftUpperArm");
    expect(row?.dot).toBe(-1); expect(row?.angleDeg).toBe(180);
  });

  it("calculates world-direction angular error", () => {
    expect(angularErrorDeg({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 })).toBeCloseTo(90);
    expect(angularErrorDeg({ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).toBeCloseTo(0);
  });

  it("keeps coordinate conversion variants isolated from production conversion", () => {
    const from = { x: 0, y: 0, z: 0, visibility: 1 }, to = { x: 1, y: 2, z: 3, visibility: 1 };
    expect(convertDirection(to, from, "current")).toEqual({ x: 1, y: -2, z: -3 });
    expect(convertDirection(to, from, "none")).toEqual({ x: 1, y: 2, z: 3 });
  });

  it("provides deterministic presets and replay rotations", () => {
    expect(createDebugPreset("leftElbow90")).toEqual(createDebugPreset("leftElbow90"));
    const processor = new AvatarMotionProcessor({ filtered: false, constraints: false, now: () => 2000 });
    const frame = createDebugPreset("rightElbow90");
    expect(processor.process(frame).jointRotations).toEqual(processor.process(structuredClone(frame)).jointRotations);
  });

  it("proves a one-vector upper-arm solver cannot observe elbow-plane changes", () => {
    const processor = new AvatarMotionProcessor({ filtered: false, constraints: false, now: () => 2000 });
    const a = processor.process(createDebugPreset("twistReferenceA")).jointRotations.leftUpperArm;
    const b = processor.process(createDebugPreset("twistReferenceB")).jointRotations.leftUpperArm;
    expect(a).toEqual(b);
  });

  it("removes helpers and attached axes without leaving scene children", () => {
    const { root, bones } = armHierarchy(); const group = createDiagnosticHelpers(root, bones);
    expect(root.getObjectByName("axes:leftUpperArm")).not.toBeUndefined(); clearDiagnosticHelpers(group);
    expect(group.parent).toBeNull(); expect(root.getObjectByName("axes:leftUpperArm")).toBeUndefined();
  });
  it("maps upper arm to lower arm rather than skipping directly to hand", () => {
    const { root, bones } = armHierarchy(); bones.leftHand.position.set(0, 1, 0); root.updateMatrixWorld(true);
    const group = createDiagnosticHelpers(root, bones); expect(group.userData.restDirections.leftUpperArm).toEqual({ x: -1, y: 0, z: 0 }); clearDiagnosticHelpers(group);
  });

  it("measures the upper-arm direction independently of an elbow rotation", () => {
    const { root, bones } = armHierarchy();
    const restWorldRotation = bones.leftUpperArm.getWorldQuaternion(new Quaternion());
    const restWorldDirection = bones.leftLowerArm.getWorldPosition(new Vector3()).sub(bones.leftUpperArm.getWorldPosition(new Vector3())).normalize();
    bones.leftLowerArm.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2); root.updateMatrixWorld(true);
    expect(appliedWorldDirection(bones.leftUpperArm, restWorldDirection, restWorldRotation)).toEqual({ x: -1, y: 0, z: 0 });
  });
});
