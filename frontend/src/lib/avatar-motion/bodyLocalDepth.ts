import { Vector3 } from "three";
import type { Vector3Data } from "./avatarPoseTypes";

const v=(p:Vector3Data)=>new Vector3(p.x,p.y,p.z);
export type BodyDepthSide = -1|1;
/** Recent observed ordering in the posed body's forward frame, not global camera Z. */
export class BodyLocalDepthMemory {
  private last: {side:BodyDepthSide;at:number}|null=null;
  private lastObservationKey:number|null=null;
  reset():void {this.last=null;this.lastObservationKey=null;}
  update(point:Vector3Data,center:Vector3Data,forward:Vector3Data,radius:number,at:number,observed:boolean,observationKey?:number|null):BodyDepthSide|null {
    if(!Number.isFinite(at)||!(radius>0)||![...v(point).toArray(),...v(center).toArray(),...v(forward).toArray()].every(Number.isFinite)||v(forward).length()<1e-6)return null;
    if(this.last&&(at<this.last.at||at-this.last.at>600))this.last=null;
    const newObservation=observationKey===undefined||observationKey!==null&&observationKey!==this.lastObservationKey;
    if(observed&&newObservation&&observationKey!==undefined)this.lastObservationKey=observationKey;
    const z=v(point).sub(v(center)).dot(v(forward).normalize());
    if(observed&&newObservation&&Math.abs(z)>radius*.2)this.last={side:z>0?1:-1,at};
    // Held/reconstructed targets may use a recent side, but cannot renew its lifetime.
    return this.last?.side??null;
  }
}

/** Only redirects a penetrating correction; it never attracts a separated hand to a body. */
export function bodyLocalOutwardNormal(raw:Vector3Data,forward:Vector3Data,side:BodyDepthSide|null):Vector3Data {
  const n=v(raw),f=v(forward);
  if(side===null||n.length()<1e-6||f.length()<1e-6)return raw;
  n.normalize();f.normalize().multiplyScalar(side);
  if(n.dot(f)>=.35)return raw;
  // Keep lateral clearance while preventing correction through the opposite body hemisphere.
  const lateral=n.clone().addScaledVector(f,-n.dot(f));
  const corrected=lateral.multiplyScalar(.35).addScaledVector(f,.65).normalize();
  return {x:corrected.x,y:corrected.y,z:corrected.z};
}
