import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import {
  computeHandForearmTwist,
  DEFAULT_HAND_FOREARM_TWIST_CONFIG,
  type HandForearmTwistInput,
} from "./handForearmTwist";
import type { Vector3Data } from "./avatarPoseTypes";

/**
 * Forearm axis cố định dọc trục X trong toàn bộ test — mặt phẳng chiếu là Y-Z. reference luôn
 * là +Y (twist=0). palmDirectionAxis luôn "forward" — trục giả lập trong palmBasis test, không
 * mang ý nghĩa convention thật (đó là việc của Việc wiring sau, chưa thuộc phạm vi Việc này).
 */
const AXIS: Vector3Data = { x: 1, y: 0, z: 0 };
const REFERENCE: Vector3Data = { x: 0, y: 1, z: 0 };

function rotatedInYZ(angleRadians: number): Vector3Data {
  const v = new Vector3(0, Math.cos(angleRadians), Math.sin(angleRadians));
  return { x: v.x, y: v.y, z: v.z };
}

function baseInput(overrides: Partial<HandForearmTwistInput> = {}): HandForearmTwistInput {
  return {
    side: "right",
    forearmAxis: AXIS,
    palmBasis: {
      across: { x: 0, y: 0, z: 1 },
      forward: rotatedInYZ(0),
      normal: { x: 1, y: 0, z: 0 },
    },
    palmBasisQuality: 1,
    palmDirectionAxis: "forward",
    referenceDirection: REFERENCE,
    positiveSign: 1,
    ...overrides,
  };
}

function withForwardAngle(angleRadians: number, overrides: Partial<HandForearmTwistInput> = {}): HandForearmTwistInput {
  return baseInput({
    palmBasis: { across: { x: 0, y: 0, z: 1 }, forward: rotatedInYZ(angleRadians), normal: { x: 1, y: 0, z: 0 } },
    ...overrides,
  });
}

describe("computeHandForearmTwist — góc chuẩn", () => {
  it("twist = 0 khi palm forward trùng reference direction", () => {
    const result = computeHandForearmTwist(withForwardAngle(0));
    expect(result.accepted).toBe(true);
    expect(result.twistRadians).toBeCloseTo(0, 6);
  });

  it("twist = +45deg", () => {
    const result = computeHandForearmTwist(withForwardAngle(Math.PI / 4));
    expect(result.accepted).toBe(true);
    expect(result.twistRadians).toBeCloseTo(Math.PI / 4, 6);
  });

  it("twist = -45deg", () => {
    const result = computeHandForearmTwist(withForwardAngle(-Math.PI / 4));
    expect(result.accepted).toBe(true);
    expect(result.twistRadians).toBeCloseTo(-Math.PI / 4, 6);
  });

  it("twist = +90deg", () => {
    const result = computeHandForearmTwist(withForwardAngle(Math.PI / 2));
    expect(result.accepted).toBe(true);
    expect(result.twistRadians).toBeCloseTo(Math.PI / 2, 6);
  });

  it("twist = -90deg", () => {
    const result = computeHandForearmTwist(withForwardAngle(-Math.PI / 2));
    expect(result.accepted).toBe(true);
    expect(result.twistRadians).toBeCloseTo(-Math.PI / 2, 6);
  });
});

describe("computeHandForearmTwist — biên ±PI", () => {
  it("gần +PI trả giá trị gần +PI, không nhảy dấu", () => {
    const result = computeHandForearmTwist(withForwardAngle(Math.PI - 0.01));
    expect(result.accepted).toBe(true);
    expect(result.twistRadians).toBeCloseTo(Math.PI - 0.01, 6);
  });

  it("gần -PI trả giá trị gần -PI, không nhảy dấu", () => {
    const result = computeHandForearmTwist(withForwardAngle(-Math.PI + 0.01));
    expect(result.accepted).toBe(true);
    expect(result.twistRadians).toBeCloseTo(-Math.PI + 0.01, 6);
  });

  it("đúng PI (suy biến đối song) vẫn trả góc hữu hạn trong [-PI, PI]", () => {
    const result = computeHandForearmTwist(withForwardAngle(Math.PI));
    expect(result.accepted).toBe(true);
    expect(result.twistRadians).not.toBeNull();
    expect(Math.abs(result.twistRadians as number)).toBeCloseTo(Math.PI, 5);
  });
});

describe("computeHandForearmTwist — swing invariance", () => {
  it("thay đổi swing (forearmAxis nghiêng đi) không đổi twist khi palm xoay cùng axis", () => {
    // forearmAxis nghiêng sang một hướng khác (giả lập "swing"), nhưng ta build palmBasis sao
    // cho palm direction vẫn lệch đúng 45deg quanh axis MỚI so với reference chiếu lên mặt
    // phẳng vuông góc axis MỚI — kỳ vọng twist vẫn ~45deg bất kể swing.
    const tiltedAxis = new Vector3(1, 0.4, 0).normalize();
    const reference = new Vector3(0, 1, 0);
    const referenceProjected = reference.clone().addScaledVector(tiltedAxis, -reference.dot(tiltedAxis)).normalize();

    // Xoay referenceProjected quanh tiltedAxis 45deg bằng Rodrigues để tạo palm forward.
    const angle = Math.PI / 4;
    const k = tiltedAxis;
    const v = referenceProjected;
    const rotated = v.clone().multiplyScalar(Math.cos(angle))
      .add(new Vector3().crossVectors(k, v).multiplyScalar(Math.sin(angle)))
      .add(k.clone().multiplyScalar(k.dot(v) * (1 - Math.cos(angle))));

    const input = baseInput({
      forearmAxis: { x: tiltedAxis.x, y: tiltedAxis.y, z: tiltedAxis.z },
      palmBasis: { across: { x: 0, y: 0, z: 1 }, forward: { x: rotated.x, y: rotated.y, z: rotated.z }, normal: { x: 1, y: 0, z: 0 } },
      referenceDirection: { x: reference.x, y: reference.y, z: reference.z },
    });

    const result = computeHandForearmTwist(input);
    expect(result.accepted).toBe(true);
    expect(result.twistRadians).toBeCloseTo(Math.PI / 4, 5);
  });
});

describe("computeHandForearmTwist — left/right convention", () => {
  it("positiveSign=-1 đảo dấu twist so với positiveSign=1 cho cùng hình học", () => {
    const rightResult = computeHandForearmTwist(withForwardAngle(Math.PI / 4, { side: "right", positiveSign: 1 }));
    const leftResult = computeHandForearmTwist(withForwardAngle(Math.PI / 4, { side: "left", positiveSign: -1 }));
    expect(rightResult.accepted).toBe(true);
    expect(leftResult.accepted).toBe(true);
    expect(leftResult.twistRadians).toBeCloseTo(-(rightResult.twistRadians as number), 6);
  });

  it("không tự suy positiveSign từ side — side='left' với positiveSign=1 vẫn tính bình thường, không tự đảo", () => {
    const result = computeHandForearmTwist(withForwardAngle(Math.PI / 4, { side: "left", positiveSign: 1 }));
    expect(result.accepted).toBe(true);
    expect(result.twistRadians).toBeCloseTo(Math.PI / 4, 6);
  });
});

describe("computeHandForearmTwist — degenerate", () => {
  it("zero-length forearmAxis bị reject", () => {
    const result = computeHandForearmTwist(baseInput({ forearmAxis: { x: 0, y: 0, z: 0 } }));
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe("zero-length-axis");
    expect(result.twistRadians).toBeNull();
  });

  it("zero-length palm direction bị reject", () => {
    const result = computeHandForearmTwist(baseInput({ palmBasis: { across: { x: 0, y: 0, z: 1 }, forward: { x: 0, y: 0, z: 0 }, normal: { x: 1, y: 0, z: 0 } } }));
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe("zero-length-palm-direction");
  });

  it("zero-length reference direction bị reject", () => {
    const result = computeHandForearmTwist(baseInput({ referenceDirection: { x: 0, y: 0, z: 0 } }));
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe("zero-length-reference");
  });

  it("forearmAxis không phải unit vector bị reject", () => {
    const result = computeHandForearmTwist(baseInput({ forearmAxis: { x: 2, y: 0, z: 0 } }));
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe("axis-not-unit");
  });

  it("palm direction song song với forearmAxis (projection suy biến) bị reject", () => {
    const result = computeHandForearmTwist(baseInput({ palmBasis: { across: { x: 0, y: 0, z: 1 }, forward: { x: 1, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } } }));
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe("projection-degenerate");
  });

  it("reference direction song song với forearmAxis (projection suy biến) bị reject", () => {
    const result = computeHandForearmTwist(baseInput({ referenceDirection: { x: 1, y: 0, z: 0 } }));
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe("projection-degenerate");
  });

  it("palmBasisQuality dưới ngưỡng bị reject dù hình học hợp lệ", () => {
    const result = computeHandForearmTwist(baseInput({ palmBasisQuality: DEFAULT_HAND_FOREARM_TWIST_CONFIG.minPalmBasisQuality / 2 }));
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe("quality-too-low");
    expect(result.quality).toBe(0);
  });

  it("palmBasisQuality bằng đúng ngưỡng vẫn được chấp nhận (ngưỡng là inclusive lower bound)", () => {
    const result = computeHandForearmTwist(baseInput({ palmBasisQuality: DEFAULT_HAND_FOREARM_TWIST_CONFIG.minPalmBasisQuality }));
    expect(result.accepted).toBe(true);
  });
});

describe("computeHandForearmTwist — non-finite", () => {
  it("NaN trong forearmAxis bị reject", () => {
    const result = computeHandForearmTwist(baseInput({ forearmAxis: { x: NaN, y: 0, z: 0 } }));
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe("non-finite");
  });

  it("Infinity trong palm forward bị reject", () => {
    const result = computeHandForearmTwist(baseInput({ palmBasis: { across: { x: 0, y: 0, z: 1 }, forward: { x: 0, y: Infinity, z: 0 }, normal: { x: 1, y: 0, z: 0 } } }));
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe("non-finite");
  });

  it("NaN trong referenceDirection bị reject", () => {
    const result = computeHandForearmTwist(baseInput({ referenceDirection: { x: NaN, y: 1, z: 0 } }));
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe("non-finite");
  });

  it("NaN palmBasisQuality bị reject", () => {
    const result = computeHandForearmTwist(baseInput({ palmBasisQuality: NaN }));
    expect(result.accepted).toBe(false);
    expect(result.rejectionReason).toBe("non-finite");
  });
});

describe("computeHandForearmTwist — palmDirectionAxis không hard-code", () => {
  it("đổi palmDirectionAxis sang 'across' dùng đúng trục across, không phải forward", () => {
    const input = baseInput({
      palmBasis: { across: rotatedInYZ(Math.PI / 2), forward: rotatedInYZ(0), normal: { x: 1, y: 0, z: 0 } },
      palmDirectionAxis: "across",
    });
    const result = computeHandForearmTwist(input);
    expect(result.accepted).toBe(true);
    expect(result.twistRadians).toBeCloseTo(Math.PI / 2, 6);
  });
});
