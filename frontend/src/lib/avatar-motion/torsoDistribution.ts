import type { AvatarJointName, QuaternionData } from "./avatarPoseTypes";
import type { RigBoneRestProfile, TorsoShoulderRigCapability } from "./normalizedRigProfile";
import { inverseQuaternion, multiplyQuaternions } from "./motionMath";
import { torsoQuaternionFromSemanticEuler, type TorsoEulerDegrees } from "./torsoOrientation";

export type TorsoChainJoint = "hips" | "spine" | "chest" | "upperChest";
export type TorsoDistributionMode = "distributed" | "single-bone-fallback" | "unsupported";
export interface TorsoAxisShares { hips: number; spine: number; chest: number; upperChest: number }
export interface TorsoDistributionResult {
  mode: TorsoDistributionMode;
  activeBones: TorsoChainJoint[];
  progress: number;
  shares: { yaw: TorsoAxisShares; pitch: TorsoAxisShares; roll: TorsoAxisShares };
  total: QuaternionData;
  deltas: Partial<Record<AvatarJointName, QuaternionData>>;
  targetWorldRotations: Partial<Record<TorsoChainJoint, QuaternionData>>;
}

const ORDER: TorsoChainJoint[] = ["hips", "spine", "chest", "upperChest"];
const LIGHT: TorsoAxisShares = { hips: .08, spine: .20, chest: .37, upperChest: .35 };
const LARGE: TorsoAxisShares = { hips: .22, spine: .30, chest: .28, upperChest: .20 };
const emptyShares = (): TorsoAxisShares => ({ hips: 0, spine: 0, chest: 0, upperChest: 0 });
const smoothstep = (value: number): number => { const t = Math.min(1, Math.max(0, value)); return t * t * (3 - 2 * t); };
const usable = (bone: RigBoneRestProfile): boolean => Boolean(bone.available && bone.restLocalRotation && bone.restWorldRotation && bone.parentRestWorldRotation);

function normalizedShares(active: TorsoChainJoint[], progress: number): TorsoAxisShares {
  const result = emptyShares();
  const raw = active.map((name) => LIGHT[name] + (LARGE[name] - LIGHT[name]) * progress);
  const sum = raw.reduce((total, value) => total + value, 0);
  active.forEach((name, index) => { result[name] = sum > 0 ? raw[index] / sum : 0; });
  return result;
}

export function distributeTorsoRotation(semantic: TorsoEulerDegrees, capability: TorsoShoulderRigCapability): TorsoDistributionResult {
  const activeBones = ORDER.filter((name) => usable(capability.bones[name]));
  const magnitude = Math.max(Math.abs(semantic.yaw) / 45, Math.abs(semantic.pitch) / 20, Math.abs(semantic.roll) / 25);
  const progress = smoothstep(magnitude);
  const axisShares = normalizedShares(activeBones, progress);
  const shares = { yaw: { ...axisShares }, pitch: { ...axisShares }, roll: { ...axisShares } };
  const total = torsoQuaternionFromSemanticEuler(semantic);
  const mode: TorsoDistributionMode = activeBones.length === 0 ? "unsupported" : activeBones.length === 1 ? "single-bone-fallback" : "distributed";
  const deltas: TorsoDistributionResult["deltas"] = {};
  const targetWorldRotations: TorsoDistributionResult["targetWorldRotations"] = {};
  let cumulative = { x: 0, y: 0, z: 0, w: 1 };
  for (let index = 0; index < activeBones.length; index++) {
    const name = activeBones[index]; const bone = capability.bones[name]; const share = axisShares[name];
    const incremental = index === activeBones.length - 1
      ? multiplyQuaternions(inverseQuaternion(cumulative), total)
      : torsoQuaternionFromSemanticEuler({ yaw: semantic.yaw * share, pitch: semantic.pitch * share, roll: semantic.roll * share });
    cumulative = multiplyQuaternions(cumulative, incremental);
    const targetWorld = multiplyQuaternions(cumulative, bone.restWorldRotation!); targetWorldRotations[name] = targetWorld;
    const semanticParent = bone.parentSemantic as TorsoChainJoint | null;
    const parentTargetWorld = semanticParent && targetWorldRotations[semanticParent] ? targetWorldRotations[semanticParent]! : bone.parentRestWorldRotation!;
    deltas[name] = multiplyQuaternions(inverseQuaternion(bone.restLocalRotation!), multiplyQuaternions(inverseQuaternion(parentTargetWorld), targetWorld));
  }
  return { mode, activeBones, progress, shares, total, deltas, targetWorldRotations };
}
