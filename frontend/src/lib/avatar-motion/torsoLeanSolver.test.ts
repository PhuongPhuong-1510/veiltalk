import { describe,expect,it } from "vitest";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import { subtract } from "./coordinateAdapter";
import { combineTorsoLeanConfidence,computeLeanShoulderCommonGain,measureFullTorsoLeanAngle,TorsoLeanSolver } from "./torsoLeanSolver";

const radians=(degrees:number)=>degrees*Math.PI/180;
const point=(x:number,y:number,z=0,visibility=1):RawNormalizedLandmarkV1=>({x,y,z,visibility});
const pose=(visibility=1)=>{const value=Array.from({length:33},()=>point(.5,.5,0,visibility));value[11]=point(.65,.35,0,visibility);value[12]=point(.35,.35,0,visibility);value[23]=point(.6,.75,0,visibility);value[24]=point(.4,.75,0,visibility);return value;};
const face=()=>{const value=Array.from({length:478},()=>point(.5,.5));value[33]=point(.42,.48);value[133]=point(.47,.48);value[362]=point(.53,.48);value[263]=point(.58,.48);return value;};
const basis={right:{x:1,y:0,z:0},up:{x:0,y:1,z:0},forward:{x:0,y:0,z:1},worldRotation:{x:0,y:0,z:0,w:1}};

describe("AR4-T06 torso lean solver",()=>{
  it("locks toward-camera sign through coordinateAdapter and keeps mirror invariant",()=>{
    const neutral=subtract(point(.5,-1,0),point(.5,0,0)),a=radians(10);
    const forward=subtract(point(.5,-Math.cos(a),-Math.sin(a)),point(.5,0,0));
    const backward=subtract(point(.5,-Math.cos(a),Math.sin(a)),point(.5,0,0));
    expect(measureFullTorsoLeanAngle(neutral,neutral,basis.up,basis.forward)).toBeCloseTo(0);
    expect(measureFullTorsoLeanAngle(forward,neutral,basis.up,basis.forward)).toBeCloseTo(a);
    expect(measureFullTorsoLeanAngle(backward,neutral,basis.up,basis.forward)).toBeCloseTo(-a);
  });
  it("does not collapse four moderate soft qualities into unavailable confidence",()=>{
    const penalties={head:.2,yaw:.2,roll:.2,shrug:.2};expect(combineTorsoLeanConfidence(.8,1,penalties)).toBeGreaterThan(.6);
  });
  it("turns off only common shoulder motion when depth indicates a clear lean",()=>{
    const result={angle:radians(2),source:"ambiguous-camera-approach",confidence:.7,cues:{shoulderScale:0,faceScale:null,scaleMismatch:null,depth:.04},penalties:{head:0,yaw:0,roll:0,shrug:1},limited:true} as const;
    expect(computeLeanShoulderCommonGain(result)).toBe(0);
    expect(computeLeanShoulderCommonGain({...result,source:"unavailable",angle:null})).toBe(1);
  });
  it("keeps uniform full-body Z translation at zero full-torso angle",()=>{
    const solver=new TorsoLeanSolver(),neutral=pose();expect(solver.captureNeutral(neutral,neutral,face(),basis,16/9)).toBe(true);
    const translated=pose();for(const index of [11,12,23,24])translated[index].z=-.2;
    const result=solver.solve({mode:"full-torso",worldLandmarks:translated,imageLandmarks:translated,faceLandmarks:face(),fullTorsoBasis:basis,imageAspectRatio:16/9,sampledAtMs:1,headPitch:0,torsoYaw:0,torsoRoll:0,commonShoulderVertical:0});
    expect(result.source).toBe("full-torso");expect(result.angle).toBeCloseTo(0);
  });
  it("caps stable depth-only evidence as ambiguous instead of promoting full proxy",()=>{
    const solver=new TorsoLeanSolver(),neutral=pose();expect(solver.captureNeutral(neutral,neutral,null,null,16/9)).toBe(true);
    const approached=pose();approached[11].z=-.3;approached[12].z=-.3;
    const result=solver.solve({mode:"shoulder-only",worldLandmarks:approached,imageLandmarks:approached,faceLandmarks:null,fullTorsoBasis:null,imageAspectRatio:16/9,sampledAtMs:1,headPitch:0,torsoYaw:0,torsoRoll:0,commonShoulderVertical:0});
    expect(result.source).toBe("ambiguous-camera-approach");expect(result.angle).toBeCloseTo(radians(2));
  });
  it("uses enter/exit hysteresis instead of flapping around one threshold",()=>{
    const solver=new TorsoLeanSolver(),neutral=pose();expect(solver.captureNeutral(neutral,neutral,face(),null,16/9)).toBe(true);
    const active=pose(1);active[11].z=-.08;active[12].z=-.08;
    expect(solver.solve({mode:"shoulder-only",worldLandmarks:active,imageLandmarks:active,faceLandmarks:face(),fullTorsoBasis:null,imageAspectRatio:16/9,sampledAtMs:1,headPitch:0,torsoYaw:0,torsoRoll:0,commonShoulderVertical:0}).source).not.toBe("unavailable");
    for(const [offset,quality] of [.54,.56,.53,.57,.54,.56].entries()){const sample=pose(quality);sample[11].z=-.08;sample[12].z=-.08;expect(solver.solve({mode:"shoulder-only",worldLandmarks:sample,imageLandmarks:sample,faceLandmarks:face(),fullTorsoBasis:null,imageAspectRatio:16/9,sampledAtMs:offset+2,headPitch:0,torsoYaw:0,torsoRoll:0,commonShoulderVertical:0}).source).not.toBe("unavailable");}
  });
});
