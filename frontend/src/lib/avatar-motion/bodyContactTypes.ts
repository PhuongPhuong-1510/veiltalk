import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";

export type BodyContactRegion =
  | "headTop" | "forehead" | "leftCheek" | "rightCheek" | "mouth" | "chin"
  | "leftEar" | "rightEar" | "backHead" | "neck" | "backNeck"
  | "leftShoulder" | "rightShoulder" | "upperChest" | "lowerChest" | "abdomen";

/** Human-side semantic label. Some labels intentionally do not yet own an avatar correction patch. */
export type HumanAnatomicalLabel = BodyContactRegion | "nose" | "leftTemple" | "rightTemple";
export type HumanAnatomicalSource = "face-landmark" | "pose-landmark" | "derived" | "posterior-inference";
export type BodyContactSurfaceFamily = "head" | "neck" | "shoulder" | "torso";
export type RigidHandContactProbe = "palmCenter" | "ulnarEdge" | "radialEdge";
export type HandContactProbe = RigidHandContactProbe | "indexTip";
export type ContactProbeMap<T> = Record<RigidHandContactProbe,T>&Partial<Record<"indexTip",T>>;
export type ContactDepthRelation = "in-front-separated" | "surface-compatible" | "behind" | "unknown";
export type ContactPhase = "idle" | "approach" | "near" | "touch" | "hold" | "slide" | "release";

export interface ContactPoint2 { x:number; y:number }
export interface ContactPoint3 { x:number; y:number; z:number }

export interface HumanBodyRegionCandidate {
  /** Existing avatar-side patch used only after the physical surface family is selected. */
  region:BodyContactRegion;
  /** Human anatomical interpretation for diagnostics and future finer contact ownership. */
  anatomicalLabel?:HumanAnatomicalLabel;
  anatomicalSource?:HumanAnatomicalSource;
  anatomicalConfidence?:number;
  /** Whether this semantic location is allowed to acquire production correction in the current AR9 scope. */
  correctionEligible?:boolean;
  center:ContactPoint2;
  radius:ContactPoint2;
  /** <= 0 is inside/near the continuous family proxy; positive values are normalized separation. */
  signedDistance:number;
  confidence:number;
  /** Raw avatar-patch coordinate before clamping. */
  rawUv?:ContactPoint2;
  /** Continuous physical surface coordinate used for temporal velocity/continuity. */
  familyUv?:ContactPoint2;
  /** Coarser physical surface family. Semantic labels do not own contact continuity. */
  surfaceFamily?:BodyContactSurfaceFamily;
  /** Approximate visible-surface normal in camera coordinates; directional evidence only. */
  surfaceNormalCamera?:ContactPoint3|null;
  /** Generic topology/uncertainty cost, lower is better. */
  selectionBias?:number;
  /** Confidence of the normalized per-person body model from which this candidate was derived. */
  modelConfidence?:number;
  faceLocation?:import("./humanFaceContactSurface").FaceSurfaceLocation;
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
  /** Cue convention: +1 supports surface compatibility, -1 contradicts it, null unavailable. */
  sources:{occlusion:number|null;scaleChange:number|null;motionConsistency:number|null;posePrior:number|null;history:number|null;probeDepth?:number|null;};
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
  /** Independent onset/release evidence. History is deliberately excluded. */
  closing?:number;
  stopping?:number;
  separating?:number;
  tracking?:number;
}

export interface HumanContactObservation {
  side:"left"|"right";
  region:BodyContactRegion;
  anatomicalLabel?:HumanAnatomicalLabel;
  anatomicalSource?:HumanAnatomicalSource;
  anatomicalConfidence?:number;
  correctionEligible?:boolean;
  modelConfidence?:number;
  probe:HandContactProbe;
  imagePoint:ContactPoint2;
  /** Avatar patch coordinate, normalized/clamped to [-1,1]. */
  regionUv:ContactPoint2;
  /** Unclamped avatar-patch coordinate. */
  regionRawUv?:ContactPoint2;
  /** Continuous physical-family coordinate. */
  familyUv?:ContactPoint2;
  surfaceFamily?:BodyContactSurfaceFamily;
  regionSelectionBias?:number;
  /** Signed normalized separation from the selected continuous 2D family proxy. */
  regionSignedDistance:number;
  imageNormal:ContactPoint2|null;
  tangentAngleRadians:number|null;
  overlap:number;
  /** Negative means approaching the selected surface family, positive means separating. */
  normalVelocity:number|null;
  /** Motion magnitude in continuous family parameterization, not semantic patch UV. */
  tangentVelocity:number|null;
  /** Physical palm/edge orientation compatibility, null when the 3D hand basis is unavailable. */
  orientationCompatibility?:number|null;
  /** Candidate-only score. It locates a projected body region and never asserts contact. */
  candidateQuality?:number;
  selectionMargin?:number|null;
  ambiguous?:boolean;
  faceLocation?:import("./humanFaceContactSurface").FaceSurfaceLocation;
  depth:ContactDepthEvidence;
  confidence:number;
  evidence:ContactEvidenceBreakdown;
  sampledAtMs:number;
}

export interface HumanBodyRegionInput {
  /** Research mode: torso is bounded by the shoulder plane, rather than a large capsule cap. */
  strictFamilyBounds?:boolean;
  faceLandmarks:RawNormalizedLandmarkV1[]|null|undefined;
  poseLandmarks?:RawNormalizedLandmarkV1[]|null;
  videoWidth:number;
  videoHeight:number;
  headYawRadians?:number|null;
  posteriorHeadContactHint?:number|null;
  posteriorNeckContactHint?:number|null;
  /** @deprecated Compatibility fallback. */
  posteriorContactHint?:number|null;
  /** True only when landmark X itself was mirrored before this module. CSS video mirroring does not count. */
  imageMirrored?:boolean;
  faceSurface?:import("./humanFaceContactSurface").HumanFaceContactSurface|null;
}
