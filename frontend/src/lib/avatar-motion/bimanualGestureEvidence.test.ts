import { describe, expect, it } from "vitest";
import type { BimanualHandFeatures } from "./bimanualHandFeatures";
import { computeBimanualGestureEvidence } from "./bimanualGestureEvidence";

const metric = (distance:number, proximity:number) => ({ distance, proximity });
const base = ():BimanualHandFeatures => ({
  valid:true, normalizedByPalmWidth:1, wristDistance:1.6, palmCenterDistance:.8, tipCentroidDistance:.7,
  thumbThumb:metric(.8,0), indexIndex:metric(.8,0), leftThumbRightIndex:metric(.8,0), rightThumbLeftIndex:metric(.8,0),
  nearestRegularTipDistance:.8, regularTipContactCount:0, regularSegmentIntersectionCount:0, regularSegmentIntersectionScore:0,
  palmsFacing:.1, palmsSameDirection:.9, palmForwardAlignment:.9, heartVerticalOrder:.9,
});

describe("computeBimanualGestureEvidence",()=>{
  it("scores two-hand heart from cross-hand thumb/index contact without creating a pose",()=>{
    const f=base(); f.thumbThumb=metric(.08,.98); f.indexIndex=metric(.09,.96);
    const e=computeBimanualGestureEvidence(f);
    expect(e.heart).toBeGreaterThan(.8);
    expect(e.interlace).toBeLessThan(.2);
  });

  it("requires topology evidence for interlace",()=>{
    const f=base();
    f.palmCenterDistance=.3; f.palmsFacing=.85; f.nearestRegularTipDistance=.18;
    f.regularSegmentIntersectionCount=6; f.regularSegmentIntersectionScore=.95;
    const e=computeBimanualGestureEvidence(f);
    expect(e.interlace).toBeGreaterThan(.7);
  });
});
