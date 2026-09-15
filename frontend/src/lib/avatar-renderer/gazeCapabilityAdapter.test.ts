import { describe, expect, it } from "vitest";
import { Object3D, Quaternion, Vector3 } from "three";
import { VRMLookAtBoneApplier, VRMLookAtExpressionApplier, type VRM } from "@pixiv/three-vrm";
import { buildGazeEyelidSupport, GazeCapabilityAdapter } from "./gazeCapabilityAdapter";

const range = (inputMaxValue: number, outputScale = 1) => ({ inputMaxValue, outputScale });

function lookAtVrm(kind: "bone" | "expression") {
  const prototype = kind === "bone" ? VRMLookAtBoneApplier.prototype : VRMLookAtExpressionApplier.prototype;
  const applier = Object.assign(Object.create(prototype), {
    rangeMapHorizontalOuter: range(30), rangeMapHorizontalInner: range(30),
    rangeMapVerticalUp: range(20), rangeMapVerticalDown: range(15),
  });
  const state = { yaw: 0, pitch: 0, resets: 0 };
  const lookAt = { applier, autoUpdate: true, get yaw() { return state.yaw; }, set yaw(value: number) { state.yaw = value; }, get pitch() { return state.pitch; }, set pitch(value: number) { state.pitch = value; }, reset() { state.yaw = 0; state.pitch = 0; state.resets += 1; } };
  return { vrm: { lookAt, humanoid: { getNormalizedBoneNode: () => null } } as unknown as VRM, state, applier };
}

function eyeBoneVrm(partial = false) {
  const head = new Object3D(), leftEye = new Object3D(), rightEye = new Object3D();
  head.add(leftEye); if (!partial) head.add(rightEye);
  leftEye.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), .1);
  const nodes: Record<string, Object3D | null> = { head, leftEye, rightEye: partial ? null : rightEye };
  return { vrm: { lookAt: null, humanoid: { getNormalizedBoneNode: (name: string) => nodes[name] ?? null } } as unknown as VRM, leftEye, rightEye };
}

describe("GazeCapabilityAdapter", () => {
  it("distinguishes usable VRM bone and expression appliers and applies one LookAt path", () => {
    for (const kind of ["bone", "expression"] as const) {
      const { vrm, state } = lookAtVrm(kind); const adapter = new GazeCapabilityAdapter(vrm);
      expect(adapter.capability.kind).toBe(`vrm-look-at-${kind}`);
      expect(adapter.capability.handlesVerticalEyelid).toBe(kind === "expression");
      adapter.apply({ version: 1, yaw: .5, pitch: .5 });
      expect(state.yaw).toBeCloseTo(12.75);
      expect(state.pitch).toBeCloseTo(-8.5);
    }
  });

  it("uses rest-relative non-accumulating local eye rotations", () => {
    const { vrm, leftEye, rightEye } = eyeBoneVrm(); const leftRest = leftEye.quaternion.clone();
    const adapter = new GazeCapabilityAdapter(vrm); expect(adapter.capability.kind).toBe("eye-bones");
    adapter.apply({ version: 1, yaw: .5, pitch: 0 }); const once = leftEye.quaternion.clone();
    adapter.apply({ version: 1, yaw: .5, pitch: 0 }); expect(leftEye.quaternion.angleTo(once)).toBeCloseTo(0);
    expect(leftEye.quaternion.angleTo(leftRest)).toBeGreaterThan(.1);
    adapter.reset(); expect(leftEye.quaternion.angleTo(leftRest)).toBeCloseTo(0); expect(rightEye.quaternion.equals(new Quaternion())).toBe(true);
  });

  it("treats partial eyes as unsupported and rejects nonfinite packets safely", () => {
    expect(new GazeCapabilityAdapter(eyeBoneVrm(true).vrm).capability.kind).toBe("unsupported");
    const { vrm, leftEye } = eyeBoneVrm(); const adapter = new GazeCapabilityAdapter(vrm); const rest = leftEye.quaternion.clone();
    adapter.apply({ version: 1, yaw: Number.NaN, pitch: 0 });
    expect(adapter.snapshot().rejected).toBe("nonfinite"); expect(leftEye.quaternion.angleTo(rest)).toBeCloseTo(0);
  });

  it("does not call a LookAt object usable when a required range map is invalid", () => {
    const { vrm, applier } = lookAtVrm("bone"); applier.rangeMapHorizontalInner.outputScale = 0;
    expect(new GazeCapabilityAdapter(vrm).capability.kind).toBe("unsupported");
  });

  it("enables eyelid coupling only for exact verified/profile semantics", () => {
    const capability = { kind: "eye-bones" as const, yawLeftLimit: 30, yawRightLimit: 30, pitchUpLimit: 20, pitchDownLimit: 20, handlesVerticalEyelid: false };
    expect(buildGazeEyelidSupport(capability, { eyeLidDownLeft: "verified-1", blinkLeft: "blink" })).toEqual({ handlesVerticalEyelid: false, targets: { downLeft: true, downRight: false, upLeft: false, upRight: false } });
  });
});
