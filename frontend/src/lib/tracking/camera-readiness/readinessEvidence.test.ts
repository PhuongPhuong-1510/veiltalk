import { describe, expect, it } from "vitest";
import { createReadinessFixture } from "./readinessFixtures";
import { extractReadinessEvidence } from "./readinessEvidence";

describe("readiness evidence", () => {
  it("extracts deterministic fresh region evidence without raw landmark arrays", () => {
    const frame = createReadinessFixture("centered");
    const first = extractReadinessEvidence(frame, 1050);
    const second = extractReadinessEvidence(frame, 1050);
    expect(first).toEqual(second);
    expect(first.poseFreshness).toBe("fresh");
    expect(first.regions).toHaveLength(9);
    expect(first.regions.every((region) => region.available)).toBe(true);
    expect(JSON.stringify(first)).not.toContain("landmarks");
    expect(JSON.stringify(first)).not.toContain("worldLandmarks");
  });

  it("distinguishes not-sampled from lost and preserves cached evidence freshness", () => {
    const notSampled = extractReadinessEvidence(createReadinessFixture("pose-not-sampled"), 1050);
    const lost = extractReadinessEvidence(createReadinessFixture("pose-lost"), 1050);
    expect(notSampled.poseObservation).toBe("not-sampled");
    expect(notSampled.poseFreshness).toBe("fresh");
    expect(notSampled.regions[0].reasons).toContain("not-sampled");
    expect(lost.poseObservation).toBe("lost");
    expect(lost.poseFreshness).toBe("unavailable");
  });

  it("reports per-side outside bounds", () => {
    const snapshot = extractReadinessEvidence(createReadinessFixture("left-wrist-outside"), 1050);
    const left = snapshot.regions.find((region) => region.region === "left-wrist");
    const right = snapshot.regions.find((region) => region.region === "right-wrist");
    expect(left).toMatchObject({ bounds: "outside", available: false });
    expect(left?.reasons).toContain("outside-frame");
    expect(right).toMatchObject({ bounds: "inside", available: true });
  });

  it("contains invalid inputs and keeps light explicitly unobserved", () => {
    const snapshot = extractReadinessEvidence(createReadinessFixture("invalid"), 1050);
    expect(snapshot.videoSize).toBeNull();
    expect(snapshot.light).toEqual({ state: "not-observed" });
    expect(snapshot.regions.find((region) => region.region === "right-elbow")?.reasons).toContain("non-finite-coordinate");
    expect(JSON.stringify(snapshot)).not.toContain("NaN");
  });

  it("marks negative or old sample ages stale", () => {
    expect(extractReadinessEvidence(createReadinessFixture("centered", 1000), 999).poseFreshness).toBe("stale");
    expect(extractReadinessEvidence(createReadinessFixture("centered", 1000), 1200).poseFreshness).toBe("stale");
  });
});
