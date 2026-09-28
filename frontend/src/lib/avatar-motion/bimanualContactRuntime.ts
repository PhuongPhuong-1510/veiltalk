import { Quaternion } from "three";
import type { AvatarFingerJointName, AvatarPoseJointNameV2, QuaternionData } from "./avatarPoseTypes";
import type { FingerRigProfile } from "./fingerRig";
import type { BimanualHandFeatures } from "./bimanualHandFeatures";
import type { BimanualGestureEvidence } from "./bimanualGestureEvidence";
import { BimanualHandTemporal, type BimanualTemporalSnapshot } from "./bimanualHandTemporal";

export interface BimanualContactDiagnostic extends BimanualTemporalSnapshot {
  correctionApplied: boolean;
  stabilizedJointCount: number;
  /** Final blend toward the low-pass stable continuous pose (small when observed, stronger in occlusion). */
  stabilizationInfluence: number;
}

export interface BimanualContactRuntimeInput {
  features: BimanualHandFeatures | null;
  evidence: BimanualGestureEvidence;
  sampledAtMs: number | null;
  nowMs: number;
  jointRotations: Partial<Record<AvatarPoseJointNameV2, QuaternionData>>;
  fingerRig: FingerRigProfile;
}

const blendQuaternion = (a: QuaternionData, b: QuaternionData, t: number): QuaternionData => {
  const qa = new Quaternion(a.x, a.y, a.z, a.w).normalize();
  const qb = new Quaternion(b.x, b.y, b.z, b.w).normalize();
  if (qa.dot(qb) < 0) qb.set(-qb.x, -qb.y, -qb.z, -qb.w);
  qa.slerp(qb, Math.max(0, Math.min(1, t))).normalize();
  return { x: qa.x, y: qa.y, z: qa.z, w: qa.w };
};

function controllableJoints(rig: FingerRigProfile): AvatarFingerJointName[] {
  return [rig.left, rig.right].flatMap((hand) =>
    hand.chains.flatMap((chain) => chain.segments.map((segment) => segment.joint))
  );
}

/**
 * M7/M8 hand↔hand runtime.
 *
 * It deliberately does not invent a HEART/INTERLACE preset. When both hands are observed it only
 * captures the continuous solution. During short two-hand occlusion, it blends current output back
 * toward that last trustworthy continuous solution. This is the safest useful correction possible
 * without model-space fingertip IK and prevents a brief MediaPipe collapse from exploding a contact.
 */
export class BimanualContactRuntime {
  private readonly temporal = new BimanualHandTemporal();
  private lastStableRotations = new Map<AvatarFingerJointName, QuaternionData>();
  private diagnosticState: BimanualContactDiagnostic = {
    mode: "none", confidence: 0, occluded: false, lastObservedAtMs: null, lastSampledAtMs: null,
    modeSinceMs: null, evidence: { heart: 0, palmsTogether: 0, clasp: 0, interlace: 0 }, features: null,
    correctionApplied: false, stabilizedJointCount: 0, stabilizationInfluence: 0,
  };

  reset(): void {
    this.temporal.reset();
    this.lastStableRotations.clear();
    this.diagnosticState = {
      mode: "none", confidence: 0, occluded: false, lastObservedAtMs: null, lastSampledAtMs: null,
      modeSinceMs: null, evidence: { heart: 0, palmsTogether: 0, clasp: 0, interlace: 0 }, features: null,
      correctionApplied: false, stabilizedJointCount: 0, stabilizationInfluence: 0,
    };
  }

  snapshot(): BimanualContactDiagnostic {
    return structuredClone(this.diagnosticState);
  }

  update(input: BimanualContactRuntimeInput): BimanualContactDiagnostic {
    const temporal = this.temporal.update(input.features, input.evidence, input.sampledAtMs, input.nowMs);
    const joints = controllableJoints(input.fingerRig);

    // Capture only when geometry is actually observed. Keep an EMA of the continuous solution:
    // it damps sub-frame landmark jitter without turning the interaction into a preset.
    if (temporal.mode !== "none" && !temporal.occluded && temporal.confidence >= 0.58 && input.features?.valid) {
      for (const joint of joints) {
        const rotation = input.jointRotations[joint];
        if (!rotation) continue;
        const previous = this.lastStableRotations.get(joint);
        this.lastStableRotations.set(joint, previous ? blendQuaternion(previous, rotation, 0.38) : { ...rotation });
      }
    }

    let stabilizedJointCount = 0;
    let correctionApplied = false;
    // Stronger preservation for topology-heavy clasp/interlace, lighter for heart/palms-together.
    const modeScale = temporal.mode === "interlace" ? 0.82
      : temporal.mode === "clasp" ? 0.72
      : temporal.mode === "heart" ? 0.58
      : temporal.mode === "palmsTogether" ? 0.52
      : 0;
    const stabilizationInfluence = temporal.mode === "none" ? 0 : temporal.occluded
      ? Math.max(0, Math.min(0.85, temporal.confidence * modeScale))
      // Live observations receive only micro-stabilization. Continuous tracking remains dominant.
      : Math.max(0, Math.min(0.14, temporal.confidence * modeScale * 0.16));

    if (stabilizationInfluence > 0 && this.lastStableRotations.size > 0) {
      for (const joint of joints) {
        const stable = this.lastStableRotations.get(joint);
        const current = input.jointRotations[joint];
        if (!stable || !current) continue;
        input.jointRotations[joint] = blendQuaternion(current, stable, stabilizationInfluence);
        stabilizedJointCount += 1;
        correctionApplied = true;
      }
    }

    if (temporal.mode === "none" && temporal.confidence <= 0.02) this.lastStableRotations.clear();

    this.diagnosticState = {
      ...temporal,
      correctionApplied,
      stabilizedJointCount,
      stabilizationInfluence,
    };
    return this.snapshot();
  }
}
