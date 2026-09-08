import { describe, expect, it } from "vitest";
import { computeFingerCurl, computeHandFingerFeatures, computeThumbFeatures, FINGER_LANDMARK_CHAIN, REGULAR_FINGERS } from "./fingerFeatures";
import type { RawWorldLandmarkV1 } from "../tracking/rawTrackingTypes";

/**
 * Dựng 21 landmark tay tổng hợp. `curlAmount` 0 = duỗi thẳng, 1 = cuộn hết vào lòng.
 *
 * Ngón duỗi nằm dọc trục Y; khi cuộn, các đốt xoay dần quanh trục X nên đầu ngón tiến về phía
 * -Z (lòng bàn tay). Đây là mô hình đủ để kiểm tra tính chất toán học của feature; hình dạng
 * chính xác của bàn tay thật sẽ được nghiệm thu bằng webcam.
 */
function buildHand(options: { curl?: number | Partial<Record<string, number>>; scale?: number } = {}): RawWorldLandmarkV1[] {
  const scale = options.scale ?? 1;
  const points: RawWorldLandmarkV1[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0, visibility: null }));
  points[0] = { x: 0, y: 0, z: 0, visibility: null };
  const curlOf = (finger: string): number =>
    typeof options.curl === "number" ? options.curl : (options.curl?.[finger] ?? 0);

  for (const [fingerIndex, finger] of (["thumb", "index", "middle", "ring", "little"] as const).entries()) {
    const chain = FINGER_LANDMARK_CHAIN[finger];
    const curl = curlOf(finger);
    const baseX = (fingerIndex - 2) * 0.02;
    // Gốc ngón nằm trên một hàng ngang, cách cổ tay 0.08 theo Y.
    let x = baseX; let y = 0.08; let z = 0;
    // Mỗi đốt xoay thêm `curl * 80°` so với đốt trước — cuộn dần vào lòng bàn tay.
    let angle = 0;
    points[chain[0]] = { x: x * scale, y: y * scale, z: z * scale, visibility: null };
    const boneLengths = [0.035, 0.025, 0.02];
    for (let segment = 0; segment < 3; segment += 1) {
      angle += curl * (80 * Math.PI / 180);
      const bone = boneLengths[segment];
      y += bone * Math.cos(angle);
      z -= bone * Math.sin(angle);
      points[chain[segment + 1]] = { x: x * scale, y: y * scale, z: z * scale, visibility: null };
    }
    void x;
  }
  return points;
}

describe("fingerFeatures — tính chất cơ bản", () => {
  it("ngón duỗi thẳng cho curl gần 0", () => {
    const hand = buildHand({ curl: 0 });
    for (const finger of REGULAR_FINGERS) {
      const features = computeFingerCurl(hand, finger);
      expect(features.valid).toBe(true);
      expect(features.combinedCurl).toBeLessThan(0.15);
    }
  });

  it("ngón cuộn hết cho curl cao", () => {
    const hand = buildHand({ curl: 1 });
    for (const finger of REGULAR_FINGERS) {
      const features = computeFingerCurl(hand, finger);
      expect(features.valid).toBe(true);
      expect(features.combinedCurl).toBeGreaterThan(0.6);
    }
  });

  it("curl tăng đơn điệu theo mức cuộn", () => {
    const values = [0, 0.25, 0.5, 0.75, 1].map((curl) => computeFingerCurl(buildHand({ curl }), "index").combinedCurl);
    for (let i = 1; i < values.length; i += 1) expect(values[i]).toBeGreaterThan(values[i - 1]);
  });
});

describe("fingerFeatures — bất biến và ổn định", () => {
  it("BẤT BIẾN uniform scale: bàn tay xa/gần camera cho cùng curl", () => {
    // Đây là tính chất quyết định để "đưa tay gần rồi xa" không đổi nhãn.
    const near = computeFingerCurl(buildHand({ curl: 0.8, scale: 1 }), "index");
    const far = computeFingerCurl(buildHand({ curl: 0.8, scale: 0.35 }), "index");
    expect(far.combinedCurl).toBeCloseTo(near.combinedCurl, 6);
    expect(far.chordCurl).toBeCloseTo(near.chordCurl, 6);
  });

  it("nhiễu nhỏ KHÔNG làm curl nhảy từ vùng duỗi sang vùng co", () => {
    const clean = computeFingerCurl(buildHand({ curl: 0 }), "index");
    const noisy = buildHand({ curl: 0 });
    for (let i = 5; i <= 8; i += 1) {
      noisy[i] = { x: noisy[i].x + 0.002, y: noisy[i].y - 0.0015, z: noisy[i].z + 0.002, visibility: null };
    }
    const result = computeFingerCurl(noisy, "index");
    expect(Math.abs(result.combinedCurl - clean.combinedCurl)).toBeLessThan(0.15);
  });

  it("từng ngón được đo độc lập", () => {
    const hand = buildHand({ curl: { index: 0, middle: 1, ring: 1, little: 1 } });
    const features = computeHandFingerFeatures(hand);
    const byName = Object.fromEntries(features.fingers.map((finger) => [finger.finger, finger.combinedCurl]));
    expect(byName.index).toBeLessThan(0.15);
    expect(byName.middle).toBeGreaterThan(0.6);
  });
});

describe("fingerFeatures — hướng ngón cái (thumbsUp)", () => {
  /** Image landmark với ngón cái chĩa theo hướng cho trước (y ảnh tăng XUỐNG dưới). */
  function thumbImage(dx: number, dyScreenUp: number): RawWorldLandmarkV1[] {
    const points: RawWorldLandmarkV1[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: null }));
    points[2] = { x: 0.5, y: 0.5, z: 0, visibility: null };
    // Đảo dấu khi ghi vào toạ độ ảnh: muốn "lên màn hình" thì y ảnh phải GIẢM.
    points[4] = { x: 0.5 + dx, y: 0.5 - dyScreenUp, z: 0, visibility: null };
    return points;
  }
  const world = buildHand({ curl: 0 });

  it("ngón cái chĩa LÊN → upwardness dương lớn", () => {
    const features = computeThumbFeatures(thumbImage(0, 0.15), world, 1280, 720);
    expect(features.valid).toBe(true);
    expect(features.upwardness).toBeGreaterThan(0.9);
  });

  it("ngón cái chĩa XUỐNG → upwardness âm", () => {
    const features = computeThumbFeatures(thumbImage(0, -0.15), world, 1280, 720);
    expect(features.upwardness).toBeLessThan(-0.9);
  });

  it("ngón cái chĩa NGANG → upwardness gần 0", () => {
    const features = computeThumbFeatures(thumbImage(0.15, 0), world, 1280, 720);
    expect(Math.abs(features.upwardness)).toBeLessThan(0.1);
  });

  it("SỬA ASPECT RATIO: chéo 45° THẬT TRÊN MÀN HÌNH cho upwardness = √2/2", () => {
    // Toạ độ MediaPipe chuẩn hoá `x` theo chiều rộng, `y` theo chiều cao. Trong khung 1280×720,
    // 128px ngang = 0.1 đơn vị x, còn 128px dọc = 0.1778 đơn vị y. Một vector chéo 45° thật trên
    // màn hình (số pixel bằng nhau hai chiều) phải cho upwardness = √2/2.
    const dxNormalized = 0.1;              // 128px ngang
    const dyNormalized = 0.1 * (1280 / 720); // cũng 128px dọc
    const features = computeThumbFeatures(thumbImage(dxNormalized, dyNormalized), world, 1280, 720);
    expect(features.upwardness).toBeCloseTo(Math.SQRT1_2, 2);
  });

  it("góc đo được KHỚP góc người xem thấy — không bị nén theo trục dọc", () => {
    // Nghiệm thu webcam #6: hệ số aspect đặt nhầm vế làm thành phần dọc bị nén 0.5625 lần, nên
    // ngón cái nghiêng 30° thật chỉ đo ra upwardness 0.309 thay vì 0.5.
    for (const degrees of [30, 45, 60]) {
      const radians = degrees * Math.PI / 180;
      // Vector có góc `degrees` THẬT trên màn hình: quy về đơn vị chuẩn hoá của từng trục.
      const pixels = 100;
      const dxNormalized = (pixels * Math.cos(radians)) / 1280;
      const dyNormalized = (pixels * Math.sin(radians)) / 720;
      const features = computeThumbFeatures(thumbImage(dxNormalized, dyNormalized), world, 1280, 720);
      expect(features.upwardness).toBeCloseTo(Math.sin(radians), 2);
    }
  });

  it("ngón cái gập sát (hình chiếu quá ngắn) → invalid, không đoán hướng từ nhiễu", () => {
    const features = computeThumbFeatures(thumbImage(0, 0), world, 1280, 720);
    expect(features.valid).toBe(false);
  });

  it("kích thước video không hợp lệ → invalid", () => {
    expect(computeThumbFeatures(thumbImage(0, 0.15), world, 0, 0).valid).toBe(false);
  });

  it("directionInImage là vector đơn vị", () => {
    const features = computeThumbFeatures(thumbImage(0.1, 0.1), world, 1280, 720);
    expect(Math.hypot(features.directionInImage.x, features.directionInImage.y)).toBeCloseTo(1, 6);
  });

  it("computeHandFingerFeatures không có thumbInput → thumb = null", () => {
    expect(computeHandFingerFeatures(world).thumb).toBeNull();
  });
});

describe("fingerFeatures — dữ liệu hỏng", () => {
  it("hai landmark trùng nhau → invalid, KHÔNG phải curl = 0", () => {
    // Lấp bằng 0 sẽ làm ngón hỏng trông y hệt ngón đang duỗi và classifier tin nhầm.
    const hand = buildHand({ curl: 0.5 });
    hand[6] = { ...hand[5] };
    hand[7] = { ...hand[5] };
    hand[8] = { ...hand[5] };
    const features = computeFingerCurl(hand, "index");
    expect(features.valid).toBe(false);
  });

  it("landmark NaN → invalid, không lan NaN ra combinedCurl", () => {
    const hand = buildHand({ curl: 0.5 });
    hand[7] = { x: Number.NaN, y: 0, z: 0, visibility: null };
    const features = computeFingerCurl(hand, "index");
    expect(features.valid).toBe(false);
    expect(Number.isFinite(features.combinedCurl)).toBe(true);
  });

  it("thiếu landmark → invalid và validFingerCount phản ánh đúng", () => {
    const hand = buildHand({ curl: 0.5 }).slice(0, 10) as RawWorldLandmarkV1[];
    const features = computeHandFingerFeatures(hand);
    expect(features.validFingerCount).toBeLessThan(4);
  });

  it("mọi giá trị luôn nằm trong [0,1]", () => {
    for (const curl of [0, 0.3, 0.7, 1]) {
      const features = computeHandFingerFeatures(buildHand({ curl }));
      for (const finger of features.fingers) {
        for (const value of [finger.mcpFlexion, finger.pipFlexion, finger.dipFlexion, finger.chordCurl, finger.combinedCurl]) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
