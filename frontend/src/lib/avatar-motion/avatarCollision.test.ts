import { describe, expect, it } from "vitest";
import type { AvatarCollisionProfile } from "./avatarCollisionProfile";
import { queryAvatarArmBodyCollisions } from "./avatarCollisionQuery";
import { correctAvatarArmCollision } from "./avatarCollisionCorrection";
import { formatAvatarCollisionDiagnostics } from "./avatarCollisionDiagnostics";
import { poseAvatarCollisionProfile } from "./avatarCollisionProfile";
import { correctAvatarInterArmCollision, queryAvatarInterArmCollisions } from "./avatarInterArmCollision";
import type { AvatarCollisionCorrectionBudget, AvatarCollisionPose } from "./avatarCollisionTypes";

const profile: AvatarCollisionProfile = {
  body: {
    head: { center: { x: 0, y: 1.45, z: 0 }, radius: .25 },
    neck: { start: { x: 0, y: .95, z: 0 }, end: { x: 0, y: 1.2, z: 0 }, radius: .12 },
    torso: { start: { x: 0, y: .8, z: 0 }, end: { x: 0, y: -.4, z: 0 }, radius: .28 },
  },
  arms: {
    left: { upperRadius: .05, forearmRadius: .045, handRadius: .06, upperLength: .55, lowerLength: .5 },
    right: { upperRadius: .05, forearmRadius: .045, handRadius: .06, upperLength: .55, lowerLength: .5 },
  },
};
const budget: AvatarCollisionCorrectionBudget = { maxWristDisplacementPerFrame: .2, maxElbowAngularCorrectionPerSecond: 20, maxTotalCorrection: .5, maxIterations: 4, influence: 1 };
const clear: AvatarCollisionPose = { shoulder: {x:-.4,y:.65,z:0}, elbow: {x:-.85,y:.45,z:0}, wrist: {x:-1.15,y:.15,z:0} };

describe("avatar self collision", () => {
  it("preserves the exact baseline object when there is no collision", () => {
    const result = correctAvatarArmCollision(profile, { side:"left", baseline:clear, deltaSeconds:1/60, observability:"SEW", bendPole:{x:0,y:1,z:0}, budget });
    expect(result.pose).toBe(clear);
    expect(result.reason).toBe("no-collision");
    expect(result.wristDisplacement).toBe(0);
  });

  it("detects forearm/torso and reports useful diagnostics", () => {
    const pose = { shoulder:{x:-.4,y:.7,z:0}, elbow:{x:-.35,y:.35,z:0}, wrist:{x:.2,y:.15,z:0} };
    const contacts = queryAvatarArmBodyCollisions(profile, "left", pose);
    const contact = contacts.find((c) => c.armPart === "forearm" && c.bodyPart === "torso");
    expect(contact?.penetrationDepth).toBeGreaterThan(0);
    expect(contact?.signedDistance).toBeLessThan(0);
    expect(contact?.normalizedPenetration).toBeGreaterThan(0);
    expect(Math.hypot(contact!.surfaceNormal.x, contact!.surfaceNormal.y, contact!.surfaceNormal.z)).toBeCloseTo(1, 6);
    expect(formatAvatarCollisionDiagnostics("left", [contact!])[0]).toContain("left.forearm -> torso");
  });

  it("does not report a merely near upper arm", () => {
    const pose = { shoulder:{x:-.4,y:.7,z:0}, elbow:{x:-.4,y:.15,z:0}, wrist:{x:-.7,y:-.25,z:0} };
    expect(queryAvatarArmBodyCollisions(profile, "left", pose).some((c) => c.armPart === "upperArm" && c.bodyPart === "torso")).toBe(false);
  });

  it("detects forearm/head penetration", () => {
    const pose = { shoulder:{x:-.4,y:.8,z:0}, elbow:{x:-.35,y:1.25,z:0}, wrist:{x:.2,y:1.5,z:0} };
    expect(queryAvatarArmBodyCollisions(profile, "left", pose).some((c) => c.armPart === "forearm" && c.bodyPart === "head")).toBe(true);
  });

  it("publishes only a bounded improvement when the correction budget is insufficient", () => {
    const pose = { shoulder:{x:-.4,y:.65,z:0}, elbow:{x:-.1,y:.35,z:0}, wrist:{x:.35,y:.2,z:0} };
    const result = correctAvatarArmCollision(profile, { side:"left", baseline:pose, deltaSeconds:1/60, observability:"S-W", bendPole:{x:0,y:1,z:0}, budget:{...budget,maxWristDisplacementPerFrame:.001,maxTotalCorrection:.001} });
    expect(result.resolved).toBe(false);
    expect(result.wristDisplacement).toBeLessThanOrEqual(.001001);
    expect(["partially-resolved", "budget-exceeded", "topology-change"]).toContain(result.reason);
  });

  it("keeps collision diagnostic-only when fewer than two joints are observed", () => {
    const pose = { shoulder:{x:-.4,y:.65,z:0}, elbow:{x:-.1,y:.35,z:0}, wrist:{x:.35,y:.2,z:0} };
    for (const observability of ["S--", "-E-", "--W", "---"] as const) {
      const result = correctAvatarArmCollision(profile, { side:"left", baseline:pose, deltaSeconds:1/60, observability, bendPole:{x:0,y:1,z:0}, budget });
      expect(result.pose).toBe(pose);
      expect(result.reason).toBe("insufficient-evidence");
      expect(result.contactsBefore.length).toBeGreaterThan(0);
    }
  });

  it("never stretches either bone and gives inferred elbows more freedom", () => {
    const pose = { shoulder:{x:-.4,y:.65,z:0}, elbow:{x:-.1,y:.35,z:.05}, wrist:{x:.35,y:.2,z:.05} };
    const inferred = correctAvatarArmCollision(profile, { side:"left", baseline:pose, deltaSeconds:.1, observability:"S-W", bendPole:{x:0,y:0,z:1}, budget });
    const observed = correctAvatarArmCollision(profile, { side:"left", baseline:pose, deltaSeconds:.1, observability:"SEW", bendPole:{x:0,y:0,z:1}, budget });
    expect(inferred.wristDisplacement).toBeGreaterThanOrEqual(observed.wristDisplacement);
    if (inferred.resolved) {
      const distance = (a:{x:number;y:number;z:number},b:{x:number;y:number;z:number}) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
      expect(distance(inferred.pose.shoulder,inferred.pose.elbow)).toBeCloseTo(profile.arms.left.upperLength, 6);
      expect(distance(inferred.pose.elbow,inferred.pose.wrist)).toBeCloseTo(profile.arms.left.lowerLength, 6);
    }
  });

  it("is left/right symmetric", () => {
    const left = { shoulder:{x:-.4,y:.65,z:0}, elbow:{x:-.1,y:.35,z:.05}, wrist:{x:.35,y:.2,z:.05} };
    const mirror = (p:{x:number;y:number;z:number}) => ({x:-p.x,y:p.y,z:p.z});
    const right = {shoulder:mirror(left.shoulder),elbow:mirror(left.elbow),wrist:mirror(left.wrist)};
    const l = queryAvatarArmBodyCollisions(profile,"left",left);
    const r = queryAvatarArmBodyCollisions(profile,"right",right);
    expect(r.map(c=>[c.armPart,c.bodyPart,c.penetrationDepth])).toEqual(l.map(c=>[c.armPart,c.bodyPart,c.penetrationDepth]));
  });

  it("queries current posed body colliders instead of frozen rest coordinates",()=>{
    const moved=poseAvatarCollisionProfile(profile,{headCenter:{x:3,y:3,z:0},neckStart:{x:3,y:2,z:0},neckEnd:{x:3,y:2.5,z:0},torsoStart:{x:3,y:1,z:0},torsoEnd:{x:3,y:0,z:0}});
    const pose={shoulder:{x:2.6,y:.7,z:0},elbow:{x:2.7,y:.4,z:0},wrist:{x:3.2,y:.2,z:0}};
    expect(queryAvatarArmBodyCollisions(profile,"left",pose)).toHaveLength(0);
    expect(queryAvatarArmBodyCollisions(moved,"left",pose).length).toBeGreaterThan(0);
  });

  it("detects palm/hand and forearm/forearm inter-arm collisions",()=>{
    const left={shoulder:{x:-.8,y:.6,z:0},elbow:{x:-.4,y:.4,z:0},wrist:{x:.05,y:.2,z:0},hand:{x:.3,y:.2,z:0}};
    const right={shoulder:{x:.8,y:.6,z:0},elbow:{x:.4,y:.4,z:0},wrist:{x:-.05,y:.2,z:0},hand:{x:-.3,y:.2,z:0}};
    const contacts=queryAvatarInterArmCollisions(profile,left,right);
    expect(contacts.some(c=>c.leftPart==="hand"&&c.rightPart==="hand")).toBe(true);
    expect(contacts.some(c=>c.leftPart==="forearm"&&c.rightPart==="forearm")).toBe(true);
    const corrected=correctAvatarInterArmCollision(profile,left,right,{left:"S-W",right:"SEW"},.08,3);
    expect(corrected.contactsAfter.reduce((s,c)=>s+c.penetrationDepth**2,0)).toBeLessThan(contacts.reduce((s,c)=>s+c.penetrationDepth**2,0));
  });
});
