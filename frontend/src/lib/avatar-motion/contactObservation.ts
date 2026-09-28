import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { BodyContactRegion, ContactDepthEvidence, ContactEvidenceBreakdown, HandContactProbe, HumanBodyRegionInput, HumanContactObservation } from "./bodyContactTypes";
import { observeRigidHandContactProbes } from "./handContactProbe";
import { evaluateHumanBodyRegions } from "./humanBodyRegions";

const clamp01=(value:number)=>Math.max(0,Math.min(1,value));

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
  let chosen:{probe:typeof probes[number];region:ReturnType<typeof evaluateHumanBodyRegions>[number]}|null=null,chosenCost=Infinity;
  for(const probe of probes){
    const regions=evaluateHumanBodyRegions(input,probe.point);
    for(const region of regions){
      if(!Number.isFinite(region.signedDistance)||region.signedDistance>.8)continue;
      const regionSwitch=input.previousRegion&&region.region!==input.previousRegion?.18:0;
      const probeSwitch=input.previousProbe&&probe.probe!==input.previousProbe?.12:0;
      const cost=region.signedDistance+regionSwitch+probeSwitch+(1-probe.confidence)*.2+(1-region.confidence)*.2;
      if(cost<chosenCost){chosen={probe,region};chosenCost=cost;}
    }
  }
  if(!chosen)return null;
  const overlap=clamp01(1-Math.max(0,chosen.region.signedDistance));
  const motion=clamp01(input.motionConfidence??.5),orientation=clamp01(chosen.probe.confidence),continuity=clamp01(input.continuity??0);
  const hardRejections:string[]=[];
  if(input.depth.relation==="behind")hardRejections.push("depth-behind");
  if(input.depth.relation==="in-front-separated")hardRejections.push("depth-separated");
  const confidence=hardRejections.length?0:clamp01(
    chosen.probe.confidence*.22+
    chosen.region.confidence*.18+
    overlap*.25+
    motion*.08+
    orientation*.08+
    input.depth.confidence*.08+
    continuity*.11
  );
  const evidence:ContactEvidenceBreakdown={handGeometry:chosen.probe.confidence,bodyRegion:chosen.region.confidence,overlap,motion,orientation,depth:input.depth.confidence,continuity,finalConfidence:confidence,hardRejections};
  const regionUv={
    x:Math.max(-1,Math.min(1,(chosen.probe.point.x-chosen.region.center.x)/Math.max(1e-6,chosen.region.radius.x))),
    y:Math.max(-1,Math.min(1,(chosen.probe.point.y-chosen.region.center.y)/Math.max(1e-6,chosen.region.radius.y))),
  };
  const tangentAngleRadians=chosen.probe.tangentHint?Math.atan2(chosen.probe.tangentHint.x,-chosen.probe.tangentHint.y):null;
  return{
    side:input.side,region:chosen.region.region,probe:chosen.probe.probe,imagePoint:chosen.probe.point,regionUv,
    regionSignedDistance:chosen.region.signedDistance,imageNormal:chosen.probe.contactNormal,tangentAngleRadians,overlap,
    normalVelocity:input.normalVelocity??null,tangentVelocity:input.tangentVelocity??null,depth:input.depth,confidence,evidence,sampledAtMs:input.sampledAtMs,
  };
}
