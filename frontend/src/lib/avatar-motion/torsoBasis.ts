import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { QuaternionData, Vector3Data } from "./avatarPoseTypes";
import { subtract } from "./coordinateAdapter";
import { quaternionFromBasis, vector, vectorData } from "./motionMath";

export interface TorsoBasis {
  right: Vector3Data;
  up: Vector3Data;
  forward: Vector3Data;
  worldRotation: QuaternionData;
}

export interface TorsoBasisObservation {
  basis: TorsoBasis | null;
  visibility: Record<"leftShoulder" | "rightShoulder" | "leftHip" | "rightHip", number | null>;
  rejectionReason: "missing-landmark" | "low-visibility" | "degenerate-shoulder-axis" | "degenerate-up-axis" | "invalid-basis" | null;
}

export function inspectTorsoBasis(landmarks: RawNormalizedLandmarkV1[], minimumVisibility = 0.5, minimumLength = 1e-3): TorsoBasisObservation {
  const points = { leftShoulder: landmarks[11], rightShoulder: landmarks[12], leftHip: landmarks[23], rightHip: landmarks[24] };
  const visibility = Object.fromEntries(Object.entries(points).map(([key, point]) => [key, point?.visibility ?? null])) as TorsoBasisObservation["visibility"];
  if (Object.values(points).some((point) => !point)) return { basis: null, visibility, rejectionReason: "missing-landmark" };
  if (Object.values(points).some((point) => point!.visibility !== null && point!.visibility! < minimumVisibility)) return { basis: null, visibility, rejectionReason: "low-visibility" };
  const right = vector(subtract(points.leftShoulder!, points.rightShoulder!));
  if (right.length() < minimumLength) return { basis: null, visibility, rejectionReason: "degenerate-shoulder-axis" };
  const shoulderCenter = { x: (points.leftShoulder!.x + points.rightShoulder!.x) / 2, y: (points.leftShoulder!.y + points.rightShoulder!.y) / 2, z: (points.leftShoulder!.z + points.rightShoulder!.z) / 2, visibility: 1 };
  const hipCenter = { x: (points.leftHip!.x + points.rightHip!.x) / 2, y: (points.leftHip!.y + points.rightHip!.y) / 2, z: (points.leftHip!.z + points.rightHip!.z) / 2, visibility: 1 };
  const up = vector(subtract(shoulderCenter, hipCenter));
  if (up.length() < minimumLength) return { basis: null, visibility, rejectionReason: "degenerate-up-axis" };
  right.normalize(); up.addScaledVector(right, -up.dot(right)).normalize();
  const forward = right.clone().cross(up).normalize(); up.copy(forward).cross(right).normalize();
  const worldRotation = quaternionFromBasis(vectorData(right), vectorData(up), vectorData(forward));
  return worldRotation ? { basis: { right: vectorData(right), up: vectorData(up), forward: vectorData(forward), worldRotation }, visibility, rejectionReason: null }
    : { basis: null, visibility, rejectionReason: "invalid-basis" };
}

export function buildTorsoBasis(landmarks: RawNormalizedLandmarkV1[], minimumVisibility = 0.5, minimumLength = 1e-3): TorsoBasis | null {
  return inspectTorsoBasis(landmarks, minimumVisibility, minimumLength).basis;
}

