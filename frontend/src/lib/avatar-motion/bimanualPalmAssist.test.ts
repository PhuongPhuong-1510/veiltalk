import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { assistBimanualPalms } from "./bimanualPalmAssist";
import type { AvatarCollisionProfile } from "./avatarCollisionProfile";
import type { AvatarCollisionPose } from "./avatarCollisionTypes";

const pose = (sign: number): AvatarCollisionPose => ({shoulder:{x:sign*.4,y:0,z:0},elbow:{x:sign*.2,y:.25,z:0},wrist:{x:sign*.07,y:.18,z:0},hand:{x:sign*.06,y:.22,z:0}});
const profile = (): AvatarCollisionProfile => ({body:{head:{center:{x:0,y:5,z:0},radius:.1},neck:{start:{x:0,y:4,z:0},end:{x:0,y:4.5,z:0},radius:.05},torso:{start:{x:0,y:3,z:0},end:{x:0,y:4,z:0},radius:.1}},arms:{left:{upperLength:Math.hypot(.2,.25),lowerLength:Math.hypot(.13,.07),upperRadius:.015,forearmRadius:.015,handRadius:.015},right:{upperLength:Math.hypot(.2,.25),lowerLength:Math.hypot(.13,.07),upperRadius:.015,forearmRadius:.015,handRadius:.015}}});
const length = (a:{x:number;y:number;z:number},b:{x:number;y:number;z:number})=>new Vector3(a.x,a.y,a.z).distanceTo(new Vector3(b.x,b.y,b.z));

describe("bounded bimanual palm assist", () => {
  it("reduces a small palm gap while preserving both lengths and a finite wrist budget", () => {
    const left=pose(-1),right=pose(1),rig=profile(),result=assistBimanualPalms(rig,left,right,.35,.005);
    expect(result.applied).toBe(true);expect(result.distanceAfter!).toBeLessThan(result.distanceBefore!);
    for(const side of ["left","right"] as const){const output=result[side];expect(length(output.shoulder,output.elbow)).toBeCloseTo(rig.arms[side].upperLength,8);expect(length(output.elbow,output.wrist)).toBeCloseTo(rig.arms[side].lowerLength,8);expect(length(output.wrist,side==="left"?left.wrist:right.wrist)).toBeLessThanOrEqual(.005+1e-8);}
  });
  it("preserves baseline exactly when inactive or body clearance worsens", () => {
    const left=pose(-1),right=pose(1),rig=profile();
    expect(assistBimanualPalms(rig,left,right,0,.005).left).toBe(left);
    rig.body.head={center:{x:0,y:.22,z:0},radius:.047};
    const result=assistBimanualPalms(rig,left,right,.35,.005);expect(result.applied).toBe(false);expect(result.reason).toBe("body-clearance");expect(result.left).toBe(left);
  });
});
