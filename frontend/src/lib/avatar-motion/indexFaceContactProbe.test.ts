import { describe, expect, it } from "vitest";
import { Quaternion, Vector3 } from "three";
import { buildPosedIndexContactProbe, observeIndexFaceProbe } from "./indexFaceContactProbe";
import type { NormalizedAvatarRigProfile } from "./normalizedRigProfile";

describe("posed index contact probe",()=>{
  const q={x:0,y:0,z:0,w:1},segments=["leftIndexProximal","leftIndexIntermediate","leftIndexDistal"].map(joint=>({joint,positionLocal:{x:.02,y:0,z:0},rotationLocal:q}));
  const profile={hands:{left:{indexTip:{segments,offsetLocal:{x:.01,y:0,z:0},source:"end-node"}}}} as NormalizedAvatarRigProfile;
  it("recomputes the wrist-to-tip offset from observed finger rotations",()=>{
    const rotations=Object.fromEntries(segments.map(s=>[s.joint,q])),straight=buildPosedIndexContactProbe(profile,"left",rotations)!;
    expect(straight.frameOffset.x).toBeCloseTo(.07);
    const turn=new Quaternion().setFromAxisAngle(new Vector3(0,0,1),Math.PI/2);rotations.leftIndexProximal={x:turn.x,y:turn.y,z:turn.z,w:turn.w};
    const folded=buildPosedIndexContactProbe(profile,"left",rotations)!;expect(folded.frameOffset.x).toBeCloseTo(.02);expect(folded.frameOffset.y).toBeCloseTo(.05);
    expect(folded.contactNormal.y).toBeCloseTo(1);
  });
  it("refuses incomplete chains and unobserved/invalid rotations",()=>{
    expect(buildPosedIndexContactProbe(profile,"left",{})).toBeNull();expect(buildPosedIndexContactProbe(profile,"right",{})).toBeNull();
    const rotations=Object.fromEntries(segments.map(s=>[s.joint,{...q,w:NaN}]));expect(buildPosedIndexContactProbe(profile,"left",rotations)).toBeNull();
  });
  it("refuses a collapsed image fingertip rather than inferring contact from a fist",()=>{
    const hand=Array.from({length:21},()=>({x:.5,y:.5,z:0,visibility:null}));expect(observeIndexFaceProbe(hand,1280,720)).toBeNull();hand[8].x=.52;expect(observeIndexFaceProbe(hand,1280,720)?.probe).toBe("indexTip");
  });
});
