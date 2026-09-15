import { Quaternion,Vector3 } from "three";
import { describe,expect,it } from "vitest";
import { measureStepResponse,UpperBodyMetricsCollector } from "./upperBodyMetrics";
const q=(angle:number)=>{const value=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),angle);return{x:value.x,y:value.y,z:value.z,w:value.w};};
describe("AR4 upper-body metrics",()=>{
  it("records only fresh timestamps and reports raw/final jitter reduction",()=>{
    const metrics=new UpperBodyMetricsCollector();const raw=[0,.1,-.05,.08,0],filtered=[0,.02,-.01,.015,0];for(let index=0;index<raw.length;index+=1){metrics.recordMotion("head",q(raw[index]),q(filtered[index]),index*10);metrics.recordMotion("head",q(1),q(1),index*10);}
    const result=metrics.snapshot().head;expect(result.freshSamples).toBe(4);expect(result.finalStandardDeviationDeg).toBeLessThan(result.rawStandardDeviationDeg);expect(result.reductionRatio).toBeGreaterThan(.3);
  });
  it("measures t50/t90 from the first fresh projection crossing",()=>{
    expect(measureStepResponse([{timestampMs:100,rotation:{x:0,y:0,z:0}},{timestampMs:180,rotation:{x:0,y:.55,z:0}},{timestampMs:260,rotation:{x:0,y:.91,z:0}}],{x:0,y:1,z:0},1,100)).toEqual({t50Ms:80,t90Ms:160});
  });
});
