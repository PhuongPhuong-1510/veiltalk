import { describe, expect, it } from "vitest";
import type { BimanualHandFeatures } from "./bimanualHandFeatures";
import { BimanualHandTemporal } from "./bimanualHandTemporal";

const features={} as BimanualHandFeatures;
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
