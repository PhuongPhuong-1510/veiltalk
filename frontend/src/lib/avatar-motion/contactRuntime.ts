import { Quaternion } from "three";
import type { RawNormalizedLandmarkV1,RawTrackingFrameV1 } from "../tracking/rawTrackingTypes";
import type { QuaternionData } from "./avatarPoseTypes";
import type { ArmSide } from "./avatarMotionDiagnostics";
import type { BodyContactRegion,ContactPoint2,HumanContactObservation } from "./bodyContactTypes";
import { fuseContactDepthEvidence } from "./contactDepthRelation";
import { observeHumanContact } from "./contactObservation";
import { createContactTemporalState,updateContactEvidence,updateContactVisualInfluence,type ContactTemporalState } from "./contactTemporal";
import { buildAvatarContactRig,type AvatarContactRig } from "./avatarContactRig";
import { mapContactAnchor } from "./contactAnchorMapping";
import { solveContactPoseCorrection,type ContactPoseCorrection } from "./contactPoseCorrection";
import type { NormalizedAvatarRigProfile } from "./normalizedRigProfile";

export interface ContactRuntimeDiagnostic {side:ArmSide;phase:ContactTemporalState["phase"];region:BodyContactRegion|null;probe:string|null;confidence:number;depthRelation:string;influence:number;correctionReason:ContactPoseCorrection["reason"]|"inactive";anchorError:number|null;normalErrorDegrees:number|null}
interface SideMemory {temporal:ContactTemporalState;previousPoint:ContactPoint2|null;previousAt:number|null;previousRegion:BodyContactRegion|null;stableRegionSamples:number;observation:HumanContactObservation|null}
const memory=():SideMemory=>({temporal:createContactTemporalState(),previousPoint:null,previousAt:null,previousRegion:null,stableRegionSamples:0,observation:null});
const qBlend=(a:QuaternionData|undefined,b:QuaternionData,t:number):QuaternionData=>{const qa=a?new Quaternion(a.x,a.y,a.z,a.w):new Quaternion(),qb=new Quaternion(b.x,b.y,b.z,b.w);qa.slerp(qb,Math.max(0,Math.min(1,t))).normalize();return{x:qa.x,y:qa.y,z:qa.z,w:qa.w};};

export class ContactRuntime {
  private rig:AvatarContactRig|null=null;private profile:NormalizedAvatarRigProfile|null=null;private sides:Record<ArmSide,SideMemory>={left:memory(),right:memory()};
  private diagnostics:Record<ArmSide,ContactRuntimeDiagnostic>={left:{side:"left",phase:"idle",region:null,probe:null,confidence:0,depthRelation:"unknown",influence:0,correctionReason:"inactive",anchorError:null,normalErrorDegrees:null},right:{side:"right",phase:"idle",region:null,probe:null,confidence:0,depthRelation:"unknown",influence:0,correctionReason:"inactive",anchorError:null,normalErrorDegrees:null}};
  setProfile(profile:NormalizedAvatarRigProfile|null){this.profile=profile;this.rig=profile?buildAvatarContactRig(profile):null;this.reset();}
  reset(){this.sides={left:memory(),right:memory()};}
  snapshot(){return structuredClone(this.diagnostics);}
  update(side:ArmSide,frame:RawTrackingFrameV1,handLandmarks:RawNormalizedLandmarkV1[]|null,sampledAtMs:number|null,renderNowMs:number,renderDtMs:number,jointRotations:Partial<Record<string,QuaternionData>>,enabled:boolean){
    const state=this.sides[side],isNew=sampledAtMs!==null&&(state.temporal.lastDetectorTimestampMs===null||sampledAtMs>state.temporal.lastDetectorTimestampMs);
    if(isNew&&sampledAtMs!==null){
      const unknown=fuseContactDepthEvidence({occlusion:null,scaleChange:null,motionConsistency:null,posePrior:null,history:null});
      const preliminary=observeHumanContact({side,faceLandmarks:frame.face.landmarks,poseLandmarks:frame.pose.landmarks,handLandmarks,videoWidth:frame.videoWidth??0,videoHeight:frame.videoHeight??0,sampledAtMs,depth:unknown,previousRegion:state.previousRegion,continuity:state.stableRegionSamples>=2?.8:0});
      let velocity:number|null=null;if(preliminary&&state.previousPoint&&state.previousAt!==null){const dt=Math.max(1,sampledAtMs-state.previousAt);velocity=Math.hypot(preliminary.imagePoint.x-state.previousPoint.x,preliminary.imagePoint.y-state.previousPoint.y)/dt*1_000;}
      const same=Boolean(preliminary&&preliminary.region===state.previousRegion);state.stableRegionSamples=same?state.stableRegionSamples+1:preliminary?1:0;
      const wristIndex=side==="left"?15:16,nose=frame.pose.landmarks?.[0],wrist=frame.pose.landmarks?.[wristIndex];const posePrior=nose&&wrist&&Number.isFinite(nose.z)&&Number.isFinite(wrist.z)&&Math.abs(nose.z-wrist.z)<.35?.7:null;
      const settled=velocity!==null&&velocity<.12;const depth=fuseContactDepthEvidence({occlusion:preliminary&&preliminary.overlap>.75?.55:null,scaleChange:preliminary?.overlap&&preliminary.overlap>.75?.6:null,motionConsistency:settled?.75:null,posePrior,history:state.stableRegionSamples>=3?.75:null});
      const observation=observeHumanContact({side,faceLandmarks:frame.face.landmarks,poseLandmarks:frame.pose.landmarks,handLandmarks,videoWidth:frame.videoWidth??0,videoHeight:frame.videoHeight??0,sampledAtMs,depth,previousRegion:state.previousRegion,continuity:Math.min(1,state.stableRegionSamples/3),approachVelocity:velocity});
      state.observation=observation;state.temporal=updateContactEvidence(state.temporal,observation,sampledAtMs);if(observation){state.previousPoint=observation.imagePoint;state.previousRegion=observation.region;}state.previousAt=sampledAtMs;
    }else if(sampledAtMs!==null&&state.temporal.lastDetectorTimestampMs!==null&&sampledAtMs>state.temporal.lastDetectorTimestampMs)state.temporal=updateContactEvidence(state.temporal,null,sampledAtMs);
    state.temporal=updateContactVisualInfluence(state.temporal,renderDtMs);
    let correction:ContactPoseCorrection|null=null;
    if(enabled&&this.profile&&this.rig&&state.observation&&state.temporal.visualInfluence>0&&(state.temporal.phase==="touch"||state.temporal.phase==="hold"||state.temporal.phase==="slide")){
      const anchor=mapContactAnchor(this.rig.surfaces[state.observation.region]);correction=solveContactPoseCorrection(this.profile,this.rig,side,anchor,state.observation.probe);
      if(correction.accepted)for(const[joint,rotation]of Object.entries(correction.rotations))jointRotations[joint]=qBlend(jointRotations[joint],rotation!,state.temporal.visualInfluence);
    }
    this.diagnostics[side]={side,phase:state.temporal.phase,region:state.observation?.region??state.temporal.region,probe:state.observation?.probe??null,confidence:state.observation?.confidence??0,depthRelation:state.observation?.depth.relation??"unknown",influence:state.temporal.visualInfluence,correctionReason:correction?.reason??"inactive",anchorError:correction?.anchorError??null,normalErrorDegrees:correction?correction.normalErrorRadians*180/Math.PI:null};
    void renderNowMs;
  }
}
