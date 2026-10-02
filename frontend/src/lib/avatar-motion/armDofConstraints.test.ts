import { describe,it,expect } from "vitest";
import { Quaternion,Vector3 } from "three";
import { constrainArmDof } from "./armDofConstraints";
describe("independent rig-local arm DOF limits",()=>{
  it("caps axial twist without reducing trusted shoulder swing",()=>{
    const swing=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),1.2),twist=new Quaternion().setFromAxisAngle(new Vector3(1,0,0),2);
    const q=swing.clone().multiply(twist),out=constrainArmDof(q,{x:1,y:0,z:0},{swingRadians:1.5,twistRadians:.6})!;
    const expected=swing.multiply(new Quaternion().setFromAxisAngle(new Vector3(1,0,0),.6));
    expect(Math.abs(expected.dot(new Quaternion(out.x,out.y,out.z,out.w)))).toBeCloseTo(1,10);
  });
  it("is invariant to quaternion hemisphere and rig-local basis rotation",()=>{
    const q=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),2.8),axis=new Vector3(1,0,0),limits={swingRadians:2,twistRadians:1};
    const a=constrainArmDof(q,axis,limits)!;
    const b=constrainArmDof({x:-q.x,y:-q.y,z:-q.z,w:-q.w},axis,limits)!;expect(b).toEqual(a);
    const r=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),.7);
    const rotated=r.clone().multiply(q).multiply(r.clone().invert()),c=constrainArmDof(rotated,axis.clone().applyQuaternion(r),limits)!;
    const expected=r.clone().multiply(new Quaternion(a.x,a.y,a.z,a.w)).multiply(r.clone().invert());
    expect(Math.abs(expected.dot(new Quaternion(c.x,c.y,c.z,c.w)))).toBeCloseTo(1,10);
  });
  it("preserves capped swing hemisphere near antipodal noise",()=>{
    const limits={swingRadians:2.6,twistRadians:1},axis={x:1,y:0,z:0};
    const prior=constrainArmDof({x:0,y:0,z:1,w:0},axis,limits)!;
    const noisy=constrainArmDof({x:0,y:0,z:1,w:-.003},axis,limits,prior)!;
    expect(noisy.z).toBeGreaterThan(0);expect(noisy.w).toBeCloseTo(prior.w);
  });
  it("preserves pronation branch near the axial antipode",()=>{
    const limits={swingRadians:2.6,twistRadians:2.8},axis={x:1,y:0,z:0};
    const prior=constrainArmDof({x:1,y:0,z:0,w:.003},axis,limits)!;
    const noisy=constrainArmDof({x:1,y:0,z:0,w:-.003},axis,limits,prior)!;
    expect(noisy.x).toBeGreaterThan(0);expect(noisy.w).toBeCloseTo(prior.w);
  });
});
