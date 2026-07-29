import { describe, expect, it } from "vitest";
import { selectGazeCapability } from "./gazeCapability";
describe("gaze capability", () => {
  it("selects exactly one controller in deterministic priority", () => {
    expect(selectGazeCapability({ hasVrmLookAt: true, expressions: ["lookLeft"], hasLeftEyeBone: true, hasRightEyeBone: true }).mode).toBe("vrm-look-at");
    expect(selectGazeCapability({ hasVrmLookAt: false, expressions: ["lookLeft"], hasLeftEyeBone: true, hasRightEyeBone: true }).mode).toBe("eye-morph");
    expect(selectGazeCapability({ hasVrmLookAt: false, expressions: [], hasLeftEyeBone: true, hasRightEyeBone: true }).mode).toBe("eye-bones");
    expect(selectGazeCapability({ hasVrmLookAt: false, expressions: [], hasLeftEyeBone: true, hasRightEyeBone: false }).mode).toBe("unsupported");
  });
});
