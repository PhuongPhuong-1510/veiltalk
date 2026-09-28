import type { ContactDepthEvidence, ContactDepthRelation } from "./bodyContactTypes";

export type ContactDepthSources=ContactDepthEvidence["sources"];
const clamp01=(value:number)=>Math.max(0,Math.min(1,value));
const available=(value:number|null):value is number=>value!==null&&Number.isFinite(value);

/**
 * Fuses candidate-relative depth evidence. A hard relation may be supplied only from a
 * directional cue whose sign convention is known. Pose wrist-vs-body z is deliberately soft:
 * wrist is not the contacting palm surface and can sit far in front of a true contact.
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

  const motion=sources.motionConsistency,pose=sources.posePrior,history=sources.history;
  const temporalStable=(motion??0)>=.55&&(history??0)>=.6;
  // A weak Pose prior must not veto a long-lived stationary contact. It may prevent the fast path
  // when strongly contradictory, while the temporal layer still has a conservative unknown-depth path.
  const poseNotStronglyContradictory=pose===null||pose>=.14;
  const multiCue=(motion??0)>=.5&&(history??0)>=.5&&(pose??0)>=.35;
  const auxiliary=[sources.occlusion,sources.scaleChange].filter(available).some(value=>value>=.55);
  const auxiliaryCue=(motion??0)>=.5&&(pose??0)>=.3&&auxiliary;

  if((temporalStable&&poseNotStronglyContradictory)||multiCue||auxiliaryCue){
    const weighted:[number|null,number][]=[
      [motion,.34],[history,.30],[pose,.20],[sources.occlusion,.08],[sources.scaleChange,.08],
    ];
    let sum=0,weight=0;
    for(const[value,w]of weighted)if(available(value)){sum+=clamp01(value)*w;weight+=w;}
    return{relation:"surface-compatible",confidence:weight?clamp01(sum/weight):.5,sources,rejectionReason:"none"};
  }

  const values=Object.values(sources).filter(available);
  const confidence=values.length?clamp01(values.reduce((sum,value)=>sum+Math.max(0,value),0)/values.length):0;
  return{relation:"unknown",confidence,sources,rejectionReason:"insufficient-cues"};
}
