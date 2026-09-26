import type { ContactDepthEvidence } from "./bodyContactTypes";

export type ContactDepthSources=ContactDepthEvidence["sources"];
const clamp01=(value:number)=>Math.max(0,Math.min(1,value));

/**
 * Cue convention: +1 supports surface compatibility, -1 contradicts it, null is unavailable.
 * No single cue can promote a contact. Motion plus at least two other independent cues are required.
 */
export function fuseContactDepthEvidence(sources:ContactDepthSources):ContactDepthEvidence{
  const values=Object.values(sources).filter((value):value is number=>value!==null&&Number.isFinite(value)).map(value=>Math.max(-1,Math.min(1,value)));
  if((sources.posePrior??0)<=-.7||(sources.occlusion??0)<=-.85)return{relation:"behind",confidence:clamp01(Math.max(-(sources.posePrior??0),-(sources.occlusion??0))),sources,rejectionReason:"behind-evidence"};
  const strongestNegative=values.length?Math.min(...values):0;
  if(strongestNegative<=-.65)return{relation:"in-front-separated",confidence:clamp01(-strongestNegative),sources,rejectionReason:"separated-evidence"};
  const positive=values.filter(value=>value>=.5);
  const motionSupports=(sources.motionConsistency??0)>=.5;
  const spatialSupports=[sources.occlusion,sources.scaleChange,sources.posePrior].filter((value):value is number=>value!==null&&value>=.5).length>0;
  if(positive.length>=3&&motionSupports&&spatialSupports){const confidence=positive.reduce((sum,value)=>sum+value,0)/positive.length;return{relation:"surface-compatible",confidence:clamp01(confidence),sources,rejectionReason:"none"};}
  return{relation:"unknown",confidence:values.length?clamp01(values.reduce((sum,value)=>sum+Math.max(0,value),0)/values.length):0,sources,rejectionReason:"insufficient-cues"};
}
