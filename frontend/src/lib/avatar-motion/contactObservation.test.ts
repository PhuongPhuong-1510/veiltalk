import { describe,expect,it } from "vitest";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import { fuseContactDepthEvidence } from "./contactDepthRelation";
import { observeHumanContact,createContactObservationTrace } from "./contactObservation";

const lm=(x:number,y:number):RawNormalizedLandmarkV1=>({x,y,z:0,visibility:null});
const face=[lm(.4,.35),lm(.5,.3),lm(.6,.35),lm(.62,.5),lm(.6,.65),lm(.5,.7),lm(.4,.65),lm(.38,.5)];
const hand=()=>{const p=Array.from({length:21},()=>lm(.5,.28));p[0]=lm(.5,.32);p[5]=lm(.45,.25);p[9]=lm(.5,.22);p[17]=lm(.55,.25);return p;};
const compatible=fuseContactDepthEvidence({occlusion:.8,scaleChange:.7,motionConsistency:.8,posePrior:null,history:.8});

describe("shadow contact observation",()=>{
  it("distinguishes missing input, degenerate projection and ranked selection in diagnostics",()=>{
    const base={side:"left" as const,faceLandmarks:face,videoWidth:1000,videoHeight:1000,sampledAtMs:100,depth:compatible};
    const missing=createContactObservationTrace();expect(observeHumanContact({...base,handLandmarks:null,trace:missing})).toBeNull();expect(missing.status).toBe("missing-hand-image");
    const flat=createContactObservationTrace();observeHumanContact({...base,handLandmarks:Array.from({length:21},()=>lm(.5,.5)),trace:flat});expect(flat.status).toBe("degenerate-hand-projection");
    const selected=createContactObservationTrace(),observation=observeHumanContact({...base,handLandmarks:hand(),trace:selected});
    expect(selected.status).toBe("selected");expect(selected.selectedPoint).toEqual(observation!.imagePoint);
    expect(selected.candidates[0].region).toBe(observation!.region);
    expect(selected.candidates.every((c,i,a)=>!i||c.cost>=a[i-1].cost)).toBe(true);
  });
  it("joint selection prefers the measured facing probe instead of a projection-only palm tie",()=>{
    const input={side:"left" as const,faceLandmarks:face,handLandmarks:hand(),videoWidth:1000,videoHeight:1000,sampledAtMs:100,depth:compatible};
    const baseline=observeHumanContact(input),joint=observeHumanContact({...input,jointProbeSelection:true,orientationForCandidate:probe=>probe==="radialEdge"?1:0});
    expect(baseline!.probe).toBe("palmCenter");expect(joint!.probe).toBe("radialEdge");expect(joint!.selectionMargin!).toBeGreaterThan(.025);
  });
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
