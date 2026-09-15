import type { UpperBodyRigProfileV1 } from "./upperBodyRigProfile";
import { semanticRotationToLocal, type UpperBodyLayer } from "./upperBodyComposer";

const radians=(degrees:number)=>degrees*Math.PI/180;
const clamp01=(value:number)=>Math.max(0,Math.min(1,Number.isFinite(value)?value:0));
const alpha=(dtMs:number,tauMs:number)=>1-Math.exp(-Math.max(0,dtMs)/Math.max(1,tauMs));

export interface LifeMotionInput { nowMs:number;documentVisible:boolean;mouthOpening:number;mouthClosure:number;mode:"faithful"|"cinematic";primaryMotionMagnitude:number;evidenceAvailable:boolean }
export interface LifeMotionSnapshot { continuousLifeTimeMs:number;breathing:number;speechChest:number;swayYaw:number;swayRoll:number }

export class UpperBodyLifeMotion {
  private continuousLifeTimeMs=0;private lastAtMs:number|null=null;private speech=0;private snapshotValue:LifeMotionSnapshot={continuousLifeTimeMs:0,breathing:0,speechChest:0,swayYaw:0,swayRoll:0};
  update(input:LifeMotionInput,profile:UpperBodyRigProfileV1):UpperBodyLayer{
    const dt=this.lastAtMs===null?0:input.nowMs-this.lastAtMs;this.lastAtMs=input.nowMs;
    if(input.documentVisible&&dt>=0&&dt<=250)this.continuousLifeTimeMs+=dt;
    const phase=2*Math.PI*this.continuousLifeTimeMs/4200;
    const breathing=.72*Math.sin(phase)+.18*Math.sin(2*phase+.4);
    const speechTarget=clamp01(input.mouthOpening*(1-input.mouthClosure));
    this.speech+=alpha(dt,speechTarget>this.speech?80:260)*(speechTarget-this.speech);
    const speechChest=clamp01(this.speech)*radians(.35);
    const cinematic=input.mode==="cinematic"&&input.evidenceAvailable&&input.primaryMotionMagnitude<radians(8);
    const swayYaw=cinematic?Math.sin(phase*.37+.8)*radians(.35):0;
    const swayRoll=cinematic?Math.sin(phase*.53+2.1)*radians(.4):0;
    const layer:UpperBodyLayer={};
    const amplitudes={chest:radians(.6),upperChest:radians(.8)} as const;
    for(const name of ["chest","upperChest"] as const){const joint=profile.joints[name];if(!joint)continue;const pitch=breathing*amplitudes[name]*(1+.35*this.speech)+(name==="chest"?speechChest:0);layer[name]=semanticRotationToLocal({x:pitch,y:swayYaw*(name==="chest"?.4:.6),z:swayRoll*(name==="chest"?.4:.6)},joint);}
    for(const name of ["leftShoulder","rightShoulder"] as const){const joint=profile.joints[name];if(joint)layer[name]=semanticRotationToLocal({x:0,y:0,z:(name==="leftShoulder"?1:-1)*breathing*radians(.25)},joint);}
    this.snapshotValue={continuousLifeTimeMs:this.continuousLifeTimeMs,breathing,speechChest,swayYaw,swayRoll};return layer;
  }
  snapshot():LifeMotionSnapshot{return {...this.snapshotValue};}
  reset():void{this.continuousLifeTimeMs=0;this.lastAtMs=null;this.speech=0;this.snapshotValue={continuousLifeTimeMs:0,breathing:0,speechChest:0,swayYaw:0,swayRoll:0};}
}
