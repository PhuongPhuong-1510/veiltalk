import { Bone, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { AvatarRenderer } from "../avatar-renderer/avatarRenderer";
import type { AvatarPosePacketV1, QuaternionData, Vector3Data } from "./avatarPoseTypes";
import { computeHandForearmTwist } from "./handForearmTwist";
import { composePoseLowerArmWithHandTwist, HAND_TWIST_RIG_CONVENTION_V1, handWorldBasisToMotionFrame, normalizePalmBasisForTwist } from "./handTwistRig";
import { INITIAL_HAND_TWIST_STABILIZATION_STATE, updateHandTwistStabilization } from "./handTwistStabilization";

const DEG = Math.PI / 180;
const qData = (value: Quaternion): QuaternionData => ({ x: value.x, y: value.y, z: value.z, w: value.w });
const vData = (value: Vector3): Vector3Data => ({ x: value.x, y: value.y, z: value.z });
const dotQ = (a: QuaternionData, b: QuaternionData) => Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);

function signedAngleAround(axis: Vector3, from: Vector3, to: Vector3): number {
  const a = from.clone().addScaledVector(axis, -from.dot(axis)).normalize();
  const b = to.clone().addScaledVector(axis, -to.dot(axis)).normalize();
  return Math.atan2(new Vector3().crossVectors(a, b).dot(axis), a.dot(b));
}

function palmBasis(normal: Vector3Data) {
  return { across: { x: 0, y: 1, z: 0 }, forward: { x: 0, y: 0, z: 1 }, normal };
}

function solveV1(side: "left" | "right", forearmAxis: Vector3, reference: Vector3, rawNormal: Vector3) {
  const normalized = normalizePalmBasisForTwist(side, palmBasis(vData(rawNormal)));
  return computeHandForearmTwist({
    side,
    forearmAxis: vData(forearmAxis),
    palmBasis: normalized.basis,
    palmBasisQuality: 1,
    palmDirectionAxis: HAND_TWIST_RIG_CONVENTION_V1.selectedPalmAxis,
    referenceDirection: vData(reference),
    positiveSign: HAND_TWIST_RIG_CONVENTION_V1.configuredPositiveSign[side],
  });
}

function motionToMediaPipeWorld(value: Vector3): Vector3 {
  // Inverse bằng chính nó: motion = (x,-y,-z).
  return new Vector3(value.x, -value.y, -value.z);
}

function rawNormalForPhysical(side: "left" | "right", physicalMotionNormal: Vector3): Vector3 {
  const beforeChirality = physicalMotionNormal.clone().multiplyScalar(side === "left" ? -1 : 1);
  return motionToMediaPipeWorld(beforeChirality);
}

function packet(lowerName: "leftLowerArm" | "rightLowerArm", delta: QuaternionData): AvatarPosePacketV1 {
  const trackingPart = { sourceState: "tracked" as const, sampledAtMs: 100, outputState: "active" as const };
  return {
    version: 1, sequence: 1, sourceFrameTimestampMs: 100, processedTimestampMs: 100,
    tracking: { face: trackingPart, leftHand: trackingPart, rightHand: trackingPart, pose: trackingPart },
    expressions: {}, headRotation: null, jointRotations: { [lowerName]: delta }, handMotion: null,
  };
}

function rendererProbe(lowerName: "leftLowerArm" | "rightLowerArm", handName: "leftHand" | "rightHand", axis: Vector3) {
  const lower = new Bone(); lower.name = lowerName;
  const hand = new Bone(); hand.name = handName; hand.position.copy(axis);
  const handRest = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.2);
  hand.quaternion.copy(handRest); lower.add(hand); lower.updateMatrixWorld(true);
  const renderer = Object.create(AvatarRenderer.prototype) as AvatarRenderer;
  Object.assign(renderer as unknown as Record<string, unknown>, {
    smoothing: false,
    currentRotations: {},
    model: {
      bones: { [lowerName]: lower, [handName]: hand },
      restRotations: { [lowerName]: qData(new Quaternion()), [handName]: qData(handRest) },
      expressionMap: {}, morphTargets: new Map(), vrm: null,
    },
  });
  const applyTarget = (renderer as unknown as { applyTarget(value: AvatarPosePacketV1, dt: number): void }).applyTarget.bind(renderer);
  return { lower, hand, handRest, applyTarget };
}

describe("2B-5C rig-only lowerArm twist", () => {
  for (const side of ["left", "right"] as const) {
    const lowerName = `${side}LowerArm` as const;
    const handName = `${side}Hand` as const;
    const axis = new Vector3(side === "left" ? 1 : -1, 0, 0);

    it(`${side}: +45° rotates the inherited hand frame while preserving lowerArm primary and wrist position`, () => {
      const { lower, hand, handRest, applyTarget } = rendererProbe(lowerName, handName, axis);
      const wristBefore = hand.getWorldPosition(new Vector3());
      const handNormalBefore = new Vector3(0, 1, 0).applyQuaternion(hand.getWorldQuaternion(new Quaternion()));
      const output = composePoseLowerArmWithHandTwist(qData(new Quaternion()), vData(axis), 45 * DEG)!;
      applyTarget(packet(lowerName, output), 1 / 60); lower.updateMatrixWorld(true);
      const primaryAfter = axis.clone().applyQuaternion(lower.getWorldQuaternion(new Quaternion()));
      const handNormalAfter = new Vector3(0, 1, 0).applyQuaternion(hand.getWorldQuaternion(new Quaternion()));
      expect(primaryAfter.distanceTo(axis)).toBeLessThan(1e-7);
      expect(hand.getWorldPosition(new Vector3()).distanceTo(wristBefore)).toBeLessThan(1e-7);
      expect(signedAngleAround(axis, handNormalBefore, handNormalAfter)).toBeCloseTo(45 * DEG, 6);
      expect(dotQ(qData(hand.quaternion), qData(handRest))).toBeCloseTo(1, 7);
    });

    it(`${side}: -45° is clearly opposite and A-B-A does not drift`, () => {
      const { lower, hand, applyTarget } = rendererProbe(lowerName, handName, axis);
      const wristBefore = hand.getWorldPosition(new Vector3());
      const positive = composePoseLowerArmWithHandTwist(qData(new Quaternion()), vData(axis), 45 * DEG)!;
      const negative = composePoseLowerArmWithHandTwist(qData(new Quaternion()), vData(axis), -45 * DEG)!;
      applyTarget(packet(lowerName, positive), 1 / 60); lower.updateMatrixWorld(true);
      const firstPositive = qData(lower.quaternion);
      const positiveNormal = new Vector3(0, 1, 0).applyQuaternion(lower.getWorldQuaternion(new Quaternion()));
      applyTarget({ ...packet(lowerName, negative), sequence: 2 }, 1 / 60); lower.updateMatrixWorld(true);
      const negativeNormal = new Vector3(0, 1, 0).applyQuaternion(lower.getWorldQuaternion(new Quaternion()));
      expect(signedAngleAround(axis, positiveNormal, negativeNormal)).toBeCloseTo(-90 * DEG, 6);
      expect(hand.getWorldPosition(new Vector3()).distanceTo(wristBefore)).toBeLessThan(1e-7);
      applyTarget({ ...packet(lowerName, positive), sequence: 3 }, 1 / 60); lower.updateMatrixWorld(true);
      expect(dotQ(qData(lower.quaternion), firstPositive)).toBeCloseTo(1, 7);
    });
  }
});

describe("2B-5C synthetic palm-normal geometry", () => {
  const axis = new Vector3(1, 0, 0);
  const reference = new Vector3(0, 1, 0);

  it("raw physical neutral, +45° and -45° produce the expected signed angle for both sides", () => {
    for (const side of ["left", "right"] as const) {
      for (const angle of [0, 45 * DEG, -45 * DEG]) {
        const physical = reference.clone().applyAxisAngle(axis, angle);
        const result = solveV1(side, axis, reference, rawNormalForPhysical(side, physical));
        expect(result.twistRadians).toBeCloseTo(angle, 7);
        expect(result.twistRadians! * HAND_TWIST_RIG_CONVENTION_V1.rigApplicationSign[side]).toBeCloseTo(angle, 7);
      }
    }
  });

  it("unwrap crosses +179°→-179° by the shortest path", () => {
    const config = { deadZoneRadians: 0, targetFilterTimeConstantSeconds: 0, minCorrectionRadians: -4, maxCorrectionRadians: 4 };
    const first = updateHandTwistStabilization(INITIAL_HAND_TWIST_STABILIZATION_STATE, {
      rawWrappedTwistRadians: 179 * DEG, nowMs: 0, dtSeconds: 1 / 30, reanchorNeutral: false, reanchorReason: null,
    }, config)!;
    const second = updateHandTwistStabilization(first.state, {
      rawWrappedTwistRadians: -179 * DEG, nowMs: 33, dtSeconds: 1 / 30, reanchorNeutral: false, reanchorReason: null,
    }, config)!;
    expect(second.rawUnwrappedTwistRadians - first.rawUnwrappedTwistRadians).toBeCloseTo(2 * DEG, 7);
    expect(second.correctedTwistRadians).toBeCloseTo(2 * DEG, 7);
  });

  it("neutral/dead-zone/filter/clamp do not erase a valid +45° correction", () => {
    const config = { deadZoneRadians: 3 * DEG, targetFilterTimeConstantSeconds: 0.08, minCorrectionRadians: -75 * DEG, maxCorrectionRadians: 75 * DEG };
    const neutral = updateHandTwistStabilization(INITIAL_HAND_TWIST_STABILIZATION_STATE, {
      rawWrappedTwistRadians: 0, nowMs: 0, dtSeconds: 1 / 30, reanchorNeutral: false, reanchorReason: null,
    }, config)!;
    const moved = updateHandTwistStabilization(neutral.state, {
      rawWrappedTwistRadians: 45 * DEG, nowMs: 33, dtSeconds: 1 / 30, reanchorNeutral: false, reanchorReason: null,
    }, config)!;
    expect(moved.correctedTwistRadians).toBeCloseTo(45 * DEG, 7);
    expect(moved.deadZoneOutputRadians).toBeCloseTo(42 * DEG, 7);
    expect(moved.filteredTargetTwistRadians).toBeGreaterThan(0);
    expect(moved.clampedTwistRadians).toBeGreaterThan(0);
    expect(moved.clampApplied).toBe(false);
  });

  it("rejects a palm normal parallel to the forearm axis", () => {
    const result = solveV1("right", axis, reference, rawNormalForPhysical("right", axis));
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe("projection-degenerate");
  });
});

describe("2B-5C Pose-Hand coordinate-frame contract", () => {
  it("interprets a MediaPipe Hand normal in the same (x,-y,-z) motion frame as Pose", () => {
    const axisMotion = new Vector3(0.61, 0.32, 0.72).normalize();
    const referenceMotion = new Vector3(0, 1, 0).addScaledVector(axisMotion, -axisMotion.y).normalize();
    const palmMotion = referenceMotion.clone().applyAxisAngle(axisMotion, 45 * DEG);
    const rawMediaPipePalm = motionToMediaPipeWorld(palmMotion);

    // Đường production phải đổi raw Hand world basis tại boundary trước khi so với
    // forearmAxis/reference vốn đã ở motion frame.
    const current = solveV1("right", axisMotion, referenceMotion, rawMediaPipePalm);
    expect(current.twistRadians).toBeCloseTo(45 * DEG, 6);

    const negativePalmMotion = referenceMotion.clone().applyAxisAngle(axisMotion, -45 * DEG);
    const negative = solveV1("right", axisMotion, referenceMotion, motionToMediaPipeWorld(negativePalmMotion));
    expect(negative.twistRadians).toBeCloseTo(-45 * DEG, 6);
  });

  it("coordinate-boundary helper converts the complete raw basis before the solver", () => {
    const axisMotion = new Vector3(0.61, 0.32, 0.72).normalize();
    const referenceMotion = new Vector3(0, 1, 0).addScaledVector(axisMotion, -axisMotion.y).normalize();
    const palmMotion = referenceMotion.clone().applyAxisAngle(axisMotion, 45 * DEG);
    const rawMediaPipePalm = motionToMediaPipeWorld(palmMotion);
    const converted = handWorldBasisToMotionFrame(palmBasis(vData(rawMediaPipePalm)));
    expect(new Vector3(converted.normal.x, converted.normal.y, converted.normal.z).distanceTo(palmMotion)).toBeLessThan(1e-7);
    expect(converted.across).toEqual({ x: 0, y: -1, z: -0 });
    expect(converted.forward).toEqual({ x: 0, y: -0, z: -1 });
  });
});
