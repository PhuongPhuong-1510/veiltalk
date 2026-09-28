import { describe, expect, it } from "vitest";
import type { RawWorldLandmarkV1 } from "../tracking/rawTrackingTypes";
import { computeFingerExtensionEvidence } from "./fingerFeatures";
import { computeHandViewQuality, type HandBasisResult } from "./handPalmBasis";

const lm = (x:number,y:number,z:number):RawWorldLandmarkV1=>({x,y,z,visibility:null});

function basis(normalZ:number):HandBasisResult{
  const nx=Math.sqrt(Math.max(0,1-normalZ*normalZ));
  return {
    across:{x:1,y:0,z:0},
    forward:{x:0,y:normalZ,z:-nx},
    normal:{x:0,y:nx,z:normalZ},
  };
}

function straightIndex(scale=1):RawWorldLandmarkV1[]{
  const p=Array.from({length:21},()=>lm(0,0,0));
  p[5]=lm(-.03*scale,.02*scale,0);
  p[17]=lm(.03*scale,.02*scale,0);
  p[6]=lm(-.03*scale,.06*scale,0);
  p[7]=lm(-.03*scale,.095*scale,0);
  p[8]=lm(-.03*scale,.125*scale,0);
  return p;
}

function bentIndex():RawWorldLandmarkV1[]{
  const p=straightIndex();
  p[6]=lm(-.03,.055,0);
  p[7]=lm(-.01,.065,.015);
  p[8]=lm(.005,.045,.025);
  return p;
}

describe("edge-on view quality",()=>{
  it("frontal palm has low edge-on risk",()=>{
    const q=computeHandViewQuality(basis(1));
    expect(q.cameraFacingQuality).toBeCloseTo(1,6);
    expect(q.edgeOnRisk).toBeCloseTo(0,6);
  });

  it("side-on palm has high edge-on risk",()=>{
    const q=computeHandViewQuality(basis(.1));
    expect(q.cameraFacingQuality).toBeCloseTo(0,6);
    expect(q.edgeOnRisk).toBeCloseTo(1,6);
  });
});

describe("finger extension evidence",()=>{
  it("straight index gives strong extension evidence",()=>{
    const e=computeFingerExtensionEvidence(straightIndex(),"index");
    expect(e.valid).toBe(true);
    expect(e.straightness).toBeGreaterThan(.98);
    expect(e.confidence).toBeGreaterThan(.85);
  });

  it("bent index is not protected as straight",()=>{
    const e=computeFingerExtensionEvidence(bentIndex(),"index");
    expect(e.valid).toBe(true);
    expect(e.confidence).toBeLessThan(.5);
  });

  it("extension evidence is invariant to uniform scale",()=>{
    const near=computeFingerExtensionEvidence(straightIndex(1),"index");
    const far=computeFingerExtensionEvidence(straightIndex(.35),"index");
    expect(far.straightness).toBeCloseTo(near.straightness,6);
    expect(far.normalizedReach).toBeCloseTo(near.normalizedReach,6);
    expect(far.confidence).toBeCloseTo(near.confidence,6);
  });
});
