import type { ArmObservability } from "./armObservability";
import type { AvatarMotionOwnershipV1 } from "./avatarPoseTypes";

/** Contact solve and renderer clearance share one explicit final-correction policy. */
export function contactOwnsArm(ownership: AvatarMotionOwnershipV1 | undefined, side: "left" | "right"): boolean {
  return ownership?.version === 1 && ownership.contactArms[side] === true;
}

export function rendererClearanceMask(mask: ArmObservability, ownership: AvatarMotionOwnershipV1 | undefined, side: "left" | "right"): ArmObservability {
  return contactOwnsArm(ownership, side) ? "---" : mask;
}

export function processorOwnsJointTemporal(ownership: AvatarMotionOwnershipV1 | undefined, name: string): boolean {
  if (!ownership || ownership.version !== 1) return false;
  const side = name.startsWith("left") ? "left" : name.startsWith("right") ? "right" : null;
  return side !== null && (name.endsWith("UpperArm") || name.endsWith("LowerArm") || name.endsWith("Hand"))
    && (ownership.armTemporal === "processor" || contactOwnsArm(ownership, side));
}
