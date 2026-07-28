import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createArmTemporalState, createSegmentTemporalState, updateArmTemporalOutput, updateSegmentTemporalOutput } from "./armTemporalState";

const rotation = (angle: number) => { const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle); return { x: q.x, y: q.y, z: q.z, w: q.w }; };
const negate = (q: { x: number; y: number; z: number; w: number }) => ({ x: -q.x, y: -q.y, z: -q.z, w: -q.w });
describe("arm hold, return and recovery", () => {
  it("holds, returns to identity, remains idle, then recovers without a snap", () => {
    const state = createArmTemporalState(); const target = { leftUpperArm: rotation(1), leftLowerArm: rotation(.5) };
    expect(updateArmTemporalOutput("left", state, target, true, 0, 100, 200, 100).state).toBe("active");
    expect(updateArmTemporalOutput("left", state, null, false, 50, 100, 200, 100).state).toBe("held");
    const returning = updateArmTemporalOutput("left", state, null, false, 200, 100, 200, 100); expect(returning.state).toBe("returning"); expect(returning.output.leftUpperArm!.w).toBeGreaterThan(target.leftUpperArm.w);
    const idle = updateArmTemporalOutput("left", state, null, false, 400, 100, 200, 100); expect(idle.state).toBe("idle"); expect(idle.output.leftUpperArm).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    const recoveryStart = updateArmTemporalOutput("left", state, target, true, 410, 100, 200, 100); expect(recoveryStart.state).toBe("recovering"); expect(recoveryStart.output.leftUpperArm).toEqual(idle.output.leftUpperArm);
    const recoveryEnd = updateArmTemporalOutput("left", state, target, true, 510, 100, 200, 100); expect(recoveryEnd.state).toBe("active");
  });
});

describe("Mức 1B-1: quaternion hemisphere continuity trong updateSegmentTemporalOutput", () => {
  it("keeps output continuous when the solver flips sign for the same rotation on consecutive frames", () => {
    // q và -q biểu diễn CÙNG một rotation. Nếu solver (nguồn ngoài, không kiểm soát được dấu
    // nó chọn) trả về dấu khác nhau giữa hai frame liên tiếp cho cùng một góc thật, output
    // không được nhảy — phải phát hiện và đảo dấu lại cho liên tục.
    const state = createSegmentTemporalState();
    const angle = rotation(0.6);
    const first = updateSegmentTemporalOutput(state, angle, true, 0, 250, 500, 180);
    expect(first.output).toEqual(angle);

    const flipped = negate(rotation(0.62)); // gần như cùng góc, nhưng solver trả dấu ngược
    const second = updateSegmentTemporalOutput(state, flipped, true, 33, 250, 500, 180);
    // Không được bằng `flipped` (dấu âm) — phải được đảo lại về cùng hemisphere với frame trước.
    expect(second.output.w).toBeGreaterThan(0);
    // Khoảng cách góc thực tế giữa hai frame chỉ ~0.02 rad — output phải phản ánh đúng điều đó,
    // không phải gần 180° (dấu hiệu của một cú snap do không xử lý hemisphere).
    const q1 = new Quaternion(first.output.x, first.output.y, first.output.z, first.output.w);
    const q2 = new Quaternion(second.output.x, second.output.y, second.output.z, second.output.w);
    expect(q1.angleTo(q2)).toBeLessThan(0.05);
  });

  it("keeps lastValidDelta continuous with the previous output so a later hold does not snap to the flipped sign", () => {
    // `state.lastValidDelta` (dùng cho nhánh hold/return khi mất tracking) phải lưu bản đã
    // đưa về cùng hemisphere, không phải giá trị thô solver trả — nếu không, hold ngay sau
    // một frame bị flip sẽ đứng yên ở dấu sai, dù chính frame đó output đã đúng.
    const state = createSegmentTemporalState();
    updateSegmentTemporalOutput(state, rotation(0.6), true, 0, 250, 500, 180, 80);
    const flipped = negate(rotation(0.62));
    const flippedFrame = updateSegmentTemporalOutput(state, flipped, true, 33, 250, 500, 180, 80);
    const held = updateSegmentTemporalOutput(state, null, false, 100, 250, 500, 180, 80);
    expect(held.state).toBe("active"); // lostFor=67ms trong invalidGraceMs=80ms
    expect(held.output).toEqual(flippedFrame.output);
    expect(held.output.w).toBeGreaterThan(0);
  });
});

