import { describe, expect, it } from "vitest";
import { WristDepthMemory } from "./wristDepthMemory";

describe("wrist depth lifetime", () => {
  it("keeps a fresh hemisphere only for the matching anchor", () => {
    const memory = new WristDepthMemory(); memory.observe(-.1, 100, "elbow");
    expect(memory.preferred(200, "elbow")).toBe(-1);
    expect(memory.preferred(200, "shoulder")).toBeNull();
    expect(memory.preferred(99, "elbow")).toBeNull();
    expect(memory.preferred(701, "elbow")).toBeNull();
  });
  it("inference cannot renew trust indefinitely, and fresh evidence may change sign", () => {
    const memory = new WristDepthMemory(); memory.observe(-.1, 100, "elbow");
    for (let at = 200; at <= 800; at += 100) memory.accept(-1, at, "elbow", 1, .2);
    expect(memory.preferred(800, "elbow")).toBeNull();
    memory.observe(.15, 810, "elbow"); expect(memory.preferred(810, "elbow")).toBe(1);
    memory.reset(); expect(memory.preferred(810, "elbow")).toBeNull();
  });
});
