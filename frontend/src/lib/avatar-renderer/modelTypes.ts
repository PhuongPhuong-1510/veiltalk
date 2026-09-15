import type { Object3D } from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import type { AvatarJointName, AvatarPoseJointNameV2, Vector3Data } from "../avatar-motion/avatarPoseTypes";
import type { VRM } from "@pixiv/three-vrm";
import type { NormalizedAvatarRigProfile } from "../avatar-motion/normalizedRigProfile";
import type { FingerRigProfile } from "../avatar-motion/fingerRig";
import type { FacialCapabilityManifest } from "./facialCapability";
import type { GazeCapabilityAdapter } from "./gazeCapabilityAdapter";
import type { GazeEyelidSupport } from "../avatar-motion/gazeEyelidCoupling";
import type { UpperBodyRigProfileV1 } from "../avatar-motion/upperBodyRigProfile";

export interface AvatarModelRigProfile {
  id: string;
  boneNodes: Partial<Record<AvatarJointName | "head" | "hips" | "spine" | "upperChest", string>>;
  expressionMorphTargets: Record<string, string>;
  forwardAxis: "+Z" | "-Z";
  restPose: "T-pose" | "A-pose" | "unknown";
}

export interface ModelCapabilityReport {
  loaded: boolean;
  format: "gltf" | "glb" | "vrm" | "unknown";
  vrmVersion: string | null;
  fileSizeBytes: number | null;
  loadTimeMs: number;
  humanoidRig: boolean;
  restPose: AvatarModelRigProfile["restPose"];
  forwardAxis: AvatarModelRigProfile["forwardAxis"] | "unknown";
  requiredBones: Record<string, boolean>;
  optionalBones: Record<string, boolean>;
  expressions: string[];
  mtoonMaterial: boolean;
  materialCount: number;
  textureCount: number;
  triangleCount: number;
  drawCallsEstimate: number;
  licenseStatus: "verified" | "missing" | "unknown";
  unsupportedFeatures: string[];
  normalizedArmRestDirections?: Record<string, { x: number; y: number; z: number }>;
  rootTransform?: { position: { x: number; y: number; z: number }; quaternion: { x: number; y: number; z: number; w: number }; scale: { x: number; y: number; z: number } };
  forwardAxisReason?: string;
}

export interface ShoulderTranslationJointRigV1 {
  restLocalPosition: Vector3Data;
  /** Anatomical torso-up ở rest, biểu diễn trong local space của parent; current parent làm nó nghiêng theo torso. */
  torsoUpParentLocalRest: Vector3Data;
}

export interface ShoulderTranslationRigV1 {
  version: 1;
  shoulderWidth: number;
  joints: Partial<Record<"left" | "right", ShoulderTranslationJointRigV1>>;
}

export interface LoadedAvatarModel {
  gltf: GLTF;
  vrm: VRM | null;
  root: Object3D;
  bones: Partial<Record<AvatarPoseJointNameV2 | "head", Object3D>>;
  restRotations: Partial<Record<AvatarPoseJointNameV2 | "head", { x: number; y: number; z: number; w: number }>>;
  /** Raw skinned shoulder bones; normalized VRM chỉ transfer rotation, không transfer non-hips position. */
  shoulderTranslationBones: Partial<Record<"left" | "right", Object3D>>;
  shoulderTranslationRig: ShoulderTranslationRigV1 | null;
  morphTargets: Map<string, Array<{ influences: number[]; index: number }>>;
  expressionMap: Record<string, string>;
  capability: ModelCapabilityReport;
  facialCapability: FacialCapabilityManifest;
  gazeAdapter: GazeCapabilityAdapter;
  gazeEyelidSupport: GazeEyelidSupport;
  rigProfile: NormalizedAvatarRigProfile | null;
  upperBodyRigProfile: UpperBodyRigProfileV1 | null;
  /** Phase 3B.3: chuỗi xương ngón điều khiển được + flex axis của chính model này. null khi không phải VRM. */
  fingerRig: FingerRigProfile | null;
  dispose(): void;
}

export interface ModelLoadOptions {
  profile?: AvatarModelRigProfile;
  fileSizeBytes?: number | null;
  licenseStatus?: ModelCapabilityReport["licenseStatus"];
}
