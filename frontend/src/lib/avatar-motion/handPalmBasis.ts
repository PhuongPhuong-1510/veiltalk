import { Vector3 } from "three";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { Vector3Data } from "./avatarPoseTypes";

/**
 * Mức 2A — Việc 2: dựng palm basis (across/forward/normal) hoàn toàn từ landmark bên trong
 * MỘT Hand frame — không trộn với Pose hay world position của Hand khác. Chỉ dùng cho
 * diagnostic; KHÔNG tạo quaternion, KHÔNG chạm pole/jointRotations/VRM (AGENTS.md Mức 2A mục 5).
 */

export const HAND_LANDMARK_INDEX = { wrist: 0, indexMcp: 5, middleMcp: 9, pinkyMcp: 17 } as const;

export type HandBasisRejectionReason =
  | "missing-landmarks"
  | "non-finite"
  | "invalid-video-size"
  | "across-too-small"
  | "forward-too-small"
  | "area-too-small"
  | "gram-schmidt-degenerate"
  | "world-landmarks-unavailable"
  | "world-basis-degenerate";

export interface HandBasisResult {
  across: Vector3Data;
  forward: Vector3Data;
  normal: Vector3Data;
}

export interface HandPalmBasisConfig {
  /** Độ dài tối thiểu của palmAcross/palmForward thô trước khi Gram-Schmidt, để tránh chuẩn hoá vector gần-zero. */
  minRawVectorLength: number;
  /** Diện tích tối thiểu tam giác index/middle/pinky MCP (đơn vị theo không gian tương ứng: image hoặc world). */
  minTriangleArea: number;
}

export const DEFAULT_HAND_PALM_BASIS_CONFIG: HandPalmBasisConfig = {
  minRawVectorLength: 1e-4,
  minTriangleArea: 1e-6,
};

export interface HandPalmBasisOutput {
  imageBasis: HandBasisResult | null;
  /**
   * Độ độc lập hình học giữa palmAcross và phần forward thô (index/middle/pinky/wrist không
   * gần thẳng hàng) — KHÔNG phải mức "bàn tay edge-on với camera". Edge-on/view-alignment là
   * một metric khác, sẽ thêm sau khi xác nhận convention trục camera của Hand world frame.
   */
  imageGeometryQuality: number;
  imageRejectionReason: HandBasisRejectionReason | null;
  worldBasis: HandBasisResult | null;
  worldGeometryQuality: number;
  worldRejectionReason: HandBasisRejectionReason | null;
  handedness: "left" | "right" | "unknown";
}

function requiredLandmarks(landmarks: RawNormalizedLandmarkV1[] | null | undefined): {
  wrist: RawNormalizedLandmarkV1; indexMcp: RawNormalizedLandmarkV1; middleMcp: RawNormalizedLandmarkV1; pinkyMcp: RawNormalizedLandmarkV1;
} | null {
  if (!landmarks) return null;
  const wrist = landmarks[HAND_LANDMARK_INDEX.wrist];
  const indexMcp = landmarks[HAND_LANDMARK_INDEX.indexMcp];
  const middleMcp = landmarks[HAND_LANDMARK_INDEX.middleMcp];
  const pinkyMcp = landmarks[HAND_LANDMARK_INDEX.pinkyMcp];
  if (!wrist || !indexMcp || !middleMcp || !pinkyMcp) return null;
  return { wrist, indexMcp, middleMcp, pinkyMcp };
}

function isFiniteVector(v: Vector3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

function isFiniteLandmark(point: RawNormalizedLandmarkV1): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z);
}

/**
 * Gram-Schmidt: palmX từ index→pinky (mượn hướng "sang bên" của bàn tay); palmY là thành phần
 * middle-wrist vuông góc với palmX (hướng "về phía ngón tay" đã khử phần chồng lên trục X);
 * palmZ = cross(X, Y). Không tự đảo dấu theo handedness (yêu cầu #5) — dấu sẽ được xác nhận
 * bằng webcam thật trước khi dùng ở Mức 2B.
 */
function gramSchmidtBasis(
  wrist: Vector3, indexMcp: Vector3, middleMcp: Vector3, pinkyMcp: Vector3,
  config: HandPalmBasisConfig,
): { basis: HandBasisResult | null; rejectionReason: HandBasisRejectionReason | null; geometryQuality: number } {
  const rawAcross = indexMcp.clone().sub(pinkyMcp);
  const rawForward = middleMcp.clone().sub(wrist);
  if (!isFiniteVector(rawAcross) || !isFiniteVector(rawForward)) return { basis: null, rejectionReason: "non-finite", geometryQuality: 0 };
  if (rawAcross.length() < config.minRawVectorLength) return { basis: null, rejectionReason: "across-too-small", geometryQuality: 0 };
  if (rawForward.length() < config.minRawVectorLength) return { basis: null, rejectionReason: "forward-too-small", geometryQuality: 0 };

  const triangleArea = 0.5 * new Vector3().crossVectors(rawAcross, rawForward).length();
  if (triangleArea < config.minTriangleArea) return { basis: null, rejectionReason: "area-too-small", geometryQuality: 0 };

  const x = rawAcross.clone().normalize();
  const yRaw = rawForward.clone().addScaledVector(x, -rawForward.dot(x));
  if (!isFiniteVector(yRaw) || yRaw.length() < config.minRawVectorLength) return { basis: null, rejectionReason: "gram-schmidt-degenerate", geometryQuality: 0 };
  // Đo độ dài TRƯỚC khi normalize() (three.js normalize() sửa in-place, sẽ làm yRaw luôn có
  // độ dài 1 nếu đo sau) — đây là tử số thật của geometryQuality bên dưới.
  const yRawLength = yRaw.length();
  const y = yRaw.normalize();
  const z = new Vector3().crossVectors(x, y);
  if (!isFiniteVector(z) || z.length() < config.minRawVectorLength) return { basis: null, rejectionReason: "gram-schmidt-degenerate", geometryQuality: 0 };
  const zNormalized = z.normalize();

  // Độ độc lập hình học liên tục: tỉ lệ giữa thành phần forward còn lại sau khi khử phần chồng
  // lên palmAcross và forward thô ban đầu. Gần 0 khi across và forward gần song song (tam giác
  // suy biến); gần 1 khi vuông góc rõ ràng. KHÔNG phải "edge-on quality" — đó là khái niệm liên
  // quan tới hướng nhìn của camera so với mặt phẳng bàn tay, cần xác nhận convention trục
  // camera của Hand world frame trước khi định nghĩa, ngoài phạm vi Việc 2.
  const geometryQuality = Math.max(0, Math.min(1, yRawLength / rawForward.length()));

  return { basis: { across: { x: x.x, y: x.y, z: x.z }, forward: { x: y.x, y: y.y, z: y.z }, normal: { x: zNormalized.x, y: zNormalized.y, z: zNormalized.z } }, rejectionReason: null, geometryQuality };
}

/**
 * Sửa aspect ratio CHỈ trên mặt phẳng ảnh: x giữ nguyên, y *= videoHeight/videoWidth, z = 0.
 * Image basis trong Mức 2A là basis 2D trên mặt phẳng ảnh — z không phải trục pixel theo
 * chiều cao ảnh nên không được chia theo cùng hệ số với y (khác Hand-world basis là basis 3D
 * dùng nguyên toạ độ world, tính riêng trong `computeHandPalmBasis`).
 */
function aspectCorrectedImagePoint(point: RawNormalizedLandmarkV1, videoWidth: number, videoHeight: number): Vector3 {
  return new Vector3(point.x, point.y * (videoHeight / videoWidth), 0);
}

export function computeHandPalmBasis(
  landmarks: RawNormalizedLandmarkV1[] | null | undefined,
  worldLandmarks: RawNormalizedLandmarkV1[] | null | undefined,
  handedness: "left" | "right" | "unknown",
  videoWidth: number,
  videoHeight: number,
  config: HandPalmBasisConfig = DEFAULT_HAND_PALM_BASIS_CONFIG,
): HandPalmBasisOutput {
  const image = requiredLandmarks(landmarks);
  let imageBasis: HandBasisResult | null = null;
  let imageGeometryQuality = 0;
  let imageRejectionReason: HandBasisRejectionReason | null = null;

  if (!image) {
    imageRejectionReason = "missing-landmarks";
  } else if (![image.wrist, image.indexMcp, image.middleMcp, image.pinkyMcp].every(isFiniteLandmark)) {
    imageRejectionReason = "non-finite";
  } else if (!(Number.isFinite(videoWidth) && Number.isFinite(videoHeight) && videoWidth > 0 && videoHeight > 0)) {
    imageRejectionReason = "invalid-video-size";
  } else {
    const wrist = aspectCorrectedImagePoint(image.wrist, videoWidth, videoHeight);
    const indexMcp = aspectCorrectedImagePoint(image.indexMcp, videoWidth, videoHeight);
    const middleMcp = aspectCorrectedImagePoint(image.middleMcp, videoWidth, videoHeight);
    const pinkyMcp = aspectCorrectedImagePoint(image.pinkyMcp, videoWidth, videoHeight);
    const result = gramSchmidtBasis(wrist, indexMcp, middleMcp, pinkyMcp, config);
    imageBasis = result.basis;
    imageGeometryQuality = result.geometryQuality;
    imageRejectionReason = result.rejectionReason;
  }

  // Hand-world basis được tính hoàn toàn ĐỘC LẬP: chỉ dùng vector giữa các điểm cùng Hand
  // frame (yêu cầu #2, #6) — image basis hỏng không kéo world basis hỏng theo và ngược lại.
  const world = requiredLandmarks(worldLandmarks);
  let worldBasis: HandBasisResult | null = null;
  let worldGeometryQuality = 0;
  let worldRejectionReason: HandBasisRejectionReason | null = null;

  if (!worldLandmarks) {
    worldRejectionReason = "world-landmarks-unavailable";
  } else if (!world) {
    worldRejectionReason = "missing-landmarks";
  } else if (![world.wrist, world.indexMcp, world.middleMcp, world.pinkyMcp].every(isFiniteLandmark)) {
    worldRejectionReason = "non-finite";
  } else {
    const wrist = new Vector3(world.wrist.x, world.wrist.y, world.wrist.z);
    const indexMcp = new Vector3(world.indexMcp.x, world.indexMcp.y, world.indexMcp.z);
    const middleMcp = new Vector3(world.middleMcp.x, world.middleMcp.y, world.middleMcp.z);
    const pinkyMcp = new Vector3(world.pinkyMcp.x, world.pinkyMcp.y, world.pinkyMcp.z);
    const result = gramSchmidtBasis(wrist, indexMcp, middleMcp, pinkyMcp, config);
    worldBasis = result.basis;
    worldGeometryQuality = result.geometryQuality;
    worldRejectionReason = result.rejectionReason ? (result.rejectionReason === "gram-schmidt-degenerate" ? "world-basis-degenerate" : result.rejectionReason) : null;
  }

  return { imageBasis, imageGeometryQuality, imageRejectionReason, worldBasis, worldGeometryQuality, worldRejectionReason, handedness };
}
