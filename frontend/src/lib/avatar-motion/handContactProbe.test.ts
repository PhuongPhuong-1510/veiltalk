import { describe,expect,it } from "vitest";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import { observeRigidHandContactProbes } from "./handContactProbe";

const lm=(x:number,y:number):RawNormalizedLandmarkV1=>({x,y,z:0,visibility:null});
const hand=()=>{const points=Array.from({length:21},()=>lm(.5,.5));points[0]=lm(.5,.7);points[5]=lm(.42,.5);points[9]=lm(.5,.42);points[17]=lm(.58,.5);return points;};

describe("rigid hand contact probes",()=>{
  it("builds palm and both rigid edges without a fingertip probe",()=>{
    const probes=observeRigidHandContactProbes(hand(),1_000,1_000);
    expect(probes.map(value=>value.probe)).toEqual(["palmCenter","radialEdge","ulnarEdge"]);
    expect(probes.every(value=>value.confidence>0)).toBe(true);
    expect(probes.find(value=>value.probe==="palmCenter")?.contactNormal).toBeNull();
    expect(probes.filter(value=>value.probe!=="palmCenter").every(value=>value.contactNormal!==null)).toBe(true);
  });
  it("rejects degenerate or incomplete palm geometry",()=>{
    expect(observeRigidHandContactProbes([],1_000,1_000)).toEqual([]);
    expect(observeRigidHandContactProbes(Array.from({length:21},()=>lm(.5,.5)),1_000,1_000)).toEqual([]);
  });
});
