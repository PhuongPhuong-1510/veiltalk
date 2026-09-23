import { Matrix4, Mesh, Quaternion, SkinnedMesh, Vector3, type Material, type Object3D, type Texture } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { inspectModel } from "./modelCapability";
import type { LoadedAvatarModel, ModelLoadOptions, ShoulderTranslationRigV1 } from "./modelTypes";
import { freezeRigProfile, validateRigProfile, type ControlledArmJoint, type NormalizedAvatarRigProfile } from "../avatar-motion/normalizedRigProfile";
import { AVATAR_FINGER_JOINT_NAMES } from "../avatar-motion/avatarPoseTypes";
import { buildFingerRigProfile } from "../avatar-motion/fingerRig";
import { buildFacialCapabilityManifest } from "./facialCapability";
import { assertUniqueFacialExpressionTargets, buildVerifiedFacialExpressionMap } from "./facialExpressionProfile";
import { buildGazeEyelidSupport, GazeCapabilityAdapter } from "./gazeCapabilityAdapter";
import { classifyUpperBodyCapability, freezeUpperBodyRigProfile, validateUpperBodyRigProfile, type UpperBodyJointProfile, type UpperBodyRigProfileV1 } from "../avatar-motion/upperBodyRigProfile";
import type { AvatarUpperBodyJointName } from "../avatar-motion/avatarPoseTypes";

const quaternionData = (value: Quaternion) => ({ x: value.x, y: value.y, z: value.z, w: value.w });
const vectorData = (value: Vector3) => ({ x: value.x, y: value.y, z: value.z });
const radians = (degrees: number) => degrees * Math.PI / 180;

const UPPER_BODY_PARENTS: Record<AvatarUpperBodyJointName | "head", readonly (AvatarUpperBodyJointName | "head")[]> = {
  hips: [], spine: ["hips"], chest: ["spine", "hips"], upperChest: ["chest", "spine", "hips"],
  neck: ["upperChest", "chest", "spine", "hips"], head: ["neck", "upperChest", "chest", "spine", "hips"],
  leftShoulder: ["upperChest", "chest", "spine", "hips"], rightShoulder: ["upperChest", "chest", "spine", "hips"],
};

function upperBodyLimits(name: AvatarUpperBodyJointName | "head"): UpperBodyJointProfile["limits"] {
  if (name === "head") return { yawLeft: radians(32), yawRight: radians(32), pitchUp: radians(20), pitchDown: radians(25), rollLeft: radians(18), rollRight: radians(18) };
  if (name === "neck") return { yawLeft: radians(22), yawRight: radians(22), pitchUp: radians(12), pitchDown: radians(16), rollLeft: radians(12), rollRight: radians(12) };
  if (name === "leftShoulder" || name === "rightShoulder") return { yawLeft: radians(10), yawRight: radians(10), pitchUp: radians(12), pitchDown: radians(12), rollLeft: radians(12), rollRight: radians(12) };
  if (name === "hips") return { yawLeft: radians(5), yawRight: radians(5), pitchUp: radians(4), pitchDown: radians(4), rollLeft: radians(4), rollRight: radians(4) };
  return { yawLeft: radians(15), yawRight: radians(15), pitchUp: radians(12), pitchDown: radians(14), rollLeft: radians(10), rollRight: radians(10) };
}

export function createUpperBodyRigProfile(modelGeneration: number, fingerprint: string, bones: LoadedAvatarModel["bones"]): UpperBodyRigProfileV1 | null {
  const names = ["hips", "spine", "chest", "upperChest", "neck", "head", "leftShoulder", "rightShoulder"] as const;
  const joints: UpperBodyRigProfileV1["joints"] = {};
  for (const name of names) {
    const bone = bones[name];
    if (!bone || !bone.parent) continue;
    bone.updateWorldMatrix(true, false);
    const restWorld = bone.getWorldQuaternion(new Quaternion()).normalize();
    const inverseWorld = restWorld.clone().invert();
    const parent = UPPER_BODY_PARENTS[name].find((candidate) => Boolean(bones[candidate])) as AvatarUpperBodyJointName | undefined;
    joints[name] = {
      name,
      parent: parent ?? null,
      restLocalRotation: quaternionData(bone.quaternion.clone().normalize()),
      restWorldRotation: quaternionData(restWorld),
      parentRestWorldRotation: quaternionData(bone.parent.getWorldQuaternion(new Quaternion()).normalize()),
      pitchAxisLocal: vectorData(new Vector3(1, 0, 0).applyQuaternion(inverseWorld).normalize()),
      yawAxisLocal: vectorData(new Vector3(0, 1, 0).applyQuaternion(inverseWorld).normalize()),
      rollAxisLocal: vectorData(new Vector3(0, 0, 1).applyQuaternion(inverseWorld).normalize()),
      limits: upperBodyLimits(name),
    };
  }
  // Gốc upper-arm phản ánh bề rộng giải phẫu; hai clavicle/shoulder node của VRM thường nằm rất sát nhau.
  const left = bones.leftUpperArm ?? bones.leftShoulder, right = bones.rightUpperArm ?? bones.rightShoulder;
  let shoulderWidth: number | null = null;
  if (left && right) {
    left.updateWorldMatrix(true, false); right.updateWorldMatrix(true, false);
    const width = left.getWorldPosition(new Vector3()).distanceTo(right.getWorldPosition(new Vector3()));
    if (Number.isFinite(width) && width > 1e-6) shoulderWidth = width;
  }
  const draft = { version: 1 as const, modelGeneration, modelFingerprint: fingerprint, capability: "unsupported" as const, shoulderWidth, joints };
  const profile: UpperBodyRigProfileV1 = { ...draft, capability: classifyUpperBodyCapability(draft) };
  return validateUpperBodyRigProfile(profile) ? freezeUpperBodyRigProfile(profile) : null;
}

export function createShoulderTranslationRig(
  bones: Partial<Record<"leftShoulder" | "rightShoulder", Object3D>>,
  upperBodyProfile: UpperBodyRigProfileV1 | null,
): ShoulderTranslationRigV1 | null {
  const shoulderWidth = upperBodyProfile?.shoulderWidth;
  if (shoulderWidth === null || shoulderWidth === undefined || !Number.isFinite(shoulderWidth) || shoulderWidth <= 1e-6) return null;
  const joints: ShoulderTranslationRigV1["joints"] = {};
  for (const side of ["left", "right"] as const) {
    const bone = bones[side === "left" ? "leftShoulder" : "rightShoulder"];
    if (!bone?.parent) continue;
    bone.parent.updateWorldMatrix(true, false);
    const parentRestWorld = bone.parent.getWorldQuaternion(new Quaternion()).normalize();
    const axis = new Vector3(0, 1, 0).applyQuaternion(parentRestWorld.clone().invert()).normalize();
    if (![axis.x, axis.y, axis.z, bone.position.x, bone.position.y, bone.position.z].every(Number.isFinite)) continue;
    joints[side] = { restLocalPosition: vectorData(bone.position), torsoUpParentLocalRest: vectorData(axis) };
  }
  return Object.keys(joints).length > 0 ? Object.freeze({ version: 1, shoulderWidth, joints: Object.freeze(joints) }) : null;
}

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
  let collisionReference: NormalizedAvatarRigProfile["collisionReference"];
  const head = bones.head;
  if (head) {
    head.updateWorldMatrix(true, false);
    bones.hips?.updateWorldMatrix(true, false);
    const leftShoulderWorld = bones.leftUpperArm!.getWorldPosition(new Vector3());
    const rightShoulderWorld = bones.rightUpperArm!.getWorldPosition(new Vector3());
    const shoulderWidth = leftShoulderWorld.distanceTo(rightShoulderWorld);
    const neckWorld = neck.getWorldPosition(new Vector3());
    const headWorld = head.getWorldPosition(new Vector3());
    const neckHeadLength = neckWorld.distanceTo(headWorld);
    const chestWorld = chest.getWorldPosition(new Vector3());
    const torsoEnd = bones.hips?.getWorldPosition(new Vector3())
      ?? chestWorld.clone().addScaledVector(torsoUp, -Math.max(shoulderWidth * 0.9, neckHeadLength * 1.8));
    const upperLength = (side: "left" | "right") => joints[`${side}UpperArm`].restWorldPosition;
    const lowerLength = (side: "left" | "right") => joints[`${side}LowerArm`].restWorldPosition;
    const handPosition = (side: "left" | "right") => bones[`${side}Hand`]!.getWorldPosition(new Vector3());
    const distance = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    if (shoulderWidth > 1e-6 && neckHeadLength > 1e-6 && chestWorld.distanceTo(torsoEnd) > 1e-6) {
      const armRadius = shoulderWidth * 0.055;
      collisionReference = {
        head: {
          centerWorld: vectorData(headWorld.clone().addScaledVector(torsoUp, Math.max(neckHeadLength * 0.25, shoulderWidth * 0.06))),
          radius: Math.max(shoulderWidth * 0.22, neckHeadLength * 0.65),
        },
        torso: { startWorld: vectorData(chestWorld), endWorld: vectorData(torsoEnd), radius: shoulderWidth * 0.28 },
        arms: {
          left: { shoulderWorld: vectorData(leftShoulderWorld), upperLength: distance(upperLength("left"), lowerLength("left")), lowerLength: distance(lowerLength("left"), vectorData(handPosition("left"))), radius: armRadius },
          right: { shoulderWorld: vectorData(rightShoulderWorld), upperLength: distance(upperLength("right"), lowerLength("right")), lowerLength: distance(lowerLength("right"), vectorData(handPosition("right"))), radius: armRadius },
        },
      };
    }
  }
  const profile: NormalizedAvatarRigProfile = { version: 1, modelGeneration, modelFingerprint: fingerprint, torsoReference, joints, ...(collisionReference ? { collisionReference } : {}) };
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
    const semanticBones = ["head", "neck", "chest", "upperChest", "spine", "hips", "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand", "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand"] as const;
    if (vrm) for (const semantic of semanticBones) {
      const node = vrm.humanoid.getNormalizedBoneNode(semantic); if (!node) continue;
      bones[semantic] = node; restRotations[semantic] = { x: node.quaternion.x, y: node.quaternion.y, z: node.quaternion.z, w: node.quaternion.w };
    }
    // Phase 3B.3: 30 xương ngón. Tất cả đều OPTIONAL trong VRM — `continue` khi thiếu để model
    // không có ngón vẫn tải bình thường như trước. Danh sách arm ở trên không đổi.
    if (vrm) for (const semantic of AVATAR_FINGER_JOINT_NAMES) {
      const node = vrm.humanoid.getNormalizedBoneNode(semantic); if (!node) continue;
      bones[semantic] = node; restRotations[semantic] = { x: node.quaternion.x, y: node.quaternion.y, z: node.quaternion.z, w: node.quaternion.w };
    }
    const rigFingerprint = `${url}#vrm:${vrm?.meta.metaVersion ?? "none"}`;
    const rigProfile = vrm ? createRigProfile(generation, rigFingerprint, bones) : null;
    const upperBodyRigProfile = vrm ? createUpperBodyRigProfile(generation, rigFingerprint, bones) : null;
    const shoulderTranslationBones: LoadedAvatarModel["shoulderTranslationBones"] = {};
    if (vrm) {
      const left = vrm.humanoid.getRawBoneNode("leftShoulder"); const right = vrm.humanoid.getRawBoneNode("rightShoulder");
      if (left) shoulderTranslationBones.left = left; if (right) shoulderTranslationBones.right = right;
    }
    const shoulderTranslationRig = vrm ? createShoulderTranslationRig({ leftShoulder: shoulderTranslationBones.left, rightShoulder: shoulderTranslationBones.right }, upperBodyRigProfile) : null;
    // Dựng sau khi mọi xương đã vào `bones`: rig ngón đọc hình học rest pose của chính model này.
    const fingerRig = vrm ? buildFingerRigProfile(generation, bones, rigFingerprint) : null;
    const morphTargets: LoadedAvatarModel["morphTargets"] = new Map();
    gltf.scene.traverse((node) => {
      if (!(node instanceof Mesh) || !node.morphTargetDictionary || !node.morphTargetInfluences) return;
      for (const [name, index] of Object.entries(node.morphTargetDictionary)) {
        const targets = morphTargets.get(name) ?? [];
        targets.push({ influences: node.morphTargetInfluences, index }); morphTargets.set(name, targets);
      }
    });
    const modelFingerprint = `${url}#vrm:${vrm?.meta.metaVersion ?? "none"}`;
    const capability = inspectModel(gltf.scene, profile, url, this.now() - startedAt, options.fileSizeBytes ?? null, options.licenseStatus ?? "unknown", vrm);
    const gazeAdapter = new GazeCapabilityAdapter(vrm);
    const facialCapability = buildFacialCapabilityManifest(vrm, morphTargets, modelFingerprint, gazeAdapter.capability);
    let disposed = false;
    const expressionMap = { ...buildVerifiedFacialExpressionMap(morphTargets.keys(), modelFingerprint), ...(profile?.expressionMorphTargets ?? {}) };
    assertUniqueFacialExpressionTargets(expressionMap);
    const gazeEyelidSupport = buildGazeEyelidSupport(gazeAdapter.capability, expressionMap);
    return { gltf, vrm, root: gltf.scene, bones, restRotations, shoulderTranslationBones, shoulderTranslationRig, morphTargets, expressionMap, capability, facialCapability, gazeAdapter, gazeEyelidSupport, rigProfile, upperBodyRigProfile, fingerRig, dispose: () => { if (!disposed) { disposed = true; gazeAdapter.reset(); disposeObject(gltf.scene); } } };
  }
  invalidate(): void { this.generation += 1; }
}
