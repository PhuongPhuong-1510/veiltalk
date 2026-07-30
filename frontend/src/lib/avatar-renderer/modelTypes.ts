import type { Object3D } from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import type { AvatarJointName } from "../avatar-motion/avatarPoseTypes";
import type { VRM } from "@pixiv/three-vrm";
import type { NormalizedAvatarRigProfile } from "../avatar-motion/normalizedRigProfile";
import type { FaceExpressionCapabilityRow } from "./faceExpressionDiagnostics";
import type { FaceExpressionBinding } from "./faceExpressionApplyPlan";
import type { GazeCapability } from "./gazeCapability";

export type AvatarModelBoneName = AvatarJointName | "head" | "leftEye" | "rightEye";

export interface AvatarModelRigProfile {
  id: string;
  boneNodes: Partial<Record<AvatarJointName | "head", string>>;
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
  torsoShoulder: {
    bones: Record<"hips" | "spine" | "chest" | "upperChest" | "leftShoulder" | "rightShoulder", boolean>;
    parents: Record<"hips" | "spine" | "chest" | "upperChest" | "leftShoulder" | "rightShoulder", string | null>;
    hierarchy: "full" | "without-upper-chest" | "reduced-chain" | "unsupported";
    shoulderStatus: Record<"left" | "right", "available" | "missing" | "invalid-parent">;
    upperArmParentMode: Record<"left" | "right", "fixed-rest">;
  };
  expressions: string[];
  faceExpressions: FaceExpressionCapabilityRow[];
  gaze: GazeCapability;
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

export interface LoadedAvatarModel {
  gltf: GLTF;
  vrm: VRM | null;
  root: Object3D;
  bones: Partial<Record<AvatarModelBoneName, Object3D>>;
  restRotations: Partial<Record<AvatarModelBoneName, { x: number; y: number; z: number; w: number }>>;
  morphTargets: Map<string, Array<{ influences: number[]; index: number; targetId: string }>>;
  expressionMap: Record<string, string>;
  faceExpressionMap: Record<string, string>;
  faceExpressionBindings: FaceExpressionBinding[];
  capability: ModelCapabilityReport;
  rigProfile: NormalizedAvatarRigProfile | null;
  dispose(): void;
}

export interface ModelLoadOptions {
  profile?: AvatarModelRigProfile;
  fileSizeBytes?: number | null;
  licenseStatus?: ModelCapabilityReport["licenseStatus"];
}
