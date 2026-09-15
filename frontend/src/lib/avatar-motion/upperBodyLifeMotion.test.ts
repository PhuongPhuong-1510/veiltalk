import { describe,expect,it } from "vitest";
import { UpperBodyLifeMotion } from "./upperBodyLifeMotion";
import type { UpperBodyRigProfileV1 } from "./upperBodyRigProfile";
const identity={x:0,y:0,z:0,w:1},x={x:1,y:0,z:0},y={x:0,y:1,z:0},z={x:0,y:0,z:1},limits={pitchUp:1,pitchDown:1,yawLeft:1,yawRight:1,rollLeft:1,rollRight:1};
const joint=(name:"chest"|"upperChest")=>({name,parent:null,restLocalRotation:identity,restWorldRotation:identity,parentRestWorldRotation:identity,pitchAxisLocal:x,yawAxisLocal:y,rollAxisLocal:z,limits});
const profile={version:1,modelGeneration:1,modelFingerprint:"test",capability:"reduced",shoulderWidth:null,joints:{chest:joint("chest"),upperChest:joint("upperChest")}} satisfies UpperBodyRigProfileV1;
describe("AR4 life motion",()=>{
  it("freezes phase over a ten-second hidden gap and resumes without jumping",()=>{
    const life=new UpperBodyLifeMotion();const input={documentVisible:true,mouthOpening:0,mouthClosure:0,mode:"faithful" as const,primaryMotionMagnitude:0,evidenceAvailable:true};
    life.update({...input,nowMs:0},profile);life.update({...input,nowMs:100},profile);const before=life.snapshot();
    life.update({...input,documentVisible:false,nowMs:10_100},profile);expect(life.snapshot().continuousLifeTimeMs).toBe(before.continuousLifeTimeMs);
    life.update({...input,nowMs:10_116},profile);expect(life.snapshot().continuousLifeTimeMs).toBe(before.continuousLifeTimeMs+16);
  });
  it("keeps faithful sway exactly zero while speechChest is a separate bounded component",()=>{
    const life=new UpperBodyLifeMotion();life.update({nowMs:0,documentVisible:true,mouthOpening:1,mouthClosure:0,mode:"faithful",primaryMotionMagnitude:0,evidenceAvailable:true},profile);
    life.update({nowMs:80,documentVisible:true,mouthOpening:1,mouthClosure:0,mode:"faithful",primaryMotionMagnitude:0,evidenceAvailable:true},profile);
    expect(life.snapshot()).toMatchObject({swayYaw:0,swayRoll:0});expect(life.snapshot().speechChest).toBeGreaterThan(0);expect(life.snapshot().speechChest).toBeLessThanOrEqual(.35*Math.PI/180);
  });
});
