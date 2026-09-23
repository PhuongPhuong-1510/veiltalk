import { Quaternion, Vector3 } from "three";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { AvatarFingerJointName, AvatarFingerName, QuaternionData } from "./avatarPoseTypes";
import { computeFingerCurl, FINGER_LANDMARK_CHAIN, REGULAR_FINGERS } from "./fingerFeatures";
import type { HandBasisResult } from "./handPalmBasis";
import type { HandFingerRig } from "./fingerRig";
import { OneEuroScalarFilter } from "./oneEuroFilter";
import type { AvatarMotionConfig } from "./motionConfig";

export type ContinuousFingerSource = "observed"|"held"|"predicted"|"safe-return"|"unavailable";
export interface ContinuousFingerJointDiagnostic {
  /** Góc vừa đo trực tiếp từ landmark của sample hiện tại; null khi không có observation. */
  observedAngleRad:number|null;
  /** Target temporal trước clamp: observation mới, hold, prediction hoặc safe return. */
  targetAngleRad:number;
  constrainedAngleRad:number;
  /** Góc flexion cuối sau filter; giữ tên cũ để không phá consumer hiện tại. */
  angleRad:number;
  /** Chỉ có ở root MCP/CMC khi observation hiện tại tồn tại. */
  observedAbductionRad:number|null;
  appliedAbductionRad:number|null;
  imageExtensionOverride:boolean;
  measurementAccepted:boolean;
  measurementConfidence:number;
  rejectionReason:"none"|"unstable-bone-length";
  anatomicalPriorApplied:boolean;
  confidence:number;
  source:ContinuousFingerSource;
  limited:boolean;
}
export interface ContinuousFingerResult { rotations:Partial<Record<AvatarFingerJointName,QuaternionData>>; diagnostics:Partial<Record<AvatarFingerJointName,ContinuousFingerJointDiagnostic>> }

const finite=(p:RawNormalizedLandmarkV1|undefined):p is RawNormalizedLandmarkV1=>Boolean(p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Number.isFinite(p.z));
const vec=(p:RawNormalizedLandmarkV1)=>new Vector3(p.x,p.y,p.z);
const qData=(q:Quaternion):QuaternionData=>({x:q.x,y:q.y,z:q.z,w:q.w});
type FingerObservation={angles:[number,number,number];segmentLengths:[number,number,number];mcpAbduction:number;confidence:number;anatomicalPrior?:[boolean,boolean,boolean];imageExtensionCandidate?:[boolean,boolean,boolean]};

function imageFingerClearlyStraight(landmarks:RawNormalizedLandmarkV1[],finger:AvatarFingerName):boolean{
  const palmA=landmarks[5],palmB=landmarks[17],ids=FINGER_LANDMARK_CHAIN[finger],points=ids.map(index=>landmarks[index]);
  if(!finite(palmA)||!finite(palmB)||!points.every(finite))return false;
  const palmWidth=vec(palmA).sub(vec(palmB)).length();
  if(palmWidth<=1e-6)return false;
  const totalLength=points.slice(1).reduce((sum,point,index)=>sum+vec(point).sub(vec(points[index])).length(),0);
  if(totalLength<=1e-6)return false;
  const chord=vec(points[3]).sub(vec(points[0])).length();
  const minimumReach=finger==="thumb"?.32:finger==="little"?.32:.42;
  return chord/palmWidth>=minimumReach&&chord/totalLength>=(finger==="thumb"?.90:.94);
}

/** Pure human-domain observation. Angles are absolute semantic angles; no avatar vectors enter here. */
export function observeContinuousFingerAngles(landmarks:RawNormalizedLandmarkV1[],basis:HandBasisResult,quality:number){
  const across=new Vector3(basis.across.x,basis.across.y,basis.across.z).normalize();
  const normal=new Vector3(basis.normal.x,basis.normal.y,basis.normal.z).normalize();
  const forward=new Vector3(basis.forward.x,basis.forward.y,basis.forward.z).normalize();
  const out:Partial<Record<AvatarFingerName,FingerObservation>>={};
  for(const finger of [...REGULAR_FINGERS,"thumb"] as AvatarFingerName[]){
    const ids=FINGER_LANDMARK_CHAIN[finger],p=ids.map(i=>landmarks[i]);
    if(!p.every(finite))continue;
    const raw0=vec(p[1]).sub(vec(p[0])),raw1=vec(p[2]).sub(vec(p[1])),raw2=vec(p[3]).sub(vec(p[2]));
    const segmentLengths:[number,number,number]=[raw0.length(),raw1.length(),raw2.length()];
    const v0=raw0.normalize(),v1=raw1.normalize(),v2=raw2.normalize();
    if(![v0,v1,v2].every(v=>v.lengthSq()>.99))continue;
    // Dùng đúng segment-angle đã qua webcam gate của gesture pipeline, nhưng giữ riêng từng
    // MCP/PIP/DIP thay vì gộp thành label/preset. Cách palm-normal signed trước đây làm open
    // hand thành flexion lớn trên Hand world convention thực tế.
    const curl=computeFingerCurl(landmarks,finger);
    if(!curl.valid)continue;
    // MCP flexion là độ lệch RA KHỎI mặt phẳng lòng bàn tay. Không dùng wrist→MCP làm
    // proximal segment: các metacarpal xòe hình quạt tự nhiên và tạo flexion giả khi bàn tay mở.
    const inPlane=Math.hypot(v0.dot(across),v0.dot(forward));
    let mcp=Math.atan2(Math.abs(v0.dot(normal)),Math.max(1e-6,inPlane));
    let pip=curl.pipFlexion*Math.PI/2,dip=curl.dipFlexion*Math.PI/2;
    // MediaPipe rung vài độ ở tư thế duỗi. Zero chính xác giúp một ngón đang giơ thẳng trả
    // đúng rest thay vì giữ móng cong nhẹ qua nhiều filter frame.
    const extensionDeadZone=8*Math.PI/180;
    if(mcp<extensionDeadZone)mcp=0;if(pip<extensionDeadZone)pip=0;if(dip<extensionDeadZone)dip=0;
    const mcpAbduction=Math.atan2(v0.dot(across),Math.max(1e-6,v0.dot(forward)));
    // Thumb opposition is observable more robustly from where its tip ends relative to the palm
    // than from a generic MCP abduction angle. A tip close to middle-MCP means the thumb has
    // crossed the palm; a far tip means it remains extended (open/thumbs-up/side).
    if(finger==="thumb"){
      const indexMcp=landmarks[5],middleMcp=landmarks[9],littleMcp=landmarks[17],thumbTip=landmarks[4];
      if(finite(indexMcp)&&finite(middleMcp)&&finite(littleMcp)&&finite(thumbTip)){
        const palmWidth=vec(indexMcp).sub(vec(littleMcp)).length();
        if(palmWidth>1e-6){const ratio=vec(thumbTip).sub(vec(middleMcp)).length()/palmWidth;const t=Math.max(0,Math.min(1,(1.05-ratio)/.65));const opposition=t*t*(3-2*t)*55*Math.PI/180;mcp=Math.max(mcp,opposition);}
      }
    }
    out[finger]={angles:[mcp,pip,dip],segmentLengths,mcpAbduction,confidence:Math.max(0,Math.min(1,quality))};
  }
  return out;
}

interface JointMemory { angle:number; velocity:number; sampledAtMs:number; lastObservedAtMs:number }
interface AbductionMemory { angle:number; sampledAtMs:number; lastObservedAtMs:number }
interface MeasurementHistory { values:number[]; boneLength:number|null }
const median=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)]??0;};
export class ContinuousFingerSolver {
  private memory=new Map<AvatarFingerJointName,JointMemory>();
  private filters=new Map<AvatarFingerJointName,OneEuroScalarFilter>();
  private abductionMemory=new Map<AvatarFingerJointName,AbductionMemory>();
  private abductionFilters=new Map<AvatarFingerJointName,OneEuroScalarFilter>();
  private measurements=new Map<AvatarFingerJointName,MeasurementHistory>();
  private abductionMeasurements=new Map<AvatarFingerJointName,number[]>();
  private imageExtensionEvidence=new Map<AvatarFingerJointName,{count:number;sampledAtMs:number}>();
  reset(){this.memory.clear();this.filters.clear();this.abductionMemory.clear();this.abductionFilters.clear();this.measurements.clear();this.abductionMeasurements.clear();this.imageExtensionEvidence.clear();}
  solve(landmarks:RawNormalizedLandmarkV1[]|null,basis:HandBasisResult|null,quality:number,sampledAtMs:number|null,nowMs:number,rig:HandFingerRig,config:AvatarMotionConfig["continuousFinger"],imageLandmarks:RawNormalizedLandmarkV1[]|null=null,imageBasis:HandBasisResult|null=null,imageAspectY=1):ContinuousFingerResult{
    const observed=landmarks&&basis&&sampledAtMs!==null?observeContinuousFingerAngles(landmarks,basis,quality):{};
    // Hand World cung cấp chiều sâu nhưng z dễ lệch khác nhau giữa hai tay. Khi lòng bàn tay hướng camera,
    // dùng hình chiếu 2D có đủ chiều dài và ba khớp thẳng làm bằng chứng mạnh để bác flexion 3D giả.
    if(landmarks&&basis&&imageLandmarks&&imageBasis&&sampledAtMs!==null&&Math.abs(basis.normal.z)>=config.imageExtensionFacingThreshold){
      const flattened=imageLandmarks.map(point=>({...point,y:point.y*imageAspectY,z:0}));
      const imageObserved=observeContinuousFingerAngles(flattened,imageBasis,quality);
      for(const finger of [...REGULAR_FINGERS,"thumb"] as AvatarFingerName[]){
        const image=imageObserved[finger],world=observed[finger];
        if(!image||!world||!imageFingerClearlyStraight(flattened,finger))continue;
        // MCP flexion leaves the image plane. Once image z is flattened, its measured MCP angle
        // is mechanically zero and therefore cannot be extension evidence.
        const candidates=image.angles.map((angle,index)=>index>0&&angle===0) as [boolean,boolean,boolean];
        if(candidates.some(Boolean))observed[finger]={...world,imageExtensionCandidate:candidates};
      }
    }
    // Anatomical coupling is only a fallback for occluded measurements. Three curled regular
    // fingers form a consensus; a finger with explicit 2D extension evidence remains untouched
    // so point/peace/rock gestures are not collapsed into a fist preset.
    const regular=REGULAR_FINGERS.map(finger=>observed[finger]).filter((value):value is FingerObservation=>Boolean(value));
    const curled=regular.filter(value=>value.angles[1]>=35*Math.PI/180);
    if(curled.length>=3){
      const consensus:[number,number,number]=[0,1,2].map(index=>median(curled.map(value=>value.angles[index]))) as [number,number,number];
      for(const finger of REGULAR_FINGERS){const value=observed[finger];if(!value)continue;const prior:[boolean,boolean,boolean]=[false,false,false];const angles=[...value.angles] as [number,number,number];
        // A clearly straight 2D chain is intentional gesture evidence (point/peace/rock), not an
        // occluded member of the fist. Protect the WHOLE finger from consensus: protecting only
        // PIP/DIP still allowed MCP to be forced closed, so the straight finger pointed sideways.
        if(value.imageExtensionCandidate?.some(Boolean)){observed[finger]={...value,angles,anatomicalPrior:prior};continue;}
        for(let index=0;index<3;index+=1){if(value.imageExtensionCandidate?.[index])continue;if(angles[index]<.45*consensus[index]){angles[index]=.75*consensus[index];prior[index]=true;}}
        if(!value.imageExtensionCandidate?.[2]&&angles[1]>=35*Math.PI/180&&angles[2]<.45*angles[1]){angles[2]=.65*angles[1];prior[2]=true;}
        observed[finger]={...value,angles,anatomicalPrior:prior};
      }
      const thumb=observed.thumb;if(thumb&&thumb.angles[0]>=30*Math.PI/180){const angles=[...thumb.angles] as [number,number,number],prior:[boolean,boolean,boolean]=[false,false,false];if(!thumb.imageExtensionCandidate?.[1]&&angles[1]<12*Math.PI/180){angles[1]=12*Math.PI/180;prior[1]=true;}if(!thumb.imageExtensionCandidate?.[2]&&angles[2]<8*Math.PI/180){angles[2]=8*Math.PI/180;prior[2]=true;}observed.thumb={...thumb,angles,anatomicalPrior:prior};}
    }
    const rotations:ContinuousFingerResult["rotations"]={},diagnostics:ContinuousFingerResult["diagnostics"]={};
    for(const chain of rig.chains){const obs=observed[chain.finger];chain.segments.forEach((segment,index)=>{
      const limit=chain.finger==="thumb"?config.humanObservationLimits.thumb:index===0?config.humanObservationLimits.mcp:index===1?config.humanObservationLimits.pip:config.humanObservationLimits.dip;
      const observationIndex=Math.min(index,2),extensionCandidate=Boolean(obs?.imageExtensionCandidate?.[observationIndex]);
      let extensionConfirmed=false;
      if(obs&&sampledAtMs!==null){const previousEvidence=this.imageExtensionEvidence.get(segment.joint);if(!previousEvidence||sampledAtMs>previousEvidence.sampledAtMs){const count=extensionCandidate?(previousEvidence?.count??0)+1:0;this.imageExtensionEvidence.set(segment.joint,{count,sampledAtMs});extensionConfirmed=count>=2;}else extensionConfirmed=(previousEvidence?.count??0)>=2;}
      const observedAngle=obs?(extensionConfirmed?0:obs.angles[observationIndex]):null;
      const prior=this.memory.get(segment.joint);let target=0,source:ContinuousFingerSource="unavailable",confidence=0,terminalReturn=false,measurementAccepted=false,measurementConfidence=0,rejectionReason:ContinuousFingerJointDiagnostic["rejectionReason"]="none";
      if(obs&&sampledAtMs!==null&&(!prior||sampledAtMs>prior.sampledAtMs)){
        const rawTarget=observedAngle!;
        let history=this.measurements.get(segment.joint);if(!history){history={values:[],boneLength:null};this.measurements.set(segment.joint,history);}
        const observedLength=obs.segmentLengths[Math.min(index,2)];
        const lengthRatio=history.boneLength&&history.boneLength>1e-8?Math.abs(observedLength-history.boneLength)/history.boneLength:0;
        const tolerance=config.measurementValidation.boneLengthToleranceRatio;
        const lengthConfidence=lengthRatio<=tolerance?1:Math.max(0,1-(lengthRatio-tolerance)/tolerance);
        measurementConfidence=obs.confidence*lengthConfidence;
        if(measurementConfidence>=config.measurementValidation.minimumConfidence||!prior){
          if(extensionConfirmed)history.values=[0];else{history.values.push(rawTarget);while(history.values.length>config.measurementValidation.windowSize)history.values.shift();}
          const robustTarget=median(history.values);
          const deadbandConfig=config.observationDeadband;
          const curlMix=Math.max(0,Math.min(1,Math.abs(robustTarget)/deadbandConfig.fullCurlRadians));
          const deadband=deadbandConfig.extendedRadians+(deadbandConfig.curledRadians-deadbandConfig.extendedRadians)*curlMix;
          target=prior&&Math.abs(robustTarget-prior.angle)<=deadband?prior.angle:robustTarget;
          history.boneLength=history.boneLength===null?observedLength:history.boneLength+.08*(observedLength-history.boneLength);
          measurementAccepted=true;
        }else{target=prior!.angle;rejectionReason="unstable-bone-length";}
        confidence=measurementConfidence;source="observed";
        const dt=prior?Math.max(1,sampledAtMs-prior.sampledAtMs):0,velocity=prior&&dt?Math.max(-config.maxPredictionRadiansPerMs,Math.min(config.maxPredictionRadiansPerMs,(target-prior.angle)/dt)):0;
        this.memory.set(segment.joint,{angle:target,velocity,sampledAtMs,lastObservedAtMs:sampledAtMs});
      }else if(prior){const age=nowMs-prior.lastObservedAtMs;if(age<=config.holdMs){target=prior.angle;source="held";confidence=.6;}else if(age<=config.predictionEndMs){target=prior.angle+prior.velocity*Math.min(100,age-config.holdMs);source="predicted";confidence=.35;}else if(age<=config.safeReturnEndMs){const t=Math.max(0,Math.min(1,(age-config.predictionEndMs)/(config.safeReturnEndMs-config.predictionEndMs)));const s=t*t*(3-2*t);target=prior.angle*(1-s);source="safe-return";confidence=.15;}else{target=0;source="safe-return";terminalReturn=true;this.memory.delete(segment.joint);} }
      const constrained=Math.max(limit.min,Math.min(limit.max,target)),limited=Math.abs(constrained-target)>1e-8;
      let filter=this.filters.get(segment.joint);if(!filter){filter=new OneEuroScalarFilter(config.filter,500);this.filters.set(segment.joint,filter);}
      // Khi camera quan sát rõ một khớp đang duỗi, trả đúng identity ngay. Nếu vẫn đưa số 0 qua
      // One-Euro, lịch sử nắm tay trước đó làm ngón "mở hé" thêm nhiều frame dù người đã duỗi thẳng.
      const observedRest=source==="observed"&&constrained===0;
      if(terminalReturn||observedRest)filter.reset(0,source==="observed"&&sampledAtMs!==null?sampledAtMs:nowMs);
      const safe=terminalReturn||observedRest?0:filter.filter(constrained,source==="observed"&&sampledAtMs!==null?sampledAtMs:nowMs);
      let appliedAbductionRad:number|null=null;
      if(source!=="unavailable"){const axis=new Vector3(segment.flexAxisLocal.x,segment.flexAxisLocal.y,segment.flexAxisLocal.z).normalize();const flexAngle=safe;const flex=new Quaternion().setFromAxisAngle(axis,flexAngle);let rotation=flex;
        // Regular fingers receive a rest-relative semantic spread. Thumb opposition is not the
        // same degree of freedom, so never feed generic MCP abduction into its CMC joint.
        if(chain.finger!=="thumb"&&index===0&&segment.abductionAxisLocal){
          const previousAbduction=this.abductionMemory.get(segment.joint);
          if(obs&&sampledAtMs!==null&&(!previousAbduction||sampledAtMs>previousAbduction.sampledAtMs)){
            const limits=config.humanObservationLimits;const semanticDelta=obs.mcpAbduction-(segment.restAbductionRad??0);const rawAbduction=Math.max(limits.abduction.min,Math.min(limits.abduction.max,semanticDelta))*(segment.abductionDirectionSign??1);
            let recentAbduction=this.abductionMeasurements.get(segment.joint);if(!recentAbduction){recentAbduction=[];this.abductionMeasurements.set(segment.joint,recentAbduction);}recentAbduction.push(rawAbduction);while(recentAbduction.length>config.measurementValidation.windowSize)recentAbduction.shift();const constrainedAbduction=median(recentAbduction);
            const deadband=config.observationDeadband.extendedRadians;
            const stable=previousAbduction&&Math.abs(constrainedAbduction-previousAbduction.angle)<=deadband?previousAbduction.angle:constrainedAbduction;
            let abductionFilter=this.abductionFilters.get(segment.joint);if(!abductionFilter){abductionFilter=new OneEuroScalarFilter(config.filter,500);this.abductionFilters.set(segment.joint,abductionFilter);}
            appliedAbductionRad=abductionFilter.filter(stable,sampledAtMs);
            this.abductionMemory.set(segment.joint,{angle:appliedAbductionRad,sampledAtMs,lastObservedAtMs:sampledAtMs});
          }else if(previousAbduction){
            const age=nowMs-previousAbduction.lastObservedAtMs;
            if(age<=config.predictionEndMs)appliedAbductionRad=previousAbduction.angle;
            else if(age<=config.safeReturnEndMs){const t=Math.max(0,Math.min(1,(age-config.predictionEndMs)/(config.safeReturnEndMs-config.predictionEndMs)));const s=t*t*(3-2*t);appliedAbductionRad=previousAbduction.angle*(1-s);}
            else{appliedAbductionRad=0;this.abductionMemory.delete(segment.joint);this.abductionFilters.delete(segment.joint);}
          }
          if(appliedAbductionRad!==null){const abdAxis=new Vector3(segment.abductionAxisLocal.x,segment.abductionAxisLocal.y,segment.abductionAxisLocal.z).normalize();rotation=new Quaternion().setFromAxisAngle(abdAxis,appliedAbductionRad).multiply(flex);}
        }rotations[segment.joint]=qData(rotation.normalize());}
      diagnostics[segment.joint]={observedAngleRad:observedAngle,targetAngleRad:target,constrainedAngleRad:constrained,angleRad:safe,observedAbductionRad:index===0&&obs?obs.mcpAbduction:null,appliedAbductionRad,imageExtensionOverride:extensionConfirmed,measurementAccepted,measurementConfidence,rejectionReason,anatomicalPriorApplied:Boolean(obs?.anatomicalPrior?.[observationIndex]),confidence,source,limited};
    });}
    return {rotations,diagnostics};
  }
}
