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

  // Only cues with a defined direction may reject a candidate. Occlusion ordering is strong;
  // scale separation needs corroborating motion and history before it becomes a hard relation.
  if(available(sources.occlusion)&&sources.occlusion<=-.75)return{
    relation:"behind",confidence:clamp01(-sources.occlusion),sources,rejectionReason:"behind-evidence",
  };
  if(available(sources.scaleChange)&&sources.scaleChange<=-.65&&
    (sources.motionConsistency??0)>=.55&&(sources.history??0)>=.55)return{
    relation:"in-front-separated",confidence:clamp01(-sources.scaleChange),sources,rejectionReason:"separated-evidence",
  };

  const motion=sources.motionConsistency,pose=sources.posePrior,probeDepth=sources.probeDepth??null;
  // History is hysteresis only. It must never turn an otherwise unknown depth estimate into a
  // physical surface-compatible observation. Compatibility needs an independent depth cue.
  const auxiliary=[sources.occlusion,sources.scaleChange].filter(available).some(value=>value>=.55);
  const calibratedProbe=(probeDepth??0)>=.62&&(pose??0)>=.32;
  const auxiliaryCue=auxiliary&&((motion??0)>=.45||(pose??0)>=.35);

  if(calibratedProbe||auxiliaryCue){
    const weighted:[number|null,number][]=[
      [probeDepth,.28],[motion,.22],[sources.history,.18],[pose,.16],[sources.occlusion,.08],[sources.scaleChange,.08],
    ];
    let sum=0,weight=0;
    for(const[value,w]of weighted)if(available(value)){sum+=clamp01(value)*w;weight+=w;}
    return{relation:"surface-compatible",confidence:weight?clamp01(sum/weight):.5,sources,rejectionReason:"none"};
  }

  const values=Object.values(sources).filter(available);
  const confidence=values.length?clamp01(values.reduce((sum,value)=>sum+Math.max(0,value),0)/values.length):0;
  return{relation:"unknown",confidence,sources,rejectionReason:"insufficient-cues"};
}
