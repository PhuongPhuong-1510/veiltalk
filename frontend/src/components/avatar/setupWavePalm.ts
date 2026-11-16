import { Object3D, Quaternion, Vector3 } from "three";
import type { Vector3Data } from "../../lib/avatar-motion/avatarPoseTypes";

const EPSILON = 1e-8;

/**
 * Setup-only wrist correction. Rotates the wrist around the current forearm
 * axis so the rig-derived palm normal faces the thumbnail camera.
 */
export function faceSetupWavePalm(
  hand: Object3D,
  lowerArm: Object3D,
  palmNormalLocal: Vector3Data,
  cameraPosition: Vector3,
): boolean {
  if (!hand.parent) return false;

  const handPosition = hand.getWorldPosition(new Vector3());
  const forearmPosition = lowerArm.getWorldPosition(new Vector3());
  const twistAxis = handPosition.sub(forearmPosition);
  if (twistAxis.lengthSq() < EPSILON) return false;
  twistAxis.normalize();

  const handWorldRotation = hand.getWorldQuaternion(new Quaternion()).normalize();
  const palmNormal = new Vector3(palmNormalLocal.x, palmNormalLocal.y, palmNormalLocal.z)
    .applyQuaternion(handWorldRotation);
  palmNormal.addScaledVector(twistAxis, -palmNormal.dot(twistAxis));
  const towardCamera = cameraPosition.clone().sub(hand.getWorldPosition(new Vector3()));
  towardCamera.addScaledVector(twistAxis, -towardCamera.dot(twistAxis));
  if (palmNormal.lengthSq() < EPSILON || towardCamera.lengthSq() < EPSILON) return false;
  palmNormal.normalize();
  towardCamera.normalize();

  const angle = Math.atan2(
    twistAxis.dot(palmNormal.clone().cross(towardCamera)),
    palmNormal.dot(towardCamera),
  );
  const correctedWorld = new Quaternion().setFromAxisAngle(twistAxis, angle)
    .multiply(handWorldRotation)
    .normalize();
  const parentWorld = hand.parent.getWorldQuaternion(new Quaternion()).normalize();
  hand.quaternion.copy(parentWorld.invert().multiply(correctedWorld).normalize());
  return true;
}
