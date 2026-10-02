import { assistBimanualPalms, type BimanualPalmAssistResult } from "../avatar-motion/bimanualPalmAssist";
import { AmbientLight, Box3, Color, DirectionalLight, PerspectiveCamera, Quaternion, Scene, Vector3, WebGLRenderer } from "three";

import { IDENTITY_QUATERNION, isFingerJointName, type AvatarPoseJointNameV2, type AvatarPosePacket, type QuaternionData, type ShoulderMotionStateV1 } from "../avatar-motion/avatarPoseTypes";

import { AvatarModelLoader } from "./modelLoader";

import type { LoadedAvatarModel, ModelLoadOptions } from "./modelTypes";

import { dampingAlpha, slerpQuaternion } from "./renderSmoothing";

import { RendererMetricsCollector, type RendererMetricsSnapshot } from "./rendererMetrics";

import { AnimationFrameLoop } from "./animationFrameLoop";

import { clampFacialPreviewWeight, type FacialCapabilityManifest } from "./facialCapability";

import type { AppliedGazeDiagnostic, GazeCapability } from "./gazeCapabilityAdapter";

import type { GazeEyelidSupport } from "../avatar-motion/gazeEyelidCoupling";

import { retargetFacialExpressions } from "./facialRetargeting";
import { buildAvatarCollisionProfile, poseAvatarCollisionProfile, type AvatarCollisionProfile } from "../avatar-motion/avatarCollisionProfile";
import { BodyLocalDepthMemory } from "../avatar-motion/bodyLocalDepth";
import { correctAvatarArmCollision } from "../avatar-motion/avatarCollisionCorrection";
import { correctAvatarInterArmCollision, queryAvatarInterArmCollisions, type InterArmCollisionContact } from "../avatar-motion/avatarInterArmCollision";
import type { AvatarCollisionCorrectionResult, AvatarCollisionPose } from "../avatar-motion/avatarCollisionTypes";
import { processorOwnsJointTemporal, rendererClearanceMask } from "../avatar-motion/motionOwnership";
import { buildFingertipProbe,correctFingertipContacts,fingertipBodyScore,type FingertipProbe,type FingertipContactDiagnostic } from "../avatar-motion/fingertipContactIk";
import { captureSemanticBoneFrames,semanticRenderedRotation,renderedArmPose,renderedBodyProfile,measureRenderedContacts,type SemanticBoneFrame,type ContactBoneMap } from "./renderedContactGeometry";
import { FaceContactMesh, fitHandSkinProbe } from "./faceContactMesh";
import { refineIndexFace } from "./indexFaceRefinement";
import { FinalFaceContactRefiner, type FinalFaceContactDiagnostic } from "./finalFaceContactRefinement";
import { constrainArmDof, ARM_DOF_LIMITS } from "../avatar-motion/armDofConstraints";
import { freezeRigProfile, validateRigProfile } from "../avatar-motion/normalizedRigProfile";



export interface AvatarRendererOptions { smoothing?: boolean; pixelRatioLimit?: number; onContextLost?: (error: Error) => void; now?: () => number }

export interface AppliedFacialExpressionDiagnostic { semantic: string; modelName: string; value: number }

export interface AppliedSelfCollisionDiagnostic {
  enabled: boolean;
  mode: "correction";
  left: AvatarCollisionCorrectionResult | null;
  right: AvatarCollisionCorrectionResult | null;
  interArm: InterArmCollisionContact[];
  palmAssist?: BimanualPalmAssistResult;
  fingertip?:FingertipContactDiagnostic;
  /** Measured again after VRM transfer and raw shoulder translation. Collider proxies, not mesh SDF. */
  rendered?:ReturnType<typeof measureRenderedContacts>&{space:"raw-bone-fk";contactErrors:Partial<Record<"left"|"right",number>>;fingertipGaps:Array<{left:string;right:string;distance:number;leftProbe:string;rightProbe:string}>};
  faceSkin?:{sequence:number;sourceFrameTimestampMs:number;materials:string[];status:string;contacts:Partial<Record<"left"|"right",{gap:number;gapFaceHeights:number;normalDegrees:number;localPenetration:number;surfaceSource:string;probeSource:string}>>};
  faceRefinement?:Partial<Record<"left"|"right",FinalFaceContactDiagnostic>>;
}

export interface AppliedShoulderTranslationDiagnostic {

  left: { capability: "supported" | "missing-bone" | "invalid-parent" | "invalid-scale"; vertical: number; displacement: number; clamped: boolean };

  right: { capability: "supported" | "missing-bone" | "invalid-parent" | "invalid-scale"; vertical: number; displacement: number; clamped: boolean };

}

export function absoluteLocalFromRestDelta(rest: QuaternionData, delta: QuaternionData): QuaternionData {

  const value = new Quaternion(rest.x, rest.y, rest.z, rest.w).multiply(new Quaternion(delta.x, delta.y, delta.z, delta.w)).normalize();

  return { x: value.x, y: value.y, z: value.z, w: value.w };

}



export function applyRawMorphWeights(

  morphTargets: LoadedAvatarModel["morphTargets"],

  weights: ReadonlyMap<string, number>,

): void {

  for (const [name, value] of weights) {

    for (const morph of morphTargets.get(name) ?? []) morph.influences[morph.index] = Math.min(1, Math.max(0, value));

  }

}



export function expressionValueFromPacket(value: number): number {

  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

}



export function facialExpressionTarget(

  semantic: string,

  target: number,

  expressionMap: Readonly<Record<string, string>>,

): AppliedFacialExpressionDiagnostic {

  return { semantic, modelName: expressionMap[semantic] ?? semantic, value: expressionValueFromPacket(target) };

}



export function isProcessorOwnedRotation(packetVersion: 1 | 2, name: string): boolean {

  return packetVersion === 2 && ["hips", "spine", "chest", "upperChest", "neck", "head", "leftShoulder", "rightShoulder"].includes(name);

}



export function shoulderDisplacement(vertical: number, shoulderWidth: number): number {

  if (!Number.isFinite(vertical) || !Number.isFinite(shoulderWidth) || shoulderWidth <= 0) return 0;

  const safe = Math.max(-1, Math.min(1, vertical));

  return safe * shoulderWidth * (safe >= 0 ? .1 : .035);

}



export function applyShoulderTranslation(

  model: Pick<LoadedAvatarModel, "shoulderTranslationBones" | "shoulderTranslationRig">,

  state: ShoulderMotionStateV1 | null | undefined,

): AppliedShoulderTranslationDiagnostic {

  const result: AppliedShoulderTranslationDiagnostic = {

    left: { capability: "missing-bone", vertical: 0, displacement: 0, clamped: false },

    right: { capability: "missing-bone", vertical: 0, displacement: 0, clamped: false },

  };

  const validState = state?.version === 1;

  for (const side of ["left", "right"] as const) {

    const bone = model.shoulderTranslationBones[side];

    const joint = model.shoulderTranslationRig?.joints[side];

    if (!bone) continue;

    if (!model.shoulderTranslationRig) { result[side].capability = "invalid-scale"; continue; }

    if (!joint) { result[side].capability = "invalid-parent"; continue; }

    const requested = validState ? state[side === "left" ? "leftVertical" : "rightVertical"] : 0;

    const vertical = Number.isFinite(requested) ? Math.max(-1, Math.min(1, requested)) : 0;

    const displacement = shoulderDisplacement(vertical, model.shoulderTranslationRig.shoulderWidth);

    bone.position.set(

      joint.restLocalPosition.x + joint.torsoUpParentLocalRest.x * displacement,

      joint.restLocalPosition.y + joint.torsoUpParentLocalRest.y * displacement,

      joint.restLocalPosition.z + joint.torsoUpParentLocalRest.z * displacement,

    );

    result[side] = { capability: "supported", vertical, displacement, clamped: Number.isFinite(requested) && requested !== vertical };

  }

  return result;

}



export class AvatarRenderer {

  readonly scene = new Scene(); readonly camera = new PerspectiveCamera(30, 1, 0.01, 100);

  readonly webgl: WebGLRenderer;

  private readonly loader: AvatarModelLoader; private readonly metrics = new RendererMetricsCollector();

  private readonly now: () => number; private model: LoadedAvatarModel | null = null;

  private target: AvatarPosePacket | null = null; private appliedSequence: number | null = null;

  private currentExpressions: Record<string, number> = {}; private currentRotations: Partial<Record<AvatarPoseJointNameV2 | "head", QuaternionData>> = {};

  private readonly loop: AnimationFrameLoop; private lastDrawAt: number | null = null; private disposed = false; private smoothing: boolean;

  private readonly contextLostHandler: (event: Event) => void; readonly canvas: HTMLCanvasElement;

  private devFacialPreview: { kind: "expression" | "raw-morph"; name: string; value: number } | null = null;

  private readonly currentRawMorphWeights = new Map<string, number>();
  private readonly bodyDepthMemory={left:{head:new BodyLocalDepthMemory(),torso:new BodyLocalDepthMemory()},right:{head:new BodyLocalDepthMemory(),torso:new BodyLocalDepthMemory()}};
  private collisionProfile: AvatarCollisionProfile | null = null;
  private selfCollisionDiagnostic: AppliedSelfCollisionDiagnostic = { enabled: false, mode: "correction", left: null, right: null, interArm: [] };
  private interArmDepthOrdering:"left-front"|"right-front"|null=null;
  private readonly interArmDepthMemory=new BodyLocalDepthMemory();
  private renderedBoneFrames=new Map<string,SemanticBoneFrame>();
  private normalizedBoneFrames=new Map<string,SemanticBoneFrame>();
  private fingertipProbes=new Map<string,FingertipProbe>();
  private faceContactMesh:FaceContactMesh|null=null;
  private readonly finalFaceRefiners={left:new FinalFaceContactRefiner(),right:new FinalFaceContactRefiner()};

  private appliedShoulderTranslation: AppliedShoulderTranslationDiagnostic = {

    left: { capability: "missing-bone", vertical: 0, displacement: 0, clamped: false }, right: { capability: "missing-bone", vertical: 0, displacement: 0, clamped: false },

  };

  // >1 phóng to (camera lại gần), <1 thu nhỏ; áp lên khoảng cách camera tính trong frameModel.

  private zoom = 1;

  // Lệch theo tỉ lệ chiều cao model (âm = xem phần dưới cao hơn, dương = xem phần trên).

  private verticalOffsetRatio = 0;



  constructor(canvas: HTMLCanvasElement, options: AvatarRendererOptions = {}, loader?: AvatarModelLoader) {

    this.canvas = canvas;

    this.now = options.now ?? (() => performance.now()); this.loader = loader ?? new AvatarModelLoader(); this.smoothing = options.smoothing ?? true;

    this.webgl = new WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "high-performance" });

    this.webgl.setPixelRatio(Math.min(devicePixelRatio || 1, options.pixelRatioLimit ?? 1.5)); this.webgl.outputColorSpace = "srgb";

    this.scene.background = new Color(0x171326); this.scene.add(new AmbientLight(0xffffff, 1.4));

    const key = new DirectionalLight(0xffffff, 2); key.position.set(2, 3, 4); this.scene.add(key); this.camera.position.set(0, 1.35, 3);

    this.contextLostHandler = (event) => { event.preventDefault(); this.stop(); options.onContextLost?.(new Error("WebGL context đã bị mất.")); };

    canvas.addEventListener("webglcontextlost", this.contextLostHandler);

    this.loop = new AnimationFrameLoop(this.draw);

  }



  async loadModel(url: string, options: ModelLoadOptions = {}): Promise<LoadedAvatarModel["capability"] | null> {

    this.assertUsable(); const loaded = await this.loader.load(url, options); if (!loaded) return null;

    this.clearDevFacialPreview();

    const previous = this.model; previous?.gazeAdapter?.reset(); this.model = loaded; this.scene.add(loaded.root); this.frameModel(loaded); if (previous) { this.scene.remove(previous.root); previous.dispose(); }

    // Packet/delta của rig cũ không được phép áp lên model vừa swap. Model mới bắt đầu từ

    // normalized rest pose cho tới khi motion processor phát packet mới theo rig profile mới.

    this.target = null; this.appliedSequence = null;
    this.finalFaceRefiners.left.reset();this.finalFaceRefiners.right.reset();

    this.currentExpressions = {}; this.currentRotations = {}; this.currentRawMorphWeights.clear();
    for(const memory of Object.values(this.bodyDepthMemory)){memory.head.reset();memory.torso.reset();}
    this.collisionProfile = loaded.rigProfile ? buildAvatarCollisionProfile(loaded.rigProfile) : null;
    this.interArmDepthOrdering = null;
    this.interArmDepthMemory.reset();
    loaded.root.updateMatrixWorld(true);
    const raw:ContactBoneMap={};
    const humanoid=loaded.vrm?.humanoid;
    if(humanoid)for(const name of Object.keys(loaded.bones)){const bone=humanoid.getRawBoneNode(name as Parameters<typeof humanoid.getRawBoneNode>[0]);if(bone)raw[name as AvatarPoseJointNameV2]=bone;}
    this.renderedBoneFrames=captureSemanticBoneFrames(loaded.bones,raw);
    for(const refiner of Object.values(this.finalFaceRefiners))refiner.reset();
    this.normalizedBoneFrames=captureSemanticBoneFrames(loaded.bones,{});
    this.faceContactMesh=loaded.rigProfile?new FaceContactMesh(loaded.root,loaded.rigProfile,this.renderedBoneFrames,options.faceContactMaterials):null;
    if(loaded.rigProfile){
      const handSkinProbes:NonNullable<import("../avatar-motion/normalizedRigProfile").NormalizedAvatarRigProfile["handSkinProbes"]>={};
      for(const side of ["left","right"] as const){const frame=this.renderedBoneFrames.get(side+"Hand"),hand=loaded.rigProfile.hands?.[side];if(!frame||!hand?.contactFrame?.probes||!hand.contactFrame.palmWidth)continue;
        for(const name of ["palmCenter","radialEdge","ulnarEdge"] as const){const probe=fitHandSkinProbe(loaded.root,frame,hand.contactFrame.probes[name],hand.contactFrame.palmWidth);if(probe){handSkinProbes[side]??={};handSkinProbes[side]![name]=probe;}}}
      loaded.rigProfile={...loaded.rigProfile,...(this.faceContactMesh?.profile?{faceSurface:this.faceContactMesh.profile}:{}),handSkinProbes};
    }
    this.fingertipProbes.clear();
    if(loaded.fingerRig)for(const side of ["left","right"] as const)for(const chain of loaded.fingerRig[side].chains){const probe=buildFingertipProbe(chain,loaded.bones,humanoid?raw:loaded.bones);if(probe)this.fingertipProbes.set(side+":"+chain.finger,probe);}
    if(loaded.rigProfile?.hands&&loaded.fingerRig){const hands={...loaded.rigProfile.hands};
      for(const side of ["left","right"] as const){const chain=loaded.fingerRig[side].chains.find(c=>c.finger==="index"),tip=this.fingertipProbes.get(side+":index"),hand=loaded.bones[`${side}Hand`];if(!chain||chain.segments.length!==3||chain.truncatedAtSegment!==null||!tip||!hand)continue;
        let parent=hand;const segments:NonNullable<typeof hands.left.indexTip>["segments"]=[];
        for(const segment of chain.segments){const bone=loaded.bones[segment.joint];if(!bone)break;const parentRotation=parent.getWorldQuaternion(new Quaternion()),position=bone.getWorldPosition(new Vector3()).sub(parent.getWorldPosition(new Vector3())).applyQuaternion(parentRotation.clone().invert()),rotation=parentRotation.invert().multiply(bone.getWorldQuaternion(new Quaternion()));segments.push({joint:segment.joint,positionLocal:{x:position.x,y:position.y,z:position.z},rotationLocal:{x:rotation.x,y:rotation.y,z:rotation.z,w:rotation.w}});parent=bone;}
        if(segments.length===3)hands[side]={...hands[side],indexTip:{segments,offsetLocal:{x:tip.offsetLocal.x,y:tip.offsetLocal.y,z:tip.offsetLocal.z},source:tip.source}};
      }loaded.rigProfile={...loaded.rigProfile,hands};
    }
    if(loaded.rigProfile){if(!validateRigProfile(loaded.rigProfile))throw new Error("Invalid face/hand contact rig profile");loaded.rigProfile=freezeRigProfile(loaded.rigProfile);}
    this.selfCollisionDiagnostic = { enabled: Boolean(this.collisionProfile), mode: "correction", left: null, right: null, interArm: [] };

    this.appliedShoulderTranslation = applyShoulderTranslation(loaded, null); return loaded.capability;

  }

  start(): void { this.assertUsable(); if (this.loop.running) return; this.lastDrawAt = null; this.loop.start(); }

  stop(): void { this.loop.stop(); this.lastDrawAt = null; }

  applyPose(packet: AvatarPosePacket): void { this.assertUsable(); if (!this.target || packet.sequence >= this.target.sequence) this.target = packet; }

  setSmoothing(enabled: boolean): void { this.smoothing = enabled; }

  /** >1 phóng to nhân vật, <1 thu nhỏ. Áp dụng ngay nếu model đã tải. */

  setZoom(zoom: number): void {

    this.assertUsable();

    if (!Number.isFinite(zoom) || zoom <= 0) return;

    this.zoom = zoom;

    if (this.model) this.frameModel(this.model);

  }

  getZoom(): number { return this.zoom; }

  /**

   * Dịch điểm nhìn theo chiều dọc, tính theo tỉ lệ chiều cao model (không phải đơn vị thế

   * giới cố định) để cùng một giá trị cho cảm giác dịch chuyển giống nhau ở mọi model.

   * ratio dương đẩy khung nhìn lên trên (thấy phần đầu rõ hơn), âm đẩy xuống dưới.

   */

  setVerticalOffset(ratio: number): void {

    this.assertUsable();

    if (!Number.isFinite(ratio)) return;

    this.verticalOffsetRatio = ratio;

    if (this.model) this.frameModel(this.model);

  }

getVerticalOffset(): number { return this.verticalOffsetRatio; }

  resize(width: number, height: number): void { this.assertUsable(); if (width <= 0 || height <= 0) return; this.webgl.setSize(width, height, false); this.camera.aspect = width / height; this.camera.updateProjectionMatrix(); }

  getMetrics(): RendererMetricsSnapshot { return this.metrics.snapshot(this.webgl); }

  getCapability() { return this.model?.capability ?? null; }

  getFacialCapability(): FacialCapabilityManifest | null { return this.model?.facialCapability ?? null; }

  getGazeCapability(): GazeCapability | null { return this.model?.gazeAdapter?.capability ?? null; }

  getAppliedGaze(): AppliedGazeDiagnostic | null { return this.model?.gazeAdapter?.snapshot() ?? null; }

  getGazeEyelidSupport(): GazeEyelidSupport | null { return this.model?.gazeEyelidSupport ?? null; }

  getAppliedShoulderTranslation(): AppliedShoulderTranslationDiagnostic { return structuredClone(this.appliedShoulderTranslation); }

  getSelfCollisionDiagnostics(): AppliedSelfCollisionDiagnostic { return structuredClone(this.selfCollisionDiagnostic); }

  getRigProfile() { return this.model?.rigProfile ?? null; }

  getUpperBodyRigProfile() { return this.model?.upperBodyRigProfile ?? null; }

  /** Phase 3B.3: chuỗi xương ngón + flex axis của model đang tải. null khi model không phải VRM. */

  getFingerRig() { return this.model?.fingerRig ?? null; }
  getFaceContactMeshCapability(){return this.faceContactMesh?{...structuredClone(this.faceContactMesh.capability),indexTip:{left:this.model?.rigProfile?.hands?.left.indexTip?.source??"unavailable",right:this.model?.rigProfile?.hands?.right.indexTip?.source??"unavailable"}}:null;}

  /** DEV harness inspection only; callers must not mutate returned bones. */

  getDiagnosticModel(): Pick<LoadedAvatarModel, "root" | "bones" | "restRotations"> | null {

    return this.model ? { root: this.model.root, bones: this.model.bones, restRotations: this.model.restRotations } : null;

  }

  getTargetPoseForDiagnostics(): AvatarPosePacket | null { return this.target; }

  /** DEV diagnostics: semantic cuối cùng và đúng tên expression đã gửi vào model hiện tại. */

  getAppliedFacialExpressions(): Readonly<Record<string, AppliedFacialExpressionDiagnostic>> {

    if (!this.model) return {};

    return structuredClone(Object.fromEntries(Object.entries(this.currentExpressions).map(([semantic, value]) => [

      semantic,

      facialExpressionTarget(semantic, value, this.model!.expressionMap),

    ])));

  }

  /** DEV Lab only: raw morph candidate không đi vào pose packet hay production mapping. */

  setDevFacialPreview(kind: "expression" | "raw-morph", name: string, value: number): void {

    this.assertUsable();

    if (!import.meta.env.DEV) throw new Error("Facial preview chỉ được phép trong DEV build.");

    this.clearDevFacialPreview();

    if (!name) return;

    this.devFacialPreview = { kind, name, value: clampFacialPreviewWeight(value) };

  }

  clearDevFacialPreview(): void {

    const previous = this.devFacialPreview;

    if (previous && this.model) {

      if (previous.kind === "expression") this.model.vrm?.expressionManager?.setValue(previous.name, 0);

      else for (const morph of this.model.morphTargets.get(previous.name) ?? []) morph.influences[morph.index] = 0;

    }

    this.devFacialPreview = null;

  }

  dispose(): void {

    if (this.disposed) return;

    this.stop(); this.loader.invalidate();

    this.clearDevFacialPreview();

    if (this.model) { this.scene.remove(this.model.root); this.model.dispose(); this.model = null; }

    this.canvas.removeEventListener("webglcontextlost", this.contextLostHandler);

    // Không gọi forceContextLoss(): React StrictMode tái dùng cùng canvas sau effect cleanup.

    // Cưỡng bức mất context ở đây khiến lần mount kế tiếp không tạo được WebGLRenderer.

    this.webgl.dispose(); this.target = null; this.disposed = true;

  }



  private readonly draw = () => {

    if (this.disposed || !this.loop.running) return;

    const started = this.now(); const dt = this.lastDrawAt === null ? 1 / 60 : Math.min(.1, (started - this.lastDrawAt) / 1000); this.lastDrawAt = started;

    if (this.target && this.model) { this.applyTarget(this.target, dt); this.appliedSequence = this.target.sequence; }

    if (this.devFacialPreview?.kind === "expression") this.model?.vrm?.expressionManager?.setValue(this.devFacialPreview.name, this.devFacialPreview.value);

    this.model?.vrm?.update(dt);

    // three-vrm chỉ transfer normalized position cho hips. Shoulder translation phải gán lên raw skinned bone

    // sau humanoid.update; rotation vẫn đi qua normalized bones như contract hiện hữu.

    if (this.model) this.appliedShoulderTranslation = applyShoulderTranslation(this.model, this.target?.version === 2 ? this.target.shoulderMotion : null);

    // Collision must observe the finalized baseline pose. Push corrections back through VRM once,
    // then restore raw shoulder translation because humanoid.update does not own that channel.
    if (this.model && this.target) {
      this.applySelfCollision(this.target, dt);
      this.applyFingertipContact(this.target,dt);
      this.model.vrm?.update(0);
      this.appliedShoulderTranslation = applyShoulderTranslation(this.model, this.target.version === 2 ? this.target.shoulderMotion : null);
    }

    if (this.model) applyRawMorphWeights(this.model.morphTargets, this.currentRawMorphWeights);

    // ExpressionManager cập nhật morph ở `vrm.update`; raw candidate DEV phải áp sau bước đó để không bị ghi đè.

    if (this.devFacialPreview?.kind === "raw-morph" && this.model) {

      for (const morph of this.model.morphTargets.get(this.devFacialPreview.name) ?? []) morph.influences[morph.index] = this.devFacialPreview.value;

    }

    if(this.model&&this.target){this.refineFinalFaceContact(this.target,dt);this.measureFinalContact(this.target);}
    this.webgl.render(this.scene, this.camera);

    const sampledAt = this.target ? Math.max(...Object.values(this.target.tracking).map((part) => part.sampledAtMs ?? -Infinity)) : null;

    this.metrics.recordDraw(this.now(), this.now() - started, this.appliedSequence, this.target?.processedTimestampMs ?? null, sampledAt === -Infinity ? null : sampledAt);

  };



  /** Normalized humanoid FK after the most recent draw; sequence may lag a new input packet. */
  getFinalArmSnapshot(): { sequence: number | null; atMs: number; space: "normalized-avatar-world"; arms: Record<string, unknown>; skinnedArms: Record<string, unknown>; contacts:AppliedSelfCollisionDiagnostic } {
    const arms: Record<string, unknown> = {};
    const skinnedArms: Record<string, unknown> = {};
    const model = this.model;
    if (model) {
      model.root.updateMatrixWorld(true);
      for (const side of ["left", "right"] as const) {
        const joints: Record<string, unknown> = {};
        for (const name of ["UpperArm", "LowerArm", "Hand"] as const) {
          const bone = model.bones[`${side}${name}`];
          if (!bone) continue;
          const p = bone.getWorldPosition(new Vector3()), q = bone.getWorldQuaternion(new Quaternion());
          joints[name] = { position: { x: p.x, y: p.y, z: p.z }, rotation: { x: q.x, y: q.y, z: q.z, w: q.w } };
        }
        arms[side] = joints;
        if (model.vrm) {
          const rawJoints: Record<string, unknown> = {};
          for (const name of ["UpperArm", "LowerArm", "Hand"] as const) {
            const raw = model.vrm.humanoid.getRawBoneNode(`${side}${name}`);
            if (!raw) continue;
            const p = raw.getWorldPosition(new Vector3()), q = raw.getWorldQuaternion(new Quaternion());
            rawJoints[name] = { position: { x: p.x, y: p.y, z: p.z }, rotation: { x: q.x, y: q.y, z: q.z, w: q.w } };
          }
          const palmNodes = (["Hand", "IndexProximal", "MiddleProximal", "LittleProximal"] as const).map(name => model.vrm!.humanoid.getRawBoneNode(`${side}${name}`));
          if (palmNodes.every(Boolean)) {
            const points = palmNodes.map(node => node!.getWorldPosition(new Vector3()));
            const center = points.reduce((sum, p) => sum.add(p), new Vector3()).multiplyScalar(.25);
            rawJoints.palmCenter = { x: center.x, y: center.y, z: center.z };
          }
          skinnedArms[side] = rawJoints;
        }
      }
    }

    return { sequence: this.appliedSequence, atMs: this.now(), space: "normalized-avatar-world", arms, skinnedArms,contacts:this.getSelfCollisionDiagnostics() };
  }

  private applyTarget(packet: AvatarPosePacket, dt: number): void {

    const rotationAlpha = this.smoothing ? dampingAlpha(20, dt) : 1;
    const fingerRotationAlpha = this.smoothing ? dampingAlpha(28, dt) : 1;
    // A few rig-only validation tests intentionally construct a renderer shell without running the
    // WebGL constructor. Keep the pure pose application path usable in that environment.
    this.currentExpressions ??= {};

    // Packet remains model-independent. Retarget only at the renderer boundary so unsupported
    // MediaPipe semantics do not pretend to be model channels and raw VRoid lip morphs do not
    // stack at full strength on top of A/I/U/E/O presets.
    const renderExpressions = retargetFacialExpressions(packet.expressions, this.model!.expressionMap);

    // Explicitly release expressions that were renderable in the previous packet but are no longer
    // part of the current render plan; otherwise a raw morph can remain frozen at its last value.
    for (const semantic of Object.keys(this.currentExpressions)) {
      if (semantic in renderExpressions) continue;
      const released = facialExpressionTarget(semantic, 0, this.model!.expressionMap);
      this.model!.vrm?.expressionManager?.setValue(released.modelName, 0);
      if (this.model!.morphTargets.has(released.modelName)) this.currentRawMorphWeights.set(released.modelName, 0);
      delete this.currentExpressions[semantic];
    }

    for (const [semantic, target] of Object.entries(renderExpressions)) {
      // Facial temporal filtering is owned by AvatarMotionProcessor; renderer does not smooth face
      // a second time. This step only adapts semantic channels to the loaded model.
      const applied = facialExpressionTarget(semantic, target, this.model!.expressionMap);
      this.currentExpressions[semantic] = applied.value;
      this.model!.vrm?.expressionManager?.setValue(applied.modelName, applied.value);
      if (this.model!.morphTargets.has(applied.modelName)) this.currentRawMorphWeights.set(applied.modelName, applied.value);
    }

    // Gaze đã được lọc theo observation timestamp ở sender. Adapter chỉ chuyển semantic sang

    // capability model hiện tại; không thêm renderer smoothing lần hai.

    this.model!.gazeAdapter?.apply(packet.gaze);

    const rotations: Partial<Record<AvatarPoseJointNameV2 | "head", QuaternionData>> = { ...packet.jointRotations, ...(packet.headRotation ? { head: packet.headRotation } : {}) };

    for (const [name, target] of Object.entries(rotations) as Array<[AvatarPoseJointNameV2 | "head", QuaternionData]>) {

      const bone = this.model!.bones[name]; const rest = this.model!.restRotations[name];

      if (!bone || !rest) continue;

      const safeTarget = [target.x, target.y, target.z, target.w].every(Number.isFinite) ? target : IDENTITY_QUATERNION;

      const targetLocal = absoluteLocalFromRestDelta(rest, safeTarget);

      // Phase 3B.3: xương ngón đã được `fingerPoseTemporal` blend theo thời gian thực ở phía

      // processor. Slerp thêm lần nữa ở đây là double-smoothing — làm cử chỉ trễ và "nhão" đúng

      // vào lúc cần dứt khoát (nắm/xoè). Xương arm giữ nguyên đường smoothing cũ của Phase 3A/3B.

      // V2 upper body đã temporal-filter ở processor; renderer chỉ retarget trực tiếp.

      // Hand tracking commonly arrives at only 10-15 Hz. Interpolate fingers at render cadence so
      // they do not visibly step relative to the already-smoothed wrist/arm chain.
      const alpha = isProcessorOwnedRotation(packet.version, name) || processorOwnsJointTemporal(packet.motionOwnership, name) ? 1 : isFingerJointName(name) ? fingerRotationAlpha : rotationAlpha;

      const current = this.currentRotations[name] ?? rest; const value = alpha < 1 ? slerpQuaternion(current, targetLocal, alpha) : targetLocal; this.currentRotations[name] = value;

      bone.quaternion.set(value.x, value.y, value.z, value.w).normalize();

    }

  }

  /** Final baseline FK -> posed colliders -> bounded correction -> FK verification. */
  private applySelfCollision(packet:AvatarPosePacket,dt:number):void{
    const model=this.model,staticProfile=this.collisionProfile;
    if(!model||!staticProfile){this.selfCollisionDiagnostic={enabled:false,mode:"correction",left:null,right:null,interArm:[]};return;}
    model.root.updateMatrixWorld(true);
    const head=model.bones.head,neck=model.bones.neck,chest=model.bones.upperChest??model.bones.chest,hips=model.bones.hips;
    if(!head||!neck||!chest||!hips){this.selfCollisionDiagnostic={enabled:false,mode:"correction",left:null,right:null,interArm:[]};return;}
    const headPosition=head.getWorldPosition(new Vector3()),neckPosition=neck.getWorldPosition(new Vector3()),chestPosition=chest.getWorldPosition(new Vector3()),hipsPosition=hips.getWorldPosition(new Vector3());
    const restHead=new Vector3(staticProfile.body.head.center.x,staticProfile.body.head.center.y,staticProfile.body.head.center.z);
    const restHeadBone=this.model!.rigProfile?.contactSkeleton?.joints.head?.restWorldPosition;
    const headOffset=restHeadBone?restHead.sub(new Vector3(restHeadBone.x,restHeadBone.y,restHeadBone.z)).applyQuaternion(head.getWorldQuaternion(new Quaternion()).multiply(new Quaternion(
      this.model!.rigProfile!.contactSkeleton!.joints.head!.restWorldRotation.x,this.model!.rigProfile!.contactSkeleton!.joints.head!.restWorldRotation.y,this.model!.rigProfile!.contactSkeleton!.joints.head!.restWorldRotation.z,this.model!.rigProfile!.contactSkeleton!.joints.head!.restWorldRotation.w).invert())):new Vector3();
    const rigJoints=model.rigProfile?.contactSkeleton?.joints,chestRest=model.bones.upperChest?rigJoints?.upperChest:rigJoints?.chest;
    let chestLeftCenter:Vector3|undefined,chestRightCenter:Vector3|undefined,frontNormal:Vector3|undefined;
    if(chestRest){
      const restPosition=new Vector3(chestRest.restWorldPosition.x,chestRest.restWorldPosition.y,chestRest.restWorldPosition.z),restRotation=new Quaternion(chestRest.restWorldRotation.x,chestRest.restWorldRotation.y,chestRest.restWorldRotation.z,chestRest.restWorldRotation.w);
      const delta=chest.getWorldQuaternion(new Quaternion()).multiply(restRotation.invert());
      const poseRestPoint=(point:{x:number;y:number;z:number})=>new Vector3(point.x,point.y,point.z).sub(restPosition).applyQuaternion(delta).add(chestPosition);
      if(staticProfile.body.chestLeft)chestLeftCenter=poseRestPoint(staticProfile.body.chestLeft.center);
      if(staticProfile.body.chestRight)chestRightCenter=poseRestPoint(staticProfile.body.chestRight.center);
      if(staticProfile.body.frontNormal)frontNormal=new Vector3(staticProfile.body.frontNormal.x,staticProfile.body.frontNormal.y,staticProfile.body.frontNormal.z).applyQuaternion(delta).normalize();
    }
    const posedProfile=poseAvatarCollisionProfile(staticProfile,{headCenter:headPosition.clone().add(headOffset),neckStart:chestPosition.clone().lerp(neckPosition,.72),neckEnd:neckPosition.clone().lerp(headPosition,.55),torsoStart:chestPosition,torsoEnd:hipsPosition,...(chestLeftCenter?{chestLeftCenter}:{}),...(chestRightCenter?{chestRightCenter}:{}),...(frontNormal?{frontNormal}:{})});
    const poses={} as Record<"left"|"right",AvatarCollisionPose>;
    const diagnostic:AppliedSelfCollisionDiagnostic={enabled:true,mode:"correction",left:null,right:null,interArm:[]};
    for(const side of ["left","right"] as const){
      const upper=model.bones[`${side}UpperArm`],lower=model.bones[`${side}LowerArm`],hand=model.bones[`${side}Hand`];if(!upper||!lower||!hand)continue;
      const shoulder=upper.getWorldPosition(new Vector3()),elbow=lower.getWorldPosition(new Vector3()),wrist=hand.getWorldPosition(new Vector3());
      const handRef=model.rigProfile?.hands?.[side],frame=handRef?.contactFrame;
      const palmEnd=frame?.palmLength?new Vector3(frame.forwardLocal.x,frame.forwardLocal.y,frame.forwardLocal.z).applyQuaternion(hand.getWorldQuaternion(new Quaternion())).normalize().multiplyScalar(frame.palmLength).add(wrist):wrist.clone();
      const palmProbe=frame?.probes?.palmCenter?.offsetLocal;
      const palmCenter=palmProbe?new Vector3(palmProbe.x,palmProbe.y,palmProbe.z).applyQuaternion(hand.getWorldQuaternion(new Quaternion())).add(wrist):undefined;
      const pose:AvatarCollisionPose={shoulder,elbow,wrist,hand:palmEnd,...(palmCenter?{palmCenter}:{})};poses[side]=pose;
      const axis=wrist.clone().sub(shoulder).normalize(),pole=elbow.clone().sub(shoulder);pole.addScaledVector(axis,-pole.dot(axis));if(pole.lengthSq()<1e-10)pole.set(0,0,1);else pole.normalize();
      const total=posedProfile.arms[side].upperLength+posedProfile.arms[side].lowerLength;
      const depthEnabled=packet.motionOwnership?.bodyDepthBarrier===true;
      const depthMemory=this.bodyDepthMemory[side],forward=posedProfile.body.frontNormal;
      const observed=packet.armObservability?.[side]==="SEW"&&packet.tracking.pose.outputState==="active"&&rendererClearanceMask("SEW",packet.motionOwnership,side)==="SEW";
      if(!depthEnabled){depthMemory.head.reset();depthMemory.torso.reset();}
      const depthObservation=packet.observedBodyDepth,sourceAge=this.now()-packet.processedTimestampMs;
      const freshDepth=depthObservation&&sourceAge>=0&&sourceAge<=150&&packet.processedTimestampMs-depthObservation.sampledAtMs<=150?depthObservation:null;
      const depthSides=depthEnabled&&packet.motionOwnership?.bodyDepthEvidence==="observed-pose"?{
        head:depthMemory.head.observeSide(freshDepth?.[side].head??null,this.now(),freshDepth?.sampledAtMs??null),
        torso:depthMemory.torso.observeSide(freshDepth?.[side].torso??null,this.now(),freshDepth?.sampledAtMs??null),
      }:depthEnabled&&forward?{head:depthMemory.head.update(palmCenter??wrist,posedProfile.body.head.center,forward,posedProfile.body.head.radius,this.now(),observed,packet.tracking.pose.sampledAtMs),torso:depthMemory.torso.update(palmCenter??wrist,posedProfile.body.torso.start,forward,posedProfile.body.torso.radius,this.now(),observed,packet.tracking.pose.sampledAtMs)}:undefined;
      const result=correctAvatarArmCollision(posedProfile,{side,baseline:pose,bodyDepthSides:depthSides,deltaSeconds:dt,observability:rendererClearanceMask(packet.armObservability?.[side]??"---",packet.motionOwnership,side),bendPole:pole,budget:{maxWristDisplacementPerFrame:total*.08,maxElbowAngularCorrectionPerSecond:8,maxTotalCorrection:total*.3,maxIterations:4,influence:1}});
      diagnostic[side]=result;if(!result.baselinePreserved){this.applyCorrectedArm(side,pose,result.pose);poses[side]=result.pose;model.root.updateMatrixWorld(true);}
    }
    if(poses.left&&poses.right){
      if(packet.bimanualPalmContact?.version===1 && packet.armObservability?.left==="SEW" && packet.armObservability?.right==="SEW" && !packet.motionOwnership?.contactArms.left && !packet.motionOwnership?.contactArms.right){
        const assist=assistBimanualPalms(posedProfile,poses.left,poses.right,packet.bimanualPalmContact.influence,(posedProfile.arms.left.upperLength+posedProfile.arms.left.lowerLength)*Math.min(.015,Math.max(0,dt)*.4));
        diagnostic.palmAssist=assist;
        if(assist.applied){this.applyCorrectedArm("left",poses.left,assist.left);model.root.updateMatrixWorld(true);this.applyCorrectedArm("right",poses.right,assist.right);model.root.updateMatrixWorld(true);poses.left=assist.left;poses.right=assist.right;}
      }
      const depthForward=posedProfile.body.frontNormal??{x:0,y:0,z:1},depthThreshold=Math.max(posedProfile.arms.left.handRadius,posedProfile.arms.right.handRadius);
      const observed=packet.armObservability?.left==="SEW"&&packet.armObservability?.right==="SEW"&&packet.tracking.pose.outputState==="active"&&rendererClearanceMask("SEW",packet.motionOwnership,"left")==="SEW"&&rendererClearanceMask("SEW",packet.motionOwnership,"right")==="SEW";
      const depthObservation=packet.observedBodyDepth,sourceAge=this.now()-packet.processedTimestampMs;
      const freshDepth=depthObservation&&sourceAge>=0&&sourceAge<=150?depthObservation:null;
      const depthSide=packet.motionOwnership?.bodyDepthEvidence==="observed-pose"?this.interArmDepthMemory.observeSide(freshDepth?.interArm??null,this.now(),freshDepth?.sampledAtMs??null):this.interArmDepthMemory.update(poses.left.wrist,poses.right.wrist,depthForward,depthThreshold,this.now(),observed,packet.tracking.pose.sampledAtMs);
      this.interArmDepthOrdering=depthSide===null?null:depthSide>0?"left-front":"right-front";
      const inter=correctAvatarInterArmCollision(posedProfile,poses.left,poses.right,{left:rendererClearanceMask(packet.armObservability?.left??"---",packet.motionOwnership,"left"),right:rendererClearanceMask(packet.armObservability?.right??"---",packet.motionOwnership,"right")},(posedProfile.arms.left.lowerLength+posedProfile.arms.right.lowerLength)*Math.min(.04,Math.max(0,dt)*.6),3,this.interArmDepthOrdering,diagnostic.palmAssist?.applied===true||diagnostic.palmAssist?.reason==="already-touching",depthForward);
      if(!inter.baselinePreserved){this.applyCorrectedArm("left",poses.left,inter.left);model.root.updateMatrixWorld(true);this.applyCorrectedArm("right",poses.right,inter.right);model.root.updateMatrixWorld(true);poses.left=inter.left;poses.right=inter.right;}
      diagnostic.interArm=queryAvatarInterArmCollisions(posedProfile,poses.left,poses.right);
    }
    this.selfCollisionDiagnostic=diagnostic;
  }

  private applyCorrectedArm(side:"left"|"right",from:AvatarCollisionPose,to:AvatarCollisionPose):void{
    const model=this.model!,upper=model.bones[`${side}UpperArm`]!,lower=model.bones[`${side}LowerArm`]!;
    const preservedHandWorld=model.bones[`${side}Hand`]?.getWorldQuaternion(new Quaternion());
    this.rotateBoneDirectionWorld(upper,new Vector3().subVectors(new Vector3(from.elbow.x,from.elbow.y,from.elbow.z),new Vector3(from.shoulder.x,from.shoulder.y,from.shoulder.z)),new Vector3().subVectors(new Vector3(to.elbow.x,to.elbow.y,to.elbow.z),new Vector3(to.shoulder.x,to.shoulder.y,to.shoulder.z)));
    this.currentRotations[`${side}UpperArm`]={x:upper.quaternion.x,y:upper.quaternion.y,z:upper.quaternion.z,w:upper.quaternion.w};model.root.updateMatrixWorld(true);
    const elbow=lower.getWorldPosition(new Vector3()),hand=model.bones[`${side}Hand`]!,wrist=hand.getWorldPosition(new Vector3());
    this.rotateBoneDirectionWorld(lower,wrist.sub(elbow),new Vector3(to.wrist.x,to.wrist.y,to.wrist.z).sub(elbow));
    this.currentRotations[`${side}LowerArm`]={x:lower.quaternion.x,y:lower.quaternion.y,z:lower.quaternion.z,w:lower.quaternion.w};
    model.root.updateMatrixWorld(true);
    if(preservedHandWorld){const palm=model.bones[`${side}Hand`]!;const parent=palm.parent?.getWorldQuaternion(new Quaternion())??new Quaternion();palm.quaternion.copy(parent.invert().multiply(preservedHandWorld)).normalize();this.currentRotations[`${side}Hand`]={x:palm.quaternion.x,y:palm.quaternion.y,z:palm.quaternion.z,w:palm.quaternion.w};}
  }

  private applyFingertipContact(packet:AvatarPosePacket,dt:number):void{
    const model=this.model,rig=model?.fingerRig;
    if(!model||!rig||packet.motionOwnership?.contactArms.left||packet.motionOwnership?.contactArms.right)return;
    const baseline:Parameters<typeof correctFingertipContacts>[0]["baseline"]={};
    for(const hand of [rig.left,rig.right])for(const chain of hand.chains)for(const segment of chain.segments){const rest=model.restRotations[segment.joint],delta=packet.jointRotations[segment.joint];if(rest&&delta)baseline[segment.joint]=absoluteLocalFromRestDelta(rest,delta);}
    const index=model.bones.leftIndexProximal,little=model.bones.leftLittleProximal;
    const palmWidth=index&&little?index.getWorldPosition(new Vector3()).distanceTo(little.getWorldPosition(new Vector3())):0;
    const age=packet.fingertipContact?this.now()-packet.processedTimestampMs+(packet.processedTimestampMs-packet.fingertipContact.sampledAtMs):Infinity;
    const body=this.collisionProfile?renderedBodyProfile(this.normalizedBoneFrames,this.collisionProfile):null;
    const diagnostic=correctFingertipContacts({rig,bones:model.bones,probes:this.fingertipProbes,intent:packet.fingertipContact,baseline,palmWidth,deltaSeconds:dt,sampleAgeMs:age,clearanceScore:body?()=>fingertipBodyScore(this.fingertipProbes.values(),body,palmWidth):undefined});
    this.selfCollisionDiagnostic.fingertip=diagnostic;
    for(const name of diagnostic.changedJoints){const q=model.bones[name]!.quaternion;this.currentRotations[name]={x:q.x,y:q.y,z:q.z,w:q.w};}
  }

  private measureFinalContact(packet:AvatarPosePacket):void{
    const model=this.model,rig=model?.rigProfile,profile=this.collisionProfile;if(!model||!rig||!profile)return;
    model.root.updateMatrixWorld(true);
    const posed=renderedBodyProfile(this.renderedBoneFrames,profile);if(!posed)return;
    const left=renderedArmPose(this.renderedBoneFrames,rig,"left"),right=renderedArmPose(this.renderedBoneFrames,rig,"right");
    const contactErrors:Partial<Record<"left"|"right",number>>={};
    if(packet.localBodyContactGoals?.modelFingerprint===rig.modelFingerprint)for(const side of ["left","right"] as const){
      const goal=packet.localBodyContactGoals.goals[side],hand=this.renderedBoneFrames.get(side+"Hand"),parent=goal?this.renderedBoneFrames.get(goal.anchor.parentJoint):null;
      const probe=goal?.probeReference?{offsetLocal:goal.probeReference.frameOffset,normalLocal:goal.probeReference.contactNormal}:goal?rig.hands?.[side]?.contactFrame?.probes?.[goal.probe]:null;
      if(!goal||!parent||!hand||!probe)continue;
      const point=new Vector3(goal.anchor.pointLocal.x,goal.anchor.pointLocal.y,goal.anchor.pointLocal.z).applyQuaternion(semanticRenderedRotation(parent)).add(parent.bone.getWorldPosition(new Vector3()));
      const actual=new Vector3(probe.offsetLocal.x,probe.offsetLocal.y,probe.offsetLocal.z).applyQuaternion(semanticRenderedRotation(hand)).add(hand.bone.getWorldPosition(new Vector3()));
      const error=point.distanceTo(actual);if(Number.isFinite(error))contactErrors[side]=error;
    }
    const fingertipGaps:NonNullable<AppliedSelfCollisionDiagnostic["rendered"]>["fingertipGaps"]=[];
    const tip=(side:"left"|"right",finger:string)=>{
      const probe=this.fingertipProbes.get(side+":"+finger);if(!probe)return null;
      const frame=this.renderedBoneFrames.get([...Object.entries(model.bones)].find(([,bone])=>bone===probe.bone)?.[0]??"");if(!frame)return null;
      return{source:probe.source,point:probe.offsetLocal.clone().multiply(frame.bone.getWorldScale(new Vector3())).applyQuaternion(semanticRenderedRotation(frame)).add(frame.bone.getWorldPosition(new Vector3()))};
    };
    for(const pair of packet.fingertipContact?.pairs??[]){const a=tip("left",pair.left),b=tip("right",pair.right);if(a&&b){const distance=a.point.distanceTo(b.point);if(Number.isFinite(distance))fingertipGaps.push({left:pair.left,right:pair.right,distance,leftProbe:a.source,rightProbe:b.source});}}
    this.selfCollisionDiagnostic.rendered={...measureRenderedContacts(posed,left,right),space:"raw-bone-fk",contactErrors,fingertipGaps};
    const contacts:NonNullable<AppliedSelfCollisionDiagnostic["faceSkin"]>["contacts"]={};
    if(packet.localBodyContactGoals?.modelFingerprint===rig.modelFingerprint)for(const side of ["left","right"] as const){
      const goal=packet.localBodyContactGoals.goals[side],hand=this.renderedBoneFrames.get(side+"Hand"),skin=goal?.anchor.skinBinding?this.faceContactMesh?.sample(goal.anchor.skinBinding):null;
      const probe=goal?.probeReference;
      if(!goal||!skin||!hand||!probe||!goal.anchor.faceHeight)continue;
      const actual=this.renderedFaceProbe(side,probe);if(!actual)continue;const {point,normal}=actual,gap=point.distanceTo(skin.point);
      contacts[side]={gap,gapFaceHeights:gap/goal.anchor.faceHeight,normalDegrees:normal.angleTo(skin.normal.clone().negate())*180/Math.PI,localPenetration:Math.max(0,-point.clone().sub(skin.point).dot(skin.normal)),surfaceSource:goal.anchor.surfaceSource??"mesh-candidate",probeSource:goal.probe==="indexTip"?this.fingertipProbes.get(side+":index")?.source??"unavailable":rig.handSkinProbes?.[side]?.[goal.probe]?"skin-fit":"rig-proxy"};
    }
    this.selfCollisionDiagnostic.faceSkin={sequence:packet.sequence,sourceFrameTimestampMs:packet.sourceFrameTimestampMs,materials:this.faceContactMesh?.capability.materials??[],status:this.faceContactMesh?.capability.status??"proxy-fallback",contacts};
  }

  private renderedFaceProbe(side:"left"|"right",probe:import("../avatar-motion/avatarContactRig").AvatarProbeProfile):{point:Vector3;normal:Vector3}|null{
    if(probe.probe==="indexTip"){
      const tip=this.fingertipProbes.get(side+":index"),frame=this.renderedBoneFrames.get(side+"IndexDistal");if(!tip||!frame)return null;
      const q=semanticRenderedRotation(frame),offset=tip.offsetLocal.clone().multiply(frame.bone.getWorldScale(new Vector3()));
      return{point:offset.clone().applyQuaternion(q).add(frame.bone.getWorldPosition(new Vector3())),normal:offset.normalize().applyQuaternion(q)};
    }
    const hand=this.renderedBoneFrames.get(side+"Hand");if(!hand)return null;const q=semanticRenderedRotation(hand);
    return{point:new Vector3(probe.frameOffset.x,probe.frameOffset.y,probe.frameOffset.z).applyQuaternion(q).add(hand.bone.getWorldPosition(new Vector3())),normal:new Vector3(probe.contactNormal.x,probe.contactNormal.y,probe.contactNormal.z).applyQuaternion(q).normalize()};
  }

  private refineFinalFaceContact(packet:AvatarPosePacket,dt:number):void{
    const model=this.model,rig=model?.rigProfile,goals=packet.localBodyContactGoals;
    const diagnostics:NonNullable<AppliedSelfCollisionDiagnostic["faceRefinement"]>={};
    for(const side of ["left","right"] as const){
      const goal=goals?.goals[side];
      if(!model||!rig||!goals?.research?.finalRefinement||goals.modelFingerprint!==rig.modelFingerprint||!goal?.anchor.skinBinding||!goal.probeReference||!goal.anchor.faceHeight){this.finalFaceRefiners[side].reset();continue;}
      const sync=()=>{model.root.updateMatrixWorld(true);model.vrm?.humanoid.update();this.appliedShoulderTranslation=applyShoulderTranslation(model,packet.version===2?packet.shoulderMotion:null);model.root.updateMatrixWorld(true);};
      const clearance=()=>{const body=this.collisionProfile?renderedBodyProfile(this.renderedBoneFrames,this.collisionProfile):null,arm=renderedArmPose(this.renderedBoneFrames,rig,side);return body&&arm?measureRenderedContacts(body,side==="left"?arm:null,side==="right"?arm:null)[side].reduce((sum,c)=>sum+c.penetrationDepth*c.penetrationDepth,0):Infinity;};
      const jointError=()=>{let error=0;for(const name of [side+"UpperArm",side+"LowerArm"] as const){const bone=model.bones[name as keyof typeof model.bones],ref=rig.joints[name as keyof typeof rig.joints];if(!bone||!ref)return Infinity;const delta=new Quaternion(ref.restLocalRotation.x,ref.restLocalRotation.y,ref.restLocalRotation.z,ref.restLocalRotation.w).invert().multiply(bone.quaternion),limited=constrainArmDof({x:delta.x,y:delta.y,z:delta.z,w:delta.w},ref.anatomicalRestBasis.primaryLocal,name.endsWith("UpperArm")?ARM_DOF_LIMITS.upper:ARM_DOF_LIMITS.lower);if(!limited)return Infinity;error+=delta.angleTo(new Quaternion(limited.x,limited.y,limited.z,limited.w));}return error;};
      const sampledAtMs=goal.sampledAtMs??goals.sampledAtMs,beforeJointError=jointError(),age=sampledAtMs===undefined?Infinity:this.now()-sampledAtMs;
      const owned=packet.motionOwnership?.contactArms[side]===true,fresh=age>=0&&age<=250;
      diagnostics[side]=this.finalFaceRefiners[side].refine({side,owned,fresh,goalKey:rig.modelFingerprint+":"+goal.probe,dt,faceHeight:goal.anchor.faceHeight,influence:goal.influence??0,bones:model.bones,frames:this.renderedBoneFrames,probe:goal.probeReference,renderedProbe:()=>this.renderedFaceProbe(side,goal.probeReference!),target:()=>this.faceContactMesh?.sample(goal.anchor.skinBinding!)??null,sync,clearanceScore:clearance,acceptJointConstraints:()=>jointError()<=beforeJointError+1e-5});
      const chain=model.fingerRig?.[side].chains.find(c=>c.finger==="index");
      if(goal.probe==="indexTip"&&goals.research.indexTip&&chain){const baseline:Partial<Record<string,QuaternionData>>={};for(const s of chain.segments){const rest=model.restRotations[s.joint],delta=packet.jointRotations[s.joint];if(rest&&delta)baseline[s.joint]=absoluteLocalFromRestDelta(rest,delta);}
        const changed=refineIndexFace({owned,fresh,dt,faceHeight:goal.anchor.faceHeight,influence:goal.influence??0,chain,bones:model.bones,baseline,rest:model.restRotations,probe:()=>this.renderedFaceProbe(side,goal.probeReference!),target:()=>this.faceContactMesh?.sample(goal.anchor.skinBinding!)??null,sync});
        for(const name of changed){const q=model.bones[name as keyof typeof model.bones]?.quaternion;if(q)this.currentRotations[name as keyof typeof this.currentRotations]={x:q.x,y:q.y,z:q.z,w:q.w};}
      }
      for(const name of [side+"UpperArm",side+"LowerArm",side+"Hand"]){const q=model.bones[name as keyof typeof model.bones]?.quaternion;if(q)this.currentRotations[name as keyof typeof this.currentRotations]={x:q.x,y:q.y,z:q.z,w:q.w};}
    }
    this.selfCollisionDiagnostic.faceRefinement=diagnostics;
  }

  private rotateBoneDirectionWorld(bone:import("three").Object3D,from:Vector3,to:Vector3):void{
    if(from.lengthSq()<1e-10||to.lengthSq()<1e-10)return;const world=bone.getWorldQuaternion(new Quaternion());
    const target=new Quaternion().setFromUnitVectors(from.normalize(),to.normalize()).multiply(world).normalize();const parent=bone.parent?.getWorldQuaternion(new Quaternion())??new Quaternion();bone.quaternion.copy(parent.invert().multiply(target)).normalize();
  }

  private frameModel(model: LoadedAvatarModel): void {

    model.root.updateMatrixWorld(true);

    const box = new Box3().setFromObject(model.root);

    const size = box.getSize(new Vector3()); const center = box.getCenter(new Vector3());

    const verticalFov = this.camera.fov * Math.PI / 180;

    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(this.camera.aspect, .1));

    const heightDistance = size.y / (2 * Math.tan(verticalFov / 2));

    const widthDistance = size.x / (2 * Math.tan(horizontalFov / 2));

    const distance = Math.max(heightDistance, widthDistance, .5) * 1.18 / this.zoom;

    const targetY = center.y + size.y * this.verticalOffsetRatio;

    // VRM 0.x đã được rotateVRM0(); camera phía +Z nhìn vào mặt model đã chuẩn hóa.

    this.camera.position.set(center.x, targetY, center.z + distance);

    this.camera.near = Math.max(.01, distance / 100); this.camera.far = Math.max(100, distance * 10);

    this.camera.lookAt(center.x, targetY, center.z); this.camera.updateProjectionMatrix();

  }

  private assertUsable(): void { if (this.disposed) throw new Error("AvatarRenderer đã dispose."); }

}
