import { describe,expect,it } from "vitest";
import { ArmDepthFusion,type ArmDepthInput } from "./armDepthFusion";
import type { RawHandCandidateV1 } from "../tracking/rawTrackingTypes";

function hand(at:number,size=1,edge=false):RawHandCandidateV1 {
  const world=Array.from({length:21},()=>({x:0,y:0,z:0,visibility:null}));
  world[5]={x:-.035,y:.05,z:0,visibility:null};world[17]={x:.035,y:.05,z:0,visibility:null};world[9]={x:0,y:.09,z:0,visibility:null};
  if(edge)for(const p of world){p.z=p.x;p.x=0;}
  return {sourceIndex:0,sampledAtMs:at,handedness:"left",handednessScore:.99,worldLandmarks:world,
    landmarks:world.map(p=>({x:.5+p.x*size,y:.5+p.y*size,z:p.z,visibility:null}))};
}
function input(at:number,size=1):ArmDepthInput {
  return {shoulder:{x:0,y:0,z:0},elbow:{x:.2,y:.1,z:.04},wrist:{x:.35,y:0,z:.08},shoulderImageWidth:.3,imageToWorldScale:1,hand:hand(at,size),videoWidth:1000,videoHeight:1000,poseAtMs:at,nowMs:at,matchQuality:1};
}
function calibrated(){const f=new ArmDepthFusion();for(let i=0;i<8;i++)f.solve(input(i*33));return f;}
describe("relative arm depth fusion",()=>{
  it("requires eight distinct stable observations, never calibrates duplicate samples",()=>{
    const f=new ArmDepthFusion();for(let i=0;i<20;i++)expect(f.solve(input(0))).toBeNull();
    expect(f.snapshot().calibratedSamples).toBe(1);
    for(let i=1;i<8;i++)f.solve(input(i*33));expect(f.snapshot().calibratedSamples).toBe(8);
  });
  it("uses growing palm only as a bounded relative target without mutating measurements",()=>{
    const f=calibrated(),x=input(300,1.6),raw=JSON.stringify(x);
    const result=f.solve(x)!;expect(result.z).toBeGreaterThan(x.wrist.z);
    expect(result.z-x.wrist.z).toBeLessThan(.06);expect(result.x).toBe(x.wrist.x);
    expect(JSON.stringify(x)).toBe(raw);expect(f.snapshot().palmWeight).toBeLessThanOrEqual(.35);
  });
  it("does not renew cue on edge-on observations; influence expires",()=>{
    const f=calibrated();for(let at=300;at<1400;at+=100)f.solve({...input(at),hand:hand(at,2,true)});
    expect(f.snapshot().reason).toBe("expired-palm-cue");expect(f.snapshot().palmWeight).toBe(0);
  });
  it("rejects contradictory sign rather than inventing front/back from shortening",()=>{
    const f=calibrated();let result=null;
    for(let at=300;at<600;at+=33)result=f.solve({...input(at,2),wrist:{x:.35,y:0,z:-.2}});
    expect(result).toBeNull();expect(f.snapshot().reason).toBe("conflicting-depth-sign");
  });
  it("global image scale leaves palm/shoulder ratio and the target invariant",()=>{
    const f=calibrated(),x=input(300,1.2),a=f.solve(x);
    const g=calibrated(),h=x.hand!;
    const b=g.solve({...x,shoulderImageWidth:.6,hand:{...h,landmarks:h.landmarks.map(p=>({...p,x:.5+(p.x-.5)*2,y:.5+(p.y-.5)*2}))}});
    expect(b).toEqual(a);
  });
  it("clears calibration on clock reversal and rejects nonfinite world geometry",()=>{
    const f=calibrated();f.solve(input(1));expect(f.snapshot().calibratedSamples).toBe(1);
    expect(f.solve({...input(40),wrist:{x:NaN,y:0,z:0}})).toBeNull();expect(f.snapshot().reason).toBe("invalid-geometry");
  });
  it("compensates shoulder foreshortening instead of interpreting torso yaw as hand approach",()=>{
    const f=calibrated(),a=f.solve(input(300));
    const g=calibrated(),b=g.solve({...input(300),shoulderImageWidth:.3*.7,shoulderProjection:.7});
    expect(b).toEqual(a);
    expect(g.solve({...input(333),shoulderProjection:.3})).toBeNull();expect(g.snapshot().reason).toBe("shoulders-edge-on");
  });
  it("uses independent image foreshortening with calibrated length, but does not invent its sign",()=>{
    const f=calibrated();const result=f.solve({...input(300),projectedLowerLength:.08,calibratedLowerLength:.2})!;
    expect(f.snapshot().foreshorteningMagnitude).toBeCloseTo(Math.sqrt(.2**2-.08**2));
    expect(f.snapshot().geometryWeight).toBeGreaterThan(0);expect(result.z).toBeGreaterThan(.08);
    const g=calibrated();g.solve({...input(300),projectedLowerLength:.08,calibratedLowerLength:.2,wrist:{x:.35,y:0,z:.04}});
    expect(g.snapshot().geometryWeight).toBe(0);
  });
  it("keeps fresh geometric depth useful after palm-shape evidence expires",()=>{
    const f=calibrated();for(let at=300;at<1400;at+=100)f.solve({...input(at),hand:hand(at,1,true),projectedLowerLength:.08,calibratedLowerLength:.2});
    expect(f.snapshot().palmWeight).toBe(0);expect(f.snapshot().geometryWeight).toBeGreaterThan(0);
    expect(f.snapshot().reason).toBe("geometry-fused");
    f.solve({...input(1500),hand:hand(100,1,true),projectedLowerLength:.08,calibratedLowerLength:.2});
    expect(f.snapshot().geometryWeight).toBe(0);
  });
});
