import { describe,expect,it } from "vitest";
import type { HumanContactObservation } from "./bodyContactTypes";
import type { ContactTemporalState } from "./contactTemporal";
import { createContactTemporalState,updateContactEvidence,updateContactVisualInfluence } from "./contactTemporal";

const observation=(sampledAtMs:number,relation:HumanContactObservation["depth"]["relation"]="surface-compatible",approachVelocity=0):HumanContactObservation=>({side:"left",region:"headTop",probe:"palmCenter",imagePoint:{x:.5,y:.2},regionUv:{x:0,y:0},imageNormal:{x:0,y:-1},overlap:1,approachVelocity,depth:{relation,confidence:.8,sources:{occlusion:.8,scaleChange:.8,motionConsistency:.8,posePrior:null,history:.8},rejectionReason:"none"},confidence:.85,evidence:{handGeometry:.9,bodyRegion:.8,overlap:1,motion:1,orientation:1,depth:.8,continuity:.8,finalConfidence:.85,hardRejections:[]},sampledAtMs});

describe("contact temporal clocks",()=>{
  it("advances evidence only on new detector timestamps and requires surface-compatible depth",()=>{
    let state=createContactTemporalState();
    state=updateContactEvidence(state,observation(0),0);
    state=updateContactEvidence(state,observation(60),60);expect(state.phase).toBe("approach");
    state=updateContactEvidence(state,observation(60),60);expect(state.phase).toBe("approach");
    state=updateContactEvidence(state,observation(130),130);expect(state.phase).toBe("near");
    state=updateContactEvidence(state,observation(220,"unknown"),220);expect(state.phase).toBe("near");
    state=updateContactEvidence(state,observation(230),230);expect(state.phase).toBe("touch");
  });
  it("uses render dt only for visual blending",()=>{
    const active={...createContactTemporalState(),phase:"hold" as const};
    const first=updateContactVisualInfluence(active,90);expect(first.visualInfluence).toBeCloseTo(.5);
    expect(first.phase).toBe("hold");
    expect(updateContactVisualInfluence(first,90).visualInfluence).toBe(1);
  });
  it("holds through short observation loss then releases",()=>{
    let state:ContactTemporalState={...createContactTemporalState(),phase:"hold",lastObservedAtMs:100,lastDetectorTimestampMs:100,region:"headTop",probe:"palmCenter"};
    state=updateContactEvidence(state,null,200);expect(state.phase).toBe("hold");
    state=updateContactEvidence(state,null,300);expect(state.phase).toBe("release");
    state=updateContactEvidence(state,null,410);expect(state.phase).toBe("idle");
  });
  it("distinguishes a stable hold from a moving slide",()=>{
    let state:ContactTemporalState={...createContactTemporalState(),phase:"hold",phaseSinceMs:0,candidateSinceMs:0,lastObservedAtMs:0,lastDetectorTimestampMs:0,region:"headTop",probe:"palmCenter"};
    state=updateContactEvidence(state,observation(100,"surface-compatible",.2),100);expect(state.phase).toBe("hold");
    state=updateContactEvidence(state,observation(190,"surface-compatible",.2),190);expect(state.phase).toBe("slide");
    state=updateContactEvidence(state,observation(200,"surface-compatible",.02),200);expect(state.phase).toBe("slide");
    state=updateContactEvidence(state,observation(290,"surface-compatible",.02),290);expect(state.phase).toBe("hold");
  });
});
