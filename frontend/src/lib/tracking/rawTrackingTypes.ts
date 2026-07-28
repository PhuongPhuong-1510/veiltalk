export type TrackingSampleState = "tracked" | "lost" | "not-sampled";
export type OverallTrackingState = "full" | "partial" | "lost";

export interface RawNormalizedLandmarkV1 {
  x: number;
  y: number;
  z: number;
  visibility: number | null;
}

export type RawWorldLandmarkV1 = RawNormalizedLandmarkV1;

export interface RawMatrixV1 {
  rows: number;
  columns: number;
  data: number[];
}

export interface RawFaceSampleV1 {
  state: TrackingSampleState;
  sampledAtMs: number | null;
  landmarks: RawNormalizedLandmarkV1[] | null;
  blendshapes: Record<string, number> | null;
  facialTransform: RawMatrixV1 | null;
}

export interface RawHandSampleV1 {
  state: TrackingSampleState;
  sampledAtMs: number | null;
  handedness: "left" | "right";
  handednessScore: number | null;
  landmarks: RawNormalizedLandmarkV1[] | null;
  worldLandmarks: RawWorldLandmarkV1[] | null;
}

/**
 * Mức 2A — Việc 0: một candidate thô từ Hand Landmarker, giữ nguyên `sourceIndex` trong mảng
 * kết quả gốc của MediaPipe. Không dedupe theo handedness: hai candidate cùng nhãn "left" vẫn
 * đều xuất hiện ở đây (khác `leftHand`/`rightHand` vốn chỉ giữ tối đa một candidate mỗi bên).
 */
export interface RawHandCandidateV1 {
  sourceIndex: number;
  sampledAtMs: number;
  handedness: "left" | "right" | "unknown";
  handednessScore: number | null;
  landmarks: RawNormalizedLandmarkV1[];
  worldLandmarks: RawWorldLandmarkV1[];
}

export interface RawPoseSampleV1 {
  state: TrackingSampleState;
  sampledAtMs: number | null;
  landmarks: RawNormalizedLandmarkV1[] | null;
  worldLandmarks: RawWorldLandmarkV1[] | null;
}

/** Output local-only của P4-T09. Không được dùng trực tiếp làm payload WebRTC. */
export interface RawTrackingFrameV1 {
  version: 1;
  frameTimestampMs: number;
  overall: OverallTrackingState;
  face: RawFaceSampleV1;
  leftHand: RawHandSampleV1;
  rightHand: RawHandSampleV1;
  /**
   * Mức 2A — Việc 0: toàn bộ candidate thô từ Hand Landmarker cho frame này, chưa qua
   * temporal matching. Rỗng khi hands không được lấy mẫu ở frame này (kể cả khi
   * `leftHand`/`rightHand` vẫn giữ giá trị cache cũ ở trạng thái "not-sampled") HOẶC khi
   * detector đã chạy nhưng không phát hiện tay nào. Phân biệt hai trường hợp đó bằng
   * `handSampledThisFrame` — `rawHands: []` một mình không đủ để matcher (Việc 1) biết đâu là
   * "không có observation mới" (giữ continuity) và đâu là "observation mới: không thấy tay".
   */
  rawHands: RawHandCandidateV1[];
  /** true nếu Hand Landmarker thực sự chạy `detectForVideo` ở frame này (kể cả khi rawHands rỗng). */
  handSampledThisFrame: boolean;
  /** Timestamp của lần chạy Hand Landmarker gần nhất tạo ra rawHands hiện tại; null nếu chưa từng chạy. */
  handSampledAtMs: number | null;
  pose: RawPoseSampleV1;
  /**
   * Mức 2A — Việc 4: kích thước thật của `<video>` nguồn (pixel), dùng để sửa aspect ratio khi
   * so khoảng cách/basis trong image space (Hand↔Pose matching, palm basis). null nếu chưa có
   * video sẵn sàng (trước khi metadata load xong) — caller không được giả định 1:1 khi null.
   */
  videoWidth: number | null;
  videoHeight: number | null;
}

export interface TrackingFreshnessPolicy {
  faceMaxAgeMs: number;
  handMaxAgeMs: number;
  poseMaxAgeMs: number;
}

export const DEFAULT_TRACKING_FRESHNESS: TrackingFreshnessPolicy = {
  faceMaxAgeMs: 100,
  handMaxAgeMs: 150,
  poseMaxAgeMs: 150,
};
