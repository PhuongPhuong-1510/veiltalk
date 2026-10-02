import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type {
  BodyContactRegion, BodyContactSurfaceFamily, ContactDepthEvidence, ContactEvidenceBreakdown,
  HandContactProbe, HumanBodyRegionCandidate, HumanBodyRegionInput, HumanContactObservation,
} from "./bodyContactTypes";
import { observeRigidHandContactProbes } from "./handContactProbe";
import { evaluateHumanBodyRegions } from "./humanBodyRegions";
import { buildHumanSemanticBodyModel } from "./humanSemanticBodyModel";
import { observeIndexFaceProbe } from "./indexFaceContactProbe";

const clamp01=(value:number)=>Math.max(0,Math.min(1,value));
const regionFamily=(region:BodyContactRegion):BodyContactSurfaceFamily=>{
  if(region==="neck"||region==="backNeck")return"neck";
  if(region==="leftShoulder"||region==="rightShoulder")return"shoulder";
  if(region==="upperChest"||region==="lowerChest"||region==="abdomen")return"torso";
  return"head";
};
const rawUv=(region:HumanBodyRegionCandidate)=>region.rawUv??({x:0,y:0});

export interface ContactObservationInput extends HumanBodyRegionInput {
  handWorldGeometryQuality?:number;
  trace?:ContactObservationTrace;
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
  orientationByProbe?:Partial<Record<HandContactProbe,number|null>>;
  /** Candidate-dependent orientation, in a verified shared camera direction convention. */
  orientationForCandidate?:(probe:HandContactProbe,region:HumanBodyRegionCandidate)=>number|null;
  jointProbeSelection?:boolean;
  preparedModel?:ReturnType<typeof buildHumanSemanticBodyModel>;
  indexTip?:boolean;
}
export interface ContactObservationTrace {
  status:"missing-hand-image"|"invalid-video-size"|"invalid-hand-landmarks"|"degenerate-hand-projection"|"no-body-candidate"|"selected";
  probes:Array<{probe:HandContactProbe;point:{x:number;y:number};confidence:number}>;
  candidates:Array<{probe:HandContactProbe;region:BodyContactRegion;family:BodyContactSurfaceFamily;cost:number;signedDistance:number;faceTriangle:number|null}>;
  selectedPoint?:{x:number;y:number};
}
export const createContactObservationTrace=():ContactObservationTrace=>({status:"no-body-candidate",probes:[],candidates:[]});

/** Shadow-mode observation only: this module never writes avatar joints. */
export function observeHumanContact(input:ContactObservationInput):HumanContactObservation|null{
  const probes=observeRigidHandContactProbes(input.handLandmarks,input.videoWidth,input.videoHeight,input.handWorldGeometryQuality);
  if(input.indexTip){const tip=observeIndexFaceProbe(input.handLandmarks,input.videoWidth,input.videoHeight);if(tip)probes.push(tip);}
  if(input.trace){input.trace.probes=probes.map(p=>({probe:p.probe,point:{...p.point},confidence:p.confidence}));input.trace.candidates=[];
    input.trace.status=probes.length?"no-body-candidate":!input.handLandmarks?.length?"missing-hand-image":!(input.videoWidth>0&&input.videoHeight>0)?"invalid-video-size":![0,5,9,13,17].every(i=>input.handLandmarks?.[i]&&[input.handLandmarks[i].x,input.handLandmarks[i].y].every(Number.isFinite))?"invalid-hand-landmarks":"degenerate-hand-projection";
  }
  if(!probes.length)return null;
  const semanticModel=input.preparedModel??buildHumanSemanticBodyModel(input);
  let runnerUp=Infinity;
  let chosen:{probe:typeof probes[number];region:HumanBodyRegionCandidate;cost:number}|null=null,chosenCost=Infinity;
  const previousFamily=input.previousRegion?regionFamily(input.previousRegion):null;
  for(const probe of probes){
    const regions=evaluateHumanBodyRegions(input,probe.point,semanticModel);
    for(const region of regions){
      if(probe.probe==="indexTip"&&region.surfaceFamily!=="head")continue;
      if(!Number.isFinite(region.signedDistance)||region.signedDistance>.9)continue;
      const family=region.surfaceFamily??regionFamily(region.region);
      // Physical family owns continuity. Semantic transitions within the fitted head/torso surface
      // are cheap and cannot reset contact just because a point crossed a cheek/temple boundary.
      const familySwitch=previousFamily&&family!==previousFamily ? .18 : 0;
      const semanticSwitch=input.previousRegion&&family===previousFamily&&region.region!==input.previousRegion ? .025 : 0;
      const probeSwitch=input.previousProbe&&probe.probe!==input.previousProbe ? .10 : 0;
      // Once a point is inside a silhouette, being deeper inside is not evidence of contact and
      // must not make one family beat another. Monocular projection cannot provide that fact.
      const outsideDistance=Math.max(0,region.signedDistance);
      const outsidePenalty=outsideDistance*.22;
      const anatomyPenalty=(1-(region.anatomicalConfidence??region.confidence))*.12;
      const modelPenalty=(1-(region.modelConfidence??region.confidence))*.06;
      const measured=input.orientationForCandidate?.(probe.probe,region)??input.orientationByProbe?.[probe.probe]??null;
      const orientationCost=input.jointProbeSelection&&measured!==null?(1-clamp01(measured))*.42:0;
      const cost=outsideDistance+familySwitch+semanticSwitch+probeSwitch+(1-probe.confidence)*.18+(1-region.confidence)*.16+
        anatomyPenalty+modelPenalty+(region.selectionBias??0)+outsidePenalty+orientationCost;
      input.trace?.candidates.push({probe:probe.probe,region:region.region,family,cost,signedDistance:region.signedDistance,faceTriangle:region.faceLocation?.triangle??null});
      if(cost<chosenCost){runnerUp=chosenCost;chosen={probe,region,cost};chosenCost=cost;}else runnerUp=Math.min(runnerUp,cost);
    }
  }
  if(!chosen)return null;
  if(input.trace){input.trace.status="selected";input.trace.selectedPoint={...chosen.probe.point};input.trace.candidates.sort((a,b)=>a.cost-b.cost);}
  const uvRaw=rawUv(chosen.region);
  const regionUv={x:Math.max(-1,Math.min(1,uvRaw.x)),y:Math.max(-1,Math.min(1,uvRaw.y))};
  // Continuous family proxy drives projected overlap. Deep interior points are valid in a monocular
  // projection, so only positive outside-distance reduces overlap.
  const overlap=clamp01(1-Math.max(0,chosen.region.signedDistance));
  const motion=clamp01(input.motionConfidence??.5),orientationRaw=input.orientationForCandidate?.(chosen.probe.probe,chosen.region)??input.orientationByProbe?.[chosen.probe.probe]??null;
  // Unknown orientation is neutral, not positive evidence. A measured orientation is independent
  // from probe geometry and can therefore strengthen or weaken acquisition.
  const orientation=orientationRaw===null?.5:clamp01(orientationRaw),continuity=clamp01(input.continuity??0);
  const hardRejections:string[]=[];
  if(input.depth.relation==="behind")hardRejections.push("depth-behind");
  if(input.depth.relation==="in-front-separated")hardRejections.push("depth-separated");
  const anatomyQ=clamp01(chosen.region.anatomicalConfidence??chosen.region.confidence);
  const modelQ=clamp01(chosen.region.modelConfidence??chosen.region.confidence);
  const topologyQ=clamp01(1-(chosen.region.selectionBias??0));
  const bodyRegionConfidence=clamp01(chosen.region.confidence*(.42+.34*anatomyQ+.14*modelQ+.10*topologyQ));
  const candidateQuality=clamp01(chosen.probe.confidence*.36+bodyRegionConfidence*.34+overlap*.30);
  const confidence=hardRejections.length?0:clamp01(
    candidateQuality*.49+motion*.08+orientation*.14+input.depth.confidence*.18+continuity*.11
  );
  const nv=input.normalVelocity??null;
  const closing=nv===null?0:clamp01((-nv-.04)/.55);
  const separating=nv===null?0:clamp01((nv-.04)/.55);
  const stopping=nv===null?0:clamp01(1-Math.abs(nv)/.18);
  const evidence:ContactEvidenceBreakdown={handGeometry:chosen.probe.confidence,bodyRegion:bodyRegionConfidence,overlap,motion,orientation,depth:input.depth.confidence,continuity,finalConfidence:confidence,hardRejections,closing,stopping,separating,tracking:candidateQuality};
  const tangentAngleRadians=chosen.probe.tangentHint?Math.atan2(chosen.probe.tangentHint.x,-chosen.probe.tangentHint.y):null;
  return{
    side:input.side,region:chosen.region.region,anatomicalLabel:chosen.region.anatomicalLabel,anatomicalSource:chosen.region.anatomicalSource,
    anatomicalConfidence:chosen.region.anatomicalConfidence,correctionEligible:chosen.region.correctionEligible??true,modelConfidence:chosen.region.modelConfidence,
    probe:chosen.probe.probe,imagePoint:chosen.probe.point,regionUv,regionRawUv:uvRaw,familyUv:chosen.region.familyUv,
    surfaceFamily:chosen.region.surfaceFamily??regionFamily(chosen.region.region),regionSelectionBias:chosen.region.selectionBias??0,
    regionSignedDistance:chosen.region.signedDistance,imageNormal:chosen.probe.contactNormal,tangentAngleRadians,overlap,
    normalVelocity:nv,tangentVelocity:input.tangentVelocity??null,orientationCompatibility:orientationRaw,candidateQuality,depth:input.depth,confidence,evidence,sampledAtMs:input.sampledAtMs,
    selectionMargin:Number.isFinite(runnerUp)?runnerUp-chosenCost:null,ambiguous:input.jointProbeSelection&&Number.isFinite(runnerUp)&&runnerUp-chosenCost<.025,
    faceLocation:chosen.region.faceLocation,
  };
}
