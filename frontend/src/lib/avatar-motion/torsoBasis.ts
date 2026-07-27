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

export function buildTorsoBasis(landmarks: RawNormalizedLandmarkV1[], minimumVisibility = 0.5, minimumLength = 1e-3): TorsoBasis | null {
  const leftShoulder = landmarks[11], rightShoulder = landmarks[12], leftHip = landmarks[23], rightHip = landmarks[24];
  if (![leftShoulder, rightShoulder, leftHip, rightHip].every((point) => point && (point.visibility === null || point.visibility >= minimumVisibility))) return null;
  const right = vector(subtract(leftShoulder, rightShoulder));
  const shoulderCenter = {
    x: (leftShoulder.x + rightShoulder.x) / 2, y: (leftShoulder.y + rightShoulder.y) / 2, z: (leftShoulder.z + rightShoulder.z) / 2, visibility: 1,
  };
  const hipCenter = { x: (leftHip.x + rightHip.x) / 2, y: (leftHip.y + rightHip.y) / 2, z: (leftHip.z + rightHip.z) / 2, visibility: 1 };
  const up = vector(subtract(shoulderCenter, hipCenter));
  if (right.length() < minimumLength || up.length() < minimumLength) return null;
  right.normalize(); up.addScaledVector(right, -up.dot(right)).normalize();
  const forward = right.clone().cross(up).normalize(); up.copy(forward).cross(right).normalize();
  const worldRotation = quaternionFromBasis(vectorData(right), vectorData(up), vectorData(forward));
  return worldRotation ? { right: vectorData(right), up: vectorData(up), forward: vectorData(forward), worldRotation } : null;
}

