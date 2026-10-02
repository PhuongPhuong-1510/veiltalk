import { Object3D, Quaternion, Vector3,Line3 } from "three";
import type {AvatarCollisionProfile} from "./avatarCollisionProfile";
import type { AvatarFingerName,AvatarFingerJointName,QuaternionData } from "./avatarPoseTypes";
import type { FingerRigProfile,FingerChainRig } from "./fingerRig";
import type { FingertipContactIntent } from "./fingertipContactEvidence";

export interface FingertipProbe {bone:Object3D;offsetLocal:Vector3;source:"end-node"|"estimated-distal"}
export interface FingertipContactDiagnostic {applied:boolean;reason:string;pairs:Array<{left:AvatarFingerName;right:AvatarFingerName;before:number;after:number;leftProbe:string;rightProbe:string}>;changedJoints:AvatarFingerJointName[]}
export type FingerBoneMap=Partial<Record<AvatarFingerJointName,Object3D>>;
const finite=(v:Vector3)=>v.toArray().every(Number.isFinite);

/** VRM does not declare tips. Prefer a real end node; explicitly label a bounded bone-based estimate. */
export function buildFingertipProbe(chain:FingerChainRig,bones:FingerBoneMap,geometryBones:FingerBoneMap=bones):FingertipProbe|null{
  if(chain.truncatedAtSegment!==null||chain.segments.length!==3)return null;
  const control=bones[chain.segments[2].joint],distal=geometryBones[chain.segments[2].joint],previous=geometryBones[chain.segments[1].joint];if(!control||!distal||!previous)return null;
  const origin=distal.getWorldPosition(new Vector3()),last=origin.clone().sub(previous.getWorldPosition(new Vector3()));
  if(!finite(last)||last.length()<1e-5)return null;
  const child=distal.children.find(c=>/tip|end/i.test(c.name)&&c.getWorldPosition(new Vector3()).distanceTo(origin)>1e-5);
  const end=child?child.getWorldPosition(new Vector3()):origin.clone().addScaledVector(last,.65);
  if(end.distanceTo(origin)>last.length()*1.5)return null;
  return{bone:control,offsetLocal:control.worldToLocal(end.clone()),source:child?"end-node":"estimated-distal"};
}
export const fingertipPosition=(p:FingertipProbe)=>p.bone.localToWorld(p.offsetLocal.clone());
export function fingertipBodyScore(probes:Iterable<FingertipProbe>,profile:AvatarCollisionProfile,palmWidth:number):number{
  const vector=(p:{x:number;y:number;z:number})=>new Vector3(p.x,p.y,p.z),radius=palmWidth*.035;let score=0;
  for(const probe of probes){const point=fingertipPosition(probe);if(!finite(point))return Infinity;
    for(const sphere of [profile.body.head,profile.body.chestLeft,profile.body.chestRight])if(sphere)score+=Math.max(0,sphere.radius+radius-point.distanceTo(vector(sphere.center)))**2;
    for(const capsule of [profile.body.neck,profile.body.torso]){const closest=new Line3(vector(capsule.start),vector(capsule.end)).closestPointToPoint(point,true,new Vector3());score+=Math.max(0,capsule.radius+radius-point.distanceTo(closest))**2;}
  }return score;
}

/** Bounded hinge/abduction coordinate search. Arms and wrist quaternions are never written. */
export function correctFingertipContacts(input:{rig:FingerRigProfile;bones:FingerBoneMap;probes:Map<string,FingertipProbe>;intent:FingertipContactIntent|undefined;baseline:Partial<Record<AvatarFingerJointName,QuaternionData>>;palmWidth:number;deltaSeconds:number;sampleAgeMs:number;clearanceScore?:()=>number}):FingertipContactDiagnostic{
  const out:FingertipContactDiagnostic={applied:false,reason:"inactive",pairs:[],changedJoints:[]};
  const {intent,rig,bones,probes,palmWidth}=input;
  if(!intent||intent.version!==1||!Number.isFinite(input.sampleAgeMs)||input.sampleAgeMs<0||input.sampleAgeMs>200||!Number.isFinite(palmWidth)||palmWidth<=1e-5)return out;
  const dt=Math.max(0,Math.min(.05,input.deltaSeconds));if(!Number.isFinite(dt)||dt===0)return out;
  const changed=new Set<AvatarFingerJointName>();
  for(const pair of intent.pairs.slice(0,2)){
    if(!Number.isFinite(pair.influence)||pair.influence<=0)continue;
    const lp=probes.get("left:"+pair.left),rp=probes.get("right:"+pair.right);
    const lc=rig.left.chains.find(c=>c.finger===pair.left),rc=rig.right.chains.find(c=>c.finger===pair.right);
    if(!lp||!rp||!lc||!rc)continue;
    const a=fingertipPosition(lp),b=fingertipPosition(rp),before=a.distanceTo(b);
    // 2D overlap alone must never attract distant hands in model space.
    if(!finite(a)||!finite(b)||before>palmWidth*.6||before<palmWidth*.025)continue;
    const clearanceBefore=input.clearanceScore?.()??0;
    const original=new Map<Object3D,Quaternion>();for(const c of [lc,rc])for(const s of c.segments){const bone=bones[s.joint];if(bone)original.set(bone,bone.quaternion.clone());}
    const gain=Math.min(.35,pair.influence),targetA=a.clone().lerp(b,gain*.5),targetB=b.clone().lerp(a,gain*.5);
    for(const[chain,probe,target]of [[lc,lp,targetA],[rc,rp,targetB]] as const){
      for(const segment of [...chain.segments].reverse()){
        const bone=bones[segment.joint],base=input.baseline[segment.joint];if(!bone||!base)continue;
        const reference=new Quaternion(base.x,base.y,base.z,base.w).normalize();
        for(const axisData of [segment.flexAxisLocal]){
          if(!axisData)continue;const axis=new Vector3(axisData.x,axisData.y,axisData.z);if(!finite(axis)||axis.lengthSq()<1e-8)continue;axis.normalize();
          const start=bone.quaternion.clone(),error=fingertipPosition(probe).distanceToSquared(target);let best=start,bestError=error;
          for(const sign of [-1,1]){
            const candidate=start.clone().multiply(new Quaternion().setFromAxisAngle(axis,sign*dt*1.5)).normalize();
            if(reference.angleTo(candidate)>20*Math.PI/180)continue;
            const window=intent.flexionWindows?.[segment.joint];
            if(window){const delta=reference.clone().invert().multiply(candidate),signed=2*Math.atan2(delta.x*axis.x+delta.y*axis.y+delta.z*axis.z,delta.w),angle=Math.atan2(Math.sin(signed),Math.cos(signed));if(![window.min,window.max,angle].every(Number.isFinite)||angle<window.min||angle>window.max)continue;}
            bone.quaternion.copy(candidate);bone.updateWorldMatrix(false,true);
            const next=fingertipPosition(probe).distanceToSquared(target);if(Number.isFinite(next)&&next<bestError-1e-12){best=candidate;bestError=next;}
          }
          bone.quaternion.copy(best);bone.updateWorldMatrix(false,true);
        }
      }
    }
    const after=fingertipPosition(lp).distanceTo(fingertipPosition(rp));
    const clearanceAfter=input.clearanceScore?.()??0;
    if(!Number.isFinite(after)||after>=before-1e-8||!Number.isFinite(clearanceAfter)||clearanceAfter>clearanceBefore+1e-10){for(const[bone,q]of original){bone.quaternion.copy(q);bone.updateWorldMatrix(false,true);}continue;}
    for(const c of [lc,rc])for(const s of c.segments){const bone=bones[s.joint];if(bone&&original.get(bone)!.angleTo(bone.quaternion)>1e-8)changed.add(s.joint);}
    out.pairs.push({left:pair.left,right:pair.right,before,after,leftProbe:lp.source,rightProbe:rp.source});
  }
  out.changedJoints=[...changed];out.applied=changed.size>0;out.reason=out.applied?"bounded-fingertip-assist":"no-admissible-improvement";return out;
}
