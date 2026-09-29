import { describe, expect, it } from "vitest";
import { Euler, Quaternion, Vector3 } from "three";
import { computeWristSwing, type WristSwingConfig } from "./wristSwing";

const qd = (q: Quaternion) => ({ x: q.x, y: q.y, z: q.z, w: q.w });
const vd = (v: Vector3) => ({ x: v.x, y: v.y, z: v.z });
const EPS = 1e-5;

const TEST_CONFIG: WristSwingConfig = {
  minimumQuality: 0,
  straightDeadZoneRadians: 0,
  smoothingTimeConstantSeconds: 0,
  holdMs: 0,
  returnMs: 0,
  limits: {
    flexionRadians: Math.PI / 2 - 1e-3,
    extensionRadians: Math.PI / 2 - 1e-3,
    radialDeviationRadians: Math.PI / 2 - 1e-3,
    ulnarDeviationRadians: Math.PI / 2 - 1e-3,
  },
};

function angle(a: Vector3, b: Vector3): number {
  return a.clone().normalize().angleTo(b.clone().normalize());
}

describe("model-aware wrist swing retarget", () => {
  it("conjugates world swing through the baseline HAND frame, not only the lower-arm frame", () => {
    const lowerWorld = new Quaternion().setFromEuler(new Euler(0.15, -0.25, 0.35, "XYZ")).normalize();
    // Deliberately non-identity VRM hand rest: this is the case the old implementation mishandled.
    const handRestLocal = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 28 * Math.PI / 180).normalize();
    const palmForwardLocal = new Vector3(1, 0, 0);
    const axisWorld = new Vector3(1, 0, 0).applyQuaternion(lowerWorld).normalize();
    const referenceWorld = new Vector3(0, 1, 0).applyQuaternion(lowerWorld).normalize();
    const desiredForward = axisWorld.clone().addScaledVector(referenceWorld, Math.tan(22 * Math.PI / 180)).normalize();

    const solved = computeWristSwing({
      forearmAxisWorld: vd(axisWorld),
      bendReferenceWorld: vd(referenceWorld),
      palmForwardWorld: vd(desiredForward),
      lowerArmWorldRotation: qd(lowerWorld),
      quality: 1,
      handRestLocalRotation: qd(handRestLocal),
      rigPalmForwardLocal: vd(palmForwardLocal),
    }, TEST_CONFIG);

    expect(solved.accepted).toBe(true);
    expect(solved.localRotation).not.toBeNull();
    const delta = new Quaternion(
      solved.localRotation!.x, solved.localRotation!.y, solved.localRotation!.z, solved.localRotation!.w,
    );
    // Exact renderer contract: local = rest * delta, then parent world * local.
    const finalHandWorld = lowerWorld.clone().multiply(handRestLocal).multiply(delta).normalize();
    const renderedPalmForward = palmForwardLocal.clone().applyQuaternion(finalHandWorld).normalize();
    expect(angle(renderedPalmForward, desiredForward)).toBeLessThan(EPS);
  });

  it("returns identity when the rig palm direction already equals the bounded observation", () => {
    const lowerWorld = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 35 * Math.PI / 180).normalize();
    const handRestLocal = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 20 * Math.PI / 180).normalize();
    const palmForwardLocal = new Vector3(1, 0, 0);
    const baselineHandWorld = lowerWorld.clone().multiply(handRestLocal).normalize();
    const observed = palmForwardLocal.clone().applyQuaternion(baselineHandWorld).normalize();
    const axis = new Vector3(1, 0, 0).applyQuaternion(lowerWorld).normalize();
    const reference = new Vector3(0, 1, 0).applyQuaternion(lowerWorld).normalize();

    const solved = computeWristSwing({
      forearmAxisWorld: vd(axis), bendReferenceWorld: vd(reference), palmForwardWorld: vd(observed),
      lowerArmWorldRotation: qd(lowerWorld), quality: 1,
      handRestLocalRotation: qd(handRestLocal), rigPalmForwardLocal: vd(palmForwardLocal),
    }, TEST_CONFIG);

    expect(solved.accepted).toBe(true);
    const delta = new Quaternion(solved.localRotation!.x, solved.localRotation!.y, solved.localRotation!.z, solved.localRotation!.w);
    expect(2 * Math.acos(Math.min(1, Math.abs(delta.w)))).toBeLessThan(EPS);
  });

  it("keeps the legacy parent-frame path available for old fixtures that omit rig hand data", () => {
    const solved = computeWristSwing({
      forearmAxisWorld: { x: 1, y: 0, z: 0 },
      bendReferenceWorld: { x: 0, y: 1, z: 0 },
      palmForwardWorld: { x: Math.cos(0.2), y: Math.sin(0.2), z: 0 },
      lowerArmWorldRotation: { x: 0, y: 0, z: 0, w: 1 },
      quality: 1,
    }, TEST_CONFIG);
    expect(solved.accepted).toBe(true);
    expect(solved.flexionRadians).toBeCloseTo(0.2, 5);
  });
});
