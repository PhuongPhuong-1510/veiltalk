import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";

export type BodyContactRegion =
  | "headTop" | "forehead" | "leftCheek" | "rightCheek" | "mouth" | "chin"
  | "leftEar" | "rightEar" | "backHead" | "neck" | "backNeck"
  | "leftShoulder" | "rightShoulder" | "upperChest" | "lowerChest" | "abdomen";

export type HandContactProbe = "palmCenter" | "ulnarEdge" | "radialEdge";
export type ContactDepthRelation = "in-front-separated" | "surface-compatible" | "behind" | "unknown";
export type ContactPhase = "idle" | "approach" | "near" | "touch" | "hold" | "slide" | "release";

export interface ContactPoint2 { x:number; y:number }

export interface HumanBodyRegionCandidate {
  region:BodyContactRegion;
  center:ContactPoint2;
  radius:ContactPoint2;
  /** <= 0 is inside the semantic patch; positive values are normalized separation. */
  signedDistance:number;
  confidence:number;
}

export interface HandContactProbeObservation {
  probe:HandContactProbe;
  point:ContactPoint2;
  /** 2D edge-normal only. Palm-center has no trustworthy 2D surface normal. */
  contactNormal:ContactPoint2|null;
  /** Palm forward projected into image-aspect space. */
  tangentHint:ContactPoint2|null;
  confidence:number;
}

export interface ContactDepthEvidence {
  relation:ContactDepthRelation;
  confidence:number;
  /**
   * Cue convention: +1 supports surface compatibility, -1 contradicts it, null unavailable.
   * `posePrior` is candidate-relative: it must already account for anterior/posterior topology.
   */
  sources:{
    occlusion:number|null;
    scaleChange:number|null;
    motionConsistency:number|null;
    posePrior:number|null;
    history:number|null;
  };
  rejectionReason:"none"|"behind-evidence"|"separated-evidence"|"insufficient-cues";
}

export interface ContactEvidenceBreakdown {
  handGeometry:number;
  bodyRegion:number;
  overlap:number;
  motion:number;
  orientation:number;
  depth:number;
  continuity:number;
  finalConfidence:number;
  hardRejections:string[];
}

export interface HumanContactObservation {
  side:"left"|"right";
  region:BodyContactRegion;
  probe:HandContactProbe;
  imagePoint:ContactPoint2;
  /** Contact point in the selected semantic patch, normalized to [-1, 1]. */
  regionUv:ContactPoint2;
  /** Signed normalized separation from the selected 2D semantic patch. */
  regionSignedDistance:number;
  /** Edge-normal in image space when one exists; palmCenter is intentionally null. */
  imageNormal:ContactPoint2|null;
  tangentAngleRadians:number|null;
  overlap:number;
  /** Negative means approaching the selected surface, positive means separating. */
  normalVelocity:number|null;
  /** Magnitude of motion along the selected surface parameterization. */
  tangentVelocity:number|null;
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
  /**
   * Yaw must use the same image-coordinate convention as the supplied landmarks.
   * If landmarks are mirrored before entering this module, yaw must be mirrored too.
   */
  headYawRadians?:number|null;
  /** Posterior evidence for the head only. Never reuse this to down-rank torso surfaces. */
  posteriorHeadContactHint?:number|null;
  /** Posterior evidence for the neck only. Kept separate from head depth because torso/head Z differ. */
  posteriorNeckContactHint?:number|null;
  /** @deprecated Compatibility fallback. New callers should provide the head/neck-specific hints above. */
  posteriorContactHint?:number|null;
  /** True only when landmark x has already been mirrored before entering this module. CSS video mirroring does not count. */
  imageMirrored?:boolean;
}
