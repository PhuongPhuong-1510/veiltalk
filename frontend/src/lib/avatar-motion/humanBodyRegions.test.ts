import { describe,expect,it } from "vitest";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import { evaluateHumanBodyRegions,selectHumanBodyRegion } from "./humanBodyRegions";

const lm=(x:number,y:number):RawNormalizedLandmarkV1=>({x,y,z:0,visibility:null});
const face=[lm(.4,.35),lm(.5,.3),lm(.6,.35),lm(.62,.5),lm(.6,.65),lm(.5,.7),lm(.4,.65),lm(.38,.5)];

describe("human body regions",()=>{
  it("selects head top and cheek patches from robust face bounds",()=>{
    const input={faceLandmarks:face,videoWidth:1_000,videoHeight:1_000,imageMirrored:true};
    expect(selectHumanBodyRegion(evaluateHumanBodyRegions(input,{x:.5,y:.23}))?.region).toBe("headTop");
    expect(selectHumanBodyRegion(evaluateHumanBodyRegions(input,{x:.445,y:.54}))?.region).toBe("leftCheek");
  });
  it("reduces the far-cheek confidence at large yaw",()=>{
    const candidates=evaluateHumanBodyRegions({faceLandmarks:face,videoWidth:1_000,videoHeight:1_000,headYawRadians:1.2,imageMirrored:true},{x:.44,y:.54});
    const left=candidates.find(value=>value.region==="leftCheek")!,right=candidates.find(value=>value.region==="rightCheek")!;
    expect(left.confidence).toBeLessThan(right.confidence);
  });
  it("maps image side to anatomical cheek explicitly instead of inheriting CSS mirroring",()=>{
    const candidates=evaluateHumanBodyRegions({faceLandmarks:face,videoWidth:1_000,videoHeight:1_000,imageMirrored:false},{x:.445,y:.54});
    expect(selectHumanBodyRegion(candidates)?.region).toBe("rightCheek");
  });
  it("uses continuity penalty to avoid a marginal one-frame region switch",()=>{
    const selected=selectHumanBodyRegion([
      {region:"leftCheek",center:{x:0,y:0},radius:{x:1,y:1},signedDistance:-.1,confidence:.9},
      {region:"chin",center:{x:0,y:0},radius:{x:1,y:1},signedDistance:-.12,confidence:.9},
    ],"leftCheek");
    expect(selected?.region).toBe("leftCheek");
  });
  it("covers mouth and ears but never guesses posterior contact without an independent cue",()=>{
    const front=evaluateHumanBodyRegions({faceLandmarks:face,videoWidth:1_000,videoHeight:1_000,imageMirrored:true},{x:.5,y:.575});
    expect(front.some(value=>value.region==="mouth")).toBe(true);
    expect(front.some(value=>value.region==="leftEar"||value.region==="rightEar")).toBe(true);
    expect(front.some(value=>value.region==="backHead")).toBe(false);
    const posterior=evaluateHumanBodyRegions({faceLandmarks:face,videoWidth:1_000,videoHeight:1_000,imageMirrored:true,posteriorContactHint:.8},{x:.5,y:.45});
    expect(posterior.some(value=>value.region==="backHead")).toBe(true);
  });
});
