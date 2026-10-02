import {describe,expect,it} from "vitest";
import {Quaternion,Vector3} from "three";
import type {RawTrackingFrameV1} from "../tracking/rawTrackingTypes";
import {observeBodyDepth} from "./observedBodyDepth";
const frame=()=>{const p=Array.from({length:33},()=>({x:0,y:0,z:0,visibility:1}));p[11].x=.2;p[12].x=-.2;p[23]={x:.1,y:.5,z:0,visibility:1};p[24]={x:-.1,y:.5,z:0,visibility:1};p[7]={x:.07,y:-.3,z:0,visibility:1};p[8]={x:-.07,y:-.3,z:0,visibility:1};p[15].z=.3;p[16].z=-.3;return{pose:{state:"tracked",sampledAtMs:100,worldLandmarks:p,landmarks:p.map(v=>({...v}))}} as RawTrackingFrameV1;};
describe("human ordering before avatar correction",()=>{
  it("separates posterior/anterior and two-hand ordering without modifying input",()=>{
    const raw=frame(),before=JSON.stringify(raw),e=observeBodyDepth(raw,100)!;
    expect(e.left).toEqual({head:-1,torso:-1});expect(e.right).toEqual({head:1,torso:1});expect(e.interArm).toBe(-1);expect(JSON.stringify(raw)).toBe(before);
  });
  it("is invariant to rigid body rotation and translation",()=>{
    const raw=frame(),q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),1.3);
    raw.pose.worldLandmarks=raw.pose.worldLandmarks!.map(p=>{const v=new Vector3(p.x,-p.y,-p.z).applyQuaternion(q).add(new Vector3(2,1,-3));return{...p,x:v.x,y:-v.y,z:-v.z};});
    expect(observeBodyDepth(raw,100)?.left.head).toBe(-1);expect(observeBodyDepth(raw,100)?.interArm).toBe(-1);
  });
  it("does not invent evidence from old/lost/hidden/degenerate Pose or missing ears",()=>{
    expect(observeBodyDepth(frame(),251)).toBeUndefined();expect(observeBodyDepth(frame(),99)).toBeUndefined();
    const raw=frame();raw.pose.landmarks![15].visibility=0;raw.pose.landmarks![7].visibility=0;
    expect(observeBodyDepth(raw,100)?.left).toEqual({head:null,torso:null});expect(observeBodyDepth(raw,100)?.right.head).toBeNull();
    raw.pose.landmarks![11].visibility=0;expect(observeBodyDepth(raw,100)).toBeUndefined();
  });
});
