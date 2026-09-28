import { describe,expect,it } from "vitest";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import { fuseContactDepthEvidence } from "./contactDepthRelation";
import { observeHumanContact } from "./contactObservation";

const lm=(x:number,y:number):RawNormalizedLandmarkV1=>({x,y,z:0,visibility:null});
const face=[lm(.4,.35),lm(.5,.3),lm(.6,.35),lm(.62,.5),lm(.6,.65),lm(.5,.7),lm(.4,.65),lm(.38,.5)];
const hand=()=>{const p=Array.from({length:21},()=>lm(.5,.28));p[0]=lm(.5,.32);p[5]=lm(.45,.25);p[9]=lm(.5,.22);p[17]=lm(.55,.25);return p;};
const compatible=fuseContactDepthEvidence({occlusion:.8,scaleChange:.7,motionConsistency:.8,posePrior:null,history:.8});

describe("shadow contact observation",()=>{
  it("reports a head-top palm observation without touching avatar joints",()=>{
    const result=observeHumanContact({side:"left",faceLandmarks:face,handLandmarks:hand(),videoWidth:1_000,videoHeight:1_000,sampledAtMs:100,depth:compatible,continuity:.8,normalVelocity:0,tangentVelocity:0});
    expect(result).toMatchObject({side:"left",probe:"palmCenter",surfaceFamily:"head"});
    expect(result!.regionUv.x).toBeGreaterThanOrEqual(-1);expect(result!.regionUv.x).toBeLessThanOrEqual(1);
    expect(result!.regionUv.y).toBeGreaterThanOrEqual(-1);expect(result!.regionUv.y).toBeLessThanOrEqual(1);
    expect(result!.confidence).toBeGreaterThan(.5);
  });
  it("hard-rejects overlap when depth says the hand is behind",()=>{
    const depth=fuseContactDepthEvidence({occlusion:-.9,scaleChange:null,motionConsistency:null,posePrior:null,history:null});
    const result=observeHumanContact({side:"left",faceLandmarks:face,handLandmarks:hand(),videoWidth:1_000,videoHeight:1_000,sampledAtMs:100,depth});
    expect(result?.confidence).toBe(0);
    expect(result?.evidence.hardRejections).toContain("depth-behind");
  });
});
