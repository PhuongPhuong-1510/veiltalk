import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { ContactPoint2, HandContactProbeObservation } from "./bodyContactTypes";

const finite=(p:RawNormalizedLandmarkV1|undefined):p is RawNormalizedLandmarkV1=>Boolean(p&&Number.isFinite(p.x)&&Number.isFinite(p.y));
const midpoint=(a:ContactPoint2,b:ContactPoint2):ContactPoint2=>({x:(a.x+b.x)*.5,y:(a.y+b.y)*.5});
const normalize=(p:ContactPoint2):ContactPoint2|null=>{const length=Math.hypot(p.x,p.y);return length>1e-8?{x:p.x/length,y:p.y/length}:null;};
const clamp01=(v:number)=>Math.max(0,Math.min(1,v));

/** Rigid probes only. Fingertips are intentionally excluded until finger/contact ownership is coupled. */
export function observeRigidHandContactProbes(landmarks:RawNormalizedLandmarkV1[]|null|undefined,videoWidth:number,videoHeight:number):HandContactProbeObservation[]{
  if(!landmarks||!(videoWidth>0&&videoHeight>0))return[];
  const ids=[0,5,9,17];if(!ids.every(index=>finite(landmarks[index])))return[];
  const aspect=videoHeight/videoWidth;
  const p=(index:number):ContactPoint2=>({x:landmarks[index]!.x,y:landmarks[index]!.y*aspect});
  const wrist=p(0),index=p(5),middle=p(9),little=p(17);
  const acrossRaw={x:index.x-little.x,y:index.y-little.y},forwardRaw={x:middle.x-wrist.x,y:middle.y-wrist.y};
  const across=normalize(acrossRaw),forward0=normalize(forwardRaw);if(!across||!forward0)return[];
  const dot=forward0.x*across.x+forward0.y*across.y;
  const forward=normalize({x:forward0.x-dot*across.x,y:forward0.y-dot*across.y});if(!forward)return[];
  const palmCenter={x:(wrist.x+index.x+middle.x+little.x)/4,y:(wrist.y+index.y+middle.y+little.y)/4};
  const palmWidth=Math.hypot(acrossRaw.x,acrossRaw.y),palmLength=Math.hypot(forwardRaw.x,forwardRaw.y);
  const orthogonality=Math.abs(forward0.x*across.y-forward0.y*across.x);
  const scaleQuality=Math.min(palmWidth/.035,palmLength/.035);
  const quality=clamp01(Math.min(scaleQuality,orthogonality/.35));
  return [
    // Palm surface-normal cannot be recovered from a 2D projection. Keep it null instead of inventing one.
    {probe:"palmCenter",point:palmCenter,contactNormal:null,tangentHint:forward,confidence:quality},
    {probe:"radialEdge",point:midpoint(wrist,index),contactNormal:across,tangentHint:forward,confidence:quality*.92},
    {probe:"ulnarEdge",point:midpoint(wrist,little),contactNormal:{x:-across.x,y:-across.y},tangentHint:forward,confidence:quality*.92},
  ];
}
