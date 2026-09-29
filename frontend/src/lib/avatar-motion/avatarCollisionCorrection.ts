import { Vector3 } from "three";
import { solveContactArmIk } from "./contactArmIk";
import type { AvatarCollisionProfile } from "./avatarCollisionProfile";
import { queryAvatarArmBodyCollisions } from "./avatarCollisionQuery";
import type { AvatarCollisionCorrectionInput, AvatarCollisionCorrectionResult, AvatarCollisionPose } from "./avatarCollisionTypes";

const v = (p: {x:number;y:number;z:number}) => new Vector3(p.x, p.y, p.z);
const observedWeight = (mask: AvatarCollisionCorrectionInput["observability"]) => mask[2] === "W" ? (mask[1] === "E" ? .18 : .55) : 1;

/** Iterative, length-preserving correction. It returns the exact input pose whenever no contact exists. */
export function correctAvatarArmCollision(profile: AvatarCollisionProfile, input: AvatarCollisionCorrectionInput): AvatarCollisionCorrectionResult {
  const before = queryAvatarArmBodyCollisions(profile, input.side, input.baseline);
  if (!before.length) return { pose: input.baseline, baselinePreserved: true, resolved: true, reason: "no-collision", iterations: 0, wristDisplacement: 0, contactsBefore: [], contactsAfter: [] };
  // One or zero observed joints cannot establish motion intent. Collision remains diagnostic only;
  // it must not manufacture a new wrist target from an ambiguous/held arm.
  const observedJointCount = [...input.observability].filter((joint) => joint !== "-").length;
  if (observedJointCount < 2) return { pose: input.baseline, baselinePreserved: true, resolved: false,
    reason: "insufficient-evidence", iterations: 0, wristDisplacement: 0, contactsBefore: before, contactsAfter: before };
  const arm = profile.arms[input.side], shoulder = v(input.baseline.shoulder), baselineWrist = v(input.baseline.wrist),baselineElbowPoint=v(input.baseline.elbow);
  const baselinePole = v(input.bendPole).normalize(), baselineElbow = baselineElbowPoint.clone().sub(shoulder);
  const baselineAxis = baselineWrist.clone().sub(shoulder).normalize();
  const baselineHemisphere = baselineElbow.addScaledVector(baselineAxis, -baselineElbow.dot(baselineAxis)).dot(baselinePole);
  let pose: AvatarCollisionPose = input.baseline, contacts = before, target = baselineWrist.clone(),desiredElbow=baselineElbowPoint.clone();
  let bestPose = input.baseline, bestContacts = before, bestScore = collisionScore(before);
  const perFrame = Math.min(input.budget.maxWristDisplacementPerFrame, input.budget.maxElbowAngularCorrectionPerSecond * Math.max(0, input.deltaSeconds) * (arm.upperLength + arm.lowerLength));
  const limit = Math.max(0, Math.min(perFrame, input.budget.maxTotalCorrection));
  const influence = Math.max(0, Math.min(1, input.budget.influence * observedWeight(input.observability)));
  for (let iteration = 1; iteration <= Math.max(1, Math.min(4, input.budget.maxIterations)); iteration++) {
    // Project the deepest constraint, then re-run FK/query. Summing opposing normals can cancel
    // two severe contacts into a zero correction.
    const deepest = contacts[0];
    const correction = deepest ? v(deepest.surfaceNormal).multiplyScalar(deepest.penetrationDepth * influence) : new Vector3();
    if (correction.lengthSq() < 1e-12) break;
    const weights=projectionWeights(deepest.armPart,deepest.armParameter),wristCorrection=correction.clone().multiplyScalar(weights.wrist),elbowCorrection=correction.clone().multiplyScalar(weights.elbow);
    const wristRemaining=Math.max(0,limit-target.distanceTo(baselineWrist)),elbowRemaining=Math.max(0,limit-desiredElbow.distanceTo(baselineElbowPoint));
    if(wristCorrection.length()>wristRemaining)wristCorrection.setLength(wristRemaining);
    if(elbowCorrection.length()>elbowRemaining)elbowCorrection.setLength(elbowRemaining);
    if(wristCorrection.lengthSq()<1e-12&&elbowCorrection.lengthSq()<1e-12)return partialResult(iteration-1);
    target.add(wristCorrection);desiredElbow.add(elbowCorrection);
    const preferredPole=poleFromDesiredElbow(shoulder,target,desiredElbow,input.bendPole);
    const ik = solveContactArmIk({ shoulder: input.baseline.shoulder, wristTarget: {x:target.x,y:target.y,z:target.z}, upperLength: arm.upperLength, lowerLength: arm.lowerLength, preferredPole });
    if (!ik) return bestOr("unreachable", iteration - 1);
    // Small reach projection is the intended fail-soft behavior of the length-preserving IK.
    // Only reject when projection itself consumes the total correction budget.
    if (ik.projected && ik.targetError > input.budget.maxTotalCorrection) return bestOr("unreachable", iteration - 1);
    const axis = v(ik.wrist).sub(shoulder).normalize(), offset = v(ik.elbow).sub(shoulder); offset.addScaledVector(axis, -offset.dot(axis));
    if (baselineHemisphere * offset.dot(baselinePole) < -1e-8) return bestOr("topology-change", iteration - 1);
    pose = { ...input.baseline, elbow: ik.elbow, wrist: ik.wrist, ...(input.baseline.hand ? { hand: v(input.baseline.hand).add(v(ik.wrist).sub(baselineWrist)) } : {}) };
    contacts = queryAvatarArmBodyCollisions(profile, input.side, pose);
    const score = collisionScore(contacts);
    if (score < bestScore) { bestScore = score; bestPose = pose; bestContacts = contacts; }
    if (!contacts.length) return result("resolved", true, iteration);
  }
  return partialResult(input.budget.maxIterations);

  function partialResult(iterations: number): AvatarCollisionCorrectionResult {
    // A bounded improvement is safe to publish and can continue on the next render frame. Rejecting
    // every non-zero remainder made real mesh intersections permanent even while IK improved them.
    if (bestPose !== input.baseline && bestScore < collisionScore(before) - 1e-7) {
      pose = bestPose; contacts = bestContacts;
      return result("partially-resolved", false, iterations, true);
    }
    return result("budget-exceeded", false, iterations);
  }

  function bestOr(reason: "unreachable"|"topology-change", iterations: number): AvatarCollisionCorrectionResult {
    if (bestPose !== input.baseline && bestScore < collisionScore(before) - 1e-7) {
      pose=bestPose;contacts=bestContacts;return result("partially-resolved",false,iterations,true);
    }
    return result(reason,false,iterations);
  }

  function result(reason: AvatarCollisionCorrectionResult["reason"], resolved: boolean, iterations: number, publishPartial = false): AvatarCollisionCorrectionResult {
    const output = resolved || publishPartial ? pose : input.baseline;
    return { pose: output, baselinePreserved: output === input.baseline, resolved, reason, iterations,
      wristDisplacement: v(output.wrist).distanceTo(baselineWrist), contactsBefore: before,
      contactsAfter: output === input.baseline ? before : queryAvatarArmBodyCollisions(profile, input.side, output) };
  }
}

function collisionScore(contacts: ReturnType<typeof queryAvatarArmBodyCollisions>): number {
  return contacts.reduce((sum, contact) => sum + contact.penetrationDepth * contact.penetrationDepth, 0);
}

function projectionWeights(part:"upperArm"|"forearm"|"hand",parameter:number):{elbow:number;wrist:number}{
  const t=Math.max(0,Math.min(1,parameter));
  if(part==="upperArm")return{elbow:.35+.65*t,wrist:.12*t};
  if(part==="forearm")return{elbow:.5*(1-t),wrist:.35+.65*t};
  return{elbow:0,wrist:1};
}

function poleFromDesiredElbow(shoulder:Vector3,wrist:Vector3,elbow:Vector3,fallback:{x:number;y:number;z:number}){
  const axis=wrist.clone().sub(shoulder);if(axis.lengthSq()<1e-10)return fallback;axis.normalize();
  const pole=elbow.clone().sub(shoulder);pole.addScaledVector(axis,-pole.dot(axis));
  return pole.lengthSq()>1e-10?{x:pole.x,y:pole.y,z:pole.z}:fallback;
}
