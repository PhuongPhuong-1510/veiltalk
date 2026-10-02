import { Object3D, Quaternion, Vector3 } from "three";
import type { FingerChainRig } from "../avatar-motion/fingerRig";
import type { QuaternionData } from "../avatar-motion/avatarPoseTypes";
import { DEFAULT_AVATAR_MOTION_CONFIG } from "../avatar-motion/motionConfig";

/** Tiny flex-only search around this packet's observed pose. Never moves arm/wrist or bone positions. */
export function refineIndexFace(input:{owned:boolean;fresh:boolean;dt:number;faceHeight:number;influence:number;chain:FingerChainRig;bones:Partial<Record<string,Object3D>>;baseline:Partial<Record<string,QuaternionData>>;rest?:Partial<Record<string,QuaternionData>>;probe:()=>{point:Vector3;normal:Vector3}|null;target:()=>{point:Vector3;normal:Vector3}|null;sync:()=>void}) {
  const changed:string[]=[];
  if(!input.owned||!input.fresh||!Number.isFinite(input.dt)||input.dt<=0||!(input.faceHeight>0)||!(input.influence>0)||input.chain.truncatedAtSegment!==null||input.chain.segments.length!==3)return changed;
  input.sync();const target=input.target(),before=input.probe();if(!target||!before||before.point.distanceTo(target.point)>input.faceHeight*.12)return changed;
  const measure=()=>{const p=input.probe(),t=input.target();if(!p||!t)return null;return{gap:p.point.distanceTo(t.point),normal:p.normal.angleTo(t.normal.clone().negate()),penetration:Math.max(0,-p.point.clone().sub(t.point).dot(t.normal))};};
  const initial=measure();if(!initial)return changed;
  const originals=new Map<Object3D,Quaternion>(),step=Math.min(.05,input.dt)*.35*Math.min(1,input.influence);
  for(const s of [...input.chain.segments].reverse()){
    const bone=input.bones[s.joint],base=input.baseline[s.joint];if(!bone||!base)continue;
    originals.set(bone,bone.quaternion.clone());const start=bone.quaternion.clone(),reference=new Quaternion(base.x,base.y,base.z,base.w);
    const axis=new Vector3(s.flexAxisLocal.x,s.flexAxisLocal.y,s.flexAxisLocal.z);if(axis.lengthSq()<.99)continue;
    const initialJoint=measure();if(!initialJoint)continue;let best=start,bestGap=initialJoint.gap;
    for(const sign of [-1,1]){
      const candidate=start.clone().multiply(new Quaternion().setFromAxisAngle(axis,step*sign)).normalize();
      if(reference.angleTo(candidate)>6*Math.PI/180)continue;
      const rest=input.rest?.[s.joint];if(rest){const index=input.chain.segments.indexOf(s),limits=DEFAULT_AVATAR_MOTION_CONFIG.continuousFinger.humanObservationLimits,limit=index===0?limits.mcp:index===1?limits.pip:limits.dip;
        const error=(q:Quaternion)=>{const d=new Quaternion(rest.x,rest.y,rest.z,rest.w).invert().multiply(q),raw=2*Math.atan2(d.x*axis.x+d.y*axis.y+d.z*axis.z,d.w),angle=Math.atan2(Math.sin(raw),Math.cos(raw));return Math.max(0,limit.min-angle,angle-limit.max);};
        if(error(candidate)>error(start)+1e-6)continue;
      }
      bone.quaternion.copy(candidate);input.sync();const m=measure();
      if(m&&Number.isFinite(m.gap)&&m.gap<bestGap-1e-8&&m.normal<=initial.normal+.01&&m.penetration<=initial.penetration+input.faceHeight*.001){best=candidate;bestGap=m.gap;}
    }
    bone.quaternion.copy(best);input.sync();if(start.angleTo(best)>1e-8)changed.push(s.joint);
  }
  const after=measure();
  if(!after||!Number.isFinite(after.gap)||after.gap>=initial.gap-1e-8||after.normal>initial.normal+.01||after.penetration>initial.penetration+input.faceHeight*.001){for(const[b,q]of originals)b.quaternion.copy(q);input.sync();return [];}
  return changed;
}
