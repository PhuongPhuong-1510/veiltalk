import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Box3, Color, Material, Mesh, Vector3 } from "three";
import { ChevronLeft, LoaderCircle, ShieldCheck, Video, VideoOff } from "lucide-react";
import { avatarsApi, metricsApi, usersApi } from "../../lib/api";
import { useAuthStore } from "../../lib/store/authStore";
import { AvatarMotionProcessor } from "../../lib/avatar-motion/avatarMotionProcessor";
import { INTEGRATED_MOTION_PROFILE as motionProfile } from "../../lib/avatar-motion/integratedMotionProfile";
import type { RawTrackingFrameV1 } from "../../lib/tracking/rawTrackingTypes";
import { AVATAR_TRACKING_CONFIG } from "../../lib/tracking/avatarTrackingConfig";
import { useTracking } from "../../lib/tracking/useTracking";
import type { TrackingMetricsSnapshot } from "../../lib/tracking/trackingMetrics";
import { AvatarRenderer } from "../../lib/avatar-renderer/avatarRenderer";
import { LOCAL_AVATAR_MODELS } from "../../lib/avatar/localAvatarCatalog";
import {
  getAvatarMaterialSlot,
  getAvatarMaterialTargetId,
  type AvatarColorSlot,
} from "../../lib/avatar/avatarMaterialManifest";
import { setAvatarAuraTintEnabled } from "../../lib/avatar/avatarAuraTint";
import { createAvatarViewportControls, type AvatarViewportControls } from "../../lib/avatar/avatarViewportControls";
import { AvatarCanvas } from "./AvatarCanvas";
import { avatarDraftKey, avatarFlowPath, type AvatarFlowMode } from "../../lib/avatar/avatarFlow";
import { ApiError } from "../../lib/api/types";
import "./avatarPreviewScreen.css";

type TintMaterial = Material & { color: Color; shadeColorFactor?: Color };
type CameraState = "idle" | "starting" | "live" | "denied" | "error" | "stopped";
interface SavedCustomization {
  colors?: Partial<Record<AvatarColorSlot, string | null>>;
  materialOverrides?: Record<string, string>;
}

const isTintMaterial = (material: Material): material is TintMaterial =>
  "color" in material && material.color instanceof Color;

function readCustomization(userId: string, modelId: string): SavedCustomization {
  try {
    return JSON.parse(sessionStorage.getItem(avatarDraftKey(userId, modelId)) ?? "{}");
  } catch {
    return {};
  }
}

function configureMotionProcessor(processor: AvatarMotionProcessor): void {
  processor.setFiltered(motionProfile.filtered);
  processor.setConstraints(motionProfile.constraints);
  processor.setHandTwistEnabled(motionProfile.handTwistEnabled);
  processor.setContinuousFingerEnabled(motionProfile.continuousFingerEnabled);
  processor.setDepthFusionEnabled(motionProfile.depthFusionEnabled);
  processor.setBodyDepthBarrierEnabled(motionProfile.bodyDepthBarrierEnabled);
  processor.setDofConstraintsEnabled(motionProfile.dofConstraintsEnabled);
  processor.setHandConditioningEnabled(motionProfile.handConditioningEnabled);
  processor.setRigEndpointEnabled(motionProfile.rigEndpointEnabled);
  processor.setPoseDepthConditioningEnabled(motionProfile.poseDepthConditioningEnabled);
  processor.setProcessorArmTemporal(motionProfile.processorArmTemporal);
  processor.setElbowBranchSwitchEnabled(motionProfile.elbowBranchSwitchEnabled);
  processor.setBimanualPalmAssistEnabled(motionProfile.bimanualPalmAssistEnabled);
  processor.setFingertipContactEnabled(motionProfile.fingertipContactEnabled);
  processor.setContactShadowEnabled(motionProfile.contactShadowEnabled);
  processor.setContactCorrectionEnabled(motionProfile.contactCorrectionEnabled);
  processor.setFaceContactResearchOptions(motionProfile.faceContactResearch);
}

function applyCustomization(renderer: AvatarRenderer, modelId: string, customization: SavedCustomization): void {
  const root = renderer.getDiagnosticModel()?.root;
  if (!root) return;
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!isTintMaterial(material)) continue;
      const slotKey = getAvatarMaterialSlot(modelId, material.name);
      if (!slotKey) continue;
      const targetId = getAvatarMaterialTargetId(slotKey, material.name);
      const targetColor = customization.materialOverrides?.[targetId] ?? customization.colors?.[slotKey];
      if (!targetColor) continue;
      material.color.set(targetColor);
      if (material.shadeColorFactor instanceof Color) material.shadeColorFactor.set(targetColor).multiplyScalar(0.72);
      if (slotKey === "aura") setAvatarAuraTintEnabled(material, true);
      material.needsUpdate = true;
    }
  });
}

function cameraFailure(reason: unknown): { state: "denied" | "error"; message: string } {
  if (reason instanceof DOMException && ["NotAllowedError", "PermissionDeniedError"].includes(reason.name)) {
    return { state: "denied", message: "Quyền camera đang bị từ chối. Bạn vẫn có thể hoàn tất và bật lại camera sau trong Cài đặt." };
  }
  return {
    state: "error",
    message: reason instanceof Error ? reason.message : "Không thể khởi động camera. Hãy kiểm tra thiết bị rồi thử lại.",
  };
}

function KokoroCommitIcon() {
  return <svg className="kokoro-commit-icon" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3.25 19 7.3v8.1l-7 4.05-7-4.05V7.3L12 3.25Z" />
    <path d="m8.6 12.1 2.15 2.15 4.65-4.75" />
  </svg>;
}

export default function AvatarPreviewScreen({ mode = "onboarding" }: { mode?: AvatarFlowMode }) {
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const markAvatarSetupComplete = useAuthStore((state) => state.markAvatarSetupComplete);
  const setUser = useAuthStore((state) => state.setUser);
  const [searchParams] = useSearchParams();
  const requestedId = searchParams.get("model");
  const model = LOCAL_AVATAR_MODELS.find((item) => item.id === requestedId) ?? LOCAL_AVATAR_MODELS[0];
  const customization = useMemo(() => readCustomization(user?.id ?? "anonymous", model.id), [model.id, user?.id]);
  const requestIdRef = useRef(crypto.randomUUID());
  const pendingPortraitRef = useRef<Blob | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const rendererRef = useRef<AvatarRenderer | null>(null);
  const processorRef = useRef<AvatarMotionProcessor | null>(null);
  const viewportControlsRef = useRef<AvatarViewportControls | null>(null);
  const latestMetricsRef = useRef<TrackingMetricsSnapshot | null>(null);
  if (!processorRef.current) {
    processorRef.current = new AvatarMotionProcessor({ continuousFingerEnabled: true });
    configureMotionProcessor(processorRef.current);
  }

  const [renderer, setRenderer] = useState<AvatarRenderer | null>(null);
  const [modelStatus, setModelStatus] = useState<"loading" | "ready" | "error">("loading");
  const [modelError, setModelError] = useState<string | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>("idle");
  const [cameraMessage, setCameraMessage] = useState("Camera chỉ được xử lý trên thiết bị của bạn.");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "error">("idle");
  const [expectedRevision, setExpectedRevision] = useState<string | null>(null);
  const [revisionReady, setRevisionReady] = useState(mode !== "edit");

  useEffect(() => {
    if (mode !== "edit") return;
    let active = true;
    void avatarsApi.getMyAvatar().then((profile) => {
      if (active) setExpectedRevision(profile.profile_revision);
    }).catch(() => { if (active) setSaveStatus("error"); })
      .finally(() => { if (active) setRevisionReady(true); });
    return () => { active = false; };
  }, [mode]);

  const onFrame = useCallback((frame: RawTrackingFrameV1) => {
    const motionStartedAt = performance.now();
    const packet = processorRef.current?.process(frame);
    const motionEndedAt = performance.now();
    const activeRenderer = rendererRef.current;
    if (packet && activeRenderer) {
      const applyStartedAt = performance.now();
      activeRenderer.applyPose(packet);
      const applyEndedAt = performance.now();
      return { motionProcessMs: motionEndedAt - motionStartedAt, avatarApplyMs: applyEndedAt - applyStartedAt, avatarAppliedAtMs: applyEndedAt };
    }
    return { motionProcessMs: motionEndedAt - motionStartedAt };
  }, []);

  const onTrackingError = useCallback((reason: unknown) => {
    const failure = cameraFailure(reason);
    setCameraState(failure.state);
    setCameraMessage(failure.message);
  }, []);

  const trackingOptions = useMemo(() => ({
    profile: "full-rate" as const,
    resolution: "720p" as const,
    ...AVATAR_TRACKING_CONFIG,
    tasks: { face: true, hands: true, pose: true },
    parallelHands: motionProfile.parallelHands,
    poseGuidedHands: motionProfile.poseGuidedHands,
    adaptiveHandConfidence: motionProfile.adaptiveHandConfidence,
    onFrame,
    onError: onTrackingError,
    onMetrics: (metrics: TrackingMetricsSnapshot) => { latestMetricsRef.current = metrics; },
  }), [onFrame, onTrackingError]);
  const tracking = useTracking(trackingOptions);

  const onRendererReady = useCallback((value: AvatarRenderer) => {
    value.setSmoothing(motionProfile.smoothing);
    rendererRef.current = value;
    setRenderer(value);
  }, []);
  const onRendererDispose = useCallback((value: AvatarRenderer) => {
    viewportControlsRef.current?.dispose();
    viewportControlsRef.current = null;
    if (rendererRef.current === value) rendererRef.current = null;
  }, []);
  const onRendererError = useCallback((reason: Error) => {
    setModelStatus("error");
    setModelError(reason.message || "Không thể dựng avatar.");
  }, []);

  useEffect(() => {
    if (!renderer) return;
    let cancelled = false;
    setModelStatus("loading");
    setModelError(null);
    const processor = processorRef.current!;
    processor.setRigProfile(null);
    processor.setUpperBodyRigProfile(null);
    processor.setFingerRig(null);
    viewportControlsRef.current?.dispose();
    viewportControlsRef.current = null;
    void renderer.loadModel(model.url, { licenseStatus: "unknown" }).then((report) => {
      if (cancelled || rendererRef.current !== renderer) return;
      const rig = renderer.getRigProfile();
      if (!report || !rig) throw new Error("Model chưa có bộ xương humanoid phù hợp để xem chuyển động.");
      processor.setRigProfile(rig);
      processor.setUpperBodyRigProfile(renderer.getUpperBodyRigProfile());
      processor.setFingerRig(renderer.getFingerRig());
      processor.setFacialModelFingerprint(renderer.getFacialCapability()?.modelFingerprint ?? null);
      applyCustomization(renderer, model.id, customization);
      const root = renderer.getDiagnosticModel()!.root;
      const box = new Box3().setFromObject(root);
      const size = box.getSize(new Vector3());
      const center = box.getCenter(new Vector3());
      viewportControlsRef.current = createAvatarViewportControls(renderer.camera, renderer.canvas, center, size.y);
      setModelStatus("ready");
    }).catch((reason: unknown) => {
      if (cancelled) return;
      setModelStatus("error");
      setModelError(reason instanceof Error ? reason.message : "Không thể tải avatar.");
    });
    return () => { cancelled = true; };
  }, [customization, model.id, model.url, renderer]);

  useEffect(() => () => {
    viewportControlsRef.current?.dispose();
    viewportControlsRef.current = null;
    processorRef.current?.dispose();
  }, []);

  async function startCamera() {
    if (!tracking || !videoRef.current || modelStatus !== "ready" || cameraState === "starting") return;
    setCameraState("starting");
    setCameraMessage("Đang chuẩn bị camera và mô hình nhận diện…");
    processorRef.current?.resetCameraTracking();
    try {
      await tracking.start(videoRef.current);
      setCameraState("live");
      setCameraMessage("Đang phản chiếu chuyển động. Hãy nhìn thẳng và giữ vai trong khung hình vài giây đầu.");
    } catch (reason) {
      const failure = cameraFailure(reason);
      setCameraState(failure.state);
      setCameraMessage(failure.message);
    }
  }

  function stopCamera() {
    tracking?.stop();
    reportPreviewMetrics();
    processorRef.current?.resetCameraTracking();
    setCameraState("stopped");
    setCameraMessage("Camera đã dừng. Avatar vẫn được giữ ở chế độ xem tĩnh.");
  }

  function reportPreviewMetrics() {
    const snapshot = latestMetricsRef.current;
    if (!snapshot || snapshot.runDurationMs < 1000) return;
    const latency = snapshot.timings?.pipelineStartToAvatarApplyMs?.p95
      ?? snapshot.inferenceTimeMs.pipeline.p95;
    void metricsApi.sendClientMetrics({
      session_type: "preview",
      tracking_latency_ms: Math.max(0, Math.round(latency)),
      fps: Math.max(0, snapshot.avatarApplyFps ?? snapshot.pipelineFps),
      timestamp: new Date().toISOString(),
    }).catch(() => {});
    latestMetricsRef.current = null;
  }

  async function finish() {
    if (saveStatus === "saving" || !revisionReady || !rendererRef.current) return;
    setSaveStatus("saving");
    try {
      tracking?.stop();
      reportPreviewMetrics();
      const portrait = pendingPortraitRef.current ?? await rendererRef.current.capturePortrait();
      pendingPortraitRef.current = portrait;
      const response = await avatarsApi.completeMyAvatar({
        requestId: requestIdRef.current,
        expectedRevision,
        modelId: model.id,
        customizations: { colors: customization.colors ?? {}, materialOverrides: customization.materialOverrides ?? {} },
        portrait,
      });
      setUser(response.user);
      if (mode === "onboarding") markAvatarSetupComplete();
      if (user?.id) sessionStorage.removeItem(avatarDraftKey(user.id, model.id));
      navigate(mode === "edit" ? "/profile" : "/home", { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) {
        try {
          const profile = await avatarsApi.getMyAvatar();
          if (profile.last_save_request_id === requestIdRef.current) {
            setUser(await usersApi.getMe());
            if (mode === "onboarding") markAvatarSetupComplete();
            navigate(mode === "edit" ? "/profile" : "/home", { replace: true });
            return;
          }
        } catch { /* keep the retry state below */ }
      }
      console.error("[AvatarPreview] Không thể lưu avatar", error);
      setSaveStatus("error");
    }
  }

  const cameraCanStart = modelStatus === "ready" && Boolean(tracking) && cameraState !== "starting" && cameraState !== "live";

  return <main className="dark avatar-preview-page"><section className="avatar-preview-card">
    <header className="avatar-preview-header">
      <button className="icon-button" onClick={() => navigate(avatarFlowPath(mode, "customize", model.id))} aria-label="Quay lại"><ChevronLeft /></button>
      <div className="avatar-preview-progress">{[["1", "Chọn"], ["2", "Tùy chỉnh"], ["3", "Xem trước"]].map(([number, label]) => <div className="active" key={number}><span>{number}</span><small>{label}</small></div>)}</div>
    </header>
    <div className="avatar-preview-heading"><span>Bước 3 / 3</span><h1>Nhân vật ảo của bạn</h1><p>Thử vẫy tay hoặc nhướn mày xem nào <span aria-hidden="true">👋</span></p></div>

    <div className="avatar-preview-layout">
      <div className={`avatar-preview-stage ${cameraState === "live" ? "is-live" : ""}`}>
        <AvatarCanvas onReady={onRendererReady} onDispose={onRendererDispose} onError={onRendererError} />
        <div className="avatar-preview-camera-pip">
          <video ref={videoRef} className="avatar-preview-camera-source" muted playsInline aria-label="Hình ảnh camera của bạn" />
          {cameraState !== "live" && <div className="avatar-preview-camera-placeholder"><VideoOff /><span>Camera chưa bật</span></div>}
          <small>CAMERA CỦA BẠN</small>
        </div>
        {modelStatus !== "ready" && <div className={`avatar-preview-status is-${modelStatus}`}>{modelStatus === "loading" && <LoaderCircle />}{modelStatus === "error" ? modelError : "Đang hoàn thiện avatar…"}</div>}
        {cameraState === "live" && <div className="avatar-preview-live-badge"><i /> LIVE</div>}
        <div className="avatar-preview-name"><small>AVATAR SELECTED</small><strong>{model.name}</strong></div>
        <span>Kéo để xoay · Lăn/pinch để thu phóng · Shift + kéo để di chuyển lên/xuống</span>
      </div>

      <aside className="avatar-preview-summary">
        <div className="avatar-preview-summary-title"><small>LIVE PREVIEW</small><h2>Thử chuyển động</h2><p>Video camera và dữ liệu nhận diện không được tải lên máy chủ.</p></div>
        <div className={`avatar-camera-state is-${cameraState}`} role="status" aria-live="polite">
          <div className="avatar-camera-state-icon">{cameraState === "live" ? <Video /> : cameraState === "denied" || cameraState === "error" ? <VideoOff /> : <ShieldCheck />}</div>
          <div><strong>{cameraState === "live" ? "Đang LIVE" : cameraState === "starting" ? "Đang khởi động" : cameraState === "denied" ? "Chưa có quyền camera" : cameraState === "error" ? "Camera chưa sẵn sàng" : "Quyền riêng tư được bảo vệ"}</strong><p>{cameraMessage}</p></div>
        </div>
        <ul className="avatar-preview-instructions">
          <li><span>01</span><p>Đứng nơi đủ ánh sáng, tránh ngược sáng.</p></li>
          <li><span>02</span><p>Cách camera khoảng 50–80 cm.</p></li>
          <li><span>03</span><p>Giữ khuôn mặt, vai và bàn tay trong khung hình.</p></li>
        </ul>
        <div className="avatar-preview-camera-actions">
          {cameraState === "live"
            ? <button className="avatar-camera-stop" onClick={stopCamera}><VideoOff /> Dừng camera</button>
            : <button className="avatar-camera-start" disabled={!cameraCanStart} onClick={() => void startCamera()}>{cameraState === "starting" ? <><LoaderCircle className="avatar-save-spinner" /> Đang bật camera…</> : <><Video /> {cameraState === "denied" || cameraState === "error" ? "Thử lại camera" : "Bật camera"}</>}</button>}
          <button className="avatar-edit-button" onClick={() => navigate(avatarFlowPath(mode, "customize", model.id))}>Tùy chỉnh lại</button>
        </div>
      </aside>
    </div>

    <footer className="avatar-preview-actions">
      <div className="avatar-save-feedback" role="status" aria-live="polite">{saveStatus === "error" && "Chưa thể lưu avatar. Kiểm tra kết nối rồi thử lại."}</div>
      <button className="secondary" disabled={saveStatus === "saving"} onClick={() => navigate(avatarFlowPath(mode, "customize", model.id))}><ChevronLeft /> Quay lại</button>
      <button className="primary" disabled={saveStatus === "saving" || !revisionReady || modelStatus !== "ready"} onClick={() => void finish()}>{saveStatus === "saving" ? <>Đang lưu <LoaderCircle className="avatar-save-spinner" /></> : <>{mode === "edit" ? "Lưu thay đổi" : "Hoàn tất & Bắt đầu"} <KokoroCommitIcon /></>}</button>
    </footer>
  </section></main>;
}
