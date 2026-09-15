import { Quaternion,Vector3 } from "three";
import { describe,expect,it } from "vitest";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import { ShoulderMotionSolver } from "./shoulderMotionSolver";
import { solveTorsoMotion } from "./torsoMotionSolver";
import { computeHeadRelativeIntent,solveHeadNeckDistribution } from "./headNeckSolver";
import { localRotationToSemantic } from "./upperBodyComposer";
import { buildShoulderTorsoBasis } from "./torsoBasis";
import { quaternionLog } from "./quaternionDistribution";
import type { UpperBodyJointProfile,UpperBodyRigProfileV1 } from "./upperBodyRigProfile";
const identity={x:0,y:0,z:0,w:1},axisX={x:1,y:0,z:0},axisY={x:0,y:1,z:0},axisZ={x:0,y:0,z:1},limits={pitchUp:1,pitchDown:1,yawLeft:1,yawRight:1,rollLeft:1,rollRight:1};
const joint=(name:UpperBodyJointProfile["name"]):UpperBodyJointProfile=>({name,parent:null,restLocalRotation:identity,restWorldRotation:identity,parentRestWorldRotation:identity,pitchAxisLocal:axisX,yawAxisLocal:axisY,rollAxisLocal:axisZ,limits});
const profile={version:1,modelGeneration:1,modelFingerprint:"test",capability:"full",shoulderWidth:.4,joints:{hips:joint("hips"),spine:joint("spine"),chest:joint("chest"),upperChest:joint("upperChest"),neck:joint("neck"),head:joint("head"),leftShoulder:joint("leftShoulder"),rightShoulder:joint("rightShoulder")}} satisfies UpperBodyRigProfileV1;
const basis={right:{x:1,y:0,z:0},up:{x:0,y:1,z:0},forward:{x:0,y:0,z:1},worldRotation:identity};
const lm=(x:number,y:number,z=0):RawNormalizedLandmarkV1=>({x,y:-y,z:-z,visibility:1});
const landmarks=()=>{const value=Array.from({length:33},()=>lm(0,0));value[0]=lm(0,.9);value[7]=lm(-.15,.8);value[8]=lm(.15,.8);value[11]=lm(-.2,.5);value[12]=lm(.2,.5);value[13]=lm(-.45,.4);value[14]=lm(.45,.4);value[15]=lm(-.65,.3);value[16]=lm(.65,.3);value[23]=lm(-.15,0);value[24]=lm(.15,0);return value;};
const q=(axis:Vector3,angle:number)=>{const value=new Quaternion().setFromAxisAngle(axis,angle);return{x:value.x,y:value.y,z:value.z,w:value.w};};
describe("AR4 torso and shoulder solvers",()=>{
  it("distributes head-relative yaw across available chest/upperChest/neck/head without double apply",()=>{
    const result=solveHeadNeckDistribution(q(new Vector3(0,1,0),.4),profile);const total=["chest","upperChest","neck","head"].reduce((sum,name)=>sum+(localRotationToSemantic(result.layer[name as keyof typeof result.layer]!,profile.joints[name as keyof typeof profile.joints]!)?.y??0),0);
    expect(total).toBeCloseTo(.4,5);expect(result.residual.y).toBeCloseTo(0);
  });
  it("keeps a head that follows torso relative-neutral and compensates only when face stays camera-locked",()=>{
    const torso=q(new Vector3(1,0,0),.2);
    const follows=computeHeadRelativeIntent(torso,torso)!;expect(follows.w).toBeCloseTo(1);expect(Math.hypot(follows.x,follows.y,follows.z)).toBeLessThan(1e-8);
    const cameraLocked=computeHeadRelativeIntent(identity,torso);expect(cameraLocked).not.toBeNull();expect(quaternionLog(cameraLocked!)?.x).toBeCloseTo(-.2);
  });
  it("distributes a bounded torso twist and reports a neutral-relative offset proxy",()=>{
    const result=solveTorsoMotion(basis,identity,profile,landmarks(),false,q(new Vector3(0,1,0),.2),{lateral:0,depth:0});
    expect(result.rotation?.y).toBeCloseTo(.2);expect(result.layer.hips).toBeDefined();expect(result.layer.upperChest).toBeDefined();expect(result.curl).toBeNull();expect(result.rotationOnlyTorsoOffsetProxy?.lateral).toBeCloseTo(0);
  });
  it("keeps left/right shrug evidence independent",()=>{
    const solver=new ShoulderMotionSolver(),neutral=landmarks();expect(solver.captureNeutral(neutral,basis)).toBe(true);const raised=landmarks();raised[11]=lm(-.2,.6);
    const result=solver.solve(raised,basis,profile,{x:0,y:0,z:0});expect(result.elevation.left).toBeGreaterThan(0);expect(Math.abs(result.elevation.right)).toBeLessThan(result.elevation.left*.2);expect(result.vertical.left).toBeGreaterThan(0);expect(result.directBilateralProtractionObservable).toBe(false);
    const missingEars=landmarks();missingEars[7].visibility=0;missingEars[8].visibility=0;missingEars[11]=lm(-.2,.6);const fallback=solver.solve(missingEars,basis,profile,{x:0,y:0,z:0});expect(fallback.verticalSource.left).toBe("nose-gap");expect(fallback.vertical.left).toBeGreaterThan(0);expect(Math.abs(fallback.vertical.right)).toBeLessThan(.01);
  });
  it("detects bilateral shrug without requiring visible hips",()=>{
    const solver=new ShoulderMotionSolver(),neutral=landmarks();neutral[23].visibility=0;neutral[24].visibility=0;expect(solver.captureNeutral(neutral,basis)).toBe(true);
    const raised=landmarks();raised[23].visibility=0;raised[24].visibility=0;raised[11]=lm(-.2,.6);raised[12]=lm(.2,.6);
    const result=solver.solve(raised,basis,profile,{x:0,y:0,z:0});expect(result.elevation.left).toBeGreaterThan(0);expect(result.elevation.right).toBeGreaterThan(0);expect(result.vertical.left).toBeGreaterThan(0);expect(result.vertical.right).toBeGreaterThan(0);
  });
  it("rejects perspective-like bilateral shoulder drift during a detected lean",()=>{
    const solver=new ShoulderMotionSolver(),neutral=landmarks();expect(solver.captureNeutral(neutral,basis)).toBe(true);
    const drifted=landmarks();drifted[11]=lm(-.2,.6);drifted[12]=lm(.2,.6);
    const result=solver.solve(drifted,basis,profile,{x:0,y:0,z:0},drifted,1,0);
    expect(Math.abs(result.vertical.left)).toBeLessThan(.01);expect(Math.abs(result.vertical.right)).toBeLessThan(.01);expect(result.commonMotionGain).toBe(0);
  });
  it("preserves differential shoulder evidence while common lean motion is gated",()=>{
    const solver=new ShoulderMotionSolver(),neutral=landmarks();expect(solver.captureNeutral(neutral,basis)).toBe(true);
    const raised=landmarks();raised[11]=lm(-.2,.6);
    const result=solver.solve(raised,basis,profile,{x:0,y:0,z:0},raised,1,0);
    expect(result.vertical.left).toBeGreaterThan(0);expect(result.vertical.left).toBeGreaterThan(result.vertical.right);
  });
  it("detects bilateral shrug from nose-to-shoulder-center gap when both ears are unavailable",()=>{
    const solver=new ShoulderMotionSolver(),neutral=landmarks();neutral[7].visibility=0;neutral[8].visibility=0;expect(solver.captureNeutral(neutral,basis)).toBe(true);
    const raised=landmarks();raised[7].visibility=0;raised[8].visibility=0;raised[11]=lm(-.2,.6);raised[12]=lm(.2,.6);
    const result=solver.solve(raised,basis,profile,{x:0,y:0,z:0});expect(result.verticalSource.left).toBe("nose-gap");expect(result.verticalSource.right).toBe("nose-gap");expect(result.vertical.left).toBeGreaterThan(.5);expect(result.vertical.right).toBeGreaterThan(.5);
  });
  it("uses image-space shrug evidence when world-space shoulders stay unchanged in a close camera crop",()=>{
    const solver=new ShoulderMotionSolver(),world=landmarks(),neutralImage=landmarks();expect(solver.captureNeutral(world,basis,neutralImage,16/9)).toBe(true);
    const raisedImage=landmarks();raisedImage[11]=lm(-.2,.6);raisedImage[12]=lm(.2,.6);
    const result=solver.solve(world,basis,profile,{x:0,y:0,z:0},raisedImage,16/9);
    expect(result.vertical.left).toBeGreaterThan(.5);expect(result.vertical.right).toBeGreaterThan(.5);expect(result.elevation.left).toBeGreaterThan(0);expect(result.elevation.right).toBeGreaterThan(0);
  });
  it("keeps shrug observable when the basis is rebuilt from the current shoulder line",()=>{
    const solver=new ShoulderMotionSolver(),neutral=landmarks();const neutralBasis=buildShoulderTorsoBasis(neutral)!;expect(solver.captureNeutral(neutral,neutralBasis)).toBe(true);
    const raised=landmarks();raised[11]=lm(-.2,.6);const currentBasis=buildShoulderTorsoBasis(raised)!;const result=solver.solve(raised,currentBasis,profile,{x:0,y:0,z:0});
    expect(result.elevation.left).toBeGreaterThan(0);expect(Math.abs(result.elevation.right)).toBeLessThan(result.elevation.left*.2);
  });
  it("gates ear-gap when only a rolling head moves one ear toward a stationary shoulder",()=>{
    const solver=new ShoulderMotionSolver(),neutral=landmarks();expect(solver.captureNeutral(neutral,basis)).toBe(true);
    const tilted=landmarks();tilted[7]=lm(-.15,.65);
    const unguarded=solver.solve(tilted,basis,profile,{x:0,y:0,z:0});const guarded=solver.solve(tilted,basis,profile,{x:0,y:0,z:.4});
    expect(unguarded.vertical.left).toBeGreaterThan(.5);expect(Math.abs(guarded.vertical.left)).toBeLessThan(.01);expect(guarded.earGapConfidence.left).toBe(0);
  });
});
