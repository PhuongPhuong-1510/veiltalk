import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Material,
  Mesh,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { ChevronLeft, ChevronRight, LoaderCircle, RotateCcw } from "lucide-react";
import { LOCAL_AVATAR_MODELS } from "../../lib/avatar/localAvatarCatalog";
import {
  EMPTY_AVATAR_SLOT_COLORS,
  createAvatarSlotRecord,
  getAvatarMaterialLabel,
  getAvatarMaterialManifest,
  getAvatarMaterialSlot,
  getAvatarMaterialTargetId,
  type AvatarColorSlot,
  type AvatarSlotColors,
} from "../../lib/avatar/avatarMaterialManifest";
import { createRigProfile } from "../../lib/avatar-renderer/modelLoader";
import type { LoadedAvatarModel } from "../../lib/avatar-renderer/modelTypes";
import { createAvatarPreviewMotionController } from "../../lib/avatar-preview/avatarPreviewMotionController";
import { setAvatarAuraTintEnabled } from "../../lib/avatar/avatarAuraTint";
import { createAvatarViewportControls, type AvatarViewportControls } from "../../lib/avatar/avatarViewportControls";
import { avatarDraftKey, avatarFlowPath, type AvatarFlowMode } from "../../lib/avatar/avatarFlow";
import { useAuthStore } from "../../lib/store/authStore";
import "./avatarColorLab.css";

type MaterialOverrides = Record<string, string>;
interface MaterialTarget { id: string; name: string; label: string }
type TintMaterial = Material & { color: Color; shadeColorFactor?: Color };

const COLOR_SWATCHES = ["#211b35", "#6847a8", "#9b64dc", "#dd5fbd", "#ef8caa", "#e4bd64", "#55c9d9", "#54b58a", "#e8e4ef"];

const isTintMaterial = (material: Material): material is TintMaterial =>
  "color" in material && material.color instanceof Color;

function KokoroSlotIcon({ slot }: { slot: AvatarColorSlot }) {
  if (slot === "hair") return <svg className="avatar-slot-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.2 18.7c1.1-1.9 1.1-4.3.3-6.2C5.2 9.2 7.6 4.8 12 4.4c4.4.4 6.8 4.8 5.5 8.1-.8 1.9-.8 4.3.3 6.2"/><path d="M9.1 18.9c1.8-2.5 2-5.8 1-8.6M14.9 18.9c-1.8-2.5-2-5.8-1-8.6"/></svg>;
  if (slot === "outfit") return <svg className="avatar-slot-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8.1 5.2 12 8l3.9-2.8 3 3.2-2.2 2.1.7 8.3H6.6l.7-8.3-2.2-2.1 3-3.2Z"/><path d="M9.1 5.8 12 10l2.9-4.2M7.3 14.2h9.4"/></svg>;
  if (slot === "eyes") return <svg className="avatar-slot-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.8 12s3.1-4.2 8.2-4.2 8.2 4.2 8.2 4.2-3.1 4.2-8.2 4.2S3.8 12 3.8 12Z"/><path d="M14.6 12a2.6 2.6 0 1 1-5.2 0 2.6 2.6 0 0 1 5.2 0Z"/><path d="M12 9.4v5.2"/></svg>;
  if (slot === "accessory") return <svg className="avatar-slot-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 17 8.8-8.8M5.7 14.5l3.8 3.8M13.5 6.8l3.7 3.7"/><path d="M16.1 4.7c1.4-.4 2.8.1 3.2 1.1.3 1-.6 2.2-2 2.6-1.4.4-2.8-.1-3.1-1.1-.4-1 .5-2.2 1.9-2.6Z"/><circle cx="6.1" cy="17.9" r="1.7"/></svg>;
  return <svg className="avatar-slot-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8c1.2 3.3 4.2 4.8 4.2 8.2 0 2.8-1.8 5-4.2 5s-4.2-2.2-4.2-5c0-1.9.9-3.5 2.2-5.1.1 1.8.8 2.8 2 3.5.8-2.2.7-4.2 0-6.6Z"/><path d="M12 16v5M8.5 20h7"/></svg>;
}

function loadSavedCustomization(userId: string, modelId: string): { colors: AvatarSlotColors; materialOverrides: MaterialOverrides } {
  try {
    const saved = JSON.parse(sessionStorage.getItem(avatarDraftKey(userId, modelId)) ?? "null");
    return { colors: { ...EMPTY_AVATAR_SLOT_COLORS, ...(saved?.colors ?? {}) }, materialOverrides: saved?.materialOverrides ?? {} };
  } catch {
    return { colors: { ...EMPTY_AVATAR_SLOT_COLORS }, materialOverrides: {} };
  }
}

export default function AvatarColorLab({ mode = "onboarding" }: { mode?: AvatarFlowMode }) {
  const navigate = useNavigate();
  const userId = useAuthStore((state) => state.user?.id) ?? "anonymous";
  const [searchParams] = useSearchParams();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const applyColorsRef = useRef<((colors: AvatarSlotColors, overrides: MaterialOverrides) => void) | null>(null);
  const colorsRef = useRef<AvatarSlotColors>(EMPTY_AVATAR_SLOT_COLORS);
  const materialColorsRef = useRef<MaterialOverrides>({});
  const requestedModelId = searchParams.get("model");
  const [modelId] = useState(() => LOCAL_AVATAR_MODELS.some((item) => item.id === requestedModelId) ? requestedModelId! : LOCAL_AVATAR_MODELS[0].id);
  const [colors, setColors] = useState<AvatarSlotColors>(() => loadSavedCustomization(userId, modelId).colors);
  const [materialColors, setMaterialColors] = useState<MaterialOverrides>(() => loadSavedCustomization(userId, modelId).materialOverrides);
  const [activeSlot, setActiveSlot] = useState<AvatarColorSlot>("outfit");
  const [support, setSupport] = useState<Record<AvatarColorSlot, MaterialTarget[]>>(() => createAvatarSlotRecord(() => []));
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const model = LOCAL_AVATAR_MODELS.find((item) => item.id === modelId) ?? LOCAL_AVATAR_MODELS[0];
  const slotDetails = getAvatarMaterialManifest(model.id).slots;
  colorsRef.current = colors;
  materialColorsRef.current = materialColors;

  useEffect(() => {
    applyColorsRef.current?.(colors, materialColors);
  }, [colors, materialColors]);

  useEffect(() => {
    if (support[activeSlot].length > 0) return;
    const firstSupported = slotDetails.find((slot) => support[slot.key].length > 0);
    if (firstSupported) setActiveSlot(firstSupported.key);
  }, [activeSlot, slotDetails, support]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let frame: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let renderer: WebGLRenderer | null = null;
    let loadedScene: Scene | null = null;
    let viewportControls: AvatarViewportControls | null = null;
    setStatus("loading");
    setSupport(createAvatarSlotRecord(() => []));
    applyColorsRef.current = null;

    const load = async () => {
      try {
        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser, { autoUpdateHumanBones: true }));
        const gltf = await loader.loadAsync(model.previewUrl);
        const vrm = (gltf.userData.vrm as VRM | undefined) ?? null;
        if (cancelled) { VRMUtils.deepDispose(gltf.scene); return; }
        if (vrm?.meta.metaVersion === "0") VRMUtils.rotateVRM0(vrm);
        gltf.scene.updateMatrixWorld(true);

        const slots = createAvatarSlotRecord<TintMaterial[]>(() => []);
        const targetIds = createAvatarSlotRecord(() => new Map<TintMaterial, string>());
        const originals = new Map<TintMaterial, { color: Color; shade: Color | null }>();
        gltf.scene.traverse((object) => {
          if (!(object instanceof Mesh)) return;
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            if (!isTintMaterial(material)) continue;
            if (!originals.has(material)) {
              const shade = material.shadeColorFactor instanceof Color ? material.shadeColorFactor.clone() : null;
              originals.set(material, { color: material.color.clone(), shade });
            }
            const slotKey = getAvatarMaterialSlot(model.id, material.name);
            if (slotKey && !slots[slotKey].includes(material)) slots[slotKey].push(material);
          }
        });
        for (const slot of slotDetails) {
          slots[slot.key].forEach((material) => {
            targetIds[slot.key].set(material, getAvatarMaterialTargetId(slot.key, material.name));
          });
        }
        const applyColors = (nextColors: AvatarSlotColors, overrides: MaterialOverrides) => {
          for (const slot of slotDetails) {
            for (const material of slots[slot.key]) {
              const original = originals.get(material);
              if (!original) continue;
              const targetColor = overrides[targetIds[slot.key].get(material)!] ?? nextColors[slot.key];
              if (targetColor) {
                material.color.set(targetColor);
                if (original.shade && material.shadeColorFactor instanceof Color) {
                  material.shadeColorFactor.set(targetColor).multiplyScalar(0.72);
                }
              } else {
                material.color.copy(original.color);
                if (original.shade && material.shadeColorFactor instanceof Color) material.shadeColorFactor.copy(original.shade);
              }
              if (slot.key === "aura") setAvatarAuraTintEnabled(material, Boolean(targetColor));
              material.needsUpdate = true;
            }
          }
        };
        applyColorsRef.current = applyColors;
        applyColors(colorsRef.current, materialColorsRef.current);
        setSupport(createAvatarSlotRecord((key) => slots[key].map((material) => ({
          id: targetIds[key].get(material)!,
          name: material.name,
          label: getAvatarMaterialLabel(model.id, material.name) ?? material.name,
        }))));

        const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight);
        renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
        renderer.setSize(width, height, false);
        renderer.outputColorSpace = SRGBColorSpace;
        renderer.setClearColor(new Color("#0b0a16"), 0);
        const scene = new Scene();
        loadedScene = scene;
        scene.add(gltf.scene, new AmbientLight(0xffffff, 2.2));
        const keyLight = new DirectionalLight(0xe3d4ff, 3.4); keyLight.position.set(2, 3, 4); scene.add(keyLight);
        const rimLight = new DirectionalLight(0x8357d9, 2); rimLight.position.set(-2, 2, -2); scene.add(rimLight);
        const box = new Box3().setFromObject(gltf.scene), size = box.getSize(new Vector3()), center = box.getCenter(new Vector3());
        const camera = new PerspectiveCamera(30, width / height, 0.01, 100);
        viewportControls = createAvatarViewportControls(camera, canvas, center, size.y, size.y * 0.03);
        const activeControls = viewportControls.controls;
        const frameCamera = (w: number, h: number) => {
          camera.aspect = w / h;
          const vfov = camera.fov * Math.PI / 180;
          const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
          const distance = Math.max(size.y / (2 * Math.tan(vfov / 2)), size.x / (2 * Math.tan(hfov / 2))) * 1.6;
          camera.position.set(center.x, center.y + size.y * 0.03, center.z + distance);
          camera.updateProjectionMatrix(); activeControls.update();
        };
        frameCamera(width, height);
        resizeObserver = new ResizeObserver(([entry]) => {
          if (!renderer || !entry || entry.contentRect.width < 1 || entry.contentRect.height < 1) return;
          renderer.setSize(entry.contentRect.width, entry.contentRect.height, false);
          frameCamera(entry.contentRect.width, entry.contentRect.height);
        });
        resizeObserver.observe(canvas);

        const bones: LoadedAvatarModel["bones"] = {};
        if (vrm) for (const semantic of ["head", "neck", "chest", "upperChest", "spine", "hips", "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand", "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand"] as const) {
          const bone = vrm.humanoid.getNormalizedBoneNode(semantic); if (bone) bones[semantic] = bone;
        }
        const controller = createAvatarPreviewMotionController({ vrm, root: gltf.scene, bones, rigProfile: createRigProfile(1, model.previewUrl, bones), motion: "sway", modelWidth: size.x });
        const startedAt = performance.now(); let lastFrame = startedAt - 50;
        const animate = (now: number) => {
          if (cancelled || !renderer) return;
          frame = requestAnimationFrame(animate);
          if (now - lastFrame < 50) return;
          const delta = Math.min((now - lastFrame) / 1000, 0.1); lastFrame = now;
          controller.update((now - startedAt) / 1000); activeControls.update(); gltf.scene.updateMatrixWorld(true); vrm?.update(delta); renderer.render(scene, camera);
        };
        frame = requestAnimationFrame(animate);
        setStatus("ready");
      } catch (error) {
        console.error(`[AvatarColorLab] Không thể tải ${model.id}`, error);
        if (!cancelled) setStatus("error");
      }
    };
    void load();
    return () => {
      cancelled = true; applyColorsRef.current = null;
      if (frame !== null) cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      viewportControls?.dispose();
      if (loadedScene) VRMUtils.deepDispose(loadedScene);
      renderer?.dispose(); renderer?.forceContextLoss();
    };
  }, [model]);

  const continueToPreview = () => {
    sessionStorage.setItem(avatarDraftKey(userId, modelId), JSON.stringify({ modelId, colors, materialOverrides: materialColors }));
    navigate(avatarFlowPath(mode, "preview", modelId));
  };

  return (
    <main className="dark avatar-color-lab-page">
      <section className="avatar-color-lab-card">
        <header className="avatar-customize-header">
          <button className="icon-button" onClick={() => navigate(avatarFlowPath(mode, "setup"))} aria-label="Quay lại"><ChevronLeft /></button>
          <div className="avatar-customize-progress" aria-label="Bước 2 trên 3">
            {[["1", "Chọn"], ["2", "Tùy chỉnh"], ["3", "Xem trước"]].map(([number, label], index) => <div className={index <= 1 ? "active" : ""} key={number}><span>{number}</span><small>{label}</small></div>)}
          </div>
        </header>
        <div className="avatar-customize-heading"><span>Bước 2 / 3</span><h1>Biến avatar thành phiên bản của bạn</h1><p>Phối màu theo cá tính riêng — từng thay đổi đều được xem trực tiếp trên nhân vật.</p></div>
        <div className="avatar-color-lab-layout">
          <div className="avatar-color-stage">
            <canvas key={model.id} ref={canvasRef} aria-label={`Xem trước ${model.name}`} />
            {status !== "ready" && <div className={`avatar-color-status is-${status}`}><LoaderCircle />{status === "error" ? "Không thể tải model" : "Đang dựng VRM…"}</div>}
            <div className="avatar-color-model-badge">{model.name}</div>
            <small>Kéo để xoay · Lăn/pinch để thu phóng · Shift + kéo để di chuyển lên/xuống</small>
          </div>
          <aside className="avatar-color-controls">
            <div className="avatar-color-panel-title"><span>02</span><div><strong>Bảng phối màu</strong><small>Tạo bảng màu mang dấu ấn riêng của bạn</small></div></div>
            <div className="avatar-color-category-tabs" role="tablist" aria-label="Vùng phối màu">
              {slotDetails.map((slot, index) => <button role="tab" aria-selected={activeSlot === slot.key} className={activeSlot === slot.key ? "active" : ""} disabled={support[slot.key].length === 0} onClick={() => setActiveSlot(slot.key)} key={slot.key}><KokoroSlotIcon slot={slot.key} /><span>{slot.label}</span><small>{String(index + 1).padStart(2, "0")}</small></button>)}
            </div>
            {slotDetails.filter((slot) => slot.key === activeSlot).map((slot) => <div className="avatar-color-atelier" key={slot.key}>
              <div className="avatar-color-atelier-heading"><div><span>Đang phối</span><strong>{slot.label}</strong></div><small>{support[slot.key].length} vùng material</small></div>
              <div className="avatar-color-focus">
                <label className="avatar-color-orb" style={{ "--orb-color": colors[slot.key] ?? slot.fallback } as React.CSSProperties}>
                  <input type="color" value={colors[slot.key] ?? slot.fallback} disabled={status !== "ready"} onChange={(event) => setColors((current) => ({ ...current, [slot.key]: event.target.value }))} />
                  <span />
                </label>
                <div><small>Màu hiện tại</small><strong>{(colors[slot.key] ?? slot.fallback).toUpperCase()}</strong><p>Chạm vào vòng màu để chọn sắc độ bất kỳ.</p></div>
              </div>
              <div className="avatar-curated-swatches" aria-label="Màu gợi ý">
                {COLOR_SWATCHES.map((color) => <button className={(colors[slot.key] ?? slot.fallback).toLowerCase() === color.toLowerCase() ? "active" : ""} style={{ background: color }} aria-label={`Chọn màu ${color}`} onClick={() => setColors((current) => ({ ...current, [slot.key]: color }))} key={color} />)}
              </div>
              <details className="avatar-advanced-materials" open>
                <summary><span>Tinh chỉnh từng lớp</span><small>{support[slot.key].length} material</small></summary>
                <div className="avatar-material-list">
                  {support[slot.key].map((target, index) => <label key={target.id} title={target.name}>
                    <span>{target.label || `${slot.label} ${index + 1}`}</span>
                    <input type="color" value={materialColors[target.id] ?? colors[slot.key] ?? slot.fallback} onChange={(event) => setMaterialColors((current) => ({ ...current, [target.id]: event.target.value }))} />
                  </label>)}
                </div>
              </details>
            </div>)}
            <button className="secondary avatar-color-reset" onClick={() => { setColors({ ...EMPTY_AVATAR_SLOT_COLORS }); setMaterialColors({}); }}><RotateCcw /> Khôi phục màu gốc</button>
            <p className="avatar-color-note">Màu được áp dụng lên texture gốc nên hoa văn và vùng đổ bóng vẫn được giữ lại.</p>
          </aside>
        </div>
        <footer className="avatar-customize-actions">
          <button className="secondary" onClick={() => navigate(avatarFlowPath(mode, "setup"))}><ChevronLeft /> Quay lại</button>
          <button className="primary" onClick={continueToPreview}>Xem trước <ChevronRight /></button>
        </footer>
      </section>
    </main>
  );
}
