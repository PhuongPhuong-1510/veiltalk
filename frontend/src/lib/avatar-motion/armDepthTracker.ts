import { Vector3 } from "three";
import type { Vector3Data } from "./avatarPoseTypes";
import { generateWristDepthCandidates, type WristDepthCandidate, type WristDepthCandidateSet, type WristReconstructionResult } from "./wristReconstruction";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";

export type ArmDepthAnchorKind = "elbow" | "shoulder-shell";

export interface ArmDepthTrackerState {
  committedBranch: -1 | 1 | null;
  challengerBranch: -1 | 1 | null;
  challengerSamples: number;
  lastPoint: Vector3Data | null;
  velocity: Vector3Data;
  lastSampledAtMs: number | null;
  lastReachDistance: number | null;
  anchorKind: ArmDepthAnchorKind | null;
}

export interface ArmDepthTrackerConfig {
  switchScoreMargin: number;
  switchConfirmationSamples: number;
  maximumPredictionMs: number;
  continuityWeight: number;
  directionWeight: number;
  weakPoseWeight: number;
  velocityWeight: number;
  reachContinuityWeight: number;
  branchSwitchPenalty: number;
  staleHistoryMs: number;
  shellSampleCount: number;
}

export const DEFAULT_ARM_DEPTH_TRACKER_CONFIG: ArmDepthTrackerConfig = {
  switchScoreMargin: .12,
  switchConfirmationSamples: 2,
  maximumPredictionMs: 120,
  continuityWeight: .4,
  directionWeight: .6,
  weakPoseWeight: .12,
  velocityWeight: .2,
  reachContinuityWeight: .45,
  branchSwitchPenalty: .18,
  staleHistoryMs: 500,
  shellSampleCount: 7,
};

export const createArmDepthTrackerState = (): ArmDepthTrackerState => ({
  committedBranch: null, challengerBranch: null, challengerSamples: 0,
  lastPoint: null, velocity: { x: 0, y: 0, z: 0 }, lastSampledAtMs: null,
  lastReachDistance: null, anchorKind: null,
});

const point = (value: Vector3Data) => new Vector3(value.x, value.y, value.z);
const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

interface ScoredCandidate { candidate: WristDepthCandidate; generation: WristDepthCandidateSet; score: number }

export function generateReachShellCandidateSets(input: {
  anchorWorld: Vector3Data;
  anchorImage: RawNormalizedLandmarkV1;
  targetImage: RawNormalizedLandmarkV1;
  minimumDistance: number;
  maximumDistance: number;
  preferredDistance: number | null;
  imageToWorldScale: number;
  videoWidth: number;
  videoHeight: number;
  reachSlackRatio: number;
  sampleCount?: number;
  previousDistance?: number | null;
}): WristDepthCandidateSet[] {
  if (!(input.maximumDistance > 1e-6) || input.minimumDistance < 0 || input.minimumDistance > input.maximumDistance) return [];
  const probe = generateWristDepthCandidates({ ...input, targetDistance: input.maximumDistance });
  if (!probe.accepted) return [];
  const lower = Math.min(input.maximumDistance, Math.max(input.minimumDistance + 1e-6, probe.rawPlanarDistance ?? input.minimumDistance));
  const count = Math.max(3, Math.min(15, Math.round(input.sampleCount ?? DEFAULT_ARM_DEPTH_TRACKER_CONFIG.shellSampleCount)));
  const distances = new Set<number>();
  for (let index = 0; index < count; index += 1) distances.add(lower + (input.maximumDistance - lower) * index / (count - 1));
  for (const preferred of [input.preferredDistance, input.previousDistance]) if (preferred !== null && preferred !== undefined && Number.isFinite(preferred)) {
    distances.add(Math.max(lower, Math.min(input.maximumDistance, preferred)));
  }
  return [...distances].sort((a, b) => a - b).map(targetDistance => generateWristDepthCandidates({ ...input, targetDistance })).filter(value => value.accepted);
}

/**
 * Tracks the two discrete monocular depth branches. A challenger must win by a real margin on
 * consecutive detector samples; duplicate render frames never advance branch confirmation.
 */
export function updateArmDepthTracker(
  state: ArmDepthTrackerState,
  generated: WristDepthCandidateSet,
  input: {
    anchorWorld: Vector3Data;
    targetDistance: number;
    previousDirection: Vector3Data | null;
    weakPosePoint?: Vector3Data | null;
    sampledAtMs: number;
  },
  config: ArmDepthTrackerConfig = DEFAULT_ARM_DEPTH_TRACKER_CONFIG,
): WristReconstructionResult {
  return updateArmDepthTrackerCandidates(state, [generated], input, "elbow", config);
}

export function updateArmDepthTrackerCandidates(
  state: ArmDepthTrackerState,
  generations: WristDepthCandidateSet[],
  input: {
    anchorWorld: Vector3Data;
    targetDistance: number;
    previousDirection: Vector3Data | null;
    weakPosePoint?: Vector3Data | null;
    sampledAtMs: number;
  },
  anchorKind: ArmDepthAnchorKind,
  config: ArmDepthTrackerConfig = DEFAULT_ARM_DEPTH_TRACKER_CONFIG,
): WristReconstructionResult {
  const valid = generations.filter(value => value.accepted && value.candidates.length > 0);
  const fallback = generations[0];
  if (valid.length === 0 || !fallback) return {
    accepted: false, point: null, confidence: 0, feasibilityConfidence: fallback?.feasibilityConfidence ?? 0,
    imageToWorldScale: fallback?.imageToWorldScale ?? null, planarDistance: fallback?.planarDistance ?? null,
    depthDelta: null, reachViolation: fallback?.reachViolation ?? 0, projectedImage: fallback?.projectedImage ?? null,
    branchSeparation: fallback?.branchSeparation ?? 0, depthAmbiguity: 1, selectedBranch: null,
    candidates: fallback?.candidates ?? [], rejectionReason: fallback?.rejectionReason ?? "outside-reach-slack",
  };

  const anchor = point(input.anchorWorld);
  const dtMs = state.lastSampledAtMs === null ? 0 : Math.max(0, input.sampledAtMs - state.lastSampledAtMs);
  const historyFresh = state.lastPoint !== null && dtMs > 0 && dtMs <= config.staleHistoryMs;
  const predictionDt = Math.min(config.maximumPredictionMs, dtMs) / 1000;
  const predicted = historyFresh
    ? point(state.lastPoint!).addScaledVector(point(state.velocity), predictionDt)
    : null;
  const priorDirection = input.previousDirection ? point(input.previousDirection) : null;
  if (priorDirection && priorDirection.lengthSq() > 1e-8) priorDirection.normalize();
  const weakPose = input.weakPosePoint ? point(input.weakPosePoint) : null;

  const sameAnchorKind = state.anchorKind === null || state.anchorKind === anchorKind;
  const scored: ScoredCandidate[] = valid.flatMap(generation => generation.candidates.map(candidate => {
    const candidatePoint = point(candidate.point);
    const candidateScale = Math.max(1e-6, candidate.targetDistance);
    let score = predicted ? config.continuityWeight * candidatePoint.distanceTo(predicted) / candidateScale : 0;
    if (priorDirection && priorDirection.lengthSq() > 1e-8) {
      const direction = candidatePoint.clone().sub(anchor).normalize();
      score += config.directionWeight * (1 - direction.dot(priorDirection));
    }
    if (historyFresh && dtMs > 0) {
      const measuredVelocity = candidatePoint.clone().sub(point(state.lastPoint!)).multiplyScalar(1000 / dtMs);
      score += config.velocityWeight * measuredVelocity.distanceTo(point(state.velocity)) / Math.max(1e-6, candidateScale * 30);
    }
    if (weakPose) score += config.weakPoseWeight * candidatePoint.distanceTo(weakPose) / candidateScale;
    if (sameAnchorKind && state.lastReachDistance !== null) score += config.reachContinuityWeight * Math.abs(candidate.targetDistance - state.lastReachDistance) / candidateScale;
    if (sameAnchorKind && state.committedBranch !== null && candidate.branch !== state.committedBranch) score += config.branchSwitchPenalty;
    // Once an independent cue has produced a credible challenger, do not let the committed
    // branch's own predicted position erase it on the very next sample. Confirmation still
    // requires consecutive samples; this only removes the self-reinforcing topology feedback.
    if (state.challengerBranch === candidate.branch) score -= config.branchSwitchPenalty * 3;
    return { candidate, generation, score };
  })).sort((a, b) => a.score - b.score);

  const best = scored[0];
  const oppositeBest = scored.find(value => value.candidate.branch !== best.candidate.branch) ?? null;
  const margin = oppositeBest ? oppositeBest.score - best.score : 1;
  if (!sameAnchorKind) { state.committedBranch = best.candidate.branch; state.challengerBranch = null; state.challengerSamples = 0; }
  else if (state.committedBranch === null) state.committedBranch = best.candidate.branch;
  else if (best.candidate.branch !== state.committedBranch && margin >= config.switchScoreMargin) {
    if (state.challengerBranch === best.candidate.branch) state.challengerSamples += 1;
    else { state.challengerBranch = best.candidate.branch; state.challengerSamples = 1; }
    if (state.challengerSamples >= config.switchConfirmationSamples) {
      state.committedBranch = best.candidate.branch;
      state.challengerBranch = null;
      state.challengerSamples = 0;
    }
  } else {
    state.challengerBranch = null;
    state.challengerSamples = 0;
  }

  const selected = scored.find(value => value.candidate.branch === state.committedBranch) ?? best;
  const selectedPoint = point(selected.candidate.point);
  if (historyFresh) {
    const instantaneous = selectedPoint.clone().sub(point(state.lastPoint!)).multiplyScalar(1000 / dtMs);
    const alpha = .35;
    state.velocity = point(state.velocity).lerp(instantaneous, alpha);
  } else state.velocity = { x: 0, y: 0, z: 0 };
  state.lastPoint = selected.candidate.point;
  state.lastSampledAtMs = input.sampledAtMs;
  state.lastReachDistance = selected.candidate.targetDistance;
  state.anchorKind = anchorKind;

  const normalizedSeparation = clamp01(selected.generation.branchSeparation / (2 * selected.candidate.targetDistance));
  const evidenceStrength = clamp01(margin / Math.max(config.switchScoreMargin, 1e-6));
  // Ambiguity is high only when the branches are materially different AND evidence cannot
  // distinguish them. Coincident branches are harmless even if their scores tie.
  const depthAmbiguity = normalizedSeparation * (1 - evidenceStrength);
  const sameBranchRunnerUp = scored.find(value => value !== selected && value.candidate.branch === selected.candidate.branch);
  const reachDiscrimination = anchorKind === "shoulder-shell" && sameBranchRunnerUp
    ? clamp01((sameBranchRunnerUp.score - selected.score) / Math.max(config.switchScoreMargin, 1e-6)) : 1;
  const confidence = selected.generation.feasibilityConfidence * (1 - depthAmbiguity) * (.7 + .3 * reachDiscrimination);
  return {
    accepted: true, point: selected.candidate.point, confidence,
    feasibilityConfidence: selected.generation.feasibilityConfidence,
    imageToWorldScale: selected.generation.imageToWorldScale, planarDistance: selected.generation.planarDistance,
    depthDelta: selected.candidate.depthDelta, reachViolation: selected.generation.reachViolation,
    projectedImage: selected.generation.projectedImage, branchSeparation: selected.generation.branchSeparation,
    depthAmbiguity, selectedBranch: selected.candidate.branch, candidates: scored.map(value => value.candidate),
    rejectionReason: null,
  };
}
