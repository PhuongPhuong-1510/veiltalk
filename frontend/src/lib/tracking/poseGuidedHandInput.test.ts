import { describe, expect, it } from "vitest";
import type { HandLandmarkerResult } from "@mediapipe/tasks-vision";
import { HandSensitivitySelector, mapHandResultFromInput, planPoseGuidedHandInput, type HandPoseHint } from "./poseGuidedHandInput";

function hint(leftX = .3, rightX = .7, shoulderX = [.4, .6], ageMs = 30): HandPoseHint {
  const landmarks = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 1 }));
  landmarks[11] = { x: shoulderX[0], y: .35, z: 0, visibility: 1 };
  landmarks[12] = { x: shoulderX[1], y: .35, z: 0, visibility: 1 };
  landmarks[15] = { x: leftX, y: .65, z: 0, visibility: 1 };
  landmarks[16] = { x: rightX, y: .65, z: 0, visibility: 1 };
  return { pose: { state: "tracked", sampledAtMs: 100, landmarks, worldLandmarks: null }, width: 1280, height: 720, ageMs };
}

const hands = (x: number, y: number): HandLandmarkerResult => ({
  landmarks: [Array.from({ length: 21 }, () => ({ x, y, z: .1, visibility: 1 }))],
  worldLandmarks: [Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }))],
  handedness: [[{ categoryName: "Left", displayName: "Left", score: .9, index: 0 }]],
  handednesses: [[{ categoryName: "Left", displayName: "Left", score: .9, index: 0 }]],
} as HandLandmarkerResult);

describe("Pose-guided Hand input", () => {
  it("falls back to full frame for old or unreliable Pose", () => {
    expect(planPoseGuidedHandInput(hint(.3, .7, [.4, .6], 121))).toBeNull();
    const weak = hint(); weak.pose.landmarks![11].visibility = .1;
    expect(planPoseGuidedHandInput(weak)).toBeNull();
  });

  it("uses one combined region when hands are close and split packing when apart", () => {
    expect(planPoseGuidedHandInput(hint(.47, .53))?.layout).toBe("combined");
    const split = planPoseGuidedHandInput(hint(.1, .9));
    expect(split?.layout).toBe("split");
    expect(split?.placements).toHaveLength(2);
  });

  it("restores image coordinates and rejects detections outside the selected hand region", () => {
    const plan = planPoseGuidedHandInput(hint(.3, .7))!;
    const placement = plan.placements[0];
    const sourceX = placement.region.wristX, sourceY = placement.region.wristY;
    const scale = placement.width / placement.region.width;
    const modelX = (placement.x + (sourceX - placement.region.x) * scale) / 512;
    const modelY = (placement.y + (sourceY - placement.region.y) * scale) / 512;
    const mapped = mapHandResultFromInput(hands(modelX, modelY), plan);
    expect(mapped.landmarks).toHaveLength(1);
    expect(mapped.landmarks[0][0].x).toBeCloseTo(.3);
    expect(mapped.landmarks[0][0].y).toBeCloseTo(.65);
    expect(mapped.worldLandmarks[0]).toHaveLength(21);
    expect(mapHandResultFromInput(hands(-.1, -.1), plan).landmarks).toHaveLength(0);
  });

  it("switches sensitivity with separate enter/exit thresholds and cooldown", () => {
    const selector = new HandSensitivitySelector();
    const far = planPoseGuidedHandInput(hint(.3, .7, [.45, .55]))!;
    const near = planPoseGuidedHandInput(hint(.3, .7, [.35, .65]))!;
    expect(selector.select(far, 100)).toBe("sensitive");
    expect(selector.select(near, 500)).toBe("sensitive");
    expect(selector.select(near, 1200)).toBe("normal");
    expect(selector.select(null, 1300)).toBe("normal");
  });
});
