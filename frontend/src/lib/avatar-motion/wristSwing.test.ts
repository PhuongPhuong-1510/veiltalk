import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { computeWristSwing, createWristSwingTemporalState, DEFAULT_WRIST_SWING_CONFIG, handWorldVectorToAvatarSemantic, updateWristSwingTemporal } from "./wristSwing";
const q = { x: 0, y: 0, z: 0, w: 1 };
const input = (forward: {x:number;y:number;z:number}, quality=1) => ({ forearmAxisWorld:{x:1,y:0,z:0}, bendReferenceWorld:{x:0,y:1,z:0}, palmForwardWorld:forward, lowerArmWorldRotation:q, quality });
describe("wrist swing", () => {
  it("keeps a straight hand at identity", () => expect(computeWristSwing(input({x:1,y:0,z:0})).localRotation).toEqual(q));
  it("bends the hand without adding forearm-axis twist", () => { const r=computeWristSwing(input({x:1,y:1,z:0})); const v=new Vector3(1,0,0).applyQuaternion(new Quaternion(r.localRotation!.x,r.localRotation!.y,r.localRotation!.z,r.localRotation!.w)); expect(v.y).toBeGreaterThan(.5); expect(Math.abs(r.localRotation!.x)).toBeLessThan(1e-8); });
  it("clamps extreme flexion", () => { const r=computeWristSwing(input({x:.1,y:1,z:0})); expect(r.flexionRadians).toBeCloseTo(DEFAULT_WRIST_SWING_CONFIG.limits.flexionRadians); expect(r.limited).toBe(true); });
  it("rejects low confidence", () => expect(computeWristSwing(input({x:1,y:1,z:0},.01)).accepted).toBe(false));
  it("converts Hand world vectors to the Pose/avatar semantic frame", () => {
    expect(handWorldVectorToAvatarSemantic({x:.2,y:-.8,z:.4})).toEqual({x:.2,y:.8,z:-.4});
  });
  it("rejects a one-frame swing outlier and accepts a persistent new pose", () => {
    const identity=q, flipped={x:0,y:0,z:Math.sin(Math.PI/3),w:Math.cos(Math.PI/3)};
    let state=updateWristSwingTemporal(createWristSwingTemporalState(),identity,true,0);
    const before=state.lastAcceptedTarget;
    state=updateWristSwingTemporal(state,flipped,true,80);
    expect(state.lastAcceptedTarget).toEqual(before);
    expect(state.pendingCount).toBe(1);
    state=updateWristSwingTemporal(state,flipped,true,160);
    expect(state.lastAcceptedTarget).toEqual(flipped);
    expect(state.pendingCount).toBe(0);
  });
  it("locks small Pose/Hand disagreement to a straight wrist", () => {
    const a=8*Math.PI/180; const r=computeWristSwing(input({x:Math.cos(a),y:Math.sin(a),z:0}));
    expect(r.localRotation).toEqual(q);
  });
  it("rejects a palm-forward vector pointing backwards along the forearm", () => {
    expect(computeWristSwing(input({x:-1,y:0,z:0}))).toMatchObject({accepted:false,rejectionReason:"direction-disagreement"});
  });
});
