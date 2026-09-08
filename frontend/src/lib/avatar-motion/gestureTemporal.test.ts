import { describe, expect, it } from "vitest";
import {
  DEFAULT_GESTURE_TEMPORAL_CONFIG,
  INITIAL_GESTURE_TEMPORAL_STATE,
  updateGestureTemporal,
  type GestureTemporalState,
} from "./gestureTemporal";
import type { GestureClassification, GestureObservationLabel } from "./gestureClassifier";

const classification = (label: GestureObservationLabel, confidence = 0.9): GestureClassification => ({
  label, classScore: confidence, separationMargin: confidence,
  observabilityQuality: 1, confidence,
});

/** Chạy pipeline ở một FPS cho trước, mỗi frame có sample MỚI. */
function runAtFps(options: {
  fps: number;
  durationMs: number;
  label: GestureObservationLabel;
  initial?: GestureTemporalState;
}): GestureTemporalState {
  const frameMs = 1000 / options.fps;
  let state = options.initial ?? INITIAL_GESTURE_TEMPORAL_STATE;
  for (let elapsed = 0; elapsed <= options.durationMs; elapsed += frameMs) {
    state = updateGestureTemporal(state, {
      classification: classification(options.label),
      handPresent: true,
      observationAtMs: elapsed,
      nowMs: elapsed,
    }).state;
  }
  return state;
}

describe("gestureTemporal — bất biến FPS", () => {
  it("15/30/60 FPS cho cùng kết quả promotion", () => {
    // Nếu đếm theo SỐ FRAME thay vì thời gian, 60 FPS sẽ promote còn 15 FPS thì không.
    const results = [15, 30, 60].map((fps) => runAtFps({ fps, durationMs: 300, label: "fist" }).activePose);
    expect(results).toEqual(["fist", "fist", "fist"]);
  });

  it("chưa đủ thời gian promotion thì mọi FPS đều CHƯA promote", () => {
    const results = [15, 30, 60].map((fps) => runAtFps({ fps, durationMs: 80, label: "fist" }).activePose);
    expect(results).toEqual(["rest", "rest", "rest"]);
  });

  it("sample TRÙNG không đẩy nhanh promotion", () => {
    // Render loop chạy nhanh hơn detector: nhiều frame dùng lại cùng một sample. Nếu mỗi lần gọi
    // được tính là bằng chứng mới thì render nhanh sẽ promote sớm — lại phụ thuộc FPS.
    let state = INITIAL_GESTURE_TEMPORAL_STATE;
    for (let i = 0; i < 60; i += 1) {
      state = updateGestureTemporal(state, {
        classification: classification("fist"),
        handPresent: true,
        observationAtMs: 1000, // luôn cùng một sample
        nowMs: 1000 + i,       // thời gian trôi chưa đủ promotionMs
      }).state;
    }
    expect(state.activePose).toBe("rest");
  });

  it("render frame không kèm sample mới không tính là quan sát", () => {
    let state = updateGestureTemporal(INITIAL_GESTURE_TEMPORAL_STATE, {
      classification: classification("fist"), handPresent: true, observationAtMs: 0, nowMs: 0,
    }).state;
    for (let i = 1; i <= 30; i += 1) {
      state = updateGestureTemporal(state, {
        classification: null, handPresent: true, observationAtMs: null, nowMs: i * 4,
      }).state;
    }
    // Chỉ có đúng một quan sát, dù thời gian đã trôi quá promotionMs.
    expect(state.activePose).toBe("rest");
  });
});

describe("gestureTemporal — promotion và chống nhấp nháy", () => {
  it("nhãn giữ đủ lâu thì được phát", () => {
    const state = runAtFps({ fps: 30, durationMs: 200, label: "fist" });
    expect(state.activePose).toBe("fist");
  });

  it("nhãn nhấp nháy không được promote", () => {
    let state = INITIAL_GESTURE_TEMPORAL_STATE;
    const labels: GestureObservationLabel[] = ["fist", "unknown-observed", "fist", "unknown-observed", "fist"];
    labels.forEach((label, index) => {
      state = updateGestureTemporal(state, {
        classification: classification(label), handPresent: true,
        observationAtMs: index * 30, nowMs: index * 30,
      }).state;
    });
    expect(state.activePose).toBe("rest");
  });

  it("confidence thấp không đủ tư cách ứng viên", () => {
    let state = INITIAL_GESTURE_TEMPORAL_STATE;
    for (let i = 0; i <= 10; i += 1) {
      state = updateGestureTemporal(state, {
        classification: classification("fist", 0.2), handPresent: true,
        observationAtMs: i * 33, nowMs: i * 33,
      }).state;
    }
    expect(state.activePose).toBe("rest");
  });

  it("poseChanged chỉ true đúng frame nhãn đổi", () => {
    let state = INITIAL_GESTURE_TEMPORAL_STATE;
    let changes = 0;
    for (let i = 0; i <= 20; i += 1) {
      const result = updateGestureTemporal(state, {
        classification: classification("fist"), handPresent: true,
        observationAtMs: i * 33, nowMs: i * 33,
      });
      state = result.state;
      if (result.poseChanged) changes += 1;
    }
    expect(changes).toBe(1);
  });
});

describe("gestureTemporal — nhả nhãn cũ", () => {
  it("unknown-observed ổn định PHẢI nhả fist về relaxed", () => {
    // Đây là lỗi lớn nhất của plan v1: giữ peace 1 giây mà avatar vẫn kẹt ở fist.
    const fist = runAtFps({ fps: 30, durationMs: 200, label: "fist" });
    expect(fist.activePose).toBe("fist");
    const released = runAtFps({
      fps: 30, durationMs: 400, label: "unknown-observed", initial: fist,
    });
    expect(released.activePose).toBe("relaxed");
  });

  it("unknown-low-quality được giữ nhãn cũ TẠM THỜI", () => {
    const fist = runAtFps({ fps: 30, durationMs: 200, label: "fist" });
    const shortly = runAtFps({ fps: 30, durationMs: 200, label: "unknown-low-quality", initial: fist });
    expect(shortly.activePose).toBe("fist");
  });

  it("unknown-low-quality quá 500ms phải về relaxed", () => {
    const fist = runAtFps({ fps: 30, durationMs: 200, label: "fist" });
    const expired = runAtFps({ fps: 30, durationMs: 700, label: "unknown-low-quality", initial: fist });
    expect(expired.activePose).toBe("relaxed");
  });

  it("unknown-observed nhả NHANH HƠN unknown-low-quality", () => {
    // Quan sát tốt nói rằng tư thế đã đổi thì phải tin nhanh hơn quan sát hỏng.
    expect(DEFAULT_GESTURE_TEMPORAL_CONFIG.unknownReleaseMs)
      .toBeLessThan(DEFAULT_GESTURE_TEMPORAL_CONFIG.lowQualityHoldMs);
  });
});

describe("gestureTemporal — mất bàn tay", () => {
  it("mất tay quá handLostMs thì về rest", () => {
    const fist = runAtFps({ fps: 30, durationMs: 200, label: "fist" });
    let state = fist;
    for (let elapsed = 200; elapsed <= 900; elapsed += 33) {
      state = updateGestureTemporal(state, {
        classification: null, handPresent: false, observationAtMs: null, nowMs: elapsed,
      }).state;
    }
    expect(state.activePose).toBe("rest");
  });

  it("mất tay ngắn thì GIỮ nhãn — không giật về rest khi tay lướt qua mép khung", () => {
    const fist = runAtFps({ fps: 30, durationMs: 200, label: "fist" });
    let state = fist;
    for (let elapsed = 200; elapsed <= 400; elapsed += 33) {
      state = updateGestureTemporal(state, {
        classification: null, handPresent: false, observationAtMs: null, nowMs: elapsed,
      }).state;
    }
    expect(state.activePose).toBe("fist");
  });

  it("hand-lost và unknown-observed dùng timer riêng, không cộng dồn", () => {
    const fist = runAtFps({ fps: 30, durationMs: 200, label: "fist" });
    // Mất tay 300ms (chưa tới handLostMs=500)…
    let state = fist;
    for (let elapsed = 200; elapsed <= 500; elapsed += 33) {
      state = updateGestureTemporal(state, {
        classification: null, handPresent: false, observationAtMs: null, nowMs: elapsed,
      }).state;
    }
    expect(state.activePose).toBe("fist");
  });
});
