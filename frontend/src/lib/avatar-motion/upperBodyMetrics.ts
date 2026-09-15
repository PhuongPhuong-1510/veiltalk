import type { QuaternionData,Vector3Data } from "./avatarPoseTypes";
import { angularDeltaDegrees } from "./motionMath";

export interface MotionJitterMetric { rawStandardDeviationDeg:number;finalStandardDeviationDeg:number;reductionRatio:number|null;freshSamples:number }
export interface UpperBodyMetricSnapshot { samples:number;invalidOutputs:number;aggregateClampCount:number;solverAverageMs:number;solverP95Ms:number;head:MotionJitterMetric;torso:MotionJitterMetric }
interface MotionSeries {lastSampledAtMs:number|null;lastRaw:QuaternionData|null;lastFinal:QuaternionData|null;raw:number[];final:number[]}
const series=():MotionSeries=>({lastSampledAtMs:null,lastRaw:null,lastFinal:null,raw:[],final:[]});
const standardDeviation=(values:number[])=>{if(values.length<2)return 0;const mean=values.reduce((a,b)=>a+b,0)/values.length;return Math.sqrt(values.reduce((sum,value)=>sum+(value-mean)**2,0)/values.length);};
const summarize=(value:MotionSeries):MotionJitterMetric=>{const raw=standardDeviation(value.raw),final=standardDeviation(value.final);return{rawStandardDeviationDeg:raw,finalStandardDeviationDeg:final,reductionRatio:raw>1e-8?1-final/raw:null,freshSamples:value.final.length};};
export class UpperBodyMetricsCollector {
  private samples=0;private invalidOutputs=0;private aggregateClampCount=0;private durations:number[]=[];
  private motion:Record<"head"|"torso",MotionSeries>={head:series(),torso:series()};
  record(durationMs:number,invalid:boolean,aggregateClampCount:number):void{this.samples+=1;if(invalid)this.invalidOutputs+=1;this.aggregateClampCount+=aggregateClampCount;if(Number.isFinite(durationMs)){this.durations.push(Math.max(0,durationMs));if(this.durations.length>600)this.durations.shift();}}
  recordMotion(name:"head"|"torso",raw:QuaternionData|null,final:QuaternionData|null,sampledAtMs:number|null):void{const value=this.motion[name];if(!raw||!final||sampledAtMs===null||sampledAtMs<= (value.lastSampledAtMs??-Infinity))return;if(value.lastRaw&&value.lastFinal){value.raw.push(angularDeltaDegrees(value.lastRaw,raw));value.final.push(angularDeltaDegrees(value.lastFinal,final));if(value.raw.length>600)value.raw.shift();if(value.final.length>600)value.final.shift();}value.lastRaw=raw;value.lastFinal=final;value.lastSampledAtMs=sampledAtMs;}
  snapshot():UpperBodyMetricSnapshot{const sorted=[...this.durations].sort((a,b)=>a-b);const total=sorted.reduce((a,b)=>a+b,0);return{samples:this.samples,invalidOutputs:this.invalidOutputs,aggregateClampCount:this.aggregateClampCount,solverAverageMs:sorted.length?total/sorted.length:0,solverP95Ms:sorted.length?sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))]:0,head:summarize(this.motion.head),torso:summarize(this.motion.torso)};}
  reset():void{this.samples=0;this.invalidOutputs=0;this.aggregateClampCount=0;this.durations=[];this.motion={head:series(),torso:series()};}
}

export interface StepResponseSample {timestampMs:number;rotation:Vector3Data}
export function measureStepResponse(samples:readonly StepResponseSample[],axis:Vector3Data,targetMagnitude:number,startMs:number):{t50Ms:number|null;t90Ms:number|null}{
  const axisLength=Math.hypot(axis.x,axis.y,axis.z);if(axisLength<=1e-8||!Number.isFinite(targetMagnitude)||Math.abs(targetMagnitude)<=1e-8)return{t50Ms:null,t90Ms:null};
  const sign=Math.sign(targetMagnitude),unit={x:axis.x/axisLength,y:axis.y/axisLength,z:axis.z/axisLength};let t50Ms:number|null=null,t90Ms:number|null=null;
  for(const sample of samples){if(sample.timestampMs<startMs)continue;const projected=sign*(sample.rotation.x*unit.x+sample.rotation.y*unit.y+sample.rotation.z*unit.z);const ratio=projected/Math.abs(targetMagnitude);if(t50Ms===null&&ratio>=.5)t50Ms=sample.timestampMs-startMs;if(t90Ms===null&&ratio>=.9){t90Ms=sample.timestampMs-startMs;break;}}
  return{t50Ms,t90Ms};
}
