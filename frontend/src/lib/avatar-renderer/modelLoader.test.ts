import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial, Object3D, Vector3 } from "three";
import { describe, expect, it, vi } from "vitest";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import type { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMExpression, VRMExpressionManager, VRMExpressionMorphTargetBind, type VRM } from "@pixiv/three-vrm";
import { AvatarModelLoader, createRigProfile, disposeObject, isCurrentModelLoadRequest } from "./modelLoader";

const gltf = (root: Group): GLTF => ({ scene: root, scenes: [root], animations: [], cameras: [], asset: {}, parser: {} as GLTF["parser"], userData: {} });

describe("AvatarModelLoader", () => {
  it("lets only the latest renderer request commit model and rig state", () => {
    const oldRenderer = {};
    const currentRenderer = {};
    expect(isCurrentModelLoadRequest(currentRenderer, currentRenderer, 2, 2)).toBe(true);
    expect(isCurrentModelLoadRequest(currentRenderer, oldRenderer, 2, 1)).toBe(false);
    expect(isCurrentModelLoadRequest(currentRenderer, currentRenderer, 3, 2)).toBe(false);
    expect(isCurrentModelLoadRequest(null, currentRenderer, 2, 2)).toBe(false);
  });

  it("ignores and disposes a stale model load", async () => {
    const roots = [new Group(), new Group()];
    let resolveFirst!: (value: GLTF) => void;
    const loadAsync = vi.fn().mockImplementationOnce(() => new Promise<GLTF>((resolve) => { resolveFirst = resolve; })).mockResolvedValueOnce(gltf(roots[1]));
    const loader = new AvatarModelLoader({ loadAsync, register: vi.fn() } as unknown as GLTFLoader, () => 10);
    const first = loader.load("first.glb"); const second = loader.load("second.glb"); resolveFirst(gltf(roots[0]));
    expect(await first).toBeNull(); expect((await second)?.root).toBe(roots[1]);
  });
  it("uses only an explicit rig profile and reports required capabilities", async () => {
    const root = new Group(); const head = new Object3D(); head.name = "HeadVerified"; root.add(head);
    const loader = new AvatarModelLoader({ loadAsync: vi.fn().mockResolvedValue(gltf(root)), register: vi.fn() } as unknown as GLTFLoader, () => 20);
    const model = await loader.load("avatar.glb", { profile: { id: "test", boneNodes: { head: "HeadVerified" }, expressionMorphTargets: {}, forwardAxis: "+Z", restPose: "T-pose" } });
    expect(model?.bones.head).toBe(head); expect(model?.capability.requiredBones.head).toBe(true); expect(model?.capability.humanoidRig).toBe(false);
    expect(model?.capability.faceExpressions.find((row) => row.semantic === "jawOpen")?.support).toBe("unsupported");
  });
  it("builds deterministic direct and fallback face expression mappings from model morphs", async () => {
    const root = new Group(); const mesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
    mesh.morphTargetDictionary = { aa: 0, blinkLeft: 1, cheekPuff: 2 }; mesh.morphTargetInfluences = [0, 0, 0]; root.add(mesh);
    const loader = new AvatarModelLoader({ loadAsync: vi.fn().mockResolvedValue(gltf(root)), register: vi.fn() } as unknown as GLTFLoader, () => 20);
    const model = await loader.load("face.glb");
    expect(model?.faceExpressionMap).toMatchObject({ jawOpen: "aa", aa: "aa", eyeBlinkLeft: "blinkLeft", blinkLeft: "blinkLeft", cheekPuff: "cheekPuff" });
    expect(model?.faceExpressionBindings.find((row) => row.semantic === "jawOpen")?.target.type).toBe("raw-morph");
    expect(model?.faceExpressionBindings.find((row) => row.semantic === "jawOpen")?.target.physicalTargetIds[0]).toMatch(/^morph:/);
    expect(model?.capability.faceExpressions.find((row) => row.semantic === "jawOpen")?.support).toBe("fallback");
    expect(model?.capability.faceExpressions.find((row) => row.semantic === "cheekPuff")?.support).toBe("mapped");
  });
  it("gives a VRM expression ownership of its physical morph binds", async () => {
    const root = new Group(); const mesh = new Mesh(new BufferGeometry(), new MeshBasicMaterial());
    mesh.morphTargetDictionary = { happy: 0 }; mesh.morphTargetInfluences = [0]; root.add(mesh);
    const expression = new VRMExpression("happy"); expression.addBind(new VRMExpressionMorphTargetBind({ primitives: [mesh], index: 0, weight: 1 }));
    const expressionManager = new VRMExpressionManager(); expressionManager.registerExpression(expression);
    const loaded = gltf(root); loaded.userData.vrm = {
      meta: { metaVersion: "1" }, expressionManager,
      humanoid: { getNormalizedBoneNode: () => null }, materials: [],
    } as unknown as VRM;
    const loader = new AvatarModelLoader({ loadAsync: vi.fn().mockResolvedValue(loaded), register: vi.fn() } as unknown as GLTFLoader, () => 20);
    const model = await loader.load("face.vrm");
    const binding = model?.faceExpressionBindings.find((row) => row.semantic === "happy");
    expect(binding?.target.type).toBe("vrm-expression");
    expect(binding?.target.physicalTargetIds).toEqual([`morph:${mesh.uuid}:0`]);
  });
  it("loads normalized torso nodes and immutable rest rotations into the model contract", async () => {
    const root = new Group(); const hips = new Object3D(); const spine = new Object3D(); const chest = new Object3D(); const upperChest = new Object3D();
    root.add(hips); hips.add(spine); spine.add(chest); chest.add(upperChest); spine.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), .2);
    const nodes: Record<string, Object3D> = { hips, spine, chest, upperChest }; const loaded = gltf(root); loaded.userData.vrm = { meta: { metaVersion: "1" }, humanoid: { getNormalizedBoneNode: (name: string) => nodes[name] ?? null }, expressionManager: null, lookAt: null, materials: [] } as unknown as VRM;
    const loader = new AvatarModelLoader({ loadAsync: vi.fn().mockResolvedValue(loaded), register: vi.fn() } as unknown as GLTFLoader, () => 20); const model = await loader.load("torso.vrm");
    expect(model?.bones).toMatchObject({ hips, spine, chest, upperChest }); expect(model?.restRotations.spine).not.toEqual({ x: 0, y: 0, z: 0, w: 1 }); expect(model?.capability.torsoShoulder.hierarchy).toBe("full");
  });
  it("disposes geometry and material resources", () => {
    const geometry = new BufferGeometry(); geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    const material = new MeshBasicMaterial(); const geometrySpy = vi.spyOn(geometry, "dispose"); const materialSpy = vi.spyOn(material, "dispose");
    const root = new Object3D(); root.add(new Mesh(geometry, material)); disposeObject(root);
    expect(geometrySpy).toHaveBeenCalledOnce(); expect(materialSpy).toHaveBeenCalledOnce();
  });
  it("generates an immutable plain-data normalized arm profile", () => {
    const root = new Object3D(); const chest = new Object3D(); const neck = new Object3D(); const leftShoulder = new Object3D(); const leftUpperArm = new Object3D(); const leftLowerArm = new Object3D(); const leftHand = new Object3D();
    const rightShoulder = new Object3D(); const rightUpperArm = new Object3D(); const rightLowerArm = new Object3D(); const rightHand = new Object3D();
    leftLowerArm.position.x = 1; leftHand.position.x = 1; rightLowerArm.position.x = -1; rightHand.position.x = -1;
    leftShoulder.position.x = 0.2; rightShoulder.position.x = -0.2; neck.position.y = 0.3;
    root.add(chest, leftShoulder, rightShoulder); chest.add(neck); leftShoulder.add(leftUpperArm); leftUpperArm.add(leftLowerArm); leftLowerArm.add(leftHand); rightShoulder.add(rightUpperArm); rightUpperArm.add(rightLowerArm); rightLowerArm.add(rightHand); root.updateMatrixWorld(true);
    const profile = createRigProfile(7, "avatar#7", { chest, neck, leftShoulder, leftUpperArm, leftLowerArm, leftHand, rightShoulder, rightUpperArm, rightLowerArm, rightHand });
    expect(profile?.modelGeneration).toBe(7); expect(profile?.joints.leftLowerArm).toMatchObject({ parentJoint: "leftUpperArm", childJoint: "leftHand", controlledParentJoint: "leftUpperArm", restLocalPosition: { x: 1, y: 0, z: 0 }, restWorldPosition: { x: 1.2, y: 0, z: 0 } });
    expect(Object.isFrozen(profile)).toBe(true); expect(Object.isFrozen(profile?.joints.leftUpperArm.restWorldDirection)).toBe(true); expect(Object.isFrozen(profile?.joints.leftUpperArm.restLocalPosition)).toBe(true); expect(Object.isFrozen(profile?.joints.leftUpperArm.restWorldPosition)).toBe(true); expect(JSON.stringify(profile)).not.toMatch(/Object3D|uuid|children/);
    expect(profile?.torsoReference.forwardWorld).toEqual({ x: 0, y: 0, z: 1 }); expect(Object.isFrozen(profile?.joints.leftUpperArm.anatomicalRestBasis)).toBe(true);
    expect(profile?.headNeckCapability).toMatchObject({ head: false, neck: true, neckRestLocalRotation: { x: 0, y: 0, z: 0, w: 1 } }); expect(Object.isFrozen(profile?.headNeckCapability)).toBe(true);
    expect(profile?.torsoShoulderCapability).toMatchObject({ mode: "reduced-chain", shoulderStatus: { left: "available", right: "available" }, futureUpperArmControlledParent: { left: "leftShoulder", right: "rightShoulder" } });
    expect(profile?.torsoShoulderCapability?.bones.chest.available).toBe(true); expect(profile?.torsoShoulderCapability?.bones.hips.available).toBe(false); expect(Object.isFrozen(profile?.torsoShoulderCapability?.bones)).toBe(true);
  });
  it("captures a full non-identity torso hierarchy without changing current arm parent mode", () => {
    const root = new Object3D(); const hips = new Object3D(); const spine = new Object3D(); const chest = new Object3D(); const upperChest = new Object3D(); const neck = new Object3D();
    const leftShoulder = new Object3D(); const leftUpperArm = new Object3D(); const leftLowerArm = new Object3D(); const leftHand = new Object3D(); const rightShoulder = new Object3D(); const rightUpperArm = new Object3D(); const rightLowerArm = new Object3D(); const rightHand = new Object3D();
    hips.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), .1); spine.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), .2); chest.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), .15);
    root.add(hips); hips.add(spine); spine.add(chest); chest.add(upperChest); upperChest.add(neck, leftShoulder, rightShoulder); neck.position.y = .3; leftShoulder.position.x = .2; rightShoulder.position.x = -.2;
    leftShoulder.add(leftUpperArm); leftUpperArm.add(leftLowerArm); leftLowerArm.add(leftHand); rightShoulder.add(rightUpperArm); rightUpperArm.add(rightLowerArm); rightLowerArm.add(rightHand); leftLowerArm.position.x = 1; leftHand.position.x = 1; rightLowerArm.position.x = -1; rightHand.position.x = -1; root.updateMatrixWorld(true);
    const profile = createRigProfile(8, "full#8", { hips, spine, chest, upperChest, neck, leftShoulder, leftUpperArm, leftLowerArm, leftHand, rightShoulder, rightUpperArm, rightLowerArm, rightHand });
    expect(profile?.torsoShoulderCapability?.mode).toBe("full"); expect(profile?.torsoShoulderCapability?.bones.spine.parentSemantic).toBe("hips"); expect(profile?.torsoShoulderCapability?.bones.upperChest.parentSemantic).toBe("chest");
    expect(profile?.torsoShoulderCapability?.bones.spine.restLocalRotation).not.toEqual({ x: 0, y: 0, z: 0, w: 1 }); expect(profile?.joints.leftUpperArm.parentMode).toBe("fixed-rest");
  });
});
