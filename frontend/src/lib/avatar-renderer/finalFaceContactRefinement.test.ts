import { describe, expect, it } from "vitest";
import { Object3D, Vector3 } from "three";
import { FinalFaceContactRefiner, type FinalFaceContactInput } from "./finalFaceContactRefinement";
import { captureSemanticBoneFrames } from "./renderedContactGeometry";

function fixture(){
  const root=new Object3D(),upper=new Object3D(),lower=new Object3D(),hand=new Object3D();root.add(upper);upper.add(lower);lower.add(hand);lower.position.set(.4,.3,0);hand.position.set(.4,-.3,0);root.updateMatrixWorld(true);
  const bones={leftUpperArm:upper,leftLowerArm:lower,leftHand:hand},frames=captureSemanticBoneFrames(bones,bones),target=hand.getWorldPosition(new Vector3()).add(new Vector3(0,0,.008));
  const input:FinalFaceContactInput={side:"left",owned:true,fresh:true,goalKey:"fixture",dt:1/60,faceHeight:.3,influence:1,bones,frames,probe:{probe:"palmCenter",frameOffset:{x:0,y:0,z:0},contactNormal:{x:0,y:0,z:-1},tangentHint:{x:0,y:1,z:0}},target:()=>({point:target,normal:new Vector3(0,0,1)}),sync:()=>root.updateMatrixWorld(true),clearanceScore:()=>0};
  return{input,bones,root};
}
describe("bounded final skin refinement",()=>{
  it("improves a nearby rendered contact and preserves bone lengths/positions",()=>{
    const f=fixture(),positions=Object.values(f.bones).map(b=>b.position.clone()),result=new FinalFaceContactRefiner().refine(f.input);
    expect(result.applied).toBe(true);expect(result.after!).toBeLessThan(result.before!);
    Object.values(f.bones).forEach((b,i)=>expect(b.position.distanceTo(positions[i])).toBe(0));
    expect(f.bones.leftUpperArm.getWorldPosition(new Vector3()).distanceTo(f.bones.leftLowerArm.getWorldPosition(new Vector3()))).toBeCloseTo(.5,8);
    expect(f.bones.leftLowerArm.getWorldPosition(new Vector3()).distanceTo(f.bones.leftHand.getWorldPosition(new Vector3()))).toBeCloseTo(.5,8);
  });
  it("rolls back when a joint constraint or clearance would worsen",()=>{
    for(const failure of ["joint","clearance"]){const f=fixture(),before=Object.values(f.bones).map(b=>b.quaternion.clone());let count=0;
      if(failure==="joint")f.input.acceptJointConstraints=()=>false;else f.input.clearanceScore=()=>count++===0?0:1;
      const result=new FinalFaceContactRefiner().refine(f.input);expect(result.applied).toBe(false);Object.values(f.bones).forEach((b,i)=>expect(b.quaternion.angleTo(before[i])).toBeLessThan(1e-7));}
  });
  it("cannot acquire or mutate stale, unowned and distant contacts",()=>{
    for(const overrides of [{owned:false},{fresh:false},{dt:NaN},{target:()=>({point:new Vector3(4,4,4),normal:new Vector3(0,0,1)})}]){const f=fixture(),before=Object.values(f.bones).map(b=>b.quaternion.clone());const result=new FinalFaceContactRefiner().refine({...f.input,...overrides});expect(result.applied).toBe(false);Object.values(f.bones).forEach((b,i)=>expect(b.quaternion.angleTo(before[i])).toBeLessThan(1e-7));}
  });
});
