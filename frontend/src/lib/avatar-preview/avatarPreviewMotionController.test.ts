import { describe, expect, it } from "vitest";
import { previewBlinkValue } from "./avatarPreviewMotionController";

describe("previewBlinkValue", () => {
  it("closes and opens inside the blink window", () => {
    expect(previewBlinkValue(0)).toBe(0);
    expect(previewBlinkValue(0.1)).toBe(1);
    expect(previewBlinkValue(0.32)).toBe(0);
  });

  it("stays open for most of the cycle and repeats", () => {
    expect(previewBlinkValue(2)).toBe(0);
    expect(previewBlinkValue(4.8)).toBe(1);
  });
});
