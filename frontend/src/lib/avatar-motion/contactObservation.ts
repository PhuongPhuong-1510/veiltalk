import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { BodyContactRegion, ContactDepthEvidence, ContactEvidenceBreakdown, HumanBodyRegionInput, HumanContactObservation } from "./bodyContactTypes";
import { observeRigidHandContactProbes } from "./handContactProbe";
import { evaluateHumanBodyRegions, selectHumanBodyRegion } from "./humanBodyRegions";

const clamp01=(value:number)=>Math.max(0,Math.min(1,value));
export interface ContactObservationInput extends HumanBodyRegionInput {
  side:"left"|"right";
  handLandmarks:RawNormalizedLandmarkV1[]|null|undefined;
  sampledAtMs:number;
  depth:ContactDepthEvidence;
  previousRegion?:BodyContactRegion|null;
  approachVelocity?:number|null;
  continuity?:number;
}

/** Shadow-mode observation only: this module never writes avatar joints. */
export function observeHumanContact(input:ContactObservationInput):HumanContactObservation|null{
  const probes=observeRigidHandContactProbes(input.handLandmarks,input.videoWidth,input.videoHeight);if(!probes.length)return null;
  let chosen:{probe:typeof probes[number];region:NonNullable<ReturnType<typeof selectHumanBodyRegion>>}|null=null,chosenCost=Infinity;
  for(const probe of probes){const region=selectHumanBodyRegion(evaluateHumanBodyRegions(input,probe.point),input.previousRegion??null);if(!region)continue;const cost=region.signedDistance+(1-probe.confidence)*.2+(1-region.confidence)*.2;if(cost<chosenCost){chosen={probe,region};chosenCost=cost;}}
  if(!chosen)return null;
  const overlap=clamp01(1-Math.max(0,chosen.region.signedDistance));
  const motion=input.approachVelocity===null||input.approachVelocity===undefined ? .5 : clamp01(1-Math.abs(input.approachVelocity)/.8);
  const orientation=chosen.probe.contactNormal?1:.25,continuity=clamp01(input.continuity??0);
  const hardRejections:string[]=[];
  if(input.depth.relation==="behind")hardRejections.push("depth-behind");
  if(input.depth.relation==="in-front-separated")hardRejections.push("depth-separated");
  const components=[chosen.probe.confidence,chosen.region.confidence,overlap,motion,orientation,input.depth.confidence,continuity];
  const confidence=hardRejections.length?0:components.reduce((product,value)=>product*Math.max(.05,value),1)**(1/components.length);
  const evidence:ContactEvidenceBreakdown={handGeometry:chosen.probe.confidence,bodyRegion:chosen.region.confidence,overlap,motion,orientation,depth:input.depth.confidence,continuity,finalConfidence:confidence,hardRejections};
  const regionUv={
    x:Math.max(-1,Math.min(1,(chosen.probe.point.x-chosen.region.center.x)/Math.max(1e-6,chosen.region.radius.x))),
    y:Math.max(-1,Math.min(1,(chosen.probe.point.y-chosen.region.center.y)/Math.max(1e-6,chosen.region.radius.y))),
  };
  return{side:input.side,region:chosen.region.region,probe:chosen.probe.probe,imagePoint:chosen.probe.point,regionUv,imageNormal:chosen.probe.contactNormal,overlap,approachVelocity:input.approachVelocity??null,depth:input.depth,confidence,evidence,sampledAtMs:input.sampledAtMs};
}
