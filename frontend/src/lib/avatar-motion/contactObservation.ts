import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type {
  BodyContactRegion, BodyContactSurfaceFamily, ContactDepthEvidence, ContactEvidenceBreakdown,
  HandContactProbe, HumanBodyRegionCandidate, HumanBodyRegionInput, HumanContactObservation,
} from "./bodyContactTypes";
import { observeRigidHandContactProbes } from "./handContactProbe";
import { evaluateHumanBodyRegions } from "./humanBodyRegions";
import { buildHumanSemanticBodyModel } from "./humanSemanticBodyModel";

const clamp01=(value:number)=>Math.max(0,Math.min(1,value));
const regionFamily=(region:BodyContactRegion):BodyContactSurfaceFamily=>{
  if(region==="neck"||region==="backNeck")return"neck";
  if(region==="leftShoulder"||region==="rightShoulder")return"shoulder";
  if(region==="upperChest"||region==="lowerChest"||region==="abdomen")return"torso";
  return"head";
};
const rawUv=(region:HumanBodyRegionCandidate)=>region.rawUv??({x:0,y:0});

export interface ContactObservationInput extends HumanBodyRegionInput {
  side:"left"|"right";
  handLandmarks:RawNormalizedLandmarkV1[]|null|undefined;
  sampledAtMs:number;
  depth:ContactDepthEvidence;
  previousRegion?:BodyContactRegion|null;
  previousProbe?:HandContactProbe|null;
  normalVelocity?:number|null;
  tangentVelocity?:number|null;
  motionConfidence?:number|null;
  continuity?:number;
}

/** Shadow-mode observation only: this module never writes avatar joints. */
export function observeHumanContact(input:ContactObservationInput):HumanContactObservation|null{
  const probes=observeRigidHandContactProbes(input.handLandmarks,input.videoWidth,input.videoHeight);if(!probes.length)return null;
  const semanticModel=buildHumanSemanticBodyModel(input);
  let chosen:{probe:typeof probes[number];region:HumanBodyRegionCandidate;cost:number}|null=null,chosenCost=Infinity;
  const previousFamily=input.previousRegion?regionFamily(input.previousRegion):null;
  for(const probe of probes){
    const regions=evaluateHumanBodyRegions(input,probe.point,semanticModel);
    for(const region of regions){
      if(!Number.isFinite(region.signedDistance)||region.signedDistance>.9)continue;
      const family=region.surfaceFamily??regionFamily(region.region);
      // Physical family owns continuity. Semantic transitions within the fitted head/torso surface
      // are cheap and cannot reset contact just because a point crossed a cheek/temple boundary.
      const familySwitch=previousFamily&&family!==previousFamily ? .18 : 0;
      const semanticSwitch=input.previousRegion&&family===previousFamily&&region.region!==input.previousRegion ? .025 : 0;
      const probeSwitch=input.previousProbe&&probe.probe!==input.previousProbe ? .10 : 0;
      const outsidePenalty=Math.max(0,region.signedDistance)*.22;
      const anatomyPenalty=(1-(region.anatomicalConfidence??region.confidence))*.12;
      const modelPenalty=(1-(region.modelConfidence??region.confidence))*.06;
      const cost=region.signedDistance+familySwitch+semanticSwitch+probeSwitch+(1-probe.confidence)*.18+(1-region.confidence)*.16+
        anatomyPenalty+modelPenalty+(region.selectionBias??0)+outsidePenalty;
      if(cost<chosenCost){chosen={probe,region,cost};chosenCost=cost;}
    }
  }
  if(!chosen)return null;
  const uvRaw=rawUv(chosen.region);
  const regionUv={x:Math.max(-1,Math.min(1,uvRaw.x)),y:Math.max(-1,Math.min(1,uvRaw.y))};
  // Continuous family proxy drives projected overlap. Deep interior points are valid in a monocular
  // projection, so only positive outside-distance reduces overlap.
  const overlap=clamp01(1-Math.max(0,chosen.region.signedDistance));
  const motion=clamp01(input.motionConfidence??.5),orientation=clamp01(chosen.probe.confidence),continuity=clamp01(input.continuity??0);
  const hardRejections:string[]=[];
  if(input.depth.relation==="behind")hardRejections.push("depth-behind");
  if(input.depth.relation==="in-front-separated")hardRejections.push("depth-separated");
  const anatomyQ=clamp01(chosen.region.anatomicalConfidence??chosen.region.confidence);
  const modelQ=clamp01(chosen.region.modelConfidence??chosen.region.confidence);
  const topologyQ=clamp01(1-(chosen.region.selectionBias??0));
  const bodyRegionConfidence=clamp01(chosen.region.confidence*(.42+.34*anatomyQ+.14*modelQ+.10*topologyQ));
  const confidence=hardRejections.length?0:clamp01(
    chosen.probe.confidence*.21+bodyRegionConfidence*.20+overlap*.24+motion*.08+orientation*.08+input.depth.confidence*.08+continuity*.11
  );
  const evidence:ContactEvidenceBreakdown={handGeometry:chosen.probe.confidence,bodyRegion:bodyRegionConfidence,overlap,motion,orientation,depth:input.depth.confidence,continuity,finalConfidence:confidence,hardRejections};
  const tangentAngleRadians=chosen.probe.tangentHint?Math.atan2(chosen.probe.tangentHint.x,-chosen.probe.tangentHint.y):null;
  return{
    side:input.side,region:chosen.region.region,anatomicalLabel:chosen.region.anatomicalLabel,anatomicalSource:chosen.region.anatomicalSource,
    anatomicalConfidence:chosen.region.anatomicalConfidence,correctionEligible:chosen.region.correctionEligible??true,modelConfidence:chosen.region.modelConfidence,
    probe:chosen.probe.probe,imagePoint:chosen.probe.point,regionUv,regionRawUv:uvRaw,familyUv:chosen.region.familyUv,
    surfaceFamily:chosen.region.surfaceFamily??regionFamily(chosen.region.region),regionSelectionBias:chosen.region.selectionBias??0,
    regionSignedDistance:chosen.region.signedDistance,imageNormal:chosen.probe.contactNormal,tangentAngleRadians,overlap,
    normalVelocity:input.normalVelocity??null,tangentVelocity:input.tangentVelocity??null,depth:input.depth,confidence,evidence,sampledAtMs:input.sampledAtMs,
  };
}
