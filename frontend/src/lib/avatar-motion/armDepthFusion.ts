import { Vector3 } from "three";
import type { RawHandCandidateV1, RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { Vector3Data } from "./avatarPoseTypes";
import { OneEuroScalarFilter } from "./oneEuroFilter";

export interface ArmDepthDiagnostic {
  calibratedSamples: number; palmRatio: number | null; referenceRatio: number | null;
  palmQuality: number; palmAgeMs: number | null; palmWeight: number;
  poseDepth: number | null; palmDepth: number | null; fusedDepth: number | null;
  foreshorteningMagnitude: number | null; uncertainty: number;
  geometryDepth:number|null;geometryWeight:number;
  applied: boolean; reason: string;
}
export interface ArmDepthInput {
  shoulder: Vector3Data; elbow: Vector3Data; wrist: Vector3Data;
  shoulderImageWidth: number; imageToWorldScale: number;
  hand: RawHandCandidateV1 | null; videoWidth: number; videoHeight: number;
  poseAtMs: number; nowMs: number; matchQuality: number;
  /** Projected shoulder length / 3D length; compensates torso yaw before ratio inference. */
  shoulderProjection?:number;
  /** Aspect-corrected elbow→Hand wrist image distance converted by shoulder scale. */
  projectedLowerLength?:number|null;
  calibratedLowerLength?:number|null;
  preferredLowerDepthSign?:-1|1|null;
}
const v = (p: Vector3Data) => new Vector3(p.x,p.y,p.z);
const clamp = (x:number,a:number,b:number) => Math.max(a,Math.min(b,x));
const median = (xs:number[]) => [...xs].sort((a,b)=>a-b)[Math.floor(xs.length/2)];
const empty = ():ArmDepthDiagnostic => ({calibratedSamples:0,palmRatio:null,referenceRatio:null,palmQuality:0,palmAgeMs:null,palmWeight:0,poseDepth:null,palmDepth:null,fusedDepth:null,foreshorteningMagnitude:null,geometryDepth:null,geometryWeight:0,uncertainty:1,applied:false,reason:"unavailable"});

/** Relative depth cue only. Hand-world coordinates never become absolute body positions. */
export class ArmDepthFusion {
  private reference: {ratio:number;depth:number;length:number;lower:number}[] = [];
  private cue: {ratio:number;quality:number;at:number}|null = null;
  private lastHandAt:number|null=null;
  private lastPoseAt:number|null=null;
  private ratioFilter = new OneEuroScalarFilter({minCutoff:2,beta:.3,derivativeCutoff:1},250);
  private diagnostic = empty();
  reset():void {this.reference=[];this.cue=null;this.lastHandAt=null;this.lastPoseAt=null;this.ratioFilter.reset();this.diagnostic=empty();}
  snapshot():ArmDepthDiagnostic {return {...this.diagnostic};}
  suspend(reason:string):void {this.diagnostic={...empty(),calibratedSamples:this.reference.length,reason};}

  solve(input:ArmDepthInput):Vector3Data|null {
    const d=this.diagnostic=empty();d.calibratedSamples=this.reference.length;
    const s=v(input.shoulder),e=v(input.elbow),w=v(input.wrist),offset=w.clone().sub(s);
    const upper=e.distanceTo(s),lower=w.distanceTo(e),length=upper+lower;
    if(![...s.toArray(),...e.toArray(),...w.toArray(),input.poseAtMs,input.nowMs,input.imageToWorldScale,input.shoulderImageWidth].every(Number.isFinite)
      ||upper<1e-4||lower<1e-4||input.imageToWorldScale<=0||input.shoulderImageWidth<=1e-4){d.reason="invalid-geometry";return null;}
    if(this.lastPoseAt!==null&&(input.poseAtMs<this.lastPoseAt||input.poseAtMs-this.lastPoseAt>1000))this.reset();
    this.diagnostic=d;d.poseDepth=offset.z;d.fusedDepth=offset.z;
    const poseAge=input.nowMs-input.poseAtMs;
    if(poseAge<0||poseAge>150){d.reason="stale-pose";return null;}
    const freshPose=input.poseAtMs!==this.lastPoseAt;this.lastPoseAt=input.poseAtMs;
    d.calibratedSamples=this.reference.length;
    const shoulderProjection=input.shoulderProjection??1;
    if(!Number.isFinite(shoulderProjection)||shoulderProjection<.6||shoulderProjection>1.001){d.reason="shoulders-edge-on";return null;}
    const hand=input.hand;
    if(hand&&hand.sampledAtMs!==this.lastHandAt){
      if(this.lastHandAt!==null&&(hand.sampledAtMs<this.lastHandAt||hand.sampledAtMs-this.lastHandAt>1000)){
        this.reset();this.diagnostic=d;this.lastPoseAt=input.poseAtMs;
      }
      this.lastHandAt=hand.sampledAtMs;
      const cue=measurePalmRatio(hand,input.videoWidth,input.videoHeight,input.shoulderImageWidth/shoulderProjection);
      const age=input.nowMs-hand.sampledAtMs;
      if(cue&&age>=0&&age<=150&&Math.abs(hand.sampledAtMs-input.poseAtMs)<=100&&input.matchQuality>=.6){
        // Poor view never updates a trusted filter or renews an old cue's timestamp.
        const ratio=this.ratioFilter.filter(cue.ratio,hand.sampledAtMs);
        this.cue={ratio,quality:cue.quality*clamp(input.matchQuality,0,1),at:hand.sampledAtMs};
        if(freshPose&&this.reference.length<8&&cue.quality>=.65){
          const priorLength=this.reference.length?median(this.reference.map(r=>r.length)):length;
          const priorRatio=this.reference.length?median(this.reference.map(r=>r.ratio)):ratio;
          const priorDepth=this.reference.length?median(this.reference.map(r=>r.depth)):offset.z;
          // Calibrate on a stable observed pose, not while the hand travels toward camera.
          if(Math.abs(length/priorLength-1)<.12&&Math.abs(ratio/priorRatio-1)<.12&&Math.abs(offset.z-priorDepth)<.12*length)
            this.reference.push({ratio,depth:offset.z,length,lower});
        }
      }
    }
    d.calibratedSamples=this.reference.length;
    if(this.reference.length<8){d.reason="calibrating";return null;}
    const referenceRatio=median(this.reference.map(r=>r.ratio)),referenceDepth=median(this.reference.map(r=>r.depth));
    d.referenceRatio=referenceRatio;
    const cue=this.cue;if(!cue){d.reason="no-palm-cue";return null;}
    const age=input.nowMs-cue.at;d.palmAgeMs=age;d.palmRatio=cue.ratio;d.palmQuality=cue.quality;
    // Following XR's finite decay: full freshness to 200 ms, zero by 1 second.
    const freshness=age<0?0:1-clamp((age-200)/800,0,1);
    if(!freshness){d.reason="expired-palm-cue";return null;}
    const logScale=Math.log(cue.ratio/referenceRatio);
    // Semantic +Z is camera-facing. This is a bounded relative prior, not metric range.
    const palmDepth=referenceDepth+clamp(logScale,-1,1)*length*.45;
    d.palmDepth=palmDepth;
    const planar=Math.hypot(offset.x,offset.y),maxDepth=Math.sqrt(Math.max(0,length*length-planar*planar));
    const calibratedLower=input.calibratedLowerLength;
    const expectedLower=calibratedLower!==undefined&&calibratedLower!==null&&Number.isFinite(calibratedLower)&&calibratedLower>0?calibratedLower:median(this.reference.map(r=>r.lower));
    const planarLower=input.projectedLowerLength;
    const currentLowerZ=w.z-e.z;
    const sign=Math.abs(currentLowerZ)>.05*expectedLower?(currentLowerZ>0?1:-1):input.preferredLowerDepthSign??null;
    if(planarLower!==undefined&&planarLower!==null&&Number.isFinite(planarLower)&&planarLower>=0&&planarLower<expectedLower&&sign!==null){
      d.foreshorteningMagnitude=Math.sqrt(Math.max(0,expectedLower*expectedLower-planarLower*planarLower));
      d.geometryDepth=e.z-s.z+sign*d.foreshorteningMagnitude;
      d.geometryWeight=.2*cue.quality*freshness;
    }
    // Geometry supplies magnitude, not a front/back sign. Conflicting strong signs are unknown.
    const contradiction=Math.abs(offset.z)>.2*length&&Math.abs(palmDepth)>.2*length&&Math.sign(offset.z)!==Math.sign(palmDepth);
    const weight=contradiction?0:.35*cue.quality*freshness;
    d.palmWeight=weight;if(contradiction)d.geometryWeight=0;
    d.uncertainty=1-weight-d.geometryWeight;
    if(weight<=0||maxDepth<=1e-6){d.reason=contradiction?"conflicting-depth-sign":"planar-reach-limit";return null;}
    const delta=clamp((palmDepth-offset.z)*weight+((d.geometryDepth??offset.z)-offset.z)*d.geometryWeight,-.12*length,.12*length);
    const fused=clamp(offset.z+delta,-maxDepth,maxDepth);
    d.fusedDepth=fused;d.applied=Math.abs(fused-offset.z)>1e-6;d.reason=d.applied?"fused":"pose-preserved";
    return d.applied?{x:offset.x,y:offset.y,z:fused}:null;
  }
}

function measurePalmRatio(hand:RawHandCandidateV1,width:number,height:number,shoulderWidth:number):{ratio:number;quality:number}|null {
  if(!(width>0&&height>0)||hand.landmarks.length!==21||hand.worldLandmarks.length!==21)return null;
  const ids=[0,5,9,17],image=hand.landmarks,world=hand.worldLandmarks;
  if(ids.some(i=>![image[i]?.x,image[i]?.y,world[i]?.x,world[i]?.y,world[i]?.z].every(Number.isFinite)))return null;
  if(ids.some(i=>image[i].x<0||image[i].x>1||image[i].y<0||image[i].y>1))return null;
  const a=v(world[5]).sub(v(world[17])),f=v(world[9]).sub(v(world[0])),normal=a.clone().cross(f);
  if(normal.length()<1e-8)return null;
  const facing=Math.abs(normal.normalize().z);
  if(facing<.45)return null;
  const aspect=height/width;
  const distance=(p:RawNormalizedLandmarkV1,q:RawNormalizedLandmarkV1)=>Math.hypot(p.x-q.x,(p.y-q.y)*aspect);
  const worldLength=(a.length()+f.length())/2;
  const worldProjection=(Math.hypot(a.x,a.y)+Math.hypot(f.x,f.y))/2;
  const projection=worldProjection/worldLength;
  if(!Number.isFinite(projection)||projection<.55)return null;
  const apparent=(distance(image[0],image[9])+distance(image[5],image[17]))/2;
  const ratio=apparent/(shoulderWidth*projection);
  if(!Number.isFinite(ratio)||ratio<.025||ratio>1)return null;
  return {ratio,quality:clamp((facing-.45)/.4,0,1)};
}
