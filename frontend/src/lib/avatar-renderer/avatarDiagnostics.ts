import { ArrowHelper, AxesHelper, Group, Quaternion, Vector3, type Object3D } from "three";
import type { RawNormalizedLandmarkV1, RawTrackingFrameV1 } from "../tracking/rawTrackingTypes";
import type { AvatarJointName, QuaternionData, Vector3Data } from "../avatar-motion/avatarPoseTypes";
import { quaternionFromUnitVectors } from "../avatar-motion/coordinateAdapter";
import type { NormalizedAvatarRigProfile } from "../avatar-motion/normalizedRigProfile";

export type ArmJointName = Extract<AvatarJointName, "leftUpperArm" | "leftLowerArm" | "rightUpperArm" | "rightLowerArm">;
export type CoordinateConversion = "current" | "none" | "flipY" | "flipZ";
export const ARM_JOINTS: ArmJointName[] = ["leftUpperArm", "leftLowerArm", "rightUpperArm", "rightLowerArm"];
export const DEBUG_BONES = ["leftShoulder", ...ARM_JOINTS.slice(0, 2), "leftHand", "rightShoulder", ...ARM_JOINTS.slice(2), "rightHand"] as const;
export const HARD_CODED_REST: Record<ArmJointName, Vector3Data> = {
  leftUpperArm: { x: 1, y: 0, z: 0 }, leftLowerArm: { x: 1, y: 0, z: 0 },
  rightUpperArm: { x: -1, y: 0, z: 0 }, rightLowerArm: { x: -1, y: 0, z: 0 },
};
const SEGMENTS: Record<ArmJointName, [number, number]> = {
  leftUpperArm: [11, 13], leftLowerArm: [13, 15], rightUpperArm: [12, 14], rightLowerArm: [14, 16],
};
const CHILD_BONE: Record<ArmJointName, "leftLowerArm" | "leftHand" | "rightLowerArm" | "rightHand"> = {
  leftUpperArm: "leftLowerArm", leftLowerArm: "leftHand", rightUpperArm: "rightLowerArm", rightLowerArm: "rightHand",
};

export interface RestBasisRow {
  bone: string; nodeName: string; uuid: string; parentName: string;
  localPosition: Vector3Data; localQuaternion: QuaternionData; worldPosition: Vector3Data; worldQuaternion: QuaternionData;
  restDirection: Vector3Data | null; hardCodedDirection: Vector3Data | null; dot: number | null; angleDeg: number | null;
}
export interface JointDiagnosticRow {
  joint: ArmJointName; trackedBefore: Vector3Data; trackedAfter: Vector3Data; solverQuaternion: QuaternionData | null;
  parentWorldQuaternion: QuaternionData; packetDeltaLocalQuaternion: QuaternionData | null; targetLocalQuaternion: QuaternionData | null; appliedLocalQuaternion: QuaternionData;
  resultingWorldDirection: Vector3Data | null; angularErrorDeg: number | null;
}

const data = (v: Vector3 | Quaternion): any => "w" in v ? { x: v.x, y: v.y, z: v.z, w: v.w } : { x: v.x, y: v.y, z: v.z };
const normal = (v: Vector3Data) => new Vector3(v.x, v.y, v.z).normalize();
export function angularErrorDeg(a: Vector3Data, b: Vector3Data): number | null {
  const av = normal(a), bv = normal(b); if (av.lengthSq() === 0 || bv.lengthSq() === 0) return null;
  return Math.acos(Math.min(1, Math.max(-1, av.dot(bv)))) * 180 / Math.PI;
}
export function convertDirection(to: RawNormalizedLandmarkV1, from: RawNormalizedLandmarkV1, mode: CoordinateConversion): Vector3Data {
  const x = to.x - from.x, y = to.y - from.y, z = to.z - from.z;
  if (mode === "current") return { x, y: -y, z: -z };
  if (mode === "flipY") return { x, y: -y, z };
  if (mode === "flipZ") return { x, y, z: -z };
  return { x, y, z };
}
export function childDirection(bone: Object3D, child: Object3D | undefined): Vector3Data | null {
  if (!child) return null; bone.updateWorldMatrix(true, false); child.updateWorldMatrix(true, false);
  const direction = child.getWorldPosition(new Vector3()).sub(bone.getWorldPosition(new Vector3()));
  return direction.lengthSq() > 1e-12 ? data(direction.normalize()) : null;
}
export function appliedWorldDirection(bone: Object3D, restWorldDirection: Vector3Data, restWorldRotation: QuaternionData): Vector3Data | null {
  const localAxis = normal(restWorldDirection).applyQuaternion(new Quaternion(restWorldRotation.x, restWorldRotation.y, restWorldRotation.z, restWorldRotation.w).invert());
  if (localAxis.lengthSq() <= 1e-12) return null;
  bone.updateWorldMatrix(true, false);
  return data(localAxis.applyQuaternion(bone.getWorldQuaternion(new Quaternion())).normalize());
}
export function inspectRestBasis(bones: Partial<Record<string, Object3D>>): RestBasisRow[] {
  const childName: Record<string, string> = { leftShoulder: "leftUpperArm", leftUpperArm: "leftLowerArm", leftLowerArm: "leftHand", rightShoulder: "rightUpperArm", rightUpperArm: "rightLowerArm", rightLowerArm: "rightHand" };
  const rows: RestBasisRow[] = [];
  for (const name of DEBUG_BONES) {
    const bone = bones[name]; if (!bone) continue;
    const direction = childDirection(bone, bones[childName[name]]); const hard = HARD_CODED_REST[name as ArmJointName] ?? null;
    rows.push({ bone: name, nodeName: bone.name, uuid: bone.uuid, parentName: bone.parent?.name ?? "—", localPosition: data(bone.position), localQuaternion: data(bone.quaternion), worldPosition: data(bone.getWorldPosition(new Vector3())), worldQuaternion: data(bone.getWorldQuaternion(new Quaternion())), restDirection: direction, hardCodedDirection: hard, dot: direction && hard ? normal(direction).dot(normal(hard)) : null, angleDeg: direction && hard ? angularErrorDeg(direction, hard) : null });
  }
  return rows;
}
export function diagnoseJoints(bones: Partial<Record<string, Object3D>>, landmarks: RawNormalizedLandmarkV1[], mode: CoordinateConversion, targets: Partial<Record<string, QuaternionData>> = {}, profile: NormalizedAvatarRigProfile | null = null): JointDiagnosticRow[] {
  return ARM_JOINTS.map((joint) => {
    const [fromIndex, toIndex] = SEGMENTS[joint]; const from = landmarks[fromIndex], to = landmarks[toIndex]; const bone = bones[joint]!;
    const before = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z }; const after = convertDirection(to, from, mode);
    const parentQ = bone.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion(); const jointProfile = profile?.joints[joint];
    // Đo trục xương bằng rest basis và rotation hiện tại. Không dùng vị trí node con vì
    // normalized VRM proxy có thể cập nhật vị trí đó theo node cháu khi khuỷu tay xoay.
    const result = jointProfile
      ? appliedWorldDirection(bone, jointProfile.restWorldDirection, jointProfile.restWorldRotation)
      : childDirection(bone, bones[CHILD_BONE[joint]]);
    const delta = targets[joint] ?? null; const rest = profile?.joints[joint]?.restLocalRotation; const targetLocal = delta && rest ? data(new Quaternion(rest.x, rest.y, rest.z, rest.w).multiply(new Quaternion(delta.x, delta.y, delta.z, delta.w)).normalize()) : null;
    return { joint, trackedBefore: before, trackedAfter: after, solverQuaternion: quaternionFromUnitVectors(HARD_CODED_REST[joint], after), parentWorldQuaternion: data(parentQ), packetDeltaLocalQuaternion: delta, targetLocalQuaternion: targetLocal, appliedLocalQuaternion: data(bone.quaternion), resultingWorldDirection: result, angularErrorDeg: result ? angularErrorDeg(result, after) : null };
  });
}
export function elbowPlaneNormal(landmarks: RawNormalizedLandmarkV1[], side: "left" | "right", mode: CoordinateConversion): Vector3Data | null {
  const ids = side === "left" ? [11, 13, 15] : [12, 14, 16]; const a = convertDirection(landmarks[ids[1]], landmarks[ids[0]], mode); const b = convertDirection(landmarks[ids[2]], landmarks[ids[1]], mode);
  const n = normal(a).cross(normal(b)); return n.lengthSq() < 1e-8 ? null : data(n.normalize());
}
export function createDiagnosticHelpers(root: Object3D, bones: Partial<Record<string, Object3D>>): Group {
  const group = new Group(); group.name = "P4-T10 DEV diagnostics"; group.add(new AxesHelper(.25)); group.userData.restDirections = {};
  for (const joint of ARM_JOINTS) { const bone = bones[joint]; if (bone) group.userData.restDirections[joint] = childDirection(bone, bones[CHILD_BONE[joint]]); }
  for (const name of ["chest", ...DEBUG_BONES]) { const bone = bones[name]; if (!bone) continue; const axes = new AxesHelper(.08); axes.name = `axes:${name}`; bone.add(axes); group.userData.attached ??= []; group.userData.attached.push({ bone, axes }); }
  root.add(group); return group;
}
export function updateDiagnosticHelpers(group: Group, bones: Partial<Record<string, Object3D>>, landmarks: RawNormalizedLandmarkV1[], mode: CoordinateConversion): void {
  for (const child of [...group.children]) if (child.name.startsWith("vector:")) { group.remove(child); if (child instanceof ArrowHelper) { child.line.geometry.dispose(); child.cone.geometry.dispose(); } }
  for (const joint of ARM_JOINTS) {
    const bone = bones[joint]; if (!bone) continue; const [fromIndex, toIndex] = SEGMENTS[joint]; const origin = bone.getWorldPosition(new Vector3()); group.worldToLocal(origin);
    const tracked = normal(convertDirection(landmarks[toIndex], landmarks[fromIndex], mode));
    const resultData = childDirection(bone, bones[CHILD_BONE[joint]]);
    const restData = group.userData.restDirections[joint] as Vector3Data | null; const rest = restData ? normal(restData) : normal(HARD_CODED_REST[joint]);
    const arrows = [[rest, 0x44aaff, "rest"], [tracked, 0xffcc33, "tracked"], [resultData ? normal(resultData) : null, 0x44dd77, "result"]] as const;
    for (const [direction, color, label] of arrows) if (direction) { const arrow = new ArrowHelper(direction, origin, .22, color); arrow.name = `vector:${joint}:${label}`; group.add(arrow); }
  }
  for (const side of ["left", "right"] as const) { const normalData = elbowPlaneNormal(landmarks, side, mode); const shoulder = bones[`${side}UpperArm`]; if (!normalData || !shoulder) continue; const origin = shoulder.getWorldPosition(new Vector3()); group.worldToLocal(origin); const arrow = new ArrowHelper(normal(normalData), origin, .18, 0xff55cc); arrow.name = `vector:${side}:plane`; group.add(arrow); }
}
export function clearDiagnosticHelpers(group: Group): void {
  for (const { bone, axes } of group.userData.attached ?? []) { bone.remove(axes); axes.dispose(); }
  group.parent?.remove(group); group.traverse((object) => { if (object instanceof ArrowHelper) { object.line.geometry.dispose(); object.cone.geometry.dispose(); } });
}

const lm = (x: number, y: number, z: number): RawNormalizedLandmarkV1 => ({ x, y, z, visibility: 1 });
export type DebugPresetName = "tPose" | "armsDown" | "leftArmUp" | "rightArmUp" | "leftElbow90" | "rightElbow90" | "bothForward" | "twistReferenceA" | "twistReferenceB";
export function createDebugPreset(name: DebugPresetName, timestamp = 1000): RawTrackingFrameV1 {
  const points = Array.from({ length: 33 }, () => lm(0, 0, 0));
  // MediaPipe anatomical left appears on image-right for a person facing the camera.
  points[11] = lm(.2, 0, 0); points[12] = lm(-.2, 0, 0); points[13] = lm(.5, 0, 0); points[15] = lm(.8, 0, 0); points[19] = lm(.9, 0, 0);
  points[14] = lm(-.5, 0, 0); points[16] = lm(-.8, 0, 0); points[20] = lm(-.9, 0, 0);
  points[23] = lm(.15, .55, 0); points[24] = lm(-.15, .55, 0);
  if (name === "armsDown") { points[13] = lm(.2, .35, 0); points[15] = lm(.2, .7, 0); points[14] = lm(-.2, .35, 0); points[16] = lm(-.2, .7, 0); }
  if (name === "leftArmUp") { points[13] = lm(.2, -.35, 0); points[15] = lm(.2, -.7, 0); }
  if (name === "rightArmUp") { points[14] = lm(-.2, -.35, 0); points[16] = lm(-.2, -.7, 0); }
  if (name === "leftElbow90" || name.startsWith("twistReference")) { points[13] = lm(.5, 0, 0); points[15] = name === "twistReferenceB" ? lm(.5, 0, .3) : lm(.5, -.3, 0); }
  if (name === "rightElbow90") { points[14] = lm(-.5, 0, 0); points[16] = lm(-.5, -.3, 0); }
  if (name === "bothForward") { points[13] = lm(.2, 0, -.3); points[15] = lm(.2, 0, -.6); points[14] = lm(-.2, 0, -.3); points[16] = lm(-.2, 0, -.6); }
  const lost = { state: "lost" as const, sampledAtMs: null, landmarks: null, worldLandmarks: null };
  const imagePoints = points.map((point) => lm(.5 + point.x * .5, .5 + point.y * .5, point.z));
  return { version: 1, frameTimestampMs: timestamp, overall: "partial", face: { state: "lost", sampledAtMs: null, landmarks: null, blendshapes: null, facialTransform: null }, leftHand: { ...lost, handedness: "left", handednessScore: null }, rightHand: { ...lost, handedness: "right", handednessScore: null }, pose: { state: "tracked", sampledAtMs: timestamp, landmarks: imagePoints, worldLandmarks: points } };
}
