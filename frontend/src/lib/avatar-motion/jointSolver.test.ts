import { Matrix4, Object3D, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import { angularErrorDeg } from "../avatar-renderer/avatarDiagnostics";
import { createDebugPreset } from "../avatar-renderer/avatarDiagnostics";
import { solveParentLocalArmRotations } from "./jointSolver";
import { freezeRigProfile, type ControlledArmJoint, type NormalizedAvatarRigProfile } from "./normalizedRigProfile";

const qData = (q: Quaternion) => ({ x: q.x, y: q.y, z: q.z, w: q.w });
const vData = (v: Vector3) => ({ x: v.x, y: v.y, z: v.z });
const landmark = (v = new Vector3()): RawNormalizedLandmarkV1 => ({ x: v.x, y: -v.y, z: -v.z, visibility: 1 });

function fixture(grandAngle = 0, parentAngle = 0) {
  const root = new Object3D(); const grand = new Object3D(); const shoulder = new Object3D(); const upper = new Object3D(); const lower = new Object3D(); const hand = new Object3D();
  grand.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), grandAngle); shoulder.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), parentAngle);
  lower.position.set(1, 0, 0); hand.position.set(1, 0, 0); root.add(grand); grand.add(shoulder); shoulder.add(upper); upper.add(lower); lower.add(hand); root.updateMatrixWorld(true);
  const joint = (bone: Object3D, child: Object3D, parentMode: "fixed-rest" | "controlled", controlledParentJoint: ControlledArmJoint | null) => {
    const primaryWorld = child.getWorldPosition(new Vector3()).sub(bone.getWorldPosition(new Vector3())).normalize();
    const secondaryWorld = new Vector3(0, 1, 0).addScaledVector(primaryWorld, -primaryWorld.y).normalize(); const binormalWorld = primaryWorld.clone().cross(secondaryWorld).normalize(); secondaryWorld.copy(binormalWorld).cross(primaryWorld);
    const inverseWorld = bone.getWorldQuaternion(new Quaternion()).invert();
    return { parentJoint: parentMode === "controlled" ? "leftUpperArm" as const : "leftShoulder" as const, childJoint: parentMode === "controlled" ? "leftHand" as const : "leftLowerArm" as const,
      parentMode, controlledParentJoint, restLocalPosition: vData(bone.position), restLocalRotation: qData(bone.quaternion), restWorldPosition: vData(bone.getWorldPosition(new Vector3())), restWorldRotation: qData(bone.getWorldQuaternion(new Quaternion())), parentRestWorldRotation: qData(bone.parent!.getWorldQuaternion(new Quaternion())), restWorldDirection: vData(primaryWorld),
      anatomicalRestBasis: { primaryLocal: vData(primaryWorld.clone().applyQuaternion(inverseWorld)), secondaryLocal: vData(secondaryWorld.clone().applyQuaternion(inverseWorld)), binormalLocal: vData(binormalWorld.clone().applyQuaternion(inverseWorld)), primaryWorld: vData(primaryWorld), secondaryWorld: vData(secondaryWorld), binormalWorld: vData(binormalWorld), worldRotation: qData(new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(primaryWorld, secondaryWorld, binormalWorld))) } };
  };
  const identity = { x: 0, y: 0, z: 0, w: 1 }, right = { x: -1, y: 0, z: 0 };
  const rightBasis = { primaryLocal: right, secondaryLocal: { x: 0, y: 1, z: 0 }, binormalLocal: { x: 0, y: 0, z: -1 }, primaryWorld: right, secondaryWorld: { x: 0, y: 1, z: 0 }, binormalWorld: { x: 0, y: 0, z: -1 }, worldRotation: { x: 0, y: 1, z: 0, w: 0 } };
  const profile = freezeRigProfile({ version: 1, modelGeneration: 1, modelFingerprint: "fixture", torsoReference: { rightWorld: { x: 1, y: 0, z: 0 }, upWorld: { x: 0, y: 1, z: 0 }, forwardWorld: { x: 0, y: 0, z: 1 }, worldRotation: identity }, joints: {
    leftUpperArm: joint(upper, lower, "fixed-rest", null), leftLowerArm: joint(lower, hand, "controlled", "leftUpperArm"),
    rightUpperArm: { parentJoint: "rightShoulder", childJoint: "rightLowerArm", parentMode: "fixed-rest", controlledParentJoint: null, restLocalPosition: { x: 0, y: 0, z: 0 }, restLocalRotation: identity, restWorldPosition: { x: 0, y: 0, z: 0 }, restWorldRotation: identity, parentRestWorldRotation: identity, restWorldDirection: right, anatomicalRestBasis: rightBasis },
    rightLowerArm: { parentJoint: "rightUpperArm", childJoint: "rightHand", parentMode: "controlled", controlledParentJoint: "rightUpperArm", restLocalPosition: { x: -1, y: 0, z: 0 }, restLocalRotation: identity, restWorldPosition: { x: -1, y: 0, z: 0 }, restWorldRotation: identity, parentRestWorldRotation: identity, restWorldDirection: right, anatomicalRestBasis: rightBasis },
  } } satisfies NormalizedAvatarRigProfile);
  return { root, upper, lower, hand, profile };
}

function solveAndApply(value: ReturnType<typeof fixture>, upperTarget: Vector3, lowerTarget: Vector3) {
  const points = Array.from({ length: 33 }, () => landmark()); points[11] = landmark(); points[13] = landmark(upperTarget); points[15] = landmark(upperTarget.clone().add(lowerTarget));
  const result = solveParentLocalArmRotations(points, value.profile, false);
  const upperRest = value.profile.joints.leftUpperArm.restLocalRotation, lowerRest = value.profile.joints.leftLowerArm.restLocalRotation;
  const upperDelta = result.deltas.leftUpperArm!, lowerDelta = result.deltas.leftLowerArm!;
  value.upper.quaternion.set(upperRest.x, upperRest.y, upperRest.z, upperRest.w).multiply(new Quaternion(upperDelta.x, upperDelta.y, upperDelta.z, upperDelta.w));
  value.lower.quaternion.set(lowerRest.x, lowerRest.y, lowerRest.z, lowerRest.w).multiply(new Quaternion(lowerDelta.x, lowerDelta.y, lowerDelta.z, lowerDelta.w)); value.root.updateMatrixWorld(true);
  const upperResult = value.lower.getWorldPosition(new Vector3()).sub(value.upper.getWorldPosition(new Vector3())).normalize(); const lowerResult = value.hand.getWorldPosition(new Vector3()).sub(value.lower.getWorldPosition(new Vector3())).normalize();
  return { result, upperError: angularErrorDeg(vData(upperResult), vData(upperTarget)), lowerError: angularErrorDeg(vData(lowerResult), vData(lowerTarget)) };
}

describe("parent-local rest-relative arm solver", () => {
  it.each([
    ["identity parent", 0, 0], ["parent rotated 90 degrees", 0, Math.PI / 2], ["grandparent and parent rotated", Math.PI / 3, Math.PI / 4],
  ])("matches world targets with %s", (_label, grand, parent) => {
    const measured = solveAndApply(fixture(grand as number, parent as number), new Vector3(0, 1, 0), new Vector3(0, 0, 1));
    expect(measured.upperError).toBeLessThan(1e-4); expect(measured.lowerError).toBeLessThan(1e-4);
  });

  it("produces normalized finite deltas and no shoulder/hand rotations", () => {
    const { result } = solveAndApply(fixture(), new Vector3(0, 1, 0), new Vector3(0, 0, 1));
    expect(Object.keys(result.deltas).sort()).toEqual(["leftLowerArm", "leftUpperArm"]);
    for (const q of Object.values(result.deltas)) expect(Math.hypot(q!.x, q!.y, q!.z, q!.w)).toBeCloseTo(1);
  });

  it("omits zero directions without NaN", () => {
    const points = Array.from({ length: 33 }, () => landmark()); const result = solveParentLocalArmRotations(points, fixture().profile, false);
    expect(result.deltas).toEqual({}); expect(JSON.stringify(result)).not.toContain("NaN");
  });

  it("is absolute and independent of A-B-A history", () => {
    const value = fixture(); const a1 = solveAndApply(value, new Vector3(1, 0, 0), new Vector3(0, 1, 0)).result.deltas;
    solveAndApply(value, new Vector3(0, 1, 0), new Vector3(0, 0, 1)); const a2 = solveAndApply(value, new Vector3(1, 0, 0), new Vector3(0, 1, 0)).result.deltas;
    expect(a2).toEqual(a1);
  });

  it.each(["tPose", "armsDown", "leftArmUp", "rightArmUp", "leftElbow90", "rightElbow90"] as const)("keeps all controlled segment errors below 2 degrees for %s", (preset) => {
    const profile = fixture().profile; const landmarks = createDebugPreset(preset).pose.worldLandmarks!; const solved = solveParentLocalArmRotations(landmarks, profile, false);
    const indices: Record<ControlledArmJoint, [number, number]> = { leftUpperArm: [11, 13], leftLowerArm: [13, 15], rightUpperArm: [12, 14], rightLowerArm: [14, 16] };
    for (const name of Object.keys(indices) as ControlledArmJoint[]) {
      const targetWorld = solved.targetWorldRotations[name]; if (!targetWorld) continue;
      const rest = profile.joints[name]; const localAxis = new Vector3(rest.restWorldDirection.x, rest.restWorldDirection.y, rest.restWorldDirection.z).applyQuaternion(new Quaternion(rest.restWorldRotation.x, rest.restWorldRotation.y, rest.restWorldRotation.z, rest.restWorldRotation.w).invert());
      const resulting = localAxis.applyQuaternion(new Quaternion(targetWorld.x, targetWorld.y, targetWorld.z, targetWorld.w)); const [from, to] = indices[name]; const target = new Vector3(landmarks[to].x - landmarks[from].x, -(landmarks[to].y - landmarks[from].y), -(landmarks[to].z - landmarks[from].z));
      expect(angularErrorDeg(vData(resulting), vData(target))).toBeLessThanOrEqual(2);
    }
  });
});
