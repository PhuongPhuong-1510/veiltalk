import { describe, expect, it } from "vitest";
import { ContactDepthRegistration, fitImageWorldScale, registeredContactDepth, type ContactRegistrationDiagnostic } from "./contactDepthRegistration";
import { createSyntheticMotionRecording } from "./syntheticMotionRecording";
import { buildHumanFaceContactSurface, locateHumanFaceSurface } from "./humanFaceContactSurface";

const point = (x: number, y: number, z = 0) => ({ x, y, z, visibility: null });
const registration = (changes: Partial<ContactRegistrationDiagnostic> = {}): ContactRegistrationDiagnostic => ({
  source: "weak-perspective-wrist-nose-registration", reason: "registered-relative", samples: 5, sampleSkewMs: 0, handImageScale: 1, poseImageScale: 1,
  reprojectionRms: .01, wristMismatch: .01, signedGapFaceHeights: .04, uncertaintyFaceHeights: .12, quality: .8,
  correlatedSources: ["pose-wrist-nose", "hand-local-shape", "face-local-shape"], ...changes,
});
describe("registered contact depth", () => {
  it("counts distinct synchronized samples, rejects stale data and resets after detector gaps",()=>{
    const registration=new ContactDepthRegistration(),frames=createSyntheticMotionRecording("face-cheek",{},8).frames;
    const update=(index:number,nowOffset=0)=>{const f=frames[index].raw,hand=f.leftHand,surface=buildHumanFaceContactSurface(f.face.landmarks,f.videoWidth!,f.videoHeight!)!,p=f.face.landmarks![425],location=locateHumanFaceSurface(surface,{x:p.x,y:p.y*f.videoHeight!/f.videoWidth!})!;
      return registration.update(f,"left",hand.landmarks,hand.worldLandmarks,f.frameTimestampMs,f.frameTimestampMs+nowOffset,surface,location,"palmCenter");};
    expect(update(0).samples).toBe(1);expect(update(0).reason).toBe("duplicate-or-reversed");
    expect(update(1).samples).toBe(2);expect(update(2).samples).toBe(3);const fourth=update(3);expect(fourth.samples).toBe(4);expect(fourth.signedGapFaceHeights).not.toBeNull();expect(fourth.uncertaintyFaceHeights!).toBeGreaterThanOrEqual(.1);
    expect(update(4,200).reason).toBe("stale-or-skewed");expect(update(5).samples).toBe(1);
    registration.reset();expect(update(6).samples).toBe(1);
  });
  it("refuses absent world data, cross-detector skew and unobserved Pose wrists",()=>{
    for(const condition of ["world","skew","visibility"]){const frame=createSyntheticMotionRecording("face-cheek",{},1).frames[0].raw,surface=buildHumanFaceContactSurface(frame.face.landmarks,1280,720)!,p=frame.face.landmarks![425],location=locateHumanFaceSurface(surface,{x:p.x,y:p.y*720/1280})!;
      if(condition==="skew")frame.face.sampledAtMs!-=120;if(condition==="visibility")frame.pose.landmarks![15].visibility=0;
      const result=new ContactDepthRegistration().update(frame,"left",frame.leftHand.landmarks,condition==="world"?null:frame.leftHand.worldLandmarks,frame.frameTimestampMs,frame.frameTimestampMs,surface,location,"palmCenter");
      if(condition==="world")expect(result.reason).toBe("missing-hand-world");
      expect(result.quality).toBe(0);expect(result.samples).toBe(0);expect(result.signedGapFaceHeights).toBeNull();}
  });
  it("fits centered scale independent of image/world origins and aspect ratio", () => {
    const world = [point(-.1, .05), point(.2, .1), point(.05, -.2), point(0, .3)];
    const image = world.map(p => point(.6 + p.x * .7, (.4 + p.y * .7) / .5625, 999));
    const fit = fitImageWorldScale(image, world, [0, 1, 2, 3], .5625)!;
    expect(fit.scale).toBeCloseTo(.7, 6); expect(fit.rms).toBeLessThan(1e-7);
    expect(fitImageWorldScale(image.map(p => ({ ...p, x: -p.x, y: -p.y })), world, [0, 1, 2, 3], .5625)).toBeNull();
  });
  it("requires valid registration, measured orientation and temporal corroboration", () => {
    expect(registeredContactDepth(registration(), .9, .9, .9).relation).toBe("surface-compatible");
    for (const input of [registration({ samples: 1 }), registration({ reason: "depth-uncertain" }), registration({ signedGapFaceHeights: .25 })]) expect(registeredContactDepth(input, .9, .9, 1).relation).toBe("unknown");
    expect(registeredContactDepth(registration(), null, .9, 1).relation).toBe("unknown");
    expect(registeredContactDepth(registration(), .9, null, 1).relation).toBe("unknown");
  });
  it("does not count the Pose prior a second time and rejects clear separated ordering", () => {
    const evidence = registeredContactDepth(registration(), .9, .9, 1);
    expect(evidence.sources.posePrior).toBeNull();
    expect(registeredContactDepth(registration({ signedGapFaceHeights: -.8 }), .9, .9, 1).relation).toBe("in-front-separated");
    expect(registeredContactDepth(registration({ signedGapFaceHeights: .8 }), .9, .9, 1).relation).toBe("behind");
  });
});
