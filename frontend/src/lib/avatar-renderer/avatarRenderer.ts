import { AmbientLight, Box3, Color, DirectionalLight, Euler, PerspectiveCamera, Quaternion, Scene, Vector3, WebGLRenderer } from "three";
import type { AvatarJointName, AvatarPosePacketV1, QuaternionData } from "../avatar-motion/avatarPoseTypes";
import { AvatarModelLoader } from "./modelLoader";
import type { LoadedAvatarModel, ModelLoadOptions } from "./modelTypes";
import { dampingAlpha, dampScalar, slerpQuaternion } from "./renderSmoothing";
import { RendererMetricsCollector, type RendererMetricsSnapshot } from "./rendererMetrics";
import { AnimationFrameLoop } from "./animationFrameLoop";
import { buildFaceExpressionApplyPlan, findStaleFaceExpressionTargets, type FaceExpressionTarget } from "./faceExpressionApplyPlan";
import { MOUTH_SHAPE_EXPRESSION_NAMES } from "../avatar-motion/mouthShapeComposer";
import { EYE_EXPRESSION_NAMES } from "../avatar-motion/eyeExpression";

export interface AvatarRendererOptions { smoothing?: boolean; pixelRatioLimit?: number; onContextLost?: (error: Error) => void; now?: () => number }
const PROCESSOR_TIMED_EXPRESSIONS = new Set(["jawOpen", "aa", "mouthClose", ...MOUTH_SHAPE_EXPRESSION_NAMES, ...EYE_EXPRESSION_NAMES]);
export function isProcessorTimedExpression(semantic: string): boolean { return PROCESSOR_TIMED_EXPRESSIONS.has(semantic); }
export function isProcessorTimedRotation(name: AvatarJointName | "head"): boolean { return name === "head" || name === "neck"; }
export interface RendererFaceExpressionSnapshot {
  targetValues: Record<string, number>;
  renderedValues: Record<string, number>;
  rejected: Array<{ semantic: string; reason: "physical-target-owned" | "detailed-smile-owned"; owner: string }>;
}
export function absoluteLocalFromRestDelta(rest: QuaternionData, delta: QuaternionData): QuaternionData {
  const value = new Quaternion(rest.x, rest.y, rest.z, rest.w).multiply(new Quaternion(delta.x, delta.y, delta.z, delta.w)).normalize();
  return { x: value.x, y: value.y, z: value.z, w: value.w };
}
export function eyeBoneLocalFromRest(rest: QuaternionData, yaw: number, pitch: number): QuaternionData {
  const delta = new Quaternion().setFromEuler(new Euler(pitch * 10 * Math.PI / 180, yaw * 12 * Math.PI / 180, 0, "YXZ"));
  const value = new Quaternion(rest.x, rest.y, rest.z, rest.w).multiply(delta).normalize(); return { x: value.x, y: value.y, z: value.z, w: value.w };
}

export class AvatarRenderer {
  readonly scene = new Scene(); readonly camera = new PerspectiveCamera(30, 1, 0.01, 100);
  readonly webgl: WebGLRenderer;
  private readonly loader: AvatarModelLoader; private readonly metrics = new RendererMetricsCollector();
  private readonly now: () => number; private model: LoadedAvatarModel | null = null;
  private target: AvatarPosePacketV1 | null = null; private appliedSequence: number | null = null;
  private currentExpressions: Record<string, number> = {}; private renderedExpressions: Record<string, number> = {}; private currentRotations: Partial<Record<AvatarJointName | "head", QuaternionData>> = {};
  private diagnosticExpressionOverrides: Record<string, number> = {};
  private diagnosticGazeOverride: { yaw: number; pitch: number } | null = null;
  private appliedExpressionTargets = new Map<string, FaceExpressionTarget>();
  private pendingRawExpressionValues = new Map<string, number>();
  private rejectedExpressions: RendererFaceExpressionSnapshot["rejected"] = [];
  private readonly loop: AnimationFrameLoop; private lastDrawAt: number | null = null; private disposed = false; private smoothing: boolean;
  private readonly contextLostHandler: (event: Event) => void; readonly canvas: HTMLCanvasElement;
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
    const previous = this.model; this.model = loaded; this.scene.add(loaded.root); this.frameModel(loaded); if (previous) { this.scene.remove(previous.root); previous.dispose(); }
    if (loaded.vrm?.lookAt) { loaded.vrm.lookAt.autoUpdate = false; loaded.vrm.lookAt.target = null; }
    this.currentExpressions = {}; this.renderedExpressions = {}; this.appliedExpressionTargets.clear(); this.pendingRawExpressionValues.clear(); this.rejectedExpressions = []; this.currentRotations = {}; return loaded.capability;
  }
  start(): void { this.assertUsable(); if (this.loop.running) return; this.lastDrawAt = null; this.loop.start(); }
  stop(): void { this.loop.stop(); this.lastDrawAt = null; }
  applyPose(packet: AvatarPosePacketV1): void { this.assertUsable(); if (!this.target || packet.sequence >= this.target.sequence) this.target = packet; }
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
  getRigProfile() { return this.model?.rigProfile ?? null; }
  /** DEV harness inspection only; callers must not mutate returned bones. */
  getDiagnosticModel(): Pick<LoadedAvatarModel, "root" | "bones" | "restRotations"> | null {
    return this.model ? { root: this.model.root, bones: this.model.bones, restRotations: this.model.restRotations } : null;
  }
  getTargetPoseForDiagnostics(): AvatarPosePacketV1 | null { return this.target; }
  getFaceExpressionSnapshot(): RendererFaceExpressionSnapshot {
    return { targetValues: { ...(this.target?.expressions ?? {}), ...this.diagnosticExpressionOverrides }, renderedValues: { ...this.renderedExpressions }, rejected: [...this.rejectedExpressions] };
  }
  /** DEV diagnostics only; override is local to this renderer and never enters AvatarPosePacketV1. */
  setFaceExpressionOverride(semantic: string, value: number | null): void {
    this.assertUsable();
    if (value === null) { delete this.diagnosticExpressionOverrides[semantic]; return; }
    if (Number.isFinite(value)) this.diagnosticExpressionOverrides[semantic] = Math.min(1, Math.max(0, value));
  }
  clearFaceExpressionOverrides(): void {
    for (const semantic of Object.keys(this.diagnosticExpressionOverrides)) { delete this.currentExpressions[semantic]; delete this.renderedExpressions[semantic]; }
    this.diagnosticExpressionOverrides = {};
    if (!this.target) {
      for (const target of this.appliedExpressionTargets.values()) this.resetExpressionTarget(target);
      this.appliedExpressionTargets.clear(); this.pendingRawExpressionValues.clear(); this.rejectedExpressions = [];
    }
  }
  /** DEV-only gaze probe; never mutates AvatarPosePacketV1. */
  setDiagnosticGazeOverride(value: { yaw: number; pitch: number } | null): void { this.diagnosticGazeOverride = value ? { yaw: Math.min(1, Math.max(-1, value.yaw)), pitch: Math.min(1, Math.max(-1, value.pitch)) } : null; }
  dispose(): void {
    if (this.disposed) return;
    this.stop(); this.loader.invalidate();
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
    else if (this.model && Object.keys(this.diagnosticExpressionOverrides).length > 0) this.applyExpressions(this.diagnosticExpressionOverrides, dt);
    if (this.model && !this.target && this.diagnosticGazeOverride) this.applyGaze(this.diagnosticGazeOverride.yaw, this.diagnosticGazeOverride.pitch);
    this.model?.vrm?.update(dt);
    this.applyPendingRawExpressions();
    this.webgl.render(this.scene, this.camera);
    const sampledAt = this.target ? Math.max(...Object.values(this.target.tracking).map((part) => part.sampledAtMs ?? -Infinity)) : null;
    this.metrics.recordDraw(this.now(), this.now() - started, this.appliedSequence, this.target?.processedTimestampMs ?? null, sampledAt === -Infinity ? null : sampledAt);
  };

  private applyTarget(packet: AvatarPosePacketV1, dt: number): void {
    const rotationAlpha = this.smoothing ? dampingAlpha(20, dt) : 1;
    this.applyExpressions({ ...packet.expressions, ...this.diagnosticExpressionOverrides }, dt);
    this.applyGaze(this.diagnosticGazeOverride?.yaw ?? packet.gaze?.yaw ?? 0, this.diagnosticGazeOverride?.pitch ?? packet.gaze?.pitch ?? 0);
    const rotations: Partial<Record<AvatarJointName | "head", QuaternionData>> = { ...packet.jointRotations, ...(packet.headRotation ? { head: packet.headRotation } : {}) };
    for (const [name, target] of Object.entries(rotations) as Array<[AvatarJointName | "head", QuaternionData]>) {
      const bone = this.model!.bones[name]; const rest = this.model!.restRotations[name];
      if (!bone || !rest) continue;
      const targetLocal = absoluteLocalFromRestDelta(rest, target);
      const current = this.currentRotations[name] ?? rest; const alpha = isProcessorTimedRotation(name) ? 1 : rotationAlpha; const value = alpha < 1 ? slerpQuaternion(current, targetLocal, alpha) : targetLocal; this.currentRotations[name] = value;
      bone.quaternion.set(value.x, value.y, value.z, value.w).normalize();
    }
  }

  private applyExpressions(expressions: Readonly<Record<string, number>>, dt: number): void {
    const smoothed: Record<string, number> = {};
    for (const [semantic, target] of Object.entries(expressions)) {
      const current = this.currentExpressions[semantic] ?? target; const value = this.smoothing && !isProcessorTimedExpression(semantic) ? dampScalar(current, target, 18, dt) : target; this.currentExpressions[semantic] = value;
      smoothed[semantic] = value;
    }
    const gazeMode = this.model!.capability.gaze.mode;
    const expressionValues = gazeMode === "eye-morph" ? smoothed : Object.fromEntries(Object.entries(smoothed).filter(([name]) => !name.startsWith("eyeLook")));
    const plan = buildFaceExpressionApplyPlan(expressionValues, this.model!.faceExpressionBindings);
    const nextTargets = new Map(plan.entries.map((entry) => [entry.target.key, entry.target]));
    for (const target of findStaleFaceExpressionTargets(this.appliedExpressionTargets, plan)) this.resetExpressionTarget(target);
    this.pendingRawExpressionValues.clear(); this.renderedExpressions = {}; this.rejectedExpressions = plan.rejected;
    for (const entry of plan.entries) {
      this.renderedExpressions[entry.semantic] = entry.value;
      if (entry.target.type === "vrm-expression") this.model!.vrm?.expressionManager?.setValue(entry.target.name, entry.value);
      else this.pendingRawExpressionValues.set(entry.target.name, entry.value);
    }
    this.appliedExpressionTargets = nextTargets;
  }

  private applyGaze(yaw: number, pitch: number): void {
    if (!this.model) return; const safeYaw = Math.min(1, Math.max(-1, Number.isFinite(yaw) ? yaw : 0)); const safePitch = Math.min(1, Math.max(-1, Number.isFinite(pitch) ? pitch : 0));
    if (this.model.capability.gaze.mode === "vrm-look-at" && this.model.vrm?.lookAt) { this.model.vrm.lookAt.applier.applyYawPitch(safeYaw * 90, safePitch * 90); return; }
    if (this.model.capability.gaze.mode !== "eye-bones") return;
    for (const name of ["leftEye", "rightEye"] as const) { const bone = this.model.bones[name], rest = this.model.restRotations[name]; if (!bone || !rest) continue; const value = eyeBoneLocalFromRest(rest, safeYaw, safePitch); bone.quaternion.set(value.x, value.y, value.z, value.w); }
  }

  private resetExpressionTarget(target: FaceExpressionTarget): void {
    if (target.type === "vrm-expression") this.model?.vrm?.expressionManager?.setValue(target.name, 0);
    else for (const morph of this.model?.morphTargets.get(target.name) ?? []) morph.influences[morph.index] = 0;
  }

  private applyPendingRawExpressions(): void {
    if (!this.model) return;
    for (const [name, value] of this.pendingRawExpressionValues) for (const morph of this.model.morphTargets.get(name) ?? []) morph.influences[morph.index] = value;
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
