import { describe, expect, it, vi } from "vitest";
import { AnimationFrameLoop } from "./animationFrameLoop";

describe("AnimationFrameLoop", () => {
  it("does not create duplicate rAF and cancels the owned frame", () => {
    const request = vi.fn(() => 7); const cancel = vi.fn(); const loop = new AnimationFrameLoop(vi.fn(), request, cancel);
    loop.start(); loop.start(); expect(request).toHaveBeenCalledTimes(1); loop.stop(); expect(cancel).toHaveBeenCalledWith(7); expect(loop.running).toBe(false);
  });
});
