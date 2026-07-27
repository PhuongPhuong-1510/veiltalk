import { Mesh, Vector3, type Material, type Object3D, type Texture } from "three";
import type { AvatarModelRigProfile, ModelCapabilityReport } from "./modelTypes";
import type { VRM } from "@pixiv/three-vrm";

const REQUIRED = ["head", "neck", "leftUpperArm", "leftLowerArm", "leftHand", "rightUpperArm", "rightLowerArm", "rightHand"] as const;
const OPTIONAL = ["chest", "leftShoulder", "rightShoulder"] as const;

export function inspectModel(root: Object3D, profile: AvatarModelRigProfile | undefined, sourceUrl: string, loadTimeMs: number, fileSizeBytes: number | null, licenseStatus: ModelCapabilityReport["licenseStatus"], vrm: VRM | null = null): ModelCapabilityReport {
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  const expressions = new Set<string>();
  let triangles = 0;
  let drawCalls = 0;
  let mtoon = false;
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    drawCalls += 1;
    const geometry = node.geometry;
    triangles += geometry.index ? geometry.index.count / 3 : (geometry.attributes.position?.count ?? 0) / 3;
    for (const name of Object.keys(node.morphTargetDictionary ?? {})) expressions.add(name);
    const nodeMaterials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of nodeMaterials) {
      materials.add(material);
      mtoon ||= material.type.toLowerCase().includes("mtoon");
      for (const value of Object.values(material)) if (value && typeof value === "object" && (value as Texture).isTexture) textures.add(value as Texture);
    }
  });
  const has = (key: string) => Boolean(vrm?.humanoid.getNormalizedBoneNode(key as Parameters<typeof vrm.humanoid.getNormalizedBoneNode>[0])
    ?? (profile?.boneNodes[key as keyof AvatarModelRigProfile["boneNodes"]] && root.getObjectByName(profile.boneNodes[key as keyof AvatarModelRigProfile["boneNodes"]]!)));
  const requiredBones = Object.fromEntries(REQUIRED.map((key) => [key, has(key)]));
  const optionalBones = Object.fromEntries(OPTIONAL.map((key) => [key, has(key)]));
  const extension = sourceUrl.split("?")[0].split(".").pop()?.toLowerCase();
  const format = extension === "vrm" ? "vrm" : extension === "glb" ? "glb" : extension === "gltf" ? "gltf" : "unknown";
  const unsupported: string[] = [];
  if (!profile && !vrm) unsupported.push("Chưa có rig profile đã kiểm chứng cho model.");
  if (!Object.values(requiredBones).every(Boolean)) unsupported.push("Thiếu required humanoid bone mapping.");
  if (format === "vrm" && !vrm) unsupported.push("VRM metadata không parse được.");
  const vrmExpressions = Object.keys(vrm?.expressionManager?.expressionMap ?? {});
  const direction = (parentName: "leftUpperArm" | "leftLowerArm" | "rightUpperArm" | "rightLowerArm", childName: "leftLowerArm" | "leftHand" | "rightLowerArm" | "rightHand") => {
    const parent = vrm?.humanoid.getNormalizedBoneNode(parentName); const child = vrm?.humanoid.getNormalizedBoneNode(childName);
    if (!parent || !child) return null; parent.updateWorldMatrix(true, false); child.updateWorldMatrix(true, false);
    const value = child.getWorldPosition(new Vector3()).sub(parent.getWorldPosition(new Vector3())).normalize(); return { x: value.x, y: value.y, z: value.z };
  };
  const normalizedArmRestDirections = vrm ? Object.fromEntries([
    ["leftUpperArm", direction("leftUpperArm", "leftLowerArm")], ["leftLowerArm", direction("leftLowerArm", "leftHand")],
    ["rightUpperArm", direction("rightUpperArm", "rightLowerArm")], ["rightLowerArm", direction("rightLowerArm", "rightHand")],
  ].filter((entry) => entry[1] !== null)) as Record<string, { x: number; y: number; z: number }> : undefined;
  const upperDirections = normalizedArmRestDirections ? [normalizedArmRestDirections.leftUpperArm, normalizedArmRestDirections.rightUpperArm].filter(Boolean) : [];
  const inferredRestPose = upperDirections.length === 2 && upperDirections.every((value) => Math.abs(value.y) < .25) ? "T-pose" : upperDirections.length === 2 ? "A-pose" : "unknown";
  return {
    loaded: true, format, vrmVersion: vrm?.meta.metaVersion ?? null, fileSizeBytes, loadTimeMs,
    humanoidRig: Object.values(requiredBones).every(Boolean), restPose: profile?.restPose ?? inferredRestPose,
    forwardAxis: profile?.forwardAxis ?? (vrm ? "-Z" : "unknown"), forwardAxisReason: profile ? "rig profile" : vrm ? "three-vrm normalized humanoid convention after VRM0 rotation" : "No VRM metadata or rig profile; cannot infer safely.", requiredBones, optionalBones,
    expressions: [...new Set([...expressions, ...vrmExpressions])].sort(), mtoonMaterial: mtoon || Boolean(vrm?.materials?.some((material) => material.type.toLowerCase().includes("mtoon"))), materialCount: materials.size,
    textureCount: textures.size, triangleCount: Math.round(triangles), drawCallsEstimate: drawCalls,
    licenseStatus, unsupportedFeatures: unsupported, normalizedArmRestDirections,
    rootTransform: { position: { x: root.position.x, y: root.position.y, z: root.position.z }, quaternion: { x: root.quaternion.x, y: root.quaternion.y, z: root.quaternion.z, w: root.quaternion.w }, scale: { x: root.scale.x, y: root.scale.y, z: root.scale.z } },
  };
}
