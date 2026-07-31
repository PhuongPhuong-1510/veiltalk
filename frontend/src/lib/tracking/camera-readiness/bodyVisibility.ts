import type { BodyRegionName, BodyVisibilitySnapshot, CameraReadinessEvidenceSnapshot, ReadinessEvidenceReason } from "./readinessTypes";

export interface BodyVisibilityConfig {
  weights: Record<Exclude<BodyRegionName, "left-hip" | "right-hip">, number>;
  visibilityLow: number;
  visibilityHigh: number;
  nearEdgeFactor: number;
  unknownVisibilityFactor: number;
}

export const DEFAULT_BODY_VISIBILITY_CONFIG: BodyVisibilityConfig = {
  weights: {
    face: 20,
    "left-shoulder": 10,
    "right-shoulder": 10,
    "left-elbow": 12.5,
    "right-elbow": 12.5,
    "left-wrist": 17.5,
    "right-wrist": 17.5,
  },
  visibilityLow: 0.5,
  visibilityHigh: 0.8,
  nearEdgeFactor: 0.5,
  unknownVisibilityFactor: 0,
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

function visibilityScore(value: number | null, config: BodyVisibilityConfig): number {
  if (value === null) return clamp01(config.unknownVisibilityFactor);
  if (config.visibilityHigh <= config.visibilityLow) return value >= config.visibilityHigh ? 1 : 0;
  return clamp01((value - config.visibilityLow) / (config.visibilityHigh - config.visibilityLow));
}

export function calculateBodyVisibility(
  evidence: CameraReadinessEvidenceSnapshot,
  config: BodyVisibilityConfig = DEFAULT_BODY_VISIBILITY_CONFIG,
): BodyVisibilitySnapshot {
  const unavailableReasons: ReadinessEvidenceReason[] = [];
  if (evidence.poseFreshness !== "fresh") unavailableReasons.push(evidence.poseFreshness === "stale" ? "stale" : "lost");
  if (!evidence.videoSize) unavailableReasons.push("missing-video-dimensions");
  if (unavailableReasons.length > 0) {
    return { bodyVisiblePercent: null, availability: "unavailable", regions: [], leftArmComplete: false, rightArmComplete: false, reasons: unavailableReasons };
  }

  const regions = evidence.regions.filter((region) => region.region in config.weights).map((region) => {
    const weight = config.weights[region.region as keyof typeof config.weights];
    const validity = region.imagePoint && !region.reasons.includes("non-finite-coordinate") && !region.reasons.includes("missing-landmarks") ? 1 : 0;
    const bounds = region.bounds === "inside" ? 1 : region.bounds === "near-edge" ? clamp01(config.nearEdgeFactor) : 0;
    const score = clamp01(validity * bounds * visibilityScore(region.visibility, config));
    return { region: region.region, weight, score, contribution: weight * score, reasons: [...region.reasons] };
  });
  const totalWeight = Object.values(config.weights).reduce((sum, weight) => sum + weight, 0);
  const totalContribution = regions.reduce((sum, region) => sum + region.contribution, 0);
  const byName = new Map(regions.map((region) => [region.region, region]));
  const complete = (side: "left" | "right") => ["shoulder", "elbow", "wrist"].every((part) => byName.get(`${side}-${part}` as BodyRegionName)?.score === 1);
  return {
    bodyVisiblePercent: totalWeight > 0 ? Math.min(100, Math.max(0, 100 * totalContribution / totalWeight)) : null,
    availability: totalWeight > 0 ? "available" : "unavailable",
    regions,
    leftArmComplete: complete("left"),
    rightArmComplete: complete("right"),
    reasons: [...new Set(regions.flatMap((region) => region.reasons).filter((reason) => reason !== "valid"))],
  };
}
