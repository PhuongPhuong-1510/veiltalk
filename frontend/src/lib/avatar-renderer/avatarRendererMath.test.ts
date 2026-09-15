import { Object3D, Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { absoluteLocalFromRestDelta, applyRawMorphWeights, applyShoulderTranslation, expressionValueFromPacket, facialExpressionTarget, isProcessorOwnedRotation, shoulderDisplacement } from "./avatarRenderer";

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
  it("applies vertical shrug from rest without drift and follows current torso-up",()=>{
    const parent=new Object3D(),shoulder=new Object3D(),upperArm=new Object3D();parent.add(shoulder);shoulder.add(upperArm);shoulder.position.set(.2,.3,0);upperArm.position.x=1;parent.updateMatrixWorld(true);const armRest=upperArm.getWorldPosition(new Vector3());
    const model={shoulderTranslationBones:{left:shoulder},shoulderTranslationRig:{version:1 as const,shoulderWidth:.4,joints:{left:{restLocalPosition:{x:.2,y:.3,z:0},torsoUpParentLocalRest:{x:0,y:1,z:0}}}}};
    const state={version:1 as const,leftVertical:1,rightVertical:0};
    const first=applyShoulderTranslation(model,state);parent.updateMatrixWorld(true);expect(first.left.displacement).toBeCloseTo(.04);expect(shoulder.position.y).toBeCloseTo(.34);expect(upperArm.getWorldPosition(new Vector3()).y-armRest.y).toBeCloseTo(.04);
    applyShoulderTranslation(model,{...state,leftVertical:-1});applyShoulderTranslation(model,state);expect(shoulder.position.y).toBeCloseTo(.34);
    parent.rotation.z=Math.PI/6;parent.updateMatrixWorld(true);const restWorld=new Vector3(.2,.3,0).applyMatrix4(parent.matrixWorld);const movedWorld=shoulder.getWorldPosition(new Vector3());
    const expectedDirection=new Vector3(0,1,0).applyQuaternion(parent.getWorldQuaternion(new Quaternion())).normalize();
    expect(movedWorld.clone().sub(restWorld).normalize().angleTo(expectedDirection)).toBeLessThan(1e-6);
    applyShoulderTranslation(model,{...state,leftVertical:2});const clamped=applyShoulderTranslation(model,{...state,leftVertical:2}).left;expect(clamped).toMatchObject({vertical:1,clamped:true});expect(clamped.displacement).toBeCloseTo(.04);
    applyShoulderTranslation(model,null);expect(shoulder.position.toArray()).toEqual([.2,.3,0]);expect(shoulderDisplacement(Number.NaN,.4)).toBe(0);
  });
  it("applies queued raw morph weights after VRM update and clamps invalid range", () => {
    const influences = [0, 0];
    const morphTargets = new Map([
      ["browUp", [{ influences, index: 0 }]],
      ["browDown", [{ influences, index: 1 }]],
    ]);
    applyRawMorphWeights(morphTargets, new Map([["browUp", 1.4], ["browDown", -.2], ["missing", .8]]));
    expect(influences).toEqual([1, 0]);
  });
  it("applies the final expression packet directly without renderer temporal state", () => {
    expect(expressionValueFromPacket(.72)).toBe(.72);
    expect(expressionValueFromPacket(1.4)).toBe(1);
    expect(expressionValueFromPacket(-.2)).toBe(0);
    expect(expressionValueFromPacket(Number.NaN)).toBe(0);
  });
  it("reports the exact clamped semantic-to-model expression target", () => {
    expect(facialExpressionTarget("mouthSmileOpen", 1.4, { mouthSmileOpen: "31" })).toEqual({
      semantic: "mouthSmileOpen", modelName: "31", value: 1,
    });
    expect(facialExpressionTarget("aa", .42, {})).toEqual({ semantic: "aa", modelName: "aa", value: .42 });
  });
  it("keeps V1 head on the legacy renderer path and makes only V2 upper body processor-owned",()=>{
    expect(isProcessorOwnedRotation(1,"head")).toBe(false);
    expect(isProcessorOwnedRotation(2,"head")).toBe(true);
    expect(isProcessorOwnedRotation(2,"upperChest")).toBe(true);
    expect(isProcessorOwnedRotation(2,"leftUpperArm")).toBe(false);
  });
});
