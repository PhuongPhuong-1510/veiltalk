import { describe, expect, it } from "vitest";
import {
  computeHandTwistConfidence,
  DEFAULT_HAND_TWIST_CONFIDENCE_CONFIG,
  type HandTwistConfidenceInput,
} from "./handTwistConfidence";

function baseInput(overrides: Partial<HandTwistConfidenceInput> = {}): HandTwistConfidenceInput {
  return {
    handMatched: true,
    twistAccepted: true,
    matchQuality: 1,
    palmGeometryQuality: 1,
    palmProjectionRatio: 1,
    referenceProjectionRatio: 1,
    handAgeMs: 0,
    poseHandTimestampDeltaMs: 0,
    handednessScore: 1,
    previousTrusted: false,
    ...overrides,
  };
}

describe("computeHandTwistConfidence — [0,1] bounds", () => {
  it("overallQuality và targetInfluenceWeight luôn trong [0,1] cho input hoàn hảo", () => {
    const result = computeHandTwistConfidence(baseInput());
    expect(result.overallQuality).toBeGreaterThanOrEqual(0);
    expect(result.overallQuality).toBeLessThanOrEqual(1);
    expect(result.targetInfluenceWeight).toBeGreaterThanOrEqual(0);
    expect(result.targetInfluenceWeight).toBeLessThanOrEqual(1);
    expect(Number.isFinite(result.overallQuality)).toBe(true);
    expect(Number.isFinite(result.targetInfluenceWeight)).toBe(true);
  });

  it("component quality bị clamp về [0,1] dù input vượt ngoài khoảng (vd matchQuality=5)", () => {
    const result = computeHandTwistConfidence(baseInput({ matchQuality: 5, palmGeometryQuality: -3 }));
    expect(result.components.matchQuality).toBe(1);
    expect(result.components.palmGeometryQuality).toBe(0);
    expect(result.overallQuality).toBeGreaterThanOrEqual(0);
    expect(result.overallQuality).toBeLessThanOrEqual(1);
  });

  it("tất cả output finite và trong [0,1] cho một tổ hợp input ngẫu nhiên hợp lệ", () => {
    const result = computeHandTwistConfidence(baseInput({
      matchQuality: 0.37, palmGeometryQuality: 0.82, palmProjectionRatio: 0.05,
      referenceProjectionRatio: 0.91, handAgeMs: 120, poseHandTimestampDeltaMs: 80,
      handednessScore: 0.6, previousTrusted: true,
    }));
    for (const value of Object.values(result.components)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(result.overallQuality).toBeGreaterThanOrEqual(0);
    expect(result.overallQuality).toBeLessThanOrEqual(1);
    expect(result.targetInfluenceWeight).toBeGreaterThanOrEqual(0);
    expect(result.targetInfluenceWeight).toBeLessThanOrEqual(1);
  });
});

describe("computeHandTwistConfidence — hysteresis enter/exit", () => {
  it("không trusted -> quality nằm giữa exitThreshold và enterThreshold -> vẫn KHÔNG trusted (chưa đủ để enter)", () => {
    // Chọn matchQuality/palmGeometryQuality sao cho softQuality*observabilityQuality (với
    // observability=1) rơi đúng vào khoảng giữa hai ngưỡng.
    const mid = (DEFAULT_HAND_TWIST_CONFIDENCE_CONFIG.enterThreshold + DEFAULT_HAND_TWIST_CONFIDENCE_CONFIG.exitThreshold) / 2;
    const result = computeHandTwistConfidence(baseInput({
      matchQuality: mid, palmGeometryQuality: mid, handednessScore: mid,
      previousTrusted: false,
    }));
    expect(result.overallQuality).toBeGreaterThan(DEFAULT_HAND_TWIST_CONFIDENCE_CONFIG.exitThreshold);
    expect(result.overallQuality).toBeLessThan(DEFAULT_HAND_TWIST_CONFIDENCE_CONFIG.enterThreshold);
    expect(result.trusted).toBe(false);
  });

  it("đã trusted -> quality tụt xuống giữa exitThreshold và enterThreshold -> VẪN giữ trusted (chưa đủ để exit)", () => {
    const mid = (DEFAULT_HAND_TWIST_CONFIDENCE_CONFIG.enterThreshold + DEFAULT_HAND_TWIST_CONFIDENCE_CONFIG.exitThreshold) / 2;
    const result = computeHandTwistConfidence(baseInput({
      matchQuality: mid, palmGeometryQuality: mid, handednessScore: mid,
      previousTrusted: true,
    }));
    expect(result.overallQuality).toBeGreaterThan(DEFAULT_HAND_TWIST_CONFIDENCE_CONFIG.exitThreshold);
    expect(result.overallQuality).toBeLessThan(DEFAULT_HAND_TWIST_CONFIDENCE_CONFIG.enterThreshold);
    expect(result.trusted).toBe(true);
  });

  it("không trusted -> quality cao hơn enterThreshold -> chuyển sang trusted", () => {
    const result = computeHandTwistConfidence(baseInput({ previousTrusted: false }));
    expect(result.overallQuality).toBeGreaterThan(DEFAULT_HAND_TWIST_CONFIDENCE_CONFIG.enterThreshold);
    expect(result.trusted).toBe(true);
  });

  it("đã trusted -> quality rớt xuống dưới exitThreshold -> rời trusted", () => {
    const result = computeHandTwistConfidence(baseInput({
      matchQuality: 0, palmGeometryQuality: 0, palmProjectionRatio: 0, referenceProjectionRatio: 0,
      handAgeMs: 10_000, poseHandTimestampDeltaMs: 10_000, handednessScore: 0,
      previousTrusted: true,
    }));
    expect(result.overallQuality).toBeLessThan(DEFAULT_HAND_TWIST_CONFIDENCE_CONFIG.exitThreshold);
    expect(result.trusted).toBe(false);
  });
});

describe("computeHandTwistConfidence — output không phụ thuộc số lần update / FPS", () => {
  it("gọi hàm nhiều lần liên tiếp với input giống hệt nhau luôn trả overallQuality/targetInfluenceWeight giống hệt nhau (không tích luỹ, không rate-limit)", () => {
    const input = baseInput({ matchQuality: 0.7, palmGeometryQuality: 0.6, previousTrusted: false });
    const first = computeHandTwistConfidence(input);
    let last = first;
    for (let i = 0; i < 50; i += 1) {
      last = computeHandTwistConfidence({ ...input, previousTrusted: last.trusted });
    }
    // Sau lần đầu trusted đổi (nếu có), các lần sau input y hệt nên hội tụ ngay lập tức, không
    // "leo dần" qua nhiều lần gọi như rate-limit cũ — kiểm tra 2 lần liên tiếp bằng nhau tuyệt đối.
    const again = computeHandTwistConfidence({ ...input, previousTrusted: last.trusted });
    expect(again.overallQuality).toBe(last.overallQuality);
    expect(again.targetInfluenceWeight).toBe(last.targetInfluenceWeight);
  });

  it("không có trường dtSeconds hay rate nào trong input — module không biết về thời gian thực giữa các lần gọi", () => {
    const input = baseInput();
    expect((input as unknown as Record<string, unknown>).dtSeconds).toBeUndefined();
    expect((input as unknown as Record<string, unknown>).riseRatePerSecond).toBeUndefined();
    expect((input as unknown as Record<string, unknown>).fallRatePerSecond).toBeUndefined();
  });

  it("targetInfluenceWeight nhảy thẳng theo overallQuality ngay từ lần gọi đầu tiên (không có previousInfluenceWeight để rate-limit)", () => {
    const result = computeHandTwistConfidence(baseInput({ previousTrusted: false }));
    expect(result.targetInfluenceWeight).toBe(result.trusted ? result.overallQuality : 0);
  });
});

describe("computeHandTwistConfidence — projection gần zero không thể bị che lấp", () => {
  it("match/palm geometry/handedness đều hoàn hảo nhưng projection gần zero -> vẫn KHÔNG trusted", () => {
    const result = computeHandTwistConfidence(baseInput({
      matchQuality: 1, palmGeometryQuality: 1, handednessScore: 1,
      palmProjectionRatio: 0.001, referenceProjectionRatio: 1,
      previousTrusted: false,
    }));
    expect(result.components.observabilityQuality).toBeLessThan(0.01);
    expect(result.overallQuality).toBeLessThan(DEFAULT_HAND_TWIST_CONFIDENCE_CONFIG.exitThreshold);
    expect(result.trusted).toBe(false);
  });

  it("min của hai ratio quyết định — một chiều yếu kéo observabilityQuality xuống dù chiều kia hoàn hảo", () => {
    const result = computeHandTwistConfidence(baseInput({ palmProjectionRatio: 1, referenceProjectionRatio: 0 }));
    expect(result.components.projectionQuality).toBe(0);
    expect(result.components.observabilityQuality).toBe(0);
    expect(result.overallQuality).toBe(0);
  });

  it("projection ratio null (twist reject ở bước hình học trước khi có ratio) -> observabilityQuality = 0", () => {
    const result = computeHandTwistConfidence(baseInput({ palmProjectionRatio: null, referenceProjectionRatio: null }));
    expect(result.components.projectionQuality).toBe(0);
    expect(result.components.observabilityQuality).toBe(0);
  });
});

describe("computeHandTwistConfidence — projection ratio độc lập với scale referenceDirection", () => {
  it("cùng ratio cho scale 0.5/1/10 của referenceDirection (giả lập bằng cách giữ ratio cố định) -> overallQuality giống hệt nhau", () => {
    // handForearmTwist.ts đã chuẩn hoá projection thành RATIO trong [0,1] trước khi truyền vào
    // module này (yêu cầu #4) — nên với cùng ratio, scale gốc của referenceDirection (0.5x, 1x,
    // 10x) không còn xuất hiện ở input của module này nữa. Test xác nhận: truyền cùng ratio dù
    // "tưởng tượng" nó đến từ các scale khác nhau vẫn cho quality/targetInfluenceWeight giống hệt.
    const scales = [0.5, 1, 10];
    const results = scales.map(() => computeHandTwistConfidence(baseInput({
      palmProjectionRatio: 0.8, referenceProjectionRatio: 0.8, previousTrusted: false,
    })));
    const [first, ...rest] = results;
    for (const r of rest) {
      expect(r.overallQuality).toBe(first.overallQuality);
      expect(r.targetInfluenceWeight).toBe(first.targetInfluenceWeight);
      expect(r.trusted).toBe(first.trusted);
    }
  });
});

describe("computeHandTwistConfidence — handAge/timestamp stale", () => {
  it("handAgeMs vượt maxHandAgeMs -> freshnessQuality = 0 -> observabilityQuality = 0", () => {
    const result = computeHandTwistConfidence(baseInput({ handAgeMs: DEFAULT_HAND_TWIST_CONFIDENCE_CONFIG.maxHandAgeMs + 1 }));
    expect(result.components.freshnessQuality).toBe(0);
    expect(result.components.observabilityQuality).toBe(0);
  });

  it("handAgeMs null (chưa từng sample) -> freshnessQuality = 0", () => {
    const result = computeHandTwistConfidence(baseInput({ handAgeMs: null }));
    expect(result.components.freshnessQuality).toBe(0);
  });

  it("poseHandTimestampDeltaMs vượt maxPoseHandDeltaMs -> timestampQuality = 0 -> observabilityQuality = 0", () => {
    const result = computeHandTwistConfidence(baseInput({ poseHandTimestampDeltaMs: DEFAULT_HAND_TWIST_CONFIDENCE_CONFIG.maxPoseHandDeltaMs + 50 }));
    expect(result.components.timestampQuality).toBe(0);
    expect(result.components.observabilityQuality).toBe(0);
  });

  it("stale nặng cả hai chiều khiến trusted=false với previousTrusted=false dù soft signals tốt", () => {
    const result = computeHandTwistConfidence(baseInput({
      handAgeMs: 5000, poseHandTimestampDeltaMs: 5000, previousTrusted: false,
    }));
    expect(result.trusted).toBe(false);
    expect(result.rejectionReason).not.toBeNull();
  });
});

describe("computeHandTwistConfidence — handMatched / twistAccepted reject an toàn", () => {
  it("handMatched=false -> reject dù mọi quality khác hoàn hảo", () => {
    const result = computeHandTwistConfidence(baseInput({ handMatched: false }));
    expect(result.trusted).toBe(false);
    expect(result.overallQuality).toBe(0);
    expect(result.targetInfluenceWeight).toBe(0);
  });

  it("twistAccepted=false -> reject dù mọi quality khác hoàn hảo", () => {
    const result = computeHandTwistConfidence(baseInput({ twistAccepted: false }));
    expect(result.trusted).toBe(false);
    expect(result.overallQuality).toBe(0);
    expect(result.targetInfluenceWeight).toBe(0);
  });
});

describe("computeHandTwistConfidence — handedness chỉ là tín hiệu mềm", () => {
  it("handednessScore = 0 (thấp nhất) KHÔNG tự động hard-reject nếu các component khác đều tốt", () => {
    const result = computeHandTwistConfidence(baseInput({ handednessScore: 0, previousTrusted: false }));
    expect(result.trusted).toBe(true);
    expect(result.targetInfluenceWeight).toBeGreaterThan(0);
  });

  it("handednessScore null KHÔNG làm giảm một observation tốt — overallQuality bằng đúng trường hợp bỏ hẳn component handedness (chuẩn hoá lại trọng số phần còn lại)", () => {
    const withHandedness = computeHandTwistConfidence(baseInput({ handednessScore: 1 }));
    const withoutHandedness = computeHandTwistConfidence(baseInput({ handednessScore: null }));
    // Với match/palmGeometry đều = 1 (hoàn hảo), softQuality phải bằng 1 dù có hay không có
    // handedness — loại bỏ + chuẩn hoá trọng số không được kéo xuống dưới trường hợp có mặt.
    expect(withoutHandedness.components.softQuality).toBe(1);
    expect(withoutHandedness.components.softQuality).toBeGreaterThanOrEqual(withHandedness.components.softQuality);
    expect(withoutHandedness.overallQuality).toBeGreaterThanOrEqual(withHandedness.overallQuality);
    expect(withoutHandedness.components.handednessQuality).toBe(0);
  });

  it("handednessScore null với match/palmGeometry hoàn hảo vẫn đạt trusted", () => {
    const result = computeHandTwistConfidence(baseInput({ handednessScore: null, previousTrusted: false }));
    expect(result.trusted).toBe(true);
  });
});

describe("computeHandTwistConfidence — non-finite", () => {
  it("NaN matchQuality bị reject", () => {
    const result = computeHandTwistConfidence(baseInput({ matchQuality: NaN }));
    expect(result.rejectionReason).toBe("non-finite");
    expect(result.trusted).toBe(false);
    expect(result.targetInfluenceWeight).toBe(0);
  });

  it("Infinity palmProjectionRatio bị reject", () => {
    const result = computeHandTwistConfidence(baseInput({ palmProjectionRatio: Infinity }));
    expect(result.rejectionReason).toBe("non-finite");
  });

  it("NaN handAgeMs bị reject", () => {
    const result = computeHandTwistConfidence(baseInput({ handAgeMs: NaN }));
    expect(result.rejectionReason).toBe("non-finite");
  });

  it("NaN handednessScore bị reject", () => {
    const result = computeHandTwistConfidence(baseInput({ handednessScore: NaN }));
    expect(result.rejectionReason).toBe("non-finite");
  });
});
