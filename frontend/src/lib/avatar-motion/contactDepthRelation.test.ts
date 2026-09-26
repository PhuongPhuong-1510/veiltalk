import { describe,expect,it } from "vitest";
import { fuseContactDepthEvidence } from "./contactDepthRelation";

describe("contact depth evidence",()=>{
  it("requires motion and multiple independent positive cues",()=>{
    expect(fuseContactDepthEvidence({occlusion:.8,scaleChange:.7,motionConsistency:.75,posePrior:null,history:.8}).relation).toBe("surface-compatible");
    expect(fuseContactDepthEvidence({occlusion:.9,scaleChange:null,motionConsistency:null,posePrior:null,history:null}).relation).toBe("unknown");
  });
  it("keeps behind and separated evidence distinct from unknown",()=>{
    expect(fuseContactDepthEvidence({occlusion:-.9,scaleChange:null,motionConsistency:null,posePrior:null,history:null}).relation).toBe("behind");
    expect(fuseContactDepthEvidence({occlusion:null,scaleChange:-.7,motionConsistency:.8,posePrior:null,history:.8}).relation).toBe("in-front-separated");
  });
});
