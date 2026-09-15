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

function buildBasis(rightInput: Vector3Data, upInput: Vector3Data): TorsoBasis | null {
  const right = vector(rightInput);
  const up = vector(upInput);
  if (right.length() < 1e-3 || up.length() < 1e-3) return null;
  right.normalize();
  up.addScaledVector(right, -up.dot(right));
  if (up.length() < 1e-3) return null;
  up.normalize();
  const forward = right.clone().cross(up).normalize();
  up.copy(forward).cross(right).normalize();
  const worldRotation = quaternionFromBasis(vectorData(right), vectorData(up), vectorData(forward));
  return worldRotation ? { right: vectorData(right), up: vectorData(up), forward: vectorData(forward), worldRotation } : null;
}

/**
 * Basis tối thiểu cho khung gọi video đầu-vai. Đường vai cho yaw/roll; camera-up chỉ là
 * prior để đóng frame nên pitch thân không được coi là quan sát được ở chế độ này.
 */
export function buildShoulderTorsoBasis(landmarks: RawNormalizedLandmarkV1[], minimumVisibility = 0.5, minimumLength = 1e-3): TorsoBasis | null {
  const leftShoulder = landmarks[11], rightShoulder = landmarks[12];
  if (![leftShoulder, rightShoulder].every((point) => point && (point.visibility === null || point.visibility >= minimumVisibility))) return null;
  const right = subtract(leftShoulder, rightShoulder);
  if (Math.hypot(right.x, right.y, right.z) < minimumLength) return null;
  return buildBasis(right, { x: 0, y: 1, z: 0 });
}

export function buildTorsoBasis(landmarks: RawNormalizedLandmarkV1[], minimumVisibility = 0.5, minimumLength = 1e-3): TorsoBasis | null {
  const leftShoulder = landmarks[11], rightShoulder = landmarks[12], leftHip = landmarks[23], rightHip = landmarks[24];
  if (![leftShoulder, rightShoulder, leftHip, rightHip].every((point) => point && (point.visibility === null || point.visibility >= minimumVisibility))) return null;
  const right = subtract(leftShoulder, rightShoulder);
  const shoulderCenter = {
    x: (leftShoulder.x + rightShoulder.x) / 2, y: (leftShoulder.y + rightShoulder.y) / 2, z: (leftShoulder.z + rightShoulder.z) / 2, visibility: 1,
  };
  const hipCenter = { x: (leftHip.x + rightHip.x) / 2, y: (leftHip.y + rightHip.y) / 2, z: (leftHip.z + rightHip.z) / 2, visibility: 1 };
  const up = subtract(shoulderCenter, hipCenter);
  if (Math.hypot(right.x, right.y, right.z) < minimumLength || Math.hypot(up.x, up.y, up.z) < minimumLength) return null;
  return buildBasis(right, up);
}

