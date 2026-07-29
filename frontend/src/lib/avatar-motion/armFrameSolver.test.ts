import { Quaternion, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import { solveAnatomicalArmFrames, type ArmGeometryHistory } from "./armFrameSolver";
import { DEFAULT_AVATAR_MOTION_CONFIG } from "./motionConfig";
import type { NormalizedAvatarRigProfile } from "./normalizedRigProfile";
import { vector } from "./motionMath";
import { createDebugPreset, type DebugPresetName } from "../avatar-renderer/avatarDiagnostics";

const identity = { x: 0, y: 0, z: 0, w: 1 }; const zero = { x: 0, y: 0, z: 0 };
const leftBasis = { primaryLocal: { x: 1, y: 0, z: 0 }, secondaryLocal: { x: 0, y: 1, z: 0 }, binormalLocal: { x: 0, y: 0, z: 1 }, primaryWorld: { x: 1, y: 0, z: 0 }, secondaryWorld: { x: 0, y: 1, z: 0 }, binormalWorld: { x: 0, y: 0, z: 1 }, worldRotation: identity };
const rightBasis = { primaryLocal: { x: -1, y: 0, z: 0 }, secondaryLocal: { x: 0, y: 1, z: 0 }, binormalLocal: { x: 0, y: 0, z: -1 }, primaryWorld: { x: -1, y: 0, z: 0 }, secondaryWorld: { x: 0, y: 1, z: 0 }, binormalWorld: { x: 0, y: 0, z: -1 }, worldRotation: { x: 0, y: 1, z: 0, w: 0 } };
const profile: NormalizedAvatarRigProfile = { version: 1, modelGeneration: 1, modelFingerprint: "test", torsoReference: { rightWorld: { x: 1, y: 0, z: 0 }, upWorld: { x: 0, y: 1, z: 0 }, forwardWorld: { x: 0, y: 0, z: 1 }, worldRotation: identity }, joints: {
  leftUpperArm: { parentJoint: "leftShoulder", childJoint: "leftLowerArm", parentMode: "fixed-rest", controlledParentJoint: null, restLocalPosition: zero, restLocalRotation: identity, restWorldPosition: zero, restWorldRotation: identity, parentRestWorldRotation: identity, restWorldDirection: leftBasis.primaryWorld, anatomicalRestBasis: leftBasis },
  leftLowerArm: { parentJoint: "leftUpperArm", childJoint: "leftHand", parentMode: "controlled", controlledParentJoint: "leftUpperArm", restLocalPosition: zero, restLocalRotation: identity, restWorldPosition: zero, restWorldRotation: identity, parentRestWorldRotation: identity, restWorldDirection: leftBasis.primaryWorld, anatomicalRestBasis: leftBasis },
  rightUpperArm: { parentJoint: "rightShoulder", childJoint: "rightLowerArm", parentMode: "fixed-rest", controlledParentJoint: null, restLocalPosition: zero, restLocalRotation: identity, restWorldPosition: zero, restWorldRotation: identity, parentRestWorldRotation: identity, restWorldDirection: rightBasis.primaryWorld, anatomicalRestBasis: rightBasis },
  rightLowerArm: { parentJoint: "rightUpperArm", childJoint: "rightHand", parentMode: "controlled", controlledParentJoint: "rightUpperArm", restLocalPosition: zero, restLocalRotation: identity, restWorldPosition: zero, restWorldRotation: identity, parentRestWorldRotation: identity, restWorldDirection: rightBasis.primaryWorld, anatomicalRestBasis: rightBasis },
} };
const lm = (x: number, y: number, z = 0): RawNormalizedLandmarkV1 => ({ x, y: -y, z: -z, visibility: 1 });
const q3 = (value: { x: number; y: number; z: number; w: number }) => new Quaternion(value.x, value.y, value.z, value.w);
const frame = (straight = false) => { const p = Array.from({ length: 33 }, () => lm(0, 0)); p[11] = lm(0, 0); p[13] = lm(1, 0); p[15] = straight ? lm(2, 0) : lm(1, 1); p[12] = lm(0, 0); p[14] = lm(-1, 0); p[16] = straight ? lm(-2, 0) : lm(-1, 1); p[23] = lm(.2, -1); p[24] = lm(-.2, -1); return p; };
const imageFrame = (world: RawNormalizedLandmarkV1[]) => world.map((point) => ({ ...point, x: .5 + point.x * .2, y: .5 + point.y * .2 }));
const emptyHistory = (): ArmGeometryHistory => ({ previousPole: null, previousPoleWasFresh: false, previousDepthDegenerate: false, lastValidPoleAtMs: null });
describe("three-point anatomical arm-frame solver", () => {
  it("initial opposite elbow pole cannot roll either upperArm 180° away from its minimal-twist rest branch", () => {
    // `frame()` giữ upper direction đúng rest (±X) nhưng elbow-offset pole chiếu thành -Y,
    // đối dấu với rest secondary +Y. Không có history ở frame đầu: nếu nhận nhánh -Y trực tiếp,
    // full frame sẽ tạo axial roll 180° dù bắp tay không đổi hướng.
    const world = frame();
    const solved = solveAnatomicalArmFrames(
      world,
      imageFrame(world),
      profile,
      { left: emptyHistory(), right: emptyHistory() },
      0,
      DEFAULT_AVATAR_MOTION_CONFIG.armFrame,
      false,
    );
    for (const side of ["left", "right"] as const) {
      const result = solved.sides[side]!;
      expect(result.poleSource).toBe("fresh");
      expect(vector(result.secondary.upper).dot(new Vector3(0, 1, 0))).toBeGreaterThan(0.99);
      expect(result.diagnostic.confidenceFlags).toContain("upper-secondary-minimal-twist");
      const upperName = side === "left" ? "leftUpperArm" : "rightUpperArm";
      expect(q3(result.deltas[upperName]!).angleTo(new Quaternion())).toBeLessThan(1e-6);
    }
  });

  it("fresh pole 90° from rest cannot inject axial roll into an otherwise unchanged upperArm direction", () => {
    // Upper direction vẫn đúng rest (±X), nhưng wrist đi theo Z làm elbow-offset pole chiếu
    // thành ±Z. Hemisphere correction không xử lý trường hợp dot=0 này; nếu pole còn điều khiển
    // upper secondary, vai sẽ roll 90° dù hướng bắp tay không đổi.
    const world = frame();
    world[15] = lm(1, 0, 1);
    world[16] = lm(-1, 0, 1);
    const solved = solveAnatomicalArmFrames(
      world,
      imageFrame(world),
      profile,
      { left: emptyHistory(), right: emptyHistory() },
      0,
      DEFAULT_AVATAR_MOTION_CONFIG.armFrame,
      false,
    );
    for (const side of ["left", "right"] as const) {
      const result = solved.sides[side]!;
      expect(result.poleSource).toBe("fresh");
      expect(vector(result.secondary.upper).dot(new Vector3(0, 1, 0))).toBeGreaterThan(0.99);
      expect(result.diagnostic.confidenceFlags).toContain("upper-secondary-minimal-twist");
      const upperName = side === "left" ? "leftUpperArm" : "rightUpperArm";
      expect(q3(result.deltas[upperName]!).angleTo(new Quaternion())).toBeLessThan(1e-6);
    }
  });

  it("matches upper/lower directions and uses a fresh elbow-offset pole", () => {
    const world = frame(); const result = solveAnatomicalArmFrames(world, imageFrame(world), profile, { left: emptyHistory(), right: emptyHistory() }, 0, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false);
    for (const side of ["left", "right"] as const) {
      const solved = result.sides[side]!; expect(solved.poleSource).toBe("fresh");
      const upperName = side === "left" ? "leftUpperArm" : "rightUpperArm"; const lowerName = side === "left" ? "leftLowerArm" : "rightLowerArm";
      const upperDirection = new Vector3(side === "left" ? 1 : -1, 0, 0).applyQuaternion(q3(solved.targetWorldRotations[upperName]!));
      const lowerDirection = new Vector3(side === "left" ? 1 : -1, 0, 0).applyQuaternion(q3(solved.targetWorldRotations[lowerName]!));
      expect(upperDirection.angleTo(new Vector3(side === "left" ? 1 : -1, 0, 0))).toBeLessThan(1e-6); expect(lowerDirection.angleTo(new Vector3(0, 1, 0))).toBeLessThan(1e-6);
    }
  });
  it("uses previous pole near straight, then rest pole after timeout", () => {
    const previous = { previousPole: { x: 0, y: 1, z: 0 }, previousPoleWasFresh: true, previousDepthDegenerate: false, lastValidPoleAtMs: 0 }; const world = frame(true);
    expect(solveAnatomicalArmFrames(world, imageFrame(world), profile, { left: previous, right: previous }, 100, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false).sides.left?.poleSource).toBe("previous");
    expect(solveAnatomicalArmFrames(world, imageFrame(world), profile, { left: previous, right: previous }, 1_000, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false).sides.left?.poleSource).toBe("rest");
  });
  it.each(["tPose", "armsDown", "leftArmUp", "rightArmUp", "leftElbow90", "rightElbow90"] as DebugPresetName[])("keeps Phase 2 direction accuracy for %s", (preset) => {
    const landmarks = createDebugPreset(preset).pose.worldLandmarks!;
    const image = createDebugPreset(preset).pose.landmarks!; const result = solveAnatomicalArmFrames(landmarks, image, profile, { left: emptyHistory(), right: emptyHistory() }, 0, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false);
    for (const side of ["left", "right"] as const) {
      const indices = side === "left" ? { shoulder: 11, elbow: 13, wrist: 15, upper: "leftUpperArm" as const, lower: "leftLowerArm" as const, rest: new Vector3(1, 0, 0) } : { shoulder: 12, elbow: 14, wrist: 16, upper: "rightUpperArm" as const, lower: "rightLowerArm" as const, rest: new Vector3(-1, 0, 0) };
      const semantic = (index: number) => new Vector3(landmarks[index].x, -landmarks[index].y, -landmarks[index].z);
      const upperTarget = semantic(indices.elbow).sub(semantic(indices.shoulder)).normalize(); const lowerTarget = semantic(indices.wrist).sub(semantic(indices.elbow)).normalize(); const solved = result.sides[side]!;
      expect(indices.rest.clone().applyQuaternion(q3(solved.targetWorldRotations[indices.upper]!)).angleTo(upperTarget) * 180 / Math.PI).toBeLessThanOrEqual(3);
      expect(indices.rest.clone().applyQuaternion(q3(solved.targetWorldRotations[indices.lower]!)).angleTo(lowerTarget) * 180 / Math.PI).toBeLessThanOrEqual(3);
    }
  });
  it("rejects a zero-length segment without NaN", () => {
    const points = frame(); points[13] = points[11]; expect(solveAnatomicalArmFrames(points, imageFrame(points), profile, { left: emptyHistory(), right: emptyHistory() }, 0, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false).sides.left).toBeNull();
  });
  it("keeps upper tracking when its wrist leaves image bounds and does not update lower/pole filters", () => {
    const world = frame(), image = imageFrame(world); image[15].x = 1.2; const directionFilter = vi.fn((_name, value) => value), poleFilter = vi.fn((_side, value) => value);
    const result = solveAnatomicalArmFrames(world, image, profile, { left: emptyHistory(), right: emptyHistory() }, 0, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false, directionFilter, poleFilter);
    expect(result.sides.left?.segmentValidity).toEqual({ upper: true, lower: false }); expect(result.diagnostics.left.observation.lowerRejectionReason).toBe("wrist-outside-frame"); expect(result.sides.right).not.toBeNull();
    expect(directionFilter.mock.calls.some(([name]) => name === "leftUpperArm")).toBe(true); expect(directionFilter.mock.calls.some(([name]) => name === "leftLowerArm")).toBe(false); expect(poleFilter.mock.calls.every(([side]) => side === "right")).toBe(true);
  });
  it("keeps primary tracking but falls back from a depth-degenerate fresh pole", () => {
    const world = frame(); world[11] = lm(0, 0, 0); world[13] = lm(.2, 0, .5); world[15] = lm(0, 0, 1); const image = imageFrame(world);
    const previous = { previousPole: { x: 0, y: 1, z: 0 }, previousPoleWasFresh: true, previousDepthDegenerate: false, lastValidPoleAtMs: 0 };
    const result = solveAnatomicalArmFrames(world, image, profile, { left: previous, right: emptyHistory() }, 100, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false);
    expect(result.sides.left?.poleSource).toBe("previous"); expect(result.diagnostics.left.confidenceFlags).toContain("depth-degenerate");
    const armAxis = new Vector3(0, 0, 1); const projected = result.sides.left!.acceptedPole; expect(Math.abs(armAxis.dot(new Vector3(projected.x, projected.y, projected.z)))).toBeLessThan(1e-6);
  });
  it("accepts a partially-trusted observed pole in the widened smoothstep zone instead of snapping to rest (A2)", () => {
    // A2 (theo tư vấn chuyên gia): trước đây depthAlignment=0.894 nằm dưới ngưỡng nhị phân cũ
    // 0.9 nhưng đã đo được weight liên tục (depthQuality*bendPlaneQuality) rơi gần 0 nếu tái
    // dùng khoảng smoothstep hẹp (0.82–0.90) — hành vi thực tế không khác gì vách đá cũ. Với
    // khoảng rộng hơn (depthQualityFullTrustAlignment=0.75, depthQualityNoTrustAlignment=0.95)
    // theo đúng con số chuyên gia đề xuất, cùng dữ liệu này phải chấp nhận pole quan sát.
    const world = Array.from({ length: 33 }, () => lm(0, 0));
    world[11] = lm(.2, 0); world[13] = lm(.35, -.05, .15); world[15] = lm(.35, 0, .3);
    world[12] = lm(-.2, 0); world[14] = lm(-.5, 0); world[16] = lm(-.5, -.3);
    world[23] = lm(.15, .55); world[24] = lm(-.15, .55);
    const image = imageFrame(world);
    const result = solveAnatomicalArmFrames(world, image, profile, { left: emptyHistory(), right: emptyHistory() }, 0, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false);
    expect(result.diagnostics.left.depthAlignment).toBeGreaterThan(0.85);
    expect(result.diagnostics.left.depthAlignment).toBeLessThan(0.92);
    expect(result.sides.left?.poleSource).toBe("fresh");
    expect(result.diagnostics.left.observation.poleValid).toBe(true);
  });
  it("falls back to a hand-derived pole when the arm is fully depth-degenerate but fingers are visible (A3+A5)", () => {
    // A3+A5 (theo tư vấn chuyên gia): tay chĩa thẳng vào camera như preset bothForward —
    // depthAlignment=1.0 tuyệt đối, elbow-offset không cho pole dùng được (weak-elbow-offset).
    // Trước đây rơi thẳng về pole "rest" (hằng số, không phải quan sát thật). Index/pinky
    // (landmark 19/17, có sẵn trong MediaPipe Pose 33 điểm, không cần Hand Landmarker) vẫn
    // quan sát được ⇒ solver phải dùng chúng thay vì bỏ phí, cho poleSource="hand".
    const world = frame();
    world[13] = lm(.2, 0, -.3); world[15] = lm(.2, 0, -.6);
    world[14] = lm(-.2, 0, -.3); world[16] = lm(-.2, 0, -.6);
    const withoutFingers = solveAnatomicalArmFrames(world, imageFrame(world), profile, { left: emptyHistory(), right: emptyHistory() }, 0, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false);
    expect(withoutFingers.diagnostics.left.confidenceFlags).toContain("depth-degenerate");
    expect(withoutFingers.sides.left?.poleSource).toBe("rest");

    // Bàn tay thò ra xa hơn cổ tay theo hướng cánh tay đưa tới (z sâu hơn), lệch trục x/y để
    // index/pinky không trùng nhau — mô phỏng bàn tay nghiêng thật, không phải điểm suy biến.
    const withHands = structuredClone(world);
    withHands[19] = lm(.25, .05, -.7); withHands[17] = lm(.15, -.05, -.7);
    const withFingers = solveAnatomicalArmFrames(withHands, imageFrame(withHands), profile, { left: emptyHistory(), right: emptyHistory() }, 0, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false);
    expect(withFingers.sides.left?.poleSource).toBe("hand");
    expect(withFingers.diagnostics.left.observation.poleValid).toBe(true);
  });
  it("ignores hand landmarks when fingers are not visible and falls back to rest as before (A5 does not regress the base case)", () => {
    // Bảo vệ hành vi cũ khi không có dữ liệu bàn tay: preset bothForward gốc (không set
    // index/pinky, visibility mặc định null) vẫn phải rơi về "rest" như trước A3/A5.
    const world = frame();
    world[13] = lm(.2, 0, -.3); world[15] = lm(.2, 0, -.6);
    world[14] = lm(-.2, 0, -.3); world[16] = lm(-.2, 0, -.6);
    const result = solveAnatomicalArmFrames(world, imageFrame(world), profile, { left: emptyHistory(), right: emptyHistory() }, 0, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false);
    expect(result.sides.left?.poleSource).toBe("rest");
  });
  it("does not flip the observed-pole weight decision on the same frame data, only on prior trust state (A4)", () => {
    // A4 (theo tư vấn chuyên gia): "không đổi mode chỉ vì một frame". Trước khi có hysteresis
    // cho `observedPoleWeight`, thời gian giữa các frame vượt `poleFallbackTimeoutMs` (nên
    // pole "previous" không kịp cứu) khiến weight dao động nhẹ quanh MỘT ngưỡng duy nhất làm
    // poleSource nhảy liên tục fresh↔rest — đo được hiện tượng này trước khi sửa. zDepth=.36
    // cho weight≈0.0368, nằm giữa Exit=0.03 và Enter=0.08 — CÙNG một dữ liệu phải cho kết quả
    // khác nhau tuỳ trạng thái tin cậy trước đó, không phải hằng số.
    const world = Array.from({ length: 33 }, () => lm(0, 0));
    const zDepth = .36;
    world[11] = lm(.2, 0); world[13] = lm(.35, -.05, zDepth * .5); world[15] = lm(.35, 0, zDepth);
    world[12] = lm(-.2, 0); world[14] = lm(-.5, 0); world[16] = lm(-.5, -.3);
    world[23] = lm(.15, .55); world[24] = lm(-.15, .55);
    const image = imageFrame(world);

    const wasTrusted: ArmGeometryHistory = { previousPole: { x: 0, y: 1, z: 0 }, previousPoleWasFresh: true, previousDepthDegenerate: false, lastValidPoleAtMs: 0 };
    const stillTrusted = solveAnatomicalArmFrames(world, image, profile, { left: wasTrusted, right: emptyHistory() }, 600, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false);
    expect(stillTrusted.sides.left?.poleSource).toBe("fresh");

    const wasNotTrusted: ArmGeometryHistory = emptyHistory();
    const stillNotTrusted = solveAnatomicalArmFrames(world, image, profile, { left: wasNotTrusted, right: emptyHistory() }, 600, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false);
    expect(stillNotTrusted.sides.left?.poleSource).toBe("rest");
  });
  it("parallel-transports secondary axes when the pole is unavailable", () => {
    const world = frame(); world[15] = lm(2, 0); const image = imageFrame(world);
    const history: ArmGeometryHistory = { previousPole: null, previousPoleWasFresh: false, previousDepthDegenerate: false, lastValidPoleAtMs: null,
      previousPrimary: { upper: { x: 0, y: 1, z: 0 }, lower: { x: 0, y: 1, z: 0 } }, previousSecondary: { upper: { x: 0, y: 0, z: 1 }, lower: { x: 0, y: 0, z: 1 } } };
    const solved = solveAnatomicalArmFrames(world, image, profile, { left: history, right: emptyHistory() }, 100, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false).sides.left!;
    expect(solved.diagnostic.observation.poleValid).toBe(false); expect(solved.secondary.upper.z).toBeGreaterThan(.99); expect(solved.secondary.lower!.z).toBeGreaterThan(.99);
  });
  it("infers an elbow from observed shoulder/wrist and calibrated human lengths", () => {
    const world = frame(), image = imageFrame(world); image[13].visibility = 0;
    const history: ArmGeometryHistory = { previousPole: { x: 0, y: 1, z: 0 }, previousPoleWasFresh: true, previousDepthDegenerate: false, lastValidPoleAtMs: 0,
      calibratedLength: { upper: 1, lower: 1 }, previousObservedElbow: { x: 1, y: 0, z: 0 }, inferenceStartedAtMs: null };
    const solved = solveAnatomicalArmFrames(world, image, profile, { left: history, right: emptyHistory() }, 100, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false).sides.left!;
    expect(solved.elbowSource).toBe("inferred-history"); expect(solved.segmentValidity).toEqual({ upper: true, lower: true });
    expect(solved.diagnostic.elbowInference.confidence).toBeGreaterThan(0); expect(solved.diagnostic.observation.poleValid).toBe(false);
    // P0-6 (theo chuyên gia tư vấn): sau khi khuỷu được suy luận, độ dài xương phải khớp
    // chính xác calibratedLength — inferElbow() là chính công thức 2-bone IK hình học nên
    // ràng buộc độ dài luôn được đảm bảo tuyệt đối, không cần một bước re-solve riêng.
    expect(solved.diagnostic.upperSegmentLength).toBeCloseTo(1, 6);
    expect(solved.diagnostic.lowerSegmentLength).toBeCloseTo(1, 6);
  });
  it("infers an elbow from an anatomical prior on the very first frame, before any calibration", () => {
    // P0-3: khuỷu bị che đúng lúc chưa từng calibrated (previousObservedElbow=null,
    // calibratedLength=undefined) — trước đây bị reject cứng "elbow-inference-uncalibrated".
    // Nay phải infer được nhờ prior giải phẫu scale theo bề rộng vai quan sát ngay frame này.
    // Vai đặt cách nhau .4 đơn vị (khác `frame()` gốc, nơi hai vai trùng điểm) để có
    // shoulderWidth > 0 làm cơ sở scale — đúng thực tế MediaPipe luôn thấy cả hai vai.
    const world = Array.from({ length: 33 }, () => lm(0, 0));
    world[11] = lm(.2, 0); world[13] = lm(.5, 0); world[15] = lm(.5, -.3);
    world[12] = lm(-.2, 0); world[14] = lm(-.5, 0); world[16] = lm(-.5, -.3);
    world[23] = lm(.15, -.55); world[24] = lm(-.15, -.55);
    const image = imageFrame(world); image[13].visibility = 0;
    const neverCalibrated: ArmGeometryHistory = emptyHistory();
    const solved = solveAnatomicalArmFrames(world, image, profile, { left: neverCalibrated, right: emptyHistory() }, 0, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false).sides.left!;
    expect(solved).not.toBeNull();
    expect(solved.elbowSource).toBe("inferred-rest-prior");
    expect(solved.segmentValidity).toEqual({ upper: true, lower: true });
    expect(Number.isFinite(solved.elbowPosition.x)).toBe(true);
  });
  it("does not flicker the elbow segment when visibility oscillates around the old hard threshold", () => {
    // P0-4/5: trước đây `visibility < 0.5` reject ngay lập tức. visibility dao động
    // 0.47↔0.53 (đúng dải đo được khi tay bị che một phần ở webcam thật) từng làm cẳng tay
    // bật/tắt mỗi frame. Với hysteresis (enter=0.6/exit=0.3), một khi đã tracked thì toàn bộ
    // dải này vẫn coi là quan sát được — không còn giật.
    const world = frame(), image = imageFrame(world);
    let history: ArmGeometryHistory = { ...emptyHistory(), elbowWasVisible: true };
    for (const visibility of [0.47, 0.53, 0.49, 0.51, 0.48, 0.52]) {
      const frameImage = image.map((point, index) => index === 13 ? { ...point, visibility } : point);
      const result = solveAnatomicalArmFrames(world, frameImage, profile, { left: history, right: emptyHistory() }, 0, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false);
      expect(result.sides.left).not.toBeNull();
      expect(result.sides.left!.elbowSource).toBe("observed");
      history = { ...history, elbowWasVisible: result.visibilityStates.left.elbow };
    }
  });
  it("requires sustained high visibility before re-acquiring a lost elbow, not a single frame past 0.5", () => {
    // Đối xứng với test trên: đang ở trạng thái lost, chỉ vượt nhẹ qua ngưỡng cũ 0.5 (ví dụ
    // 0.55) không đủ để coi là quan sát được trở lại — phải vượt `visibilityEnter` (0.6).
    const world = frame(), image = imageFrame(world);
    const history: ArmGeometryHistory = { ...emptyHistory(), elbowWasVisible: false };
    const stillLost = image.map((point, index) => index === 13 ? { ...point, visibility: 0.55 } : point);
    const resultStillLost = solveAnatomicalArmFrames(world, stillLost, profile, { left: history, right: emptyHistory() }, 0, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false);
    expect(resultStillLost.visibilityStates.left.elbow).toBe(false);
    const reacquired = image.map((point, index) => index === 13 ? { ...point, visibility: 0.65 } : point);
    const resultReacquired = solveAnatomicalArmFrames(world, reacquired, profile, { left: history, right: emptyHistory() }, 0, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false);
    expect(resultReacquired.visibilityStates.left.elbow).toBe(true);
    expect(resultReacquired.sides.left!.elbowSource).toBe("observed");
  });
  it("rejects unreachable or expired elbow inference", () => {
    const world = frame(), image = imageFrame(world); image[13].visibility = 0; world[15] = lm(4, 0); image[15] = { ...image[15], x: .7, y: .5 };
    const history: ArmGeometryHistory = { previousPole: { x: 0, y: 1, z: 0 }, previousPoleWasFresh: true, previousDepthDegenerate: false, lastValidPoleAtMs: 0, calibratedLength: { upper: 1, lower: 1 }, inferenceStartedAtMs: 0 };
    const unreachable = solveAnatomicalArmFrames(world, image, profile, { left: history, right: emptyHistory() }, 100, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false);
    expect(unreachable.sides.left).toBeNull(); expect(unreachable.diagnostics.left.hardRejectionReason).toBe("elbow-inference-unreachable");
    world[15] = lm(1, 1); const expired = solveAnatomicalArmFrames(world, imageFrame(world).map((p, index) => index === 13 ? { ...p, visibility: 0 } : p), profile, { left: history, right: emptyHistory() }, 1_300, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false);
    expect(expired.sides.left).toBeNull(); expect(expired.diagnostics.left.hardRejectionReason).toBe("elbow-inference-timeout");
  });
  it("rejects a pole angular outlier even when no other confidence flag is raised", () => {
    // Tracking sạch (không near-edge/depth-degenerate/weak-offset) nhưng pole nhảy ~180° trong
    // 10ms. Trước đây điều kiện `flags.length > 0` khiến outlier lọt qua đúng ở trường hợp này.
    const world = frame(), image = imageFrame(world);
    const history: ArmGeometryHistory = { previousPole: { x: 0, y: -1, z: 0 }, previousPoleWasFresh: true, previousDepthDegenerate: false, lastValidPoleAtMs: 0 };
    const result = solveAnatomicalArmFrames(world, image, profile, { left: history, right: emptyHistory() }, 10, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false);
    expect(result.diagnostics.left.confidenceFlags).toContain("pole-angular-outlier");
    expect(result.diagnostics.left.observation.poleValid).toBe(false);
    expect(result.sides.left?.poleSource).not.toBe("fresh");
  });
  it("reports continuous depth/bend-plane diagnostics without changing solver behaviour (A1)", () => {
    // A1 (theo tư vấn chuyên gia): chỉ thêm công cụ đo, chưa đổi logic — depthQuality phải
    // gần 1 khi tay ở tư thế T-pose bình thường (không depth-degenerate), bendPlaneQuality
    // phải dương rõ ràng khi khuỷu gập vuông góc (không duỗi thẳng).
    const world = frame(), image = imageFrame(world);
    const normal = solveAnatomicalArmFrames(world, image, profile, { left: emptyHistory(), right: emptyHistory() }, 0, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false);
    expect(normal.diagnostics.left.depthQuality).toBeGreaterThan(0.9);
    expect(normal.diagnostics.left.bendPlaneQuality).toBeGreaterThan(0.1);
    expect(normal.diagnostics.left.elbowBendDegrees).not.toBeNull();
    expect(normal.diagnostics.left.elbowBendDegrees!).toBeGreaterThan(0);

    // Tay chĩa thẳng vào camera (armAxis gần như toàn phần theo z) ⇒ depthQuality phải gần 0.
    const forward = frame(); forward[13] = lm(.2, 0, -.3); forward[15] = lm(.2, 0, -.6);
    const forwardImage = imageFrame(forward);
    const forwardResult = solveAnatomicalArmFrames(forward, forwardImage, profile, { left: emptyHistory(), right: emptyHistory() }, 0, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false);
    expect(forwardResult.diagnostics.left.depthQuality).toBeLessThan(0.1);

    // Tay duỗi thẳng (upper // lower) ⇒ bendPlaneQuality phải gần 0, dù depthQuality bình thường.
    const straight = frame(true);
    const straightResult = solveAnatomicalArmFrames(straight, imageFrame(straight), profile, { left: emptyHistory(), right: emptyHistory() }, 0, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false);
    expect(straightResult.diagnostics.left.bendPlaneQuality).toBeLessThan(0.05);
    expect(straightResult.diagnostics.left.elbowBendDegrees!).toBeLessThan(5);
  });
  it("keeps updating the pole filter while a fresh pole is unavailable", () => {
    // Cổ tay gần thẳng ⇒ không có candidate tươi, nhưng pole "previous" vẫn phải đi qua filter
    // để One Euro không đóng băng state rồi nhả một cú nhảy khi pole tươi quay lại.
    const world = frame(true), image = imageFrame(world);
    const poleFilter = vi.fn((_side, value) => value);
    const history: ArmGeometryHistory = { previousPole: { x: 0, y: 1, z: 0 }, previousPoleWasFresh: true, previousDepthDegenerate: false, lastValidPoleAtMs: 0 };
    const result = solveAnatomicalArmFrames(world, image, profile, { left: history, right: emptyHistory() }, 100, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false, undefined, poleFilter);
    expect(result.sides.left?.poleSource).toBe("previous");
    expect(poleFilter.mock.calls.some(([side]) => side === "left")).toBe(true);
  });
  it("Mức 1B-4: falls through fresh-reject then hand-reject to reach previous, with each stage explicitly verified", () => {
    // Ép đúng cả 3 điều kiện đồng thời: (1) fresh bị reject vì tay gần thẳng (weakOffset), (2)
    // hand pole CŨNG bị reject rõ ràng (không chỉ "không thử") vì thiếu index/pinky, (3) có
    // previousPole còn trong hạn poleFallbackTimeoutMs. Trước đây các test chỉ kiểm poleSource
    // cuối cùng — không phân biệt được "A5 thành công rồi vẫn chọn previous" (bug tiềm ẩn nếu
    // thứ tự ưu tiên sai) với "A5 bị reject đúng rồi mới rơi xuống previous" (hành vi đúng).
    const world = frame(true), image = imageFrame(world);
    const history: ArmGeometryHistory = { previousPole: { x: 0, y: 1, z: 0 }, previousPoleWasFresh: true, previousDepthDegenerate: false, lastValidPoleAtMs: 0 };
    const result = solveAnatomicalArmFrames(world, image, profile, { left: history, right: emptyHistory() }, 100, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false);
    const diagnostic = result.diagnostics.left;
    expect(diagnostic.confidenceFlags).toContain("weak-elbow-offset"); // (1) fresh reject xác nhận qua flag
    expect(diagnostic.observation.poleValid).toBe(false); // candidatePole (fresh) đã null trước khi thử A5
    expect(diagnostic.handPoleRejectionReason).not.toBe("not-attempted"); // (2) A5 THỰC SỰ được thử, không bị bỏ qua
    expect(diagnostic.handPoleRejectionReason).not.toBeNull(); // và bị reject (không phải null = thành công)
    expect(result.sides.left?.poleSource).toBe("previous"); // (3) previous còn hạn (lastValidPoleAtMs=0, nowMs=100 < 500ms timeout)
  });
  it("Mức 1B-4: falls through fresh-reject and hand-reject to rest when no previous pole is available at all", () => {
    // Cùng điều kiện (1)+(2) như trên, nhưng KHÔNG có previousPole nào để rơi xuống — nhánh
    // cuối cùng của chuỗi fallback phải là rest, không phải kẹt hay lỗi.
    const world = frame(true), image = imageFrame(world);
    const result = solveAnatomicalArmFrames(world, image, profile, { left: emptyHistory(), right: emptyHistory() }, 100, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false);
    const diagnostic = result.diagnostics.left;
    expect(diagnostic.confidenceFlags).toContain("weak-elbow-offset");
    expect(diagnostic.handPoleRejectionReason).not.toBe("not-attempted");
    expect(diagnostic.handPoleRejectionReason).not.toBeNull();
    expect(result.sides.left?.poleSource).toBe("rest");
  });
  it("does not feed a rest pole into the pole filter", () => {
    // Pole "rest" là hằng số suy từ rig, không phải quan sát: đưa nó vào filter làm bẩn state.
    const world = frame(true), image = imageFrame(world);
    const poleFilter = vi.fn((_side, value) => value);
    const result = solveAnatomicalArmFrames(world, image, profile, { left: emptyHistory(), right: emptyHistory() }, 100, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false, undefined, poleFilter);
    expect(result.sides.left?.poleSource).toBe("rest");
    expect(poleFilter.mock.calls.some(([side]) => side === "left")).toBe(false);
  });
  it("prefers the freshly built upper frame over a stale parallel transport for the lower arm", () => {
    // Sau một đợt mất theo dõi dài (quá poleFallbackTimeoutMs), previousPrimary/Secondary đã cũ.
    // Tin chúng hơn hệ quy chiếu vừa dựng từ cánh tay trên khiến cẳng tay xoắn độc lập.
    const world = frame(), image = imageFrame(world);
    const stale: ArmGeometryHistory = { previousPole: null, previousPoleWasFresh: false, previousDepthDegenerate: false, lastValidPoleAtMs: 0,
      previousPrimary: { upper: { x: 0, y: 1, z: 0 }, lower: { x: 0, y: 1, z: 0 } }, previousSecondary: { upper: { x: 0, y: 0, z: 1 }, lower: { x: 0, y: 0, z: 1 } } };
    const config = DEFAULT_AVATAR_MOTION_CONFIG.armFrame;
    // Transport từ previousPrimary(0,1,0)→lower(0,1,0) là phép quay đơn vị, nên nếu lịch sử cũ
    // được dùng thì secondary.lower sẽ đúng bằng previousSecondary (0,0,1).
    const transported = new Vector3(0, 0, 1);
    const fresh = solveAnatomicalArmFrames(world, image, profile, { left: stale, right: emptyHistory() }, config.poleFallbackTimeoutMs - 1, config, false).sides.left!;
    expect(vector(fresh.secondary.lower!).angleTo(transported)).toBeLessThan(1e-6);
    const expired = solveAnatomicalArmFrames(world, image, profile, { left: stale, right: emptyHistory() }, config.poleFallbackTimeoutMs + 500, config, false).sides.left!;
    expect(vector(expired.secondary.lower!).angleTo(transported)).toBeGreaterThan(1e-3);
    expect(vector(expired.secondary.lower!).dot(vector(expired.primary.lower!))).toBeCloseTo(0, 6);
  });
  it("converts through a non-identity ancestor while preserving world directions", () => {
    const rotated = structuredClone(profile); const ancestor = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 3);
    const primary = new Vector3(1, 0, 0).applyQuaternion(ancestor); const secondary = new Vector3(0, 1, 0).applyQuaternion(ancestor); const binormal = new Vector3(0, 0, 1).applyQuaternion(ancestor);
    for (const name of ["leftUpperArm", "leftLowerArm"] as const) {
      rotated.joints[name].restWorldRotation = { x: ancestor.x, y: ancestor.y, z: ancestor.z, w: ancestor.w };
      rotated.joints[name].parentRestWorldRotation = { x: ancestor.x, y: ancestor.y, z: ancestor.z, w: ancestor.w };
      rotated.joints[name].restWorldDirection = { x: primary.x, y: primary.y, z: primary.z };
      rotated.joints[name].anatomicalRestBasis = { ...rotated.joints[name].anatomicalRestBasis, primaryWorld: { x: primary.x, y: primary.y, z: primary.z }, secondaryWorld: { x: secondary.x, y: secondary.y, z: secondary.z }, binormalWorld: { x: binormal.x, y: binormal.y, z: binormal.z }, worldRotation: { x: ancestor.x, y: ancestor.y, z: ancestor.z, w: ancestor.w } };
    }
    const world = frame(); const solved = solveAnatomicalArmFrames(world, imageFrame(world), rotated, { left: emptyHistory(), right: emptyHistory() }, 0, DEFAULT_AVATAR_MOTION_CONFIG.armFrame, false).sides.left!;
    expect(new Vector3(1, 0, 0).applyQuaternion(q3(solved.targetWorldRotations.leftUpperArm!)).angleTo(new Vector3(1, 0, 0))).toBeLessThan(1e-6);
    expect(new Vector3(1, 0, 0).applyQuaternion(q3(solved.targetWorldRotations.leftLowerArm!)).angleTo(new Vector3(0, 1, 0))).toBeLessThan(1e-6);
  });
});
