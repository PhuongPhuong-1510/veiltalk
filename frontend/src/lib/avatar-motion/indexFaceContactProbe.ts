import { Quaternion, Vector3 } from "three";
import type { NormalizedAvatarRigProfile } from "./normalizedRigProfile";
import type { QuaternionData } from "./avatarPoseTypes";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { AvatarProbeProfile } from "./avatarContactRig";
import type { HandContactProbeObservation } from "./bodyContactTypes";

const data = (v: Vector3) => ({ x: v.x, y: v.y, z: v.z });
export function observeIndexFaceProbe(landmarks: RawNormalizedLandmarkV1[] | null | undefined, width: number, height: number): HandContactProbeObservation | null {
  if (!landmarks || !(width > 0 && height > 0) || ![5, 6, 7, 8].every(i => landmarks[i] && [landmarks[i].x, landmarks[i].y, landmarks[i].z].every(Number.isFinite))) return null;
  const aspect = height / width, tip = landmarks[8], distal = landmarks[7], dx = tip.x - distal.x, dy = (tip.y - distal.y) * aspect, length = Math.hypot(dx, dy);
  if (length < .002 || tip.x < 0 || tip.x > 1 || tip.y < 0 || tip.y > 1) return null;
  return { probe: "indexTip", point: { x: tip.x, y: tip.y * aspect }, contactNormal: null, tangentHint: { x: -dy / length, y: dx / length }, confidence: Math.min(1, length / .012) };
}

/** Current observed finger rotations alter the wrist→tip offset; a rest-only rigid tip is invalid. */
export function buildPosedIndexContactProbe(profile: NormalizedAvatarRigProfile, side: "left" | "right", rotations: Partial<Record<string, QuaternionData>>): AvatarProbeProfile | null {
  const reference = profile.hands?.[side]?.indexTip; if (!reference || reference.segments.length !== 3) return null;
  const point = new Vector3(), rotation = new Quaternion();
  for (const segment of reference.segments) {
    point.add(new Vector3(segment.positionLocal.x, segment.positionLocal.y, segment.positionLocal.z).applyQuaternion(rotation));
    const delta = rotations[segment.joint];
    if (!delta || ![delta.x, delta.y, delta.z, delta.w].every(Number.isFinite)||Math.abs(Math.hypot(delta.x,delta.y,delta.z,delta.w)-1)>.01) return null;
    rotation.multiply(new Quaternion(segment.rotationLocal.x, segment.rotationLocal.y, segment.rotationLocal.z, segment.rotationLocal.w)).multiply(new Quaternion(delta.x, delta.y, delta.z, delta.w)).normalize();
  }
  const distal = new Vector3(reference.offsetLocal.x, reference.offsetLocal.y, reference.offsetLocal.z);
  point.add(distal.clone().applyQuaternion(rotation));
  const normal = distal.normalize().applyQuaternion(rotation); if (normal.lengthSq() < .99) return null;
  const tangent = Math.abs(normal.y) < .9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  tangent.addScaledVector(normal, -tangent.dot(normal)).normalize();
  return { probe: "indexTip", frameOffset: data(point), contactNormal: data(normal), tangentHint: data(tangent) };
}
