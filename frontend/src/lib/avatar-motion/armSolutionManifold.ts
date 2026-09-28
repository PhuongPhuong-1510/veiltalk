import { Quaternion } from "three";
import type { Vector3Data } from "./avatarPoseTypes";
import { vector, vectorData } from "./motionMath";

export interface ElbowSolutionCircle { center: Vector3Data; axis: Vector3Data; radius: number; reachRatio: number }

export function buildElbowSolutionCircle(shoulderData: Vector3Data, wristData: Vector3Data, upperLength: number, lowerLength: number, reachSlackRatio = 0): ElbowSolutionCircle | null {
  const shoulder = vector(shoulderData), wrist = vector(wristData), delta = wrist.sub(shoulder), distance = delta.length();
  if (![distance, upperLength, lowerLength].every(Number.isFinite) || distance < 1e-6 || upperLength <= 0 || lowerLength <= 0) return null;
  const min = Math.abs(upperLength - lowerLength), max = upperLength + lowerLength, slack = max * Math.max(0, reachSlackRatio);
  if (distance < min - slack || distance > max + slack) return null;
  const d = Math.min(max - 1e-6, Math.max(min + 1e-6, distance));
  const axis = delta.normalize(), x = (upperLength ** 2 - lowerLength ** 2 + d ** 2) / (2 * d);
  const radiusSquared = upperLength ** 2 - x ** 2;
  if (radiusSquared < -1e-6) return null;
  return { center: vectorData(shoulder.addScaledVector(axis, x)), axis: vectorData(axis), radius: Math.sqrt(Math.max(0, radiusSquared)), reachRatio: distance / max };
}

/** Projects history onto the new circle; no plausibility score is allowed to select another branch. */
export function projectElbowToCircle(circle: ElbowSolutionCircle, previousElbow: Vector3Data, fallbackPole?: Vector3Data | null): { elbow: Vector3Data; pole: Vector3Data } | null {
  const center = vector(circle.center), axis = vector(circle.axis);
  let radial = vector(previousElbow).sub(center).addScaledVector(axis, -vector(previousElbow).sub(center).dot(axis));
  if (radial.lengthSq() < 1e-10 && fallbackPole) radial = vector(fallbackPole).addScaledVector(axis, -vector(fallbackPole).dot(axis));
  if (radial.lengthSq() < 1e-10) return null;
  radial.normalize();
  return { elbow: vectorData(center.addScaledVector(radial, circle.radius)), pole: vectorData(radial) };
}

/** Minimal rotation transport, preserving a lower-arm configuration as its parent direction moves. */
export function parallelTransportDirection(direction: Vector3Data, fromPrimary: Vector3Data, toPrimary: Vector3Data): Vector3Data | null {
  const from = vector(fromPrimary), to = vector(toPrimary), value = vector(direction);
  if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10 || value.lengthSq() < 1e-10) return null;
  from.normalize(); to.normalize(); value.normalize();
  const q = new Quaternion().setFromUnitVectors(from, to);
  return vectorData(value.applyQuaternion(q).normalize());
}
