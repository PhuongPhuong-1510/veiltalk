import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { computeHandPalmBasis } from "./handPalmBasis";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";

const lm = (x: number, y: number, z = 0): RawNormalizedLandmarkV1 => ({ x, y, z, visibility: 1 });

/** landmarks[0]=wrist, [5]=indexMcp, [9]=middleMcp, [17]=pinkyMcp; các index khác không dùng nên để 0. */
function handLandmarks(overrides: { wrist?: RawNormalizedLandmarkV1; indexMcp?: RawNormalizedLandmarkV1; middleMcp?: RawNormalizedLandmarkV1; pinkyMcp?: RawNormalizedLandmarkV1 }): RawNormalizedLandmarkV1[] {
  const arr = Array.from({ length: 21 }, () => lm(0, 0, 0));
  arr[0] = overrides.wrist ?? lm(0, 0, 0);
  arr[5] = overrides.indexMcp ?? lm(1, 0, 0);
  arr[9] = overrides.middleMcp ?? lm(0.5, -1, 0);
  arr[17] = overrides.pinkyMcp ?? lm(-1, 0, 0);
  return arr;
}

const v = (data: { x: number; y: number; z: number }) => new Vector3(data.x, data.y, data.z);

describe("computeHandPalmBasis", () => {
  it("produces a valid, unit-length, orthogonal basis with cross(across, forward) = normal", () => {
    const landmarks = handLandmarks({});
    const result = computeHandPalmBasis(landmarks, landmarks, "left", 1280, 720);
    expect(result.imageRejectionReason).toBeNull();
    expect(result.worldRejectionReason).toBeNull();
    for (const basis of [result.imageBasis!, result.worldBasis!]) {
      const across = v(basis.across), forward = v(basis.forward), normal = v(basis.normal);
      expect(across.length()).toBeCloseTo(1, 5);
      expect(forward.length()).toBeCloseTo(1, 5);
      expect(normal.length()).toBeCloseTo(1, 5);
      expect(across.dot(forward)).toBeCloseTo(0, 5);
      expect(across.dot(normal)).toBeCloseTo(0, 5);
      expect(forward.dot(normal)).toBeCloseTo(0, 5);
      const cross = new Vector3().crossVectors(across, forward);
      expect(cross.x).toBeCloseTo(normal.x, 5);
      expect(cross.y).toBeCloseTo(normal.y, 5);
      expect(cross.z).toBeCloseTo(normal.z, 5);
    }
  });

  it("does not assume normalized X/Y share pixel scale: 16:9 aspect ratio changes the image basis versus a naive computation", () => {
    // across (index-pinky) không song song trục x/y, nên co giãn y không đều theo aspect ratio
    // xoay cả hướng across lẫn thành phần forward còn lại — không chỉ đổi độ dài của chúng.
    const landmarks = handLandmarks({ wrist: lm(0, 0), indexMcp: lm(0.1, -0.02), middleMcp: lm(0.03, -0.1), pinkyMcp: lm(-0.1, 0.03) });
    const wide = computeHandPalmBasis(landmarks, null, "left", 1920, 1080); // 16:9
    const square = computeHandPalmBasis(landmarks, null, "left", 1000, 1000);
    expect(wide.imageBasis).not.toBeNull();
    expect(square.imageBasis).not.toBeNull();
    expect(wide.imageBasis!.forward).not.toEqual(square.imageBasis!.forward);
  });

  it("does not assume normalized X/Y share pixel scale: 4:3 aspect ratio also changes the image basis", () => {
    const landmarks = handLandmarks({ wrist: lm(0, 0), indexMcp: lm(0.1, -0.02), middleMcp: lm(0.03, -0.1), pinkyMcp: lm(-0.1, 0.03) });
    const fourThree = computeHandPalmBasis(landmarks, null, "left", 1280, 960); // 4:3
    const square = computeHandPalmBasis(landmarks, null, "left", 1000, 1000);
    expect(fourThree.imageBasis!.forward).not.toEqual(square.imageBasis!.forward);
  });

  it("changing the z coordinate of image landmarks does not change the 2D image basis", () => {
    // Image basis chỉ là basis trên mặt phẳng ảnh — z không phải trục pixel, phải bị bỏ qua
    // hoàn toàn khi dựng imageBasis (khác worldBasis là basis 3D thật).
    const flat = handLandmarks({ wrist: lm(0, 0, 0), indexMcp: lm(0.1, -0.02, 0), middleMcp: lm(0.03, -0.1, 0), pinkyMcp: lm(-0.1, 0.03, 0) });
    const withDepth = handLandmarks({ wrist: lm(0, 0, 0.5), indexMcp: lm(0.1, -0.02, -0.3), middleMcp: lm(0.03, -0.1, 0.8), pinkyMcp: lm(-0.1, 0.03, -0.6) });
    const flatResult = computeHandPalmBasis(flat, null, "left", 1280, 720);
    const depthResult = computeHandPalmBasis(withDepth, null, "left", 1280, 720);
    expect(flatResult.imageBasis).toEqual(depthResult.imageBasis);
    expect(flatResult.imageBasis!.across.z).toBe(0);
    expect(flatResult.imageBasis!.forward.z).toBe(0);
  });

  it("world basis still reacts to changes in z (it is a real 3D basis, unlike the image basis)", () => {
    const flat = handLandmarks({ wrist: lm(0, 0, 0), indexMcp: lm(0.1, -0.02, 0), middleMcp: lm(0.03, -0.1, 0), pinkyMcp: lm(-0.1, 0.03, 0) });
    const withDepth = handLandmarks({ wrist: lm(0, 0, 0.5), indexMcp: lm(0.1, -0.02, -0.3), middleMcp: lm(0.03, -0.1, 0.8), pinkyMcp: lm(-0.1, 0.03, -0.6) });
    const flatResult = computeHandPalmBasis(null, flat, "left", 1280, 720);
    const depthResult = computeHandPalmBasis(null, withDepth, "left", 1280, 720);
    expect(flatResult.worldBasis).not.toEqual(depthResult.worldBasis);
  });

  it("rejects missing landmarks", () => {
    const shortArray: RawNormalizedLandmarkV1[] = [lm(0, 0), lm(1, 0)]; // thiếu middleMcp/pinkyMcp
    const result = computeHandPalmBasis(shortArray, shortArray, "left", 1280, 720);
    expect(result.imageBasis).toBeNull();
    expect(result.imageRejectionReason).toBe("missing-landmarks");
    expect(result.worldBasis).toBeNull();
    expect(result.worldRejectionReason).toBe("missing-landmarks");
  });

  it("rejects non-finite landmark coordinates", () => {
    const landmarks = handLandmarks({ indexMcp: lm(Number.NaN, 0) });
    const result = computeHandPalmBasis(landmarks, landmarks, "left", 1280, 720);
    expect(result.imageRejectionReason).toBe("non-finite");
    expect(result.worldRejectionReason).toBe("non-finite");
  });

  it("rejects zero-length across vector (index and pinky MCP coincide)", () => {
    const landmarks = handLandmarks({ indexMcp: lm(0, 0), pinkyMcp: lm(0, 0), wrist: lm(0, 0), middleMcp: lm(0, -1) });
    const result = computeHandPalmBasis(landmarks, landmarks, "left", 1280, 720);
    expect(result.imageRejectionReason).toBe("across-too-small");
  });

  it("rejects zero-length forward vector (middle MCP coincides with wrist)", () => {
    const landmarks = handLandmarks({ wrist: lm(0, 0), middleMcp: lm(0, 0) });
    const result = computeHandPalmBasis(landmarks, landmarks, "left", 1280, 720);
    expect(result.imageRejectionReason).toBe("forward-too-small");
  });

  it("rejects collinear landmarks (degenerate triangle / edge-on palm)", () => {
    // wrist, indexMcp, middleMcp, pinkyMcp đều nằm trên một đường thẳng.
    const landmarks = handLandmarks({ wrist: lm(0, 0), indexMcp: lm(1, 0), middleMcp: lm(0.5, 0), pinkyMcp: lm(-1, 0) });
    const result = computeHandPalmBasis(landmarks, landmarks, "left", 1280, 720);
    expect(["area-too-small", "gram-schmidt-degenerate"]).toContain(result.imageRejectionReason);
    expect(result.imageBasis).toBeNull();
  });

  it("rejects invalid video dimensions for the image basis without touching the world basis", () => {
    const landmarks = handLandmarks({});
    const result = computeHandPalmBasis(landmarks, landmarks, "left", 0, 720);
    expect(result.imageRejectionReason).toBe("invalid-video-size");
    expect(result.imageBasis).toBeNull();
    expect(result.worldRejectionReason).toBeNull();
    expect(result.worldBasis).not.toBeNull();
  });

  it("image basis fails while world basis still passes (image landmarks degenerate, world landmarks fine)", () => {
    const degenerateImage = handLandmarks({ wrist: lm(0, 0), indexMcp: lm(1, 0), middleMcp: lm(0.5, 0), pinkyMcp: lm(-1, 0) });
    const goodWorld = handLandmarks({});
    const result = computeHandPalmBasis(degenerateImage, goodWorld, "left", 1280, 720);
    expect(result.imageBasis).toBeNull();
    expect(result.imageRejectionReason).not.toBeNull();
    expect(result.worldBasis).not.toBeNull();
    expect(result.worldRejectionReason).toBeNull();
  });

  it("world basis fails while image basis still passes (world landmarks unavailable, image landmarks fine)", () => {
    const goodImage = handLandmarks({});
    const result = computeHandPalmBasis(goodImage, null, "left", 1280, 720);
    expect(result.worldBasis).toBeNull();
    expect(result.worldRejectionReason).toBe("world-landmarks-unavailable");
    expect(result.imageBasis).not.toBeNull();
    expect(result.imageRejectionReason).toBeNull();
  });

  it("world basis fails with degenerate world landmarks while image basis (independent landmarks) passes", () => {
    const goodImage = handLandmarks({});
    const degenerateWorld = handLandmarks({ wrist: lm(0, 0), indexMcp: lm(1, 0), middleMcp: lm(0.5, 0), pinkyMcp: lm(-1, 0) });
    const result = computeHandPalmBasis(goodImage, degenerateWorld, "left", 1280, 720);
    expect(result.imageBasis).not.toBeNull();
    expect(result.worldBasis).toBeNull();
    expect(["area-too-small", "world-basis-degenerate"]).toContain(result.worldRejectionReason);
  });

  it("handedness does not alter the raw basis vectors (no sign flip in Việc 2)", () => {
    const landmarks = handLandmarks({});
    const left = computeHandPalmBasis(landmarks, landmarks, "left", 1280, 720);
    const right = computeHandPalmBasis(landmarks, landmarks, "right", 1280, 720);
    const unknown = computeHandPalmBasis(landmarks, landmarks, "unknown", 1280, 720);
    expect(left.imageBasis).toEqual(right.imageBasis);
    expect(left.imageBasis).toEqual(unknown.imageBasis);
    expect(left.worldBasis).toEqual(right.worldBasis);
    expect(left.handedness).toBe("left");
    expect(right.handedness).toBe("right");
    expect(unknown.handedness).toBe("unknown");
  });

  it("never produces a quaternion field or touches pole/jointRotations shape", () => {
    const landmarks = handLandmarks({});
    const result = computeHandPalmBasis(landmarks, landmarks, "left", 1280, 720);
    expect(result).not.toHaveProperty("quaternion");
    expect(result).not.toHaveProperty("pole");
    expect(result).not.toHaveProperty("jointRotations");
  });

  it("reports independent geometry quality scores for image and world basis", () => {
    const landmarks = handLandmarks({});
    const result = computeHandPalmBasis(landmarks, landmarks, "left", 1280, 720);
    expect(result.imageGeometryQuality).toBeGreaterThan(0);
    expect(result.worldGeometryQuality).toBeGreaterThan(0);
  });

  it("geometry quality decreases as across and forward become nearly parallel", () => {
    // Toạ độ vuông (videoWidth === videoHeight) để phép sửa aspect ratio không đổi hình dạng
    // tam giác trên mặt phẳng ảnh — cùng một cấu hình hình học cho cả image lẫn world.
    // wellSeparated: forward (0.5,-1) gần vuông góc với across (2,0) -> quality cao.
    const wellSeparated = handLandmarks({ wrist: lm(0, 0), indexMcp: lm(1, 0), middleMcp: lm(0.5, -1), pinkyMcp: lm(-1, 0) });
    // nearlyParallel: forward (1,-0.05) gần song song với across (2,0) -> phần vuông góc còn lại rất nhỏ.
    const nearlyParallel = handLandmarks({ wrist: lm(0, 0), indexMcp: lm(1, 0), middleMcp: lm(1, -0.05), pinkyMcp: lm(-1, 0) });
    const goodResult = computeHandPalmBasis(wellSeparated, wellSeparated, "left", 1000, 1000);
    const badResult = computeHandPalmBasis(nearlyParallel, nearlyParallel, "left", 1000, 1000);
    expect(badResult.imageGeometryQuality).toBeLessThan(goodResult.imageGeometryQuality);
    expect(badResult.worldGeometryQuality).toBeLessThan(goodResult.worldGeometryQuality);
  });
});
