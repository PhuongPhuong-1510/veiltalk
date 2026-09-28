import { describe,expect,it } from "vitest";
import type { NormalizedAvatarRigProfile } from "./normalizedRigProfile";
import { poseContactAnchor } from "./posedContactAnchor";

const q={x:0,y:0,z:0,w:1},v=(x:number,y:number,z:number)=>({x,y,z});
const basis={primaryLocal:v(1,0,0),secondaryLocal:v(0,1,0),binormalLocal:v(0,0,1),primaryWorld:v(1,0,0),secondaryWorld:v(0,1,0),binormalWorld:v(0,0,1),worldRotation:q};
const joint=(parentJoint:any,childJoint:any,parentMode:any,controlledParentJoint:any)=>({parentJoint,childJoint,parentMode,controlledParentJoint,restLocalPosition:v(0,0,0),restLocalRotation:q,restWorldPosition:v(0,0,0),restWorldRotation:q,parentRestWorldRotation:q,restWorldDirection:v(1,0,0),anatomicalRestBasis:basis});
const profile:NormalizedAvatarRigProfile={version:1,modelGeneration:1,modelFingerprint:"posed-anchor",torsoReference:{rightWorld:v(1,0,0),upWorld:v(0,1,0),forwardWorld:v(0,0,1),worldRotation:q},collisionReference:{head:{centerWorld:v(0,1,0),radius:.3},torso:{startWorld:v(0,.5,0),endWorld:v(0,0,0),radius:.3},arms:{left:{shoulderWorld:v(-.3,.4,0),upperLength:.5,lowerLength:.5,radius:.05},right:{shoulderWorld:v(.3,.4,0),upperLength:.5,lowerLength:.5,radius:.05}}},contactSkeleton:{joints:{head:{parent:null,restLocalPosition:v(0,0,0),restWorldPosition:v(0,0,0),restLocalRotation:q,restWorldRotation:q}}},joints:{leftUpperArm:joint("leftShoulder","leftLowerArm","fixed-rest",null),leftLowerArm:joint("leftUpperArm","leftHand","controlled","leftUpperArm"),rightUpperArm:joint("rightShoulder","rightLowerArm","fixed-rest",null),rightLowerArm:joint("rightUpperArm","rightHand","controlled","rightUpperArm")}};

describe("posed contact anchor",()=>{
  it("follows current head rotation around the neck pivot",()=>{
    const rotated=poseContactAnchor({region:"forehead",pointLocal:v(0,.5,1),normalLocal:v(0,0,1),tangentLocal:v(0,1,0),parentJoint:"head"},profile,{}, {x:0,y:Math.sin(Math.PI/4),z:0,w:Math.cos(Math.PI/4)})!;
    expect(rotated.point.x).toBeCloseTo(1,5);expect(rotated.point.z).toBeCloseTo(0,5);
    expect(rotated.normal.x).toBeCloseTo(1,5);
  });
});
