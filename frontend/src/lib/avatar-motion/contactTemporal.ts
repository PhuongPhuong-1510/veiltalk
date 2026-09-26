import type { BodyContactRegion, ContactPhase, HandContactProbe, HumanContactObservation } from "./bodyContactTypes";

export interface ContactTemporalConfig {
  approachConfidence:number; nearOverlap:number; touchConfidence:number; exitConfidence:number;
  approachConfirmMs:number; nearConfirmMs:number; touchConfirmMs:number; holdConfirmMs:number; releaseConfirmMs:number;
  slideEnterVelocity:number; slideExitVelocity:number; slideConfirmMs:number;
  occlusionGraceMs:number; acquireBlendMs:number; releaseBlendMs:number;
}
export const DEFAULT_CONTACT_TEMPORAL_CONFIG:ContactTemporalConfig={approachConfidence:.45,nearOverlap:.65,touchConfidence:.7,exitConfidence:.35,approachConfirmMs:50,nearConfirmMs:60,touchConfirmMs:80,holdConfirmMs:100,releaseConfirmMs:100,slideEnterVelocity:.16,slideExitVelocity:.08,slideConfirmMs:80,occlusionGraceMs:150,acquireBlendMs:180,releaseBlendMs:220};
export interface ContactTemporalState {
  phase:ContactPhase;region:BodyContactRegion|null;probe:HandContactProbe|null;
  candidateSinceMs:number|null;phaseSinceMs:number|null;lastDetectorTimestampMs:number|null;lastObservedAtMs:number|null;
  motionCandidateSinceMs:number|null;
  visualInfluence:number;
}
export const createContactTemporalState=():ContactTemporalState=>({phase:"idle",region:null,probe:null,candidateSinceMs:null,phaseSinceMs:null,lastDetectorTimestampMs:null,lastObservedAtMs:null,motionCandidateSinceMs:null,visualInfluence:0});

const transition=(state:ContactTemporalState,phase:ContactPhase,at:number):ContactTemporalState=>({...state,phase,phaseSinceMs:at,candidateSinceMs:at});

/** Detector-clock update. Duplicate/reversed samples never advance dwell timers. */
export function updateContactEvidence(state:ContactTemporalState,observation:HumanContactObservation|null,sampledAtMs:number,config:ContactTemporalConfig=DEFAULT_CONTACT_TEMPORAL_CONFIG):ContactTemporalState{
  if(state.lastDetectorTimestampMs!==null&&sampledAtMs<=state.lastDetectorTimestampMs)return state;
  let next:ContactTemporalState={...state,lastDetectorTimestampMs:sampledAtMs};
  const valid=Boolean(observation&&observation.confidence>=config.exitConfidence&&!observation.evidence.hardRejections.length);
  if(!valid){
    const age=state.lastObservedAtMs===null?Infinity:sampledAtMs-state.lastObservedAtMs;
    if((state.phase==="touch"||state.phase==="hold"||state.phase==="slide")&&age<=config.occlusionGraceMs)return next;
    if(state.phase!=="idle"&&state.phase!=="release")next=transition(next,"release",sampledAtMs);
    else if(state.phase==="release"&&state.phaseSinceMs!==null&&sampledAtMs-state.phaseSinceMs>=config.releaseConfirmMs)next={...transition(next,"idle",sampledAtMs),region:null,probe:null};
    return next;
  }
  const changed=state.region!==observation!.region||state.probe!==observation!.probe;
  if(changed)next={...next,region:observation!.region,probe:observation!.probe,candidateSinceMs:sampledAtMs,motionCandidateSinceMs:null};
  next.lastObservedAtMs=sampledAtMs;
  if(changed&&(state.phase==="touch"||state.phase==="hold"||state.phase==="slide"))return transition(next,"near",sampledAtMs);
  const dwell=sampledAtMs-(next.candidateSinceMs??sampledAtMs);
  if(next.phase==="idle"||next.phase==="release"){
    if(observation!.confidence>=config.approachConfidence&&dwell>=config.approachConfirmMs)next=transition(next,"approach",sampledAtMs);
  }else if(next.phase==="approach"&&observation!.overlap>=config.nearOverlap&&sampledAtMs-(next.phaseSinceMs??sampledAtMs)>=config.nearConfirmMs)next=transition(next,"near",sampledAtMs);
  else if(next.phase==="near"&&observation!.confidence>=config.touchConfidence&&observation!.depth.relation==="surface-compatible"&&sampledAtMs-(next.phaseSinceMs??sampledAtMs)>=config.touchConfirmMs)next=transition(next,"touch",sampledAtMs);
  else if(next.phase==="touch"&&Math.abs(observation!.approachVelocity??0)<=.08&&sampledAtMs-(next.phaseSinceMs??sampledAtMs)>=config.holdConfirmMs)next=transition(next,"hold",sampledAtMs);
  else if(next.phase==="hold"){
    if(Math.abs(observation!.approachVelocity??0)>=config.slideEnterVelocity){const since=next.motionCandidateSinceMs??sampledAtMs;next={...next,motionCandidateSinceMs:since};if(sampledAtMs-since>=config.slideConfirmMs)next={...transition(next,"slide",sampledAtMs),motionCandidateSinceMs:null};}
    else next={...next,motionCandidateSinceMs:null};
  }else if(next.phase==="slide"){
    if(Math.abs(observation!.approachVelocity??0)<=config.slideExitVelocity){const since=next.motionCandidateSinceMs??sampledAtMs;next={...next,motionCandidateSinceMs:since};if(sampledAtMs-since>=config.slideConfirmMs)next={...transition(next,"hold",sampledAtMs),motionCandidateSinceMs:null};}
    else next={...next,motionCandidateSinceMs:null};
  }
  return next;
}

/** Render-clock blend. It changes only visual influence and never confirms evidence. */
export function updateContactVisualInfluence(state:ContactTemporalState,renderDtMs:number,config:ContactTemporalConfig=DEFAULT_CONTACT_TEMPORAL_CONFIG):ContactTemporalState{
  const active=state.phase==="touch"||state.phase==="hold"||state.phase==="slide",target=active?1:0;
  const duration=target>state.visualInfluence?config.acquireBlendMs:config.releaseBlendMs;
  const step=duration<=0?1:Math.max(0,renderDtMs)/duration;
  const visualInfluence=target>state.visualInfluence?Math.min(target,state.visualInfluence+step):Math.max(target,state.visualInfluence-step);
  return{...state,visualInfluence};
}
