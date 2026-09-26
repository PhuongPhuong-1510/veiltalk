import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";

export type BodyContactRegion = "headTop"|"forehead"|"leftCheek"|"rightCheek"|"chin"|"neck"|"leftShoulder"|"rightShoulder"|"upperChest";
export type HandContactProbe = "palmCenter"|"ulnarEdge"|"radialEdge";
export type ContactDepthRelation = "in-front-separated"|"surface-compatible"|"behind"|"unknown";
export type ContactPhase = "idle"|"approach"|"near"|"touch"|"hold"|"slide"|"release";

export interface ContactPoint2 { x:number; y:number }
export interface HumanBodyRegionCandidate {
  region:BodyContactRegion;
  center:ContactPoint2;
  radius:ContactPoint2;
  /** <=0 is inside the semantic patch; positive values are normalized separation. */
  signedDistance:number;
  confidence:number;
}
export interface HandContactProbeObservation {
  probe:HandContactProbe;
  point:ContactPoint2;
  contactNormal:ContactPoint2|null;
  tangentHint:ContactPoint2|null;
  confidence:number;
}
export interface ContactDepthEvidence {
  relation:ContactDepthRelation;
  confidence:number;
  sources:{occlusion:number|null;scaleChange:number|null;motionConsistency:number|null;posePrior:number|null;history:number|null};
  rejectionReason:"none"|"behind-evidence"|"separated-evidence"|"insufficient-cues";
}
export interface ContactEvidenceBreakdown {
  handGeometry:number; bodyRegion:number; overlap:number; motion:number; orientation:number; depth:number; continuity:number;
  finalConfidence:number; hardRejections:string[];
}
export interface HumanContactObservation {
  side:"left"|"right";
  region:BodyContactRegion;
  probe:HandContactProbe;
  imagePoint:ContactPoint2;
  imageNormal:ContactPoint2|null;
  overlap:number;
  approachVelocity:number|null;
  depth:ContactDepthEvidence;
  confidence:number;
  evidence:ContactEvidenceBreakdown;
  sampledAtMs:number;
}

export interface HumanBodyRegionInput {
  faceLandmarks:RawNormalizedLandmarkV1[]|null|undefined;
  poseLandmarks?:RawNormalizedLandmarkV1[]|null;
  videoWidth:number;
  videoHeight:number;
  headYawRadians?:number|null;
  /** True only when landmark x has already been mirrored before entering this module. CSS video mirroring does not count. */
  imageMirrored?:boolean;
}
