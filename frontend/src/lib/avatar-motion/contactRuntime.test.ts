import { describe, expect, it } from "vitest";
import type { RawNormalizedLandmarkV1, RawTrackingFrameV1 } from "../tracking/rawTrackingTypes";
import type { NormalizedAvatarRigProfile } from "./normalizedRigProfile";
import { ContactRuntime } from "./contactRuntime";

const q={x:0,y:0,z:0,w:1};
const v=(x:number,y:number,z:number)=>({x,y,z});
const basis={primaryLocal:v(1,0,0),secondaryLocal:v(0,1,0),binormalLocal:v(0,0,1),primaryWorld:v(1,0,0),secondaryWorld:v(0,1,0),binormalWorld:v(0,0,1),worldRotation:q};
const joint=(parentJoint:any,childJoint:any,parentMode:any,controlledParentJoint:any,x:number)=>({parentJoint,childJoint,parentMode,controlledParentJoint,restLocalPosition:v(x,0,0),restLocalRotation:q,restWorldPosition:v(x,0,0),restWorldRotation:q,parentRestWorldRotation:q,restWorldDirection:v(1,0,0),anatomicalRestBasis:basis});
const contactJoint=(parent:any,x:number,y:number)=>({parent,restLocalPosition:v(x,y,0),restLocalRotation:q,restWorldPosition:v(x,y,0),restWorldRotation:q});
const handContact={contactFrame:{acrossLocal:v(1,0,0),forwardLocal:v(0,1,0),normalLocal:v(0,0,1),probes:{palmCenter:{offsetLocal:v(0,.08,0),normalLocal:v(0,0,1),tangentLocal:v(0,1,0)},radialEdge:{offsetLocal:v(.05,.05,0),normalLocal:v(1,0,0),tangentLocal:v(0,1,0)},ulnarEdge:{offsetLocal:v(-.05,.05,0),normalLocal:v(-1,0,0),tangentLocal:v(0,1,0)}}}};
const profile:NormalizedAvatarRigProfile={version:1,modelGeneration:1,modelFingerprint:"runtime-contact",torsoReference:{rightWorld:v(1,0,0),upWorld:v(0,1,0),forwardWorld:v(0,0,1),worldRotation:q},collisionReference:{head:{centerWorld:v(0,1,0),radius:.3},torso:{startWorld:v(0,.7,0),endWorld:v(0,-.5,0),radius:.28},arms:{left:{shoulderWorld:v(-.3,.55,0),upperLength:.55,lowerLength:.55,radius:.06},right:{shoulderWorld:v(.3,.55,0),upperLength:.55,lowerLength:.55,radius:.06}}},contactSkeleton:{joints:{hips:contactJoint(null,0,0),spine:contactJoint("hips",0,0),upperChest:contactJoint("spine",0,0),neck:contactJoint("upperChest",0,.7),head:contactJoint("neck",0,1),leftShoulder:contactJoint("upperChest",-.3,.55),rightShoulder:contactJoint("upperChest",.3,.55)}},hands:{left:{restLocalRotation:q,restWorldRotation:q,restWorldPosition:v(-1.4,.55,0),parentRestWorldRotation:q,...handContact},right:{restLocalRotation:q,restWorldRotation:q,restWorldPosition:v(1.4,.55,0),parentRestWorldRotation:q,...handContact}},joints:{leftUpperArm:joint("leftShoulder","leftLowerArm","fixed-rest",null,0),leftLowerArm:joint("leftUpperArm","leftHand","controlled","leftUpperArm",-.55),rightUpperArm:joint("rightShoulder","rightLowerArm","fixed-rest",null,0),rightLowerArm:joint("rightUpperArm","rightHand","controlled","rightUpperArm",.55)}};
const lm=(x:number,y:number,z=0):RawNormalizedLandmarkV1=>({x,y,z,visibility:1});
const face=[lm(.4,.35),lm(.5,.3),lm(.6,.35),lm(.62,.5),lm(.6,.65),lm(.5,.7),lm(.4,.65),lm(.38,.5)];
const hand=()=>{const points=Array.from({length:21},()=>lm(.5,.28));points[0]=lm(.5,.32);points[5]=lm(.45,.25);points[9]=lm(.5,.22);points[17]=lm(.55,.25);return points;};
const frame=(at:number):RawTrackingFrameV1=>{const pose=Array.from({length:33},()=>lm(.5,.5,0));pose[0]=lm(.5,.4,0);pose[15]=lm(.5,.3,.02);return{version:1,frameTimestampMs:at,overall:"full",face:{state:"tracked",sampledAtMs:at,landmarks:face,blendshapes:{},facialTransform:null},leftHand:{state:"tracked",sampledAtMs:at,handedness:"left",handednessScore:1,landmarks:hand(),worldLandmarks:null},rightHand:{state:"lost",sampledAtMs:at,handedness:"right",handednessScore:0,landmarks:null,worldLandmarks:null},rawHands:[],handSampledThisFrame:true,handSampledAtMs:at,pose:{state:"tracked",sampledAtMs:at,landmarks:pose,worldLandmarks:pose},videoWidth:1_000,videoHeight:1_000};};

describe("AR9 contact runtime",()=>{
  it("observes in shadow without writes, then either applies or safely rejects confirmed contact",()=>{
    const runtime=new ContactRuntime();runtime.setProfile(profile);
    const shadowRotations={};
    for(const at of [0,60,130,200,290,380,480])runtime.update("left",frame(at),hand(),at,at,60,shadowRotations,null,false);
    expect(shadowRotations).toEqual({});
    expect(runtime.snapshot().left.phase).toMatch(/touch|hold/);
    const corrected={};runtime.update("left",frame(450),hand(),450,450,70,corrected,null,true);
    const diagnostic=runtime.snapshot().left;
    expect(diagnostic.correctionRequested).toBe(diagnostic.correctionEligible!==false);
    if(diagnostic.correctionEligible===false)expect(diagnostic.correctionApplied).toBe(false);
    if(diagnostic.correctionApplied)expect(Object.keys(corrected)).toEqual(expect.arrayContaining(["leftUpperArm","leftLowerArm","leftHand"]));
    else{expect(corrected).toEqual({});expect(["inactive","collision-unsatisfied","unsafe-angular-jump","kinematic-degraded","multi-degraded"]).toContain(diagnostic.correctionReason);}
  });
});
