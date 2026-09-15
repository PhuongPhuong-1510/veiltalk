import { Quaternion,Vector3 } from "three";
import { describe,expect,it } from "vitest";
import { TorsoObservationTransition,TorsoRelativeSourceSelector,UpperBodyQuaternionTemporal,UpperBodyScalarTemporal,UpperBodySourceTransition } from "./upperBodyTemporal";
const q=(angle:number)=>{const v=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),angle);return{x:v.x,y:v.y,z:v.z,w:v.w};};
const config={filter:{minCutoff:1,beta:0,derivativeCutoff:1},maximumTimestampGapMs:500,holdMs:100,returnMs:200,reacquireMs:100};
describe("AR4 temporal/lifecycle",()=>{
  it("classifies duplicate/reversed timestamps and assigns exact identity at terminal return",()=>{
    const temporal=new UpperBodyQuaternionTemporal(config);expect(temporal.update(q(.5),10,10,false).sampleDisposition).toBe("new");
    expect(temporal.update(q(.7),10,20,false).sampleDisposition).toBe("duplicate");expect(temporal.update(q(.7),9,30,false).sampleDisposition).toBe("reversed");
    expect(temporal.update(null,null,111,false).state).toBe("returning");
    expect(temporal.update(null,null,310,false)).toMatchObject({rotation:{x:0,y:0,z:0,w:1},state:"idle",progress:1});
  });
  it("uses enter/exit hysteresis and dwell instead of flapping",()=>{
    const selector=new TorsoRelativeSourceSelector(60,90,180);
    expect(selector.update(0,0,0)).toBe("torso-relative");expect(selector.update(70,0,70)).toBe("torso-relative");
    expect(selector.update(181,0,181)).toBe("face-only");expect(selector.update(190,190,190)).toBe("face-only");expect(selector.update(370,370,370)).toBe("torso-relative");
  });
  it("blends a source change without restarting the transition on every sample",()=>{
    const transition=new UpperBodySourceTransition();transition.update("face-only",q(0),0);const start=transition.update("torso-relative",q(1),100);expect(new Quaternion(start.x,start.y,start.z,start.w).angleTo(new Quaternion())).toBeCloseTo(0);
    const middle=transition.update("torso-relative",q(1),190);expect(new Quaternion(middle.x,middle.y,middle.z,middle.w).angleTo(new Quaternion())).toBeCloseTo(.5,1);
    const done=transition.update("torso-relative",q(1),280);expect(new Quaternion(done.x,done.y,done.z,done.w).angleTo(new Quaternion())).toBeCloseTo(1,5);
  });
  it("blends full-torso loss into shoulder-only without snapping",()=>{
    const transition=new TorsoObservationTransition();transition.update("shoulder-only",q(.2),0);transition.update("full-torso",q(.4),100);transition.update("full-torso",q(.4),320);
    const start=transition.update("shoulder-only",q(.1),400);const middle=transition.update("shoulder-only",q(.1),510);const end=transition.update("shoulder-only",q(.1),620);
    const angle=(value:ReturnType<typeof q>)=>new Quaternion(value.x,value.y,value.z,value.w).angleTo(new Quaternion());
    expect(angle(start)).toBeCloseTo(.4,5);expect(angle(middle)).toBeGreaterThan(.1);expect(angle(middle)).toBeLessThan(.4);expect(angle(end)).toBeCloseTo(.1,5);
  });
  it("keeps scalar state on duplicate samples, then holds and returns exactly to zero",()=>{
    const temporal=new UpperBodyScalarTemporal({maximumTimestampGapMs:500,attackMs:85,releaseMs:180,holdMs:120,returnMs:250,reacquireMs:100});
    expect(temporal.update(.8,100,100,false).value).toBeCloseTo(.8);
    expect(temporal.update(.2,100,150,false)).toMatchObject({value:.8,sampleDisposition:"duplicate"});
    expect(temporal.update(null,null,220,false)).toMatchObject({value:.8,state:"held"});expect(temporal.update(null,null,345,false).value).toBeLessThan(.8);
    expect(temporal.update(null,null,471,false)).toMatchObject({value:0,state:"idle"});
  });
});
