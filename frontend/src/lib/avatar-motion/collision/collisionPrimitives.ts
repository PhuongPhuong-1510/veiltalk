import {Vector3} from "three";
import type {Vector3Data} from "../avatarPoseTypes";
import type {CapsuleCollider,ColliderOwner,GeometricContact,SphereCollider} from "./collisionTypes";

const EPS=1e-10,clamp01=(value:number)=>Math.max(0,Math.min(1,value));
const v=(p:Vector3Data)=>new Vector3(p.x,p.y,p.z),data=(p:Vector3):Vector3Data=>({x:p.x,y:p.y,z:p.z});
const fallbackNormal=(segment:Vector3)=>{const axis=segment.lengthSq()>EPS?segment.clone().normalize():new Vector3(1,0,0);const reference=Math.abs(axis.y)<.9?new Vector3(0,1,0):new Vector3(1,0,0);reference.addScaledVector(axis,-reference.dot(axis));return reference.lengthSq()>EPS?reference.normalize():new Vector3(0,0,1);};

export interface ContactMeta {pairKey:string;ownerA:ColliderOwner;ownerB:ColliderOwner}

export function closestPointsOnSegments(a0:Vector3,a1:Vector3,b0:Vector3,b1:Vector3){
  const d1=a1.clone().sub(a0),d2=b1.clone().sub(b0),r=a0.clone().sub(b0),a=d1.dot(d1),e=d2.dot(d2),f=d2.dot(r);let s=0,t=0;
  if(a<=EPS&&e<=EPS){s=0;t=0;}else if(a<=EPS){t=clamp01(f/e);}else{const c=d1.dot(r);if(e<=EPS){s=clamp01(-c/a);}else{const b=d1.dot(d2),denominator=a*e-b*b;s=Math.abs(denominator)>EPS?clamp01((b*f-c*e)/denominator):0;t=(b*s+f)/e;if(t<0){t=0;s=clamp01(-c/a);}else if(t>1){t=1;s=clamp01((b-c)/a);}}}
  return{pointA:a0.clone().addScaledVector(d1,s),pointB:b0.clone().addScaledVector(d2,t),parameterA:s,parameterB:t};
}

export function capsuleSphereContact(capsule:CapsuleCollider,sphere:SphereCollider,meta:ContactMeta):GeometricContact{
  const start=v(capsule.start),end=v(capsule.end),axis=end.clone().sub(start),center=v(sphere.center),parameterA=axis.lengthSq()>EPS?clamp01(center.clone().sub(start).dot(axis)/axis.lengthSq()):0;
  const axisPoint=start.clone().addScaledVector(axis,parameterA),delta=axisPoint.clone().sub(center),centerDistance=delta.length(),normal=centerDistance>1e-8?delta.multiplyScalar(1/centerDistance):fallbackNormal(axis),clearance=capsule.radius+sphere.radius,signedDistance=centerDistance-clearance,penetrationDepth=Math.max(0,-signedDistance);
  const pointA=axisPoint.clone().addScaledVector(normal,-capsule.radius),pointB=center.clone().addScaledVector(normal,sphere.radius),valid=[signedDistance,penetrationDepth,normal.x,normal.y,normal.z].every(Number.isFinite);
  return{...meta,pointA:data(pointA),pointB:data(pointB),normalBToA:data(normal),signedDistance,penetrationDepth,normalizedPenetration:penetrationDepth/Math.max(1e-8,clearance),parameterA,parameterB:null,valid};
}

export function capsuleCapsuleContact(first:CapsuleCollider,second:CapsuleCollider,meta:ContactMeta):GeometricContact{
  const a0=v(first.start),a1=v(first.end),b0=v(second.start),b1=v(second.end),closest=closestPointsOnSegments(a0,a1,b0,b1),delta=closest.pointA.clone().sub(closest.pointB),centerDistance=delta.length(),firstAxis=a1.clone().sub(a0),secondAxis=b1.clone().sub(b0);
  const normal=centerDistance>1e-8?delta.multiplyScalar(1/centerDistance):fallbackNormal(firstAxis.lengthSq()>=secondAxis.lengthSq()?firstAxis:secondAxis),clearance=first.radius+second.radius,signedDistance=centerDistance-clearance,penetrationDepth=Math.max(0,-signedDistance);
  const pointA=closest.pointA.clone().addScaledVector(normal,-first.radius),pointB=closest.pointB.clone().addScaledVector(normal,second.radius),valid=[signedDistance,penetrationDepth,normal.x,normal.y,normal.z].every(Number.isFinite);
  return{...meta,pointA:data(pointA),pointB:data(pointB),normalBToA:data(normal),signedDistance,penetrationDepth,normalizedPenetration:penetrationDepth/Math.max(1e-8,clearance),parameterA:closest.parameterA,parameterB:closest.parameterB,valid};
}
