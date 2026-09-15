import { describe, expect, it } from "vitest";
import { computeGazeEyelidCoupling, NO_GAZE_EYELID_SUPPORT } from "./gazeEyelidCoupling";

const supported = { handlesVerticalEyelid: false, targets: { downLeft: true, downRight: true, upLeft: true, upRight: true } };

describe("computeGazeEyelidCoupling", () => {
  it("is N/A when LookAt owns eyelids or no verified target exists", () => {
    expect(computeGazeEyelidCoupling({ version: 1, yaw: 0, pitch: .8 }, { left: 0, right: 0 }, { ...supported, handlesVerticalEyelid: true })).toMatchObject({ status: "not-applicable", reason: "adapter-handles-eyelid", outputs: {} });
    expect(computeGazeEyelidCoupling({ version: 1, yaw: 0, pitch: .8 }, { left: 0, right: 0 }, NO_GAZE_EYELID_SUPPORT)).toMatchObject({ status: "not-applicable", reason: "no-production-safe-target" });
  });

  it("uses only dedicated verified semantics and lets blink suppress the same side", () => {
    const result = computeGazeEyelidCoupling({ version: 1, yaw: 0, pitch: -.8 }, { left: 1, right: 0 }, supported);
    expect(result.outputs).toEqual({ eyeLidDownLeft: 0, eyeLidDownRight: .14, eyeLidUpLeft: 0, eyeLidUpRight: 0 });
    expect(Object.keys(result.outputs)).not.toContain("blinkLeft"); expect(Object.keys(result.outputs)).not.toContain("eyeSquintLeft");
  });

  it("does not emit coupling without gaze", () => expect(computeGazeEyelidCoupling(null, { left: 0, right: 0 }, supported).status).toBe("no-gaze"));
});
