import { PerspectiveCamera, Vector3 } from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export interface AvatarViewportControls {
  controls: OrbitControls;
  dispose: () => void;
}

export function createAvatarViewportControls(
  camera: PerspectiveCamera,
  element: HTMLElement,
  center: Vector3,
  modelHeight: number,
  targetYOffset = 0,
): AvatarViewportControls {
  const controls = new OrbitControls(camera, element);
  controls.enableDamping = false;
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.minDistance = modelHeight * 0.75;
  controls.maxDistance = modelHeight * 8;
  controls.target.set(center.x, center.y + targetYOffset, center.z);

  const keepVerticalPanOnly = () => {
    const horizontalX = center.x - controls.target.x;
    const horizontalZ = center.z - controls.target.z;
    camera.position.x += horizontalX;
    camera.position.z += horizontalZ;
    controls.target.x = center.x;
    controls.target.z = center.z;
    const clampedY = Math.max(center.y - modelHeight * 0.35, Math.min(center.y + modelHeight * 0.35, controls.target.y));
    camera.position.y += clampedY - controls.target.y;
    controls.target.y = clampedY;
  };
  const preventPageGesture = (event: Event) => event.preventDefault();
  controls.addEventListener("change", keepVerticalPanOnly);
  element.addEventListener("gesturestart", preventPageGesture, { passive: false });
  element.addEventListener("gesturechange", preventPageGesture, { passive: false });
  element.addEventListener("gestureend", preventPageGesture, { passive: false });
  controls.update();

  return {
    controls,
    dispose: () => {
      controls.removeEventListener("change", keepVerticalPanOnly);
      controls.dispose();
      element.removeEventListener("gesturestart", preventPageGesture);
      element.removeEventListener("gesturechange", preventPageGesture);
      element.removeEventListener("gestureend", preventPageGesture);
    },
  };
}
