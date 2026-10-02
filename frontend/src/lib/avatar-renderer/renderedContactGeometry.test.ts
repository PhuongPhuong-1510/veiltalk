import {Object3D,Quaternion,Vector3} from "three";
import {describe,expect,it} from "vitest";
import {captureSemanticBoneFrames,semanticRenderedRotation} from "./renderedContactGeometry";
describe("raw FK contact frames",()=>{
  it("removes raw rest-axis orientation before applying a normalized local probe",()=>{
    const normalized=new Object3D(),raw=new Object3D();raw.rotation.z=Math.PI/2;raw.updateMatrixWorld(true);normalized.updateMatrixWorld(true);
    const frames=captureSemanticBoneFrames({leftHand:normalized},{leftHand:raw}),frame=frames.get("leftHand")!;
    expect(semanticRenderedRotation(frame).angleTo(new Quaternion())).toBeLessThan(1e-7);
    const delta=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.7);raw.quaternion.premultiply(delta);raw.position.set(2,3,4);raw.updateMatrixWorld(true);
    expect(semanticRenderedRotation(frame).angleTo(delta)).toBeLessThan(1e-7);
    expect(frame.bone.getWorldPosition(new Vector3()).toArray()).toEqual([2,3,4]);
    expect(normalized.getWorldPosition(new Vector3()).toArray()).toEqual([0,0,0]);
  });
  it("supports rigs without separate raw bones",()=>{
    const bone=new Object3D();bone.rotation.x=.2;bone.updateMatrixWorld(true);const frame=captureSemanticBoneFrames({leftHand:bone},{}).get("leftHand")!;
    expect(semanticRenderedRotation(frame).angleTo(bone.getWorldQuaternion(new Quaternion()))).toBeLessThan(1e-7);
  });
});
