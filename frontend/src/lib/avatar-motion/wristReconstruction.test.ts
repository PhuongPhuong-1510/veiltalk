import { describe, expect, it } from "vitest";
import { estimateShoulderImageToWorldScale, reconstructPointOnSphereFromImage } from "./wristReconstruction";

const lm = (x: number, y: number, z = 0, visibility = 1) => ({ x, y, z, visibility });

describe("wrist reconstruction", () => {
  it("estimates a local image-to-world scale from shoulder width", () => {
    const scale = estimateShoulderImageToWorldScale({
      leftShoulderWorld: lm(-.2, 0), rightShoulderWorld: lm(.2, 0),
      leftShoulderImage: lm(.3, .4), rightShoulderImage: lm(.7, .4),
      videoWidth: 1280, videoHeight: 720,
    });
    expect(scale).toBeCloseTo(1);
  });

  it("places the Hand wrist exactly on the lower-arm sphere and chooses prior depth sign", () => {
    const value = reconstructPointOnSphereFromImage({
      anchorWorld: { x: 0, y: 0, z: 0 }, anchorImage: lm(.5, .5), targetImage: lm(.8, .5),
      targetDistance: .5, imageToWorldScale: 1, previousDirection: { x: .6, y: 0, z: -.8 },
      videoWidth: 1280, videoHeight: 720, reachSlackRatio: .12,
    });
    expect(value.accepted).toBe(true);
    expect(Math.hypot(value.point!.x, value.point!.y, value.point!.z)).toBeCloseTo(.5);
    expect(value.point!.z).toBeLessThan(0);
  });

  it("rejects ambiguous depth without a prior", () => {
    const value = reconstructPointOnSphereFromImage({
      anchorWorld: { x: 0, y: 0, z: 0 }, anchorImage: lm(.5, .5), targetImage: lm(.6, .5),
      targetDistance: .5, imageToWorldScale: 1, previousDirection: null,
      videoWidth: 1280, videoHeight: 720, reachSlackRatio: .12,
    });
    expect(value.rejectionReason).toBe("missing-depth-prior");
  });

  it("rejects an image target beyond configured reach slack", () => {
    const value = reconstructPointOnSphereFromImage({
      anchorWorld: { x: 0, y: 0, z: 0 }, anchorImage: lm(.1, .5), targetImage: lm(.9, .5),
      targetDistance: .5, imageToWorldScale: 1, previousDirection: { x: 1, y: 0, z: 0 },
      videoWidth: 1280, videoHeight: 720, reachSlackRatio: .1,
    });
    expect(value.accepted).toBe(false);
    expect(value.rejectionReason).toBe("outside-reach-slack");
  });
});
