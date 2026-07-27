import { Quaternion, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import { solveAnatomicalArmFrames, type ArmGeometryHistory } from "./armFrameSolver";
import { DEFAULT_AVATAR_MOTION_CONFIG } from "./motionConfig";
import type { NormalizedAvatarRigProfile } from "./normalizedRigProfile";
import { createDebugPreset, type DebugPresetName } from "../avatar-renderer/avatarDiagnostics";

const identity = { x: 0, y: 0, z: 0, w: 1 }; const zero = { x: 0, y: 0, z: 0 };
const leftBasis = { primaryLocal: { x: 1, y: 0, z: 0 }, secondaryLocal: { x: 0, y: 1, z: 0 }, binormalLocal: { x: 0, y: 0, z: 1 }, primaryWorld: { x: 1, y: 0, z: 0 }, secondaryWorld: { x: 0, y: 1, z: 0 }, binormalWorld: { x: 0, y: 0, z: 1 }, worldRotation: identity };
const rightBasis = { primaryLocal: { x: -1, y: 0, z: 0 }, secondaryLocal: { x: 0, y: 1, z: 0 }, binormalLocal: { x: 0, y: 0, z: -1 }, primaryWorld: { x: -1, y: 0, z: 0 }, secondaryWorld: { x: 0, y: 1, z: 0 }, binormalWorld: { x: 0, y: 0, z: -1 }, worldRotation: { x: 0, y: 1, z: 0, w: 0 } };
const profile: NormalizedAvatarRigProfile = { version: 1, modelGeneration: 1, modelFingerprint: "test", torsoReference: { rightWorld: { x: 1, y: 0, z: 0 }, upWorld: { x: 0, y: 1, z: 0 }, forwardWorld: { x: 0, y: 0, z: 1 }, worldRotation: identity }, joints: {
  leftUpperArm: { parentJoint: "leftShoulder", childJoint: "leftLowerArm", parentMode: "fixed-rest", controlledParentJoint: null, restLocalPosition: zero, restLocalRotation: identity, restWorldPosition: zero, restWorldRotation: identity, parentRestWorldRotation: identity, restWorldDirection: leftBasis.primaryWorld, anatomicalRestBasis: leftBasis },
  leftLowerArm: { parentJoint: "leftUpperArm", childJoint: "leftHand", parentMode: "controlled", controlledParentJoint: "leftUpperArm", restLocalPosition: zero, restLocalRotation: identity, restWorldPosition: zero, restWorldRotation: identity, parentRestWorldRotation: identity, restWorldDirection: leftBasis.primaryWorld, anatomicalRestBasis: leftBasis },
  rightUpperArm: { parentJoint: "rightShoulder", childJoint: "rightLowerArm", parentMode: "fixed-rest", controlledParentJoint: null, restLocalPosition: zero, restLocalRotation: identity, restWorldPosition: zero, restWorldRotation: identity, parentRestWorldRotation: identity, restWorldDirection: rightBasis.primaryWorld, anatomicalRestBasis: rightBasis },
  rightLowerArm: { parentJoint: "rightUpperArm", childJoint: "rightHand", parentMode: "controlled", controlledParentJoint: "rightUpperArm", restLocalPosition: zero, restLocalRotation: identity, restWorldPosition: zero, restWorldRotation: identity, parentRestWorldRotation: identity, restWorldDirection: rightBasis.primaryWorld, anatomicalRestBasis: rightBasis },
} };
const lm = (x: number, y: number, z = 0): RawNormalizedLandmarkV1 => ({ x, y: -y, z: -z, visibility: 1 });
const q3 = (value: { x: number; y: number; z: number; w: number }) => new Quaternion(value.x, value.y, value.z, value.w);
const frame = (straight = false) => { const p = Array.from({ length: 33 }, () => lm(0, 0)); p[11] = lm(0, 0); p[13] = lm(1, 0); p[15] = straight ? lm(2, 0) : lm(1, 1); p[12] = lm(0, 0); p[14] = lm(-1, 0); p[16] = straight ? lm(-2, 0) : lm(-1, 1); p[23] = lm(.2, -1); p[24] = lm(-.2, -1); return p; };
const imageFrame = (world: RawNormalizedLandmarkV1[]) => world.map((point) => ({ ...point, x: .5 + point.x * .2, y: .5 + point.y * .2 }));
const emptyHistory = (): ArmGeometryHistory => ({ previousPole: null, previousPoleWasFresh: false, previousDepthDegenerate: false, lastValidPoleAtMs: null });
describe("three-point anatomical arm-frame solver", () => {
  it("matches upper/lower directions and uses a fresh elbow-offset pole", () => {
    const world = frame(); const result = solveAnatomicalArmFrames(world, imageFrame(world), profile, { left: emptyHistory(), right: emptyHistory() }, 0, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false);
    for (const side of ["left", "right"] as const) {
      const solved = result.sides[side]!; expect(solved.poleSource).toBe("fresh");
      const upperName = side === "left" ? "leftUpperArm" : "rightUpperArm"; const lowerName = side === "left" ? "leftLowerArm" : "rightLowerArm";
      const upperDirection = new Vector3(side === "left" ? 1 : -1, 0, 0).applyQuaternion(q3(solved.targetWorldRotations[upperName]!));
      const lowerDirection = new Vector3(side === "left" ? 1 : -1, 0, 0).applyQuaternion(q3(solved.targetWorldRotations[lowerName]!));
      expect(upperDirection.angleTo(new Vector3(side === "left" ? 1 : -1, 0, 0))).toBeLessThan(1e-6); expect(lowerDirection.angleTo(new Vector3(0, 1, 0))).toBeLessThan(1e-6);
    }
  });
  it("uses previous pole near straight, then rest pole after timeout", () => {
    const previous = { previousPole: { x: 0, y: 1, z: 0 }, previousPoleWasFresh: true, previousDepthDegenerate: false, lastValidPoleAtMs: 0 }; const world = frame(true);
    expect(solveAnatomicalArmFrames(world, imageFrame(world), profile, { left: previous, right: previous }, 100, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false).sides.left?.poleSource).toBe("previous");
    expect(solveAnatomicalArmFrames(world, imageFrame(world), profile, { left: previous, right: previous }, 1_000, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false).sides.left?.poleSource).toBe("rest");
  });
  it.each(["tPose", "armsDown", "leftArmUp", "rightArmUp", "leftElbow90", "rightElbow90"] as DebugPresetName[])("keeps Phase 2 direction accuracy for %s", (preset) => {
    const landmarks = createDebugPreset(preset).pose.worldLandmarks!;
    const image = createDebugPreset(preset).pose.landmarks!; const result = solveAnatomicalArmFrames(landmarks, image, profile, { left: emptyHistory(), right: emptyHistory() }, 0, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false);
    for (const side of ["left", "right"] as const) {
      const indices = side === "left" ? { shoulder: 11, elbow: 13, wrist: 15, upper: "leftUpperArm" as const, lower: "leftLowerArm" as const, rest: new Vector3(1, 0, 0) } : { shoulder: 12, elbow: 14, wrist: 16, upper: "rightUpperArm" as const, lower: "rightLowerArm" as const, rest: new Vector3(-1, 0, 0) };
      const semantic = (index: number) => new Vector3(landmarks[index].x, -landmarks[index].y, -landmarks[index].z);
      const upperTarget = semantic(indices.elbow).sub(semantic(indices.shoulder)).normalize(); const lowerTarget = semantic(indices.wrist).sub(semantic(indices.elbow)).normalize(); const solved = result.sides[side]!;
      expect(indices.rest.clone().applyQuaternion(q3(solved.targetWorldRotations[indices.upper]!)).angleTo(upperTarget) * 180 / Math.PI).toBeLessThanOrEqual(3);
      expect(indices.rest.clone().applyQuaternion(q3(solved.targetWorldRotations[indices.lower]!)).angleTo(lowerTarget) * 180 / Math.PI).toBeLessThanOrEqual(3);
    }
  });
  it("rejects a zero-length segment without NaN", () => {
    const points = frame(); points[13] = points[11]; expect(solveAnatomicalArmFrames(points, imageFrame(points), profile, { left: emptyHistory(), right: emptyHistory() }, 0, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false).sides.left).toBeNull();
  });
  it("keeps upper tracking when its wrist leaves image bounds and does not update lower/pole filters", () => {
    const world = frame(), image = imageFrame(world); image[15].x = 1.2; const directionFilter = vi.fn((_name, value) => value), poleFilter = vi.fn((_side, value) => value);
    const result = solveAnatomicalArmFrames(world, image, profile, { left: emptyHistory(), right: emptyHistory() }, 0, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false, directionFilter, poleFilter);
    expect(result.sides.left?.segmentValidity).toEqual({ upper: true, lower: false }); expect(result.diagnostics.left.observation.lowerRejectionReason).toBe("wrist-outside-frame"); expect(result.sides.right).not.toBeNull();
    expect(directionFilter.mock.calls.some(([name]) => name === "leftUpperArm")).toBe(true); expect(directionFilter.mock.calls.some(([name]) => name === "leftLowerArm")).toBe(false); expect(poleFilter.mock.calls.every(([side]) => side === "right")).toBe(true);
  });
  it("keeps primary tracking but falls back from a depth-degenerate fresh pole", () => {
    const world = frame(); world[11] = lm(0, 0, 0); world[13] = lm(.2, 0, .5); world[15] = lm(0, 0, 1); const image = imageFrame(world);
    const previous = { previousPole: { x: 0, y: 1, z: 0 }, previousPoleWasFresh: true, previousDepthDegenerate: false, lastValidPoleAtMs: 0 };
    const result = solveAnatomicalArmFrames(world, image, profile, { left: previous, right: emptyHistory() }, 100, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false);
    expect(result.sides.left?.poleSource).toBe("previous"); expect(result.diagnostics.left.confidenceFlags).toContain("depth-degenerate");
    const armAxis = new Vector3(0, 0, 1); const projected = result.sides.left!.acceptedPole; expect(Math.abs(armAxis.dot(new Vector3(projected.x, projected.y, projected.z)))).toBeLessThan(1e-6);
  });
  it("parallel-transports secondary axes when the pole is unavailable", () => {
    const world = frame(); world[15] = lm(2, 0); const image = imageFrame(world);
    const history: ArmGeometryHistory = { previousPole: null, previousPoleWasFresh: false, previousDepthDegenerate: false, lastValidPoleAtMs: null,
      previousPrimary: { upper: { x: 0, y: 1, z: 0 }, lower: { x: 0, y: 1, z: 0 } }, previousSecondary: { upper: { x: 0, y: 0, z: 1 }, lower: { x: 0, y: 0, z: 1 } } };
    const solved = solveAnatomicalArmFrames(world, image, profile, { left: history, right: emptyHistory() }, 100, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false).sides.left!;
    expect(solved.diagnostic.observation.poleValid).toBe(false); expect(solved.secondary.upper.z).toBeGreaterThan(.99); expect(solved.secondary.lower!.z).toBeGreaterThan(.99);
  });
  it("infers an elbow from observed shoulder/wrist and calibrated human lengths", () => {
    const world = frame(), image = imageFrame(world); image[13].visibility = 0;
    const history: ArmGeometryHistory = { previousPole: { x: 0, y: 1, z: 0 }, previousPoleWasFresh: true, previousDepthDegenerate: false, lastValidPoleAtMs: 0,
      calibratedLength: { upper: 1, lower: 1 }, previousObservedElbow: { x: 1, y: 0, z: 0 }, inferenceStartedAtMs: null };
    const solved = solveAnatomicalArmFrames(world, image, profile, { left: history, right: emptyHistory() }, 100, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false).sides.left!;
    expect(solved.elbowSource).toBe("inferred-history"); expect(solved.segmentValidity).toEqual({ upper: true, lower: true });
    expect(solved.diagnostic.elbowInference.confidence).toBeGreaterThan(0); expect(solved.diagnostic.observation.poleValid).toBe(false);
  });
  it("rejects unreachable or expired elbow inference", () => {
    const world = frame(), image = imageFrame(world); image[13].visibility = 0; world[15] = lm(4, 0); image[15] = { ...image[15], x: .7, y: .5 };
    const history: ArmGeometryHistory = { previousPole: { x: 0, y: 1, z: 0 }, previousPoleWasFresh: true, previousDepthDegenerate: false, lastValidPoleAtMs: 0, calibratedLength: { upper: 1, lower: 1 }, inferenceStartedAtMs: 0 };
    const unreachable = solveAnatomicalArmFrames(world, image, profile, { left: history, right: emptyHistory() }, 100, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false);
    expect(unreachable.sides.left).toBeNull(); expect(unreachable.diagnostics.left.hardRejectionReason).toBe("elbow-inference-unreachable");
    world[15] = lm(1, 1); const expired = solveAnatomicalArmFrames(world, imageFrame(world).map((p, index) => index === 13 ? { ...p, visibility: 0 } : p), profile, { left: history, right: emptyHistory() }, 1_300, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false);
    expect(expired.sides.left).toBeNull(); expect(expired.diagnostics.left.hardRejectionReason).toBe("elbow-inference-timeout");
  });
  it("converts through a non-identity ancestor while preserving world directions", () => {
    const rotated = structuredClone(profile); const ancestor = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 3);
    const primary = new Vector3(1, 0, 0).applyQuaternion(ancestor); const secondary = new Vector3(0, 1, 0).applyQuaternion(ancestor); const binormal = new Vector3(0, 0, 1).applyQuaternion(ancestor);
    for (const name of ["leftUpperArm", "leftLowerArm"] as const) {
      rotated.joints[name].restWorldRotation = { x: ancestor.x, y: ancestor.y, z: ancestor.z, w: ancestor.w };
      rotated.joints[name].parentRestWorldRotation = { x: ancestor.x, y: ancestor.y, z: ancestor.z, w: ancestor.w };
      rotated.joints[name].restWorldDirection = { x: primary.x, y: primary.y, z: primary.z };
      rotated.joints[name].anatomicalRestBasis = { ...rotated.joints[name].anatomicalRestBasis, primaryWorld: { x: primary.x, y: primary.y, z: primary.z }, secondaryWorld: { x: secondary.x, y: secondary.y, z: secondary.z }, binormalWorld: { x: binormal.x, y: binormal.y, z: binormal.z }, worldRotation: { x: ancestor.x, y: ancestor.y, z: ancestor.z, w: ancestor.w } };
    }
    const world = frame(); const solved = solveAnatomicalArmFrames(world, imageFrame(world), rotated, { left: emptyHistory(), right: emptyHistory() }, 0, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false).sides.left!;
    expect(new Vector3(1, 0, 0).applyQuaternion(q3(solved.targetWorldRotations.leftUpperArm!)).angleTo(new Vector3(1, 0, 0))).toBeLessThan(1e-6);
    expect(new Vector3(1, 0, 0).applyQuaternion(q3(solved.targetWorldRotations.leftLowerArm!)).angleTo(new Vector3(0, 1, 0))).toBeLessThan(1e-6);
  });
});
