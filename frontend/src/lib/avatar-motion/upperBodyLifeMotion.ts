import type { UpperBodyRigProfileV1 } from "./upperBodyRigProfile";
import { semanticRotationToLocal, type UpperBodyLayer } from "./upperBodyComposer";

const radians=(degrees:number)=>degrees*Math.PI/180;
const clamp01=(value:number)=>Math.max(0,Math.min(1,Number.isFinite(value)?value:0));
const alpha=(dtMs:number,tauMs:number)=>1-Math.exp(-Math.max(0,dtMs)/Math.max(1,tauMs));
const LIFE_MOTION_GAIN=.5;
const SWAY_CYCLE_MS=6000;

export interface LifeMotionInput { nowMs:number;documentVisible:boolean;mouthOpening:number;mouthClosure:number;mode:"faithful"|"cinematic";primaryMotionMagnitude:number;evidenceAvailable:boolean }
export interface LifeMotionSnapshot { continuousLifeTimeMs:number;speechChest:number;swayYaw:number;swayRoll:number }

export class UpperBodyLifeMotion {
  private continuousLifeTimeMs=0;private lastAtMs:number|null=null;private speech=0;private snapshotValue:LifeMotionSnapshot={continuousLifeTimeMs:0,speechChest:0,swayYaw:0,swayRoll:0};
  update(input:LifeMotionInput,profile:UpperBodyRigProfileV1):UpperBodyLayer{
    const dt=this.lastAtMs===null?0:input.nowMs-this.lastAtMs;this.lastAtMs=input.nowMs;
    if(input.documentVisible&&dt>=0&&dt<=250)this.continuousLifeTimeMs+=dt;
    const phase=2*Math.PI*this.continuousLifeTimeMs/SWAY_CYCLE_MS;
    const speechTarget=clamp01(input.mouthOpening*(1-input.mouthClosure));
    this.speech+=alpha(dt,speechTarget>this.speech?80:260)*(speechTarget-this.speech);
    const speechChest=clamp01(this.speech)*radians(.35)*LIFE_MOTION_GAIN;
    const cinematic=input.mode==="cinematic"&&input.evidenceAvailable&&input.primaryMotionMagnitude<radians(8);
    const swayYaw=cinematic?Math.sin(phase*.37+.8)*radians(.35)*LIFE_MOTION_GAIN:0;
    const swayRoll=cinematic?Math.sin(phase*.53+2.1)*radians(.4)*LIFE_MOTION_GAIN:0;
    const layer:UpperBodyLayer={};
    for(const name of ["chest","upperChest"] as const){const joint=profile.joints[name];if(!joint)continue;const pitch=name==="chest"?speechChest:0;layer[name]=semanticRotationToLocal({x:pitch,y:swayYaw*(name==="chest"?.4:.6),z:swayRoll*(name==="chest"?.4:.6)},joint);}
    this.snapshotValue={continuousLifeTimeMs:this.continuousLifeTimeMs,speechChest,swayYaw,swayRoll};return layer;
  }
  snapshot():LifeMotionSnapshot{return {...this.snapshotValue};}
  reset():void{this.continuousLifeTimeMs=0;this.lastAtMs=null;this.speech=0;this.snapshotValue={continuousLifeTimeMs:0,speechChest:0,swayYaw:0,swayRoll:0};}
}
