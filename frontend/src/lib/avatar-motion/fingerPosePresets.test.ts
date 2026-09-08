import { describe, expect, it } from "vitest";
import { getFingerPosePreset, IMPLEMENTED_POSE_LABELS, FINGER_FLEXION_RANGE_RADIANS } from "./fingerPosePresets";
import { AVATAR_FINGER_NAMES } from "./avatarPoseTypes";
import type { GesturePoseLabel } from "./gestureClassifier";

const thumbOf = (label: GesturePoseLabel) => getFingerPosePreset(label).thumb;
const meanFlexion = (target: { proximal: number; intermediate: number; distal: number }) =>
  (target.proximal + target.intermediate + target.distal) / 3;

describe("fingerPosePresets — thứ bậc gập ngón cái", () => {
  it("fist gập ngón cái SÂU NHẤT", () => {
    // Nắm đấm vắt ngón cái qua cả bốn ngón đang co.
    const fist = meanFlexion(thumbOf("fist"));
    for (const label of ["point", "relaxed", "open"] as const) {
      expect(fist).toBeGreaterThan(meanFlexion(thumbOf(label)));
    }
  });

  it("point gập ngón cái sâu — chỉ hơi nông hơn fist", () => {
    // Nghiệm thu webcam #3: 0.5 trông lửng lơ. Khi chỉ tay, ngón cái tựa lên ngón giữa đang co
    // nên phải gập khá sâu, chỉ dừng sớm hơn nắm đấm một chút.
    const point = meanFlexion(thumbOf("point"));
    const fist = meanFlexion(thumbOf("fist"));
    expect(point).toBeGreaterThan(0.5);
    expect(fist - point).toBeLessThan(0.2);
  });

  it("open duỗi ngón cái nhất", () => {
    const open = meanFlexion(thumbOf("open"));
    for (const label of ["fist", "point", "relaxed"] as const) {
      expect(open).toBeLessThan(meanFlexion(thumbOf(label)));
    }
  });

  it("relaxed khép ngón cái RÕ HƠN open — tay nghỉ khác tay xoè", () => {
    // Giá trị cũ 0.12 gần bằng open (0.05) làm hai tư thế trông giống nhau ở ngón cái.
    const relaxed = meanFlexion(thumbOf("relaxed"));
    const open = meanFlexion(thumbOf("open"));
    expect(relaxed - open).toBeGreaterThan(0.1);
  });

  it("relaxed: ngón cái khép vào lòng rõ hơn bốn ngón còn lại", () => {
    const preset = getFingerPosePreset("relaxed");
    const thumb = meanFlexion(preset.thumb);
    for (const finger of ["index", "middle", "ring", "little"] as const) {
      expect(thumb).toBeGreaterThan(meanFlexion(preset[finger]));
    }
  });
});

describe("fingerPosePresets — tính hợp lệ", () => {
  it("mọi giá trị flexion nằm trong [0,1]", () => {
    for (const label of IMPLEMENTED_POSE_LABELS) {
      const preset = getFingerPosePreset(label);
      for (const finger of AVATAR_FINGER_NAMES) {
        for (const value of [preset[finger].proximal, preset[finger].intermediate, preset[finger].distal]) {
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("rest là identity tuyệt đối trên MỌI ngón", () => {
    const rest = getFingerPosePreset("rest");
    for (const finger of AVATAR_FINGER_NAMES) {
      expect(meanFlexion(rest[finger])).toBe(0);
    }
  });

  it("open: bốn ngón thường duỗi THẲNG TUYỆT ĐỐI", () => {
    // Nghiệm thu webcam #4: giá trị nhỏ 0.04–0.07 nhân biên độ 1.55–1.75 rad vẫn ra ~15° trên ba
    // đốt — nhìn thấy cong. Vì flexion là rest-relative delta, 0 nghĩa là giữ rest pose của model
    // (vốn đã có độ cong tự nhiên), không phải bẻ ngón thành đường thẳng hình học.
    const open = getFingerPosePreset("open");
    for (const finger of ["index", "middle", "ring", "little"] as const) {
      expect(meanFlexion(open[finger])).toBe(0);
    }
  });

  it("point: ngón trỏ duỗi THẲNG TUYỆT ĐỐI — chỉ tay mà cong thì mất ý nghĩa", () => {
    expect(meanFlexion(getFingerPosePreset("point").index)).toBe(0);
  });

  it("point: ngón trỏ duỗi như open, ba ngón còn lại co như fist", () => {
    const point = getFingerPosePreset("point");
    const open = getFingerPosePreset("open");
    const fist = getFingerPosePreset("fist");
    expect(meanFlexion(point.index)).toBeCloseTo(meanFlexion(open.index), 2);
    for (const finger of ["middle", "ring", "little"] as const) {
      expect(meanFlexion(point[finger])).toBeCloseTo(meanFlexion(fist[finger]), 2);
    }
  });

  it("chỉ thumbsUp/thumbsDown yêu cầu hướng ngón cái", () => {
    // Flexion một mình chỉ giữ ngón cái ở rest pose. Hướng thực tế (+/- torso-up) thuộc rig của
    // từng model, còn preset chỉ nói ý nghĩa semantic là "up" hay "down".
    expect(getFingerPosePreset("thumbsUp").thumb.direction).toBe("up");
    expect(getFingerPosePreset("thumbsDown").thumb.direction).toBe("down");
    for (const label of ["fist", "point", "open", "relaxed", "rest"] as const) {
      expect(getFingerPosePreset(label).thumb.direction).toBeUndefined();
    }
  });

  it("thumbsDown ĐỐI XỨNG thumbsUp — chỉ khác hướng semantic", () => {
    const up = getFingerPosePreset("thumbsUp").thumb;
    const down = getFingerPosePreset("thumbsDown").thumb;
    expect(down.proximal).toBe(up.proximal);
    expect(down.intermediate).toBe(up.intermediate);
    expect(down.distal).toBe(up.distal);
    expect(up.direction).toBe("up");
    expect(down.direction).toBe("down");
  });

  it("thumbsUp và thumbsDown giống nhau ở bốn ngón thường", () => {
    const up = getFingerPosePreset("thumbsUp");
    const down = getFingerPosePreset("thumbsDown");
    for (const finger of ["index", "middle", "ring", "little"] as const) {
      expect(meanFlexion(down[finger])).toBe(meanFlexion(up[finger]));
    }
  });

  it("bốn ngón thường KHÔNG yêu cầu hướng ở bất kỳ preset nào", () => {
    for (const label of IMPLEMENTED_POSE_LABELS) {
      const preset = getFingerPosePreset(label);
      for (const finger of ["index", "middle", "ring", "little"] as const) {
        expect(preset[finger].direction).toBeUndefined();
      }
    }
  });

  it("biên độ ngón cái nhỏ hơn bốn ngón thường nhưng vẫn nhìn thấy được", () => {
    // Khớp CMC/MCP/IP có biên độ nhỏ hơn MCP/PIP/DIP, nhưng không nhỏ tới mức không thấy gập.
    const thumb = FINGER_FLEXION_RANGE_RADIANS.thumb;
    const index = FINGER_FLEXION_RANGE_RADIANS.index;
    expect(thumb.proximal).toBeLessThan(index.proximal);
    // ~50° trở lên mới nhìn thấy rõ trên avatar.
    expect(thumb.proximal).toBeGreaterThan(0.8);
  });
});
