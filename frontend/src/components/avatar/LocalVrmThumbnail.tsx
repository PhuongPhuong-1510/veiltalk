import { useEffect, useRef, useState } from "react";
import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { LoaderCircle, ScanFace } from "lucide-react";
import { createRigProfile } from "../../lib/avatar-renderer/modelLoader";
import type { LoadedAvatarModel } from "../../lib/avatar-renderer/modelTypes";
import { createAvatarPreviewMotionController, type PreviewMotion } from "../../lib/avatar-preview/avatarPreviewMotionController";
import { faceSetupWavePalm } from "./setupWavePalm";

export type { PreviewMotion } from "../../lib/avatar-preview/avatarPreviewMotionController";

interface LocalVrmThumbnailProps {
  name: string;
  url: string;
  motion: PreviewMotion;
}

export default function LocalVrmThumbnail({ name, url, motion }: LocalVrmThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const motionControllerRef = useRef<ReturnType<typeof createAvatarPreviewMotionController> | null>(null);
  const latestMotionRef = useRef(motion);
  latestMotionRef.current = motion;
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    motionControllerRef.current?.setMotion(motion);
  }, [motion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    let renderer: WebGLRenderer | null = null;
    let loadedScene: Scene | null = null;
    let animationFrame: number | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let intersectionObserver: IntersectionObserver | null = null;
    let isInViewport = true;
    let resumeAnimation: (() => void) | null = null;
    const handlePageVisibility = () => {
      if (document.hidden && animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = null;
      }
      resumeAnimation?.();
    };
    setStatus("loading");

    const renderThumbnail = async () => {
      try {
        const loader = new GLTFLoader();
        loader.register((parser) => new VRMLoaderPlugin(parser, { autoUpdateHumanBones: true }));
        const gltf = await loader.loadAsync(url);
        const vrm = (gltf.userData.vrm as VRM | undefined) ?? null;

        if (cancelled) {
          VRMUtils.deepDispose(gltf.scene);
          return;
        }

        if (vrm?.meta.metaVersion === "0") VRMUtils.rotateVRM0(vrm);
        gltf.scene.updateMatrixWorld(true);

        const bones: LoadedAvatarModel["bones"] = {};
        if (vrm) {
          const semanticBones = ["head", "neck", "chest", "upperChest", "spine", "hips", "leftShoulder", "leftUpperArm", "leftLowerArm", "leftHand", "leftIndexProximal", "leftMiddleProximal", "leftLittleProximal", "rightShoulder", "rightUpperArm", "rightLowerArm", "rightHand", "rightIndexProximal", "rightMiddleProximal", "rightLittleProximal"] as const;
          for (const semantic of semanticBones) {
            const node = vrm.humanoid.getNormalizedBoneNode(semantic);
            if (node) bones[semantic] = node;
          }
        }
        const rigProfile = createRigProfile(1, url, bones);
        const width = Math.max(1, canvas.clientWidth);
        const height = Math.max(1, canvas.clientHeight);

        renderer = new WebGLRenderer({
          canvas,
          alpha: true,
          antialias: true,
          powerPreference: "high-performance",
          // Thumbnail không cần đọc/lưu framebuffer sau khi render. Tắt cờ này giảm đáng kể bộ nhớ GPU.
          preserveDrawingBuffer: false,
        });
        const previewPixelRatio = width >= 420 ? 1 : Math.min(window.devicePixelRatio, 1.25);
        renderer.setPixelRatio(previewPixelRatio);
        renderer.setSize(width, height, false);
        renderer.outputColorSpace = SRGBColorSpace;
        renderer.setClearColor(new Color("#0b0a16"), 0);

        const scene = new Scene();
        loadedScene = scene;
        scene.add(gltf.scene);
        scene.add(new AmbientLight(0xffffff, 2.15));
        const keyLight = new DirectionalLight(0xdac8ff, 3.1);
        keyLight.position.set(1.8, 2.8, 3.5);
        scene.add(keyLight);
        const rimLight = new DirectionalLight(0x8a5cff, 2.2);
        rimLight.position.set(-2.5, 1.8, -2);
        scene.add(rimLight);

        const box = new Box3().setFromObject(gltf.scene);
        const size = box.getSize(new Vector3());
        const center = box.getCenter(new Vector3());
        const camera = new PerspectiveCamera(28, width / height, 0.01, 100);
        // Aim slightly above the model center so the character sits lower in the card.
        const targetY = center.y + size.y * 0.08;
        const frameCamera = (frameWidth: number, frameHeight: number) => {
          camera.aspect = frameWidth / frameHeight;
          const verticalFov = camera.fov * Math.PI / 180;
          const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
          const heightDistance = size.y / (2 * Math.tan(verticalFov / 2));
          const widthDistance = size.x / (2 * Math.tan(horizontalFov / 2));
          const distance = Math.max(heightDistance, widthDistance, 0.5) * 1.08;
          camera.position.set(center.x, targetY, center.z + distance);
          camera.lookAt(center.x, targetY, center.z);
          camera.updateProjectionMatrix();
        };
        frameCamera(width, height);
        resizeObserver = new ResizeObserver((entries) => {
          const rect = entries[0]?.contentRect;
          if (!rect || !renderer || rect.width < 1 || rect.height < 1) return;
          renderer.setSize(rect.width, rect.height, false);
          frameCamera(rect.width, rect.height);
        });
        resizeObserver.observe(canvas);
        const motionController = createAvatarPreviewMotionController({
          vrm,
          root: gltf.scene,
          bones,
          rigProfile,
          motion: latestMotionRef.current,
          modelWidth: size.x,
        });
        motionControllerRef.current = motionController;

        const startedAt = performance.now();
        let lastRenderedAt = startedAt - 80;
        const animate = (now: number) => {
          animationFrame = null;
          if (cancelled || !renderer || !isInViewport || document.hidden) return;
          animationFrame = window.requestAnimationFrame(animate);
          // Trạng thái nghỉ chỉ cần ~12 FPS; khi hover chào tay tăng lên 20 FPS để chuyển động vẫn mượt.
          const frameInterval = latestMotionRef.current === "sway" ? 80 : 50;
          if (now - lastRenderedAt < frameInterval) return;
          const deltaSeconds = Math.min((now - lastRenderedAt) / 1000, 0.1);
          lastRenderedAt = now;
          const elapsedSeconds = (now - startedAt) / 1000;
          motionController.update(elapsedSeconds);
          gltf.scene.updateMatrixWorld(true);
          const previewMotion = latestMotionRef.current;
          for (const side of ["left", "right"] as const) {
            const isWaving = previewMotion === `wave-${side}` || previewMotion === "wave-both";
            const hand = bones[`${side}Hand`];
            const lowerArm = bones[`${side}LowerArm`];
            const palmNormal = rigProfile?.hands?.[side]?.contactFrame?.normalLocal;
            if (isWaving && hand && lowerArm && palmNormal) {
              faceSetupWavePalm(hand, lowerArm, palmNormal, camera.position);
            }
          }
          gltf.scene.updateMatrixWorld(true);
          vrm?.update(deltaSeconds);
          renderer.render(scene, camera);
        };
        resumeAnimation = () => {
          if (!cancelled && renderer && isInViewport && !document.hidden && animationFrame === null) {
            lastRenderedAt = performance.now() - 80;
            animationFrame = window.requestAnimationFrame(animate);
          }
        };
        intersectionObserver = new IntersectionObserver(([entry]) => {
          isInViewport = entry?.isIntersecting ?? false;
          if (!isInViewport && animationFrame !== null) {
            window.cancelAnimationFrame(animationFrame);
            animationFrame = null;
          }
          resumeAnimation?.();
        }, { rootMargin: "80px" });
        intersectionObserver.observe(canvas);
        document.addEventListener("visibilitychange", handlePageVisibility);
        resumeAnimation();
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    };

    void renderThumbnail();
    return () => {
      cancelled = true;
      motionControllerRef.current = null;
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      document.removeEventListener("visibilitychange", handlePageVisibility);
      if (loadedScene) VRMUtils.deepDispose(loadedScene);
      renderer?.dispose();
      renderer?.forceContextLoss();
    };
  }, [url]);

  return (
    <div className={`local-vrm-thumbnail is-${status}`}>
      <canvas ref={canvasRef} aria-label={`Model VRM ${name}`} />
      {status === "loading" && <span><LoaderCircle aria-hidden="true" /> Đang dựng VRM…</span>}
      {status === "error" && <span><ScanFace aria-hidden="true" /> Không thể hiển thị model</span>}
    </div>
  );
}
