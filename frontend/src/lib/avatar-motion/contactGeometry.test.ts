import { describe,expect,it } from "vitest";
import { mapContactAnchor } from "./contactAnchorMapping";
import { solveContactWristTarget } from "./contactWristTarget";
import { solveContactArmIk } from "./contactArmIk";
import { capsuleCapsulePenetration,capsuleSpherePenetration,resolveContactCollisionFailSafe } from "./contactCollision";

describe("contact target and IK geometry",()=>{
  it("aligns a probe-specific normal and compensates wrist-to-probe offset",()=>{
    const local=mapContactAnchor({region:"leftCheek",centerLocal:{x:0,y:1,z:0},radii:{x:.3,y:.4,z:.2},uAxisLocal:{x:1,y:0,z:0},vAxisLocal:{x:0,y:1,z:0},outwardLocal:{x:0,y:0,z:1},parentJoint:"head",confidence:1});
    const anchor={region:local.region,point:local.pointLocal,normal:local.normalLocal,tangent:local.tangentLocal,parentJoint:local.parentJoint};
    const solved=solveContactWristTarget(anchor,{probe:"palmCenter",frameOffset:{x:0,y:.12,z:0},contactNormal:{x:0,y:0,z:1},tangentHint:{x:0,y:1,z:0}})!;
    expect(solved.normalErrorRadians).toBeLessThan(1e-6);
    expect(Math.hypot(solved.probePoint.x-anchor.point.x,solved.probePoint.y-anchor.point.y,solved.probePoint.z-anchor.point.z)).toBeLessThan(1e-6);
  });
  it("preserves both avatar bone lengths and projects unreachable targets",()=>{
    const result=solveContactArmIk({shoulder:{x:0,y:0,z:0},wristTarget:{x:4,y:0,z:0},upperLength:1,lowerLength:1,preferredPole:{x:0,y:1,z:0}})!;
    const distance=(a:{x:number;y:number;z:number},b:{x:number;y:number;z:number})=>Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
    expect(result.projected).toBe(true);expect(distance(result.shoulder,result.elbow)).toBeCloseTo(1,5);expect(distance(result.elbow,result.wrist)).toBeCloseTo(1,5);
  });
  it("bounds collision correction and fails closed",()=>{
    expect(capsuleSpherePenetration({start:{x:-1,y:0,z:0},end:{x:1,y:0,z:0},radius:.1},{center:{x:0,y:0,z:0},radius:.2}).penetration).toBeCloseTo(.3);
    expect(resolveContactCollisionFailSafe(1,.4,.2)).toEqual({influence:0,accepted:false,reason:"collision-unsatisfied"});
  });
  it("detects finite arm-to-torso capsule penetration",()=>{
    const collision=capsuleCapsulePenetration({start:{x:-1,y:0,z:0},end:{x:1,y:0,z:0},radius:.1},{start:{x:0,y:-1,z:0},end:{x:0,y:1,z:0},radius:.2});
    expect(collision.valid).toBe(true);expect(collision.penetration).toBeCloseTo(.3);
  });
});
