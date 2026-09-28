export type ArmObservability = "SEW" | "SE-" | "S-W" | "-EW" | "S--" | "-E-" | "--W" | "---";

export interface ArmJointAvailability {
  shoulder: boolean;
  elbow: boolean;
  wrist: boolean;
}

export interface ArmObservabilityResult {
  mask: ArmObservability;
  observedJointCount: number;
  degreesOfFreedomUnknown: number;
  geometryRecoverable: boolean;
  topologyObservable: boolean;
}

const UNKNOWN_DOF: Record<ArmObservability, number> = {
  SEW: 0, "SE-": 2, "S-W": 1, "-EW": 3,
  "S--": 4, "-E-": 6, "--W": 4, "---": 7,
};

/** Classifies evidence only. Derived estimates must never be marked observed here. */
export function classifyArmObservability(availability: ArmJointAvailability): ArmObservabilityResult {
  const mask = `${availability.shoulder ? "S" : "-"}${availability.elbow ? "E" : "-"}${availability.wrist ? "W" : "-"}` as ArmObservability;
  const observedJointCount = Number(availability.shoulder) + Number(availability.elbow) + Number(availability.wrist);
  return {
    mask,
    observedJointCount,
    degreesOfFreedomUnknown: UNKNOWN_DOF[mask],
    geometryRecoverable: mask === "SEW" || mask === "SE-" || mask === "S-W" || mask === "-EW",
    topologyObservable: mask === "SEW",
  };
}
