import { describe,expect,it } from "vitest";
import { UpperBodyNeutralCalibrator } from "./upperBodyCalibration";
import { Quaternion,Vector3 } from "three";
const identity={x:0,y:0,z:0,w:1};
const sample=(skew=0)=>({faceRotation:identity,shoulderRotation:identity,fullTorsoRotation:identity,faceSampledAtMs:100,poseSampledAtMs:100+skew,faceQuality:1,shoulderQuality:1,fullTorsoQuality:1});
const q=(yaw:number)=>{const value=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),yaw);return{x:value.x,y:value.y,z:value.z,w:value.w};};
describe("AR4 paired upper-body calibration",()=>{
  it.each([[49,true],[50,true],[51,false]] as const)("gates face/pose skew %dms",(skew,accepted)=>{
    const calibration=new UpperBodyNeutralCalibrator(1,50,.5);calibration.begin("model");
    expect(calibration.process(sample(skew))).toBe(accepted);
    expect(calibration.snapshot().state).toBe(accepted?"calibrated":"collecting");
  });
  it("does not consume either member of a pair twice and resets on model change",()=>{
    const calibration=new UpperBodyNeutralCalibrator(2);calibration.begin("a");const input=sample();
    expect(calibration.process(input)).toBe(true);expect(calibration.process({...input,faceSampledAtMs:101})).toBe(false);expect(calibration.snapshot().acceptedPairs).toBe(1);
    calibration.setModelFingerprint("b");expect(calibration.snapshot()).toMatchObject({state:"idle",acceptedPairs:0,modelFingerprint:"b"});
  });
  it("calibrates shoulder-only when hips are unavailable",()=>{
    const calibration=new UpperBodyNeutralCalibrator(2);calibration.begin("model");
    expect(calibration.process({...sample(),fullTorsoRotation:null,fullTorsoQuality:0})).toBe(true);
    expect(calibration.process({...sample(),faceSampledAtMs:133,poseSampledAtMs:133,fullTorsoRotation:null,fullTorsoQuality:0})).toBe(true);
    expect(calibration.snapshot()).toMatchObject({state:"calibrated",mode:"shoulder-only",acceptedPairs:2,acceptedFullTorsoPairs:0});
  });
  it("corrects Pose yaw before subtracting it from Face head motion",()=>{
    const calibration=new UpperBodyNeutralCalibrator(1);calibration.begin("model");expect(calibration.process(sample())).toBe(true);
    const together=calibration.headRelative(q(.3),q(-.3));
    expect(together?.y).toBeCloseTo(0,5);expect(together?.w).toBeCloseTo(1,5);
    expect(calibration.fullTorsoDelta(q(-.3))?.y).toBeGreaterThan(0);
  });
  it("selects full-torso only when hips are reliable for at least eighty percent of calibration",()=>{
    const calibration=new UpperBodyNeutralCalibrator(5);calibration.begin("model");
    for(let index=0;index<5;index+=1)expect(calibration.process({...sample(),faceSampledAtMs:100+index,poseSampledAtMs:100+index,fullTorsoRotation:index<4?identity:null,fullTorsoQuality:index<4?1:0})).toBe(true);
    expect(calibration.snapshot()).toMatchObject({state:"calibrated",mode:"full-torso",acceptedFullTorsoPairs:4});
  });
});
