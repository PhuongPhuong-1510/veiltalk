import { Quaternion,Vector3 } from "three";
import type { RawNormalizedLandmarkV1,RawTrackingFrameV1 } from "../tracking/rawTrackingTypes";
import type { QuaternionData } from "./avatarPoseTypes";
import type { ArmSide } from "./avatarMotionDiagnostics";
import type { BodyContactRegion,BodyContactSurfaceFamily,ContactEvidenceBreakdown,ContactPoint2,ContactPoint3,HandContactProbe,HumanAnatomicalLabel,HumanAnatomicalSource,HumanContactObservation } from "./bodyContactTypes";
import { fuseContactDepthEvidence } from "./contactDepthRelation";
import { observeHumanContact } from "./contactObservation";
import { createContactTemporalState,forceContactRelease,updateContactEvidence,updateContactVisualInfluence,type ContactTemporalState } from "./contactTemporal";
import { buildAvatarContactRig,type AvatarContactRig } from "./avatarContactRig";
import { mapContactAnchorForObservation,type AvatarContactLocalAnchor } from "./contactAnchorMapping";
import { solveContactPoseCorrection,type ContactPoseCorrection } from "./contactPoseCorrection";
import { poseContactAnchor } from "./posedContactAnchor";
import type { NormalizedAvatarRigProfile } from "./normalizedRigProfile";
import { computeHandPalmBasis } from "./handPalmBasis";
import { buildHumanSemanticBodyModel } from "./humanSemanticBodyModel";
import { evaluateHumanBodyRegions } from "./humanBodyRegions";

export interface ContactRuntimeDiagnostic {
  side:ArmSide;
  phase:ContactTemporalState["phase"];
  region:BodyContactRegion|null;
  regionUv:ContactPoint2|null;
  /** Unclamped selected-patch UV, useful for spotting semantic-boundary clipping. */
  regionRawUv:ContactPoint2|null;
  regionSignedDistance:number|null;
  regionSelectionBias:number|null;
  surfaceFamily:BodyContactSurfaceFamily|null;
  anatomicalLabel:HumanAnatomicalLabel|null;
  anatomicalSource:HumanAnatomicalSource|null;
  anatomicalConfidence:number|null;
  semanticModelConfidence:number|null;
  correctionEligible:boolean|null;
  familyUv:ContactPoint2|null;
  probe:string|null;
  confidence:number;
  evidence:ContactEvidenceBreakdown|null;
  depthRelation:string;
  /** Pose-only relative-depth diagnostic. Negative means wrist is estimated closer to camera than the selected body reference. */
  poseDepthDelta:number|null;
  /** Soft compatibility only; Pose z is never allowed to hard-reject contact by itself. */
  poseDepthSupport:number|null;
  posteriorHeadHint:number|null;
  posteriorNeckHint:number|null;
  stableIdentitySamples:number;
  normalVelocity:number|null;
  tangentVelocity:number|null;
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
  endpointQuality:number|null;
  normalQuality:number|null;
  contactQuality:number|null;
  angularDeltaDegrees:ContactPoseCorrection["angularDeltaDegrees"]|null;
}

interface PreviousObservationSample {
  point:ContactPoint2;
  regionUv:ContactPoint2;
  signedDistance:number;
  region:BodyContactRegion;
  surfaceFamily:BodyContactSurfaceFamily;
  familyUv:ContactPoint2;
  probe:HandContactProbe;
  sampledAtMs:number;
}
interface LockedContact {
  region:BodyContactRegion;
  family:BodyContactSurfaceFamily;
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
  side,phase:"idle",region:null,regionUv:null,regionRawUv:null,regionSignedDistance:null,regionSelectionBias:null,surfaceFamily:null,anatomicalLabel:null,anatomicalSource:null,anatomicalConfidence:null,semanticModelConfidence:null,correctionEligible:null,familyUv:null,probe:null,confidence:0,evidence:null,depthRelation:"unknown",poseDepthDelta:null,poseDepthSupport:null,posteriorHeadHint:null,posteriorNeckHint:null,stableIdentitySamples:0,normalVelocity:null,tangentVelocity:null,influence:0,
  correctionEnabled:false,correctionRequested:false,correctionApplied:false,correctionReason:"inactive",solverInfluenceScale:0,effectiveInfluence:0,evidenceQuality:0,
  anchorError:null,normalErrorDegrees:null,targetDistance:null,minReach:null,maxReach:null,reachErrorRatio:null,reachQuality:null,reachProjection:null,
  headPenetration:null,torsoPenetration:null,collisionQuality:null,endpointQuality:null,normalQuality:null,contactQuality:null,angularDeltaDegrees:null,
});
const qBlend=(a:QuaternionData|undefined,b:QuaternionData,t:number):QuaternionData=>{const qa=a?new Quaternion(a.x,a.y,a.z,a.w):new Quaternion(),qb=new Quaternion(b.x,b.y,b.z,b.w);qa.slerp(qb,Math.max(0,Math.min(1,t))).normalize();return{x:qa.x,y:qa.y,z:qa.z,w:qa.w};};
const rateLimit=(previous:QuaternionData,target:QuaternionData,maxRadians:number):QuaternionData=>{const from=new Quaternion(previous.x,previous.y,previous.z,previous.w).normalize(),to=new Quaternion(target.x,target.y,target.z,target.w).normalize(),angle=from.angleTo(to);if(angle<=maxRadians||angle<1e-8)return target;from.slerp(to,maxRadians/angle).normalize();return{x:from.x,y:from.y,z:from.z,w:from.w};};
const quaternionDistance=(a:QuaternionData|undefined,b:QuaternionData)=>new Quaternion(a?.x??0,a?.y??0,a?.z??0,a?.w??1).normalize().angleTo(new Quaternion(b.x,b.y,b.z,b.w).normalize());
const clamp01=(v:number)=>Math.max(0,Math.min(1,v));
const smoothstep=(a:number,b:number,x:number)=>{const t=clamp01((x-a)/Math.max(1e-8,b-a));return t*t*(3-2*t);};
const activePhase=(phase:ContactTemporalState["phase"])=>phase==="touch"||phase==="hold"||phase==="slide";
const posteriorRegion=(region:BodyContactRegion)=>region==="backHead"||region==="backNeck";
const regionFamily=(region:BodyContactRegion):BodyContactSurfaceFamily=>{
  if(region==="neck"||region==="backNeck")return"neck";
  if(region==="leftShoulder"||region==="rightShoulder")return"shoulder";
  if(region==="upperChest"||region==="lowerChest"||region==="abdomen")return"torso";
  return"head";
};

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

function orientationEvidence(
  landmarks:RawNormalizedLandmarkV1[]|null,worldLandmarks:RawNormalizedLandmarkV1[]|null,
  handedness:"left"|"right"|"unknown",width:number,height:number,surfaceNormal:ContactPoint3|null|undefined,
):Partial<Record<HandContactProbe,number|null>>{
  const basis=computeHandPalmBasis(landmarks,worldLandmarks,handedness,width,height);
  if(!basis.worldBasis||!surfaceNormal)return{palmCenter:null,radialEdge:null,ulnarEdge:null};
  const geometry=clamp01(basis.worldGeometryQuality),normal=new Vector3(surfaceNormal.x,surfaceNormal.y,surfaceNormal.z).normalize().negate();
  // Normalize the cross-product convention to an anatomical palm-facing direction. This keeps
  // the sign stable across left/right hands while retaining Hand-world geometry.
  const palmSign=handedness==="right"?-1:1;
  const palm=new Vector3(basis.worldBasis.normal.x,basis.worldBasis.normal.y,basis.worldBasis.normal.z).multiplyScalar(palmSign).normalize();
  const radial=new Vector3(basis.worldBasis.across.x,basis.worldBasis.across.y,basis.worldBasis.across.z).normalize();
  const ulnar=radial.clone().negate();
  const compatibility=(direction:Vector3,low:number,high:number)=>{const x=clamp01((direction.dot(normal)-low)/Math.max(1e-8,high-low));return x*x*(3-2*x)*geometry;};
  return{palmCenter:compatibility(palm,-.05,.72),radialEdge:compatibility(radial,-.18,.58),ulnarEdge:compatibility(ulnar,-.18,.58)};
}

function probeDepthWristOffset(landmarks:RawNormalizedLandmarkV1[]|null,probe:HandContactProbe):number|null{
  if(!landmarks?.[0]||!Number.isFinite(landmarks[0].z))return null;
  const ids=probe==="palmCenter"?[0,5,9,13,17]:probe==="radialEdge"?[0,5]:[0,17];
  const values=ids.map(i=>landmarks[i]?.z).filter((z):z is number=>z!==undefined&&Number.isFinite(z));
  if(values.length!==ids.length)return null;
  return values.reduce((a,b)=>a+b,0)/values.length-landmarks[0].z;
}
function calibratedProbeDepthSupport(region:BodyContactRegion,model:PoseDepthModel):number|null{
  const reference=regionReferenceDepth(region,model);if(reference===null||model.wrist===null)return null;
  const delta=model.wrist-reference;
  // This is a calibrated ordering cue, not metric 3D. Probe depth near the selected body reference
  // is supportive; a large offset remains unknown rather than becoming a hard rejection.
  const expected=posteriorRegion(region)?.08:0;
  const error=Math.abs(delta-expected);
  return 1-smoothstep(.045,.28,error);
}

function acquisitionEvidenceQuality(observation:HumanContactObservation):number{
  if(observation.evidence.hardRejections.length||observation.depth.relation==="behind"||observation.depth.relation==="in-front-separated")return 0;
  const confidenceQ=clamp01((observation.confidence-.55)/.30);
  const overlapQ=clamp01((observation.overlap-.48)/.42);
  const compatible=observation.depth.relation==="surface-compatible";
  // Unknown monocular depth may acquire only through the stricter temporal fallback. Keep its
  // correction deliberately weaker than a fully surface-compatible solve instead of making it zero.
  const depthQ=compatible?.45+.55*clamp01(observation.depth.confidence):.28+.22*clamp01(observation.depth.confidence);
  const relationScale=compatible?1:.55;
  const topologyQ=clamp01(1-(observation.regionSelectionBias??0));
  // Geometric mean keeps one weak cue from being hidden by two strong cues without becoming all-or-nothing.
  return clamp01(Math.cbrt(Math.max(0,confidenceQ*overlapQ*depthQ))*relationScale*(.7+.3*topologyQ));
}

function mapLockedAnchor(rig:AvatarContactRig|null,region:BodyContactRegion,family:BodyContactSurfaceFamily,familyUv:ContactPoint2,uv:ContactPoint2,tangentAngleRadians:number):AvatarContactLocalAnchor|null{
  return rig?mapContactAnchorForObservation(rig,region,family,familyUv,uv,tangentAngleRadians):null;
}
const vectorData=(v:Vector3)=>({x:v.x,y:v.y,z:v.z});
function blendLocalAnchor(from:AvatarContactLocalAnchor|null,to:AvatarContactLocalAnchor|null,t:number):AvatarContactLocalAnchor|null{
  if(!from)return to;if(!to)return from;if(from.parentJoint!==to.parentJoint)return t>=1?to:from;
  const alpha=clamp01(t),point=new Vector3(from.pointLocal.x,from.pointLocal.y,from.pointLocal.z).lerp(new Vector3(to.pointLocal.x,to.pointLocal.y,to.pointLocal.z),alpha);
  const normal=new Vector3(from.normalLocal.x,from.normalLocal.y,from.normalLocal.z).lerp(new Vector3(to.normalLocal.x,to.normalLocal.y,to.normalLocal.z),alpha).normalize();
  const tangent=new Vector3(from.tangentLocal.x,from.tangentLocal.y,from.tangentLocal.z).lerp(new Vector3(to.tangentLocal.x,to.tangentLocal.y,to.tangentLocal.z),alpha).normalize();
  return{region:to.region,parentJoint:to.parentJoint,pointLocal:vectorData(point),normalLocal:vectorData(normal),tangentLocal:vectorData(tangent)};
}

export class ContactRuntime {
  private rig:AvatarContactRig|null=null;
  private profile:NormalizedAvatarRigProfile|null=null;
  private sides:Record<ArmSide,SideMemory>={left:memory(),right:memory()};
  private diagnostics:Record<ArmSide,ContactRuntimeDiagnostic>={left:diagnostic("left"),right:diagnostic("right")};
  setProfile(profile:NormalizedAvatarRigProfile|null){this.profile=profile;this.rig=profile?buildAvatarContactRig(profile):null;this.reset();}
  reset(){this.sides={left:memory(),right:memory()};this.diagnostics={left:diagnostic("left"),right:diagnostic("right")};}
  snapshot(){return structuredClone(this.diagnostics);}
  correctionOwners():Record<ArmSide,boolean>{return{left:this.diagnostics.left.correctionApplied,right:this.diagnostics.right.correctionApplied};}

  update(
    side:ArmSide,frame:RawTrackingFrameV1,handLandmarks:RawNormalizedLandmarkV1[]|null,sampledAtMs:number|null,
    renderNowMs:number,renderDtMs:number,jointRotations:Partial<Record<string,QuaternionData>>,headRotation:QuaternionData|null,enabled:boolean,
    handWorldLandmarks:RawNormalizedLandmarkV1[]|null=null,handedness:"left"|"right"|"unknown"=side,
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
      const preparedModel=preliminary?buildHumanSemanticBodyModel({faceLandmarks:frame.face.landmarks,poseLandmarks:frame.pose.landmarks,videoWidth:frame.videoWidth??0,videoHeight:frame.videoHeight??0,posteriorHeadContactHint:depthModel.posteriorHeadHint,posteriorNeckContactHint:depthModel.posteriorNeckHint}):null;
      const selectedRegion=preliminary&&preparedModel?evaluateHumanBodyRegions({faceLandmarks:frame.face.landmarks,poseLandmarks:frame.pose.landmarks,videoWidth:frame.videoWidth??0,videoHeight:frame.videoHeight??0,posteriorHeadContactHint:depthModel.posteriorHeadHint,posteriorNeckContactHint:depthModel.posteriorNeckHint},preliminary.imagePoint,preparedModel).find(candidate=>candidate.region===preliminary.region):null;
      const orientations=orientationEvidence(handLandmarks,handWorldLandmarks,handedness,frame.videoWidth??0,frame.videoHeight??0,selectedRegion?.surfaceNormalCamera);

      let normalVelocity:number|null=null,tangentVelocity:number|null=null;
      const preliminaryFamily=preliminary?.surfaceFamily??(preliminary?regionFamily(preliminary.region):null);
      const preliminaryFamilyUv=preliminary?.familyUv??preliminary?.regionUv??null;
      if(preliminary&&preliminaryFamily&&preliminaryFamilyUv&&state.previousSample&&preliminaryFamily===state.previousSample.surfaceFamily&&preliminary.probe===state.previousSample.probe){
        const dt=Math.max(1,sampledAtMs-state.previousSample.sampledAtMs);
        normalVelocity=(preliminary.regionSignedDistance-state.previousSample.signedDistance)/dt*1_000;
        tangentVelocity=Math.hypot(preliminaryFamilyUv.x-state.previousSample.familyUv.x,preliminaryFamilyUv.y-state.previousSample.familyUv.y)/dt*1_000;
      }
      // Continuity belongs to a physical surface family, not a semantic label. A cheek↔ear or
      // forehead↔headTop boundary correction must not erase temporal evidence every frame.
      const sameIdentity=Boolean(preliminary&&state.previousRegion&&
        (preliminary.surfaceFamily??regionFamily(preliminary.region))===regionFamily(state.previousRegion)&&
        preliminary.probe===state.previousProbe);
      state.stableIdentitySamples=sameIdentity?state.stableIdentitySamples+1:preliminary?1:0;
      const motionConsistency=normalVelocity===null?null:clamp01(1-Math.abs(normalVelocity)/1.2);
      const probeOffset=preliminary?probeDepthWristOffset(handLandmarks,preliminary.probe):null;
      const probeDepthModel=probeOffset===null||depthModel.wrist===null?depthModel:{...depthModel,wrist:depthModel.wrist+probeOffset};
      const pose=candidatePoseCompatibility(preliminary?.region??"forehead",probeDepthModel);
      const probeDepth=preliminary?calibratedProbeDepthSupport(preliminary.region,probeDepthModel):null;
      const depth=fuseContactDepthEvidence({
        occlusion:null,
        scaleChange:null,
        motionConsistency,
        posePrior:preliminary?pose.support:null,
        history:state.stableIdentitySamples>=3?.75:null,
        probeDepth,
      },null);
      const observation=observeHumanContact({
        side,faceLandmarks:frame.face.landmarks,poseLandmarks:frame.pose.landmarks,handLandmarks,videoWidth:frame.videoWidth??0,videoHeight:frame.videoHeight??0,
        sampledAtMs,depth,posteriorHeadContactHint:depthModel.posteriorHeadHint,posteriorNeckContactHint:depthModel.posteriorNeckHint,previousRegion:state.previousRegion,previousProbe:state.previousProbe,
        continuity:Math.min(1,state.stableIdentitySamples/3),normalVelocity,tangentVelocity,motionConfidence:motionConsistency,orientationByProbe:orientations,
      });
      state.observation=observation;
      const observationGap=state.temporal.lastObservedAtMs===null?Infinity:sampledAtMs-state.temporal.lastObservedAtMs;
      const reacquireMismatch=Boolean(activePhase(state.temporal.phase)&&state.locked&&observationGap>80&&observation&&(
        (observation.surfaceFamily??regionFamily(observation.region))!==state.locked.family||observation.probe!==state.locked.probe
      ));
      // Occlusion may preserve a confirmed contact, but a newly visible, incompatible hand must
      // not inherit the old anchor merely because it has the same left/right identity.
      state.temporal=reacquireMismatch?forceContactRelease(state.temporal,sampledAtMs):updateContactEvidence(state.temporal,observation,sampledAtMs);
      if(preliminary){
        const family=preliminary.surfaceFamily??regionFamily(preliminary.region);
        state.previousSample={point:preliminary.imagePoint,regionUv:preliminary.regionUv,signedDistance:preliminary.regionSignedDistance,region:preliminary.region,surfaceFamily:family,familyUv:preliminary.familyUv??preliminary.regionUv,probe:preliminary.probe,sampledAtMs};
      }
      if(observation){state.previousRegion=observation.region;state.previousProbe=observation.probe;}
    }

    // Detector silence must never freeze contact forever. This clock can only force release.
    if(state.lastDetectorArrivalRenderMs!==null&&renderNowMs-state.lastDetectorArrivalRenderMs>500&&activePhase(state.temporal.phase))
      state.temporal=forceContactRelease(state.temporal,renderNowMs);

    const nowActive=activePhase(state.temporal.phase);
    if(!wasActive&&nowActive&&state.observation&&state.observation.correctionEligible!==false){
      const tangent=state.observation.tangentAngleRadians??0;
      state.locked={
        region:state.observation.region,family:state.observation.surfaceFamily??regionFamily(state.observation.region),probe:state.observation.probe,uv:{...state.observation.regionUv},tangentAngleRadians:tangent,
        localAnchor:mapLockedAnchor(this.rig,state.observation.region,state.observation.surfaceFamily??regionFamily(state.observation.region),state.observation.familyUv??state.observation.regionUv,state.observation.regionUv,tangent),acquiredAtMs:renderNowMs,lastUpdatedAtMs:renderNowMs,
        evidenceQuality:acquisitionEvidenceQuality(state.observation),
      };
    }else if(nowActive&&!state.locked&&state.observation&&state.observation.correctionEligible!==false){
      const tangent=state.observation.tangentAngleRadians??0;
      state.locked={region:state.observation.region,family:state.observation.surfaceFamily??regionFamily(state.observation.region),probe:state.observation.probe,uv:{...state.observation.regionUv},tangentAngleRadians:tangent,localAnchor:mapLockedAnchor(this.rig,state.observation.region,state.observation.surfaceFamily??regionFamily(state.observation.region),state.observation.familyUv??state.observation.regionUv,state.observation.regionUv,tangent),acquiredAtMs:renderNowMs,lastUpdatedAtMs:renderNowMs,evidenceQuality:acquisitionEvidenceQuality(state.observation)};
    }

    if(nowActive&&state.temporal.phase==="slide"&&state.locked&&state.observation&&(state.observation.surfaceFamily??regionFamily(state.observation.region))===state.locked.family&&state.observation.probe===state.locked.probe){
      const dt=Math.max(0,(renderNowMs-state.locked.lastUpdatedAtMs)/1_000),maxDelta=1.25*dt;
      const dx=state.observation.regionUv.x-state.locked.uv.x,dy=state.observation.regionUv.y-state.locked.uv.y,length=Math.hypot(dx,dy),scale=length>maxDelta&&length>1e-8?maxDelta/length:1;
      state.locked.uv={x:Math.max(-1,Math.min(1,state.locked.uv.x+dx*scale)),y:Math.max(-1,Math.min(1,state.locked.uv.y+dy*scale))};
      state.locked.tangentAngleRadians=state.observation.tangentAngleRadians??state.locked.tangentAngleRadians;
      const targetAnchor=mapLockedAnchor(this.rig,state.observation.region,state.locked.family,state.observation.familyUv??state.observation.regionUv,state.observation.regionUv,state.locked.tangentAngleRadians);
      state.locked.localAnchor=blendLocalAnchor(state.locked.localAnchor,targetAnchor,Math.min(1,dt*6));
      state.locked.region=state.observation.region;state.locked.uv={...state.observation.regionUv};
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
      side,phase:state.temporal.phase,region:shownRegion,regionUv:shownUv,
      regionRawUv:state.observation?.regionRawUv??null,regionSignedDistance:state.observation?.regionSignedDistance??null,
      regionSelectionBias:state.observation?.regionSelectionBias??null,surfaceFamily:state.observation?.surfaceFamily??(shownRegion?regionFamily(shownRegion):null),
      anatomicalLabel:state.observation?.anatomicalLabel??null,anatomicalSource:state.observation?.anatomicalSource??null,
      anatomicalConfidence:state.observation?.anatomicalConfidence??null,semanticModelConfidence:state.observation?.modelConfidence??null,
      correctionEligible:state.observation?.correctionEligible??null,familyUv:state.observation?.familyUv??null,probe:shownProbe,
      confidence:state.observation?.confidence??0,evidence:state.observation?.evidence??null,depthRelation:state.observation?.depth.relation??"unknown",
      poseDepthDelta:state.observation?candidatePoseCompatibility(state.observation.region,buildPoseDepthModel(frame,side)).delta:null,
      poseDepthSupport:state.observation?candidatePoseCompatibility(state.observation.region,buildPoseDepthModel(frame,side)).support:null,
      posteriorHeadHint:buildPoseDepthModel(frame,side).posteriorHeadHint,posteriorNeckHint:buildPoseDepthModel(frame,side).posteriorNeckHint,
      stableIdentitySamples:state.stableIdentitySamples,normalVelocity:state.observation?.normalVelocity??null,tangentVelocity:state.observation?.tangentVelocity??null,
      influence:state.temporal.visualInfluence,correctionEnabled:enabled,
      correctionRequested:Boolean(enabled&&state.locked&&state.temporal.visualInfluence>0),correctionApplied:applied,
      correctionReason:correction?.reason??(usable?.reason??"inactive"),solverInfluenceScale,effectiveInfluence,evidenceQuality,
      anchorError:shown?.anchorError??null,normalErrorDegrees:shown?shown.normalErrorRadians*180/Math.PI:null,
      targetDistance:shown?.targetDistance??null,minReach:shown?.minReach??null,maxReach:shown?.maxReach??null,
      reachErrorRatio:shown?.reachErrorRatio??null,reachQuality:shown?.reachQuality??null,reachProjection:shown?.projection??null,
      headPenetration:shown?.headPenetration??null,torsoPenetration:shown?.torsoPenetration??null,collisionQuality:shown?.collisionQuality??null,
      endpointQuality:shown?.endpointQuality??null,normalQuality:shown?.normalQuality??null,contactQuality:shown?.contactQuality??null,
      angularDeltaDegrees:shown?.angularDeltaDegrees??null,
    };
  }
}
