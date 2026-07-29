import { Matrix4, Mesh, Quaternion, SkinnedMesh, Vector3, type Material, type Object3D, type Texture } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { inspectModel } from "./modelCapability";
import type { LoadedAvatarModel, ModelLoadOptions } from "./modelTypes";
import { freezeRigProfile, validateRigProfile, type ControlledArmJoint, type NormalizedAvatarRigProfile } from "../avatar-motion/normalizedRigProfile";

const quaternionData = (value: Quaternion) => ({ x: value.x, y: value.y, z: value.z, w: value.w });
const vectorData = (value: Vector3) => ({ x: value.x, y: value.y, z: value.z });

/** Chỉ request mới nhất của đúng renderer đang active mới được commit state ra UI/processor. */
export function isCurrentModelLoadRequest<T extends object>(
  currentRenderer: T | null,
  requestRenderer: T,
  currentRequestId: number,
  requestId: number,
): boolean {
  return currentRenderer === requestRenderer && currentRequestId === requestId;
}

export function createRigProfile(modelGeneration: number, fingerprint: string, bones: LoadedAvatarModel["bones"]): NormalizedAvatarRigProfile | null {
  const pairs: Record<ControlledArmJoint, { parent: "leftShoulder" | "leftUpperArm" | "rightShoulder" | "rightUpperArm"; child: ControlledArmJoint | "leftHand" | "rightHand"; parentMode: "fixed-rest" | "controlled"; controlledParentJoint: ControlledArmJoint | null }> = {
    leftUpperArm: { parent: "leftShoulder", child: "leftLowerArm", parentMode: "fixed-rest", controlledParentJoint: null }, leftLowerArm: { parent: "leftUpperArm", child: "leftHand", parentMode: "controlled", controlledParentJoint: "leftUpperArm" },
    rightUpperArm: { parent: "rightShoulder", child: "rightLowerArm", parentMode: "fixed-rest", controlledParentJoint: null }, rightLowerArm: { parent: "rightUpperArm", child: "rightHand", parentMode: "controlled", controlledParentJoint: "rightUpperArm" },
  };
  const leftShoulder = bones.leftShoulder, rightShoulder = bones.rightShoulder, chest = bones.chest, neck = bones.neck;
  if (!leftShoulder || !rightShoulder || !chest || !neck) return null;
  [leftShoulder, rightShoulder, chest, neck].forEach((bone) => bone.updateWorldMatrix(true, false));
  const torsoRight = leftShoulder.getWorldPosition(new Vector3()).sub(rightShoulder.getWorldPosition(new Vector3())).normalize();
  const torsoUp = neck.getWorldPosition(new Vector3()).sub(chest.getWorldPosition(new Vector3()));
  torsoUp.addScaledVector(torsoRight, -torsoUp.dot(torsoRight)).normalize();
  const torsoForward = torsoRight.clone().cross(torsoUp).normalize(); torsoUp.copy(torsoForward).cross(torsoRight).normalize();
  if ([torsoRight, torsoUp, torsoForward].some((axis) => axis.lengthSq() < 1e-8)) return null;
  const torsoRotation = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(torsoRight, torsoUp, torsoForward)).normalize();
  const torsoReference = { rightWorld: vectorData(torsoRight), upWorld: vectorData(torsoUp), forwardWorld: vectorData(torsoForward), worldRotation: quaternionData(torsoRotation) };
  const joints = {} as NormalizedAvatarRigProfile["joints"];
  for (const [name, definition] of Object.entries(pairs) as Array<[ControlledArmJoint, typeof pairs[ControlledArmJoint]]>) {
    const bone = bones[name], child = bones[definition.child]; if (!bone || !child || !bone.parent) return null;
    bone.updateWorldMatrix(true, false); child.updateWorldMatrix(true, false);
    const restDirection = child.getWorldPosition(new Vector3()).sub(bone.getWorldPosition(new Vector3())).normalize();
    if (restDirection.lengthSq() < 1e-8) return null;
    const secondaryWorld = torsoUp.clone().addScaledVector(restDirection, -torsoUp.dot(restDirection)).normalize();
    const binormalWorld = restDirection.clone().cross(secondaryWorld).normalize(); secondaryWorld.copy(binormalWorld).cross(restDirection).normalize();
    if (secondaryWorld.lengthSq() < 1e-8 || binormalWorld.lengthSq() < 1e-8) return null;
    const restWorldRotation = bone.getWorldQuaternion(new Quaternion()).normalize(); const inverseRestWorld = restWorldRotation.clone().invert();
    const primaryLocal = restDirection.clone().applyQuaternion(inverseRestWorld).normalize();
    const secondaryLocal = secondaryWorld.clone().applyQuaternion(inverseRestWorld).normalize();
    const binormalLocal = binormalWorld.clone().applyQuaternion(inverseRestWorld).normalize();
    const frameWorldRotation = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(restDirection, secondaryWorld, binormalWorld)).normalize();
    joints[name] = { parentJoint: definition.parent, childJoint: definition.child, parentMode: definition.parentMode, controlledParentJoint: definition.controlledParentJoint,
      restLocalPosition: vectorData(bone.position), restLocalRotation: quaternionData(bone.quaternion.clone().normalize()),
      restWorldPosition: vectorData(bone.getWorldPosition(new Vector3())), restWorldRotation: quaternionData(restWorldRotation),
      parentRestWorldRotation: quaternionData(bone.parent.getWorldQuaternion(new Quaternion()).normalize()), restWorldDirection: vectorData(restDirection),
      anatomicalRestBasis: { primaryLocal: vectorData(primaryLocal), secondaryLocal: vectorData(secondaryLocal), binormalLocal: vectorData(binormalLocal), primaryWorld: vectorData(restDirection), secondaryWorld: vectorData(secondaryWorld), binormalWorld: vectorData(binormalWorld), worldRotation: quaternionData(frameWorldRotation) } };
  }
  const profile: NormalizedAvatarRigProfile = { version: 1, modelGeneration, modelFingerprint: fingerprint, torsoReference, joints };
  return validateRigProfile(profile) ? freezeRigProfile(profile) : null;
}

export function disposeObject(root: Object3D): void {
  const textures = new Set<Texture>(); const materials = new Set<Material>();
  root.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    node.geometry.dispose();
    if (node instanceof SkinnedMesh) node.skeleton.dispose();
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value && typeof value === "object" && (value as Texture).isTexture) textures.add(value as Texture);
    }
  });
  textures.forEach((texture) => texture.dispose()); materials.forEach((material) => material.dispose());
}

export class AvatarModelLoader {
  private generation = 0;
  private readonly loader: GLTFLoader;
  private readonly now: () => number;
  constructor(loader = new GLTFLoader(), now: () => number = () => performance.now()) {
    this.loader = loader; this.now = now;
    this.loader.register((parser) => new VRMLoaderPlugin(parser, { autoUpdateHumanBones: true }));
  }

  async load(url: string, options: ModelLoadOptions = {}): Promise<LoadedAvatarModel | null> {
    const generation = ++this.generation; const startedAt = this.now();
    const gltf = await this.loader.loadAsync(url);
    if (generation !== this.generation) { disposeObject(gltf.scene); return null; }
    const profile = options.profile;
    const vrm = (gltf.userData.vrm as VRM | undefined) ?? null;
    // VRM 0.x dùng hướng model khác VRM 1.0; chuẩn hóa về convention của three-vrm.
    if (vrm?.meta.metaVersion === "0") VRMUtils.rotateVRM0(vrm);
    gltf.scene.updateMatrixWorld(true);
    const bones: LoadedAvatarModel["bones"] = {};
    const restRotations: LoadedAvatarModel["restRotations"] = {};
    for (const [semantic, nodeName] of Object.entries(profile?.boneNodes ?? {})) {
      const node = gltf.scene.getObjectByName(nodeName); if (node) {
        const key = semantic as keyof typeof bones; bones[key] = node;
        restRotations[key] = { x: node.quaternion.x, y: node.quaternion.y, z: node.quaternion.z, w: node.quaternion.w };
      }
    }
    const semanticBones = ["head", "neck", "chest", "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand", "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand"] as const;
    if (vrm) for (const semantic of semanticBones) {
      const node = vrm.humanoid.getNormalizedBoneNode(semantic); if (!node) continue;
      bones[semantic] = node; restRotations[semantic] = { x: node.quaternion.x, y: node.quaternion.y, z: node.quaternion.z, w: node.quaternion.w };
    }
    const rigProfile = vrm ? createRigProfile(generation, `${url}#vrm:${vrm.meta.metaVersion}`, bones) : null;
    const morphTargets: LoadedAvatarModel["morphTargets"] = new Map();
    gltf.scene.traverse((node) => {
      if (!(node instanceof Mesh) || !node.morphTargetDictionary || !node.morphTargetInfluences) return;
      for (const [name, index] of Object.entries(node.morphTargetDictionary)) {
        const targets = morphTargets.get(name) ?? [];
        targets.push({ influences: node.morphTargetInfluences, index }); morphTargets.set(name, targets);
      }
    });
    const capability = inspectModel(gltf.scene, profile, url, this.now() - startedAt, options.fileSizeBytes ?? null, options.licenseStatus ?? "unknown", vrm);
    let disposed = false;
    return { gltf, vrm, root: gltf.scene, bones, restRotations, morphTargets, expressionMap: profile?.expressionMorphTargets ?? {}, capability, rigProfile, dispose: () => { if (!disposed) { disposed = true; disposeObject(gltf.scene); } } };
  }
  invalidate(): void { this.generation += 1; }
}
