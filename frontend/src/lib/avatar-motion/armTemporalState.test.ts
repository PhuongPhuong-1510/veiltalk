import { Quaternion, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { createArmTemporalState, updateArmTemporalOutput } from "./armTemporalState";

const rotation = (angle: number) => { const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), angle); return { x: q.x, y: q.y, z: q.z, w: q.w }; };
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

