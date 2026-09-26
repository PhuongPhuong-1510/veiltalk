import type { ContactPoint2, HumanBodyRegionCandidate, HumanBodyRegionInput, BodyContactRegion } from "./bodyContactTypes";

const finite=(value:number)=>Number.isFinite(value);
const quantile=(values:number[],ratio:number)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.max(0,Math.min(sorted.length-1,Math.round((sorted.length-1)*ratio)))]!;};
const ellipseSignedDistance=(point:ContactPoint2,center:ContactPoint2,radius:ContactPoint2)=>Math.hypot((point.x-center.x)/radius.x,(point.y-center.y)/radius.y)-1;
const clamp01=(value:number)=>Math.max(0,Math.min(1,value));

interface RegionPrimitive {region:BodyContactRegion;center:ContactPoint2;radius:ContactPoint2;confidence:number}

function facePrimitives(input:HumanBodyRegionInput):RegionPrimitive[]{
  const face=(input.faceLandmarks??[]).filter(point=>finite(point.x)&&finite(point.y));
  if(face.length<8||!(input.videoWidth>0&&input.videoHeight>0))return[];
  const aspect=input.videoHeight/input.videoWidth,xs=face.map(point=>point.x),ys=face.map(point=>point.y*aspect);
  const minX=quantile(xs,.02),maxX=quantile(xs,.98),minY=quantile(ys,.02),maxY=quantile(ys,.98);
  const width=maxX-minX,height=maxY-minY;if(width<=1e-5||height<=1e-5)return[];
  const cx=(minX+maxX)/2,cy=(minY+maxY)/2,yaw=Math.max(-Math.PI/2,Math.min(Math.PI/2,input.headYawRadians??0));
  const yawRatio=Math.abs(yaw)/(Math.PI/2),nearIsImageRight=yaw>0;
  const cheekConfidence=(imageRight:boolean)=>clamp01(imageRight===nearIsImageRight?1:1-.75*yawRatio);
  const imageLeftCheek:BodyContactRegion=input.imageMirrored?"leftCheek":"rightCheek";
  const imageRightCheek:BodyContactRegion=input.imageMirrored?"rightCheek":"leftCheek";
  return [
    {region:"headTop",center:{x:cx,y:minY-.17*height},radius:{x:.38*width,y:.25*height},confidence:.72*(1-.2*yawRatio)},
    {region:"forehead",center:{x:cx,y:minY+.23*height},radius:{x:.34*width,y:.22*height},confidence:.9*(1-.25*yawRatio)},
    {region:imageLeftCheek,center:{x:cx-.24*width,y:cy+.08*height},radius:{x:.28*width,y:.3*height},confidence:.9*cheekConfidence(false)},
    {region:imageRightCheek,center:{x:cx+.24*width,y:cy+.08*height},radius:{x:.28*width,y:.3*height},confidence:.9*cheekConfidence(true)},
    {region:"chin",center:{x:cx,y:maxY-.08*height},radius:{x:.27*width,y:.18*height},confidence:.82*(1-.2*yawRatio)},
  ];
}

function posePrimitives(input:HumanBodyRegionInput):RegionPrimitive[]{
  const pose=input.poseLandmarks;if(!pose||!(input.videoWidth>0&&input.videoHeight>0))return[];
  const left=pose[11],right=pose[12];if(!left||!right||![left.x,left.y,right.x,right.y].every(finite))return[];
  const aspect=input.videoHeight/input.videoWidth,shoulderWidth=Math.abs(right.x-left.x);if(shoulderWidth<1e-5)return[];
  const center={x:(left.x+right.x)/2,y:(left.y+right.y)*.5*aspect};
  return [
    {region:"leftShoulder",center:{x:left.x,y:left.y*aspect},radius:{x:.16*shoulderWidth,y:.16*shoulderWidth},confidence:.8},
    {region:"rightShoulder",center:{x:right.x,y:right.y*aspect},radius:{x:.16*shoulderWidth,y:.16*shoulderWidth},confidence:.8},
    {region:"neck",center:{x:center.x,y:center.y-.12*shoulderWidth},radius:{x:.16*shoulderWidth,y:.2*shoulderWidth},confidence:.68},
    {region:"upperChest",center:{x:center.x,y:center.y+.28*shoulderWidth},radius:{x:.38*shoulderWidth,y:.32*shoulderWidth},confidence:.65},
  ];
}

/** Returns every region so temporal ownership can apply continuity instead of a one-frame winner. */
export function evaluateHumanBodyRegions(input:HumanBodyRegionInput,point:ContactPoint2):HumanBodyRegionCandidate[]{
  return [...facePrimitives(input),...posePrimitives(input)].map(region=>({...region,signedDistance:ellipseSignedDistance(point,region.center,region.radius)}));
}

export function selectHumanBodyRegion(candidates:HumanBodyRegionCandidate[],previous:BodyContactRegion|null=null,switchPenalty=.18):HumanBodyRegionCandidate|null{
  return candidates.reduce<HumanBodyRegionCandidate|null>((best,candidate)=>{
    const cost=candidate.signedDistance+(previous&&candidate.region!==previous?switchPenalty:0)+(1-candidate.confidence)*.25;
    if(!best)return candidate;
    const bestCost=best.signedDistance+(previous&&best.region!==previous?switchPenalty:0)+(1-best.confidence)*.25;
    return cost<bestCost?candidate:best;
  },null);
}
