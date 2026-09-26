import { Matrix4,Quaternion,Vector3 } from "three";
import type { QuaternionData,Vector3Data } from "./avatarPoseTypes";
import type { AvatarProbeProfile } from "./avatarContactRig";
import type { AvatarContactAnchor } from "./contactAnchorMapping";

const data=(v:Vector3):Vector3Data=>({x:v.x,y:v.y,z:v.z});
const qData=(q:Quaternion):QuaternionData=>({x:q.x,y:q.y,z:q.z,w:q.w});
export interface ContactWristTarget {wrist:Vector3Data;orientation:QuaternionData;probePoint:Vector3Data;normalErrorRadians:number}

export function solveContactWristTarget(anchor:AvatarContactAnchor,probe:AvatarProbeProfile):ContactWristTarget|null{
  const targetNormal=new Vector3(-anchor.normal.x,-anchor.normal.y,-anchor.normal.z).normalize();
  const targetTangent=new Vector3(anchor.tangent.x,anchor.tangent.y,anchor.tangent.z).addScaledVector(targetNormal,-new Vector3(anchor.tangent.x,anchor.tangent.y,anchor.tangent.z).dot(targetNormal)).normalize();
  if(targetNormal.lengthSq()<.99||targetTangent.lengthSq()<.99)return null;
  const targetBinormal=new Vector3().crossVectors(targetTangent,targetNormal).normalize();
  const targetFrame=new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(targetBinormal,targetTangent,targetNormal)).normalize();
  const localNormal=new Vector3(probe.contactNormal.x,probe.contactNormal.y,probe.contactNormal.z).normalize(),localTangent=new Vector3(probe.tangentHint.x,probe.tangentHint.y,probe.tangentHint.z).normalize();
  const localBinormal=new Vector3().crossVectors(localTangent,localNormal).normalize();if(localBinormal.lengthSq()<.99)return null;
  const localFrame=new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(localBinormal,localTangent,localNormal)).normalize();
  const orientation=targetFrame.multiply(localFrame.invert()).normalize();
  const offset=new Vector3(probe.frameOffset.x,probe.frameOffset.y,probe.frameOffset.z).applyQuaternion(orientation);
  const target=new Vector3(anchor.point.x,anchor.point.y,anchor.point.z),wrist=target.clone().sub(offset),probePoint=wrist.clone().add(offset);
  const appliedNormal=localNormal.applyQuaternion(orientation);
  return{wrist:data(wrist),orientation:qData(orientation),probePoint:data(probePoint),normalErrorRadians:appliedNormal.angleTo(targetNormal)};
}
