import { describe, expect, it } from "vitest";
import type { FingerRigProfile } from "./fingerRig";
import { BimanualContactRuntime } from "./bimanualContactRuntime";

const rig={left:{chains:[{segments:[{joint:"leftIndexProximal"}]}]},right:{chains:[{segments:[{joint:"rightIndexProximal"}]}]}} as unknown as FingerRigProfile;
const q=(x:number)=>({x,y:0,z:0,w:Math.sqrt(Math.max(0,1-x*x))});

describe("BimanualContactRuntime",()=>{
  it("captures observed continuous pose and only corrects during occlusion",()=>{
    const runtime=new BimanualContactRuntime();
    const observed:any={leftIndexProximal:q(.2),rightIndexProximal:q(.2)};
    const f:any={valid:true};
    const e={heart:.9,palmsTogether:0,clasp:0,interlace:0};
    runtime.update({features:f,evidence:e,sampledAtMs:0,nowMs:0,jointRotations:observed,fingerRig:rig});
    runtime.update({features:f,evidence:e,sampledAtMs:100,nowMs:100,jointRotations:observed,fingerRig:rig});
    const changed:any={leftIndexProximal:q(.7),rightIndexProximal:q(.7)};
    const d=runtime.update({features:null,evidence:{heart:0,palmsTogether:0,clasp:0,interlace:0},sampledAtMs:null,nowMs:230,jointRotations:changed,fingerRig:rig});
    expect(d.occluded).toBe(true);
    expect(d.correctionApplied).toBe(true);
    expect(d.stabilizedJointCount).toBe(2);
  });
});
