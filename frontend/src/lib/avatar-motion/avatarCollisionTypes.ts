import type { Vector3Data } from "./avatarPoseTypes";
import type { ArmObservability } from "./armObservability";

export type AvatarCollisionBodyPart = "head" | "neck" | "torso" | "chestLeft" | "chestRight";
export type AvatarCollisionArmPart = "upperArm" | "forearm" | "hand";

export interface CollisionContact {
  bodyPart: AvatarCollisionBodyPart;
  armPart: AvatarCollisionArmPart;
  /** Signed surface separation. Negative values mean penetration. */
  signedDistance: number;
  penetrationDepth: number;
  closestPointArm: Vector3Data;
  closestPointBody: Vector3Data;
  /** Unit vector from the body collider toward the arm collider. */
  surfaceNormal: Vector3Data;
  normalizedPenetration: number;
  /** Contact position on the arm capsule: 0=start joint, 1=end joint. */
  armParameter: number;
}

export interface AvatarCollisionPose {
  shoulder: Vector3Data;
  elbow: Vector3Data;
  wrist: Vector3Data;
  /** Optional palm center. The wrist is used when it is unavailable. */
  hand?: Vector3Data;
  /** Actual rig palm probe; separate from the palm capsule endpoint. */
  palmCenter?: Vector3Data;
}

export interface AvatarCollisionCorrectionBudget {
  maxWristDisplacementPerFrame: number;
  maxElbowAngularCorrectionPerSecond: number;
  maxTotalCorrection: number;
  maxIterations: number;
  influence: number;
}

export interface AvatarCollisionCorrectionInput {
  side: "left" | "right";
  baseline: AvatarCollisionPose;
  deltaSeconds: number;
  observability: ArmObservability;
  /** Previous bend pole, or the baseline pole. Its hemisphere is never crossed. */
  bendPole: Vector3Data;
  budget: AvatarCollisionCorrectionBudget;
}

export interface AvatarCollisionCorrectionResult {
  pose: AvatarCollisionPose;
  baselinePreserved: boolean;
  resolved: boolean;
  reason: "no-collision" | "insufficient-evidence" | "resolved" | "partially-resolved" | "budget-exceeded" | "unreachable" | "topology-change";
  iterations: number;
  wristDisplacement: number;
  contactsBefore: CollisionContact[];
  contactsAfter: CollisionContact[];
}
