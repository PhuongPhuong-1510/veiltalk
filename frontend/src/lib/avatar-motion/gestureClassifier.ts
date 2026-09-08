import type { FingerCurlFeatures, HandFingerFeatures } from "./fingerFeatures";

/**
 * Phase 3B.3 — Bước 1: phân loại cử chỉ rời rạc từ feature ngón.
 *
 * Rule-based, không ML, không thêm thư viện (ràng buộc AGENTS.md).
 *
 * Bước 1 chỉ nhận `fist`. Các nhãn `open`/`point`/`thumbsUp` được thêm ở Bước 2–4; khung nhãn và
 * confidence đã dựng sẵn để thêm nhãn mới không phải sửa lại temporal/planner.
 */

/** Tư thế phát ra avatar. Tách khỏi nhãn quan sát bên dưới (§3.4 của plan). */
export type GesturePoseLabel = "fist" | "open" | "point" | "thumbsUp" | "thumbsDown" | "relaxed" | "rest";

/** Nhãn quan sát — mô tả TRẠNG THÁI ĐO ĐẠC, không phải tư thế để phát. */
export type GestureObservationLabel =
  | GesturePoseLabel
  /** Bàn tay hiện rõ, đo được, nhưng không khớp luật nào. Phải NHẢ cử chỉ cũ. */
  | "unknown-observed"
  /** Không đủ điều kiện đo (landmark hỏng/thiếu). Được giữ nhãn cũ tạm thời. */
  | "unknown-low-quality";

export interface GestureClassification {
  label: GestureObservationLabel;
  /** Mức thoả luật của lớp thắng, 0–1. */
  classScore: number;
  /** Cách biệt giữa lớp thắng và lớp nhì — thấp nghĩa là hai tư thế đang cạnh tranh. */
  separationMargin: number;
  /** Chất lượng quan sát đầu vào. */
  observabilityQuality: number;
  /** Kết hợp ba giá trị trên; temporal dùng để quyết định có promote nhãn không. */
  confidence: number;
}

/**
 * Ngưỡng curl theo TỪNG NGÓN — chưa khoá, chỉnh theo mô tả khi test webcam.
 *
 * Vì sao không dùng chung một ngưỡng: ngón út và ngón áp út khi "duỗi" tự nhiên vẫn cong hơn ngón
 * trỏ, và khi nắm thì chúng cuộn sâu hơn. Dùng một ngưỡng chung sẽ khiến hoặc ngón út luôn bị coi
 * là co, hoặc ngón trỏ không bao giờ đạt ngưỡng co.
 */
export interface FingerCurlThresholds {
  /** Trên mức này coi là CO. */
  curled: number;
  /** Dưới mức này coi là DUỖI. Khoảng giữa hai ngưỡng là vùng trung gian, không kết luận. */
  extended: number;
}

export interface GestureClassifierConfig {
  index: FingerCurlThresholds;
  middle: FingerCurlThresholds;
  ring: FingerCurlThresholds;
  little: FingerCurlThresholds;
  /** Ngưỡng co/duỗi của ngón cái — chỉ dùng cho `thumbsUp`. */
  thumb: FingerCurlThresholds;
  /**
   * `upwardness` tối thiểu để được xét là `thumbsUp`. 0 = ngang, 1 = thẳng đứng lên.
   *
   * Đặt dương hẳn (không phải 0) để ngón cái chĩa NGANG dứt khoát không đạt — `thumbSide` phải bị
   * loại, đó là một trong hai bẫy chính của §5.
   */
  thumbUpMinUpwardness: number;
  /** `upwardness` đạt mức này thì coi như chĩa lên hoàn toàn. */
  thumbUpFullUpwardness: number;
  /**
   * Hysteresis: khi ĐANG ở `thumbsUp`, ngưỡng tụt xuống mức này trước khi nhả.
   *
   * Giơ like tự nhiên, ngón cái dao động quanh 35–50° chứ không đứng yên. Dùng chung một ngưỡng
   * cho cả vào lẫn ra khiến nhãn bật/tắt liên tục mỗi khi tay rung nhẹ qua mốc — nghiệm thu
   * webcam #6 gọi đây là "lúc like được lúc bị cụp xuống".
   */
  thumbUpReleaseUpwardness: number;
  /** Số ngón thường tối thiểu đo được thì mới dám phân loại. */
  minValidFingers: number;
}

/**
 * Giá trị khởi tạo theo suy luận (chưa qua webcam):
 * - `curled` ~0.55: trên trung điểm, để tư thế nửa vời không bị nhận nhầm là nắm.
 * - `extended` ~0.3: dưới mức này khá chắc là đang duỗi.
 * - Ngón út/áp út nới lỏng hơn vì chúng cong sẵn khi thả tự nhiên.
 */
export const DEFAULT_GESTURE_CLASSIFIER_CONFIG: GestureClassifierConfig = {
  index: { curled: 0.55, extended: 0.3 },
  middle: { curled: 0.55, extended: 0.3 },
  ring: { curled: 0.5, extended: 0.32 },
  little: { curled: 0.45, extended: 0.34 },
  // Ngón cái nới lỏng hơn: biên độ khớp nhỏ hơn nên cùng một mức "co" cho giá trị curl thấp hơn.
  thumb: { curled: 0.45, extended: 0.3 },
  // 0.20 ≈ 11.5° trên phương ngang. Giơ like tự nhiên hiếm khi dựng ngón cái quá 45°, nên ngưỡng
  // cũ 0.35 (≈20°, và cần tới ~40° mới đạt điểm 0.5) làm cử chỉ chập chờn.
  thumbUpMinUpwardness: 0.2,
  thumbUpFullUpwardness: 0.5,
  // Nhả ở ~2.3°: đã nhận rồi thì giữ tới khi ngón cái thực sự về NGANG hoặc chúc xuống. Đặt sát 0
  // vì `thumbSide` (ngang dứt khoát, upwardness ≈ 0) vẫn phải nhả được — chỉ dao động vài độ khi
  // đang giơ like mới được bỏ qua.
  thumbUpReleaseUpwardness: 0.04,
  minValidFingers: 4,
};

/**
 * Mức "ngón này co tới đâu" chuẩn hoá theo ngưỡng riêng của chính nó.
 *
 * Trả 0 khi ở/dưới ngưỡng duỗi, 1 khi ở/trên ngưỡng co, nội suy tuyến tính ở giữa. Nhờ vậy các
 * ngón có ngưỡng khác nhau vẫn so sánh và cộng điểm được với nhau.
 */
function curledScore(curl: number, thresholds: FingerCurlThresholds): number {
  const span = thresholds.curled - thresholds.extended;
  if (span <= 0) return curl >= thresholds.curled ? 1 : 0;
  return Math.max(0, Math.min(1, (curl - thresholds.extended) / span));
}

export interface GestureClassifierInput {
  features: HandFingerFeatures;
  /** Chất lượng quan sát từ palm basis; thấp nghĩa là hình học bàn tay không đáng tin. */
  observabilityQuality: number;
  /**
   * Nhãn đang phát ra avatar, dùng cho hysteresis hướng ngón cái. Bỏ trống thì mọi ngưỡng đều
   * dùng mức "vào" — an toàn nhưng chập chờn hơn ở vùng ranh giới.
   */
  activePose?: GesturePoseLabel;
}

/**
 * Điểm của lớp `fist`: cả bốn ngón thường phải co.
 *
 * Dùng ngón CO ÍT NHẤT làm điểm của lớp thay vì trung bình. Trung bình cho phép ba ngón cuộn chặt
 * bù cho một ngón duỗi thẳng — đó chính là tư thế `point`, và nếu tính trung bình thì `point` sẽ
 * ra điểm `fist` khá cao. Lấy min buộc MỌI ngón phải thoả, đúng định nghĩa nắm đấm.
 */
function thresholdsFor(
  finger: FingerCurlFeatures["finger"],
  config: GestureClassifierConfig,
): FingerCurlThresholds | null {
  switch (finger) {
    case "index": return config.index;
    case "middle": return config.middle;
    case "ring": return config.ring;
    case "little": return config.little;
    default: return null; // ngón cái xử lý riêng từ Bước 4
  }
}

function scoreFist(input: GestureClassifierInput, config: GestureClassifierConfig): number {
  const scores: number[] = [];
  for (const finger of input.features.fingers) {
    const thresholds = thresholdsFor(finger.finger, config);
    if (!thresholds) continue;
    if (!finger.valid) return 0;
    scores.push(curledScore(finger.combinedCurl, thresholds));
  }
  if (scores.length === 0) return 0;
  return Math.min(...scores);
}

/**
 * Điểm của lớp `open`: cả bốn ngón thường phải duỗi.
 *
 * Đối cực của `fist`, và cũng lấy `min` vì cùng lý do — ba ngón duỗi thẳng không được bù cho một
 * ngón đang co. Nếu lấy trung bình, tư thế `point` (một ngón trỏ duỗi, ba ngón co) sẽ có điểm
 * `open` không nhỏ, và ở Bước 3 sẽ tranh chấp với chính `point`.
 *
 * Ngón cái CỐ Ý không tham gia (§3.3 của plan: "`open` không đòi ngón cái hoàn hảo"). Khi xoè
 * tay, ngón cái có thể duỗi thẳng, hơi khép, hay chĩa ngang tuỳ người và tuỳ góc nhìn — bắt nó
 * phải duỗi chuẩn sẽ làm `open` khó đạt một cách vô lý.
 */
function scoreOpen(input: GestureClassifierInput, config: GestureClassifierConfig): number {
  const scores: number[] = [];
  for (const finger of input.features.fingers) {
    const thresholds = thresholdsFor(finger.finger, config);
    if (!thresholds) continue;
    if (!finger.valid) return 0;
    // Nghịch đảo của `curledScore`: 1 khi duỗi hết, 0 khi đã co tới ngưỡng.
    scores.push(1 - curledScore(finger.combinedCurl, thresholds));
  }
  if (scores.length === 0) return 0;
  return Math.min(...scores);
}

/**
 * Điểm của lớp `point`: ngón trỏ duỗi, ba ngón còn lại co. Ngón cái là **wildcard** (§3.3).
 *
 * Vì sao ngón cái không xét: khi chỉ tay, ngón cái có thể áp sát các ngón đang co, chĩa lên trên,
 * hoặc duỗi sang ngang — cả ba đều là "chỉ tay" với người xem. Bắt nó vào một tư thế cố định sẽ
 * làm `point` khó đạt.
 *
 * Điểm lớp = min(độ duỗi của trỏ, độ co của từng ngón còn lại). Lấy `min` để MỌI điều kiện đều
 * phải thoả: ngón trỏ duỗi mà ngón giữa cũng duỗi thì đó là `peace`, không phải `point`.
 */
function scorePoint(input: GestureClassifierInput, config: GestureClassifierConfig): number {
  let indexExtended: number | null = null;
  const othersCurled: number[] = [];
  for (const finger of input.features.fingers) {
    const thresholds = thresholdsFor(finger.finger, config);
    if (!thresholds) continue;
    if (!finger.valid) return 0;
    if (finger.finger === "index") indexExtended = 1 - curledScore(finger.combinedCurl, thresholds);
    else othersCurled.push(curledScore(finger.combinedCurl, thresholds));
  }
  if (indexExtended === null || othersCurled.length === 0) return 0;
  return Math.min(indexExtended, ...othersCurled);
}

/**
 * Điểm của lớp `thumbsUp`: bốn ngón co + ngón cái duỗi + **ngón cái chĩa lên trong ảnh**.
 *
 * Điều kiện hướng là thứ phân biệt `thumbsUp` với `thumbSide`/`thumbDown` — ba tư thế có hình
 * dạng bàn tay GIỐNG HỆT nhau. Bỏ điều kiện này chính là lỗi lớn nhất của plan v1: khi đó
 * `thumbsUp` thực chất chỉ có nghĩa "ngón cái duỗi", và chúc ngón cái xuống vẫn ra `thumbsUp`.
 *
 * Không đo được hướng (thiếu image landmark, hoặc ngón cái gập sát nên hình chiếu quá ngắn) →
 * trả 0. Thà bỏ sót còn hơn khẳng định sai: `thumbsUp` mang nghĩa tán thành, nhận nhầm khi người
 * dùng đang chúc ngón cái xuống là lỗi có hậu quả xã hội, không chỉ là lỗi hiển thị.
 */
function scoreThumbDirected(
  input: GestureClassifierInput,
  config: GestureClassifierConfig,
  /** +1 cho `thumbsUp`, −1 cho `thumbsDown`. Nhân vào `upwardness` để dùng chung một công thức. */
  sign: 1 | -1,
): number {
  const thumb = input.features.thumb;
  if (!thumb || !thumb.valid) return 0;

  // Bốn ngón thường phải co — dùng lại đúng điểm của `fist`.
  const fingersCurled = scoreFist(input, config);
  if (fingersCurled <= 0) return 0;

  // Ngón cái phải duỗi (flexion thấp).
  const thumbExtended = 1 - Math.max(0, Math.min(1,
    (thumb.flexion - config.thumb.extended) / Math.max(1e-6, config.thumb.curled - config.thumb.extended),
  ));
  if (thumbExtended <= 0) return 0;

  // Hướng: `upwardness` = 1 khi thẳng đứng lên, 0 khi ngang, −1 khi thẳng xuống. Nhân `sign` để
  // `thumbsDown` dùng đúng công thức này với trục đảo ngược.
  //
  // Hysteresis: đang ở CHÍNH nhãn này thì dùng ngưỡng nhả (thấp hơn) — ngón cái dao động vài độ
  // quanh mốc không được làm cử chỉ bật/tắt liên tục.
  //
  // Phải dịch CẢ HAI đầu của khoảng nội suy, không chỉ đầu dưới. Nếu chỉ hạ `min` mà giữ nguyên
  // `full`, khoảng giãn rộng ra và điểm tại vùng ranh giới lại TỤT xuống dưới 0.5 — hysteresis
  // mất tác dụng đúng ở chỗ nó cần hoạt động.
  const holding = input.activePose === (sign === 1 ? "thumbsUp" : "thumbsDown");
  const minUpwardness = holding ? config.thumbUpReleaseUpwardness : config.thumbUpMinUpwardness;
  const fullUpwardness = holding
    ? config.thumbUpReleaseUpwardness + (config.thumbUpFullUpwardness - config.thumbUpMinUpwardness)
    : config.thumbUpFullUpwardness;
  const directedUpwardness = thumb.upwardness * sign;
  const aligned = Math.max(0, Math.min(1,
    (directedUpwardness - minUpwardness) / Math.max(1e-6, fullUpwardness - minUpwardness),
  ));
  if (aligned <= 0) return 0;

  return Math.min(fingersCurled, thumbExtended, aligned);
}

export function classifyGesture(
  input: GestureClassifierInput,
  config: GestureClassifierConfig = DEFAULT_GESTURE_CLASSIFIER_CONFIG,
): GestureClassification {
  const lowQuality: GestureClassification = {
    label: "unknown-low-quality", classScore: 0, separationMargin: 0,
    observabilityQuality: input.observabilityQuality, confidence: 0,
  };
  if (input.features.validFingerCount < config.minValidFingers) return lowQuality;
  if (!Number.isFinite(input.observabilityQuality) || input.observabilityQuality <= 0) return lowQuality;

  const candidates: Array<{ label: GesturePoseLabel; score: number }> = [
    { label: "fist", score: scoreFist(input, config) },
    { label: "open", score: scoreOpen(input, config) },
    { label: "point", score: scorePoint(input, config) },
    { label: "thumbsUp", score: scoreThumbDirected(input, config, 1) },
    { label: "thumbsDown", score: scoreThumbDirected(input, config, -1) },
  ];
  // `thumbsUp` là trường hợp ĐẶC BIỆT HÓA của `fist` (bốn ngón co + thêm điều kiện ngón cái), nên
  // điểm của nó không bao giờ vượt `fist`. Sắp xếp thuần theo điểm sẽ để `fist` luôn thắng và
  // `thumbsUp` không bao giờ xuất hiện. Ưu tiên lớp đặc biệt hơn khi nó đã đạt ngưỡng.
  //
  // Ngưỡng loại cũng theo hysteresis: đang giữ `thumbsUp` thì chỉ cần điểm DƯƠNG (tức hướng ngón
  // cái còn trên mức nhả) là đủ để `fist` không cướp nhãn. Dùng cứng 0.5 cho cả hai chiều sẽ vô
  // hiệu hoá hysteresis ở đúng vùng ranh giới mà nó sinh ra để bảo vệ.
  const directedThumbScore = Math.max(
    candidates.find((candidate) => candidate.label === "thumbsUp")!.score,
    candidates.find((candidate) => candidate.label === "thumbsDown")!.score,
  );
  const holdingDirectedThumb = input.activePose === "thumbsUp" || input.activePose === "thumbsDown";
  const admissionScore = holdingDirectedThumb ? Number.MIN_VALUE : 0.5;
  if (directedThumbScore >= admissionScore) {
    const fistIndex = candidates.findIndex((candidate) => candidate.label === "fist");
    if (fistIndex >= 0) candidates.splice(fistIndex, 1);
  }

  // Ngón cái ĐANG DUỖI nhưng KHÔNG chĩa lên: `thumbSide`/`thumbDown`.
  //
  // Nghiệm thu webcam #5 cho thấy đây là ca phải xử lý riêng, không thể để lớp khác "thắng thay".
  // Khi người dùng xoay ngón cái từ trên xuống, `thumbsUp` tụt về 0 nhưng `fist` cũng thường
  // KHÔNG đạt ngưỡng — vì nắm tay lúc chỉ-để-giơ-ngón-cái bao giờ cũng lỏng hơn nắm đấm thật.
  // Không lớp nào thắng ⇒ nhãn cũ `thumbsUp` được giữ nguyên, và avatar vẫn giơ ngón cái trong
  // khi người dùng đang chúc xuống — đúng lỗi nghiêm trọng nhất mà plan cảnh báo.
  //
  // Trả `unknown-observed` để temporal BẮT BUỘC nhả nhãn cũ. Đây là kết luận đúng về mặt ngữ
  // nghĩa: bàn tay nhìn rõ, nhưng tư thế không thuộc bốn nhãn được hỗ trợ.
  // Dùng cùng ngưỡng hysteresis với `scoreThumbsUp`: nếu ở đây vẫn so với ngưỡng "vào" thì mỗi
  // lần ngón cái tụt nhẹ dưới mốc sẽ bị ép `unknown-observed`, triệt tiêu toàn bộ tác dụng của
  // hysteresis vừa thêm.
  const thumb = input.features.thumb;
  const releaseUpwardness = holdingDirectedThumb
    ? config.thumbUpReleaseUpwardness
    : config.thumbUpMinUpwardness;
  // Ngón cái duỗi nhưng NẰM NGANG — không lên cũng không xuống. Từ khi có `thumbsDown`, chỉ vùng
  // ngang mới là "không thuộc nhãn nào"; chúc xuống đã trở thành một nhãn hợp lệ.
  const thumbExtendedButSideways = Boolean(
    thumb?.valid
    && thumb.flexion <= config.thumb.extended
    && Math.abs(thumb.upwardness) < releaseUpwardness,
  );

  candidates.sort((a, b) => b.score - a.score);
  const winner = candidates[0];
  const runnerUpScore = candidates[1]?.score ?? 0;

  // Ngón cái duỗi nhưng nằm ngang: buộc nhả nhãn cũ, kể cả khi có lớp khác vừa đủ thắng. Không
  // được để `thumbsUp`/`thumbsDown` sống sót nhờ quán tính khi hướng đã về ngang.
  if (thumbExtendedButSideways && winner.label !== "open" && winner.label !== "point") {
    return {
      label: "unknown-observed", classScore: winner.score, separationMargin: 0,
      observabilityQuality: input.observabilityQuality, confidence: 0,
    };
  }

  // Chưa đủ thuyết phục thì KHÔNG ép về một nhãn nào. `unknown-observed` là kết luận hợp lệ và
  // quan trọng: nó buộc temporal nhả cử chỉ cũ thay vì giữ mãi một tư thế sai.
  //
  // Ngoại lệ duy nhất: đang giữ `thumbsUp` và nó vẫn là lớp thắng với điểm dương. Hướng ngón cái
  // đã được kiểm bằng ngưỡng nhả riêng ở trên, nên điểm thấp ở đây chỉ phản ánh ngón cái hơi
  // chếch — không phải bằng chứng tư thế đã đổi.
  const holdingSameDirectedThumb = holdingDirectedThumb && winner.label === input.activePose && winner.score > 0;
  if (winner.score < 0.5 && !holdingSameDirectedThumb) {
    return {
      label: "unknown-observed", classScore: winner.score, separationMargin: 0,
      observabilityQuality: input.observabilityQuality,
      confidence: 0,
    };
  }

  const separationMargin = winner.score - runnerUpScore;
  return {
    label: winner.label,
    classScore: winner.score,
    separationMargin,
    observabilityQuality: input.observabilityQuality,
    // Ba yếu tố nhân nhau: luật thoả tới đâu × quan sát tin tới đâu × hai lớp có tách bạch không.
    //
    // Từ Bước 2 trở đi `separationMargin` mới có ý nghĩa thật (trước đó chỉ có một lớp nên nó
    // luôn bằng classScore). Nó bảo vệ vùng ranh giới: một bàn tay nửa co nửa duỗi có thể đạt
    // điểm `open` và `fist` xấp xỉ nhau — lúc đó confidence phải TỤT để temporal không promote
    // vội, thay vì chọn bừa lớp nhỉnh hơn vài phần trăm rồi nhấp nháy qua lại.
    //
    // Sàn 0.5 để margin nhỏ chỉ làm chậm promotion chứ không triệt tiêu hẳn nhãn.
    confidence: Math.max(0, Math.min(1,
      winner.score * input.observabilityQuality * (0.5 + 0.5 * Math.min(1, separationMargin * 2)),
    )),
  };
}
