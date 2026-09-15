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

export interface AvatarRendererOptions { smoothing?: boolean; pixelRatioLimit?: number; onContextLost?: (error: Error) => void; now?: () => number }
export interface AppliedFacialExpressionDiagnostic { semantic: string; modelName: string; value: number }
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
    this.currentExpressions = {}; this.currentRotations = {}; this.currentRawMorphWeights.clear();
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
  getRigProfile() { return this.model?.rigProfile ?? null; }
  getUpperBodyRigProfile() { return this.model?.upperBodyRigProfile ?? null; }
  /** Phase 3B.3: chuỗi xương ngón + flex axis của model đang tải. null khi model không phải VRM. */
  getFingerRig() { return this.model?.fingerRig ?? null; }
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
    if (this.model) applyRawMorphWeights(this.model.morphTargets, this.currentRawMorphWeights);
    // ExpressionManager cập nhật morph ở `vrm.update`; raw candidate DEV phải áp sau bước đó để không bị ghi đè.
    if (this.devFacialPreview?.kind === "raw-morph" && this.model) {
      for (const morph of this.model.morphTargets.get(this.devFacialPreview.name) ?? []) morph.influences[morph.index] = this.devFacialPreview.value;
    }
    this.webgl.render(this.scene, this.camera);
    const sampledAt = this.target ? Math.max(...Object.values(this.target.tracking).map((part) => part.sampledAtMs ?? -Infinity)) : null;
    this.metrics.recordDraw(this.now(), this.now() - started, this.appliedSequence, this.target?.processedTimestampMs ?? null, sampledAt === -Infinity ? null : sampledAt);
  };

  private applyTarget(packet: AvatarPosePacket, dt: number): void {
    const rotationAlpha = this.smoothing ? dampingAlpha(20, dt) : 1;
    for (const [semantic, target] of Object.entries(packet.expressions)) {
      // F4: packet đã chứa expression sau mixer/dynamics. Renderer áp trực tiếp để local và
      // remote giống nhau; `smoothing` bên renderer chỉ còn sở hữu bone rotation.
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
      const alpha = isFingerJointName(name) || isProcessorOwnedRotation(packet.version, name) ? 1 : rotationAlpha;
      const current = this.currentRotations[name] ?? rest; const value = alpha < 1 ? slerpQuaternion(current, targetLocal, alpha) : targetLocal; this.currentRotations[name] = value;
      bone.quaternion.set(value.x, value.y, value.z, value.w).normalize();
    }
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
