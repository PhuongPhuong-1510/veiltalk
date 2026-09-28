import type { ContactDepthEvidence, ContactDepthRelation } from "./bodyContactTypes";

export type ContactDepthSources=ContactDepthEvidence["sources"];
const clamp01=(value:number)=>Math.max(0,Math.min(1,value));

/**
 * Fuses candidate-relative depth evidence. A hard relation may be supplied only from a
 * directional cue whose sign convention is known (for example Pose wrist-vs-nose depth).
 * History and motion may support confidence but can never assert geometric separation alone.
 */
export function fuseContactDepthEvidence(
  sources:ContactDepthSources,
  hardRelation:Extract<ContactDepthRelation,"behind"|"in-front-separated">|null=null,
):ContactDepthEvidence{
  if(hardRelation)return{
    relation:hardRelation,
    confidence:.9,
    sources,
    rejectionReason:hardRelation==="behind"?"behind-evidence":"separated-evidence",
  };
  // Soft priors are intentionally unable to manufacture a hard geometric relation. In particular,
  // Pose wrist-vs-body z can be strongly negative during a genuine palm contact because the wrist
  // joint is physically in front of the contacted surface. A hard relation is accepted only through
  // the explicit `hardRelation` argument from a cue whose directional semantics are independently
  // established.
  const motionSupports=(sources.motionConsistency??0)>=.5;
  const poseSupports=(sources.posePrior??0)>=.5;
  const auxiliarySupports=[sources.occlusion,sources.scaleChange,sources.history].filter((value):value is number=>value!==null&&value>=.5).length>0;
  if(motionSupports&&poseSupports&&auxiliarySupports){
    const values=[sources.motionConsistency,sources.posePrior,sources.occlusion,sources.scaleChange,sources.history].filter((value):value is number=>value!==null&&value>0);
    const confidence=values.reduce((sum,value)=>sum+value,0)/Math.max(1,values.length);
    return{relation:"surface-compatible",confidence:clamp01(confidence),sources,rejectionReason:"none"};
  }

  const available=Object.values(sources).filter((value):value is number=>value!==null&&Number.isFinite(value));
  const confidence=available.length?clamp01(available.reduce((sum,value)=>sum+Math.max(0,value),0)/available.length):0;
  return{relation:"unknown",confidence,sources,rejectionReason:"insufficient-cues"};
}
