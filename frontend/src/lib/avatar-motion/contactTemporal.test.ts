import { describe,expect,it } from "vitest";
import type { HumanContactObservation } from "./bodyContactTypes";
import type { ContactTemporalState } from "./contactTemporal";
import { createContactTemporalState,updateContactEvidence,updateContactVisualInfluence } from "./contactTemporal";

const observation=(sampledAtMs:number,relation:HumanContactObservation["depth"]["relation"]="surface-compatible",tangentVelocity=0):HumanContactObservation=>({side:"left",region:"headTop",probe:"palmCenter",imagePoint:{x:.5,y:.2},regionUv:{x:0,y:0},regionSignedDistance:0,imageNormal:{x:0,y:-1},tangentAngleRadians:0,overlap:1,normalVelocity:0,tangentVelocity,depth:{relation,confidence:.8,sources:{occlusion:.8,scaleChange:.8,motionConsistency:.8,posePrior:null,history:.8},rejectionReason:"none"},confidence:.85,evidence:{handGeometry:.9,bodyRegion:.8,overlap:1,motion:1,orientation:1,depth:.8,continuity:.8,finalConfidence:.85,hardRejections:[]},sampledAtMs});

describe("contact temporal clocks",()=>{
  it("advances evidence only on new detector timestamps and requires surface-compatible depth",()=>{
    let state=createContactTemporalState();
    state=updateContactEvidence(state,observation(0),0);
    state=updateContactEvidence(state,observation(60),60);expect(state.phase).toBe("approach");
    state=updateContactEvidence(state,observation(60),60);expect(state.phase).toBe("approach");
    state=updateContactEvidence(state,observation(130),130);expect(state.phase).toBe("approach");
    state=updateContactEvidence(state,observation(200),200);expect(state.phase).toBe("near");
    state=updateContactEvidence(state,observation(290,"unknown"),290);expect(state.phase).toBe("near");
    state=updateContactEvidence(state,observation(300),300);expect(state.phase).toBe("near");
    state=updateContactEvidence(state,observation(390),390);expect(state.phase).toBe("near");
    state=updateContactEvidence(state,observation(490),490);expect(state.phase).toBe("touch");
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
    state=updateContactEvidence(state,null,300);expect(state.phase).toBe("hold");
    state=updateContactEvidence(state,null,410);expect(state.phase).toBe("release");
    state=updateContactEvidence(state,null,520);expect(state.phase).toBe("idle");
  });
  it("never acquires contact while monocular depth remains unknown",()=>{
    let state=createContactTemporalState();
    for(const at of [0,60,130,200,400,800,1_200])state=updateContactEvidence(state,observation(at,"unknown",0),at);
    expect(state.phase).toBe("near");
    expect(state.visualInfluence).toBe(0);
  });
  it("distinguishes a stable hold from a moving slide",()=>{
    let state:ContactTemporalState={...createContactTemporalState(),phase:"hold",phaseSinceMs:0,candidateSinceMs:0,lastObservedAtMs:0,lastDetectorTimestampMs:0,region:"headTop",probe:"palmCenter"};
    state=updateContactEvidence(state,observation(100,"surface-compatible",.2),100);expect(state.phase).toBe("hold");
    state=updateContactEvidence(state,observation(190,"surface-compatible",.2),190);expect(state.phase).toBe("slide");
    state=updateContactEvidence(state,observation(200,"surface-compatible",.02),200);expect(state.phase).toBe("slide");
    state=updateContactEvidence(state,observation(290,"surface-compatible",.02),290);expect(state.phase).toBe("hold");
  });
  it("releases immediately on strong separating motion",()=>{
    let state:ContactTemporalState={...createContactTemporalState(),phase:"hold",phaseSinceMs:0,candidateSinceMs:0,lastObservedAtMs:0,lastDetectorTimestampMs:0,region:"headTop",probe:"palmCenter"};
    const pulling={...observation(40),normalVelocity:.7,evidence:{...observation(40).evidence,separating:1}};
    state=updateContactEvidence(state,pulling,40);expect(state.phase).toBe("release");
  });
  it("does not bootstrap a lateral pass-by into contact",()=>{
    let state=createContactTemporalState();
    for(const at of [0,60,130,200,300,500,800])state=updateContactEvidence(state,observation(at,"surface-compatible",.4),at);
    expect(state.phase).toBe("near");
  });
});
