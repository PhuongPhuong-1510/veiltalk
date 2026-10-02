import { describe, expect, it } from "vitest";
import type { BimanualHandFeatures } from "./bimanualHandFeatures";
import { BimanualHandTemporal } from "./bimanualHandTemporal";

const features: BimanualHandFeatures = {
  valid: true, normalizedByPalmWidth: 1, wristDistance: 1, palmCenterDistance: 1,
  tipCentroidDistance: 1, thumbThumb: { distance: 0, proximity: 1 },
  indexIndex: { distance: 0, proximity: 1 }, leftThumbRightIndex: { distance: 1, proximity: 0 },
  rightThumbLeftIndex: { distance: 1, proximity: 0 }, nearestRegularTipDistance: 0,
  regularTipContactCount: 1, regularSegmentIntersectionCount: 0, regularSegmentIntersectionScore: 0,
  palmsFacing: 0, palmsSameDirection: 1, palmForwardAlignment: 1, heartVerticalOrder: 1,
};
const heart={heart:.9,palmsTogether:0,clasp:0,interlace:0};

describe("BimanualHandTemporal",()=>{
  it("confirms an interaction by detector time, not render frame count",()=>{
    const temporal=new BimanualHandTemporal();
    temporal.update(features,heart,0,0);
    expect(temporal.update(features,heart,50,50).mode).toBe("none");
    expect(temporal.update(features,heart,100,100).mode).toBe("heart");
  });

  it("does not treat a normal short unsampled gap as occlusion",()=>{
    const temporal=new BimanualHandTemporal();
    temporal.update(features,heart,0,0);
    temporal.update(features,heart,100,100);
    expect(temporal.update(null,{heart:0,palmsTogether:0,clasp:0,interlace:0},null,150).occluded).toBe(false);
    expect(temporal.update(null,{heart:0,palmsTogether:0,clasp:0,interlace:0},null,230).occluded).toBe(true);
  });

  it("releases after the occlusion grace expires",()=>{
    const temporal=new BimanualHandTemporal();
    temporal.update(features,heart,0,0);
    temporal.update(features,heart,100,100);
    expect(temporal.update(null,{heart:0,palmsTogether:0,clasp:0,interlace:0},null,390).mode).toBe("none");
  });
});
