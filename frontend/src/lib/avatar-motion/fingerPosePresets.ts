import type { AvatarFingerName } from "./avatarPoseTypes";
import type { GesturePoseLabel } from "./gestureClassifier";

/**
 * Phase 3B.3 — Bước 1: tư thế ngón dựng sẵn cho từng nhãn cử chỉ.
 *
 * Preset là **semantic flexion**, KHÔNG phải quaternion (§3.6 của plan). Lý do: trục gập ngón khác
 * nhau giữa các VRM, nên `rotationX = -60°` đúng ở model này sẽ sai ở model khác. Ở đây chỉ nói
 * "đốt này gập 80% biên độ"; `fingerPosePlanner` mới đổi sang quaternion bằng flex axis lấy từ
 * `fingerRig` của chính model đang tải.
 *
 * File này là PURE DATA — không state, không phụ thuộc model, không phụ thuộc nguồn nhãn. Nhờ vậy
 * nó dùng được cho cả nhãn từ classifier local lẫn nhãn nhận qua network ở P4-T15 (§6 của plan).
 */

/** Mức gập của ba đốt một ngón, 0 = duỗi thẳng, 1 = gập hết biên độ. */
export interface FingerFlexionTarget {
  proximal: number;
  intermediate: number;
  distal: number;
  /**
   * Hướng semantic của ngón cái ở đốt gốc.
   *
   * Preset chỉ nói "lên"/"xuống"; `fingerRig` của model đang tải mới đổi nó thành directional
   * swing rest-relative để đầu ngón thật sự chĩa theo torso-up/torso-down. Không dùng một scalar
   * abduction chung: rest thumb và mặt phẳng xoay khác nhau giữa các VRM.
   */
  direction?: "up" | "down";
}

export type HandFlexionPreset = Record<AvatarFingerName, FingerFlexionTarget>;

/**
 * `presetVersion` đi kèm nhãn khi truyền qua network để hai bên không dựng hai tư thế khác nhau
 * từ cùng một nhãn. Tăng số này mỗi khi đổi giá trị preset.
 */
export const FINGER_POSE_PRESET_VERSION = 3;

const flat: FingerFlexionTarget = { proximal: 0, intermediate: 0, distal: 0 };

/**
 * Biên độ gập tối đa của mỗi đốt tính bằng radian, dùng khi đổi semantic flexion → góc quay.
 *
 * Khác nhau theo đốt vì giải phẫu: khớp giữa (PIP) gập được sâu nhất (~100°), khớp gốc (MCP) ~90°,
 * khớp ngọn (DIP) ~70°. Ngón cái gập ít hơn hẳn và theo hướng khác.
 */
export const FINGER_FLEXION_RANGE_RADIANS: Record<AvatarFingerName, FingerFlexionTarget> = {
  // Ngón cái gập ít hơn bốn ngón kia (khớp CMC/MCP/IP có biên độ nhỏ hơn MCP/PIP/DIP), nhưng
  // không nhỏ tới mức không nhìn thấy — ~50–60° mỗi đốt là mức tự nhiên khi nắm tay.
  thumb: { proximal: 0.9, intermediate: 1.0, distal: 0.9 },
  index: { proximal: 1.55, intermediate: 1.75, distal: 1.2 },
  middle: { proximal: 1.55, intermediate: 1.75, distal: 1.2 },
  ring: { proximal: 1.55, intermediate: 1.75, distal: 1.2 },
  little: { proximal: 1.55, intermediate: 1.75, distal: 1.2 },
};

/**
 * `fist` — nắm đấm.
 *
 * Bốn ngón thường cuộn gần hết. Ngón cái CỐ Ý gập ít hơn nhiều: ngón cái thật nằm vắt ngang ngoài
 * các ngón kia chứ không cuộn vào lòng, và gập nó hết biên độ sẽ làm ngón cái đâm xuyên qua các
 * ngón khác — lỗi hình ảnh dễ thấy nhất trên avatar.
 */
const FIST_PRESET: HandFlexionPreset = {
  // Ngón cái vắt ngang qua lòng bàn tay chứ không cuộn vào lòng — `fingerRig` đã cho nó mặt phẳng
  // gập riêng, nên ở đây gập được mạnh hơn mà không đâm xuyên các ngón kia.
  thumb: { proximal: 0.7, intermediate: 0.75, distal: 0.6 },
  index: { proximal: 0.9, intermediate: 0.95, distal: 0.8 },
  middle: { proximal: 0.9, intermediate: 0.95, distal: 0.8 },
  ring: { proximal: 0.9, intermediate: 0.95, distal: 0.8 },
  little: { proximal: 0.9, intermediate: 0.95, distal: 0.8 },
};

/**
 * `relaxed` — bàn tay nghỉ tự nhiên.
 *
 * KHÔNG phải duỗi thẳng hoàn toàn: bàn tay người ở trạng thái nghỉ luôn hơi cong. Duỗi phẳng lì
 * trông như tay ma-nơ-canh. Đây là tư thế avatar về khi cử chỉ được nhả.
 *
 * Ngón cái khép vào lòng rõ hơn bốn ngón kia (0.28 so với 0.16–0.22): ở tư thế nghỉ, ngón cái
 * người thật nghiêng vào phía lòng bàn tay chứ không nằm cùng mặt phẳng. Giá trị cũ 0.12 gần như
 * bằng `open` (0.05), làm tay nghỉ và tay xoè trông giống nhau ở ngón cái.
 */
const RELAXED_PRESET: HandFlexionPreset = {
  thumb: { proximal: 0.28, intermediate: 0.25, distal: 0.2 },
  index: { proximal: 0.16, intermediate: 0.2, distal: 0.14 },
  middle: { proximal: 0.18, intermediate: 0.22, distal: 0.16 },
  ring: { proximal: 0.2, intermediate: 0.24, distal: 0.18 },
  little: { proximal: 0.22, intermediate: 0.26, distal: 0.2 },
};

/**
 * `open` — xoè bàn tay.
 *
 * Duỗi thẳng hơn `relaxed` rõ rệt: đây là cử chỉ CÓ CHỦ Ý (vẫy tay, chào), khác với bàn tay đang
 * nghỉ. Nếu để gần `relaxed` thì người dùng xoè tay mà avatar gần như không đổi gì — cử chỉ mất
 * ý nghĩa.
 *
 * Bốn ngón thường DUỖI THẲNG TUYỆT ĐỐI (toàn 0).
 *
 * Bản đầu để 0.04–0.07 với lý lẽ "ngón người xoè hết vẫn còn cong rất nhẹ". Lý lẽ đó đúng về
 * giải phẫu nhưng sai về con số: biên độ mỗi đốt là 1.55–1.75 rad, nên 0.05 thành ~5° mỗi đốt và
 * ba đốt cộng lại ~15° — đủ để nhìn thấy cong. Nghiệm thu webcam #4 xác nhận: "các ngón mở tay
 * cũng không thẳng".
 *
 * Vì flexion là **rest-relative delta**, giá trị 0 nghĩa là giữ nguyên rest pose của model chứ
 * không phải bẻ ngón thành đường thẳng hình học — model VRM đã dựng bàn tay xoè ở rest với độ
 * cong tự nhiên sẵn có. Nói cách khác, độ cong tự nhiên đến từ model, không cần preset thêm vào.
 *
 * Ngón cái giữ 0.05: khác bốn ngón kia, ngón cái ở rest pose VRM thường đã hơi tách ra nên một
 * chút flexion giúp nó không chĩa ngang quá mức.
 */
const OPEN_PRESET: HandFlexionPreset = {
  thumb: { proximal: 0.05, intermediate: 0.05, distal: 0.05 },
  index: { proximal: 0, intermediate: 0, distal: 0 },
  middle: { proximal: 0, intermediate: 0, distal: 0 },
  ring: { proximal: 0, intermediate: 0, distal: 0 },
  little: { proximal: 0, intermediate: 0, distal: 0 },
};

/**
 * `point` — chỉ tay.
 *
 * Ngón trỏ duỗi thẳng như `open`; giữa/áp út/út cuộn như `fist`.
 *
 * Ngón cái gập gần bằng `fist`. Khi chỉ tay, ngón cái người thật **tựa lên ngón giữa đang co** —
 * tức là đã gập khá sâu, chỉ hơi nông hơn nắm đấm một chút vì nó dừng lại ở ngón giữa thay vì
 * vắt hẳn qua cả bốn ngón.
 *
 * Giá trị 0.5 ban đầu (nghiệm thu webcam #3) trông lửng lơ, không giống tư thế chỉ tay thật.
 * Classifier để ngón cái là wildcard nên preset phải chọn tư thế trông tự nhiên với mọi cách
 * người dùng đặt ngón cái — và "tựa lên ngón giữa" là tư thế phổ biến nhất.
 */
const POINT_PRESET: HandFlexionPreset = {
  thumb: { proximal: 0.65, intermediate: 0.7, distal: 0.55 },
  // Ngón trỏ duỗi thẳng tuyệt đối — chỉ tay mà ngón trỏ cong thì mất hẳn ý nghĩa "chỉ".
  index: { proximal: 0, intermediate: 0, distal: 0 },
  middle: { proximal: 0.9, intermediate: 0.95, distal: 0.8 },
  ring: { proximal: 0.9, intermediate: 0.95, distal: 0.8 },
  little: { proximal: 0.9, intermediate: 0.95, distal: 0.8 },
};

/**
 * `thumbsUp` — giơ ngón cái tán thành.
 *
 * Bốn ngón co như `fist`; ngón cái duỗi **thẳng tuyệt đối** (0). Cùng lý do như ngón trỏ của
 * `point`: ngón cái cong thì cử chỉ mất ý nghĩa, và flexion là rest-relative delta nên 0 giữ
 * đúng rest pose của model.
 */
const THUMBS_UP_PRESET: HandFlexionPreset = {
  // `direction: "up"` được rig giải chính xác tới torso-up của model. Đốt gốc không gập thêm;
  // hai đốt ngoài cong nhẹ để like không thành một cột thẳng cứng.
  thumb: { proximal: 0, intermediate: 0.18, distal: 0.22, direction: "up" },
  index: { proximal: 0.9, intermediate: 0.95, distal: 0.8 },
  middle: { proximal: 0.9, intermediate: 0.95, distal: 0.8 },
  ring: { proximal: 0.9, intermediate: 0.95, distal: 0.8 },
  little: { proximal: 0.9, intermediate: 0.95, distal: 0.8 },
};

/**
 * `thumbsDown` — chúc ngón cái xuống.
 *
 * Đối xứng với `thumbsUp`: cùng bốn ngón co, cùng độ gập ngón cái, chỉ đổi target semantic để
 * ngón cái chúc xuống.
 */
const THUMBS_DOWN_PRESET: HandFlexionPreset = {
  thumb: { proximal: 0, intermediate: 0.18, distal: 0.22, direction: "down" },
  index: { proximal: 0.9, intermediate: 0.95, distal: 0.8 },
  middle: { proximal: 0.9, intermediate: 0.95, distal: 0.8 },
  ring: { proximal: 0.9, intermediate: 0.95, distal: 0.8 },
  little: { proximal: 0.9, intermediate: 0.95, distal: 0.8 },
};

/**
 * `rest` — không điều khiển ngón.
 *
 * Toàn bộ identity: trả xương ngón về đúng rest pose của model. Khác `relaxed` ở chỗ `relaxed` là
 * một tư thế CÓ CHỦ Ý còn `rest` là "buông hẳn, trả model về nguyên trạng".
 */
const REST_PRESET: HandFlexionPreset = {
  thumb: flat, index: flat, middle: flat, ring: flat, little: flat,
};

/**
 * Bảng preset. `open`/`point`/`thumbsUp` sẽ được điền ở Bước 2–4; hiện tại chúng lùi về `relaxed`
 * để nếu có nhãn lọt vào sớm thì avatar vẫn ở tư thế hợp lý thay vì tư thế sai.
 */
const PRESETS: Record<GesturePoseLabel, HandFlexionPreset> = {
  fist: FIST_PRESET,
  open: OPEN_PRESET,
  point: POINT_PRESET,
  thumbsUp: THUMBS_UP_PRESET,
  thumbsDown: THUMBS_DOWN_PRESET,
  relaxed: RELAXED_PRESET,
  rest: REST_PRESET,
};

export function getFingerPosePreset(label: GesturePoseLabel): HandFlexionPreset {
  return PRESETS[label] ?? REST_PRESET;
}

/** Nhãn đã có preset riêng; các nhãn còn lại đang tạm lùi về `relaxed`. */
export const IMPLEMENTED_POSE_LABELS: readonly GesturePoseLabel[] = ["fist", "open", "point", "thumbsUp", "thumbsDown", "relaxed", "rest"];
