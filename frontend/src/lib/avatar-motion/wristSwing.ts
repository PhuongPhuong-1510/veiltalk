import { Quaternion, Vector3 } from "three";
import type { QuaternionData, Vector3Data } from "./avatarPoseTypes";

export interface WristSwingConfig {
  minimumQuality: number;
  /** Detector disagreement below this angle is treated as a mechanically straight wrist. */
  straightDeadZoneRadians: number;
  smoothingTimeConstantSeconds: number;
  holdMs: number;
  returnMs: number;
  limits: { flexionRadians: number; extensionRadians: number; radialDeviationRadians: number; ulnarDeviationRadians: number };
}

export const DEFAULT_WRIST_SWING_CONFIG: WristSwingConfig = {
  minimumQuality: 0.2, straightDeadZoneRadians: 12 * Math.PI / 180,
  smoothingTimeConstantSeconds: 0.055, holdMs: 120, returnMs: 240,
  limits: { flexionRadians: 70 * Math.PI / 180, extensionRadians: 60 * Math.PI / 180, radialDeviationRadians: 25 * Math.PI / 180, ulnarDeviationRadians: 35 * Math.PI / 180 },
};

export interface WristSwingInput {
  forearmAxisWorld: Vector3Data; bendReferenceWorld: Vector3Data; palmForwardWorld: Vector3Data;
  lowerArmWorldRotation: QuaternionData; quality: number;
}

export interface WristSwingResult {
  accepted: boolean; localRotation: QuaternionData | null; flexionRadians: number;
  deviationRadians: number; limited: boolean; rejectionReason: string | null;
}

const finiteVector = (v: Vector3) => Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
const data = (q: Quaternion): QuaternionData => ({ x: q.x, y: q.y, z: q.z, w: q.w });
const clampSigned = (value: number, negativeLimit: number, positiveLimit: number) => Math.max(-negativeLimit, Math.min(positiveLimit, value));
const subtractDeadZone = (value: number, deadZone: number) => Math.sign(value) * Math.max(0, Math.abs(value) - deadZone);

/** Keep Hand Landmarker world vectors in the same semantic frame as Pose (`x, -y, -z`). */
export function handWorldVectorToAvatarSemantic(value: Vector3Data): Vector3Data {
  return { x: value.x, y: -value.y, z: -value.z };
}

/** Computes swing only; shortest-arc construction leaves forearm-axis twist to the existing layer. */
export function computeWristSwing(input: WristSwingInput, config: WristSwingConfig = DEFAULT_WRIST_SWING_CONFIG): WristSwingResult {
  const axis = new Vector3(input.forearmAxisWorld.x, input.forearmAxisWorld.y, input.forearmAxisWorld.z);
  const reference = new Vector3(input.bendReferenceWorld.x, input.bendReferenceWorld.y, input.bendReferenceWorld.z);
  const forward = new Vector3(input.palmForwardWorld.x, input.palmForwardWorld.y, input.palmForwardWorld.z);
  const rejected = (reason: string): WristSwingResult => ({ accepted: false, localRotation: null, flexionRadians: 0, deviationRadians: 0, limited: false, rejectionReason: reason });
  if (![axis, reference, forward].every(finiteVector) || !Number.isFinite(input.quality)) return rejected("non-finite");
  if (input.quality < config.minimumQuality) return rejected("quality-too-low");
  if (axis.lengthSq() < 1e-8 || reference.lengthSq() < 1e-8 || forward.lengthSq() < 1e-8) return rejected("degenerate-geometry");
  axis.normalize(); forward.normalize(); reference.addScaledVector(axis, -reference.dot(axis));
  if (reference.lengthSq() < 1e-8) return rejected("degenerate-reference");
  reference.normalize();
  const lateral = new Vector3().crossVectors(axis, reference).normalize();
  const axial = forward.dot(axis);
  // A human wrist cannot make the palm-forward vector point backwards along the forearm. This is
  // a Pose/Hand disagreement or occlusion, not an anatomical swing to clamp and render.
  if (axial < Math.cos(85 * Math.PI / 180)) return rejected("direction-disagreement");
  const rawFlexion = Math.atan2(forward.dot(reference), axial);
  const rawDeviation = Math.atan2(forward.dot(lateral), axial);
  const correctedFlexion = subtractDeadZone(rawFlexion, config.straightDeadZoneRadians);
  const correctedDeviation = subtractDeadZone(rawDeviation, config.straightDeadZoneRadians);
  const flexion = clampSigned(correctedFlexion, config.limits.extensionRadians, config.limits.flexionRadians);
  const deviation = clampSigned(correctedDeviation, config.limits.ulnarDeviationRadians, config.limits.radialDeviationRadians);
  const limitedForward = axis.clone().addScaledVector(reference, Math.tan(flexion)).addScaledVector(lateral, Math.tan(deviation)).normalize();
  const worldSwing = new Quaternion().setFromUnitVectors(axis, limitedForward).normalize();
  const lowerWorld = new Quaternion(input.lowerArmWorldRotation.x, input.lowerArmWorldRotation.y, input.lowerArmWorldRotation.z, input.lowerArmWorldRotation.w).normalize();
  const local = lowerWorld.clone().invert().multiply(worldSwing).multiply(lowerWorld).normalize();
  return { accepted: true, localRotation: data(local), flexionRadians: flexion, deviationRadians: deviation,
    limited: Math.abs(flexion - correctedFlexion) > 1e-6 || Math.abs(deviation - correctedDeviation) > 1e-6, rejectionReason: null };
}

export interface WristSwingTemporalState {
  output: QuaternionData;
  lastObservationAtMs: number | null;
  lastUpdateAtMs: number | null;
  lastAcceptedTarget: QuaternionData | null;
  pendingTarget: QuaternionData | null;
  pendingCount: number;
}
export const createWristSwingTemporalState = (): WristSwingTemporalState => ({
  output: { x: 0, y: 0, z: 0, w: 1 }, lastObservationAtMs: null, lastUpdateAtMs: null,
  lastAcceptedTarget: null, pendingTarget: null, pendingCount: 0,
});

const angularDistance = (a: Quaternion, b: Quaternion) => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b))));

export function updateWristSwingTemporal(state: WristSwingTemporalState, target: QuaternionData | null, observationIsNew: boolean, nowMs: number, config: WristSwingConfig = DEFAULT_WRIST_SWING_CONFIG): WristSwingTemporalState {
  const dt = state.lastUpdateAtMs === null ? 1 / 60 : Math.max(0, Math.min(0.1, (nowMs - state.lastUpdateAtMs) / 1000));
  const current = new Quaternion(state.output.x, state.output.y, state.output.z, state.output.w).normalize();
  let desired = current.clone(), lastObservationAtMs = state.lastObservationAtMs;
  let lastAcceptedTarget = state.lastAcceptedTarget, pendingTarget = state.pendingTarget, pendingCount = state.pendingCount;
  if (target && observationIsNew) {
    const candidate = new Quaternion(target.x, target.y, target.z, target.w).normalize();
    const accepted = lastAcceptedTarget ? new Quaternion(lastAcceptedTarget.x,lastAcceptedTarget.y,lastAcceptedTarget.z,lastAcceptedTarget.w).normalize() : null;
    const jump = accepted ? angularDistance(accepted, candidate) : 0;
    // One-frame branch flips are common when the palm covers the wrist/elbow. Large changes must
    // persist for two consecutive Hand samples; genuine motion then reacquires with normal slerp.
    if (!accepted || jump <= 55 * Math.PI / 180) {
      desired = candidate; lastAcceptedTarget = data(candidate); lastObservationAtMs = nowMs;
      pendingTarget = null; pendingCount = 0;
    } else {
      const pending = pendingTarget ? new Quaternion(pendingTarget.x,pendingTarget.y,pendingTarget.z,pendingTarget.w).normalize() : null;
      pendingCount = pending && angularDistance(pending, candidate) <= 15 * Math.PI / 180 ? pendingCount + 1 : 1;
      pendingTarget = data(candidate);
      if (pendingCount >= 2) {
        desired = candidate; lastAcceptedTarget = data(candidate); lastObservationAtMs = nowMs;
        pendingTarget = null; pendingCount = 0;
      }
    }
  }
  else if (lastObservationAtMs !== null && nowMs - lastObservationAtMs > config.holdMs) {
    desired.slerp(new Quaternion(), 1 - Math.exp(-Math.max(0, nowMs - lastObservationAtMs - config.holdMs) / Math.max(1, config.returnMs)));
  }
  current.slerp(desired, 1 - Math.exp(-dt / Math.max(1e-4, config.smoothingTimeConstantSeconds))).normalize();
  return { output: data(current), lastObservationAtMs, lastUpdateAtMs: nowMs, lastAcceptedTarget, pendingTarget, pendingCount };
}
