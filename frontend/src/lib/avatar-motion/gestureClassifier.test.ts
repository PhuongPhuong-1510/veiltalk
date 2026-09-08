import { describe, expect, it } from "vitest";
import { classifyGesture, DEFAULT_GESTURE_CLASSIFIER_CONFIG } from "./gestureClassifier";
import type { FingerCurlFeatures, HandFingerFeatures } from "./fingerFeatures";
import { REGULAR_FINGERS } from "./fingerFeatures";

function features(
  curls: Partial<Record<string, number>>,
  options: { valid?: boolean; thumb?: { flexion: number; upwardness: number; valid?: boolean } | null } = {},
): HandFingerFeatures {
  const fingers: FingerCurlFeatures[] = REGULAR_FINGERS.map((finger) => ({
    finger,
    mcpFlexion: 0, pipFlexion: 0, dipFlexion: 0, chordCurl: 0,
    combinedCurl: curls[finger] ?? 0,
    valid: options.valid ?? true,
  }));
  const thumb = options.thumb === undefined || options.thumb === null ? null : {
    flexion: options.thumb.flexion,
    // `upwardness` là thành phần y đã chuẩn hoá; dựng vector khớp với nó để hai giá trị nhất quán.
    directionInImage: {
      x: Math.sqrt(Math.max(0, 1 - options.thumb.upwardness ** 2)),
      y: options.thumb.upwardness,
    },
    upwardness: options.thumb.upwardness,
    valid: options.thumb.valid ?? true,
  };
  return { fingers, validFingerCount: fingers.filter((finger) => finger.valid).length, thumb };
}

const allCurled = { index: 0.85, middle: 0.85, ring: 0.8, little: 0.75 };
const allExtended = { index: 0.05, middle: 0.05, ring: 0.08, little: 0.1 };

describe("gestureClassifier — nhận fist", () => {
  it("bốn ngón co rõ → fist", () => {
    const result = classifyGesture({ features: features(allCurled), observabilityQuality: 1 });
    expect(result.label).toBe("fist");
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it("bốn ngón duỗi → KHÔNG phải fist", () => {
    const result = classifyGesture({ features: features(allExtended), observabilityQuality: 1 });
    expect(result.label).not.toBe("fist");
  });

  it("ba ngón co nhưng ngón trỏ duỗi (tư thế chỉ tay) → KHÔNG phải fist", () => {
    // Đây là ca then chốt: nếu điểm lớp tính bằng TRUNG BÌNH thì ba ngón cuộn chặt sẽ bù cho ngón
    // trỏ duỗi và cho ra fist. Lấy min buộc mọi ngón phải thoả.
    const result = classifyGesture({
      features: features({ ...allCurled, index: 0.05 }),
      observabilityQuality: 1,
    });
    expect(result.label).not.toBe("fist");
  });

  it("một ngón út duỗi cũng đủ để không phải fist", () => {
    const result = classifyGesture({
      features: features({ ...allCurled, little: 0.1 }),
      observabilityQuality: 1,
    });
    expect(result.label).not.toBe("fist");
  });

  it("tư thế nửa vời (curl quanh vùng trung gian) → unknown-observed, không ép thành fist", () => {
    const result = classifyGesture({
      features: features({ index: 0.4, middle: 0.4, ring: 0.4, little: 0.4 }),
      observabilityQuality: 1,
    });
    expect(result.label).toBe("unknown-observed");
  });
});

describe("gestureClassifier — nhận open", () => {
  it("bốn ngón duỗi rõ → open", () => {
    const result = classifyGesture({ features: features(allExtended), observabilityQuality: 1 });
    expect(result.label).toBe("open");
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it("nắm đấm → fist, KHÔNG phải open", () => {
    const result = classifyGesture({ features: features(allCurled), observabilityQuality: 1 });
    expect(result.label).toBe("fist");
  });

  it("ba ngón duỗi nhưng một ngón co → KHÔNG phải open", () => {
    // Cùng lý do lấy `min` như `fist`: ba ngón duỗi không được bù cho một ngón đang co, nếu không
    // thì `point` (một ngón duỗi, ba ngón co) sẽ tranh chấp ở Bước 3.
    const result = classifyGesture({
      features: features({ ...allExtended, middle: 0.9 }),
      observabilityQuality: 1,
    });
    expect(result.label).not.toBe("open");
  });

  it("open KHÔNG đòi ngón cái — chỉ xét bốn ngón thường", () => {
    // §3.3 của plan: ngón cái khi xoè tay có thể duỗi, khép hoặc chĩa ngang tuỳ người và góc nhìn.
    // `features()` chỉ dựng bốn ngón thường; nếu classifier đòi ngón cái thì test này sẽ đỏ.
    const result = classifyGesture({ features: features(allExtended), observabilityQuality: 1 });
    expect(result.label).toBe("open");
  });

  it("open và fist là hai đầu đối cực — không lớp nào thắng ở giữa", () => {
    const middle = classifyGesture({
      features: features({ index: 0.42, middle: 0.42, ring: 0.41, little: 0.4 }),
      observabilityQuality: 1,
    });
    expect(middle.label).toBe("unknown-observed");
  });
});

describe("gestureClassifier — nhận point", () => {
  const pointing = { index: 0.05, middle: 0.85, ring: 0.85, little: 0.8 };

  it("trỏ duỗi + ba ngón co → point", () => {
    const result = classifyGesture({ features: features(pointing), observabilityQuality: 1 });
    expect(result.label).toBe("point");
  });

  it("point KHÔNG bị nhận thành fist", () => {
    // Ca then chốt của Bước 1: ba ngón cuộn chặt không được kéo tư thế này thành nắm đấm.
    const result = classifyGesture({ features: features(pointing), observabilityQuality: 1 });
    expect(result.label).not.toBe("fist");
  });

  it("point KHÔNG bị nhận thành open", () => {
    const result = classifyGesture({ features: features(pointing), observabilityQuality: 1 });
    expect(result.label).not.toBe("open");
  });

  it("nắm đấm KHÔNG bị nhận thành point", () => {
    const result = classifyGesture({ features: features(allCurled), observabilityQuality: 1 });
    expect(result.label).toBe("fist");
  });

  it("peace (trỏ + giữa cùng duỗi) KHÔNG phải point", () => {
    // Đây là lý do `scorePoint` lấy min chứ không chỉ xét ngón trỏ: ngón giữa duỗi phải triệt
    // tiêu điểm point. `peace` nằm ngoài phạm vi 4 nhãn nên phải rơi vào unknown-observed.
    const result = classifyGesture({
      features: features({ index: 0.05, middle: 0.05, ring: 0.85, little: 0.8 }),
      observabilityQuality: 1,
    });
    expect(result.label).not.toBe("point");
    expect(result.label).toBe("unknown-observed");
  });

  it("point cho phép ngón cái ở BẤT KỲ tư thế nào (wildcard)", () => {
    // `features()` chỉ dựng bốn ngón thường; classifier không được đòi hỏi gì ở ngón cái.
    const result = classifyGesture({ features: features(pointing), observabilityQuality: 1 });
    expect(result.label).toBe("point");
    expect(result.confidence).toBeGreaterThan(0.7);
  });

  it("chỉ ngón út duỗi (không phải trỏ) KHÔNG ra point", () => {
    const result = classifyGesture({
      features: features({ index: 0.85, middle: 0.85, ring: 0.85, little: 0.05 }),
      observabilityQuality: 1,
    });
    expect(result.label).not.toBe("point");
  });
});

describe("gestureClassifier — nhận thumbsUp", () => {
  const thumbUp = { flexion: 0.05, upwardness: 0.95 };

  it("bốn ngón co + ngón cái duỗi chĩa LÊN → thumbsUp", () => {
    const result = classifyGesture({
      features: features(allCurled, { thumb: thumbUp }),
      observabilityQuality: 1,
    });
    expect(result.label).toBe("thumbsUp");
  });

  it("ngón cái chĩa NGANG → KHÔNG phải thumbsUp", () => {
    // Bẫy #1 của §5. `thumbSide` có hình dạng bàn tay GIỐNG HỆT thumbsUp, chỉ khác hướng.
    const result = classifyGesture({
      features: features(allCurled, { thumb: { flexion: 0.05, upwardness: 0.02 } }),
      observabilityQuality: 1,
    });
    expect(result.label).not.toBe("thumbsUp");
  });

  it("ngón cái chĩa XUỐNG → KHÔNG phải thumbsUp", () => {
    // Bẫy #2 của §5, và là lỗi lớn nhất của plan v1. Nhận nhầm chúc ngón cái xuống thành tán
    // thành là lỗi có hậu quả xã hội, không chỉ là lỗi hiển thị.
    const result = classifyGesture({
      features: features(allCurled, { thumb: { flexion: 0.05, upwardness: -0.95 } }),
      observabilityQuality: 1,
    });
    expect(result.label).not.toBe("thumbsUp");
  });

  it("ngón cái chếch nhẹ vẫn được chấp nhận", () => {
    // Người thật hiếm khi giơ ngón cái thẳng đứng hoàn hảo.
    const result = classifyGesture({
      features: features(allCurled, { thumb: { flexion: 0.08, upwardness: 0.72 } }),
      observabilityQuality: 1,
    });
    expect(result.label).toBe("thumbsUp");
  });

  it("ngón cái CO (dù chĩa lên) → fist, không phải thumbsUp", () => {
    const result = classifyGesture({
      features: features(allCurled, { thumb: { flexion: 0.9, upwardness: 0.95 } }),
      observabilityQuality: 1,
    });
    expect(result.label).toBe("fist");
  });

  it("KHÔNG đo được hướng ngón cái → lùi về fist, không đoán bừa thumbsUp", () => {
    const result = classifyGesture({
      features: features(allCurled, { thumb: null }),
      observabilityQuality: 1,
    });
    expect(result.label).toBe("fist");
  });

  it("thumb.valid = false → không ra thumbsUp", () => {
    const result = classifyGesture({
      features: features(allCurled, { thumb: { flexion: 0.05, upwardness: 0.95, valid: false } }),
      observabilityQuality: 1,
    });
    expect(result.label).not.toBe("thumbsUp");
  });

  it("thumbsUp thắng fist dù điểm không cao hơn", () => {
    // `thumbsUp` là đặc biệt hoá của `fist` (bốn ngón co + thêm điều kiện), nên điểm nó KHÔNG BAO
    // GIỜ vượt fist. Sắp xếp thuần theo điểm sẽ để fist luôn thắng và thumbsUp không bao giờ hiện.
    const result = classifyGesture({
      features: features(allCurled, { thumb: thumbUp }),
      observabilityQuality: 1,
    });
    expect(result.label).toBe("thumbsUp");
  });

  it("ngón cái duỗi chĩa XUỐNG + nắm tay LỎNG → thumbsDown, KHÔNG kẹt ở thumbsUp", () => {
    // Nghiệm thu webcam #5: đây là ca làm avatar kẹt ở thumbsUp khi người dùng đã chúc xuống.
    // Nắm tay lúc chỉ-để-giơ-ngón-cái bao giờ cũng lỏng hơn nắm đấm thật, nên `fist` KHÔNG đạt
    // ngưỡng để thắng thay.
    //
    // Từ khi có nhãn `thumbsDown` (nghiệm thu #8), ca này ra đúng nhãn của nó thay vì
    // `unknown-observed`. Điều bất biến vẫn giữ nguyên: KHÔNG được kẹt ở `thumbsUp`.
    const loose = { index: 0.5, middle: 0.5, ring: 0.46, little: 0.42 };
    const result = classifyGesture({
      features: features(loose, { thumb: { flexion: 0.05, upwardness: -0.9 } }),
      observabilityQuality: 1,
      activePose: "thumbsUp",
    });
    expect(result.label).toBe("thumbsDown");
    expect(result.label).not.toBe("thumbsUp");
  });

  it("ngón cái duỗi chĩa NGANG + nắm tay lỏng → unknown-observed", () => {
    const loose = { index: 0.5, middle: 0.5, ring: 0.46, little: 0.42 };
    const result = classifyGesture({
      features: features(loose, { thumb: { flexion: 0.05, upwardness: 0.05 } }),
      observabilityQuality: 1,
    });
    expect(result.label).toBe("unknown-observed");
  });

  it("ngón cái duỗi chĩa xuống nhưng bốn ngón XOÈ → vẫn là open", () => {
    // Cờ "duỗi nhưng không chĩa lên" KHÔNG được phá `open`: xoè tay thì ngón cái duỗi là bình
    // thường và hướng của nó không mang ý nghĩa gì.
    const result = classifyGesture({
      features: features(allExtended, { thumb: { flexion: 0.05, upwardness: -0.5 } }),
      observabilityQuality: 1,
    });
    expect(result.label).toBe("open");
  });

  it("chỉ tay với ngón cái duỗi ngang → vẫn là point", () => {
    const result = classifyGesture({
      features: features({ index: 0.05, middle: 0.85, ring: 0.85, little: 0.8 },
        { thumb: { flexion: 0.05, upwardness: 0 } }),
      observabilityQuality: 1,
    });
    expect(result.label).toBe("point");
  });

  it("giơ like tự nhiên ~30° đã đủ nhận — không đòi dựng đứng", () => {
    // Nghiệm thu webcam #6: ngưỡng cũ cần ~40° mới đạt điểm 0.5, trong khi giơ like tự nhiên ngón
    // cái thường chỉ 30–45° và dao động quanh mốc đó ⇒ nhãn bật/tắt liên tục.
    const result = classifyGesture({
      features: features(allCurled, { thumb: { flexion: 0.05, upwardness: Math.sin(30 * Math.PI / 180) } }),
      observabilityQuality: 1,
    });
    expect(result.label).toBe("thumbsUp");
  });

  it("HYSTERESIS: đang thumbsUp thì ngón cái tụt nhẹ vẫn GIỮ nhãn", () => {
    const wobble = { flexion: 0.05, upwardness: 0.15 };
    // Chưa ở thumbsUp: mức này chưa đủ để VÀO.
    const entering = classifyGesture({
      features: features(allCurled, { thumb: wobble }),
      observabilityQuality: 1,
    });
    expect(entering.label).not.toBe("thumbsUp");
    // Đang ở thumbsUp: cùng mức đó vẫn GIỮ được.
    const holding = classifyGesture({
      features: features(allCurled, { thumb: wobble }),
      observabilityQuality: 1,
      activePose: "thumbsUp",
    });
    expect(holding.label).toBe("thumbsUp");
  });

  it("HYSTERESIS không cứu được ngón cái chĩa XUỐNG", () => {
    // Giữ nhãn khi rung nhẹ là đúng; giữ nhãn khi người dùng đã chúc xuống là lỗi nghiêm trọng.
    const result = classifyGesture({
      features: features(allCurled, { thumb: { flexion: 0.05, upwardness: -0.5 } }),
      observabilityQuality: 1,
      activePose: "thumbsUp",
    });
    expect(result.label).not.toBe("thumbsUp");
  });

  it("HYSTERESIS không cứu được ngón cái chĩa NGANG dứt khoát", () => {
    const result = classifyGesture({
      features: features(allCurled, { thumb: { flexion: 0.05, upwardness: 0 } }),
      observabilityQuality: 1,
      activePose: "thumbsUp",
    });
    expect(result.label).not.toBe("thumbsUp");
  });

  it("ngưỡng nhả phải THẤP HƠN ngưỡng vào", () => {
    expect(DEFAULT_GESTURE_CLASSIFIER_CONFIG.thumbUpReleaseUpwardness)
      .toBeLessThan(DEFAULT_GESTURE_CLASSIFIER_CONFIG.thumbUpMinUpwardness);
  });

  it("xoè tay + ngón cái chĩa lên → open, không phải thumbsUp", () => {
    const result = classifyGesture({
      features: features(allExtended, { thumb: thumbUp }),
      observabilityQuality: 1,
    });
    expect(result.label).toBe("open");
  });
});

describe("gestureClassifier — nhận thumbsDown", () => {
  it("bốn ngón co + ngón cái duỗi chĩa XUỐNG → thumbsDown", () => {
    const result = classifyGesture({
      features: features(allCurled, { thumb: { flexion: 0.05, upwardness: -0.95 } }),
      observabilityQuality: 1,
    });
    expect(result.label).toBe("thumbsDown");
  });

  it("thumbsUp và thumbsDown KHÔNG lẫn nhau", () => {
    const up = classifyGesture({
      features: features(allCurled, { thumb: { flexion: 0.05, upwardness: 0.95 } }),
      observabilityQuality: 1,
    });
    const down = classifyGesture({
      features: features(allCurled, { thumb: { flexion: 0.05, upwardness: -0.95 } }),
      observabilityQuality: 1,
    });
    expect(up.label).toBe("thumbsUp");
    expect(down.label).toBe("thumbsDown");
  });

  it("ngón cái NGANG không ra thumbsDown", () => {
    const result = classifyGesture({
      features: features(allCurled, { thumb: { flexion: 0.05, upwardness: -0.02 } }),
      observabilityQuality: 1,
    });
    expect(result.label).not.toBe("thumbsDown");
    expect(result.label).not.toBe("thumbsUp");
  });

  it("đang thumbsDown mà xoay LÊN → chuyển sang thumbsUp, không kẹt", () => {
    const result = classifyGesture({
      features: features(allCurled, { thumb: { flexion: 0.05, upwardness: 0.95 } }),
      observabilityQuality: 1,
      activePose: "thumbsDown",
    });
    expect(result.label).toBe("thumbsUp");
  });

  it("đang thumbsDown mà về NGANG → nhả nhãn", () => {
    const result = classifyGesture({
      features: features(allCurled, { thumb: { flexion: 0.05, upwardness: 0 } }),
      observabilityQuality: 1,
      activePose: "thumbsDown",
    });
    expect(result.label).not.toBe("thumbsDown");
  });

  it("ngón cái CO chĩa xuống → fist, không phải thumbsDown", () => {
    const result = classifyGesture({
      features: features(allCurled, { thumb: { flexion: 0.9, upwardness: -0.95 } }),
      observabilityQuality: 1,
    });
    expect(result.label).toBe("fist");
  });

  it("HYSTERESIS áp cho thumbsDown như thumbsUp", () => {
    const wobble = { flexion: 0.05, upwardness: -0.15 };
    const entering = classifyGesture({
      features: features(allCurled, { thumb: wobble }), observabilityQuality: 1,
    });
    expect(entering.label).not.toBe("thumbsDown");
    const holding = classifyGesture({
      features: features(allCurled, { thumb: wobble }),
      observabilityQuality: 1, activePose: "thumbsDown",
    });
    expect(holding.label).toBe("thumbsDown");
  });
});

describe("gestureClassifier — separationMargin giữa open và fist", () => {
  it("tư thế rõ ràng cho margin cao", () => {
    const result = classifyGesture({ features: features(allCurled), observabilityQuality: 1 });
    expect(result.separationMargin).toBeGreaterThan(0.5);
  });

  it("vùng ranh giới làm TỤT confidence để temporal không promote vội", () => {
    // Bàn tay nửa co nửa duỗi có thể đạt điểm open và fist xấp xỉ nhau. Chọn bừa lớp nhỉnh hơn
    // vài phần trăm sẽ làm avatar nhấp nháy qua lại giữa nắm và xoè.
    const clear = classifyGesture({ features: features(allCurled), observabilityQuality: 1 });
    const borderline = classifyGesture({
      features: features({ index: 0.52, middle: 0.52, ring: 0.5, little: 0.46 }),
      observabilityQuality: 1,
    });
    if (borderline.label === "fist" || borderline.label === "open") {
      expect(borderline.confidence).toBeLessThan(clear.confidence);
    }
  });
});

describe("gestureClassifier — chất lượng quan sát", () => {
  it("landmark hỏng (validFingerCount thấp) → unknown-low-quality, KHÔNG phải unknown-observed", () => {
    // Phân biệt hai loại unknown là bắt buộc: low-quality được giữ nhãn cũ tạm thời, còn
    // observed thì phải nhả ngay.
    const result = classifyGesture({
      features: features(allCurled, { valid: false }),
      observabilityQuality: 1,
    });
    expect(result.label).toBe("unknown-low-quality");
  });

  it("observabilityQuality = 0 → unknown-low-quality", () => {
    const result = classifyGesture({ features: features(allCurled), observabilityQuality: 0 });
    expect(result.label).toBe("unknown-low-quality");
  });

  it("quan sát kém làm giảm confidence dù luật vẫn thoả", () => {
    const good = classifyGesture({ features: features(allCurled), observabilityQuality: 1 });
    const poor = classifyGesture({ features: features(allCurled), observabilityQuality: 0.4 });
    expect(poor.label).toBe("fist");
    expect(poor.confidence).toBeLessThan(good.confidence);
  });

  it("observabilityQuality NaN không lan ra confidence", () => {
    const result = classifyGesture({ features: features(allCurled), observabilityQuality: Number.NaN });
    expect(result.label).toBe("unknown-low-quality");
    expect(Number.isFinite(result.confidence)).toBe(true);
  });
});

describe("gestureClassifier — ngưỡng riêng từng ngón", () => {
  it("ngón út dùng ngưỡng thấp hơn ngón trỏ", () => {
    // Ngón út khi thả tự nhiên đã cong hơn ngón trỏ; ngưỡng chung sẽ làm nó luôn bị coi là co.
    expect(DEFAULT_GESTURE_CLASSIFIER_CONFIG.little.curled)
      .toBeLessThan(DEFAULT_GESTURE_CLASSIFIER_CONFIG.index.curled);
  });

  it("cùng một giá trị curl có thể là co với ngón út nhưng chưa với ngón trỏ", () => {
    const borderline = 0.48;
    const littleOnly = classifyGesture({
      features: features({ index: 0.9, middle: 0.9, ring: 0.9, little: borderline }),
      observabilityQuality: 1,
    });
    const indexOnly = classifyGesture({
      features: features({ index: borderline, middle: 0.9, ring: 0.9, little: 0.9 }),
      observabilityQuality: 1,
    });
    expect(littleOnly.classScore).toBeGreaterThan(indexOnly.classScore);
  });
});
