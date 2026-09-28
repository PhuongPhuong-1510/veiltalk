import type { ContactPoint2, HumanBodyRegionCandidate, HumanBodyRegionInput, BodyContactRegion } from "./bodyContactTypes";

const finite=(value:number)=>Number.isFinite(value);
const clamp01=(value:number)=>Math.max(0,Math.min(1,value));
const quantile=(values:number[],ratio:number)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.max(0,Math.min(sorted.length-1,Math.round((sorted.length-1)*ratio)))]!;};
const ellipseSignedDistance=(point:ContactPoint2,center:ContactPoint2,radius:ContactPoint2)=>Math.hypot((point.x-center.x)/Math.max(1e-6,radius.x),(point.y-center.y)/Math.max(1e-6,radius.y))-1;

interface RegionPrimitive {region:BodyContactRegion;center:ContactPoint2;radius:ContactPoint2;confidence:number}

function facePrimitives(input:HumanBodyRegionInput):RegionPrimitive[]{
  const face=(input.faceLandmarks??[]).filter(point=>finite(point.x)&&finite(point.y));
  if(face.length<8||!(input.videoWidth>0&&input.videoHeight>0))return[];
  const aspect=input.videoHeight/input.videoWidth,xs=face.map(point=>point.x),ys=face.map(point=>point.y*aspect);
  const minX=quantile(xs,.02),maxX=quantile(xs,.98),minY=quantile(ys,.02),maxY=quantile(ys,.98);
  const width=maxX-minX,height=maxY-minY;if(width<=1e-5||height<=1e-5)return[];
  const cx=(minX+maxX)/2,cy=(minY+maxY)/2;
  const yaw=Math.max(-Math.PI/2,Math.min(Math.PI/2,input.headYawRadians??0));
  const yawRatio=Math.abs(yaw)/(Math.PI/2),nearIsImageRight=yaw>0;
  const cheekConfidence=(imageRight:boolean)=>clamp01(imageRight===nearIsImageRight?1:1-.75*yawRatio);
  const imageLeftCheek:BodyContactRegion=input.imageMirrored?"leftCheek":"rightCheek";
  const imageRightCheek:BodyContactRegion=input.imageMirrored?"rightCheek":"leftCheek";
  const imageLeftEar:BodyContactRegion=input.imageMirrored?"leftEar":"rightEar";
  const imageRightEar:BodyContactRegion=input.imageMirrored?"rightEar":"leftEar";
  const posterior=clamp01(input.posteriorHeadContactHint??input.posteriorContactHint??0),frontGain=1-.68*posterior;
  const regions:RegionPrimitive[]=[
    {region:"headTop",center:{x:cx,y:minY-.17*height},radius:{x:.38*width,y:.25*height},confidence:.72*(1-.2*yawRatio)},
    {region:"forehead",center:{x:cx,y:minY+.23*height},radius:{x:.34*width,y:.22*height},confidence:.9*(1-.25*yawRatio)*frontGain},
    {region:imageLeftCheek,center:{x:cx-.24*width,y:cy+.08*height},radius:{x:.28*width,y:.3*height},confidence:.9*cheekConfidence(false)*frontGain},
    {region:imageRightCheek,center:{x:cx+.24*width,y:cy+.08*height},radius:{x:.28*width,y:.3*height},confidence:.9*cheekConfidence(true)*frontGain},
    {region:"mouth",center:{x:cx,y:minY+.69*height},radius:{x:.24*width,y:.13*height},confidence:.86*(1-.25*yawRatio)*frontGain},
    {region:"chin",center:{x:cx,y:maxY-.08*height},radius:{x:.27*width,y:.18*height},confidence:.82*(1-.2*yawRatio)*frontGain},
    {region:imageLeftEar,center:{x:minX-.03*width,y:cy+.01*height},radius:{x:.14*width,y:.28*height},confidence:.72*cheekConfidence(false)},
    {region:imageRightEar,center:{x:maxX+.03*width,y:cy+.01*height},radius:{x:.14*width,y:.28*height},confidence:.72*cheekConfidence(true)},
  ];
  if(posterior>=.2)regions.push({region:"backHead",center:{x:cx,y:minY+.35*height},radius:{x:.62*width,y:.55*height},confidence:.28+.52*posterior});
  return regions;
}

function posePrimitives(input:HumanBodyRegionInput):RegionPrimitive[]{
  const pose=input.poseLandmarks;if(!pose||!(input.videoWidth>0&&input.videoHeight>0))return[];
  const left=pose[11],right=pose[12];if(!left||!right||![left.x,left.y,right.x,right.y].every(finite))return[];
  const aspect=input.videoHeight/input.videoWidth,shoulderWidth=Math.abs(right.x-left.x);if(shoulderWidth<1e-5)return[];
  const center={x:(left.x+right.x)/2,y:(left.y+right.y)*.5*aspect};
  const posteriorNeck=clamp01(input.posteriorNeckContactHint??0),neckFrontGain=1-.6*posteriorNeck;
  // IMPORTANT: head-posterior evidence must never down-rank chest/abdomen. Those surfaces live at a
  // different body depth than the nose, so sharing one posterior scalar causes chest contacts to
  // disappear whenever the wrist is naturally behind the face in Z.
  const regions:RegionPrimitive[]=[
    {region:"leftShoulder",center:{x:left.x,y:left.y*aspect},radius:{x:.16*shoulderWidth,y:.16*shoulderWidth},confidence:.8},
    {region:"rightShoulder",center:{x:right.x,y:right.y*aspect},radius:{x:.16*shoulderWidth,y:.16*shoulderWidth},confidence:.8},
    {region:"neck",center:{x:center.x,y:center.y-.12*shoulderWidth},radius:{x:.16*shoulderWidth,y:.2*shoulderWidth},confidence:.68*neckFrontGain},
    {region:"upperChest",center:{x:center.x,y:center.y+.28*shoulderWidth},radius:{x:.38*shoulderWidth,y:.32*shoulderWidth},confidence:.65},
    {region:"lowerChest",center:{x:center.x,y:center.y+.68*shoulderWidth},radius:{x:.42*shoulderWidth,y:.34*shoulderWidth},confidence:.58},
    {region:"abdomen",center:{x:center.x,y:center.y+1.08*shoulderWidth},radius:{x:.38*shoulderWidth,y:.38*shoulderWidth},confidence:.5},
  ];
  if(posteriorNeck>=.25)regions.push({region:"backNeck",center:{x:center.x,y:center.y-.2*shoulderWidth},radius:{x:.25*shoulderWidth,y:.24*shoulderWidth},confidence:.25+.5*posteriorNeck});
  return regions;
}

/** Returns every candidate so temporal ownership can apply continuity instead of a one-frame winner. */
export function evaluateHumanBodyRegions(input:HumanBodyRegionInput,point:ContactPoint2):HumanBodyRegionCandidate[]{
  return [...facePrimitives(input),...posePrimitives(input)].map(region=>({...region,signedDistance:ellipseSignedDistance(point,region.center,region.radius)}));
}

export function selectHumanBodyRegion(candidates:HumanBodyRegionCandidate[],previous:BodyContactRegion|null=null,switchPenalty=.18,maxSignedDistance=.8):HumanBodyRegionCandidate|null{
  let best:HumanBodyRegionCandidate|null=null,bestCost=Infinity;
  for(const candidate of candidates){
    if(!Number.isFinite(candidate.signedDistance)||candidate.signedDistance>maxSignedDistance)continue;
    const cost=candidate.signedDistance+(previous&&candidate.region!==previous?switchPenalty:0)+(1-candidate.confidence)*.25;
    if(cost<bestCost){best=candidate;bestCost=cost;}
  }
  return best;
}
