import { describe, expect, it } from "vitest";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import { buildHumanSemanticBodyModel } from "./humanSemanticBodyModel";
import { evaluateHumanBodyRegions, selectHumanBodyRegion } from "./humanBodyRegions";

const lm=(x:number,y:number,z=0):RawNormalizedLandmarkV1=>({x,y,z,visibility:1});
function face():RawNormalizedLandmarkV1[]{
  const result=Array.from({length:478},(_,index)=>{const t=index/478*Math.PI*2;return lm(.5+.15*Math.cos(t),.46+.20*Math.sin(t));});
  result[10]=lm(.5,.27);result[152]=lm(.5,.66);result[1]=lm(.5,.46);result[168]=lm(.5,.39);
  result[13]=lm(.5,.54);result[14]=lm(.5,.56);result[61]=lm(.445,.55);result[291]=lm(.555,.55);
  result[33]=lm(.42,.405);result[263]=lm(.58,.405);result[234]=lm(.35,.47);result[454]=lm(.65,.47);
  return result;
}
function pose():RawNormalizedLandmarkV1[]{
  const result=Array.from({length:33},()=>lm(.5,.5));
  result[7]=lm(.37,.45);result[8]=lm(.63,.45);result[11]=lm(.35,.72);result[12]=lm(.65,.72);result[23]=lm(.42,.95);result[24]=lm(.58,.95);
  return result;
}
const base=()=>({faceLandmarks:face(),poseLandmarks:pose(),videoWidth:1000,videoHeight:1000,imageMirrored:false,posteriorHeadContactHint:0,posteriorNeckContactHint:0});
const selected=(point:{x:number;y:number},overrides:Partial<ReturnType<typeof base>>={})=>{
  const input={...base(),...overrides};
  const model=buildHumanSemanticBodyModel(input);
  return selectHumanBodyRegion(evaluateHumanBodyRegions(input,point,model));
};

describe("normalized human semantic body model",()=>{
  it("separates cheek from ear on the same head surface",()=>{
    expect(selected({x:.405,y:.50})?.anatomicalLabel).toBe("rightCheek");
    expect(selected({x:.37,y:.45})?.anatomicalLabel).toBe("rightEar");
  });
  it("finds forehead and inferred head top from person-relative scale",()=>{
    expect(selected({x:.50,y:.32})?.anatomicalLabel).toBe("forehead");
    expect(selected({x:.50,y:.19})?.anatomicalLabel).toBe("headTop");
  });
  it("recognizes nose but fails closed for palm-scale correction",()=>{
    const nose=selected({x:.50,y:.46});
    expect(nose?.anatomicalLabel).toBe("nose");
    expect(nose?.correctionEligible).toBe(false);
  });
  it("separates neck and torso families",()=>{
    expect(selected({x:.50,y:.675})?.surfaceFamily).toBe("neck");
    expect(selected({x:.50,y:.79})?.surfaceFamily).toBe("torso");
  });
  it("uses posterior evidence to classify the same projected head point as backHead",()=>{
    expect(selected({x:.50,y:.43},{posteriorHeadContactHint:.9})?.anatomicalLabel).toBe("backHead");
  });
});
