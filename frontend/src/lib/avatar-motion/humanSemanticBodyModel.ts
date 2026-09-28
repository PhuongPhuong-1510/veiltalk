import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { BodyContactRegion, ContactPoint2, HumanAnatomicalLabel, HumanBodyRegionInput } from "./bodyContactTypes";

export type SemanticAnchorSource = "face-landmark" | "pose-landmark" | "derived" | "posterior-inference";

export interface HumanSemanticAnchor {
  point: ContactPoint2;
  confidence: number;
  source: SemanticAnchorSource;
}

export interface HumanHeadSurfaceModel {
  center: ContactPoint2;
  radius: ContactPoint2;
  faceWidth: number;
  faceHeight: number;
  confidence: number;
  anchors: {
    headTop: HumanSemanticAnchor;
    forehead: HumanSemanticAnchor;
    nose: HumanSemanticAnchor;
    mouth: HumanSemanticAnchor;
    chin: HumanSemanticAnchor;
    leftCheek: HumanSemanticAnchor;
    rightCheek: HumanSemanticAnchor;
    leftTemple: HumanSemanticAnchor;
    rightTemple: HumanSemanticAnchor;
    leftEar: HumanSemanticAnchor;
    rightEar: HumanSemanticAnchor;
  };
}

export interface HumanNeckSurfaceModel {
  start: ContactPoint2;
  end: ContactPoint2;
  radius: number;
  confidence: number;
}

export interface HumanShoulderSurfaceModel {
  left: HumanSemanticAnchor;
  right: HumanSemanticAnchor;
  radius: number;
  confidence: number;
}

export interface HumanTorsoSurfaceModel {
  shoulderCenter: ContactPoint2;
  hipCenter: ContactPoint2 | null;
  halfWidth: number;
  length: number;
  confidence: number;
}

export interface HumanSemanticBodyModel {
  head: HumanHeadSurfaceModel | null;
  neck: HumanNeckSurfaceModel | null;
  shoulders: HumanShoulderSurfaceModel | null;
  torso: HumanTorsoSurfaceModel | null;
  confidence: number;
}

export interface HeadSemanticClassification {
  anatomicalLabel: HumanAnatomicalLabel;
  solverRegion: BodyContactRegion;
  correctionEligible: boolean;
  familyUv: ContactPoint2;
  regionUv: ContactPoint2;
  confidence: number;
  source: SemanticAnchorSource;
}

const FACE_INDEX = {
  foreheadTop: 10,
  chin: 152,
  noseTip: 1,
  noseBridge: 168,
  upperLip: 13,
  lowerLip: 14,
  mouthLeft: 61,
  mouthRight: 291,
  eyeA: 33,
  eyeB: 263,
  contourA: 234,
  contourB: 454,
} as const;

const clamp01 = (value:number) => Math.max(0, Math.min(1, value));
const finite = (value:number) => Number.isFinite(value);
const midpoint = (a:ContactPoint2,b:ContactPoint2):ContactPoint2 => ({x:(a.x+b.x)*.5,y:(a.y+b.y)*.5});
const lerpPoint = (a:ContactPoint2,b:ContactPoint2,t:number):ContactPoint2 => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const distance = (a:ContactPoint2,b:ContactPoint2) => Math.hypot(a.x-b.x,a.y-b.y);
const quantile = (values:number[],ratio:number) => {
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.max(0,Math.min(sorted.length-1,Math.round((sorted.length-1)*ratio)))]!;
};

function imagePoint(point:RawNormalizedLandmarkV1|undefined|null, aspect:number):ContactPoint2|null {
  if(!point||!finite(point.x)||!finite(point.y)) return null;
  return {x:point.x,y:point.y*aspect};
}

function anchor(point:ContactPoint2, confidence:number, source:SemanticAnchorSource):HumanSemanticAnchor {
  return {point,confidence:clamp01(confidence),source};
}

/**
 * Raw camera landmarks are normally not mirrored. In that convention the subject's RIGHT side
 * appears on image-left. If the caller has explicitly mirrored landmark X before this module,
 * image-left is the subject's LEFT side instead. CSS mirroring does not set imageMirrored=true.
 */
function semanticSides<T>(imageLeft:T,imageRight:T,imageMirrored:boolean):{left:T;right:T} {
  return imageMirrored ? {left:imageLeft,right:imageRight} : {left:imageRight,right:imageLeft};
}

function orderedByX(a:ContactPoint2|null,b:ContactPoint2|null,fallbackLeft:ContactPoint2,fallbackRight:ContactPoint2):{imageLeft:ContactPoint2;imageRight:ContactPoint2;confidence:number} {
  if(a&&b){
    return a.x<=b.x?{imageLeft:a,imageRight:b,confidence:1}:{imageLeft:b,imageRight:a,confidence:1};
  }
  return {imageLeft:fallbackLeft,imageRight:fallbackRight,confidence:.58};
}

function buildHead(input:HumanBodyRegionInput, aspect:number):HumanHeadSurfaceModel|null {
  const face=(input.faceLandmarks??[]).filter(p=>finite(p.x)&&finite(p.y));
  if(face.length<8) return null;
  const xs=face.map(p=>p.x),ys=face.map(p=>p.y*aspect);
  const minX=quantile(xs,.02),maxX=quantile(xs,.98),minY=quantile(ys,.02),maxY=quantile(ys,.98);
  const faceWidth=maxX-minX,faceHeight=maxY-minY;
  if(!(faceWidth>1e-5&&faceHeight>1e-5)) return null;

  const fallbackLeft={x:minX,y:(minY+maxY)*.5},fallbackRight={x:maxX,y:(minY+maxY)*.5};
  const top=imagePoint(input.faceLandmarks?.[FACE_INDEX.foreheadTop],aspect)??{x:(minX+maxX)*.5,y:minY};
  const chin=imagePoint(input.faceLandmarks?.[FACE_INDEX.chin],aspect)??{x:(minX+maxX)*.5,y:maxY};
  const nose=imagePoint(input.faceLandmarks?.[FACE_INDEX.noseTip],aspect)??{x:(minX+maxX)*.5,y:minY+.51*faceHeight};
  const bridge=imagePoint(input.faceLandmarks?.[FACE_INDEX.noseBridge],aspect)??{x:nose.x,y:minY+.35*faceHeight};
  const upperLip=imagePoint(input.faceLandmarks?.[FACE_INDEX.upperLip],aspect);
  const lowerLip=imagePoint(input.faceLandmarks?.[FACE_INDEX.lowerLip],aspect);
  const mouth=upperLip&&lowerLip?midpoint(upperLip,lowerLip):{x:nose.x,y:minY+.70*faceHeight};

  const contourPair=orderedByX(
    imagePoint(input.faceLandmarks?.[FACE_INDEX.contourA],aspect),
    imagePoint(input.faceLandmarks?.[FACE_INDEX.contourB],aspect),fallbackLeft,fallbackRight,
  );
  const eyePair=orderedByX(
    imagePoint(input.faceLandmarks?.[FACE_INDEX.eyeA],aspect),
    imagePoint(input.faceLandmarks?.[FACE_INDEX.eyeB],aspect),
    {x:minX+.28*faceWidth,y:minY+.38*faceHeight},{x:maxX-.28*faceWidth,y:minY+.38*faceHeight},
  );
  const cheekY=(eyePair.imageLeft.y+eyePair.imageRight.y)*.225+mouth.y*.55;
  const imageLeftCheek={x:nose.x+(contourPair.imageLeft.x-nose.x)*.57,y:cheekY};
  const imageRightCheek={x:nose.x+(contourPair.imageRight.x-nose.x)*.57,y:cheekY};
  const imageLeftTemple={x:eyePair.imageLeft.x+(contourPair.imageLeft.x-eyePair.imageLeft.x)*.62,y:eyePair.imageLeft.y-.03*faceHeight};
  const imageRightTemple={x:eyePair.imageRight.x+(contourPair.imageRight.x-eyePair.imageRight.x)*.62,y:eyePair.imageRight.y-.03*faceHeight};
  const cheekSemantic=semanticSides(imageLeftCheek,imageRightCheek,Boolean(input.imageMirrored));
  const templeSemantic=semanticSides(imageLeftTemple,imageRightTemple,Boolean(input.imageMirrored));

  const pose=input.poseLandmarks??[];
  const earA=imagePoint(pose[7],aspect),earB=imagePoint(pose[8],aspect);
  const earFallbackLeft={x:contourPair.imageLeft.x-.08*faceWidth,y:(eyePair.imageLeft.y+mouth.y)*.5};
  const earFallbackRight={x:contourPair.imageRight.x+.08*faceWidth,y:(eyePair.imageRight.y+mouth.y)*.5};
  const earPair=orderedByX(earA,earB,earFallbackLeft,earFallbackRight);
  const earSemantic=semanticSides(earPair.imageLeft,earPair.imageRight,Boolean(input.imageMirrored));

  // FaceMesh top point follows the forehead/hairline, not the skull cap. Extend by a fraction of
  // this person's observed face height so headTop scales with the current face instead of pixels.
  const skullTopY=Math.min(top.y,minY)-.27*faceHeight;
  const headBottomY=Math.max(chin.y,maxY-.02*faceHeight);
  const center={x:(contourPair.imageLeft.x+contourPair.imageRight.x)*.5,y:(skullTopY+headBottomY)*.5};
  const radius={x:Math.max(faceWidth*.54,(contourPair.imageRight.x-contourPair.imageLeft.x)*.56),y:Math.max(faceHeight*.65,(headBottomY-skullTopY)*.5)};
  const headTop={x:center.x,y:skullTopY+.07*radius.y};
  const forehead=lerpPoint(top,bridge,.52);
  const canonicalCount=[
    input.faceLandmarks?.[FACE_INDEX.foreheadTop],input.faceLandmarks?.[FACE_INDEX.chin],input.faceLandmarks?.[FACE_INDEX.noseTip],
    input.faceLandmarks?.[FACE_INDEX.noseBridge],input.faceLandmarks?.[FACE_INDEX.upperLip],input.faceLandmarks?.[FACE_INDEX.lowerLip],
    input.faceLandmarks?.[FACE_INDEX.contourA],input.faceLandmarks?.[FACE_INDEX.contourB],input.faceLandmarks?.[FACE_INDEX.eyeA],input.faceLandmarks?.[FACE_INDEX.eyeB],
  ].filter(p=>p&&finite(p.x)&&finite(p.y)).length;
  const confidence=clamp01(.58+.042*canonicalCount);
  const sideConfidence=Math.min(contourPair.confidence,eyePair.confidence);
  const earSource:SemanticAnchorSource=earA&&earB?"pose-landmark":"derived";

  return {
    center,radius,faceWidth,faceHeight,confidence,
    anchors:{
      headTop:anchor(headTop,confidence*.78,"derived"),
      forehead:anchor(forehead,confidence*.92,input.faceLandmarks?.[FACE_INDEX.foreheadTop]?"face-landmark":"derived"),
      nose:anchor(nose,confidence*.98,input.faceLandmarks?.[FACE_INDEX.noseTip]?"face-landmark":"derived"),
      mouth:anchor(mouth,confidence*.96,upperLip&&lowerLip?"face-landmark":"derived"),
      chin:anchor(chin,confidence*.94,input.faceLandmarks?.[FACE_INDEX.chin]?"face-landmark":"derived"),
      leftCheek:anchor(cheekSemantic.left,confidence*.88*sideConfidence,"derived"),
      rightCheek:anchor(cheekSemantic.right,confidence*.88*sideConfidence,"derived"),
      leftTemple:anchor(templeSemantic.left,confidence*.80*sideConfidence,"derived"),
      rightTemple:anchor(templeSemantic.right,confidence*.80*sideConfidence,"derived"),
      leftEar:anchor(earSemantic.left,confidence*.72*earPair.confidence,earSource),
      rightEar:anchor(earSemantic.right,confidence*.72*earPair.confidence,earSource),
    },
  };
}

function buildPoseSurfaces(input:HumanBodyRegionInput,aspect:number,head:HumanHeadSurfaceModel|null):Pick<HumanSemanticBodyModel,"neck"|"shoulders"|"torso"> {
  const pose=input.poseLandmarks??[];
  const shoulderA=imagePoint(pose[11],aspect),shoulderB=imagePoint(pose[12],aspect);
  if(!shoulderA||!shoulderB) return {neck:null,shoulders:null,torso:null};
  const ordered=shoulderA.x<=shoulderB.x?{imageLeft:shoulderA,imageRight:shoulderB}:{imageLeft:shoulderB,imageRight:shoulderA};
  const semantic=semanticSides(ordered.imageLeft,ordered.imageRight,Boolean(input.imageMirrored));
  const shoulderWidth=distance(shoulderA,shoulderB);
  if(!(shoulderWidth>1e-5)) return {neck:null,shoulders:null,torso:null};
  const shoulderCenter=midpoint(shoulderA,shoulderB);
  const shoulderConfidence=.88;
  const shoulders:HumanShoulderSurfaceModel={
    left:anchor(semantic.left,shoulderConfidence,"pose-landmark"),
    right:anchor(semantic.right,shoulderConfidence,"pose-landmark"),
    radius:shoulderWidth*.16,confidence:shoulderConfidence,
  };

  const chin=head?.anchors.chin.point??{x:shoulderCenter.x,y:shoulderCenter.y-.55*shoulderWidth};
  const neckStart=lerpPoint(chin,shoulderCenter,.24),neckEnd=lerpPoint(chin,shoulderCenter,.76);
  const neckLength=distance(neckStart,neckEnd);
  const neck:HumanNeckSurfaceModel|null=neckLength>1e-5?{
    start:neckStart,end:neckEnd,radius:Math.max(shoulderWidth*.105,(head?.faceWidth??shoulderWidth*.45)*.19),confidence:head?.confidence?Math.min(.84,head.confidence*.88):.62,
  }:null;

  const hipA=imagePoint(pose[23],aspect),hipB=imagePoint(pose[24],aspect);
  const hipCenter=hipA&&hipB?midpoint(hipA,hipB):null;
  const fallbackLength=shoulderWidth*1.12;
  const torsoLength=hipCenter?Math.max(shoulderWidth*.65,distance(shoulderCenter,hipCenter)):fallbackLength;
  const torso:HumanTorsoSurfaceModel={shoulderCenter,hipCenter,halfWidth:shoulderWidth*.46,length:torsoLength,confidence:hipCenter?.82:.64};
  return {neck,shoulders,torso};
}

export function buildHumanSemanticBodyModel(input:HumanBodyRegionInput):HumanSemanticBodyModel {
  if(!(input.videoWidth>0&&input.videoHeight>0))return{head:null,neck:null,shoulders:null,torso:null,confidence:0};
  const aspect=input.videoHeight/input.videoWidth;
  const head=buildHead(input,aspect);
  const pose=buildPoseSurfaces(input,aspect,head);
  const available=[head?.confidence,pose.neck?.confidence,pose.shoulders?.confidence,pose.torso?.confidence].filter((v):v is number=>v!==undefined&&v!==null);
  const confidence=available.length?available.reduce((a,b)=>a+b,0)/available.length:0;
  return {head,...pose,confidence:clamp01(confidence)};
}

function normalizedDistance(point:ContactPoint2,anchorPoint:ContactPoint2,rx:number,ry:number):number {
  return Math.hypot((point.x-anchorPoint.x)/Math.max(1e-6,rx),(point.y-anchorPoint.y)/Math.max(1e-6,ry));
}

function solverRegion(label:HumanAnatomicalLabel):{region:BodyContactRegion;eligible:boolean} {
  switch(label){
    case "leftTemple": return {region:"leftCheek",eligible:true};
    case "rightTemple": return {region:"rightCheek",eligible:true};
    // Palm-scale nose contact is deliberately diagnostic-only until AR9 owns a dedicated small
    // face probe/fingertip contact. Mapping it to forehead/mouth would knowingly pull the avatar
    // toward the wrong surface, which is worse than failing closed.
    case "nose": return {region:"forehead",eligible:false};
    default: return {region:label as BodyContactRegion,eligible:true};
  }
}

/**
 * Classify semantic anatomy AFTER a continuous head surface has been selected. The solver never
 * chooses among cheek/ear/forehead ellipses; these labels are metadata + avatar patch selection.
 */
export function classifyHeadAnatomy(
  head:HumanHeadSurfaceModel,
  point:ContactPoint2,
  posteriorHeadHint=0,
  headYawRadians=0,
):HeadSemanticClassification {
  const familyUv={x:(point.x-head.center.x)/Math.max(1e-6,head.radius.x),y:(point.y-head.center.y)/Math.max(1e-6,head.radius.y)};
  const w=head.faceWidth,h=head.faceHeight,a=head.anchors;
  const d={
    nose:normalizedDistance(point,a.nose.point,.17*w,.16*h),
    mouth:normalizedDistance(point,a.mouth.point,.29*w,.14*h),
    chin:normalizedDistance(point,a.chin.point,.31*w,.19*h),
    forehead:normalizedDistance(point,a.forehead.point,.37*w,.23*h),
    leftCheek:normalizedDistance(point,a.leftCheek.point,.30*w,.28*h),
    rightCheek:normalizedDistance(point,a.rightCheek.point,.30*w,.28*h),
    leftTemple:normalizedDistance(point,a.leftTemple.point,.23*w,.25*h),
    rightTemple:normalizedDistance(point,a.rightTemple.point,.23*w,.25*h),
    leftEar:normalizedDistance(point,a.leftEar.point,.19*w,.29*h),
    rightEar:normalizedDistance(point,a.rightEar.point,.19*w,.29*h),
  };

  let label:HumanAnatomicalLabel;
  let confidence:number;
  let source:SemanticAnchorSource="derived";
  const posterior=clamp01(posteriorHeadHint);

  if(posterior>=.50&&familyUv.y>-.78){
    label="backHead";confidence=.42+.52*posterior;source="posterior-inference";
  }else if(familyUv.y<-.70){
    label="headTop";confidence=a.headTop.confidence;source=a.headTop.source;
  }else if(d.nose<1.0){
    label="nose";confidence=a.nose.confidence*clamp01(1.2-d.nose*.55);source=a.nose.source;
  }else if(d.mouth<1.0){
    label="mouth";confidence=a.mouth.confidence*clamp01(1.2-d.mouth*.55);source=a.mouth.source;
  }else if(d.chin<1.02&&familyUv.y>.25){
    label="chin";confidence=a.chin.confidence*clamp01(1.18-d.chin*.5);source=a.chin.source;
  }else{
    // Ear is allowed to win only close to an actual Pose-ear/fallback anchor AND near the lateral
    // shell. This prevents the old "cheek -> ear" failure at an arbitrary patch boundary.
    const earEntries:[HumanAnatomicalLabel,number,HumanSemanticAnchor][]=[
      ["leftEar",d.leftEar,a.leftEar],["rightEar",d.rightEar,a.rightEar],
    ];
    const bestEar=earEntries.sort((x,y)=>x[1]-y[1])[0]!;
    if(bestEar[1]<1.02&&Math.abs(familyUv.x)>.68){
      label=bestEar[0];confidence=bestEar[2].confidence*clamp01(1.22-bestEar[1]*.55);source=bestEar[2].source;
    }else{
      const candidates:[HumanAnatomicalLabel,number,HumanSemanticAnchor][]=[
        ["forehead",d.forehead,a.forehead],
        ["leftTemple",d.leftTemple,a.leftTemple],["rightTemple",d.rightTemple,a.rightTemple],
        ["leftCheek",d.leftCheek,a.leftCheek],["rightCheek",d.rightCheek,a.rightCheek],
      ];
      // Prefer forehead in the upper central band even if a side anchor is a few pixels nearer.
      if(familyUv.y<-.23&&Math.abs(familyUv.x)<.72){
        label="forehead";confidence=a.forehead.confidence*clamp01(1.15-Math.min(1.4,d.forehead)*.42);source=a.forehead.source;
      }else{
        candidates.sort((x,y)=>x[1]-y[1]);
        const best=candidates[0]!;label=best[0];confidence=best[2].confidence*clamp01(1.18-Math.min(1.6,best[1])*.42);source=best[2].source;
      }
    }
  }

  const solved=solverRegion(label);
  const anchorForRegion = label==="leftTemple"?a.leftCheek:label==="rightTemple"?a.rightCheek:
    label==="nose"?a.nose:(a as Record<string,HumanSemanticAnchor>)[label]??a.forehead;
  let rx=.34*w,ry=.30*h;
  if(solved.region==="forehead"){rx=.40*w;ry=.28*h;}
  else if(solved.region==="mouth"){rx=.28*w;ry=.16*h;}
  else if(solved.region==="chin"){rx=.32*w;ry=.22*h;}
  else if(solved.region==="leftEar"||solved.region==="rightEar"){rx=.20*w;ry=.32*h;}
  // Top/back use the continuous head coordinate directly. They do not have a visible 2D anchor
  // whose center should own the avatar patch.
  const regionUv=solved.region==="headTop"||solved.region==="backHead"
    ? {x:familyUv.x,y:solved.region==="headTop"?(familyUv.y+.70)/.42:familyUv.y}
    : {x:(point.x-anchorForRegion.point.x)/Math.max(1e-6,rx),y:(point.y-anchorForRegion.point.y)/Math.max(1e-6,ry)};
  const yawStrength=clamp01(Math.abs(headYawRadians)/(Math.PI*.42));
  const farSide=(headYawRadians>0&&(label.startsWith("left")))||(headYawRadians<0&&(label.startsWith("right")));
  const yawConfidence=farSide?1-.62*yawStrength:1;
  return {anatomicalLabel:label,solverRegion:solved.region,correctionEligible:solved.eligible,familyUv,regionUv,confidence:clamp01(confidence*head.confidence*yawConfidence),source};
}

export function pointSegmentNormalizedDistance(point:ContactPoint2,start:ContactPoint2,end:ContactPoint2,radius:number):{signedDistance:number;uv:ContactPoint2;t:number} {
  const dx=end.x-start.x,dy=end.y-start.y,den=dx*dx+dy*dy;
  const t=den<=1e-12?0:Math.max(0,Math.min(1,((point.x-start.x)*dx+(point.y-start.y)*dy)/den));
  const closest={x:start.x+dx*t,y:start.y+dy*t};
  const length=Math.sqrt(Math.max(1e-12,den));
  const nx=length>1e-8?-dy/length:1,ny=length>1e-8?dx/length:0;
  const lateral=((point.x-closest.x)*nx+(point.y-closest.y)*ny)/Math.max(1e-6,radius);
  // Capsule distance must include axial separation from a clamped endpoint. Using only the lateral
  // projection made every point above/below the neck centerline look "inside" the neck.
  const radialDistance=Math.hypot(point.x-closest.x,point.y-closest.y)/Math.max(1e-6,radius);
  const signedDistance=radialDistance-1;
  return {signedDistance,uv:{x:lateral,y:t*2-1},t};
}
