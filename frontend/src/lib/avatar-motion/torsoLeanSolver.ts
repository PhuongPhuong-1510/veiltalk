import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { Vector3Data } from "./avatarPoseTypes";
import { subtract } from "./coordinateAdapter";
import type { TorsoBasis } from "./torsoBasis";

const radians=(degrees:number)=>degrees*Math.PI/180;
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const clamp01=(value:number)=>clamp(Number.isFinite(value)?value:0,0,1);
const smoothstep=(a:number,b:number,value:number)=>{const t=clamp01((value-a)/(b-a));return t*t*(3-2*t);};
const dot=(a:Vector3Data,b:Vector3Data)=>a.x*b.x+a.y*b.y+a.z*b.z;
const length=(value:Vector3Data)=>Math.hypot(value.x,value.y,value.z);
const normalize=(value:Vector3Data):Vector3Data|null=>{const size=length(value);return size>1e-6?{x:value.x/size,y:value.y/size,z:value.z/size}:null;};
const averagePoint=(a:RawNormalizedLandmarkV1,b:RawNormalizedLandmarkV1):RawNormalizedLandmarkV1=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2,z:(a.z+b.z)/2,visibility:Math.min(a.visibility??1,b.visibility??1)});
const visibility=(point:RawNormalizedLandmarkV1|undefined)=>point?clamp01(point.visibility??1):0;
const wrapPi=(value:number)=>Math.atan2(Math.sin(value),Math.cos(value));
const capAngle=(value:number,forward:number,backward:number)=>clamp(value,-backward,forward);

export type TorsoLeanSource="full-torso"|"shoulder-proxy"|"ambiguous-camera-approach"|"unavailable";

export interface TorsoLeanResult {
  angle:number|null;
  source:TorsoLeanSource;
  confidence:number;
  cues:{shoulderScale:number|null;faceScale:number|null;scaleMismatch:number|null;depth:number|null};
  penalties:{head:number;yaw:number;roll:number;shrug:number};
  limited:boolean;
}

interface NeutralState {
  samples:number;
  up:Vector3Data;
  forward:Vector3Data;
  torso:Vector3Data;
  torsoLength:number;
  shoulderWidth:number;
  shoulderDepth:number;
  faceScale:number|null;
  faceSamples:number;
}

interface ImageMeasurement { width:number;depth:number;shoulderQuality:number;depthConsistency:number;inFrame:number;faceScale:number|null;faceQuality:number }

export interface TorsoLeanInput {
  mode:"shoulder-only"|"full-torso";
  worldLandmarks:RawNormalizedLandmarkV1[]|null;
  imageLandmarks:RawNormalizedLandmarkV1[]|null;
  faceLandmarks:RawNormalizedLandmarkV1[]|null;
  fullTorsoBasis:TorsoBasis|null;
  imageAspectRatio:number;
  sampledAtMs:number|null;
  headPitch:number;
  torsoYaw:number;
  torsoRoll:number;
  commonShoulderVertical:number;
}

function canonicalForward(value:Vector3Data):Vector3Data {
  const normalized=normalize(value)??{x:0,y:0,z:1};
  return normalized.z<0?{x:-normalized.x,y:-normalized.y,z:-normalized.z}:normalized;
}

function torsoVector(landmarks:RawNormalizedLandmarkV1[]|null):Vector3Data|null {
  if(!landmarks||![11,12,23,24].every((index)=>visibility(landmarks[index])>=.5))return null;
  return subtract(averagePoint(landmarks[11],landmarks[12]),averagePoint(landmarks[23],landmarks[24]));
}

/** Sign boundary chạy trên vector đã qua coordinateAdapter: semantic +Z luôn là toward-camera. */
export function measureFullTorsoLeanAngle(current:Vector3Data,neutral:Vector3Data,neutralUp:Vector3Data,neutralForward:Vector3Data):number|null {
  const up=normalize(neutralUp),forward=canonicalForward(neutralForward);
  if(!up||length(current)<=1e-6||length(neutral)<=1e-6)return null;
  const currentAngle=Math.atan2(dot(current,forward),dot(current,up));
  const neutralAngle=Math.atan2(dot(neutral,forward),dot(neutral,up));
  const result=wrapPi(currentAngle-neutralAngle);
  return Number.isFinite(result)?result:null;
}

export function combineTorsoLeanConfidence(base:number,hard:number,penalties:{head:number;yaw:number;roll:number;shrug:number}):number {
  // Shrug is solved after lean. Using it as a lean penalty creates a circular dependency and lets
  // perspective-induced bilateral shoulder motion disable the very signal needed to reject it.
  const soft=.40*clamp01(penalties.head)+.35*clamp01(penalties.yaw)+.25*clamp01(penalties.roll);
  return clamp01(base)*clamp01(hard)*(1-clamp01(soft));
}

/** Remove only the bilateral shoulder component that a fore/aft lean creates in image space. */
export function computeLeanShoulderCommonGain(result:TorsoLeanResult):number {
  if(result.source==="unavailable")return 1;
  const proxyEvidence=result.cues.depth===null?null:radians(50)*result.cues.depth;
  const evidence=Math.abs(proxyEvidence??result.angle??0);
  return 1-smoothstep(radians(.5),radians(1.5),evidence);
}

export class TorsoLeanSolver {
  private neutral:NeutralState|null=null;
  private proxyActive=false;
  private lastSampledAtMs:number|null=null;
  private lastResult:TorsoLeanResult={angle:null,source:"unavailable",confidence:0,cues:{shoulderScale:null,faceScale:null,scaleMismatch:null,depth:null},penalties:{head:0,yaw:0,roll:0,shrug:0},limited:false};

  captureNeutral(world:RawNormalizedLandmarkV1[]|null,image:RawNormalizedLandmarkV1[]|null,face:RawNormalizedLandmarkV1[]|null,fullBasis:TorsoBasis|null,aspect:number):boolean {
    const measured=this.measureImage(image,face,aspect);if(!measured)return false;
    const vector=torsoVector(world),alpha=1/((this.neutral?.samples??0)+1);
    const up=fullBasis?.up??this.neutral?.up??{x:0,y:1,z:0},forward=fullBasis?.forward??this.neutral?.forward??{x:0,y:0,z:1};
    const torso=vector??this.neutral?.torso??up,torsoLength=vector?length(vector):this.neutral?.torsoLength??1;
    if(!this.neutral)this.neutral={samples:1,up:{...up},forward:{...forward},torso:{...torso},torsoLength,shoulderWidth:measured.width,shoulderDepth:measured.depth,faceScale:measured.faceScale,faceSamples:measured.faceScale===null?0:1};
    else {
      const n=this.neutral;n.samples+=1;
      for(const key of ["x","y","z"] as const){n.up[key]+=alpha*(up[key]-n.up[key]);n.forward[key]+=alpha*(forward[key]-n.forward[key]);n.torso[key]+=alpha*(torso[key]-n.torso[key]);}
      n.torsoLength+=alpha*(torsoLength-n.torsoLength);n.shoulderWidth+=alpha*(measured.width-n.shoulderWidth);n.shoulderDepth+=alpha*(measured.depth-n.shoulderDepth);
      if(measured.faceScale!==null){n.faceSamples+=1;const faceAlpha=1/n.faceSamples;n.faceScale=n.faceScale===null?measured.faceScale:n.faceScale+faceAlpha*(measured.faceScale-n.faceScale);}
    }
    return true;
  }

  solve(input:TorsoLeanInput):TorsoLeanResult {
    if(input.sampledAtMs!==null&&this.lastSampledAtMs!==null&&input.sampledAtMs<=this.lastSampledAtMs)return this.lastResult;
    if(input.sampledAtMs!==null)this.lastSampledAtMs=input.sampledAtMs;
    const empty=(confidence=0):TorsoLeanResult=>({angle:null,source:"unavailable",confidence,cues:{shoulderScale:null,faceScale:null,scaleMismatch:null,depth:null},penalties:{head:0,yaw:0,roll:0,shrug:0},limited:false});
    const neutral=this.neutral;if(!neutral){this.lastResult=empty();return this.lastResult;}
    if(input.mode==="full-torso"){
      const current=torsoVector(input.worldLandmarks);
      if(current&&input.fullTorsoBasis){
        const quality=Math.min(...[11,12,23,24].map((index)=>visibility(input.worldLandmarks?.[index])));
        const lengthQuality=smoothstep(.35,.70,length(current)/Math.max(1e-6,neutral.torsoLength));
        const angle=measureFullTorsoLeanAngle(current,neutral.torso,neutral.up,neutral.forward);
        if(angle!==null&&quality>=.55&&lengthQuality>0){const capped=capAngle(angle,radians(18),radians(12));this.lastResult={angle:capped,source:"full-torso",confidence:quality*lengthQuality,cues:{shoulderScale:null,faceScale:null,scaleMismatch:null,depth:null},penalties:{head:0,yaw:0,roll:0,shrug:0},limited:capped!==angle};return this.lastResult;}
      }
    }
    const measured=this.measureImage(input.imageLandmarks,input.faceLandmarks,input.imageAspectRatio);
    if(!measured){this.proxyActive=false;this.lastResult=empty();return this.lastResult;}
    const sW=Math.log(measured.width/neutral.shoulderWidth),sDepth=measured.depth-neutral.shoulderDepth;
    const sF=measured.faceScale!==null&&neutral.faceScale!==null?Math.log(measured.faceScale/neutral.faceScale):null;
    const mismatch=sF===null?null:sW-sF;
    const directionAgreement=Math.abs(sDepth)<.005||Math.abs(sW)<.005||Math.sign(sDepth)===Math.sign(sW)?1:.45;
    const scaleConfidence=sF===null?0:measured.faceQuality*directionAgreement;
    const base=.70*(measured.shoulderQuality*measured.depthConsistency)+.30*scaleConfidence;
    const penalties={head:smoothstep(radians(12),radians(25),Math.abs(input.headPitch)),yaw:smoothstep(radians(15),radians(30),Math.abs(input.torsoYaw)),roll:smoothstep(radians(12),radians(25),Math.abs(input.torsoRoll)),shrug:smoothstep(.15,.35,Math.abs(input.commonShoulderVertical))};
    const confidence=combineTorsoLeanConfidence(base,measured.inFrame,penalties);
    if(this.proxyActive){if(confidence<.50)this.proxyActive=false;}else if(confidence>=.60)this.proxyActive=true;
    if(!this.proxyActive){this.lastResult=empty(confidence);return this.lastResult;}
    const raw=radians(50)*sDepth;
    const multiCue=sF!==null&&mismatch!==null&&Math.abs(mismatch)>=.015&&directionAgreement>=.9;
    const forwardCap=multiCue?radians(6):radians(2),backwardCap=multiCue?radians(4):radians(1.5);
    const angle=Math.abs(raw)<radians(1.5)?0:capAngle(raw,forwardCap,backwardCap);
    this.lastResult={angle,source:multiCue?"shoulder-proxy":"ambiguous-camera-approach",confidence,cues:{shoulderScale:sW,faceScale:sF,scaleMismatch:mismatch,depth:sDepth},penalties,limited:angle!==raw};
    return this.lastResult;
  }

  reset():void{this.neutral=null;this.proxyActive=false;this.lastSampledAtMs=null;this.lastResult={angle:null,source:"unavailable",confidence:0,cues:{shoulderScale:null,faceScale:null,scaleMismatch:null,depth:null},penalties:{head:0,yaw:0,roll:0,shrug:0},limited:false};}

  private measureImage(pose:RawNormalizedLandmarkV1[]|null,face:RawNormalizedLandmarkV1[]|null,aspectInput:number):ImageMeasurement|null {
    if(!pose||![11,12].every((index)=>visibility(pose[index])>=.5))return null;
    const aspect=Number.isFinite(aspectInput)&&aspectInput>0?aspectInput:1,left=pose[11],right=pose[12];
    const width=Math.abs((left.x-right.x)*aspect);if(width<=1e-5)return null;
    const depth=(-left.z-right.z)/(2*width),shoulderQuality=Math.min(visibility(left),visibility(right));
    const depthConsistency=1-smoothstep(.08,.25,Math.abs(left.z-right.z)/width);
    const edge=Math.min(left.x,right.x,1-left.x,1-right.x,left.y,right.y,1-left.y,1-right.y);
    const inFrame=smoothstep(.005,.04,edge);
    const indices=[33,133,362,263] as const;
    let faceScale:number|null=null,faceQuality=0;
    if(face&&indices.every((index)=>Boolean(face[index]))){
      const l={x:(face[33].x+face[133].x)/2,y:(face[33].y+face[133].y)/2},r={x:(face[362].x+face[263].x)/2,y:(face[362].y+face[263].y)/2};
      faceScale=Math.hypot((l.x-r.x)*aspect,l.y-r.y);faceQuality=Math.min(...indices.map((index)=>visibility(face[index])));
      if(!(faceScale>1e-5))faceScale=null;
    }
    return {width,depth,shoulderQuality,depthConsistency,inFrame,faceScale,faceQuality};
  }
}
