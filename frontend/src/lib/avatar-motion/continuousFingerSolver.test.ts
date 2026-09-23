import {describe,expect,it} from "vitest";
import {ContinuousFingerSolver,observeContinuousFingerAngles} from "./continuousFingerSolver";
import {DEFAULT_AVATAR_MOTION_CONFIG} from "./motionConfig";
import type {HandFingerRig} from "./fingerRig";
const p=(x:number,y:number,z=0)=>({x,y,z,visibility:1});
describe("continuous finger human-domain geometry",()=>{
  it("is invariant under uniform scale and produces increasing PIP flexion",()=>{
    const hand=Array.from({length:21},()=>p(0,0));hand[5]=p(0,1);hand[6]=p(0,2);hand[7]=p(1,2);hand[8]=p(2,2);
    const basis={across:{x:1,y:0,z:0},forward:{x:0,y:1,z:0},normal:{x:0,y:0,z:1}};
    const a=observeContinuousFingerAngles(hand,basis,1).index!;
    const scaled=hand.map(v=>p(v.x*3,v.y*3,v.z*3));const b=observeContinuousFingerAngles(scaled,basis,1).index!;
    expect(a.angles[1]).toBeCloseTo(Math.PI/2);expect(b.angles[1]).toBeCloseTo(a.angles[1]);
  });
  it("rejects degenerate landmark chains instead of emitting NaN",()=>{
    const hand=Array.from({length:21},()=>p(0,0));const basis={across:{x:1,y:0,z:0},forward:{x:0,y:1,z:0},normal:{x:0,y:0,z:1}};
    expect(observeContinuousFingerAngles(hand,basis,1).index).toBeUndefined();
  });
  it("does not mistake natural metacarpal fan-out for MCP flexion",()=>{
    const hand=Array.from({length:21},()=>p(0,0));
    hand[0]=p(0,0);hand[5]=p(1,1);hand[6]=p(1.4,2);hand[7]=p(1.8,3);hand[8]=p(2.2,4);
    const basis={across:{x:1,y:0,z:0},forward:{x:0,y:1,z:0},normal:{x:0,y:0,z:1}};
    expect(observeContinuousFingerAngles(hand,basis,1).index?.angles).toEqual([0,0,0]);
  });
  it("keeps semantic finger angles invariant when the hand is mirrored left-to-right",()=>{
    const hand=Array.from({length:21},()=>p(0,0));hand[0]=p(0,-1);
    hand[5]=p(.7,0,.1);hand[6]=p(.8,.8,.35);hand[7]=p(1.1,1.3,.5);hand[8]=p(1.5,1.5,.55);
    const basis={across:{x:1,y:0,z:0},forward:{x:0,y:1,z:0},normal:{x:0,y:0,z:1}};
    const mirrored=hand.map(point=>({...point,x:-point.x}));
    const mirroredBasis={across:{x:-1,y:0,z:0},forward:{x:0,y:1,z:0},normal:{x:0,y:0,z:-1}};
    const left=observeContinuousFingerAngles(hand,basis,1).index!,right=observeContinuousFingerAngles(mirrored,mirroredBasis,1).index!;
    expect(right.angles).toEqual(left.angles);expect(right.mcpAbduction).toBeCloseTo(left.mcpAbduction);
  });
  it("uses two consecutive straight 2D samples to reject false world-depth PIP flexion",()=>{
    const world=Array.from({length:21},()=>p(0,0));world[0]=p(0,-1);world[17]=p(-1,0);
    world[5]=p(0,0);world[6]=p(0,.5);world[7]=p(0,1,.5);world[8]=p(0,1.5,1);
    const image=Array.from({length:21},()=>p(0,0));image[0]=p(0,-1);image[17]=p(-1,0);
    image[5]=p(0,0);image[6]=p(0,.5);image[7]=p(0,1);image[8]=p(0,1.5);
    const basis={across:{x:1,y:0,z:0},forward:{x:0,y:1,z:0},normal:{x:0,y:0,z:1}};
    const rig={side:"left",chains:[{finger:"index",segments:[{joint:"leftIndexProximal",flexAxisLocal:{x:1,y:0,z:0},hasChild:true},{joint:"leftIndexIntermediate",flexAxisLocal:{x:1,y:0,z:0},hasChild:true}],truncatedAtSegment:"Distal"}],controllableSegmentCount:2} satisfies HandFingerRig;
    const config=DEFAULT_AVATAR_MOTION_CONFIG.continuousFinger;
    const worldOnly=new ContinuousFingerSolver().solve(world,basis,1,100,100,rig,config).rotations.leftIndexIntermediate;
    const fusedSolver=new ContinuousFingerSolver();fusedSolver.solve(world,basis,1,100,100,rig,config,image,basis,1);
    const fused=fusedSolver.solve(world,basis,1,200,200,rig,config,image,basis,1).rotations.leftIndexIntermediate;
    expect(worldOnly).not.toEqual({x:0,y:0,z:0,w:1});
    expect(fused).toEqual({x:0,y:0,z:0,w:1});
  });
  it("never resets MCP from flattened 2D evidence",()=>{
    const world=Array.from({length:21},()=>p(0,0));world[0]=p(0,-1);world[17]=p(-1,0);world[5]=p(0,0);world[6]=p(0,.3,.95);world[7]=p(0,.6,1.9);world[8]=p(0,.9,2.85);
    const image=Array.from({length:21},()=>p(0,0));image[0]=p(0,-1);image[17]=p(-1,0);image[5]=p(0,0);image[6]=p(0,.5);image[7]=p(0,1);image[8]=p(0,1.5);
    const basis={across:{x:1,y:0,z:0},forward:{x:0,y:1,z:0},normal:{x:0,y:0,z:1}};
    const rig={side:"left",chains:[{finger:"index",segments:[{joint:"leftIndexProximal",flexAxisLocal:{x:1,y:0,z:0},hasChild:true}],truncatedAtSegment:"Intermediate"}],controllableSegmentCount:1} satisfies HandFingerRig;
    const solver=new ContinuousFingerSolver(),config=DEFAULT_AVATAR_MOTION_CONFIG.continuousFinger;solver.solve(world,basis,1,100,100,rig,config,image,basis,1);
    const result=solver.solve(world,basis,1,200,200,rig,config,image,basis,1);
    expect(result.diagnostics.leftIndexProximal?.imageExtensionOverride).toBe(false);
    expect(result.rotations.leftIndexProximal).not.toEqual({x:0,y:0,z:0,w:1});
  });
  it("rejects one-frame false extension and snaps to rest after extension is confirmed",()=>{
    const curled=Array.from({length:21},()=>p(0,0));
    curled[5]=p(0,1);curled[6]=p(0,2);curled[7]=p(1,2);curled[8]=p(2,2);
    const straight=Array.from({length:21},()=>p(0,0));
    straight[5]=p(1,1);straight[6]=p(1.3,2);straight[7]=p(1.6,3);straight[8]=p(1.9,4);
    const basis={across:{x:1,y:0,z:0},forward:{x:0,y:1,z:0},normal:{x:0,y:0,z:1}};
    const rig={side:"left",chains:[{finger:"index",segments:[
      {joint:"leftIndexProximal",flexAxisLocal:{x:1,y:0,z:0},hasChild:true},
      {joint:"leftIndexIntermediate",flexAxisLocal:{x:1,y:0,z:0},hasChild:true},
    ],truncatedAtSegment:"Distal"}],controllableSegmentCount:2} satisfies HandFingerRig;
    const solver=new ContinuousFingerSolver(),config=DEFAULT_AVATAR_MOTION_CONFIG.continuousFinger;
    const bent=solver.solve(curled,basis,1,100,100,rig,config).rotations.leftIndexIntermediate;
    expect(bent).not.toEqual({x:0,y:0,z:0,w:1});
    const oneFrame=solver.solve(straight,basis,1,200,200,rig,config).rotations.leftIndexIntermediate;
    expect(oneFrame).toEqual(bent);
    expect(solver.solve(straight,basis,1,300,300,rig,config).rotations.leftIndexIntermediate).toEqual({x:0,y:0,z:0,w:1});
  });
  it("does not feed generic MCP abduction into the thumb CMC",()=>{
    const hand=Array.from({length:21},()=>p(0,0));hand[0]=p(-1,-1);
    hand[1]=p(0,0);hand[2]=p(1,0);hand[3]=p(2,0);hand[4]=p(3,0);
    const basis={across:{x:1,y:0,z:0},forward:{x:0,y:1,z:0},normal:{x:0,y:0,z:1}};
    const rig={side:"left",chains:[{finger:"thumb",segments:[{joint:"leftThumbMetacarpal",flexAxisLocal:{x:1,y:0,z:0},abductionAxisLocal:{x:0,y:0,z:1},hasChild:true}],truncatedAtSegment:"Proximal"}],controllableSegmentCount:1} satisfies HandFingerRig;
    const result=new ContinuousFingerSolver().solve(hand,basis,1,100,100,rig,DEFAULT_AVATAR_MOTION_CONFIG.continuousFinger);
    expect(result.diagnostics.leftThumbMetacarpal?.observedAbductionRad).toBeGreaterThan(60*Math.PI/180);
    expect(result.diagnostics.leftThumbMetacarpal?.appliedAbductionRad).toBeNull();
    expect(result.rotations.leftThumbMetacarpal).toEqual({x:0,y:0,z:0,w:1});
  });
  it("subtracts the avatar rest spread before applying regular-finger abduction",()=>{
    const rest=.4,hand=Array.from({length:21},()=>p(0,0));hand[0]=p(0,-1);hand[17]=p(-1,0);
    hand[5]=p(0,0);hand[6]=p(Math.sin(rest),Math.cos(rest));hand[7]=p(2*Math.sin(rest),2*Math.cos(rest));hand[8]=p(3*Math.sin(rest),3*Math.cos(rest));
    const basis={across:{x:1,y:0,z:0},forward:{x:0,y:1,z:0},normal:{x:0,y:0,z:1}};
    const rig={side:"left",chains:[{finger:"index",segments:[{joint:"leftIndexProximal",flexAxisLocal:{x:1,y:0,z:0},abductionAxisLocal:{x:0,y:0,z:1},restAbductionRad:rest,abductionDirectionSign:1,hasChild:true}],truncatedAtSegment:"Intermediate"}],controllableSegmentCount:1} satisfies HandFingerRig;
    const result=new ContinuousFingerSolver().solve(hand,basis,1,100,100,rig,DEFAULT_AVATAR_MOTION_CONFIG.continuousFinger);
    expect(result.diagnostics.leftIndexProximal?.observedAbductionRad).toBeCloseTo(rest);
    expect(result.diagnostics.leftIndexProximal?.appliedAbductionRad).toBeCloseTo(0);
    expect(result.rotations.leftIndexProximal).toEqual({x:0,y:0,z:0,w:1});
  });
  it("keeps regular-finger abduction stable between detector samples",()=>{
    const spread=.35,hand=Array.from({length:21},()=>p(0,0));hand[0]=p(0,-1);hand[17]=p(-1,0);
    hand[5]=p(0,0);hand[6]=p(Math.sin(spread),Math.cos(spread));hand[7]=p(2*Math.sin(spread),2*Math.cos(spread));hand[8]=p(3*Math.sin(spread),3*Math.cos(spread));
    const basis={across:{x:1,y:0,z:0},forward:{x:0,y:1,z:0},normal:{x:0,y:0,z:1}};
    const rig={side:"left",chains:[{finger:"index",segments:[{joint:"leftIndexProximal",flexAxisLocal:{x:1,y:0,z:0},abductionAxisLocal:{x:0,y:0,z:1},restAbductionRad:0,abductionDirectionSign:1,hasChild:true}],truncatedAtSegment:"Intermediate"}],controllableSegmentCount:1} satisfies HandFingerRig;
    const solver=new ContinuousFingerSolver(),config=DEFAULT_AVATAR_MOTION_CONFIG.continuousFinger;
    const observed=solver.solve(hand,basis,1,100,100,rig,config);
    const betweenSamples=solver.solve(null,null,0,null,150,rig,config);
    expect(observed.diagnostics.leftIndexProximal?.source).toBe("observed");
    expect(betweenSamples.diagnostics.leftIndexProximal?.source).toBe("held");
    expect(betweenSamples.diagnostics.leftIndexProximal?.appliedAbductionRad).toBeCloseTo(observed.diagnostics.leftIndexProximal!.appliedAbductionRad!);
    expect(betweenSamples.rotations.leftIndexProximal).toEqual(observed.rotations.leftIndexProximal);
  });
  it("uses three curled fingers as an anatomical fallback for one occluded regular finger",()=>{
    const hand=Array.from({length:21},()=>p(0,0));hand[0]=p(0,-1);
    const roots=[5,9,13,17] as const;roots.forEach((root,fingerIndex)=>{const x=1-fingerIndex*.65;hand[root]=p(x,0);hand[root+1]=p(x,1);if(root===5){hand[root+2]=p(x,2);hand[root+3]=p(x,3);}else{hand[root+2]=p(x,1,1);hand[root+3]=p(x,0,1);}});
    const basis={across:{x:1,y:0,z:0},forward:{x:0,y:1,z:0},normal:{x:0,y:0,z:1}};
    const rig={side:"left",chains:[{finger:"index",segments:[{joint:"leftIndexProximal",flexAxisLocal:{x:1,y:0,z:0},hasChild:true},{joint:"leftIndexIntermediate",flexAxisLocal:{x:1,y:0,z:0},hasChild:true}],truncatedAtSegment:"Distal"}],controllableSegmentCount:2} satisfies HandFingerRig;
    const result=new ContinuousFingerSolver().solve(hand,basis,1,100,100,rig,DEFAULT_AVATAR_MOTION_CONFIG.continuousFinger);
    expect(result.diagnostics.leftIndexIntermediate?.anatomicalPriorApplied).toBe(true);
    expect(result.diagnostics.leftIndexIntermediate?.observedAngleRad).toBeGreaterThan(45*Math.PI/180);
    expect(result.rotations.leftIndexIntermediate).not.toEqual({x:0,y:0,z:0,w:1});
  });
  it("preserves an explicitly extended pointing finger instead of forcing fist consensus",()=>{
    const world=Array.from({length:21},()=>p(0,0));world[0]=p(0,-1);
    const roots=[5,9,13,17] as const;roots.forEach((root,fingerIndex)=>{const x=1-fingerIndex*.65;world[root]=p(x,0);world[root+1]=p(x,1);if(root===5){world[root+2]=p(x,2);world[root+3]=p(x,3);}else{world[root+2]=p(x,1,1);world[root+3]=p(x,0,1);}});
    const image=world.map(point=>({...point,z:0}));
    const basis={across:{x:1,y:0,z:0},forward:{x:0,y:1,z:0},normal:{x:0,y:0,z:1}};
    const rig={side:"left",chains:[{finger:"index",segments:[{joint:"leftIndexProximal",flexAxisLocal:{x:1,y:0,z:0},hasChild:true},{joint:"leftIndexIntermediate",flexAxisLocal:{x:1,y:0,z:0},hasChild:true}],truncatedAtSegment:"Distal"}],controllableSegmentCount:2} satisfies HandFingerRig;
    const solver=new ContinuousFingerSolver(),config=DEFAULT_AVATAR_MOTION_CONFIG.continuousFinger;solver.solve(world,basis,1,100,100,rig,config,image,basis,1);
    const result=solver.solve(world,basis,1,200,200,rig,config,image,basis,1);
    expect(result.diagnostics.leftIndexIntermediate?.imageExtensionOverride).toBe(true);
    expect(result.diagnostics.leftIndexProximal?.anatomicalPriorApplied).toBe(false);
    expect(result.diagnostics.leftIndexIntermediate?.anatomicalPriorApplied).toBe(false);
    expect(result.rotations.leftIndexIntermediate).toEqual({x:0,y:0,z:0,w:1});
  });
  it("uses timestamp lifecycle and emits exact rest instead of leaving a frozen renderer key",()=>{
    const hand=Array.from({length:21},(_,i)=>p((i%4)*.1,Math.floor(i/4)*.1));hand[5]=p(0,1);hand[6]=p(0,2);hand[7]=p(1,2);hand[8]=p(2,2);
    const basis={across:{x:1,y:0,z:0},forward:{x:0,y:1,z:0},normal:{x:0,y:0,z:1}};
    const rig={side:"left",chains:[{finger:"index",segments:[{joint:"leftIndexProximal",flexAxisLocal:{x:1,y:0,z:0},hasChild:true}],truncatedAtSegment:"Intermediate"}],controllableSegmentCount:1} satisfies HandFingerRig;
    const solver=new ContinuousFingerSolver(),config=DEFAULT_AVATAR_MOTION_CONFIG.continuousFinger;
    expect(solver.solve(hand,basis,1,100,100,rig,config).diagnostics.leftIndexProximal?.source).toBe("observed");
    expect(solver.solve(null,null,0,null,150,rig,config).diagnostics.leftIndexProximal?.source).toBe("held");
    expect(solver.solve(null,null,0,null,250,rig,config).diagnostics.leftIndexProximal?.source).toBe("predicted");
    const returned=solver.solve(null,null,0,null,600,rig,config);
    expect(returned.diagnostics.leftIndexProximal?.source).toBe("safe-return");
    expect(returned.rotations.leftIndexProximal).toEqual({x:0,y:0,z:0,w:1});
  });
});
