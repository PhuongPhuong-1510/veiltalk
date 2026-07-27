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

export type GeometryDiagnostic = Omit<ArmFrameDiagnostic, "lossState" | "transitionProgress" | "invalidDurationMs" | "validRecoveryDurationMs" | "sampleDisposition" | "segmentLossState">;
export interface ArmGeometryHistory { previousPole: Vector3Data | null; previousPoleWasFresh: boolean; previousDepthDegenerate: boolean; lastValidPoleAtMs: number | null; previousPrimary?: { upper: Vector3Data | null; lower: Vector3Data | null }; previousSecondary?: { upper: Vector3Data | null; lower: Vector3Data | null }; calibratedLength?: { upper: number | null; lower: number | null }; previousObservedElbow?: Vector3Data | null; inferenceStartedAtMs?: number | null }
export interface SideArmGeometryResult {
  deltas: ArmDeltaOutput; targetWorldRotations: Partial<Record<ControlledArmJoint, QuaternionData>>;
  acceptedPole: Vector3Data; poleSource: PoleSource; acceptedFreshPole: boolean; depthDegenerate: boolean; diagnostic: GeometryDiagnostic;
  segmentValidity: { upper: boolean; lower: boolean };
  primary: { upper: Vector3Data; lower: Vector3Data | null }; secondary: { upper: Vector3Data; lower: Vector3Data | null };
  elbowSource: ElbowSource; elbowPosition: Vector3Data; observedLengths: { upper: number; lower: number } | null;
}
export interface AnatomicalArmSolveResult { torso: TorsoBasis; torsoWasObserved: boolean; sides: Record<ArmSide, SideArmGeometryResult | null>; diagnostics: Record<ArmSide, GeometryDiagnostic> }

const INDICES = {
  left: { shoulder: 11, elbow: 13, wrist: 15, upper: "leftUpperArm", lower: "leftLowerArm" },
  right: { shoulder: 12, elbow: 14, wrist: 16, upper: "rightUpperArm", lower: "rightLowerArm" },
} as const;
const semanticPoint = (point: RawNormalizedLandmarkV1) => new Vector3(point.x, -point.y, -point.z);
const visible = (point: RawNormalizedLandmarkV1 | undefined, minimum: number) => Boolean(point && point.visibility !== null && point.visibility >= minimum);
const imagePoint = (point: RawNormalizedLandmarkV1 | undefined): Vector3Data | null => point ? { x: point.x, y: point.y, z: point.z } : null;
const inOuterBounds = (point: RawNormalizedLandmarkV1 | undefined, margin: number) => Boolean(point && point.x >= -margin && point.x <= 1 + margin && point.y >= -margin && point.y <= 1 + margin);
const nearEdge = (point: RawNormalizedLandmarkV1 | undefined, margin: number) => Boolean(point && (point.x < margin || point.x > 1 - margin || point.y < margin || point.y > 1 - margin));

function emptyDiagnostic(side: ArmSide, imageLandmarks: RawNormalizedLandmarkV1[], reason: string | null, flags: string[] = []): GeometryDiagnostic {
  const i = INDICES[side];
  return { side, armValidity: reason ? "rejected" : "accepted", hardRejectionReason: reason, confidenceFlags: flags,
    imageBounds: { shoulder: imagePoint(imageLandmarks[i.shoulder]), elbow: imagePoint(imageLandmarks[i.elbow]), wrist: imagePoint(imageLandmarks[i.wrist]) },
    pole: null, poleSource: "unavailable", elbowOffsetMagnitude: null, normalizedElbowOffset: null, planeNormal: null,
    upperTargetWorld: null, lowerTargetWorld: null, upperSegmentLength: null, lowerSegmentLength: null, segmentRatio: null,
    depthAlignment: null, candidatePole: null, filteredPole: null, projectedPole: null, poleAngularVelocity: null,
    observation: { upperDirectionValid: false, lowerDirectionValid: false, poleValid: false, twistObservable: false, upperRejectionReason: reason, lowerRejectionReason: reason, poleRejectionReason: reason },
    elbowInference: { source: "unavailable", confidence: 0, durationMs: 0, inferredPosition: null, calibratedUpperLength: null, calibratedLowerLength: null, shoulderWristDistance: null, reachRatio: null, distanceFromPreviousElbow: null } };
}

function transportedSecondary(primary: Vector3, previousPrimary: Vector3Data | null | undefined, previousSecondary: Vector3Data | null | undefined): Vector3Data | null {
  if (!previousPrimary || !previousSecondary) return null;
  const from = vector(previousPrimary).normalize(), to = primary.clone().normalize();
  const rotation = new Quaternion().setFromUnitVectors(from, to); const transported = vector(previousSecondary).applyQuaternion(rotation);
  transported.addScaledVector(to, -transported.dot(to)); return transported.lengthSq() > 1e-8 ? vectorData(transported.normalize()) : null;
}

function inferElbow(shoulder: Vector3, wrist: Vector3, upperLength: number, lowerLength: number, prior: Vector3Data, reachSlackRatio: number): { elbow: Vector3; reachRatio: number; confidence: number } | null {
  const shoulderToWrist = wrist.clone().sub(shoulder), distance = shoulderToWrist.length(); if (!Number.isFinite(distance) || distance < 1e-6) return null;
  const minimumReach = Math.abs(upperLength - lowerLength), maximumReach = upperLength + lowerLength, slack = maximumReach * reachSlackRatio;
  if (distance < minimumReach - slack || distance > maximumReach + slack) return null;
  const clampedDistance = Math.min(maximumReach - 1e-6, Math.max(minimumReach + 1e-6, distance)); const axis = shoulderToWrist.normalize();
  const x = (upperLength * upperLength - lowerLength * lowerLength + clampedDistance * clampedDistance) / (2 * clampedDistance);
  const radiusSquared = upperLength * upperLength - x * x; if (radiusSquared < -1e-6) return null;
  const pole = vector(prior).addScaledVector(axis, -vector(prior).dot(axis)); if (pole.lengthSq() < 1e-8) return null; pole.normalize();
  const center = shoulder.clone().addScaledVector(axis, x); const elbow = center.addScaledVector(pole, Math.sqrt(Math.max(0, radiusSquared)));
  const reachRatio = distance / maximumReach; const violation = distance < minimumReach ? minimumReach - distance : distance > maximumReach ? distance - maximumReach : 0;
  return { elbow, reachRatio, confidence: Math.max(0, 1 - violation / Math.max(1e-6, slack)) };
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
  directionFilter?: (name: ControlledArmJoint, direction: Vector3Data) => Vector3Data,
  poleFilter?: (side: ArmSide, pole: Vector3Data) => Vector3Data,
): { result: SideArmGeometryResult | null; diagnostic: GeometryDiagnostic } {
  const i = INDICES[side]; const ws = world[i.shoulder], we = world[i.elbow], ww = world[i.wrist]; const is = image[i.shoulder], ie = image[i.elbow], iw = image[i.wrist];
  const reject = (reason: string, flags: string[] = []) => ({ result: null, diagnostic: emptyDiagnostic(side, image, reason, flags) });
  if (!ws || !is) return reject("missing-shoulder");
  if (!visible(is, config.minimumPoseVisibility)) return reject("low-shoulder-visibility");
  if (!inOuterBounds(is, config.shoulderOuterBoundsMargin)) return reject("shoulder-outside-frame");
  const elbowObserved = Boolean(we && ie && visible(ie, config.minimumPoseVisibility) && inOuterBounds(ie, config.elbowOuterBoundsMargin));
  const wristValid = Boolean(ww && iw && visible(iw, config.minimumPoseVisibility) && inOuterBounds(iw, config.wristOuterBoundsMargin));
  const lowerReason = !ww || !iw ? "missing-wrist" : !visible(iw, config.minimumPoseVisibility) ? "low-wrist-visibility" : !inOuterBounds(iw, config.wristOuterBoundsMargin) ? "wrist-outside-frame" : null;
  const flags: string[] = []; if ((elbowObserved && nearEdge(ie, config.edgeWarningMargin)) || (wristValid && nearEdge(iw, config.edgeWarningMargin))) flags.push("near-frame-edge");
  const shoulder = semanticPoint(ws), wrist = wristValid ? semanticPoint(ww!) : null;
  let elbowSource: ElbowSource = elbowObserved ? "observed" : "unavailable", inferenceConfidence = 0, reachRatio: number | null = null, inferredPosition: Vector3Data | null = null;
  const inferenceDurationMs = elbowObserved ? 0 : history.inferenceStartedAtMs === null || history.inferenceStartedAtMs === undefined ? 0 : nowMs - history.inferenceStartedAtMs;
  let elbow: Vector3;
  if (elbowObserved) elbow = semanticPoint(we!);
  else {
    if (!wrist) return reject("missing-elbow-and-wrist", flags);
    const upperCalibration = history.calibratedLength?.upper, lowerCalibration = history.calibratedLength?.lower;
    if (!upperCalibration || !lowerCalibration) return reject("elbow-inference-uncalibrated", flags);
    if (inferenceDurationMs > config.elbowInferenceTimeoutMs) return reject("elbow-inference-timeout", flags);
    const prior = history.previousPole ?? history.previousSecondary?.upper ?? profile.joints[i.upper].anatomicalRestBasis.secondaryWorld;
    const inferred = inferElbow(shoulder, wrist, upperCalibration, lowerCalibration, prior, config.elbowInferenceReachSlackRatio);
    if (!inferred) return reject("elbow-inference-unreachable", flags);
    elbow = inferred.elbow; inferredPosition = vectorData(elbow); reachRatio = inferred.reachRatio;
    inferenceConfidence = inferred.confidence * Math.max(0, 1 - inferenceDurationMs / config.elbowInferenceTimeoutMs);
    elbowSource = history.previousPole || history.previousSecondary?.upper ? "inferred-history" : "inferred-rest-prior"; flags.push("inferred-elbow");
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
  const depthAlignment = Math.abs(armAxis.z); const depthThreshold = history.previousDepthDegenerate ? config.depthDegenerateExitAlignment : config.depthDegenerateEnterAlignment;
  const depthDegenerate = depthAlignment >= depthThreshold; if (depthDegenerate) flags.push("depth-degenerate");
  const offsetThreshold = history.previousPoleWasFresh ? config.elbowOffsetEnterMagnitude : config.elbowOffsetExitMagnitude;
  const weakOffset = elbowOffsetMagnitude < offsetThreshold || normalizedElbowOffset < config.minimumNormalizedElbowOffset; if (weakOffset) flags.push("weak-elbow-offset");
  let candidatePole = elbowObserved && lowerDirectionValid && !depthDegenerate && !weakOffset ? vectorData(elbowOffset.normalize()) : null; let poleAngularVelocity: number | null = null;
  if (candidatePole && history.previousPole && history.lastValidPoleAtMs !== null && nowMs > history.lastValidPoleAtMs) {
    poleAngularVelocity = vector(candidatePole).angleTo(vector(history.previousPole)) / ((nowMs - history.lastValidPoleAtMs) / 1_000);
    if (poleAngularVelocity > config.maximumPoleAngularVelocityRadiansPerSecond && flags.length > 0) { flags.push("pole-angular-outlier"); candidatePole = null; }
  }
  const rawCandidate = candidatePole; if (candidatePole && poleFilter) candidatePole = poleFilter(side, candidatePole);
  let poleSource: PoleSource = candidatePole ? "fresh" : "unavailable"; let pole = candidatePole;
  const projectToArm = (value: Vector3Data) => { const projected = vector(value).addScaledVector(armAxis, -vector(value).dot(armAxis)); return projected.lengthSq() > 1e-8 ? vectorData(projected.normalize()) : null; };
  if (!pole && history.previousPole && history.lastValidPoleAtMs !== null && nowMs - history.lastValidPoleAtMs <= config.poleFallbackTimeoutMs) { pole = projectToArm(history.previousPole); if (pole) poleSource = "previous"; }
  const torsoDelta = torso ? multiplyQuaternions(torso.worldRotation, inverseQuaternion(profile.torsoReference.worldRotation)) : { x: 0, y: 0, z: 0, w: 1 };
  const restCandidates = [profile.joints[i.upper].anatomicalRestBasis.secondaryWorld, profile.joints[i.upper].anatomicalRestBasis.binormalWorld].map((value) => projectToArm(rotateVector(torsoDelta, value))).filter((value): value is Vector3Data => Boolean(value));
  if (!pole) { pole = restCandidates[0] ?? null; if (pole) poleSource = "rest"; }
  const projectToPrimary = (value: Vector3Data, primary: Vector3) => { const projected = vector(value).addScaledVector(primary, -vector(value).dot(primary)); return projected.lengthSq() > 1e-8 ? vectorData(projected.normalize()) : null; };
  const transportedUpper = transportedSecondary(upper, history.previousPrimary?.upper, history.previousSecondary?.upper);
  let upperSecondary = candidatePole ? projectToPrimary(candidatePole, upper) : transportedUpper;
  if (upperSecondary && transportedUpper && vector(upperSecondary).dot(vector(transportedUpper)) < 0) upperSecondary = vectorData(vector(upperSecondary).negate());
  if (!upperSecondary) upperSecondary = restCandidates.map((value) => projectToPrimary(value, upper)).find(Boolean) ?? null;
  if (!upperSecondary) return reject("invalid-upper-secondary", flags);
  let lowerSecondary: Vector3Data | null = null;
  if (lowerDirectionValid) {
    const transportedLower = transportedSecondary(lower!, history.previousPrimary?.lower, history.previousSecondary?.lower);
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
    filteredPole: candidatePole, projectedPole, poleAngularVelocity,
    observation: { upperDirectionValid: true, lowerDirectionValid, poleValid: Boolean(candidatePole), twistObservable: false,
      upperRejectionReason: null, lowerRejectionReason: lowerDirectionValid ? null : (lowerReason ?? "invalid-lower-segment"),
      poleRejectionReason: candidatePole ? null : !elbowObserved ? "inferred-elbow-preserve-twist" : depthDegenerate ? "depth-degenerate" : weakOffset ? "weak-elbow-offset" : "unavailable" },
    elbowInference: { source: elbowSource, confidence: elbowObserved ? 1 : inferenceConfidence, durationMs: inferenceDurationMs, inferredPosition,
      calibratedUpperLength: history.calibratedLength?.upper ?? null, calibratedLowerLength: history.calibratedLength?.lower ?? null,
      shoulderWristDistance: wrist ? shoulder.distanceTo(wrist) : null, reachRatio,
      distanceFromPreviousElbow: history.previousObservedElbow ? elbow.distanceTo(vector(history.previousObservedElbow)) : null } };
  return { result: { deltas, targetWorldRotations, acceptedPole: projectedPole, poleSource, acceptedFreshPole: poleSource === "fresh", depthDegenerate, diagnostic,
    segmentValidity: { upper: true, lower: lowerDirectionValid }, primary: { upper: vectorData(upper), lower: lowerDirectionValid ? vectorData(lower!) : null },
    secondary: { upper: upperSecondary, lower: lowerDirectionValid ? lowerSecondary : null }, elbowSource, elbowPosition: vectorData(elbow),
    observedLengths: elbowObserved && lowerDirectionValid ? { upper: upperLength, lower: lowerLength! } : null }, diagnostic };
}

export function solveAnatomicalArmFrames(
  worldLandmarks: RawNormalizedLandmarkV1[], imageLandmarks: RawNormalizedLandmarkV1[], profile: NormalizedAvatarRigProfile,
  histories: Record<ArmSide, ArmGeometryHistory>, nowMs: number, config: AvatarMotionConfig["armFrame"], constraintsEnabled = true,
  directionFilter?: (name: ControlledArmJoint, direction: Vector3Data) => Vector3Data,
  poleFilter?: (side: ArmSide, pole: Vector3Data) => Vector3Data,
  torsoFallback?: TorsoBasis,
): AnatomicalArmSolveResult {
  const observedTorso = buildTorsoBasis(worldLandmarks, config.minimumPoseVisibility, config.minimumSegmentLength);
  const torso = observedTorso ?? torsoFallback ?? {
    right: profile.torsoReference.rightWorld, up: profile.torsoReference.upWorld, forward: profile.torsoReference.forwardWorld,
    worldRotation: profile.torsoReference.worldRotation,
  };
  const left = solveSide("left", worldLandmarks, imageLandmarks, profile, torso, histories.left, nowMs, config, constraintsEnabled, directionFilter, poleFilter);
  const right = solveSide("right", worldLandmarks, imageLandmarks, profile, torso, histories.right, nowMs, config, constraintsEnabled, directionFilter, poleFilter);
  return { torso, torsoWasObserved: Boolean(observedTorso), sides: { left: left.result, right: right.result }, diagnostics: { left: left.diagnostic, right: right.diagnostic } };
}
