import type { QuaternionData, Vector3Data } from "./avatarPoseTypes";
import { inverseQuaternion, multiplyQuaternions } from "./motionMath";
import { clampRotationEllipsoid, quaternionLog } from "./quaternionDistribution";
import { semanticRotationToLocal, type UpperBodyLayer } from "./upperBodyComposer";
import type { UpperBodyRigProfileV1 } from "./upperBodyRigProfile";

const radians = (degrees: number) => degrees * Math.PI / 180;
const TOTAL_LIMITS = { yawLeft: radians(50), yawRight: radians(50), pitchUp: radians(25), pitchDown: radians(35), rollLeft: radians(25), rollRight: radians(25) };
const WEIGHTS = {
  chest: { x: .03, y: .04, z: .03 }, upperChest: { x: .06, y: .08, z: .06 },
  neck: { x: .26, y: .30, z: .24 }, head: { x: .65, y: .58, z: .67 },
} as const;
const INTENT_LIMITS = {
  chest: { yawLeft: radians(8), yawRight: radians(8), pitchUp: radians(6), pitchDown: radians(6), rollLeft: radians(5), rollRight: radians(5) },
  upperChest: { yawLeft: radians(8), yawRight: radians(8), pitchUp: radians(6), pitchDown: radians(6), rollLeft: radians(5), rollRight: radians(5) },
};

export interface HeadNeckSolveResult { layer: UpperBodyLayer; desired: Vector3Data | null; residual: Vector3Data }

/** Head solver vẫn là owner duy nhất; torso chỉ cung cấp final neutral-relative semantic delta. */
export function computeHeadRelativeIntent(faceDelta:QuaternionData|null,torsoParentDelta:QuaternionData|null):QuaternionData|null {
  if(!faceDelta)return null;
  return torsoParentDelta?multiplyQuaternions(inverseQuaternion(torsoParentDelta),faceDelta):faceDelta;
}

export function solveHeadNeckDistribution(intent: QuaternionData | null, profile: UpperBodyRigProfileV1): HeadNeckSolveResult {
  const raw = intent && quaternionLog(intent);
  const desired = raw && clampRotationEllipsoid(raw, TOTAL_LIMITS);
  const layer: UpperBodyLayer = {};
  const residual = { x: 0, y: 0, z: 0 };
  if (!desired) return { layer, desired: null, residual };
  const names = (Object.keys(WEIGHTS) as Array<keyof typeof WEIGHTS>).filter((name) => Boolean(profile.joints[name]));
  for (const component of ["x", "y", "z"] as const) {
    const weightSum = names.reduce((sum, name) => sum + WEIGHTS[name][component], 0);
    if (weightSum <= 1e-8) { residual[component] = desired[component]; continue; }
    for (const name of names) {
      const joint = profile.joints[name]!;
      const semantic = { x: 0, y: 0, z: 0 };
      semantic[component] = desired[component] * WEIGHTS[name][component] / weightSum;
      const limits = name === "chest" || name === "upperChest" ? INTENT_LIMITS[name] : joint.limits;
      const safe = clampRotationEllipsoid(semantic, limits)!;
      const contribution = semanticRotationToLocal(safe, joint);
      layer[name] = layer[name] ? multiply(layer[name]!, contribution) : contribution;
      residual[component] += semantic[component] - safe[component];
    }
  }
  return { layer, desired, residual };
}

function multiply(a: QuaternionData, b: QuaternionData): QuaternionData {
  const ax=a.x, ay=a.y, az=a.z, aw=a.w, bx=b.x, by=b.y, bz=b.z, bw=b.w;
  const value = { x: aw*bx+ax*bw+ay*bz-az*by, y: aw*by-ax*bz+ay*bw+az*bx, z: aw*bz+ax*by-ay*bx+az*bw, w: aw*bw-ax*bx-ay*by-az*bz };
  const length = Math.hypot(value.x,value.y,value.z,value.w) || 1;
  return { x:value.x/length,y:value.y/length,z:value.z/length,w:value.w/length };
}
