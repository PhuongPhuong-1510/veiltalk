import { Vector3 } from "three";
import type { RawTrackingFrameV1 } from "../tracking/rawTrackingTypes";
import { buildTorsoBasis } from "./torsoBasis";
import { subtract } from "./coordinateAdapter";
import type { BodyDepthSide } from "./bodyLocalDepth";

export interface ObservedBodyDepth {version:1;sampledAtMs:number;left:{head:BodyDepthSide|null;torso:BodyDepthSide|null};right:{head:BodyDepthSide|null;torso:BodyDepthSide|null};interArm:BodyDepthSide|null}
/** Fresh, genuinely observed Pose ordering, before retarget/constraints/collision. No metric-depth claim. */
export function observeBodyDepth(frame:RawTrackingFrameV1,now:number):ObservedBodyDepth|undefined{
  const points=frame.pose.worldLandmarks,image=frame.pose.landmarks,at=frame.pose.sampledAtMs;
  if(!points||!image||frame.pose.state!=="tracked"||at===null||!Number.isFinite(at)||now<at||now-at>150)return undefined;
  const valid=(id:number)=>Boolean(points[id]&&image[id]&&(image[id].visibility??0)>=.65&&[points[id].x,points[id].y,points[id].z].every(Number.isFinite));
  if(![11,12,23,24].every(valid))return undefined;
  const basis=buildTorsoBasis(points,.65);if(!basis)return undefined;
  const forward=new Vector3(basis.forward.x,basis.forward.y,basis.forward.z),width=new Vector3().copy(subtract(points[11],points[12])).length();
  if(!Number.isFinite(width)||width<1e-5)return undefined;
  const shoulder={...points[11],x:(points[11].x+points[12].x)/2,y:(points[11].y+points[12].y)/2,z:(points[11].z+points[12].z)/2};
  const head=[7,8].every(valid)?{...points[7],x:(points[7].x+points[8].x)/2,y:(points[7].y+points[8].y)/2,z:(points[7].z+points[8].z)/2}:null;
  const sign=(delta:number):BodyDepthSide|null=>Math.abs(delta)>width*.08?(delta>0?1:-1):null;
  const side=(wrist:number)=>({head:valid(wrist)&&head?sign(new Vector3().copy(subtract(points[wrist],head)).dot(forward)):null,torso:valid(wrist)?sign(new Vector3().copy(subtract(points[wrist],shoulder)).dot(forward)):null});
  return{version:1,sampledAtMs:at,left:side(15),right:side(16),interArm:[15,16].every(valid)?sign(new Vector3().copy(subtract(points[15],points[16])).dot(forward)):null};
}
