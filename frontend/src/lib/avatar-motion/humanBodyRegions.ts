import type {
  BodyContactRegion, BodyContactSurfaceFamily, ContactPoint2, ContactPoint3, HumanBodyRegionCandidate, HumanBodyRegionInput,
} from "./bodyContactTypes";
import {
  buildHumanSemanticBodyModel, classifyHeadAnatomy, pointSegmentNormalizedDistance,
  type HumanSemanticBodyModel,
} from "./humanSemanticBodyModel";
import { faceSurfaceCandidate } from "./humanFaceContactSurface";

const clamp01=(value:number)=>Math.max(0,Math.min(1,value));
const ellipseSignedDistance=(point:ContactPoint2,center:ContactPoint2,radius:ContactPoint2)=>Math.hypot((point.x-center.x)/Math.max(1e-6,radius.x),(point.y-center.y)/Math.max(1e-6,radius.y))-1;
const distance=(a:ContactPoint2,b:ContactPoint2)=>Math.hypot(a.x-b.x,a.y-b.y);
const midpoint=(a:ContactPoint2,b:ContactPoint2):ContactPoint2=>({x:(a.x+b.x)*.5,y:(a.y+b.y)*.5});
const normalize3=(value:ContactPoint3):ContactPoint3|null=>{const length=Math.hypot(value.x,value.y,value.z);return length>1e-8?{x:value.x/length,y:value.y/length,z:value.z/length}:null;};
const anteriorNormal=(uv:ContactPoint2,lateralGain=.55,verticalGain=.30):ContactPoint3=>normalize3({x:uv.x*lateralGain,y:uv.y*verticalGain,z:-1})??{x:0,y:0,z:-1};

function headCandidate(input:HumanBodyRegionInput,model:HumanSemanticBodyModel,point:ContactPoint2):HumanBodyRegionCandidate|null{
  if(input.faceSurface&&(input.posteriorHeadContactHint??0)<.5){const face=faceSurfaceCandidate(input.faceSurface,point);if(face)return face;}
  const head=model.head;if(!head)return null;
  const semantic=classifyHeadAnatomy(head,point,input.posteriorHeadContactHint??input.posteriorContactHint??0,input.headYawRadians??0);
  const familyDistance=ellipseSignedDistance(point,head.center,head.radius);
  const outside=Math.max(0,familyDistance);
  // The lower head and neck silhouettes overlap by design. Once the probe is visibly below the
  // fitted chin, prefer the neck family without using deeper negative ellipse distance as contact evidence.
  const belowChin=Math.max(0,(point.y-head.anchors.chin.point.y)/Math.max(1e-6,head.faceHeight));
  const selectionBias=(1-semantic.confidence)*.26+outside*.20+(semantic.correctionEligible?0:.10)+Math.min(.32,belowChin*3.2);
  const surfaceNormalCamera=semantic.solverRegion==="backHead"
    ? normalize3({x:-semantic.familyUv.x*.35,y:semantic.familyUv.y*.18,z:1})
    : anteriorNormal(semantic.familyUv,.62,.34);
  return{
    region:semantic.solverRegion,anatomicalLabel:semantic.anatomicalLabel,anatomicalSource:semantic.source,
    anatomicalConfidence:semantic.confidence,correctionEligible:semantic.correctionEligible,
    center:head.center,radius:head.radius,signedDistance:familyDistance,confidence:head.confidence,
    rawUv:semantic.regionUv,familyUv:semantic.familyUv,surfaceFamily:"head",surfaceNormalCamera,selectionBias,modelConfidence:model.confidence,
  };
}

function neckCandidate(input:HumanBodyRegionInput,model:HumanSemanticBodyModel,point:ContactPoint2):HumanBodyRegionCandidate|null{
  const neck=model.neck;if(!neck)return null;
  const geometry=pointSegmentNormalizedDistance(point,neck.start,neck.end,neck.radius);
  const posterior=clamp01(input.posteriorNeckContactHint??0),back=posterior>=.50;
  const region:BodyContactRegion=back?"backNeck":"neck";
  const confidence=neck.confidence*(back?.55+.45*posterior:1-.28*posterior);
  const surfaceNormalCamera=normalize3({x:geometry.uv.x*.55,y:0,z:back?1:-1});
  return{
    region,anatomicalLabel:region,anatomicalSource:back?"posterior-inference":"derived",anatomicalConfidence:confidence,
    correctionEligible:true,center:midpoint(neck.start,neck.end),radius:{x:neck.radius,y:distance(neck.start,neck.end)*.5+neck.radius},
    signedDistance:geometry.signedDistance,confidence,familyUv:geometry.uv,rawUv:geometry.uv,surfaceFamily:"neck",
    surfaceNormalCamera,selectionBias:(1-confidence)*.18,modelConfidence:model.confidence,
  };
}

function shoulderCandidates(model:HumanSemanticBodyModel,point:ContactPoint2):HumanBodyRegionCandidate[]{
  const shoulders=model.shoulders;if(!shoulders)return[];
  const radius={x:shoulders.radius,y:shoulders.radius*.92};
  return (["left","right"] as const).map(side=>{
    const value=shoulders[side],region=`${side}Shoulder` as BodyContactRegion;
    const rawUv={x:(point.x-value.point.x)/Math.max(1e-6,radius.x),y:(point.y-value.point.y)/Math.max(1e-6,radius.y)};
    const anatomicalSide=side==="left"?-1:1;
    const surfaceNormalCamera=normalize3({x:anatomicalSide*.42+rawUv.x*.20,y:rawUv.y*.18,z:-1});
    return{
      region,anatomicalLabel:region,anatomicalSource:value.source,anatomicalConfidence:value.confidence,correctionEligible:true,
      center:value.point,radius,signedDistance:ellipseSignedDistance(point,value.point,radius),confidence:value.confidence,
      rawUv,familyUv:rawUv,surfaceFamily:"shoulder" as BodyContactSurfaceFamily,surfaceNormalCamera,selectionBias:(1-value.confidence)*.16,modelConfidence:model.confidence,
    };
  });
}

function torsoCandidate(model:HumanSemanticBodyModel,point:ContactPoint2,strictFamilyBounds=false):HumanBodyRegionCandidate|null{
  const torso=model.torso;if(!torso)return null;
  const end=torso.hipCenter??{x:torso.shoulderCenter.x,y:torso.shoulderCenter.y+torso.length};
  if(strictFamilyBounds){const dx=end.x-torso.shoulderCenter.x,dy=end.y-torso.shoulderCenter.y,length=Math.hypot(dx,dy);
    const axial=length>1e-8?((point.x-torso.shoulderCenter.x)*dx+(point.y-torso.shoulderCenter.y)*dy)/length:0;
    if(axial < -torso.halfWidth*.12)return null;
  }
  const geometry=pointSegmentNormalizedDistance(point,torso.shoulderCenter,end,torso.halfWidth);
  const t=geometry.t;
  const region:BodyContactRegion=t<.36?"upperChest":t<.68?"lowerChest":"abdomen";
  const sectionStart=region==="upperChest"?0:region==="lowerChest"?.32:.64;
  const sectionEnd=region==="upperChest"?.40:region==="lowerChest"?.72:1;
  const localV=((t-sectionStart)/Math.max(1e-6,sectionEnd-sectionStart))*2-1;
  const regionUv={x:geometry.uv.x,y:localV};
  return{
    region,anatomicalLabel:region,anatomicalSource:"derived",anatomicalConfidence:torso.confidence,correctionEligible:true,
    center:midpoint(torso.shoulderCenter,end),radius:{x:torso.halfWidth,y:torso.length*.5},signedDistance:geometry.signedDistance,
    confidence:torso.confidence,rawUv:regionUv,familyUv:geometry.uv,surfaceFamily:"torso",surfaceNormalCamera:anteriorNormal({x:geometry.uv.x,y:0},.48,.08),selectionBias:(1-torso.confidence)*.18,modelConfidence:model.confidence,
  };
}

/**
 * One candidate per continuous physical surface (head/neck/torso) plus each shoulder. Semantic
 * labels are assigned only AFTER the family geometry has been fitted to the current person.
 */
export function evaluateHumanBodyRegions(
  input:HumanBodyRegionInput,point:ContactPoint2,preparedModel:HumanSemanticBodyModel=buildHumanSemanticBodyModel(input),
):HumanBodyRegionCandidate[]{
  const result:HumanBodyRegionCandidate[]=[];
  const head=headCandidate(input,preparedModel,point);if(head)result.push(head);
  const neck=neckCandidate(input,preparedModel,point);if(neck)result.push(neck);
  result.push(...shoulderCandidates(preparedModel,point));
  const torso=torsoCandidate(preparedModel,point,input.strictFamilyBounds);if(torso)result.push(torso);
  return result;
}

export function selectHumanBodyRegion(candidates:HumanBodyRegionCandidate[],previous:BodyContactRegion|null=null,switchPenalty=.18,maxSignedDistance=.9):HumanBodyRegionCandidate|null{
  let best:HumanBodyRegionCandidate|null=null,bestCost=Infinity;
  const family=(region:BodyContactRegion):BodyContactSurfaceFamily=>region==="neck"||region==="backNeck"?"neck":region==="leftShoulder"||region==="rightShoulder"?"shoulder":region==="upperChest"||region==="lowerChest"||region==="abdomen"?"torso":"head";
  const previousFamily=previous?family(previous):null;
  for(const candidate of candidates){
    if(!Number.isFinite(candidate.signedDistance)||candidate.signedDistance>maxSignedDistance)continue;
    const currentFamily=candidate.surfaceFamily??family(candidate.region);
    const continuity=previous&&candidate.region!==previous ? (currentFamily===previousFamily ? .04 : switchPenalty) : 0;
    const cost=Math.max(0,candidate.signedDistance)+continuity+(1-candidate.confidence)*.22+(1-(candidate.anatomicalConfidence??candidate.confidence))*.10+(candidate.selectionBias??0);
    if(cost<bestCost){best=candidate;bestCost=cost;}
  }
  return best;
}
