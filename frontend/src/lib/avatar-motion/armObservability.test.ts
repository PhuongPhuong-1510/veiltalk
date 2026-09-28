import { describe, expect, it } from "vitest";
import { classifyArmObservability } from "./armObservability";

describe("arm observability", () => {
  it.each([
    [true, true, true, "SEW"], [true, true, false, "SE-"], [true, false, true, "S-W"],
    [false, true, true, "-EW"], [true, false, false, "S--"], [false, true, false, "-E-"],
    [false, false, true, "--W"], [false, false, false, "---"],
  ] as const)("classifies %s %s %s as %s", (shoulder, elbow, wrist, mask) => {
    expect(classifyArmObservability({ shoulder, elbow, wrist }).mask).toBe(mask);
  });
});
