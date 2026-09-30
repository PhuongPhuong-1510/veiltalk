import type { RawHandCandidateV1, RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { ArmSide } from "./avatarMotionDiagnostics";

/**
 * Hand Landmarker candidate ↔ Pose wrist matching in image space.
 * World coordinates are intentionally not compared because Pose World and Hand World do not share
 * a guaranteed origin/scale. All distances are aspect-corrected normalized-image distances.
 */

export type HandMatchRejectionReason =
  | "no-candidates"
  | "wrist-distance-too-large"
  | "stale-frame"
  | "non-finite";

export interface HandMatchImagePoint { x: number; y: number }

export interface HandMatchConfig {
  maxWristDistance: number;
  maxHandAgeMs: number;
  handednessMismatchPenalty: number;
  continuityBonusWeight: number;
  continuityMaxDistance: number;
  continuityTimeoutMs: number;
  /** Minimum cost improvement required before a two-hand assignment may swap identities. */
  identitySwitchMargin?: number;
  /** Known-side separation required before the remaining candidate can bootstrap a missing side. */
  bimanualBootstrapKnownSideMargin?: number;
  /** A strongly contradictory handedness label blocks bootstrap. */
  bimanualBootstrapRejectMismatchScore?: number;
}

export const DEFAULT_HAND_MATCH_CONFIG: HandMatchConfig = {
  maxWristDistance: 0.35,
  maxHandAgeMs: 200,
  handednessMismatchPenalty: 0.08,
  continuityBonusWeight: 0.05,
  continuityMaxDistance: 0.25,
  continuityTimeoutMs: 1000,
  identitySwitchMargin: 0.055,
  bimanualBootstrapKnownSideMargin: 0.035,
  bimanualBootstrapRejectMismatchScore: 0.8,
};

export interface HandMatchPreviousState {
  wristPosition: HandMatchImagePoint | null;
  lastMatchedAtMs: number | null;
}

export type HandMatchContinuity = "unmatched" | "new" | "continued" | "reacquired";
export type HandMatchSource = "pose" | "continuity" | "bimanual-bootstrap";

export interface HandSideMatchResult {
  side: ArmSide;
  matched: boolean;
  candidateArrayIndex: number | null;
  candidateSourceIndex: number | null;
  distance: number | null;
  handedness: RawHandCandidateV1["handedness"] | null;
  handednessScore: number | null;
  rejectionReason: HandMatchRejectionReason | null;
  continuity: HandMatchContinuity;
  matchChanged: boolean;
  /** Explicit quality so bootstrap does not have to fake a Pose-wrist distance. */
  matchQuality?: number;
  matchSource?: HandMatchSource;
}

export interface HandPoseMatchResult {
  ranMatching: boolean;
  left: HandSideMatchResult;
  right: HandSideMatchResult;
}

interface CandidateInfo {
  arrayIndex: number;
  sourceIndex: number;
  wristPoint: HandMatchImagePoint;
  handedness: RawHandCandidateV1["handedness"];
  candidate: RawHandCandidateV1;
}

interface AssignmentEntry { arrayIndex: number; cost: number }
type Assignment = Record<ArmSide, AssignmentEntry | null>;

const SIDES: readonly ArmSide[] = ["left", "right"];
const HANDEDNESS_FOR_SIDE: Record<ArmSide, RawHandCandidateV1["handedness"]> = { left: "left", right: "right" };
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function aspectCorrectedPoint(point: RawNormalizedLandmarkV1, videoWidth: number, videoHeight: number): HandMatchImagePoint {
  const aspect = videoHeight > 0 ? videoWidth / videoHeight : 1;
  return { x: point.x, y: point.y / aspect };
}

function isFinitePoint(point: HandMatchImagePoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function pointDistance(a: HandMatchImagePoint, b: HandMatchImagePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function candidateHandednessCompatibility(side: ArmSide, candidate: CandidateInfo): number | null {
  if (candidate.handedness === "unknown" || candidate.candidate.handednessScore === null || !Number.isFinite(candidate.candidate.handednessScore)) return null;
  const score = clamp01(candidate.candidate.handednessScore);
  return candidate.handedness === HANDEDNESS_FOR_SIDE[side] ? score : 1 - score;
}

function assignmentCost(
  side: ArmSide,
  candidate: CandidateInfo,
  target: HandMatchImagePoint,
  previous: HandMatchPreviousState | undefined,
  config: HandMatchConfig,
): number {
  let cost = pointDistance(candidate.wristPoint, target);
  if (candidate.handedness !== "unknown" && candidate.handedness !== HANDEDNESS_FOR_SIDE[side]) {
    // Strong detector labels carry more weight, but handedness remains soft because mirroring and
    // detector label errors must never hard-flip a geometrically clear assignment.
    const detectorScore = candidate.candidate.handednessScore;
    const strength = detectorScore === null || !Number.isFinite(detectorScore) ? 0.5 : 0.35 + 0.65 * clamp01(detectorScore);
    cost += config.handednessMismatchPenalty * strength;
  }
  if (previous?.wristPosition) {
    const continuityDistance = pointDistance(candidate.wristPoint, previous.wristPosition);
    if (continuityDistance <= config.continuityMaxDistance) {
      cost -= config.continuityBonusWeight * (1 - continuityDistance / config.continuityMaxDistance);
    }
  }
  return cost;
}

function rejectedResult(side: ArmSide, reason: HandMatchRejectionReason): HandSideMatchResult {
  return {
    side, matched: false, candidateArrayIndex: null, candidateSourceIndex: null, distance: null,
    handedness: null, handednessScore: null, rejectionReason: reason,
    continuity: "unmatched", matchChanged: false, matchQuality: 0,
  };
}

function assignmentStats(
  assignment: Assignment,
  candidates: CandidateInfo[],
  targets: Record<ArmSide, HandMatchImagePoint | null>,
  previous: Record<ArmSide, HandMatchPreviousState | undefined>,
  config: HandMatchConfig,
): { feasible: boolean; matchCount: number; totalCost: number } {
  let matchCount = 0;
  let totalCost = 0;
  const used = new Set<number>();
  for (const side of SIDES) {
    const entry = assignment[side];
    const target = targets[side];
    if (!entry || !target) continue;
    if (used.has(entry.arrayIndex)) return { feasible: false, matchCount: 0, totalCost: Infinity };
    used.add(entry.arrayIndex);
    const candidate = candidates.find((value) => value.arrayIndex === entry.arrayIndex);
    if (!candidate) return { feasible: false, matchCount: 0, totalCost: Infinity };
    const cost = assignmentCost(side, candidate, target, previous[side], config);
    if (cost > config.maxWristDistance) return { feasible: false, matchCount: 0, totalCost: Infinity };
    matchCount += 1;
    totalCost += cost;
  }
  return { feasible: true, matchCount, totalCost };
}

function bestAssignment(
  candidates: CandidateInfo[],
  targets: Record<ArmSide, HandMatchImagePoint | null>,
  previous: Record<ArmSide, HandMatchPreviousState | undefined>,
  config: HandMatchConfig,
): Assignment {
  let best: Assignment = { left: null, right: null };
  let bestMatchCount = -1;
  let bestTotalCost = Infinity;
  const options: Array<number | null> = [null, ...candidates.map((candidate) => candidate.arrayIndex)];

  for (const leftChoice of options) {
    for (const rightChoice of options) {
      if (leftChoice !== null && leftChoice === rightChoice) continue;
      const candidateAssignment: Assignment = {
        left: leftChoice === null ? null : { arrayIndex: leftChoice, cost: 0 },
        right: rightChoice === null ? null : { arrayIndex: rightChoice, cost: 0 },
      };
      const stats = assignmentStats(candidateAssignment, candidates, targets, previous, config);
      if (!stats.feasible) continue;
      if (stats.matchCount > bestMatchCount || (stats.matchCount === bestMatchCount && stats.totalCost < bestTotalCost)) {
        bestMatchCount = stats.matchCount;
        bestTotalCost = stats.totalCost;
        best = candidateAssignment;
      }
    }
  }

  for (const side of SIDES) {
    const entry = best[side];
    const target = targets[side];
    if (!entry || !target) continue;
    const candidate = candidates.find((value) => value.arrayIndex === entry.arrayIndex)!;
    entry.cost = assignmentCost(side, candidate, target, previous[side], config);
  }
  return best;
}

function previousStillUsable(previous: HandMatchPreviousState | undefined, sampledAtMs: number | null, config: HandMatchConfig): boolean {
  return Boolean(
    previous?.wristPosition && previous.lastMatchedAtMs !== null && sampledAtMs !== null &&
    sampledAtMs - previous.lastMatchedAtMs <= config.continuityTimeoutMs,
  );
}

/**
 * Preserve left/right identity through wrist crossings. If the globally cheapest assignment wants
 * to swap both candidates but the frame-continuity assignment is still feasible, the new assignment
 * must win by a real margin rather than by sub-pixel noise.
 */
function stabilizeBimanualIdentity(
  best: Assignment,
  candidates: CandidateInfo[],
  targets: Record<ArmSide, HandMatchImagePoint | null>,
  previous: Record<ArmSide, HandMatchPreviousState | undefined>,
  sampledAtMs: number | null,
  config: HandMatchConfig,
): Assignment {
  if (candidates.length !== 2 || !targets.left || !targets.right) return best;
  if (!previousStillUsable(previous.left, sampledAtMs, config) || !previousStillUsable(previous.right, sampledAtMs, config)) return best;

  const nearestLeft = [...candidates].sort((a, b) => pointDistance(a.wristPoint, previous.left!.wristPosition!) - pointDistance(b.wristPoint, previous.left!.wristPosition!))[0];
  const nearestRight = [...candidates].sort((a, b) => pointDistance(a.wristPoint, previous.right!.wristPosition!) - pointDistance(b.wristPoint, previous.right!.wristPosition!))[0];
  if (!nearestLeft || !nearestRight || nearestLeft.arrayIndex === nearestRight.arrayIndex) return best;

  const continuityAssignment: Assignment = {
    left: { arrayIndex: nearestLeft.arrayIndex, cost: 0 },
    right: { arrayIndex: nearestRight.arrayIndex, cost: 0 },
  };
  const continuityStats = assignmentStats(continuityAssignment, candidates, targets, previous, config);
  if (!continuityStats.feasible || continuityStats.matchCount !== 2) return best;
  const bestStats = assignmentStats(best, candidates, targets, previous, config);
  if (!bestStats.feasible || bestStats.matchCount !== 2) return continuityAssignment;

  const bestIsDifferent = best.left?.arrayIndex !== continuityAssignment.left?.arrayIndex || best.right?.arrayIndex !== continuityAssignment.right?.arrayIndex;
  if (!bestIsDifferent) return best;
  const margin = config.identitySwitchMargin ?? DEFAULT_HAND_MATCH_CONFIG.identitySwitchMargin ?? 0.055;
  return bestStats.totalCost + margin < continuityStats.totalCost ? best : continuityAssignment;
}

/**
 * If exactly one Pose wrist is temporarily missing but Hand Landmarker still sees exactly two
 * candidates, assign the geometrically clear candidate to the known side and use the remaining
 * candidate for the missing side. This is deliberately unavailable when the known side itself is
 * ambiguous or when a strong handedness label contradicts the missing side.
 */
function bootstrapMissingBimanualSide(
  assignment: Assignment,
  candidates: CandidateInfo[],
  targets: Record<ArmSide, HandMatchImagePoint | null>,
  previous: Record<ArmSide, HandMatchPreviousState | undefined>,
  config: HandMatchConfig,
): { assignment: Assignment; bootstrapSide: ArmSide | null; bootstrapQuality: number } {
  if (candidates.length !== 2) return { assignment, bootstrapSide: null, bootstrapQuality: 0 };
  const knownSide: ArmSide | null = targets.left && !targets.right ? "left" : targets.right && !targets.left ? "right" : null;
  if (!knownSide) return { assignment, bootstrapSide: null, bootstrapQuality: 0 };
  const missingSide: ArmSide = knownSide === "left" ? "right" : "left";
  const knownTarget = targets[knownSide]!;

  const ranked = candidates
    .map((candidate) => ({ candidate, cost: assignmentCost(knownSide, candidate, knownTarget, previous[knownSide], config) }))
    .filter((item) => item.cost <= config.maxWristDistance)
    .sort((a, b) => a.cost - b.cost);
  if (ranked.length === 0) return { assignment, bootstrapSide: null, bootstrapQuality: 0 };

  const bestKnown = ranked[0];
  const secondKnown = ranked[1] ?? null;
  const separation = secondKnown ? secondKnown.cost - bestKnown.cost : config.maxWristDistance;
  const requiredMargin = config.bimanualBootstrapKnownSideMargin ?? DEFAULT_HAND_MATCH_CONFIG.bimanualBootstrapKnownSideMargin ?? 0.035;
  if (secondKnown && separation < requiredMargin) return { assignment, bootstrapSide: null, bootstrapQuality: 0 };

  const remaining = candidates.find((candidate) => candidate.arrayIndex !== bestKnown.candidate.arrayIndex);
  if (!remaining) return { assignment, bootstrapSide: null, bootstrapQuality: 0 };
  const compatibility = candidateHandednessCompatibility(missingSide, remaining);
  const rejectMismatchScore = config.bimanualBootstrapRejectMismatchScore ?? DEFAULT_HAND_MATCH_CONFIG.bimanualBootstrapRejectMismatchScore ?? 0.8;
  if (remaining.handedness !== "unknown" && remaining.handedness !== HANDEDNESS_FOR_SIDE[missingSide]
      && remaining.candidate.handednessScore !== null && Number.isFinite(remaining.candidate.handednessScore)
      && remaining.candidate.handednessScore >= rejectMismatchScore) {
    return { assignment, bootstrapSide: null, bootstrapQuality: 0 };
  }

  const knownQuality = clamp01(1 - bestKnown.cost / config.maxWristDistance);
  const separationQuality = clamp01(separation / Math.max(requiredMargin * 2, 1e-6));
  const handednessQuality = compatibility ?? 0.65;
  // Conservative but enough to enter twist confidence when palm geometry/timestamps are strong.
  const bootstrapQuality = Math.min(0.82, clamp01(0.48 + 0.22 * knownQuality + 0.18 * separationQuality + 0.12 * handednessQuality));
  const next: Assignment = {
    ...assignment,
    [knownSide]: { arrayIndex: bestKnown.candidate.arrayIndex, cost: bestKnown.cost },
    [missingSide]: { arrayIndex: remaining.arrayIndex, cost: config.maxWristDistance * (1 - bootstrapQuality) },
  };
  return { assignment: next, bootstrapSide: missingSide, bootstrapQuality };
}

export interface MatchHandsToPoseInput {
  handSampledThisFrame: boolean;
  rawHands: RawHandCandidateV1[];
  poseWristImage: { left: RawNormalizedLandmarkV1 | null; right: RawNormalizedLandmarkV1 | null };
  poseSampledAtMs: number | null;
  handSampledAtMs: number | null;
  videoWidth: number;
  videoHeight: number;
  previous: { left?: HandMatchPreviousState; right?: HandMatchPreviousState };
  config?: HandMatchConfig;
}

export function matchHandsToPose(input: MatchHandsToPoseInput): HandPoseMatchResult {
  const config = input.config ?? DEFAULT_HAND_MATCH_CONFIG;
  if (!input.handSampledThisFrame) {
    return { ranMatching: false, left: rejectedResult("left", "no-candidates"), right: rejectedResult("right", "no-candidates") };
  }
  if (input.rawHands.length === 0) {
    return { ranMatching: true, left: rejectedResult("left", "no-candidates"), right: rejectedResult("right", "no-candidates") };
  }
  if (input.poseSampledAtMs !== null && input.handSampledAtMs !== null && Math.abs(input.poseSampledAtMs - input.handSampledAtMs) > config.maxHandAgeMs) {
    return { ranMatching: true, left: rejectedResult("left", "stale-frame"), right: rejectedResult("right", "stale-frame") };
  }

  const candidates: CandidateInfo[] = [];
  input.rawHands.forEach((candidate, arrayIndex) => {
    const wrist = candidate.landmarks[0];
    if (!wrist) return;
    const wristPoint = aspectCorrectedPoint(wrist, input.videoWidth, input.videoHeight);
    if (!isFinitePoint(wristPoint)) return;
    candidates.push({ arrayIndex, sourceIndex: candidate.sourceIndex, wristPoint, handedness: candidate.handedness, candidate });
  });
  if (candidates.length === 0) {
    return { ranMatching: true, left: rejectedResult("left", "non-finite"), right: rejectedResult("right", "non-finite") };
  }

  const poseWrists: Record<ArmSide, HandMatchImagePoint | null> = {
    left: input.poseWristImage.left ? aspectCorrectedPoint(input.poseWristImage.left, input.videoWidth, input.videoHeight) : null,
    right: input.poseWristImage.right ? aspectCorrectedPoint(input.poseWristImage.right, input.videoWidth, input.videoHeight) : null,
  };
  if (poseWrists.left && !isFinitePoint(poseWrists.left)) poseWrists.left = null;
  if (poseWrists.right && !isFinitePoint(poseWrists.right)) poseWrists.right = null;

  const previous: Record<ArmSide, HandMatchPreviousState | undefined> = { left: input.previous.left, right: input.previous.right };
  const continuityUsable = (side: ArmSide): boolean => previousStillUsable(previous[side], input.handSampledAtMs, config);
  const matchingTargets: Record<ArmSide, HandMatchImagePoint | null> = {
    left: poseWrists.left ?? (continuityUsable("left") ? previous.left!.wristPosition : null),
    right: poseWrists.right ?? (continuityUsable("right") ? previous.right!.wristPosition : null),
  };

  let assignment = bestAssignment(candidates, matchingTargets, previous, config);
  assignment = stabilizeBimanualIdentity(assignment, candidates, matchingTargets, previous, input.handSampledAtMs, config);
  const bootstrap = bootstrapMissingBimanualSide(assignment, candidates, matchingTargets, previous, config);
  assignment = bootstrap.assignment;

  const buildSideResult = (side: ArmSide): HandSideMatchResult => {
    const isBootstrap = bootstrap.bootstrapSide === side;
    const target = matchingTargets[side];
    const chosen = assignment[side];
    if (!chosen) return rejectedResult(side, target === null ? "non-finite" : "wrist-distance-too-large");
    if (target === null && !isBootstrap) return rejectedResult(side, "non-finite");
    const candidate = candidates.find((value) => value.arrayIndex === chosen.arrayIndex);
    if (!candidate) return rejectedResult(side, "non-finite");

    const previousState = previous[side];
    const previousWrist = previousState?.wristPosition ?? null;
    const continuityExpired = Boolean(previousState && previousState.lastMatchedAtMs !== null && input.handSampledAtMs !== null
      && input.handSampledAtMs - previousState.lastMatchedAtMs > config.continuityTimeoutMs);
    const continuity: HandMatchContinuity = !previousWrist || continuityExpired
      ? "new"
      : pointDistance(candidate.wristPoint, previousWrist) <= config.continuityMaxDistance ? "continued" : "reacquired";

    const distance = target ? pointDistance(candidate.wristPoint, target) : null;
    const matchQuality = isBootstrap
      ? bootstrap.bootstrapQuality
      : distance === null ? 0 : clamp01(1 - distance / config.maxWristDistance);
    const matchSource: HandMatchSource = isBootstrap ? "bimanual-bootstrap" : poseWrists[side] ? "pose" : "continuity";

    return {
      side,
      matched: true,
      candidateArrayIndex: candidate.arrayIndex,
      candidateSourceIndex: candidate.sourceIndex,
      distance,
      handedness: candidate.handedness,
      handednessScore: candidate.candidate.handednessScore,
      rejectionReason: null,
      continuity,
      matchChanged: continuity !== "continued",
      matchQuality,
      matchSource,
    };
  };

  return { ranMatching: true, left: buildSideResult("left"), right: buildSideResult("right") };
}
