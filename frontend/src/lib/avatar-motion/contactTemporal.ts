import type { BodyContactRegion, ContactPhase, HandContactProbe, HumanContactObservation } from "./bodyContactTypes";

export interface ContactTemporalConfig {
  approachConfidence:number; nearOverlap:number; touchConfidence:number; exitConfidence:number;
  approachConfirmMs:number; nearConfirmMs:number; touchConfirmMs:number; holdConfirmMs:number; releaseConfirmMs:number;
  slideEnterVelocity:number; slideExitVelocity:number; slideConfirmMs:number;
  occlusionGraceMs:number; acquireBlendMs:number; releaseBlendMs:number;
}

export const DEFAULT_CONTACT_TEMPORAL_CONFIG:ContactTemporalConfig={
  approachConfidence:.45,nearOverlap:.65,touchConfidence:.7,exitConfidence:.35,
  approachConfirmMs:50,nearConfirmMs:60,touchConfirmMs:80,holdConfirmMs:100,releaseConfirmMs:100,
  slideEnterVelocity:.16,slideExitVelocity:.08,slideConfirmMs:80,
  occlusionGraceMs:250,acquireBlendMs:180,releaseBlendMs:220,
};

export interface ContactTemporalState {
  phase:ContactPhase;region:BodyContactRegion|null;probe:HandContactProbe|null;
  candidateSinceMs:number|null;phaseSinceMs:number|null;lastDetectorTimestampMs:number|null;lastObservedAtMs:number|null;
  motionCandidateSinceMs:number|null;visualInfluence:number;
  lastSurfaceCompatibleAtMs?:number|null;
  approachConditionSinceMs?:number|null;
  nearConditionSinceMs?:number|null;
  touchConditionSinceMs?:number|null;
  holdConditionSinceMs?:number|null;
}

export const createContactTemporalState=():ContactTemporalState=>({
  phase:"idle",region:null,probe:null,candidateSinceMs:null,phaseSinceMs:null,lastDetectorTimestampMs:null,lastObservedAtMs:null,
  motionCandidateSinceMs:null,visualInfluence:0,lastSurfaceCompatibleAtMs:null,approachConditionSinceMs:null,nearConditionSinceMs:null,
  touchConditionSinceMs:null,holdConditionSinceMs:null,
});

const activePhase=(phase:ContactPhase)=>phase==="touch"||phase==="hold"||phase==="slide";
const transition=(state:ContactTemporalState,phase:ContactPhase,at:number):ContactTemporalState=>({...state,phase,phaseSinceMs:at,candidateSinceMs:at,motionCandidateSinceMs:null});
const conditionSince=(since:number|null|undefined,ok:boolean,at:number)=>ok?(since??at):null;

/** Detector-clock update. Duplicate/reversed samples never advance dwell timers. */
export function updateContactEvidence(state:ContactTemporalState,observation:HumanContactObservation|null,sampledAtMs:number,config:ContactTemporalConfig=DEFAULT_CONTACT_TEMPORAL_CONFIG):ContactTemporalState{
  if(state.lastDetectorTimestampMs!==null&&sampledAtMs<=state.lastDetectorTimestampMs)return state;
  let next:ContactTemporalState={...state,lastDetectorTimestampMs:sampledAtMs};
  const explicitReject=Boolean(observation?.evidence.hardRejections.length);
  const present=Boolean(observation&&observation.confidence>=config.exitConfidence&&!explicitReject);
  if(observation?.depth.relation==="surface-compatible")next.lastSurfaceCompatibleAtMs=sampledAtMs;

  if(!present){
    const age=state.lastObservedAtMs===null?Infinity:sampledAtMs-state.lastObservedAtMs;
    if(activePhase(state.phase)&&!explicitReject&&age<=config.occlusionGraceMs)return next;
    if(state.phase!=="idle"&&state.phase!=="release")return transition(next,"release",sampledAtMs);
    if(state.phase==="release"&&state.phaseSinceMs!==null&&sampledAtMs-state.phaseSinceMs>=config.releaseConfirmMs)
      return{...transition(next,"idle",sampledAtMs),region:null,probe:null,lastSurfaceCompatibleAtMs:null};
    return next;
  }

  next.lastObservedAtMs=sampledAtMs;
  const observationRegion=observation!.region,observationProbe=observation!.probe;
  if(!activePhase(next.phase)){
    const identityChanged=next.region!==observationRegion||next.probe!==observationProbe;
    if(identityChanged)next={...next,region:observationRegion,probe:observationProbe,candidateSinceMs:sampledAtMs,approachConditionSinceMs:null,nearConditionSinceMs:null,touchConditionSinceMs:null,holdConditionSinceMs:null};
  }

  if(activePhase(next.phase)&&observation!.depth.relation!=="surface-compatible"){
    const age=next.lastSurfaceCompatibleAtMs===null||next.lastSurfaceCompatibleAtMs===undefined?Infinity:sampledAtMs-next.lastSurfaceCompatibleAtMs;
    if(age>config.occlusionGraceMs)return transition(next,"release",sampledAtMs);
  }

  if(next.phase==="idle"||next.phase==="release"){
    const ok=observation!.confidence>=config.approachConfidence;
    next.approachConditionSinceMs=conditionSince(next.approachConditionSinceMs,ok,sampledAtMs);
    if(ok&&sampledAtMs-(next.approachConditionSinceMs??sampledAtMs)>=config.approachConfirmMs){
      next=transition(next,"approach",sampledAtMs);next.approachConditionSinceMs=null;
    }
    return next;
  }

  if(next.phase==="approach"){
    const ok=observation!.overlap>=config.nearOverlap;
    next.nearConditionSinceMs=conditionSince(next.nearConditionSinceMs,ok,sampledAtMs);
    if(ok&&sampledAtMs-(next.nearConditionSinceMs??sampledAtMs)>=config.nearConfirmMs){next=transition(next,"near",sampledAtMs);next.nearConditionSinceMs=null;}
    return next;
  }

  if(next.phase==="near"){
    const ok=observation!.confidence>=config.touchConfidence&&observation!.depth.relation==="surface-compatible";
    next.touchConditionSinceMs=conditionSince(next.touchConditionSinceMs,ok,sampledAtMs);
    if(ok&&sampledAtMs-(next.touchConditionSinceMs??sampledAtMs)>=config.touchConfirmMs){next=transition(next,"touch",sampledAtMs);next.touchConditionSinceMs=null;}
    return next;
  }

  if(next.phase==="touch"){
    const stableNormal=observation!.normalVelocity!==null&&Math.abs(observation!.normalVelocity)<=config.slideExitVelocity;
    next.holdConditionSinceMs=conditionSince(next.holdConditionSinceMs,stableNormal,sampledAtMs);
    if(stableNormal&&sampledAtMs-(next.holdConditionSinceMs??sampledAtMs)>=config.holdConfirmMs){next=transition(next,"hold",sampledAtMs);next.holdConditionSinceMs=null;}
    return next;
  }

  if(next.phase==="hold"){
    const sliding=observation!.tangentVelocity!==null&&observation!.tangentVelocity>=config.slideEnterVelocity&&
      (observation!.normalVelocity===null||Math.abs(observation!.normalVelocity)<=config.slideExitVelocity*1.5);
    const since=conditionSince(next.motionCandidateSinceMs,sliding,sampledAtMs);next={...next,motionCandidateSinceMs:since};
    if(sliding&&sampledAtMs-(since??sampledAtMs)>=config.slideConfirmMs)next={...transition(next,"slide",sampledAtMs),motionCandidateSinceMs:null};
    return next;
  }

  if(next.phase==="slide"){
    const stopped=observation!.tangentVelocity!==null&&observation!.tangentVelocity<=config.slideExitVelocity;
    const since=conditionSince(next.motionCandidateSinceMs,stopped,sampledAtMs);next={...next,motionCandidateSinceMs:since};
    if(stopped&&sampledAtMs-(since??sampledAtMs)>=config.slideConfirmMs)next={...transition(next,"hold",sampledAtMs),motionCandidateSinceMs:null};
  }
  return next;
}

/** Render-clock blend. It changes only visual influence and never confirms evidence. */
export function updateContactVisualInfluence(state:ContactTemporalState,renderDtMs:number,config:ContactTemporalConfig=DEFAULT_CONTACT_TEMPORAL_CONFIG):ContactTemporalState{
  const active=activePhase(state.phase),target=active?1:0;
  const duration=target>state.visualInfluence?config.acquireBlendMs:config.releaseBlendMs;
  const step=duration<=0?1:Math.max(0,renderDtMs)/duration;
  const visualInfluence=target>state.visualInfluence?Math.min(target,state.visualInfluence+step):Math.max(target,state.visualInfluence-step);
  return{...state,visualInfluence};
}

/** Wall/render-clock fail-safe only. It can release stale contact but can never acquire/confirm one. */
export function forceContactRelease(state:ContactTemporalState,atMs:number):ContactTemporalState{
  if(state.phase==="idle"||state.phase==="release")return state;
  return transition(state,"release",atMs);
}
