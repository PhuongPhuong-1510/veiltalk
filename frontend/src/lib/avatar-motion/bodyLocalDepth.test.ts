import { describe,expect,it } from "vitest";
import { Quaternion,Vector3 } from "three";
import { BodyLocalDepthMemory,bodyLocalOutwardNormal } from "./bodyLocalDepth";
describe("posed body depth ordering",()=>{
  const origin={x:0,y:0,z:0},front={x:0,y:0,z:1};
  it("uses recent observed hemisphere near the mid-plane but not forever during occlusion",()=>{
    const m=new BodyLocalDepthMemory();expect(m.update({x:0,y:0,z:-.4},origin,front,1,0,true)).toBe(-1);
    expect(m.update({x:0,y:0,z:.01},origin,front,1,200,true)).toBe(-1);
    expect(m.update({x:0,y:0,z:-.4},origin,front,1,500,false)).toBe(-1);
    expect(m.update({x:0,y:0,z:-.4},origin,front,1,700,false)).toBeNull();
    expect(m.update({x:0,y:0,z:.4},origin,front,1,750,true)).toBe(1);
  });
  it("is invariant to body rotation and translation",()=>{
    const rot=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2),translation=new Vector3(2,1,-3);
    const m=new BodyLocalDepthMemory(),point=new Vector3(0,0,-.5).applyQuaternion(rot).add(translation),forward=new Vector3(0,0,1).applyQuaternion(rot);
    expect(m.update(point,translation,forward,1,10,true)).toBe(-1);
    const normal=bodyLocalOutwardNormal(forward,forward,-1);
    expect(new Vector3(normal.x,normal.y,normal.z).dot(forward)).toBeCloseTo(-1);
  });
  it("repeated renderer draws cannot renew one observed packet",()=>{
    const m=new BodyLocalDepthMemory(),point={x:0,y:0,z:.4};
    expect(m.update(point,origin,front,1,0,true,42)).toBe(1);
    expect(m.update(point,origin,front,1,300,true,42)).toBe(1);
    expect(m.update(point,origin,front,1,700,true,42)).toBeNull();
    expect(m.update(point,origin,front,1,900,true,42)).toBeNull();
    expect(m.update(point,origin,front,1,950,true,43)).toBe(1);
  });
  it("does not invent ordering without evidence, and preserves correct outward normals",()=>{
    const m=new BodyLocalDepthMemory();expect(m.update(origin,origin,front,1,0,true)).toBeNull();
    expect(bodyLocalOutwardNormal(front,front,null)).toBe(front);
    expect(bodyLocalOutwardNormal(front,front,1)).toBe(front);
    expect(bodyLocalOutwardNormal(front,front,-1).z).toBeLessThan(0);
  });
});
