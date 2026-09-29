import{describe,expect,it}from"vitest";
import{InterArmDepthOrderingTracker}from"./interArmDepthOrdering";

describe("inter-arm depth ordering",()=>{
  it("confirms only on distinct detector samples",()=>{
    const tracker=new InterArmDepthOrderingTracker();
    const input={leftWristZ:.3,rightWristZ:0,depthThreshold:.1,leftTrust:1,rightTrust:1};
    expect(tracker.update({...input,sampledAtMs:100}).ordering).toBeNull();
    expect(tracker.update({...input,sampledAtMs:100}).ordering).toBeNull();
    expect(tracker.update({...input,sampledAtMs:133}).ordering).toBe("left-front");
  });
  it("requires more evidence when either wrist is reconstructed",()=>{
    const tracker=new InterArmDepthOrderingTracker();
    const input={leftWristZ:-.3,rightWristZ:0,depthThreshold:.1,leftTrust:.5,rightTrust:1};
    expect(tracker.update({...input,sampledAtMs:100}).ordering).toBeNull();
    expect(tracker.update({...input,sampledAtMs:133}).ordering).toBeNull();
    expect(tracker.update({...input,sampledAtMs:166}).ordering).toBe("right-front");
  });
});
