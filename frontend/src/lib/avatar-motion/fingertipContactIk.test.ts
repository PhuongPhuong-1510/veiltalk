import {Object3D,Quaternion,Vector3} from "three";
import {describe,expect,it} from "vitest";
import {buildFingertipProbe,correctFingertipContacts,fingertipPosition,type FingerBoneMap} from "./fingertipContactIk";
import {fingerJointName,type QuaternionData} from "./avatarPoseTypes";
import type {FingerChainRig,FingerRigProfile} from "./fingerRig";
function fixture(){
  const root=new Object3D(),bones:FingerBoneMap={},baseline:Partial<Record<keyof FingerBoneMap,QuaternionData>>={};
  const hands={left:new Object3D(),right:new Object3D()};root.add(hands.left,hands.right);hands.right.position.set(.125,.012,0);
  const chain=(side:"left"|"right"):FingerChainRig=>{
    let parent=hands[side];const segments=(["Proximal","Intermediate","Distal"] as const).map((segment,i)=>{const joint=fingerJointName(side,"index",segment),bone=new Object3D();if(i)bone.position.x=side==="left"?.02:-.02;parent.add(bone);parent=bone;bones[joint]=bone;baseline[joint]={x:0,y:0,z:0,w:1};return{joint,flexAxisLocal:{x:0,y:0,z:1}};});
    const tip=new Object3D();tip.name="index_tip";tip.position.x=side==="left"?.02:-.02;parent.add(tip);return{finger:"index",segments:segments.map(s=>({...s,hasChild:true})),truncatedAtSegment:null};
  };
  const left=chain("left"),right=chain("right"),rig:FingerRigProfile={version:1,modelGeneration:1,left:{side:"left",chains:[left],controllableSegmentCount:3},right:{side:"right",chains:[right],controllableSegmentCount:3}};
  root.updateMatrixWorld(true);const lp=buildFingertipProbe(left,bones)!,rp=buildFingertipProbe(right,bones)!,probes=new Map([["left:index",lp],["right:index",rp]]);
  return{root,hands,bones,baseline,rig,probes,lp,rp,left,right};
}
describe("bounded model fingertip contact",()=>{
  it("reduces a reachable tip gap while preserving wrist pose and bone lengths",()=>{
    const f=fixture(),rest=f.hands.left.quaternion.clone(),before=fingertipPosition(f.lp).distanceTo(fingertipPosition(f.rp));
    const result=correctFingertipContacts({...f,intent:{version:1,sampledAtMs:100,pairs:[{left:"index",right:"index",influence:.35}]},palmWidth:.1,deltaSeconds:1/60,sampleAgeMs:0});
    expect(result.applied).toBe(true);expect(result.pairs[0].after).toBeLessThan(before);expect(f.hands.left.quaternion.equals(rest)).toBe(true);
    for(const chain of [f.left,f.right])for(const s of chain.segments){const bone=f.bones[s.joint]!;expect(bone.quaternion.angleTo(new Quaternion())).toBeLessThanOrEqual(20*Math.PI/180);if(bone.position.length())expect(bone.position.length()).toBeCloseTo(.02);}
  });
  it("does not move distant, stale, nonfinite or paused contacts",()=>{
    for(const mode of ["far","stale","nan","paused"]){const f=fixture();if(mode==="far"){f.hands.right.position.x=1;f.root.updateMatrixWorld(true);}
      const before=Object.values(f.bones).map(b=>b!.quaternion.toArray());
      const result=correctFingertipContacts({...f,intent:{version:1,sampledAtMs:100,pairs:[{left:"index",right:"index",influence:.35}]},palmWidth:mode==="nan"?NaN:.1,deltaSeconds:mode==="paused"?0:1/60,sampleAgeMs:mode==="stale"?201:0});
      expect(result.applied).toBe(false);expect(Object.values(f.bones).map(b=>b!.quaternion.toArray())).toEqual(before);
    }
  });
  it("labels estimated tips and refuses incomplete chains",()=>{
    const f=fixture();f.lp.bone.remove(...f.lp.bone.children);expect(buildFingertipProbe(f.left,f.bones)?.source).toBe("estimated-distal");
    expect(buildFingertipProbe({...f.left,truncatedAtSegment:"Distal"},f.bones)).toBeNull();
  });
  it("retains raw end-node geometry when normalized bones have no tip child",()=>{
    const control=fixture(),raw=fixture();control.lp.bone.remove(...control.lp.bone.children);control.root.updateMatrixWorld(true);
    const probe=buildFingertipProbe(control.left,control.bones,raw.bones)!;
    expect(probe.source).toBe("end-node");expect(probe.bone).toBe(control.lp.bone);
    expect(fingertipPosition(probe).distanceTo(fingertipPosition(raw.lp))).toBeLessThan(1e-8);
  });
  it("respects observed anatomical flexion windows and rolls back body-clearance regressions",()=>{
    for(const mode of ["limits","body"]){const f=fixture(),positions=[fingertipPosition(f.lp),fingertipPosition(f.rp)],before=Object.values(f.bones).map(b=>b!.quaternion.toArray());
      const windows=Object.fromEntries(Object.keys(f.bones).map(name=>[name,{min:0,max:0}]));
      const result=correctFingertipContacts({...f,intent:{version:1,sampledAtMs:100,pairs:[{left:"index",right:"index",influence:.35}],flexionWindows:mode==="limits"?windows:undefined},palmWidth:.1,deltaSeconds:1/60,sampleAgeMs:0,clearanceScore:mode==="body"?()=>fingertipPosition(f.lp).distanceToSquared(positions[0])+fingertipPosition(f.rp).distanceToSquared(positions[1]):undefined});
      expect(result.applied).toBe(false);expect(Object.values(f.bones).map(b=>b!.quaternion.toArray())).toEqual(before);
    }
  });
  it("works under a rotated/translated/scaled parent without changing the wrist",()=>{
    const f=fixture();f.root.position.set(3,2,-1);f.root.rotation.y=.8;f.root.scale.setScalar(2);f.root.updateMatrixWorld(true);
    const handWorld=f.hands.right.getWorldQuaternion(new Quaternion());
    const result=correctFingertipContacts({...f,intent:{version:1,sampledAtMs:100,pairs:[{left:"index",right:"index",influence:.35}]},palmWidth:.2,deltaSeconds:1/60,sampleAgeMs:0});
    expect(result.applied).toBe(true);expect(f.hands.right.getWorldQuaternion(new Quaternion()).angleTo(handWorld)).toBeLessThan(1e-7);
    expect(new Vector3().copy(fingertipPosition(f.rp)).toArray().every(Number.isFinite)).toBe(true);
  });
});
