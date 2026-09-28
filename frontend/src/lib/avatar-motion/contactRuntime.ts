import { Quaternion } from "three";
import type { RawNormalizedLandmarkV1,RawTrackingFrameV1 } from "../tracking/rawTrackingTypes";
import type { QuaternionData } from "./avatarPoseTypes";
import type { ArmSide } from "./avatarMotionDiagnostics";
import type { BodyContactRegion,ContactEvidenceBreakdown,ContactPoint2,HandContactProbe,HumanContactObservation } from "./bodyContactTypes";
import { fuseContactDepthEvidence } from "./contactDepthRelation";
import { observeHumanContact } from "./contactObservation";
import { createContactTemporalState,forceContactRelease,updateContactEvidence,updateContactVisualInfluence,type ContactTemporalState } from "./contactTemporal";
import { buildAvatarContactRig,type AvatarContactRig } from "./avatarContactRig";
import { mapContactAnchor,type AvatarContactLocalAnchor } from "./contactAnchorMapping";
import { solveContactPoseCorrection,type ContactPoseCorrection } from "./contactPoseCorrection";
import { poseContactAnchor } from "./posedContactAnchor";
import type { NormalizedAvatarRigProfile } from "./normalizedRigProfile";

export interface ContactRuntimeDiagnostic {
  side:ArmSide;
  phase:ContactTemporalState["phase"];
  region:BodyContactRegion|null;
  regionUv:ContactPoint2|null;
  probe:string|null;
  confidence:number;
  evidence:ContactEvidenceBreakdown|null;
  depthRelation:string;
  /** Pose-only relative-depth diagnostic. Negative means wrist is estimated closer to camera than the selected body reference. */
  poseDepthDelta:number|null;
  /** Soft compatibility only; Pose z is never allowed to hard-reject contact by itself. */
  poseDepthSupport:number|null;
  /** Temporal FSM influence before reach/collision quality is applied. */
  influence:number;
  /** Whether production correction is enabled for this runtime update. */
  correctionEnabled:boolean;
  correctionRequested:boolean;
  correctionApplied:boolean;
  correctionReason:ContactPoseCorrection["reason"]|"inactive";
  /** Solver quality multiplier after reach/collision fail-soft handling. */
  solverInfluenceScale:number;
  /** influence * solverInfluenceScale * evidenceQuality. */
  effectiveInfluence:number;
  evidenceQuality:number;
  anchorError:number|null;
  normalErrorDegrees:number|null;
  targetDistance:number|null;
  minReach:number|null;
  maxReach:number|null;
  reachErrorRatio:number|null;
  reachQuality:number|null;
  reachProjection:ContactPoseCorrection["projection"]|null;
  headPenetration:number|null;
  torsoPenetration:number|null;
  collisionQuality:number|null;
  angularDeltaDegrees:ContactPoseCorrection["angularDeltaDegrees"]|null;
}

interface PreviousObservationSample {
  point:ContactPoint2;
  regionUv:ContactPoint2;
  signedDistance:number;
  region:BodyContactRegion;
  probe:HandContactProbe;
  sampledAtMs:number;
}
interface LockedContact {
  region:BodyContactRegion;
  probe:HandContactProbe;
  uv:ContactPoint2;
  tangentAngleRadians:number;
  localAnchor:AvatarContactLocalAnchor|null;
  acquiredAtMs:number;
  lastUpdatedAtMs:number;
  /** Evidence quality frozen at acquisition so a noisy later frame cannot suddenly amplify correction. */
  evidenceQuality:number;
}
interface SideMemory {
  temporal:ContactTemporalState;
  previousSample:PreviousObservationSample|null;
  previousRegion:BodyContactRegion|null;
  previousProbe:HandContactProbe|null;
  stableIdentitySamples:number;
  observation:HumanContactObservation|null;
  locked:LockedContact|null;
  lastCorrection:ContactPoseCorrection|null;
  lastCorrectionAtMs:number|null;
  lastDetectorArrivalRenderMs:number|null;
  appliedRotations:Partial<Record<string,QuaternionData>>;
}
const memory=():SideMemory=>({temporal:createContactTemporalState(),previousSample:null,previousRegion:null,previousProbe:null,stableIdentitySamples:0,observation:null,locked:null,lastCorrection:null,lastCorrectionAtMs:null,lastDetectorArrivalRenderMs:null,appliedRotations:{}});
const diagnostic=(side:ArmSide):ContactRuntimeDiagnostic=>({
  side,phase:"idle",region:null,regionUv:null,probe:null,confidence:0,evidence:null,depthRelation:"unknown",poseDepthDelta:null,poseDepthSupport:null,influence:0,
  correctionEnabled:false,correctionRequested:false,correctionApplied:false,correctionReason:"inactive",solverInfluenceScale:0,effectiveInfluence:0,evidenceQuality:0,
  anchorError:null,normalErrorDegrees:null,targetDistance:null,minReach:null,maxReach:null,reachErrorRatio:null,reachQuality:null,reachProjection:null,
  headPenetration:null,torsoPenetration:null,collisionQuality:null,angularDeltaDegrees:null,
});
const qBlend=(a:QuaternionData|undefined,b:QuaternionData,t:number):QuaternionData=>{const qa=a?new Quaternion(a.x,a.y,a.z,a.w):new Quaternion(),qb=new Quaternion(b.x,b.y,b.z,b.w);qa.slerp(qb,Math.max(0,Math.min(1,t))).normalize();return{x:qa.x,y:qa.y,z:qa.z,w:qa.w};};
const rateLimit=(previous:QuaternionData,target:QuaternionData,maxRadians:number):QuaternionData=>{const from=new Quaternion(previous.x,previous.y,previous.z,previous.w).normalize(),to=new Quaternion(target.x,target.y,target.z,target.w).normalize(),angle=from.angleTo(to);if(angle<=maxRadians||angle<1e-8)return target;from.slerp(to,maxRadians/angle).normalize();return{x:from.x,y:from.y,z:from.z,w:from.w};};
const quaternionDistance=(a:QuaternionData|undefined,b:QuaternionData)=>new Quaternion(a?.x??0,a?.y??0,a?.z??0,a?.w??1).normalize().angleTo(new Quaternion(b.x,b.y,b.z,b.w).normalize());
const clamp01=(v:number)=>Math.max(0,Math.min(1,v));
const smoothstep=(a:number,b:number,x:number)=>{const t=clamp01((x-a)/Math.max(1e-8,b-a));return t*t*(3-2*t);};
const activePhase=(phase:ContactTemporalState["phase"])=>phase==="touch"||phase==="hold"||phase==="slide";
const posteriorRegion=(region:BodyContactRegion)=>region==="backHead"||region==="backNeck";

function averageFiniteZ(points:Array<RawNormalizedLandmarkV1|undefined|null>):number|null{
  const values=points.filter((p):p is RawNormalizedLandmarkV1=>Boolean(p&&Number.isFinite(p.z))).map(p=>p.z);
  return values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
}

interface PoseDepthModel {wrist:number|null;head:number|null;shoulders:number|null;hips:number|null;posteriorHeadHint:number;posteriorNeckHint:number}
function buildPoseDepthModel(frame:RawTrackingFrameV1,side:ArmSide):PoseDepthModel{
  const pose=frame.pose.landmarks??[],wrist=pose[side==="left"?15:16];
  const wristZ=wrist&&Number.isFinite(wrist.z)?wrist.z:null;
  const headZ=averageFiniteZ([pose[0],pose[7],pose[8]]);
  const shoulderZ=averageFiniteZ([pose[11],pose[12]]);
  const hipZ=averageFiniteZ([pose[23],pose[24]]);
  const headDelta=wristZ!==null&&headZ!==null?wristZ-headZ:null;
  const neckDelta=wristZ!==null&&shoulderZ!==null?wristZ-shoulderZ:null;
  return{
    wrist:wristZ,head:headZ,shoulders:shoulderZ,hips:hipZ,
    posteriorHeadHint:headDelta===null?0:smoothstep(.10,.42,headDelta),
    posteriorNeckHint:neckDelta===null?0:smoothstep(.08,.34,neckDelta),
  };
}

function regionReferenceDepth(region:BodyContactRegion,model:PoseDepthModel):number|null{
  const lerp=(a:number,b:number,t:number)=>a+(b-a)*t;
  if(region==="headTop"||region==="forehead"||region==="leftCheek"||region==="rightCheek"||region==="mouth"||region==="chin"||region==="leftEar"||region==="rightEar"||region==="backHead")return model.head;
  if(region==="leftShoulder"||region==="rightShoulder"||region==="neck"||region==="backNeck")return model.shoulders;
  if(model.shoulders===null)return null;
  if(model.hips===null)return model.shoulders;
  if(region==="upperChest")return lerp(model.shoulders,model.hips,.24);
  if(region==="lowerChest")return lerp(model.shoulders,model.hips,.5);
  if(region==="abdomen")return lerp(model.shoulders,model.hips,.76);
  return model.shoulders;
}

function candidatePoseCompatibility(region:BodyContactRegion,model:PoseDepthModel):{support:number|null;hard:null;delta:number|null}{
  const reference=regionReferenceDepth(region,model);
  if(reference===null||model.wrist===null)return{support:null,hard:null,delta:null};
  const delta=model.wrist-reference;

  // IMPORTANT: MediaPipe Pose z is useful as a weak relative-depth prior, but the wrist landmark
  // represents the wrist joint rather than the contacting palm surface. During a real cheek/head
  // contact it is completely normal for the wrist to be substantially closer to the camera than
  // the face reference. Therefore Pose z must never assert `in-front-separated`/`behind` by itself.
  if(posteriorRegion(region)){
    // Posterior surfaces prefer the wrist to be behind the head/shoulder reference. A contradictory
    // value merely lowers support; it does not hard-reject the candidate.
    const enter=smoothstep(-.02,.24,delta);
    const tooFar=smoothstep(.72,1.15,delta);
    const support=.08+.84*enter*(1-.72*tooFar);
    return{support:clamp01(support),hard:null,delta};
  }

  const isHead=region==="headTop"||region==="forehead"||region==="leftCheek"||region==="rightCheek"||region==="mouth"||region==="chin"||region==="leftEar"||region==="rightEar";
  // An anterior contact allows a broad negative delta because the wrist joint sits in front of
  // the body surface when the palm is pressed against it. Only very extreme offsets reduce support.
  const frontSoft=isHead?.62:.52,frontHard=isHead?1.15:1.0;
  const backSoft=isHead?.24:.20,backHard=isHead?.72:.62;
  const tooFarFront=smoothstep(frontSoft,frontHard,-delta);
  const tooFarBehind=smoothstep(backSoft,backHard,delta);
  const support=.9*(1-Math.max(tooFarFront,tooFarBehind));
  return{support:Math.max(.08,support),hard:null,delta};
}

function acquisitionEvidenceQuality(observation:HumanContactObservation):number{
  if(observation.depth.relation!=="surface-compatible"||observation.evidence.hardRejections.length)return 0;
  const confidenceQ=clamp01((observation.confidence-.55)/.30);
  const overlapQ=clamp01((observation.overlap-.48)/.42);
  const depthQ=.4+.6*clamp01(observation.depth.confidence);
  // Geometric mean keeps one weak cue from being hidden by two strong cues without becoming all-or-nothing.
  return clamp01(Math.cbrt(Math.max(0,confidenceQ*overlapQ*depthQ)));
}

function mapLockedAnchor(rig:AvatarContactRig|null,region:BodyContactRegion,uv:ContactPoint2,tangentAngleRadians:number):AvatarContactLocalAnchor|null{
  return rig?mapContactAnchor(rig.surfaces[region],uv,tangentAngleRadians):null;
}

export class ContactRuntime {
  private rig:AvatarContactRig|null=null;
  private profile:NormalizedAvatarRigProfile|null=null;
  private sides:Record<ArmSide,SideMemory>={left:memory(),right:memory()};
  private diagnostics:Record<ArmSide,ContactRuntimeDiagnostic>={left:diagnostic("left"),right:diagnostic("right")};
  setProfile(profile:NormalizedAvatarRigProfile|null){this.profile=profile;this.rig=profile?buildAvatarContactRig(profile):null;this.reset();}
  reset(){this.sides={left:memory(),right:memory()};this.diagnostics={left:diagnostic("left"),right:diagnostic("right")};}
  snapshot(){return structuredClone(this.diagnostics);}

  update(
    side:ArmSide,frame:RawTrackingFrameV1,handLandmarks:RawNormalizedLandmarkV1[]|null,sampledAtMs:number|null,
    renderNowMs:number,renderDtMs:number,jointRotations:Partial<Record<string,QuaternionData>>,headRotation:QuaternionData|null,enabled:boolean,
  ){
    const state=this.sides[side],wasActive=activePhase(state.temporal.phase);
    const isNew=sampledAtMs!==null&&(state.temporal.lastDetectorTimestampMs===null||sampledAtMs>state.temporal.lastDetectorTimestampMs);
    if(isNew&&sampledAtMs!==null){
      state.lastDetectorArrivalRenderMs=renderNowMs;
      const depthModel=buildPoseDepthModel(frame,side);
      const unknown=fuseContactDepthEvidence({occlusion:null,scaleChange:null,motionConsistency:null,posePrior:null,history:null});
      const preliminary=observeHumanContact({
        side,faceLandmarks:frame.face.landmarks,poseLandmarks:frame.pose.landmarks,handLandmarks,videoWidth:frame.videoWidth??0,videoHeight:frame.videoHeight??0,
        sampledAtMs,depth:unknown,posteriorHeadContactHint:depthModel.posteriorHeadHint,posteriorNeckContactHint:depthModel.posteriorNeckHint,
        previousRegion:state.previousRegion,previousProbe:state.previousProbe,continuity:state.stableIdentitySamples>=2?.8:0,
      });

      let normalVelocity:number|null=null,tangentVelocity:number|null=null;
      if(preliminary&&state.previousSample&&preliminary.region===state.previousSample.region&&preliminary.probe===state.previousSample.probe){
        const dt=Math.max(1,sampledAtMs-state.previousSample.sampledAtMs);
        normalVelocity=(preliminary.regionSignedDistance-state.previousSample.signedDistance)/dt*1_000;
        tangentVelocity=Math.hypot(preliminary.regionUv.x-state.previousSample.regionUv.x,preliminary.regionUv.y-state.previousSample.regionUv.y)/dt*1_000;
      }
      const sameIdentity=Boolean(preliminary&&preliminary.region===state.previousRegion&&preliminary.probe===state.previousProbe);
      state.stableIdentitySamples=sameIdentity?state.stableIdentitySamples+1:preliminary?1:0;
      const motionConsistency=normalVelocity===null?null:clamp01(1-Math.abs(normalVelocity)/1.2);
      const pose=candidatePoseCompatibility(preliminary?.region??"forehead",depthModel);
      const depth=fuseContactDepthEvidence({
        occlusion:null,
        scaleChange:null,
        motionConsistency,
        posePrior:preliminary?pose.support:null,
        history:state.stableIdentitySamples>=3?.75:null,
      },null);
      const observation=observeHumanContact({
        side,faceLandmarks:frame.face.landmarks,poseLandmarks:frame.pose.landmarks,handLandmarks,videoWidth:frame.videoWidth??0,videoHeight:frame.videoHeight??0,
        sampledAtMs,depth,posteriorHeadContactHint:depthModel.posteriorHeadHint,posteriorNeckContactHint:depthModel.posteriorNeckHint,previousRegion:state.previousRegion,previousProbe:state.previousProbe,
        continuity:Math.min(1,state.stableIdentitySamples/3),normalVelocity,tangentVelocity,motionConfidence:motionConsistency,
      });
      state.observation=observation;
      state.temporal=updateContactEvidence(state.temporal,observation,sampledAtMs);
      if(preliminary){
        state.previousSample={point:preliminary.imagePoint,regionUv:preliminary.regionUv,signedDistance:preliminary.regionSignedDistance,region:preliminary.region,probe:preliminary.probe,sampledAtMs};
      }
      if(observation){state.previousRegion=observation.region;state.previousProbe=observation.probe;}
    }

    // Detector silence must never freeze contact forever. This clock can only force release.
    if(state.lastDetectorArrivalRenderMs!==null&&renderNowMs-state.lastDetectorArrivalRenderMs>500&&activePhase(state.temporal.phase))
      state.temporal=forceContactRelease(state.temporal,renderNowMs);

    const nowActive=activePhase(state.temporal.phase);
    if(!wasActive&&nowActive&&state.observation){
      const tangent=state.observation.tangentAngleRadians??0;
      state.locked={
        region:state.observation.region,probe:state.observation.probe,uv:{...state.observation.regionUv},tangentAngleRadians:tangent,
        localAnchor:mapLockedAnchor(this.rig,state.observation.region,state.observation.regionUv,tangent),acquiredAtMs:renderNowMs,lastUpdatedAtMs:renderNowMs,
        evidenceQuality:acquisitionEvidenceQuality(state.observation),
      };
    }else if(nowActive&&!state.locked&&state.observation){
      const tangent=state.observation.tangentAngleRadians??0;
      state.locked={region:state.observation.region,probe:state.observation.probe,uv:{...state.observation.regionUv},tangentAngleRadians:tangent,localAnchor:mapLockedAnchor(this.rig,state.observation.region,state.observation.regionUv,tangent),acquiredAtMs:renderNowMs,lastUpdatedAtMs:renderNowMs,evidenceQuality:acquisitionEvidenceQuality(state.observation)};
    }

    if(nowActive&&state.temporal.phase==="slide"&&state.locked&&state.observation&&state.observation.region===state.locked.region&&state.observation.probe===state.locked.probe){
      const dt=Math.max(0,(renderNowMs-state.locked.lastUpdatedAtMs)/1_000),maxDelta=1.25*dt;
      const dx=state.observation.regionUv.x-state.locked.uv.x,dy=state.observation.regionUv.y-state.locked.uv.y,length=Math.hypot(dx,dy),scale=length>maxDelta&&length>1e-8?maxDelta/length:1;
      state.locked.uv={x:Math.max(-1,Math.min(1,state.locked.uv.x+dx*scale)),y:Math.max(-1,Math.min(1,state.locked.uv.y+dy*scale))};
      state.locked.tangentAngleRadians=state.observation.tangentAngleRadians??state.locked.tangentAngleRadians;
      state.locked.localAnchor=mapLockedAnchor(this.rig,state.locked.region,state.locked.uv,state.locked.tangentAngleRadians);
      const liveQuality=acquisitionEvidenceQuality(state.observation);
      state.locked.evidenceQuality=clamp01(state.locked.evidenceQuality*.85+liveQuality*.15);
      state.locked.lastUpdatedAtMs=renderNowMs;
    }

    state.temporal=updateContactVisualInfluence(state.temporal,renderDtMs);
    if(!enabled){state.lastCorrection=null;state.lastCorrectionAtMs=null;state.appliedRotations={};}

    let correction:ContactPoseCorrection|null=null;
    if(enabled&&this.profile&&this.rig&&state.locked?.localAnchor&&state.temporal.visualInfluence>0&&(nowActive||state.temporal.phase==="release")){
      const anchor=poseContactAnchor(state.locked.localAnchor,this.profile,jointRotations,headRotation);
      if(anchor)correction=solveContactPoseCorrection(this.profile,this.rig,side,anchor,state.locked.probe,jointRotations,headRotation);
      if(correction?.accepted){state.lastCorrection=correction;state.lastCorrectionAtMs=renderNowMs;}
    }

    const recentLast=state.lastCorrection&&state.lastCorrectionAtMs!==null&&renderNowMs-state.lastCorrectionAtMs<=140?state.lastCorrection:null;
    // A one-frame geometry failure should not abruptly drop a valid contact. Reuse the last valid
    // correction briefly whether the current solve is missing or rejected.
    const usable=correction?.accepted?correction:recentLast;
    const solverInfluenceScale=usable?.influenceScale??0;
    const evidenceQuality=state.locked?.evidenceQuality??0;
    const effectiveInfluence=clamp01(state.temporal.visualInfluence*solverInfluenceScale*evidenceQuality);
    let applied=false;
    if(enabled&&usable&&state.temporal.visualInfluence>0){
      for(const[joint,rotation]of Object.entries(usable.rotations)){
        const baseline=jointRotations[joint];
        const hadPrevious=state.appliedRotations[joint]!==undefined;
        // If both temporal and solver quality are already zero and there is no previous corrective
        // pose to release, do not inject identity keys into an otherwise absent baseline joint.
        if(effectiveInfluence<=1e-6&&!hadPrevious)continue;
        const desired=qBlend(baseline,rotation!,effectiveInfluence),previous=state.appliedRotations[joint]??baseline??desired;
        const maxRate=joint.endsWith("Hand")?420:joint.includes("LowerArm")?320:260;
        const limited=rateLimit(previous,desired,maxRate*Math.PI/180*Math.max(0,renderDtMs)/1_000);
        if(quaternionDistance(baseline,limited)>1e-5)applied=true;
        jointRotations[joint]=limited;
        state.appliedRotations[joint]=limited;
      }
    }
    if(state.temporal.visualInfluence<=0){
      state.lastCorrection=null;state.lastCorrectionAtMs=null;state.appliedRotations={};
      if(state.temporal.phase==="idle"||state.temporal.phase==="release")state.locked=null;
    }

    const shownRegion=state.locked?.region??state.observation?.region??state.temporal.region;
    const shownProbe=state.locked?.probe??state.observation?.probe??null;
    const shownUv=state.locked?.uv??state.observation?.regionUv??null;
    const shown=correction??usable;
    this.diagnostics[side]={
      side,phase:state.temporal.phase,region:shownRegion,regionUv:shownUv,probe:shownProbe,
      confidence:state.observation?.confidence??0,evidence:state.observation?.evidence??null,depthRelation:state.observation?.depth.relation??"unknown",
      poseDepthDelta:state.observation?candidatePoseCompatibility(state.observation.region,buildPoseDepthModel(frame,side)).delta:null,
      poseDepthSupport:state.observation?candidatePoseCompatibility(state.observation.region,buildPoseDepthModel(frame,side)).support:null,
      influence:state.temporal.visualInfluence,correctionEnabled:enabled,
      correctionRequested:Boolean(enabled&&state.locked&&state.temporal.visualInfluence>0),correctionApplied:applied,
      correctionReason:correction?.reason??(usable?.reason??"inactive"),solverInfluenceScale,effectiveInfluence,evidenceQuality,
      anchorError:shown?.anchorError??null,normalErrorDegrees:shown?shown.normalErrorRadians*180/Math.PI:null,
      targetDistance:shown?.targetDistance??null,minReach:shown?.minReach??null,maxReach:shown?.maxReach??null,
      reachErrorRatio:shown?.reachErrorRatio??null,reachQuality:shown?.reachQuality??null,reachProjection:shown?.projection??null,
      headPenetration:shown?.headPenetration??null,torsoPenetration:shown?.torsoPenetration??null,collisionQuality:shown?.collisionQuality??null,
      angularDeltaDegrees:shown?.angularDeltaDegrees??null,
    };
  }
}
