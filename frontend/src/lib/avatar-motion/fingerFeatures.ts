import type { RawWorldLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { AvatarFingerName } from "./avatarPoseTypes";

/**
 * Phase 3B.3 — Bước 1: đo độ co từng ngón từ 21 landmark MediaPipe.
 *
 * Vì sao KHÔNG chỉ dùng một phép đo:
 *
 * - **Góc khớp** (MCP/PIP/DIP) là phép đo trực tiếp nhất, nhưng landmark đầu ngón rung mạnh nhất
 *   nên góc DIP kém tin cậy hơn PIP.
 * - **Chord ratio** (khoảng cách đầu ngón → gốc ngón, chia cho tổng chiều dài đốt) bất biến với
 *   uniform scale nên chịu được xa/gần camera. Nhưng nó KHÔNG chống được foreshortening: ngón
 *   chĩa thẳng vào camera bị rút ngắn hình chiếu và trông như đang co, dù đang duỗi thẳng.
 *
 * Hai phép đo hỏng theo hai cách khác nhau, nên kết hợp lại đáng tin hơn từng cái riêng. Trọng số
 * ở đây đặt theo suy luận giải phẫu (PIP quan trọng nhất), sẽ chỉnh theo mô tả khi test webcam.
 *
 * Toạ độ dùng **world landmarks** (mét, gốc ở giữa bàn tay) chứ không phải image landmarks:
 * world landmark đã bỏ phần lớn ảnh hưởng của vị trí/kích thước bàn tay trong khung hình.
 */

/** Chỉ số landmark MediaPipe Hand cho từng đốt, theo thứ tự gốc → ngọn. */
export const FINGER_LANDMARK_CHAIN: Record<AvatarFingerName, readonly [number, number, number, number]> = {
  // thumb: CMC(1) → MCP(2) → IP(3) → TIP(4)
  thumb: [1, 2, 3, 4],
  // Bốn ngón thường: MCP → PIP → DIP → TIP
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  little: [17, 18, 19, 20],
} as const;

export const WRIST_LANDMARK_INDEX = 0;

/** Bốn ngón thường — ngón cái có ngữ nghĩa khớp khác nên tách riêng ở bước sau. */
export const REGULAR_FINGERS: readonly Exclude<AvatarFingerName, "thumb">[] = ["index", "middle", "ring", "little"];

export interface FingerCurlFeatures {
  finger: AvatarFingerName;
  /** Góc gập tại khớp gốc, chuẩn hoá 0 (duỗi thẳng) → 1 (gập vuông góc trở lên). */
  mcpFlexion: number;
  /** Khớp giữa — tin cậy nhất khi phân biệt nắm/xoè. */
  pipFlexion: number;
  /** Khớp ngọn — rung nhiều nhất, trọng số thấp. */
  dipFlexion: number;
  /** Đầu ngón cách gốc bao xa so với khi duỗi hết; 0 = duỗi thẳng, 1 = cuộn hết. */
  chordCurl: number;
  /** Kết hợp có trọng số; đây là giá trị classifier dùng. */
  combinedCurl: number;
  valid: boolean;
}

export interface HandFingerFeatures {
  /** Theo thứ tự `REGULAR_FINGERS`. */
  fingers: FingerCurlFeatures[];
  /** Số ngón thường đo được. Dưới 4 nghĩa là có landmark hỏng. */
  validFingerCount: number;
  /** Chỉ có khi caller truyền image landmark; `null` nghĩa là chưa đo hướng ngón cái. */
  thumb: ThumbFeatures | null;
}

const EPSILON = 1e-9;

interface Vec3 { x: number; y: number; z: number }

const subtract = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const length = (v: Vec3): number => Math.hypot(v.x, v.y, v.z);
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const isFiniteVec = (v: Vec3 | undefined | null): v is Vec3 =>
  Boolean(v) && Number.isFinite(v!.x) && Number.isFinite(v!.y) && Number.isFinite(v!.z);

/**
 * Góc gập tại một khớp, chuẩn hoá về [0, 1].
 *
 * Ba điểm liên tiếp gốc→giữa→ngọn tạo hai đoạn xương. Góc GIỮA HAI ĐOẠN (không phải góc trong)
 * bằng 0 khi ngón duỗi thẳng và tăng dần khi gập. Chuẩn hoá theo 180°: ngón người gập tối đa
 * khoảng 90–110° mỗi khớp, nên giá trị thực tế hiếm khi vượt 0.6.
 *
 * Trả về null khi hai đốt suy biến (landmark trùng nhau) — bắt buộc phải phân biệt "không đo
 * được" với "đo được và bằng 0", vì gộp lại sẽ biến landmark hỏng thành "ngón đang duỗi".
 */
function jointFlexion(root: Vec3, middle: Vec3, tip: Vec3): number | null {
  const proximal = subtract(middle, root);
  const distal = subtract(tip, middle);
  const proximalLength = length(proximal);
  const distalLength = length(distal);
  if (proximalLength < EPSILON || distalLength < EPSILON) return null;
  // cos của góc giữa hướng đốt trước và hướng đốt sau. Duỗi thẳng → hai hướng cùng chiều → cos=1.
  const cosine = Math.max(-1, Math.min(1, dot(proximal, distal) / (proximalLength * distalLength)));
  return Math.acos(cosine) / Math.PI;
}

/**
 * Chord curl: đầu ngón gần gốc ngón tới mức nào so với khi duỗi hết.
 *
 * Khi duỗi thẳng, khoảng cách gốc→đầu ngón bằng tổng chiều dài ba đốt. Khi cuộn lại, khoảng cách
 * đó co về gần 0. Tỉ số hai đại lượng này bất biến với uniform scale — bàn tay ở xa camera cho
 * cùng giá trị như ở gần.
 */
function chordCurl(points: readonly Vec3[]): number | null {
  let boneLengthSum = 0;
  for (let i = 0; i < points.length - 1; i += 1) boneLengthSum += length(subtract(points[i + 1], points[i]));
  if (boneLengthSum < EPSILON) return null;
  const chord = length(subtract(points[points.length - 1], points[0]));
  // chord/boneLengthSum: 1 khi duỗi thẳng hoàn hảo, giảm dần khi cuộn.
  return Math.max(0, Math.min(1, 1 - chord / boneLengthSum));
}

/**
 * Trọng số kết hợp — CHƯA KHÓA, sẽ chỉnh theo mô tả khi test webcam.
 *
 * Lý do chọn ban đầu:
 * - `pip` cao nhất: khớp giữa quyết định "nắm hay không", và landmark của nó ổn định hơn đầu ngón.
 * - `mcp` thấp: góc khớp gốc còn thay đổi theo xoè/khép ngón, không chỉ theo co/duỗi.
 * - `dip` thấp: landmark đầu ngón rung mạnh nhất.
 * - `chord` giữ trọng số đáng kể vì nó bắt được "cuộn cả ngón" mà từng góc riêng có thể bỏ sót.
 */
export interface FingerCurlWeights { mcp: number; pip: number; dip: number; chord: number }

export const DEFAULT_FINGER_CURL_WEIGHTS: FingerCurlWeights = { mcp: 0.15, pip: 0.4, dip: 0.15, chord: 0.3 };

export function computeFingerCurl(
  worldLandmarks: readonly RawWorldLandmarkV1[],
  finger: AvatarFingerName,
  weights: FingerCurlWeights = DEFAULT_FINGER_CURL_WEIGHTS,
): FingerCurlFeatures {
  const invalid: FingerCurlFeatures = {
    finger, mcpFlexion: 0, pipFlexion: 0, dipFlexion: 0, chordCurl: 0, combinedCurl: 0, valid: false,
  };
  const chain = FINGER_LANDMARK_CHAIN[finger];
  const wrist = worldLandmarks[WRIST_LANDMARK_INDEX];
  const points = chain.map((index) => worldLandmarks[index]);
  // `points` có thể chứa `undefined` khi mảng landmark bị cắt ngắn — kiểm tra từng phần tử thay
  // vì cast, để mảng thiếu landmark trở thành `invalid` chứ không phải NaN lan xuống dưới.
  if (!isFiniteVec(wrist) || points.length !== 4) return invalid;
  const [mcp, pip, dip, tip] = points;
  if (!isFiniteVec(mcp) || !isFiniteVec(pip) || !isFiniteVec(dip) || !isFiniteVec(tip)) return invalid;

  // Khớp gốc cần điểm tham chiếu phía trước nó — dùng cổ tay. Không có cách nào khác vì MCP là
  // landmark đầu tiên của ngón.
  const mcpFlexion = jointFlexion(wrist, mcp, pip);
  const pipFlexion = jointFlexion(mcp, pip, dip);
  const dipFlexion = jointFlexion(pip, dip, tip);
  const chord = chordCurl([mcp, pip, dip, tip]);
  // Thiếu bất kỳ phép đo nào là landmark hỏng: trả invalid thay vì lấp bằng 0. Lấp 0 sẽ làm một
  // ngón không đo được trông y hệt một ngón đang duỗi thẳng, và classifier sẽ tin nhầm.
  if (mcpFlexion === null || pipFlexion === null || dipFlexion === null || chord === null) return invalid;

  const weightSum = weights.mcp + weights.pip + weights.dip + weights.chord;
  if (weightSum < EPSILON) return invalid;
  // Góc khớp chuẩn hoá theo 180° nhưng ngón chỉ gập tới ~90°, nên nhân 2 để một ngón gập hết đạt
  // gần 1 thay vì kẹt ở 0.5 — nếu không, ngưỡng "co" sẽ phải đặt thấp bất thường và sát vùng nhiễu.
  const scaleToFullRange = (value: number) => Math.max(0, Math.min(1, value * 2));
  const combinedCurl = Math.max(0, Math.min(1, (
    weights.mcp * scaleToFullRange(mcpFlexion)
    + weights.pip * scaleToFullRange(pipFlexion)
    + weights.dip * scaleToFullRange(dipFlexion)
    + weights.chord * chord
  ) / weightSum));

  return {
    finger,
    mcpFlexion: scaleToFullRange(mcpFlexion),
    pipFlexion: scaleToFullRange(pipFlexion),
    dipFlexion: scaleToFullRange(dipFlexion),
    chordCurl: chord,
    combinedCurl,
    valid: true,
  };
}

/**
 * Feature riêng cho ngón cái — Bước 4 (`thumbsUp`).
 *
 * Ngón cái KHÔNG quy về một số curl như bốn ngón kia. Lý do: `thumbsUp` và `thumbDown` có **hình
 * dạng bàn tay giống hệt nhau** (bốn ngón co, ngón cái duỗi) và chỉ khác **hướng**. Một số curl
 * không phân biệt được hai tư thế đó — đây chính là lỗi lớn nhất của plan v1.
 */
export interface ThumbFeatures {
  /** Ngón cái duỗi tới đâu; 0 = duỗi thẳng, 1 = gập hết. */
  flexion: number;
  /**
   * Hướng ngón cái trong KHÔNG GIAN ẢNH đã sửa aspect ratio, chuẩn hoá.
   *
   * Dùng image space chứ không phải palm-local: "hướng lên" của `thumbsUp` là lên theo **người
   * xem**, không phải lên theo bàn tay. Nếu đo trong palm-local thì xoay cổ tay 180° sẽ biến
   * thumbsUp thành thumbsDown mà giá trị đo không đổi.
   *
   * Trục y đã ĐẢO DẤU so với toạ độ ảnh gốc (ảnh có y tăng xuống dưới), nên `y > 0` nghĩa là
   * ngón cái chĩa LÊN trên màn hình — đọc trực tiếp không cần nhớ quy ước ngược.
   */
  directionInImage: { x: number; y: number };
  /** Ngón cái chĩa lên tới đâu: 1 = thẳng đứng lên, 0 = ngang, −1 = thẳng xuống. */
  upwardness: number;
  valid: boolean;
}

/**
 * Đo hướng ngón cái trong ảnh.
 *
 * Cần `landmarks` (image space) chứ không phải `worldLandmarks`: world landmark có gốc ở giữa bàn
 * tay và trục không gắn với khung hình, nên không trả lời được "ngón cái chĩa lên hay xuống trên
 * màn hình".
 */
export function computeThumbFeatures(
  landmarks: readonly RawWorldLandmarkV1[],
  worldLandmarks: readonly RawWorldLandmarkV1[],
  videoWidth: number,
  videoHeight: number,
  weights: FingerCurlWeights = DEFAULT_FINGER_CURL_WEIGHTS,
): ThumbFeatures {
  const invalid: ThumbFeatures = {
    flexion: 0, directionInImage: { x: 0, y: 0 }, upwardness: 0, valid: false,
  };
  const chain = FINGER_LANDMARK_CHAIN.thumb;
  const mcp = landmarks[chain[1]];
  const tip = landmarks[chain[3]];
  if (!isFiniteVec(mcp) || !isFiniteVec(tip)) return invalid;
  if (!(videoWidth > 0) || !(videoHeight > 0)) return invalid;

  // Sửa aspect ratio: toạ độ MediaPipe chuẩn hoá `x` theo CHIỀU RỘNG và `y` theo CHIỀU CAO, nên
  // cùng một số đơn vị chuẩn hoá ứng với số pixel khác nhau ở hai trục. Muốn góc đo được khớp với
  // góc người xem thấy, phải quy cả hai về cùng đơn vị pixel.
  //
  // Nhân `dx` (không phải `dy`) với `videoWidth/videoHeight`: 0.1 đơn vị theo x là 128px trong
  // khung 1280×720, còn 0.1 theo y chỉ là 72px. Bản đầu nhân nhầm vào `dy` với hệ số nghịch đảo,
  // làm thành phần DỌC bị nén 0.5625 lần — ngón cái nghiêng 30° thật chỉ đo ra upwardness 0.309
  // thay vì 0.5, và cử chỉ like tự nhiên không bao giờ đạt ngưỡng (nghiệm thu webcam #6).
  const dx = (tip.x - mcp.x) * (videoWidth / videoHeight);
  // Đảo dấu y: ảnh có y tăng xuống dưới, ta muốn y dương = lên trên.
  const dy = -(tip.y - mcp.y);
  const magnitude = Math.hypot(dx, dy);
  // Ngón cái gập sát vào lòng có hình chiếu rất ngắn; hướng lúc đó là nhiễu thuần tuý.
  if (magnitude < 1e-4) return invalid;

  const direction = { x: dx / magnitude, y: dy / magnitude };
  const curl = computeFingerCurl(worldLandmarks, "thumb", weights);
  return {
    flexion: curl.valid ? curl.combinedCurl : 0,
    directionInImage: direction,
    upwardness: direction.y,
    valid: curl.valid,
  };
}

/** Đo bốn ngón thường; `thumb` chỉ có khi truyền image landmark + kích thước video. */
export function computeHandFingerFeatures(
  worldLandmarks: readonly RawWorldLandmarkV1[],
  weights: FingerCurlWeights = DEFAULT_FINGER_CURL_WEIGHTS,
  thumbInput?: { landmarks: readonly RawWorldLandmarkV1[]; videoWidth: number; videoHeight: number },
): HandFingerFeatures {
  const fingers = REGULAR_FINGERS.map((finger) => computeFingerCurl(worldLandmarks, finger, weights));
  const thumb = thumbInput
    ? computeThumbFeatures(thumbInput.landmarks, worldLandmarks, thumbInput.videoWidth, thumbInput.videoHeight, weights)
    : null;
  return { fingers, validFingerCount: fingers.filter((finger) => finger.valid).length, thumb };
}
