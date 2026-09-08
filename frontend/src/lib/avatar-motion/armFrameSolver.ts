import { Quaternion, Vector3 } from "three";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { QuaternionData, Vector3Data } from "./avatarPoseTypes";
import type { ArmFrameDiagnostic, ArmSide, ElbowSource, PoleSource } from "./avatarMotionDiagnostics";
import type { ArmDeltaOutput } from "./armTemporalState";
import type { ControlledArmJoint, NormalizedAvatarRigProfile } from "./normalizedRigProfile";
import type { AvatarMotionConfig } from "./motionConfig";
import { constrainJointRotation } from "./jointConstraints";
import { buildTorsoBasis, type TorsoBasis } from "./torsoBasis";
import { inverseQuaternion, multiplyQuaternions, quaternionFromBasis, rotateVector, vector, vectorData } from "./motionMath";
import type { FaceArmSpatialEvidence } from "./faceArmSpatialEvidence";

export type GeometryDiagnostic = Omit<ArmFrameDiagnostic, "lossState" | "transitionProgress" | "invalidDurationMs" | "validRecoveryDurationMs" | "sampleDisposition" | "segmentLossState" | "upperArmAngularDeltaDeg" | "lowerArmAngularDeltaDeg" | "poleAngularDeltaDeg" | "poleSourceChanged" | "trackingReacquired">;
export interface ArmGeometryHistory { previousPole: Vector3Data | null; previousPoleWasFresh: boolean; previousDepthDegenerate: boolean; lastValidPoleAtMs: number | null; previousPrimary?: { upper: Vector3Data | null; lower: Vector3Data | null }; previousSecondary?: { upper: Vector3Data | null; lower: Vector3Data | null }; calibratedLength?: { upper: number | null; lower: number | null }; previousObservedElbow?: Vector3Data | null; inferenceStartedAtMs?: number | null;
  /** P0-4/5: trạng thái hysteresis theo landmark, để quyết định "quan sát được" không dao động quanh một ngưỡng duy nhất. */
  elbowWasVisible?: boolean; wristWasVisible?: boolean;
  /**
   * Phase 3B partial-arm: hướng khuỷu lệch khỏi trục vai–cổ tay ở lần solve gần nhất (đã normalize, vuông
   * góc trục). Dùng để khóa phía gập khi suy đoán khuỷu, chống nghiệm lật qua thân người.
   */
  previousElbowDirection?: Vector3Data | null }
export interface HandElbowBranchEvidence {
  /** Hướng wrist→middle-MCP trong image-space đã sửa aspect ratio; trục y của ảnh hướng xuống. */
  forwardImage: Vector3Data;
  /** Chất lượng hình học palm-basis trong [0, 1]. */
  geometryQuality: number;
}
export interface ArmSpatialEvidence {
  hand: HandElbowBranchEvidence | null;
  face: FaceArmSpatialEvidence | null;
  /** world-unit / image-aspect-unit, suy từ hai vai trong cùng Pose sample. */
  imageToWorldScale: number | null;
  imageAspectRatio: number;
}
export interface SideArmGeometryResult {
  deltas: ArmDeltaOutput; targetWorldRotations: Partial<Record<ControlledArmJoint, QuaternionData>>;
  acceptedPole: Vector3Data; poleSource: PoleSource; acceptedFreshPole: boolean; depthDegenerate: boolean; diagnostic: GeometryDiagnostic;
  segmentValidity: { upper: boolean; lower: boolean };
  primary: { upper: Vector3Data; lower: Vector3Data | null }; secondary: { upper: Vector3Data; lower: Vector3Data | null };
  elbowSource: ElbowSource; elbowPosition: Vector3Data; observedLengths: { upper: number; lower: number } | null;
  /** Phase 3B partial-arm: hướng khuỷu lệch trục vai–cổ tay của frame này, để frame sau khóa phía gập. */
  elbowDirection: Vector3Data | null;
}
export interface AnatomicalArmSolveResult { torso: TorsoBasis; torsoWasObserved: boolean; sides: Record<ArmSide, SideArmGeometryResult | null>; diagnostics: Record<ArmSide, GeometryDiagnostic>;
  /** P0-4/5: trạng thái hysteresis mới nhất, để caller lưu vào history cho frame sau. */
  visibilityStates: Record<ArmSide, { elbow: boolean; wrist: boolean }> }

const INDICES = {
  left: { shoulder: 11, elbow: 13, wrist: 15, pinky: 17, index: 19, thumb: 21, upper: "leftUpperArm", lower: "leftLowerArm" },
  right: { shoulder: 12, elbow: 14, wrist: 16, pinky: 18, index: 20, thumb: 22, upper: "rightUpperArm", lower: "rightLowerArm" },
} as const;
const semanticPoint = (point: RawNormalizedLandmarkV1) => new Vector3(point.x, -point.y, -point.z);
const visible = (point: RawNormalizedLandmarkV1 | undefined, minimum: number) => Boolean(point && point.visibility !== null && point.visibility >= minimum);
/**
 * P0-4/5: hysteresis cho quyết định "quan sát được" (theo chuyên gia tư vấn). Đang tracked
 * thì cần tụt dưới `exit` mới rớt; đang lost thì cần vượt `enter` mới được tính lại. Tránh
 * vách đá tại một ngưỡng duy nhất khiến visibility dao động 0.49↔0.51 làm cả đoạn xương
 * bật/tắt liên tục — đã đo được đây là nguyên nhân chính gây giật khi tay bị che một phần.
 * `visibility === null` (world landmark không mang visibility) không đổi trạng thái trước đó.
 */
const visibleWithHysteresis = (point: RawNormalizedLandmarkV1 | undefined, wasVisible: boolean | undefined, enter: number, exit: number): boolean => {
  if (!point) return false;
  if (point.visibility === null) return wasVisible ?? false;
  return wasVisible ? point.visibility >= exit : point.visibility >= enter;
};
const imagePoint = (point: RawNormalizedLandmarkV1 | undefined): Vector3Data | null => point ? { x: point.x, y: point.y, z: point.z } : null;
const inOuterBounds = (point: RawNormalizedLandmarkV1 | undefined, margin: number) => Boolean(point && point.x >= -margin && point.x <= 1 + margin && point.y >= -margin && point.y <= 1 + margin);
const nearEdge = (point: RawNormalizedLandmarkV1 | undefined, margin: number) => Boolean(point && (point.x < margin || point.x > 1 - margin || point.y < margin || point.y > 1 - margin));
/** A1: ánh xạ mượt 0→1 trong khoảng [edge0, edge1], dùng cho các đại lượng chất lượng liên tục. */
const smoothstep = (edge0: number, edge1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

function emptyDiagnostic(side: ArmSide, imageLandmarks: RawNormalizedLandmarkV1[], reason: string | null, flags: string[] = []): GeometryDiagnostic {
  const i = INDICES[side];
  return { side, armValidity: reason ? "rejected" : "accepted", hardRejectionReason: reason, confidenceFlags: flags,
    imageBounds: { shoulder: imagePoint(imageLandmarks[i.shoulder]), elbow: imagePoint(imageLandmarks[i.elbow]), wrist: imagePoint(imageLandmarks[i.wrist]) },
    pole: null, poleSource: "unavailable", elbowOffsetMagnitude: null, normalizedElbowOffset: null, planeNormal: null,
    upperTargetWorld: null, lowerTargetWorld: null, upperSegmentLength: null, lowerSegmentLength: null, segmentRatio: null,
    depthAlignment: null, candidatePole: null, filteredPole: null, projectedPole: null, poleAngularVelocity: null,
    depthQuality: null, bendPlaneQuality: null, elbowBendDegrees: null, handPoleRejectionReason: null,
    observation: { upperDirectionValid: false, lowerDirectionValid: false, poleValid: false, twistObservable: false, upperRejectionReason: reason, lowerRejectionReason: reason, poleRejectionReason: reason },
    elbowInference: { source: "unavailable", confidence: 0, durationMs: 0, inferredPosition: null, calibratedUpperLength: null, calibratedLowerLength: null, shoulderWristDistance: null, reachRatio: null, distanceFromPreviousElbow: null } };
}

function transportedSecondary(primary: Vector3, previousPrimary: Vector3Data | null | undefined, previousSecondary: Vector3Data | null | undefined): Vector3Data | null {
  if (!previousPrimary || !previousSecondary) return null;
  const from = vector(previousPrimary).normalize(), to = primary.clone().normalize();
  const rotation = new Quaternion().setFromUnitVectors(from, to); const transported = vector(previousSecondary).applyQuaternion(rotation);
  transported.addScaledVector(to, -transported.dot(to)); return transported.lengthSq() > 1e-8 ? vectorData(transported.normalize()) : null;
}

/**
 * Tỉ lệ upper:lower phổ biến ở người trưởng thành (P0-3, theo chuyên gia tư vấn). Dùng làm
 * prior khi chưa có calibration từ observation, để elbow-inference chạy được ngay từ frame
 * đầu thay vì từ chối tới khi khuỷu được quan sát đủ lâu để tích luỹ mẫu.
 */
const ANATOMICAL_UPPER_LOWER_RATIO = 1;
/** Tỉ lệ điển hình chiều dài cánh tay trên so với bề rộng vai, dùng để scale prior theo từng người. */
const UPPER_ARM_TO_SHOULDER_WIDTH_RATIO = 0.65;

/**
 * Prior độ dài xương khi chưa calibrated: scale theo bề rộng vai quan sát được ngay frame đó
 * (luôn sẵn có, không phụ thuộc tay đang làm gì), dùng tỉ lệ giải phẫu cố định thay vì đợi
 * observation tích luỹ đủ mẫu. Không chính xác bằng calibration thật, nhưng đủ để
 * elbow-inference không bị `unreachable` ngay từ đầu.
 */
function boneLengthPrior(shoulderWidth: number): { upper: number; lower: number } {
  const upper = shoulderWidth * UPPER_ARM_TO_SHOULDER_WIDTH_RATIO;
  return { upper, lower: upper / ANATOMICAL_UPPER_LOWER_RATIO };
}

/**
 * A5 (theo tư vấn chuyên gia): suy pole từ hướng bàn tay dùng index/pinky/wrist — landmark có
 * sẵn trong chính MediaPipe Pose (33 điểm), không cần Hand Landmarker riêng. Đây là tín hiệu
 * twist YẾU (Pose landmark cho tay kém chính xác hơn Hand Landmarker) nhưng vẫn còn quan sát
 * được đúng lúc pole từ elbow-offset đã suy biến vì tay chĩa vào camera — bù đúng khoảng
 * trống mà A2 không giải quyết được (khi cả depth lẫn bend-plane đều yếu).
 */
type HandPoleRejectionReason = "missing-index" | "missing-pinky" | "low-index-visibility" | "low-pinky-visibility" | "degenerate-geometry";
function handPalmPole(wrist: Vector3, index: RawNormalizedLandmarkV1 | undefined, pinky: RawNormalizedLandmarkV1 | undefined, imageIndex: RawNormalizedLandmarkV1 | undefined, imagePinky: RawNormalizedLandmarkV1 | undefined, minimumVisibility: number, armAxis: Vector3): { pole: Vector3Data | null; rejectionReason: HandPoleRejectionReason | null } {
  if (!index) return { pole: null, rejectionReason: "missing-index" };
  if (!pinky) return { pole: null, rejectionReason: "missing-pinky" };
  if (!visible(imageIndex, minimumVisibility)) return { pole: null, rejectionReason: "low-index-visibility" };
  if (!visible(imagePinky, minimumVisibility)) return { pole: null, rejectionReason: "low-pinky-visibility" };
  const indexPoint = semanticPoint(index), pinkyPoint = semanticPoint(pinky);
  const palmAcross = indexPoint.clone().sub(pinkyPoint); if (palmAcross.lengthSq() < 1e-8) return { pole: null, rejectionReason: "degenerate-geometry" };
  palmAcross.normalize();
  const palmCenter = indexPoint.clone().add(pinkyPoint).multiplyScalar(0.5);
  const palmForward = palmCenter.sub(wrist); if (palmForward.lengthSq() < 1e-8) return { pole: null, rejectionReason: "degenerate-geometry" };
  palmForward.normalize();
  const palmNormal = palmAcross.clone().cross(palmForward); if (palmNormal.lengthSq() < 1e-8) return { pole: null, rejectionReason: "degenerate-geometry" };
  palmNormal.normalize();
  const projected = palmNormal.addScaledVector(armAxis, -palmNormal.dot(armAxis));
  if (projected.lengthSq() <= 1e-8) return { pole: null, rejectionReason: "degenerate-geometry" };
  return { pole: vectorData(projected.normalize()), rejectionReason: null };
}

/**
 * Two-bone IK dạng nghiệm đóng: biết vai, cổ tay và hai chiều dài xương, khuỷu nằm trên một
 * đường tròn giao của hai mặt cầu. `prior` chọn điểm nào trên đường tròn đó — tức chọn PHÍA gập.
 *
 * Phase 3B partial-arm: `previousElbowDirection` (hướng khuỷu→trục vai-cổ tay của lần suy đoán/quan sát gần
 * nhất, đã chiếu vuông góc trục) dùng để khóa phía gập. Nếu nghiệm mới rơi sang nửa mặt phẳng
 * đối diện, lật pole lại. Không có nó, prior đảo dấu một frame là khuỷu nhảy qua thân người —
 * đo được chính xác hiện tượng này trên tay gần duỗi thẳng.
 */
function inferElbowLegacy(
  shoulder: Vector3, wrist: Vector3, upperLength: number, lowerLength: number, prior: Vector3Data,
  reachSlackRatio: number, previousElbowDirection: Vector3Data | null, lateralOutward: Vector3 | null,
  minimumLateralBias: number, handEvidence: HandElbowBranchEvidence | null,
  scoring: Pick<AvatarMotionConfig["armFrame"], "elbowInferencePriorWeight" | "elbowInferenceHistoryWeight" | "elbowInferencePalmWeight" | "elbowInferencePalmMinimumQuality" | "elbowInferenceOutsideWeight" | "elbowInferenceDeepInsideThreshold" | "elbowInferenceDeepInsideWeight">,
): { elbow: Vector3; reachRatio: number; confidence: number; elbowDirection: Vector3Data; sideFlipPrevented: boolean; anatomyFlipApplied: boolean; palmBranchApplied: boolean } | null {
  const shoulderToWrist = wrist.clone().sub(shoulder), distance = shoulderToWrist.length(); if (!Number.isFinite(distance) || distance < 1e-6) return null;
  const minimumReach = Math.abs(upperLength - lowerLength), maximumReach = upperLength + lowerLength, slack = maximumReach * reachSlackRatio;
  if (distance < minimumReach - slack || distance > maximumReach + slack) return null;
  const clampedDistance = Math.min(maximumReach - 1e-6, Math.max(minimumReach + 1e-6, distance)); const axis = shoulderToWrist.normalize();
  const x = (upperLength * upperLength - lowerLength * lowerLength + clampedDistance * clampedDistance) / (2 * clampedDistance);
  const radiusSquared = upperLength * upperLength - x * x; if (radiusSquared < -1e-6) return null;
  const priorPole = vector(prior).addScaledVector(axis, -vector(prior).dot(axis)); if (priorPole.lengthSq() < 1e-8) return null; priorPole.normalize();
  const previous = previousElbowDirection ? vector(previousElbowDirection) : null;
  if (previous) previous.addScaledVector(axis, -previous.dot(axis));
  const previousUsable = Boolean(previous && previous.lengthSq() > 1e-8);
  if (previousUsable) previous!.normalize();
  const outward = lateralOutward?.clone() ?? null;
  if (outward) outward.addScaledVector(axis, -outward.dot(axis));
  const outwardUsable = Boolean(outward && outward.lengthSq() > 1e-8);
  if (outwardUsable) outward!.normalize();
  const palmForward = handEvidence && Number.isFinite(handEvidence.geometryQuality) && handEvidence.geometryQuality >= scoring.elbowInferencePalmMinimumQuality
    ? vector(handEvidence.forwardImage).setZ(0)
    : null;
  const palmUsable = Boolean(palmForward && Number.isFinite(palmForward.x) && Number.isFinite(palmForward.y) && palmForward.lengthSq() > 1e-8);
  if (palmUsable) palmForward!.normalize();
  const center = shoulder.clone().addScaledVector(axis, x);
  const radius = Math.sqrt(Math.max(0, radiusSquared));

  // Two-bone IK chỉ có hai nhánh khi pole đã chọn mặt phẳng. Chấm cả hai ứng viên thay vì
  // hard-flip mọi khuỷu đi vào phía trong: cross-body gesture được phép giữ history/palm,
  // còn nghiệm xuyên sâu qua thân nhận penalty lớn. Đây vẫn là nghiệm giải tích O(1).
  const score = (candidate: Vector3, includePalm: boolean, includeAnatomy: boolean): number => {
    let value = scoring.elbowInferencePriorWeight * (1 - candidate.dot(priorPole));
    if (previousUsable) value += scoring.elbowInferenceHistoryWeight * (1 - candidate.dot(previous!));
    if (includePalm && palmUsable) {
      const candidateElbow = center.clone().addScaledVector(candidate, radius);
      // Candidate ở semantic world (y hướng lên), còn palm evidence ở image-space (y hướng xuống).
      const lowerImage = new Vector3(wrist.x - candidateElbow.x, candidateElbow.y - wrist.y, 0);
      if (lowerImage.lengthSq() > 1e-8) {
        lowerImage.normalize();
        value += scoring.elbowInferencePalmWeight * handEvidence!.geometryQuality * (1 - lowerImage.dot(palmForward!));
      }
    }
    if (includeAnatomy && outwardUsable) {
      const lateral = candidate.dot(outward!);
      value += scoring.elbowInferenceOutsideWeight * Math.max(0, minimumLateralBias - lateral);
      value += scoring.elbowInferenceDeepInsideWeight * Math.max(0, -lateral - scoring.elbowInferenceDeepInsideThreshold);
    }
    return value;
  };
  const oppositePole = priorPole.clone().negate();
  const baseWithoutPalm = score(priorPole, false, true), oppositeWithoutPalm = score(oppositePole, false, true);
  const baseWithoutAnatomy = score(priorPole, true, false), oppositeWithoutAnatomy = score(oppositePole, true, false);
  const baseScore = score(priorPole, true, true), oppositeScore = score(oppositePole, true, true);
  const pole = oppositeScore + 1e-9 < baseScore ? oppositePole : priorPole;
  const poleWithoutPalm = oppositeWithoutPalm + 1e-9 < baseWithoutPalm ? oppositePole : priorPole;
  const poleWithoutAnatomy = oppositeWithoutAnatomy + 1e-9 < baseWithoutAnatomy ? oppositePole : priorPole;
  const sideFlipPrevented = previousUsable && pole.dot(previous!) >= 0 && priorPole.dot(previous!) < 0;
  const anatomyFlipApplied = outwardUsable && pole !== poleWithoutAnatomy;
  const palmBranchApplied = palmUsable && pole !== poleWithoutPalm;
  const elbow = center.addScaledVector(pole, radius);
  const reachRatio = distance / maximumReach; const violation = distance < minimumReach ? minimumReach - distance : distance > maximumReach ? distance - maximumReach : 0;
  return { elbow, reachRatio, confidence: Math.max(0, 1 - violation / Math.max(1e-6, slack)), elbowDirection: vectorData(pole), sideFlipPrevented, anatomyFlipApplied, palmBranchApplied };
}

type ElbowSpatialDiagnostic = NonNullable<GeometryDiagnostic["spatial"]>;
type ScoredPole = { pole: Vector3; angle: number; total: number; face: number; head: number; torso: number };

function pointSegmentDistance(point: Vector3, start: Vector3, end: Vector3): number {
  const segment = end.clone().sub(start); const lengthSq = segment.lengthSq();
  if (lengthSq <= 1e-12) return point.distanceTo(start);
  const t = Math.max(0, Math.min(1, point.clone().sub(start).dot(segment) / lengthSq));
  return point.distanceTo(start.clone().addScaledVector(segment, t));
}

/** Khoảng cách ngắn nhất giữa hai đoạn 3D; dùng cho hai capsule forearm và torso. */
function segmentDistance(p1: Vector3, q1: Vector3, p2: Vector3, q2: Vector3): number {
  const d1 = q1.clone().sub(p1), d2 = q2.clone().sub(p2), r = p1.clone().sub(p2);
  const a = d1.dot(d1), e = d2.dot(d2), f = d2.dot(r); let s = 0; let t = 0;
  if (a <= 1e-12 && e <= 1e-12) return p1.distanceTo(p2);
  if (a <= 1e-12) t = Math.max(0, Math.min(1, f / e));
  else {
    const c = d1.dot(r);
    if (e <= 1e-12) s = Math.max(0, Math.min(1, -c / a));
    else {
      const b = d1.dot(d2), denominator = a * e - b * b;
      if (Math.abs(denominator) > 1e-12) s = Math.max(0, Math.min(1, (b * f - c * e) / denominator));
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
      else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
    }
  }
  return p1.clone().addScaledVector(d1, s).distanceTo(p2.clone().addScaledVector(d2, t));
}

function rigArmCollisionPenetration(
  profile: NormalizedAvatarRigProfile,
  side: ArmSide,
  shoulder: Vector3,
  elbow: Vector3,
  wrist: Vector3,
): { head: number; torso: number } | null {
  const collision = profile.collisionReference; if (!collision) return null;
  const upper = elbow.clone().sub(shoulder), lower = wrist.clone().sub(elbow);
  if (upper.lengthSq() < 1e-8 || lower.lengthSq() < 1e-8) return null;
  const arm = collision.arms[side], rigShoulder = vector(arm.shoulderWorld);
  const rigElbow = rigShoulder.clone().addScaledVector(upper.normalize(), arm.upperLength);
  const rigHand = rigElbow.clone().addScaledVector(lower.normalize(), arm.lowerLength);
  const headClearance = collision.head.radius + arm.radius;
  const torsoClearance = collision.torso.radius + arm.radius;
  return {
    head: Math.max(0, headClearance - pointSegmentDistance(vector(collision.head.centerWorld), rigElbow, rigHand)) / headClearance,
    torso: Math.max(0, torsoClearance - segmentDistance(rigElbow, rigHand, vector(collision.torso.startWorld), vector(collision.torso.endWorld))) / torsoClearance,
  };
}

function ellipseSegmentDistance(start: Vector3, end: Vector3, face: FaceArmSpatialEvidence): number {
  const ax = (start.x - face.centerImageAspect.x) / face.radiusX;
  const ay = (start.y - face.centerImageAspect.y) / face.radiusY;
  const bx = (end.x - face.centerImageAspect.x) / face.radiusX;
  const by = (end.y - face.centerImageAspect.y) / face.radiusY;
  const dx = bx - ax, dy = by - ay, denominator = dx * dx + dy * dy;
  const t = denominator <= 1e-12 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / denominator));
  return Math.hypot(ax + dx * t, ay + dy * t);
}

/**
 * Quét toàn bộ đường tròn nghiệm two-bone IK. 24 ứng viên là chi phí cố định, nhưng cho phép solver thoát
 * khỏi giả định sai “chỉ có prior và -prior” vốn làm khuỷu bị khóa vào mặt phẳng gập ngược.
 */
function inferElbow(
  shoulder: Vector3, wrist: Vector3, upperLength: number, lowerLength: number, prior: Vector3Data,
  reachSlackRatio: number, previousElbowDirection: Vector3Data | null, lateralOutward: Vector3 | null,
  minimumLateralBias: number, spatial: ArmSpatialEvidence | null, side: ArmSide,
  profile: NormalizedAvatarRigProfile, shoulderImage: RawNormalizedLandmarkV1, wristImage: RawNormalizedLandmarkV1,
  scoring: AvatarMotionConfig["armFrame"],
): { elbow: Vector3; reachRatio: number; confidence: number; elbowDirection: Vector3Data; sideFlipPrevented: boolean; anatomyFlipApplied: boolean; palmBranchApplied: boolean; faceBranchApplied: boolean; collisionBranchApplied: boolean; spatial: ElbowSpatialDiagnostic } | null {
  if (scoring.elbowInferenceCandidateCount < 3) {
    const legacy = inferElbowLegacy(shoulder, wrist, upperLength, lowerLength, prior, reachSlackRatio, previousElbowDirection, lateralOutward, minimumLateralBias, spatial?.hand ?? null, scoring);
    return legacy ? { ...legacy, faceBranchApplied: false, collisionBranchApplied: false, spatial: { candidateCount: 2, selectedAngleRadians: null, faceEvidenceUsed: false, intentionalFaceContact: false, facePenalty: 0, headCollisionPenalty: 0, torsoCollisionPenalty: 0 } } : null;
  }
  const shoulderToWrist = wrist.clone().sub(shoulder), distance = shoulderToWrist.length();
  if (!Number.isFinite(distance) || distance < 1e-6) return null;
  const minimumReach = Math.abs(upperLength - lowerLength), maximumReach = upperLength + lowerLength, slack = maximumReach * reachSlackRatio;
  if (distance < minimumReach - slack || distance > maximumReach + slack) return null;
  const clampedDistance = Math.min(maximumReach - 1e-6, Math.max(minimumReach + 1e-6, distance));
  const axis = shoulderToWrist.normalize();
  const x = (upperLength * upperLength - lowerLength * lowerLength + clampedDistance * clampedDistance) / (2 * clampedDistance);
  const radiusSquared = upperLength * upperLength - x * x; if (radiusSquared < -1e-6) return null;
  const priorPole = vector(prior).addScaledVector(axis, -vector(prior).dot(axis));
  if (priorPole.lengthSq() < 1e-8) return null; priorPole.normalize();
  const perpendicular = axis.clone().cross(priorPole);
  if (perpendicular.lengthSq() < 1e-8) return null; perpendicular.normalize();
  const previous = previousElbowDirection ? vector(previousElbowDirection).addScaledVector(axis, -vector(previousElbowDirection).dot(axis)) : null;
  const previousUsable = Boolean(previous && previous.lengthSq() > 1e-8); if (previousUsable) previous!.normalize();
  const outward = lateralOutward?.clone().addScaledVector(axis, -(lateralOutward?.dot(axis) ?? 0)) ?? null;
  const outwardUsable = Boolean(outward && outward.lengthSq() > 1e-8); if (outwardUsable) outward!.normalize();
  const hand = spatial?.hand ?? null;
  const palm = hand && hand.geometryQuality >= scoring.elbowInferencePalmMinimumQuality ? vector(hand.forwardImage).setZ(0) : null;
  const palmUsable = Boolean(palm && palm.lengthSq() > 1e-8); if (palmUsable) palm!.normalize();
  const face = spatial?.face ?? null;
  const faceUsable = Boolean(face && spatial && Number.isFinite(spatial.imageToWorldScale) && spatial.imageToWorldScale! > 1e-8 && spatial.imageAspectRatio > 0);
  const center = shoulder.clone().addScaledVector(axis, x), radius = Math.sqrt(Math.max(0, radiusSquared));
  const count = Math.max(8, Math.min(64, Math.round(scoring.elbowInferenceCandidateCount)));
  const candidates = Array.from({ length: count }, (_, index) => {
    const angle = 2 * Math.PI * index / count;
    return { pole: priorPole.clone().multiplyScalar(Math.cos(angle)).addScaledVector(perpendicular, Math.sin(angle)).normalize(), angle };
  });
  const evaluate = (candidate: { pole: Vector3; angle: number }, includePalm: boolean, includeAnatomy: boolean, includeFace: boolean, includeCollision: boolean): ScoredPole => {
    let total = scoring.elbowInferencePriorWeight * (1 - candidate.pole.dot(priorPole));
    if (previousUsable) total += scoring.elbowInferenceHistoryWeight * (1 - candidate.pole.dot(previous!));
    const elbow = center.clone().addScaledVector(candidate.pole, radius);
    if (includePalm && palmUsable) {
      const lowerImage = new Vector3(wrist.x - elbow.x, elbow.y - wrist.y, 0);
      if (lowerImage.lengthSq() > 1e-8) total += scoring.elbowInferencePalmWeight * hand!.geometryQuality * (1 - lowerImage.normalize().dot(palm!));
    }
    if (includeAnatomy && outwardUsable) {
      const lateral = candidate.pole.dot(outward!);
      total += scoring.elbowInferenceOutsideWeight * Math.max(0, minimumLateralBias - lateral);
      total += scoring.elbowInferenceDeepInsideWeight * Math.max(0, -lateral - scoring.elbowInferenceDeepInsideThreshold);
    }
    let facePenalty = 0;
    if (includeFace && faceUsable && face && spatial) {
      const elbowImage = new Vector3(shoulderImage.x + (elbow.x - shoulder.x) / spatial.imageToWorldScale!, shoulderImage.y * spatial.imageAspectRatio - (elbow.y - shoulder.y) / spatial.imageToWorldScale!, 0);
      const wristPoint = new Vector3(wristImage.x, wristImage.y * spatial.imageAspectRatio, 0);
      if (!face.allowContact) {
        const penetration = Math.max(0, 1.08 - ellipseSegmentDistance(elbowImage, wristPoint, face));
        facePenalty += scoring.elbowInferenceFaceWeight * face.quality * penetration * penetration;
      }
      if (face.desiredSide !== null) facePenalty += scoring.elbowInferenceFaceSideWeight * face.quality * Math.max(0, -face.desiredSide * (elbowImage.x - face.centerImageAspect.x) / face.radiusX);
      total += facePenalty;
    }
    let headPenalty = 0, torsoPenalty = 0;
    const penetration = includeCollision ? rigArmCollisionPenetration(profile, side, shoulder, elbow, wrist) : null;
    if (penetration) {
      headPenalty = scoring.elbowInferenceHeadCollisionWeight * penetration.head * penetration.head * (face?.allowContact ? 0.15 : 1);
      torsoPenalty = scoring.elbowInferenceTorsoCollisionWeight * penetration.torso * penetration.torso;
      total += headPenalty + torsoPenalty;
    }
    return { ...candidate, total, face: facePenalty, head: headPenalty, torso: torsoPenalty };
  };
  const choose = (palmEnabled: boolean, anatomyEnabled: boolean, faceEnabled: boolean, collisionEnabled: boolean) => candidates.map((candidate) => evaluate(candidate, palmEnabled, anatomyEnabled, faceEnabled, collisionEnabled)).reduce((best, value) => value.total + 1e-9 < best.total ? value : best);
  const chosen = choose(true, true, true, true), withoutPalm = choose(false, true, true, true), withoutAnatomy = choose(true, false, true, true), withoutFace = choose(true, true, false, true), withoutCollision = choose(true, true, true, false);
  const elbow = center.clone().addScaledVector(chosen.pole, radius);
  const violation = distance < minimumReach ? minimumReach - distance : distance > maximumReach ? distance - maximumReach : 0;
  return {
    elbow, reachRatio: distance / maximumReach, confidence: Math.max(0, 1 - violation / Math.max(1e-6, slack)), elbowDirection: vectorData(chosen.pole),
    sideFlipPrevented: Boolean(previousUsable && chosen.pole.dot(previous!) >= 0 && priorPole.dot(previous!) < 0),
    anatomyFlipApplied: Boolean(outwardUsable
      && withoutAnatomy.pole.dot(outward!) < -scoring.elbowInferenceDeepInsideThreshold
      && chosen.pole.dot(outward!) > withoutAnatomy.pole.dot(outward!)),
    palmBranchApplied: Boolean(palmUsable && chosen.angle !== withoutPalm.angle),
    faceBranchApplied: Boolean(faceUsable && chosen.angle !== withoutFace.angle), collisionBranchApplied: Boolean(profile.collisionReference && chosen.angle !== withoutCollision.angle),
    spatial: { candidateCount: count, selectedAngleRadians: chosen.angle, faceEvidenceUsed: faceUsable, intentionalFaceContact: face?.allowContact ?? false, facePenalty: chosen.face, headCollisionPenalty: chosen.head, torsoCollisionPenalty: chosen.torso },
  };
}

function forearmPalmImageAlignment(elbow: Vector3, wrist: Vector3, handEvidence: HandElbowBranchEvidence | null): number | null {
  if (!handEvidence || !Number.isFinite(handEvidence.geometryQuality)) return null;
  const palm = vector(handEvidence.forwardImage).setZ(0);
  // Pose semantic y hướng lên, image y hướng xuống. Không trộn origin; chỉ so sánh vector hướng.
  const forearm = new Vector3(wrist.x - elbow.x, elbow.y - wrist.y, 0);
  if (![palm.x, palm.y, forearm.x, forearm.y].every(Number.isFinite) || palm.lengthSq() <= 1e-8 || forearm.lengthSq() <= 1e-8) return null;
  return palm.normalize().dot(forearm.normalize());
}

function targetBoneWorld(primary: Vector3, pole: Vector3, rest: NormalizedAvatarRigProfile["joints"][ControlledArmJoint]): QuaternionData | null {
  const secondary = pole.clone().addScaledVector(primary, -pole.dot(primary)); if (secondary.lengthSq() < 1e-8) return null;
  secondary.normalize(); const binormal = primary.clone().cross(secondary).normalize(); secondary.copy(binormal).cross(primary).normalize();
  const targetFrame = quaternionFromBasis(vectorData(primary), vectorData(secondary), vectorData(binormal)); if (!targetFrame) return null;
  return multiplyQuaternions(multiplyQuaternions(targetFrame, inverseQuaternion(rest.anatomicalRestBasis.worldRotation)), rest.restWorldRotation);
}

function solveSide(
  side: ArmSide, world: RawNormalizedLandmarkV1[], image: RawNormalizedLandmarkV1[], profile: NormalizedAvatarRigProfile, torso: TorsoBasis | null,
  history: ArmGeometryHistory, nowMs: number, config: AvatarMotionConfig["armFrame"], constraintsEnabled: boolean,
  spatialEvidence: ArmSpatialEvidence | null,
  directionFilter?: (name: ControlledArmJoint, direction: Vector3Data) => Vector3Data,
  poleFilter?: (side: ArmSide, pole: Vector3Data) => Vector3Data,
): { result: SideArmGeometryResult | null; diagnostic: GeometryDiagnostic; visibilityState: { elbow: boolean; wrist: boolean } } {
  const handEvidence = spatialEvidence?.hand ?? null;
  const i = INDICES[side]; const ws = world[i.shoulder], we = world[i.elbow], ww = world[i.wrist]; const is = image[i.shoulder], ie = image[i.elbow], iw = image[i.wrist];
  const elbowVisible = visibleWithHysteresis(ie, history.elbowWasVisible, config.visibilityEnter, config.visibilityExit);
  const wristVisible = visibleWithHysteresis(iw, history.wristWasVisible, config.visibilityEnter, config.visibilityExit);
  const visibilityState = { elbow: elbowVisible, wrist: wristVisible };
  const reject = (reason: string, flags: string[] = []) => ({ result: null, diagnostic: emptyDiagnostic(side, image, reason, flags), visibilityState });
  if (!ws || !is) return reject("missing-shoulder");
  if (!visible(is, config.minimumPoseVisibility)) return reject("low-shoulder-visibility");
  if (!inOuterBounds(is, config.shoulderOuterBoundsMargin)) return reject("shoulder-outside-frame");
  let elbowObserved = Boolean(we && ie && elbowVisible && inOuterBounds(ie, config.elbowOuterBoundsMargin));
  const wristValid = Boolean(ww && iw && wristVisible && inOuterBounds(iw, config.wristOuterBoundsMargin));
  const lowerReason = !ww || !iw ? "missing-wrist" : !wristVisible ? "low-wrist-visibility" : !inOuterBounds(iw, config.wristOuterBoundsMargin) ? "wrist-outside-frame" : null;
  const flags: string[] = []; if ((elbowObserved && nearEdge(ie, config.edgeWarningMargin)) || (wristValid && nearEdge(iw, config.edgeWarningMargin))) flags.push("near-frame-edge");
  const shoulder = semanticPoint(ws), wrist = wristValid ? semanticPoint(ww!) : null;
  if (elbowObserved && wrist && handEvidence && handEvidence.geometryQuality >= config.elbowInferencePalmMinimumQuality) {
    const alignment = forearmPalmImageAlignment(semanticPoint(we!), wrist, handEvidence);
    if (alignment !== null && alignment < config.elbowObservedPalmRejectAlignment) {
      // MediaPipe có thể vẫn cho visibility cao khi elbow đã rời khung. Cẳng tay ngược mạnh
      // wrist→middle-MCP bị hạ cấp, sau đó giải lại bằng cùng đường two-bone IK.
      elbowObserved = false;
      flags.push("observed-elbow-hand-conflict");
    }
  }
  if (elbowObserved && wrist && !spatialEvidence?.face?.allowContact) {
    const penetration = rigArmCollisionPenetration(profile, side, shoulder, semanticPoint(we!), wrist);
    if (penetration && penetration.head > config.elbowObservedHeadCollisionRejectPenetration) {
      // Visibility cao không đảm bảo depth đúng. Nếu mapping lên chính VRM làm cẳng tay xuyên đầu trong khi
      // Hand thật đang tách khỏi mặt, hạ cấp elbow đó và giải lại trên vòng nghiệm có collision score.
      elbowObserved = false;
      flags.push("observed-elbow-head-collision");
    }
  }
  let elbowSource: ElbowSource = elbowObserved ? "observed" : "unavailable", inferenceConfidence = 0, reachRatio: number | null = null, inferredPosition: Vector3Data | null = null;
  let spatialDiagnostic: GeometryDiagnostic["spatial"] = {
    candidateCount: 0, selectedAngleRadians: null, faceEvidenceUsed: false,
    intentionalFaceContact: spatialEvidence?.face?.allowContact ?? false,
    facePenalty: 0, headCollisionPenalty: 0, torsoCollisionPenalty: 0,
  };
  const inferenceDurationMs = elbowObserved ? 0 : history.inferenceStartedAtMs === null || history.inferenceStartedAtMs === undefined ? 0 : nowMs - history.inferenceStartedAtMs;
  let elbow: Vector3;
  if (elbowObserved) elbow = semanticPoint(we!);
  else {
    if (!wrist) return reject("missing-elbow-and-wrist", flags);
    let upperCalibration = history.calibratedLength?.upper, lowerCalibration = history.calibratedLength?.lower;
    // Chiều dài đến từ quan sát thật hay chỉ là prior giải phẫu? Quyết định việc suy đoán có
    // được phép chạy vô thời hạn hay không (xem elbowInferenceUnboundedWhenFullyObserved).
    const calibrationFromObservation = Boolean(upperCalibration && lowerCalibration);
    if (!upperCalibration || !lowerCalibration) {
      // P0-3: chưa calibrated không còn nghĩa là "không thể infer". Dùng prior giải phẫu
      // scale theo bề rộng vai quan sát được ngay frame này, để elbow-inference chạy được
      // từ frame đầu tiên thay vì đợi khuỷu được quan sát đủ lâu để tích luỹ mẫu calibration.
      const oppositeShoulder = world[side === "left" ? INDICES.right.shoulder : INDICES.left.shoulder];
      const shoulderWidth = oppositeShoulder ? shoulder.distanceTo(semanticPoint(oppositeShoulder)) : null;
      if (!shoulderWidth || shoulderWidth < config.minimumSegmentLength) return reject("elbow-inference-uncalibrated", flags);
      const prior = boneLengthPrior(shoulderWidth);
      upperCalibration = prior.upper; lowerCalibration = prior.lower;
    }
    // Phase 3B partial-arm: miễn timeout khi nghiệm hình học đầy đủ và tươi — vai + cổ tay quan sát ngay
    // frame này, chiều dài xương từ quan sát thật. Khuỷu bị khung hình cắt (giơ tay chào) không
    // bao giờ quan sát lại được, nên đồng hồ inference chạy mãi và làm tay rơi xuống giữa lúc
    // người dùng vẫn đang giơ. Không có dữ liệu cũ nào tham gia thì không có sai số tích luỹ.
    const fullyObservedInference = config.elbowInferenceUnboundedWhenFullyObserved && calibrationFromObservation && wristValid;
    if (!fullyObservedInference && inferenceDurationMs > config.elbowInferenceTimeoutMs) return reject("elbow-inference-timeout", flags);
    if (fullyObservedInference && inferenceDurationMs > config.elbowInferenceTimeoutMs) flags.push("elbow-inference-sustained");
    // Phase 3B partial-arm: prior pole phải còn hạn. Trước đây `previousPole` được dùng bất kể tuổi, trong
    // khi tầng chọn pole của khung xương đã bỏ nó sau `poleFallbackTimeoutMs` — khuỷu suy đoán
    // và khung xương chạy trên hai pole khác nhau. Quá hạn thì lùi về rest prior có kiểm soát.
    const poleAgeMs = history.lastValidPoleAtMs === null || history.lastValidPoleAtMs === undefined ? null : nowMs - history.lastValidPoleAtMs;
    const historyPoleUsable = Boolean(history.previousPole) && (poleAgeMs === null || poleAgeMs <= config.elbowInferencePoleMaxAgeMs);
    const historyPrior = historyPoleUsable ? history.previousPole : null;
    const prior = historyPrior ?? history.previousSecondary?.upper ?? profile.joints[i.upper].anatomicalRestBasis.secondaryWorld;
    // `torso.right` trỏ từ vai phải sang vai trái (xem buildTorsoBasis). Phía ngoài thân của
    // tay trái là +right, của tay phải là −right. Không có torso quan sát được thì bỏ qua ràng
    // buộc thay vì đoán bừa hướng.
    const lateralOutward = torso ? vector(torso.right).multiplyScalar(side === "left" ? 1 : -1) : null;
    const inferred = inferElbow(shoulder, wrist, upperCalibration, lowerCalibration, prior, config.elbowInferenceReachSlackRatio, history.previousElbowDirection ?? null, lateralOutward, config.elbowInferenceMinimumLateralBias, spatialEvidence, side, profile, is, iw!, config);
    if (!inferred) return reject("elbow-inference-unreachable", flags);
    elbow = inferred.elbow; inferredPosition = vectorData(elbow); reachRatio = inferred.reachRatio;
    if (inferred.sideFlipPrevented) flags.push("elbow-side-flip-prevented");
    if (inferred.anatomyFlipApplied) flags.push("elbow-anatomy-flip");
    if (inferred.palmBranchApplied) flags.push("elbow-hand-palm-branch");
    if (inferred.faceBranchApplied) flags.push("elbow-face-clearance-branch");
    if (inferred.collisionBranchApplied) flags.push("elbow-rig-collision-branch");
    spatialDiagnostic = inferred.spatial;
    // Confidence chỉ suy giảm theo thời gian khi suy đoán đang phải dựa vào dữ liệu cũ. Ở chế
    // độ fully-observed, nghiệm tươi mỗi frame nên giữ nguyên confidence hình học.
    inferenceConfidence = fullyObservedInference
      ? inferred.confidence
      : inferred.confidence * Math.max(0, 1 - inferenceDurationMs / config.elbowInferenceTimeoutMs);
    elbowSource = historyPrior || history.previousSecondary?.upper ? "inferred-history" : "inferred-rest-prior"; flags.push("inferred-elbow");
  }
  let upper = elbow.clone().sub(shoulder), lower = wrist?.clone().sub(elbow) ?? null; const upperLength = upper.length(), lowerLength = lower?.length() ?? null; const armAxis = wrist?.clone().sub(shoulder) ?? upper.clone();
  if (!Number.isFinite(upperLength) || upperLength < config.minimumSegmentLength) return reject("invalid-upper-segment", flags);
  let lowerDirectionValid = Boolean(lower && lowerLength !== null && Number.isFinite(lowerLength) && lowerLength >= config.minimumSegmentLength);
  const segmentRatio = lowerDirectionValid ? upperLength / lowerLength! : null;
  if (segmentRatio !== null && (segmentRatio < config.minimumSegmentRatio || segmentRatio > config.maximumSegmentRatio)) { lowerDirectionValid = false; flags.push("extreme-segment-ratio"); }
  upper.normalize(); if (lowerDirectionValid) lower!.normalize(); armAxis.normalize();
  if (directionFilter) { upper = vector(directionFilter(i.upper, vectorData(upper))).normalize(); if (lowerDirectionValid) lower = vector(directionFilter(i.lower, vectorData(lower!))).normalize(); }
  const shoulderToElbow = elbow.clone().sub(shoulder); const elbowOffset = shoulderToElbow.clone().addScaledVector(armAxis, -shoulderToElbow.dot(armAxis));
  const elbowOffsetMagnitude = elbowOffset.length(); const normalizedElbowOffset = lowerDirectionValid ? elbowOffsetMagnitude / (upperLength + lowerLength!) : 0;
  // Phase 3B partial-arm: chụp hướng lệch TRƯỚC khi `elbowOffset` bị normalize in-place ở bước chọn pole.
  const elbowOffsetDirection = elbowOffsetMagnitude > 1e-4 ? vectorData(elbowOffset.clone().normalize()) : null;
  const depthAlignment = Math.abs(armAxis.z); const depthThreshold = history.previousDepthDegenerate ? config.depthDegenerateExitAlignment : config.depthDegenerateEnterAlignment;
  const depthDegenerate = depthAlignment >= depthThreshold; if (depthDegenerate) flags.push("depth-degenerate");
  // A1: chất lượng liên tục, tách theo nguồn suy biến — chỉ ghi vào diagnostic ở bước này,
  // chưa dùng để quyết định logic (đó là A2). depthQuality giảm khi trục xương chĩa vào
  // camera; bendPlaneQuality giảm khi tay gần duỗi thẳng (upper//lower thì mặt phẳng bẻ khuỷu
  // không xác định, cross gần 0).
  const depthQuality = 1 - smoothstep(config.depthQualityFullTrustAlignment, config.depthQualityNoTrustAlignment, depthAlignment);
  const bendPlaneQuality = lowerDirectionValid ? upper.clone().cross(lower!).length() : 0;
  const elbowBendDegrees = lowerDirectionValid ? upper.angleTo(lower!) * 180 / Math.PI : null;
  // Hysteresis: đang có pole tươi thì dùng ngưỡng THẤP để khó rớt ra (Enter=0.015); đang không
  // có thì dùng ngưỡng CAO để khó nhảy vào (Exit=0.03). Tên hai hằng đọc ngược với vai trò ở đây
  // — giữ nguyên tên để không lấn sang Phase 3C, nhưng đừng hoán vị chúng khi hiệu chỉnh.
  const offsetThreshold = history.previousPoleWasFresh ? config.elbowOffsetEnterMagnitude : config.elbowOffsetExitMagnitude;
  const weakOffset = elbowOffsetMagnitude < offsetThreshold || normalizedElbowOffset < config.minimumNormalizedElbowOffset; if (weakOffset) flags.push("weak-elbow-offset");
  // A2 (theo tư vấn chuyên gia): quyết định chấp nhận pole quan sát dựa trên trọng số tổng hợp
  // liên tục thay vì công tắc nhị phân `depthDegenerate`. `depthDegenerate` (dòng trên) vẫn giữ
  // nguyên vai trò cũ — làm nhãn chẩn đoán và điều khiển hysteresis alignment theo thời gian —
  // chỉ riêng điều kiện CHẤP NHẬN pole mới đổi sang dùng `observedPoleWeight`. `weakOffset` là
  // hard cutoff riêng biệt (elbow-offset quá nhỏ để đo góc chính xác, khác bản chất với depth).
  const observedPoleWeight = depthQuality * bendPlaneQuality;
  // A4 (theo tư vấn chuyên gia): hysteresis cho ngưỡng weight, tái dùng state
  // `previousPoleWasFresh` đã có sẵn — đang tin pole thì cần weight tụt sâu hơn (Exit thấp)
  // mới rớt; đang không tin thì cần weight cao hơn (Enter) mới nhận lại.
  const poleWeightThreshold = history.previousPoleWasFresh ? config.minimumObservedPoleWeightExit : config.minimumObservedPoleWeightEnter;
  const poleTooWeak = observedPoleWeight < poleWeightThreshold;
  let candidatePole = elbowObserved && lowerDirectionValid && !poleTooWeak && !weakOffset ? vectorData(elbowOffset.normalize()) : null; let poleAngularVelocity: number | null = null;
  if (candidatePole && history.previousPole && history.lastValidPoleAtMs !== null && nowMs > history.lastValidPoleAtMs) {
    poleAngularVelocity = vector(candidatePole).angleTo(vector(history.previousPole)) / ((nowMs - history.lastValidPoleAtMs) / 1_000);
    // Pole quay nhanh bất thường luôn là nhiễu, kể cả khi không có cảnh báo nào khác:
    // trước đây điều kiện `flags.length > 0` khiến outlier lọt qua đúng lúc tracking sạch.
    if (poleAngularVelocity > config.maximumPoleAngularVelocityRadiansPerSecond) { flags.push("pole-angular-outlier"); candidatePole = null; }
  }
  const rawCandidate = candidatePole;
  const projectToArm = (value: Vector3Data) => { const projected = vector(value).addScaledVector(armAxis, -vector(value).dot(armAxis)); return projected.lengthSq() > 1e-8 ? vectorData(projected.normalize()) : null; };
  // Chọn pole thô theo thứ tự ưu tiên TRƯỚC khi lọc. Lọc sau cùng trên giá trị đã chọn để
  // One Euro được update mọi frame; nếu chỉ lọc khi có candidate tươi, filter bị đóng băng
  // suốt lúc pole bị loại rồi nhả ra một cú nhảy khi pole quay lại.
  let poleSource: PoleSource = candidatePole ? "fresh" : "unavailable";
  let pole = candidatePole;
  // A3+A5 (theo tư vấn chuyên gia): chèn pole từ hướng bàn tay ngay sau observed/fresh, trước
  // pole lịch sử — đây là quan sát THẬT của frame hiện tại (khác previous, vốn là dữ liệu cũ),
  // nên đáng tin hơn dù yếu hơn elbow-offset. Chỉ thử khi elbow-offset không cho pole dùng được.
  let handPoleRejectionReason: GeometryDiagnostic["handPoleRejectionReason"] = "not-attempted";
  if (!pole) {
    const handResult = handPalmPole(wrist ?? elbow, world[i.index], world[i.pinky], image[i.index], image[i.pinky], config.minimumPoseVisibility, armAxis);
    handPoleRejectionReason = handResult.rejectionReason;
    if (handResult.pole) { pole = handResult.pole; poleSource = "hand"; }
  }
  if (!pole && history.previousPole && history.lastValidPoleAtMs !== null && nowMs - history.lastValidPoleAtMs <= config.poleFallbackTimeoutMs) { pole = projectToArm(history.previousPole); if (pole) poleSource = "previous"; }
  const torsoDelta = torso ? multiplyQuaternions(torso.worldRotation, inverseQuaternion(profile.torsoReference.worldRotation)) : { x: 0, y: 0, z: 0, w: 1 };
  const restCandidates = [profile.joints[i.upper].anatomicalRestBasis.secondaryWorld, profile.joints[i.upper].anatomicalRestBasis.binormalWorld].map((value) => projectToArm(rotateVector(torsoDelta, value))).filter((value): value is Vector3Data => Boolean(value));
  if (!pole) { pole = restCandidates[0] ?? null; if (pole) poleSource = "rest"; }
  // Lọc cả pole "previous" chứ không chỉ pole tươi: cả hai đều bắt nguồn từ quan sát thật, nên
  // One Euro tiếp tục được update trong lúc pole tạm bị loại thay vì đóng băng rồi nhả ra một cú
  // nhảy khi pole quay lại. Pole "rest" là hằng số suy ra từ rig, lọc nó chỉ làm bẩn state.
  if (pole && poleFilter && poleSource !== "rest") { const smoothed = projectToArm(poleFilter(side, pole)); if (smoothed) pole = smoothed; }
  // Pole "hand" là quan sát thật của chính frame này (khác "previous", vốn là dữ liệu cũ), nên
  // được coi tương đương "fresh" ở các bước dùng làm secondary axis và lưu lại cho frame sau.
  if (poleSource === "fresh" || poleSource === "hand") candidatePole = pole;
  const projectToPrimary = (value: Vector3Data, primary: Vector3) => { const projected = vector(value).addScaledVector(primary, -vector(value).dot(primary)); return projected.lengthSq() > 1e-8 ? vectorData(projected.normalize()) : null; };
  const transportedUpper = transportedSecondary(upper, history.previousPrimary?.upper, history.previousSecondary?.upper);
  // Phase 3A chỉ có quyền solve upperArm swing. Pole từ elbow/hand vẫn dùng cho bend plane,
  // inference và lower-arm frame, nhưng không đủ tin cậy để điều khiển axial roll của bắp tay:
  // ngay cả pole vuông góc rest (không phải chỉ đối dấu 180°) cũng làm mesh vai xoắn rõ.
  // Parallel-transport rest frame theo torso + primary hiện tại tạo minimal-twist swing.
  const upperRestPrimary = rotateVector(torsoDelta, profile.joints[i.upper].anatomicalRestBasis.primaryWorld);
  const upperRestSecondary = rotateVector(torsoDelta, profile.joints[i.upper].anatomicalRestBasis.secondaryWorld);
  const transportedRestUpper = transportedSecondary(upper, upperRestPrimary, upperRestSecondary);
  // Khi không có pole quan sát mới, giữ continuity đã parallel-transport; khi có pole mới,
  // dùng minimal-twist rest thay vì cho pole tiêm axial roll vào upperArm.
  let upperSecondary = candidatePole
    ? transportedRestUpper ?? transportedUpper
    : transportedUpper ?? transportedRestUpper;
  if (candidatePole) flags.push("upper-secondary-minimal-twist");
  if (!upperSecondary) upperSecondary = restCandidates.map((value) => projectToPrimary(value, upper)).find(Boolean) ?? null;
  if (!upperSecondary) return reject("invalid-upper-secondary", flags);
  let lowerSecondary: Vector3Data | null = null;
  if (lowerDirectionValid) {
    // Parallel transport chỉ đáng tin khi frame trước còn mới. Sau một đợt mất theo dõi dài,
    // `previousPrimary.lower` đã cũ; khi đó hệ quy chiếu vừa dựng từ cánh tay trên chính xác hơn.
    const transportUsable = history.lastValidPoleAtMs === null || nowMs - history.lastValidPoleAtMs <= config.poleFallbackTimeoutMs;
    const transportedLower = transportUsable ? transportedSecondary(lower!, history.previousPrimary?.lower, history.previousSecondary?.lower) : null;
    lowerSecondary = transportedLower ?? projectToPrimary(upperSecondary, lower!) ?? restCandidates.map((value) => projectToPrimary(value, lower!)).find(Boolean) ?? null;
    if (!lowerSecondary) lowerDirectionValid = false;
  }
  const projectedPole = projectToArm(pole ?? upperSecondary); if (!projectedPole) return reject("invalid-pole", flags);
  const targetWorldRotations: Partial<Record<ControlledArmJoint, QuaternionData>> = {}; const deltas: ArmDeltaOutput = {};
  const segments: Array<[ControlledArmJoint, Vector3, Vector3Data]> = [[i.upper, upper, upperSecondary]];
  if (lowerDirectionValid && lower && lowerSecondary) segments.push([i.lower, lower, lowerSecondary]);
  for (const [name, primary, secondary] of segments) {
    const joint = profile.joints[name], targetWorld = targetBoneWorld(primary, vector(secondary), joint); if (!targetWorld) return reject("invalid-frame", flags);
    const parentTargetWorld = joint.controlledParentJoint ? targetWorldRotations[joint.controlledParentJoint] : joint.parentRestWorldRotation; if (!parentTargetWorld) return reject("invalid-hierarchy", flags);
    const deltaLocal = multiplyQuaternions(inverseQuaternion(joint.restLocalRotation), multiplyQuaternions(inverseQuaternion(parentTargetWorld), targetWorld));
    const safe = constraintsEnabled ? constrainJointRotation(name, deltaLocal) : deltaLocal; if (!safe) return reject("invalid-constraint", flags);
    deltas[name] = safe; targetWorldRotations[name] = multiplyQuaternions(parentTargetWorld, multiplyQuaternions(joint.restLocalRotation, safe));
  }
  const plane = lowerDirectionValid && lower ? upper.clone().cross(lower) : new Vector3(), planeNormal = plane.lengthSq() > 1e-8 ? vectorData(plane.normalize()) : null;
  const diagnostic: GeometryDiagnostic = { ...emptyDiagnostic(side, image, null, flags), armValidity: "accepted", pole: projectedPole, poleSource,
    elbowOffsetMagnitude, normalizedElbowOffset, planeNormal, upperTargetWorld: targetWorldRotations[i.upper] ?? null, lowerTargetWorld: targetWorldRotations[i.lower] ?? null,
    upperSegmentLength: upperLength, lowerSegmentLength: lowerLength, segmentRatio, depthAlignment, candidatePole: rawCandidate,
    filteredPole: candidatePole, projectedPole, poleAngularVelocity, depthQuality, bendPlaneQuality, elbowBendDegrees, handPoleRejectionReason,
    observation: { upperDirectionValid: true, lowerDirectionValid, poleValid: Boolean(candidatePole), twistObservable: false,
      upperRejectionReason: null, lowerRejectionReason: lowerDirectionValid ? null : (lowerReason ?? "invalid-lower-segment"),
      poleRejectionReason: candidatePole ? null : !elbowObserved ? "inferred-elbow-preserve-twist" : poleTooWeak ? "depth-degenerate" : weakOffset ? "weak-elbow-offset" : "unavailable" },
    elbowInference: { source: elbowSource, confidence: elbowObserved ? 1 : inferenceConfidence, durationMs: inferenceDurationMs, inferredPosition,
      calibratedUpperLength: history.calibratedLength?.upper ?? null, calibratedLowerLength: history.calibratedLength?.lower ?? null,
      shoulderWristDistance: wrist ? shoulder.distanceTo(wrist) : null, reachRatio,
      distanceFromPreviousElbow: history.previousObservedElbow ? elbow.distanceTo(vector(history.previousObservedElbow)) : null },
    spatial: spatialDiagnostic };
  // Phase 3B partial-arm: hướng khuỷu lệch trục vai–cổ tay, dùng làm mỏ neo phía gập cho frame sau. Chỉ
  // ghi khi mặt phẳng gập còn đủ xác định (tay chưa gần duỗi thẳng); dưới ngưỡng đó hướng này
  // là nhiễu và sẽ khóa nhầm phía. Giữ null để caller tiếp tục dùng mỏ neo cũ.
  const elbowDirection = bendPlaneQuality >= config.elbowInferenceMinimumBendQuality ? elbowOffsetDirection : null;
  return { result: { deltas, targetWorldRotations, acceptedPole: projectedPole, poleSource, acceptedFreshPole: poleSource === "fresh", depthDegenerate, diagnostic, elbowDirection,
    segmentValidity: { upper: true, lower: lowerDirectionValid }, primary: { upper: vectorData(upper), lower: lowerDirectionValid ? vectorData(lower!) : null },
    secondary: { upper: upperSecondary, lower: lowerDirectionValid ? lowerSecondary : null }, elbowSource, elbowPosition: vectorData(elbow),
    observedLengths: elbowObserved && lowerDirectionValid ? { upper: upperLength, lower: lowerLength! } : null }, diagnostic, visibilityState };
}

export function solveAnatomicalArmFrames(
  worldLandmarks: RawNormalizedLandmarkV1[], imageLandmarks: RawNormalizedLandmarkV1[], profile: NormalizedAvatarRigProfile,
  histories: Record<ArmSide, ArmGeometryHistory>, nowMs: number, config: AvatarMotionConfig["armFrame"], constraintsEnabled = true,
  directionFilter?: (name: ControlledArmJoint, direction: Vector3Data) => Vector3Data,
  poleFilter?: (side: ArmSide, pole: Vector3Data) => Vector3Data,
  torsoFallback?: TorsoBasis,
  evidence: Partial<Record<ArmSide, HandElbowBranchEvidence | ArmSpatialEvidence | null>> = {},
): AnatomicalArmSolveResult {
  const observedTorso = buildTorsoBasis(worldLandmarks, config.minimumPoseVisibility, config.minimumSegmentLength);
  const torso = observedTorso ?? torsoFallback ?? {
    right: profile.torsoReference.rightWorld, up: profile.torsoReference.upWorld, forward: profile.torsoReference.forwardWorld,
    worldRotation: profile.torsoReference.worldRotation,
  };
  const normalizeEvidence = (value: HandElbowBranchEvidence | ArmSpatialEvidence | null | undefined): ArmSpatialEvidence | null => {
    if (!value) return null;
    return "hand" in value ? value : { hand: value, face: null, imageToWorldScale: null, imageAspectRatio: 1 };
  };
  const left = solveSide("left", worldLandmarks, imageLandmarks, profile, torso, histories.left, nowMs, config, constraintsEnabled, normalizeEvidence(evidence.left), directionFilter, poleFilter);
  const right = solveSide("right", worldLandmarks, imageLandmarks, profile, torso, histories.right, nowMs, config, constraintsEnabled, normalizeEvidence(evidence.right), directionFilter, poleFilter);
  return { torso, torsoWasObserved: Boolean(observedTorso), sides: { left: left.result, right: right.result }, diagnostics: { left: left.diagnostic, right: right.diagnostic },
    visibilityStates: { left: left.visibilityState, right: right.visibilityState } };
}
