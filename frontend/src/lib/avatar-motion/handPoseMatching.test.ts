import { describe, expect, it } from "vitest";
import { matchHandsToPose, DEFAULT_HAND_MATCH_CONFIG, type MatchHandsToPoseInput } from "./handPoseMatching";
import type { RawHandCandidateV1, RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";

const VIDEO_WIDTH = 1280;
const VIDEO_HEIGHT = 720;

const lm = (x: number, y: number, z = 0, visibility: number | null = 1): RawNormalizedLandmarkV1 => ({ x, y, z, visibility });

function handCandidate(sourceIndex: number, wrist: RawNormalizedLandmarkV1, handedness: RawHandCandidateV1["handedness"], sampledAtMs = 100): RawHandCandidateV1 {
  // Landmark[0] = wrist theo convention MediaPipe Hand Landmarker.
  return { sourceIndex, sampledAtMs, handedness, handednessScore: 0.9, landmarks: [wrist], worldLandmarks: [wrist] };
}

function previousWrist(x: number, y: number, lastMatchedAtMs: number | null = 0) {
  return { wristPosition: { x, y }, lastMatchedAtMs };
}

function baseInput(overrides: Partial<MatchHandsToPoseInput> = {}): MatchHandsToPoseInput {
  return {
    handSampledThisFrame: true,
    rawHands: [],
    poseWristImage: { left: lm(0.7, 0.5), right: lm(0.3, 0.5) },
    poseSampledAtMs: 100,
    handSampledAtMs: 100,
    videoWidth: VIDEO_WIDTH,
    videoHeight: VIDEO_HEIGHT,
    previous: {},
    ...overrides,
  };
}

describe("matchHandsToPose", () => {
  it("1. matches a single left hand candidate to the pose left wrist", () => {
    const result = matchHandsToPose(baseInput({ rawHands: [handCandidate(0, lm(0.71, 0.5), "left")] }));
    expect(result.ranMatching).toBe(true);
    expect(result.left.matched).toBe(true);
    expect(result.left.candidateArrayIndex).toBe(0);
    expect(result.right.matched).toBe(false);
  });

  it("2. matches a single right hand candidate to the pose right wrist", () => {
    const result = matchHandsToPose(baseInput({ rawHands: [handCandidate(0, lm(0.31, 0.5), "right")] }));
    expect(result.right.matched).toBe(true);
    expect(result.right.candidateArrayIndex).toBe(0);
    expect(result.left.matched).toBe(false);
  });

  it("3. matches both hands simultaneously without cross-assignment", () => {
    const result = matchHandsToPose(baseInput({
      rawHands: [handCandidate(0, lm(0.71, 0.5), "left"), handCandidate(1, lm(0.31, 0.5), "right")],
    }));
    expect(result.left.candidateArrayIndex).toBe(0);
    expect(result.right.candidateArrayIndex).toBe(1);
  });

  it("4. mirrored input: wrist distance still resolves correctly using image-space positions only", () => {
    // "Mirrored" ở đây nghĩa là camera preview lật hiển thị nhưng landmark thô (đầu vào hàm)
    // không đổi — hàm này không tự mirror, chỉ so image-space thô, nên kết quả phải nhất quán.
    const result = matchHandsToPose(baseInput({
      poseWristImage: { left: lm(0.2, 0.5), right: lm(0.8, 0.5) },
      rawHands: [handCandidate(0, lm(0.21, 0.5), "left"), handCandidate(1, lm(0.79, 0.5), "right")],
    }));
    expect(result.left.candidateArrayIndex).toBe(0);
    expect(result.right.candidateArrayIndex).toBe(1);
  });

  it("5. wrong handedness label but correct wrist continuity still matches (soft penalty only)", () => {
    const result = matchHandsToPose(baseInput({
      rawHands: [handCandidate(0, lm(0.71, 0.5), "right")], // label sai (đáng lẽ "left"), nhưng vị trí đúng cạnh pose left wrist.
    }));
    expect(result.left.matched).toBe(true);
    expect(result.left.candidateArrayIndex).toBe(0);
  });

  it("6. two hands swap source index order between frames but continuity keeps side assignment stable", () => {
    const frame1 = matchHandsToPose(baseInput({
      rawHands: [handCandidate(0, lm(0.71, 0.5), "left"), handCandidate(1, lm(0.31, 0.5), "right")],
    }));
    expect(frame1.left.candidateArrayIndex).toBe(0);
    expect(frame1.right.candidateArrayIndex).toBe(1);

    // Frame 2: MediaPipe trả về theo thứ tự đảo ngược trong mảng kết quả.
    const frame2 = matchHandsToPose(baseInput({
      rawHands: [handCandidate(0, lm(0.31, 0.5), "right"), handCandidate(1, lm(0.71, 0.5), "left")],
      previous: {
        left: previousWrist(0.71, 0.5 / (VIDEO_WIDTH / VIDEO_HEIGHT)),
        right: previousWrist(0.31, 0.5 / (VIDEO_WIDTH / VIDEO_HEIGHT)),
      },
    }));
    expect(frame2.left.candidateArrayIndex).toBe(1);
    expect(frame2.right.candidateArrayIndex).toBe(0);
  });

  it("7. hand wrist too far from pose wrist is rejected", () => {
    const result = matchHandsToPose(baseInput({ rawHands: [handCandidate(0, lm(0.05, 0.95), "left")] }));
    expect(result.left.matched).toBe(false);
    expect(result.left.rejectionReason).toBe("wrist-distance-too-large");
  });

  it("9. hand missing for several frames: handSampledThisFrame=false does not run new matching", () => {
    const result = matchHandsToPose(baseInput({ handSampledThisFrame: false, rawHands: [] }));
    expect(result.ranMatching).toBe(false);
    expect(result.left.matched).toBe(false);
    expect(result.left.rejectionReason).toBe("no-candidates");
  });

  it("distinguishes sampled-but-no-hands from not-sampled", () => {
    const noHands = matchHandsToPose(baseInput({ handSampledThisFrame: true, rawHands: [] }));
    expect(noHands.ranMatching).toBe(true);
    expect(noHands.left.rejectionReason).toBe("no-candidates");

    const notSampled = matchHandsToPose(baseInput({ handSampledThisFrame: false, rawHands: [] }));
    expect(notSampled.ranMatching).toBe(false);
  });

  it("10. hand reappears after loss: matching resumes and is stable", () => {
    const reappeared = matchHandsToPose(baseInput({
      rawHands: [handCandidate(0, lm(0.71, 0.5), "left")],
      previous: { left: previousWrist(0.7, 0.5 / (VIDEO_WIDTH / VIDEO_HEIGHT)) },
    }));
    expect(reappeared.left.matched).toBe(true);
    expect(reappeared.left.candidateArrayIndex).toBe(0);
  });

  it("11. no NaN/Infinity in output for well-formed input", () => {
    const result = matchHandsToPose(baseInput({ rawHands: [handCandidate(0, lm(0.71, 0.5), "left")] }));
    expect(Number.isFinite(result.left.distance)).toBe(true);
  });

  it("11b. non-finite hand landmark is rejected instead of propagating NaN", () => {
    const result = matchHandsToPose(baseInput({ rawHands: [handCandidate(0, lm(Number.NaN, 0.5), "left")] }));
    expect(result.left.matched).toBe(false);
    expect(result.left.rejectionReason).toBe("non-finite");
  });

  it("12. diagnostic reflects the correct rejection reason for a stale hand frame", () => {
    const result = matchHandsToPose(baseInput({
      rawHands: [handCandidate(0, lm(0.71, 0.5), "left")],
      poseSampledAtMs: 1000,
      handSampledAtMs: 100,
    }));
    expect(result.left.rejectionReason).toBe("stale-frame");
    expect(result.right.rejectionReason).toBe("stale-frame");
  });

  it("aspect ratio correction changes match outcome versus naive x/y distance", () => {
    // Video rất rộng (2.5:1): một khoảng cách y nhỏ theo normalized coordinate tương ứng
    // khoảng cách vật lý lớn hơn nhiều so với cùng khoảng cách theo x.
    const wideConfig = { ...DEFAULT_HAND_MATCH_CONFIG, maxWristDistance: 0.1 };
    const result = matchHandsToPose(baseInput({
      videoWidth: 2560, videoHeight: 1024,
      poseWristImage: { left: lm(0.5, 0.5), right: null },
      rawHands: [handCandidate(0, lm(0.5, 0.54), "left")],
      config: wideConfig,
    }));
    // dy_raw=0.04 nhưng sau chia aspect (2.5) chỉ còn 0.016 -> vẫn trong ngưỡng 0.1.
    expect(result.left.matched).toBe(true);
    expect(result.left.distance).toBeLessThan(0.04);
  });

  it("13. no field of the match result touches joint rotations (type-level containment)", () => {
    const result = matchHandsToPose(baseInput({ rawHands: [handCandidate(0, lm(0.71, 0.5), "left")] }));
    expect(result).not.toHaveProperty("jointRotations");
    expect(result.left).not.toHaveProperty("jointRotations");
  });

  it("same hand with two candidates swapping source index order -> continued, matchChanged=false", () => {
    const previous = {
      left: previousWrist(0.71, 0.5 / (VIDEO_WIDTH / VIDEO_HEIGHT)),
      right: previousWrist(0.31, 0.5 / (VIDEO_WIDTH / VIDEO_HEIGHT)),
    };
    // sourceIndex đảo ngược so với frame trước, nhưng vị trí wrist mỗi bàn tay thật không đổi.
    const result = matchHandsToPose(baseInput({
      rawHands: [handCandidate(0, lm(0.31, 0.5), "right"), handCandidate(1, lm(0.71, 0.5), "left")],
      previous,
    }));
    expect(result.left.continuity).toBe("continued");
    expect(result.left.matchChanged).toBe(false);
    expect(result.right.continuity).toBe("continued");
    expect(result.right.matchChanged).toBe(false);
    // candidateArrayIndex phản ánh vị trí trong mảng CỦA FRAME HIỆN TẠI (dùng để tra cứu);
    // candidateSourceIndex phản ánh sourceIndex gốc — cả hai đều KHÔNG dùng để tính continuity.
    expect(result.left.candidateArrayIndex).toBe(1);
    expect(result.left.candidateSourceIndex).toBe(1);
    expect(result.right.candidateArrayIndex).toBe(0);
    expect(result.right.candidateSourceIndex).toBe(0);
  });

  it("rawHands reordered/filtered so candidateSourceIndex differs from candidateArrayIndex, continuity still holds by position", () => {
    // sourceIndex=5 nhưng đây là candidate DUY NHẤT trong mảng -> arrayIndex=0. Hai giá trị
    // lệch nhau rõ ràng, đúng kịch bản rawHands bị filter/reorder trước khi truyền vào matcher.
    const result = matchHandsToPose(baseInput({
      rawHands: [handCandidate(5, lm(0.705, 0.5), "left")],
      previous: { left: previousWrist(0.71, 0.5 / (VIDEO_WIDTH / VIDEO_HEIGHT)) },
    }));
    expect(result.left.matched).toBe(true);
    expect(result.left.candidateArrayIndex).toBe(0);
    expect(result.left.candidateSourceIndex).toBe(5);
    expect(result.left.candidateArrayIndex).not.toBe(result.left.candidateSourceIndex);
    // Continuity vẫn tính đúng theo VỊ TRÍ wrist, không quan tâm sourceIndex đổi thế nào.
    expect(result.left.continuity).toBe("continued");
    expect(result.left.matchChanged).toBe(false);
  });

  it("sourceIndex changes but wrist continuity holds -> not treated as a hand swap", () => {
    const result = matchHandsToPose(baseInput({
      rawHands: [handCandidate(5, lm(0.705, 0.5), "left")], // sourceIndex khác hẳn frame trước, vị trí gần như cũ.
      previous: { left: previousWrist(0.71, 0.5 / (VIDEO_WIDTH / VIDEO_HEIGHT)) },
    }));
    expect(result.left.continuity).toBe("continued");
    expect(result.left.matchChanged).toBe(false);
  });

  it("new candidate far from previous wrist position -> reacquired, matchChanged=true", () => {
    const result = matchHandsToPose(baseInput({
      rawHands: [handCandidate(0, lm(0.68, 0.5), "left")], // vẫn đủ gần pose wrist (0.7) để match, nhưng xa vị trí match trước.
      previous: { left: previousWrist(0.2, 0.5 / (VIDEO_WIDTH / VIDEO_HEIGHT)) },
    }));
    expect(result.left.matched).toBe(true);
    expect(result.left.continuity).toBe("reacquired");
    expect(result.left.matchChanged).toBe(true);
  });

  it("continuity history expired (continuityTimeoutMs exceeded) -> new/reacquired instead of continued, even when the hand reappears near the old position", () => {
    // Nhiều frame sampled nhưng no-candidates (tay biến mất) vượt continuityTimeoutMs, rồi tay
    // xuất hiện lại rất gần vị trí cũ. Lịch sử đã quá cũ để tin là liên tục — phải "new" (không
    // có wristPosition cũ áp dụng được nữa), không phải "continued".
    const config = { ...DEFAULT_HAND_MATCH_CONFIG, continuityTimeoutMs: 300 };
    const result = matchHandsToPose(baseInput({
      handSampledAtMs: 1000, poseSampledAtMs: 1000,
      rawHands: [handCandidate(0, lm(0.705, 0.5), "left")], // rất gần wristPosition cũ (0.71).
      previous: { left: previousWrist(0.71, 0.5 / (VIDEO_WIDTH / VIDEO_HEIGHT), 500) }, // lastMatchedAtMs=500, cách hiện tại 500ms > 300ms timeout.
      config,
    }));
    expect(result.left.matched).toBe(true);
    expect(result.left.continuity).toBe("new");
    expect(result.left.matchChanged).toBe(true);
  });

  it("continuity history still valid (within continuityTimeoutMs) -> continued", () => {
    const config = { ...DEFAULT_HAND_MATCH_CONFIG, continuityTimeoutMs: 300 };
    const result = matchHandsToPose(baseInput({
      handSampledAtMs: 1000, poseSampledAtMs: 1000,
      rawHands: [handCandidate(0, lm(0.705, 0.5), "left")],
      previous: { left: previousWrist(0.71, 0.5 / (VIDEO_WIDTH / VIDEO_HEIGHT), 800) }, // chỉ cách 200ms, trong timeout.
      config,
    }));
    expect(result.left.matched).toBe(true);
    expect(result.left.continuity).toBe("continued");
    expect(result.left.matchChanged).toBe(false);
  });

  it("first-ever match with no previous state -> new, matchChanged=true", () => {
    const result = matchHandsToPose(baseInput({ rawHands: [handCandidate(0, lm(0.71, 0.5), "left")] }));
    expect(result.left.continuity).toBe("new");
    expect(result.left.matchChanged).toBe(true);
  });

  it("handednessScore is passed through correctly and null when unmatched", () => {
    const matched = matchHandsToPose(baseInput({ rawHands: [handCandidate(0, lm(0.71, 0.5), "left")] }));
    expect(matched.left.handednessScore).toBe(0.9);
    expect(matched.right.matched).toBe(false);
    expect(matched.right.handednessScore).toBeNull();

    const tooFar = matchHandsToPose(baseInput({ rawHands: [handCandidate(0, lm(0.05, 0.95), "left")] }));
    expect(tooFar.left.matched).toBe(false);
    expect(tooFar.left.handednessScore).toBeNull();
  });

  it("a lone hand candidate is never assigned to both sides", () => {
    const result = matchHandsToPose(baseInput({
      poseWristImage: { left: lm(0.51, 0.5), right: lm(0.49, 0.5) },
      rawHands: [handCandidate(0, lm(0.5, 0.5), "left")],
    }));
    const assignedSides = [result.left, result.right].filter((r) => r.matched);
    expect(assignedSides).toHaveLength(1);
  });
});
