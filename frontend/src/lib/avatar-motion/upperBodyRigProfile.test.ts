import { describe,expect,it } from "vitest";
import { classifyUpperBodyCapability,freezeUpperBodyRigProfile,validateUpperBodyRigProfile,type UpperBodyJointProfile,type UpperBodyRigProfileV1 } from "./upperBodyRigProfile";
const identity={x:0,y:0,z:0,w:1},x={x:1,y:0,z:0},y={x:0,y:1,z:0},z={x:0,y:0,z:1},limits={pitchUp:1,pitchDown:1,yawLeft:1,yawRight:1,rollLeft:1,rollRight:1};
const joint=(name:UpperBodyJointProfile["name"],parent:UpperBodyJointProfile["parent"]):UpperBodyJointProfile=>({name,parent,restLocalRotation:{...identity},restWorldRotation:{...identity},parentRestWorldRotation:{...identity},pitchAxisLocal:{...x},yawAxisLocal:{...y},rollAxisLocal:{...z},limits:{...limits}});
describe("AR4 upper-body rig profile",()=>{
  it("classifies full/reduced/head-only/partial/unsupported capability without upper-arm fallback",()=>{
    expect(classifyUpperBodyCapability({joints:{head:joint("head",null)}})).toBe("head-only");
    expect(classifyUpperBodyCapability({joints:{head:joint("head",null),neck:joint("neck",null),chest:joint("chest",null)}})).toBe("reduced");
    expect(classifyUpperBodyCapability({joints:{head:joint("head",null),leftShoulder:joint("leftShoulder",null)}})).toBe("partial-shoulder");
    expect(classifyUpperBodyCapability({joints:{}})).toBe("unsupported");
  });
  it("validates and deeply freezes a generation-bound profile",()=>{
    const profile:UpperBodyRigProfileV1={version:1,modelGeneration:2,modelFingerprint:"model#2",capability:"head-only",shoulderWidth:null,joints:{head:joint("head",null)}};
    expect(validateUpperBodyRigProfile(profile)).toBe(true);const frozen=freezeUpperBodyRigProfile(profile);expect(Object.isFrozen(frozen)).toBe(true);expect(Object.isFrozen(frozen.joints.head?.limits)).toBe(true);
  });
});
