import { Quaternion,Vector3 } from "three";
import { describe,expect,it } from "vitest";
import type { QuaternionData,AvatarUpperBodyJointName } from "./avatarPoseTypes";
import { composeUpperBody,localRotationToSemantic,semanticRotationToLocal } from "./upperBodyComposer";
import type { UpperBodyJointProfile,UpperBodyRigProfileV1 } from "./upperBodyRigProfile";
const identity={x:0,y:0,z:0,w:1},x={x:1,y:0,z:0},y={x:0,y:1,z:0},z={x:0,y:0,z:1};const radians=(d:number)=>d*Math.PI/180;
const limits={pitchUp:radians(15),pitchDown:radians(15),yawLeft:radians(15),yawRight:radians(15),rollLeft:radians(15),rollRight:radians(15)};
const make=(name:AvatarUpperBodyJointName|"head",parent:AvatarUpperBodyJointName|null):UpperBodyJointProfile=>({name,parent,restLocalRotation:identity,restWorldRotation:identity,parentRestWorldRotation:identity,pitchAxisLocal:x,yawAxisLocal:y,rollAxisLocal:z,limits});
const profile={version:1,modelGeneration:1,modelFingerprint:"test",capability:"reduced",shoulderWidth:1,joints:{chest:make("chest",null),neck:make("neck","chest"),head:make("head","neck"),leftShoulder:make("leftShoulder","chest")}} satisfies UpperBodyRigProfileV1;
const angle=(q:QuaternionData)=>new Quaternion(q.x,q.y,q.z,q.w).angleTo(new Quaternion());
describe("AR4 upper-body composer",()=>{
  it("applies the final aggregate cap after all layers compose",()=>{
    const ten=semanticRotationToLocal({x:0,y:radians(10),z:0},profile.joints.chest!);
    const result=composeUpperBody(profile,{torsoBase:{chest:ten},headRelative:{chest:ten},lifeSecondary:{chest:ten}});
    const semantic=localRotationToSemantic(result.deltas.chest!,profile.joints.chest!)!;
    expect(semantic.y).toBeCloseTo(radians(15),5);expect(result.aggregateClamped).toContain("chest");
  });
  it("builds descendants from the final animated parent, not a raw/pre-temporal parent",()=>{
    const finalParent=semanticRotationToLocal({x:0,y:radians(15),z:0},profile.joints.chest!);
    const result=composeUpperBody(profile,{torsoBase:{chest:finalParent}});
    expect(angle(result.targetWorldRotations.leftShoulder!)).toBeCloseTo(radians(15),5);
    const target=result.targetWorldRotations.leftShoulder!;const direction=new Vector3(1,0,0).applyQuaternion(new Quaternion(target.x,target.y,target.z,target.w));
    expect(direction.angleTo(new Vector3(Math.cos(radians(15)),0,-Math.sin(radians(15))))).toBeLessThan(1e-5);
  });
});
