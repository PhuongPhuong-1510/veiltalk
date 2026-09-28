import { Matrix4,Quaternion,Vector3 } from "three";
import type { QuaternionData,Vector3Data } from "./avatarPoseTypes";
import type { AvatarProbeProfile } from "./avatarContactRig";
import type { AvatarContactAnchor } from "./contactAnchorMapping";

const data=(v:Vector3):Vector3Data=>({x:v.x,y:v.y,z:v.z});
const qData=(q:Quaternion):QuaternionData=>({x:q.x,y:q.y,z:q.z,w:q.w});
export interface ContactWristTarget {wrist:Vector3Data;orientation:QuaternionData;probePoint:Vector3Data;normalErrorRadians:number}

/** Returns a desired WORLD hand orientation and the wrist point that places the rigid probe on the anchor. */
export function solveContactWristTarget(anchor:AvatarContactAnchor,probe:AvatarProbeProfile):ContactWristTarget|null{
  const targetNormal=new Vector3(-anchor.normal.x,-anchor.normal.y,-anchor.normal.z).normalize();
  const rawTangent=new Vector3(anchor.tangent.x,anchor.tangent.y,anchor.tangent.z);
  const targetTangent=rawTangent.clone().addScaledVector(targetNormal,-rawTangent.dot(targetNormal));
  if(targetNormal.lengthSq()<.99||targetTangent.lengthSq()<1e-8)return null;targetTangent.normalize();
  const targetBinormal=new Vector3().crossVectors(targetTangent,targetNormal).normalize();
  if(targetBinormal.lengthSq()<.99)return null;
  const targetFrame=new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(targetBinormal,targetTangent,targetNormal)).normalize();

  const localNormal=new Vector3(probe.contactNormal.x,probe.contactNormal.y,probe.contactNormal.z).normalize();
  let localTangent=new Vector3(probe.tangentHint.x,probe.tangentHint.y,probe.tangentHint.z);
  localTangent.addScaledVector(localNormal,-localTangent.dot(localNormal));
  if(localNormal.lengthSq()<.99||localTangent.lengthSq()<1e-8)return null;localTangent.normalize();
  const localBinormal=new Vector3().crossVectors(localTangent,localNormal).normalize();if(localBinormal.lengthSq()<.99)return null;
  const localFrame=new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(localBinormal,localTangent,localNormal)).normalize();

  const orientation=targetFrame.multiply(localFrame.invert()).normalize();
  const offset=new Vector3(probe.frameOffset.x,probe.frameOffset.y,probe.frameOffset.z).applyQuaternion(orientation);
  const target=new Vector3(anchor.point.x,anchor.point.y,anchor.point.z),wrist=target.clone().sub(offset),probePoint=wrist.clone().add(offset);
  const appliedNormal=localNormal.applyQuaternion(orientation);
  return{wrist:data(wrist),orientation:qData(orientation),probePoint:data(probePoint),normalErrorRadians:appliedNormal.angleTo(targetNormal)};
}
