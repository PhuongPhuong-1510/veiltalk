import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { Vector3Data } from "./avatarPoseTypes";
import { semanticRotationToLocal, type UpperBodyLayer } from "./upperBodyComposer";
import type { UpperBodyRigProfileV1 } from "./upperBodyRigProfile";
import type { TorsoBasis } from "./torsoBasis";

const radians = (degrees: number) => degrees * Math.PI / 180;
const clamp = (value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const smoothstep=(edge0:number,edge1:number,value:number)=>{const t=clamp((value-edge0)/(edge1-edge0),0,1);return t*t*(3-2*t);};
const dot=(a:Vector3Data,b:Vector3Data)=>a.x*b.x+a.y*b.y+a.z*b.z;
const point=(value:RawNormalizedLandmarkV1):Vector3Data=>({x:value.x,y:-value.y,z:-value.z});
const sub=(a:Vector3Data,b:Vector3Data):Vector3Data=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const length=(v:Vector3Data)=>Math.hypot(v.x,v.y,v.z);
const normalize=(v:Vector3Data):Vector3Data|null=>{const l=length(v);return l>1e-6?{x:v.x/l,y:v.y/l,z:v.z/l}:null;};

export type ShoulderVerticalSource = "ear-gap" | "nose-gap" | "differential" | "reach-assist" | "unavailable";
interface ShoulderNeutral { spanForward:number;width:number;verticalSpanUp:number;headGap:{left:number|null;right:number|null};headGapConfidence:{left:number;right:number};noseGap:number|null;noseConfidence:number;up:Vector3Data;forward:Vector3Data }
export interface ShoulderMotionResult {
  layer:UpperBodyLayer;
  elevation:{left:number;right:number};
  protraction:{left:number;right:number};
  vertical:{left:number;right:number};
  verticalSource:{left:ShoulderVerticalSource;right:ShoulderVerticalSource};
  earGapConfidence:{left:number;right:number};
  commonMotionGain:number;
  directBilateralProtractionObservable:false;
}

export class ShoulderMotionSolver {
  private neutral: ShoulderNeutral | null = null;
  private neutralSamples=0;
  captureNeutral(landmarks:RawNormalizedLandmarkV1[]|null,basis:TorsoBasis|null,verticalLandmarks=landmarks,imageAspectRatio=1):boolean {
    const measurement=this.measureWorld(landmarks,basis),verticalMeasurement=this.measureVertical(verticalLandmarks,imageAspectRatio);
    if(!measurement||!verticalMeasurement)return false;
    const alpha=1/(this.neutralSamples+1);
    const averageGap=(side:"left"|"right")=>verticalMeasurement.headGap[side]===null?this.neutral?.headGap[side]??null:this.neutral?.headGap[side]===null||this.neutral?.headGap[side]===undefined?verticalMeasurement.headGap[side]:this.neutral.headGap[side]!+alpha*(verticalMeasurement.headGap[side]!-this.neutral.headGap[side]!);
    const averageConfidence=(side:"left"|"right")=>this.neutral?this.neutral.headGapConfidence[side]+alpha*(verticalMeasurement.earConfidence[side]-this.neutral.headGapConfidence[side]):verticalMeasurement.earConfidence[side];
    const averageNoseGap=verticalMeasurement.noseGap===null?this.neutral?.noseGap??null:this.neutral?.noseGap===null||this.neutral?.noseGap===undefined?verticalMeasurement.noseGap:this.neutral.noseGap+alpha*(verticalMeasurement.noseGap-this.neutral.noseGap);
    const averageNoseConfidence=this.neutral?this.neutral.noseConfidence+alpha*(verticalMeasurement.noseConfidence-this.neutral.noseConfidence):verticalMeasurement.noseConfidence;
    this.neutral=this.neutral?{...this.neutral,spanForward:this.neutral.spanForward+alpha*(measurement.spanForward-this.neutral.spanForward),width:this.neutral.width+alpha*(measurement.width-this.neutral.width),verticalSpanUp:this.neutral.verticalSpanUp+alpha*(verticalMeasurement.spanUp- this.neutral.verticalSpanUp),headGap:{left:averageGap("left"),right:averageGap("right")},headGapConfidence:{left:averageConfidence("left"),right:averageConfidence("right")},noseGap:averageNoseGap,noseConfidence:averageNoseConfidence}:{spanForward:measurement.spanForward,width:measurement.width,verticalSpanUp:verticalMeasurement.spanUp,headGap:{...verticalMeasurement.headGap},headGapConfidence:{...verticalMeasurement.earConfidence},noseGap:verticalMeasurement.noseGap,noseConfidence:verticalMeasurement.noseConfidence,up:{...basis!.up},forward:{...basis!.forward}};
    this.neutralSamples+=1;
    return true;
  }
  solve(landmarks:RawNormalizedLandmarkV1[]|null,basis:TorsoBasis|null,profile:UpperBodyRigProfileV1,headPose:Vector3Data|null=null,verticalLandmarks=landmarks,imageAspectRatio=1,commonMotionGainInput=1):ShoulderMotionResult {
    const projectionBasis=this.neutral&&basis?{...basis,up:this.neutral.up,forward:this.neutral.forward}:basis;
    const layer:UpperBodyLayer={};const measurement=this.measureWorld(landmarks,projectionBasis);const verticalMeasurement=this.measureVertical(verticalLandmarks,imageAspectRatio);
    const elevation={left:0,right:0};const protraction={left:0,right:0};const vertical={left:0,right:0};
    const verticalSource:ShoulderMotionResult["verticalSource"]={left:"unavailable",right:"unavailable"};
    const earGapConfidence={left:0,right:0};
    const commonMotionGain=clamp(commonMotionGainInput,0,1);
    if(measurement&&verticalMeasurement&&this.neutral&&basis){
      const differential=(verticalMeasurement.spanUp-this.neutral.verticalSpanUp)/2;
      const diffProtraction=(measurement.spanForward-this.neutral.spanForward)/(2*this.neutral.width);
      const headGate=headPose?Math.min(1-smoothstep(radians(8),radians(22),Math.abs(headPose.z)),1-smoothstep(radians(15),radians(30),Math.abs(headPose.x))):0;
      const hasNose=this.neutral.noseGap!==null&&verticalMeasurement.noseGap!==null;
      const noseConfidence=hasNose?Math.min(verticalMeasurement.noseConfidence,this.neutral.noseConfidence)*headGate:0;
      const commonNormalized=hasNose?(this.neutral.noseGap!-verticalMeasurement.noseGap!)*commonMotionGain:0;
      const earNormalized={left:0,right:0};
      const earAvailable={left:false,right:false};
      for(const side of ["left","right"] as const){
        earAvailable[side]=this.neutral.headGap[side]!==null&&verticalMeasurement.headGap[side]!==null;
        earNormalized[side]=earAvailable[side]?this.neutral.headGap[side]!-verticalMeasurement.headGap[side]!:0;
      }
      const bothEars=earAvailable.left&&earAvailable.right;
      const earCommon=bothEars?(earNormalized.left+earNormalized.right)/2:0;
      for(const side of ["left","right"] as const){
        const sign=side==="left"?1:-1;
        const hasEar=earAvailable[side];
        const earConfidence=hasEar?Math.min(verticalMeasurement.earConfidence[side],this.neutral.headGapConfidence[side])*headGate:0;earGapConfidence[side]=earConfidence;
        // Khi cả hai tai thấy rõ, tách common/differential để chỉ triệt phần common do lean phối cảnh.
        // Nếu chỉ còn một tai, không thể tách nên giảm toàn bộ observation đó một cách bảo thủ.
        const gatedEarNormalized=bothEars
          ? earNormalized[side]-earCommon+earCommon*commonMotionGain
          : earNormalized[side]*commonMotionGain;
        // Mũi so với tâm hai vai giữ được thành phần nhún chung khi landmark tai bị tóc che.
        const fallbackNormalized=commonNormalized*noseConfidence+sign*differential;
        const observedNormalized=gatedEarNormalized*earConfidence+fallbackNormalized*(1-earConfidence);
        const signedMap=observedNormalized>=0?smoothstep(.015,.12,observedNormalized):-smoothstep(.01,.05,-observedNormalized);
        const reachAssist=Math.min(.2,measurement.reachUp[side]*.2);
        vertical[side]=clamp(signedMap+reachAssist,-1,1);
        verticalSource[side]=earConfidence>=.5?"ear-gap":noseConfidence>=.5?"nose-gap":Math.abs(fallbackNormalized)>.002?"differential":reachAssist>0?"reach-assist":"unavailable";
        elevation[side]=clamp(observedNormalized*1.25+measurement.reachUp[side]*radians(5),-radians(5),radians(12));
        protraction[side]=clamp(sign*diffProtraction*1.2+measurement.reachForward[side]*radians(4),-radians(6),radians(10));
        const name=side==="left"?"leftShoulder":"rightShoulder";const joint=profile.joints[name];
        if(joint)layer[name]=semanticRotationToLocal({x:0,y:sign*protraction[side],z:sign*elevation[side]},joint);
      }
    }
    return {layer,elevation,protraction,vertical,verticalSource,earGapConfidence,commonMotionGain,directBilateralProtractionObservable:false};
  }
  reset():void{this.neutral=null;this.neutralSamples=0;}
  private measureWorld(landmarks:RawNormalizedLandmarkV1[]|null,basis:TorsoBasis|null){
    const confidence=(index:number)=>{const value=landmarks?.[index];if(!value)return 0;return value.visibility===null?1:clamp(value.visibility,0,1);};
    const visible=(index:number)=>confidence(index)>=.5;
    if(!landmarks||!basis||![11,12].every(visible))return null;
    const ls=point(landmarks[11]),rs=point(landmarks[12]);
    const span=sub(ls,rs),width=length(span);if(width<=1e-5)return null;
    const spanForward=dot(span,basis.forward);
    const reach=(shoulder:Vector3Data,elbow:Vector3Data,wrist:Vector3Data)=>{const upper=normalize(sub(elbow,shoulder));return {up:upper?smoothstep(.25,.75,dot(upper,basis.up)):0,forward:smoothstep(.15,.65,dot(sub(wrist,shoulder),basis.forward)/width)};};
    const left=visible(13)&&visible(15)?reach(ls,point(landmarks[13]),point(landmarks[15])):{up:0,forward:0},right=visible(14)&&visible(16)?reach(rs,point(landmarks[14]),point(landmarks[16])):{up:0,forward:0};
    return {spanForward,width,reachUp:{left:left.up,right:right.up},reachForward:{left:left.forward,right:right.forward}};
  }
  private measureVertical(landmarks:RawNormalizedLandmarkV1[]|null,imageAspectRatio:number){
    const confidence=(index:number)=>{const value=landmarks?.[index];if(!value)return 0;return value.visibility===null?1:clamp(value.visibility,0,1);};
    const visible=(index:number)=>confidence(index)>=.5;
    if(!landmarks||![11,12].every(visible))return null;
    const aspect=Number.isFinite(imageAspectRatio)&&imageAspectRatio>0?imageAspectRatio:1;
    const imagePoint=(index:number):Vector3Data=>({x:landmarks[index].x*aspect,y:-landmarks[index].y,z:0});
    const ls=imagePoint(11),rs=imagePoint(12),span=sub(ls,rs);
    // Chỉ lấy span ngang làm scale để chính động tác nhún lệch một vai không làm mẫu số phình ra.
    const width=Math.abs(span.x);
    if(width<=1e-5)return null;
    const shoulderCenter={x:(ls.x+rs.x)/2,y:(ls.y+rs.y)/2,z:0};
    const gap=(index:number,anchor:Vector3Data)=>visible(index)?(imagePoint(index).y-anchor.y)/width:null;
    return {spanUp:span.y/width,headGap:{left:gap(7,ls),right:gap(8,rs)},earConfidence:{left:confidence(7),right:confidence(8)},noseGap:gap(0,shoulderCenter),noseConfidence:confidence(0)};
  }
}
