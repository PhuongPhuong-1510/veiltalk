import { describe, expect, it } from "vitest";
import type { AvatarCollisionProfile } from "./avatarCollisionProfile";
import { queryAvatarArmBodyCollisions } from "./avatarCollisionQuery";
import { correctAvatarArmCollision } from "./avatarCollisionCorrection";
import { formatAvatarCollisionDiagnostics } from "./avatarCollisionDiagnostics";
import { poseAvatarCollisionProfile } from "./avatarCollisionProfile";
import { correctAvatarInterArmCollision, queryAvatarInterArmCollisions } from "./avatarInterArmCollision";
import type { AvatarCollisionCorrectionBudget, AvatarCollisionPose } from "./avatarCollisionTypes";
import {Vector3,Quaternion} from "three";
import { rendererClearanceMask } from "./motionOwnership";

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
  it("bounds total inter-arm displacement and does not worsen body clearance",()=>{
    const left={shoulder:{x:-.8,y:.6,z:.02},elbow:{x:-.4,y:.4,z:.02},wrist:{x:.05,y:.2,z:.02},hand:{x:.3,y:.2,z:.02}};
    const right={shoulder:{x:.8,y:.6,z:-.02},elbow:{x:.4,y:.4,z:-.02},wrist:{x:-.05,y:.2,z:-.02},hand:{x:-.3,y:.2,z:-.02}};
    const score=(side:"left"|"right",pose:AvatarCollisionPose)=>queryAvatarArmBodyCollisions(profile,side,pose).reduce((s,c)=>s+c.penetrationDepth**2,0);
    const r=correctAvatarInterArmCollision(profile,left,right,{left:"S-W",right:"SEW"},.08,4);
    for(const[side,baseline]of [["left",left],["right",right]] as const){expect(new Vector3().copy(r[side].wrist).distanceTo(new Vector3().copy(baseline.wrist))).toBeLessThanOrEqual(.080001);expect(score(side,r[side])).toBeLessThanOrEqual(score(side,baseline)+1e-8);}
    expect(correctAvatarInterArmCollision(profile,left,right,{left:"SEW",right:"SEW"},0).baselinePreserved).toBe(true);
  });
  it("checks inter-arm ordering in the body's rotated forward frame",()=>{
    const q=new Quaternion().setFromAxisAngle(new Vector3(0,1,0),Math.PI/2),t=new Vector3(2,1,-3),point=(p:{x:number;y:number;z:number})=>new Vector3().copy(p).applyQuaternion(q).add(t);
    const left={shoulder:{x:-.8,y:.6,z:.03},elbow:{x:-.4,y:.4,z:.03},wrist:{x:.05,y:.2,z:.03},hand:{x:.3,y:.2,z:.03}};
    const right={shoulder:{x:.8,y:.6,z:-.03},elbow:{x:.4,y:.4,z:-.03},wrist:{x:-.05,y:.2,z:-.03},hand:{x:-.3,y:.2,z:-.03}};
    const moved=poseAvatarCollisionProfile(profile,{headCenter:point(profile.body.head.center),neckStart:point(profile.body.neck.start),neckEnd:point(profile.body.neck.end),torsoStart:point(profile.body.torso.start),torsoEnd:point(profile.body.torso.end),frontNormal:new Vector3(0,0,1).applyQuaternion(q)});
    const pose=(p:typeof left)=>({shoulder:point(p.shoulder),elbow:point(p.elbow),wrist:point(p.wrist),hand:point(p.hand)});
    const a=correctAvatarInterArmCollision(profile,left,right,{left:"S-W",right:"SEW"},.08,3,"left-front"),b=correctAvatarInterArmCollision(moved,pose(left),pose(right),{left:"S-W",right:"SEW"},.08,3,"left-front",false,moved.body.frontNormal);
    expect(new Vector3().copy(b.left.wrist).distanceTo(point(a.left.wrist))).toBeLessThan(1e-6);
    expect(new Vector3().copy(b.right.wrist).distanceTo(point(a.right.wrist))).toBeLessThan(1e-6);
  });
  it("keeps a recent posterior hand correction behind the head in body-local coordinates",()=>{
    const p={...profile,body:{...profile.body,frontNormal:{x:0,y:0,z:1}}};
    const pose={shoulder:{x:-.4,y:1.2,z:0},elbow:{x:-.1,y:1.45,z:0},wrist:{x:.05,y:1.45,z:0}};
    const back=queryAvatarArmBodyCollisions(p,"left",pose,{head:-1,torso:null}).filter(c=>c.bodyPart==="head"&&c.armPart!=="upperArm");
    expect(back.length).toBeGreaterThan(0);for(const hit of back)expect(hit.surfaceNormal.z).toBeLessThan(0);
    const front=queryAvatarArmBodyCollisions(p,"left",pose,{head:1,torso:null}).filter(c=>c.bodyPart==="head"&&c.armPart!=="upperArm");
    for(const hit of front)expect(hit.surfaceNormal.z).toBeGreaterThan(0);
  });
  it("depth-direction policy never creates attraction in a separated arm",()=>{
    const p={...profile,body:{...profile.body,frontNormal:{x:0,y:0,z:1}}};
    const result=correctAvatarArmCollision(p,{side:"left",baseline:clear,deltaSeconds:1/60,observability:"SEW",bendPole:{x:0,y:1,z:0},budget,bodyDepthSides:{head:-1,torso:-1}});
    expect(result.pose).toBe(clear);expect(result.reason).toBe("no-collision");
  });
  it("research contact ownership keeps bounded collision correction on the observed back side",()=>{
    const p={...profile,body:{...profile.body,frontNormal:{x:0,y:0,z:1}}};
    const pose={shoulder:{x:-.4,y:1.2,z:0},elbow:{x:-.1,y:1.45,z:0},wrist:{x:.05,y:1.45,z:0}};
    const mask=rendererClearanceMask("SEW",{version:1,armTemporal:"processor",contactSafetyClearance:true,bodyDepthBarrier:true,contactArms:{left:true,right:false}},"left");
    const result=correctAvatarArmCollision(p,{side:"left",baseline:pose,deltaSeconds:1/60,observability:mask,bendPole:{x:0,y:1,z:0},budget,bodyDepthSides:{head:-1,torso:null}});
    expect(result.reason).not.toBe("insufficient-evidence");
    const directed=result.contactsBefore.filter(c=>c.bodyPart==="head"&&c.armPart!=="upperArm");
    expect(directed.length).toBeGreaterThan(0);expect(directed.every(c=>c.surfaceNormal.z<0)).toBe(true);
    expect(result.baselinePreserved).toBe(false);expect(result.pose.wrist.z).toBeLessThan(0);
  });
  it("does not modify a contact-owned arm during inter-arm correction", () => {
    const left: AvatarCollisionPose = { shoulder:{x:-.4,y:.7,z:0},elbow:{x:-.05,y:.4,z:0},wrist:{x:.2,y:.2,z:0},hand:{x:.24,y:.2,z:0} };
    const right: AvatarCollisionPose = { shoulder:{x:.4,y:.7,z:0},elbow:{x:.05,y:.4,z:0},wrist:{x:-.2,y:.2,z:0},hand:{x:-.24,y:.2,z:0} };
    const result = correctAvatarInterArmCollision(profile,left,right,{left:"---",right:"SEW"},.02);
    expect(result.left).toBe(left);
  });
  it("excludes only intentional hand-hand contact while retaining other collision pairs", () => {
    const left: AvatarCollisionPose = { shoulder:{x:-.4,y:.7,z:0},elbow:{x:-.05,y:.4,z:0},wrist:{x:0,y:.2,z:0},hand:{x:0,y:.3,z:0} };
    const right: AvatarCollisionPose = { shoulder:{x:.4,y:.7,z:0},elbow:{x:.05,y:.4,z:0},wrist:{x:0,y:.2,z:0},hand:{x:0,y:.3,z:0} };
    const hits = queryAvatarInterArmCollisions(profile,left,right,true);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some(hit=>hit.leftPart==="hand"&&hit.rightPart==="hand")).toBe(false);
  });
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

  it("detects a forearm against the model-front chest volume outside the old torso capsule",()=>{
    const chestProfile:AvatarCollisionProfile={...profile,body:{...profile.body,
      chestLeft:{center:{x:-.12,y:.65,z:.13},radius:.23},chestRight:{center:{x:.12,y:.65,z:.13},radius:.23},frontNormal:{x:0,y:0,z:1}}};
    const pose={shoulder:{x:-.5,y:.9,z:.35},elbow:{x:-.12,y:.75,z:.35},wrist:{x:-.12,y:.4,z:.35}};
    const contacts=queryAvatarArmBodyCollisions(chestProfile,"left",pose);
    expect(contacts.some(c=>c.armPart==="forearm"&&c.bodyPart==="torso")).toBe(false);
    expect(contacts.some(c=>c.armPart==="forearm"&&c.bodyPart==="chestLeft")).toBe(true);
  });

  it("biases an ambiguous central chest penetration toward the visible front surface",()=>{
    const chestProfile:AvatarCollisionProfile={...profile,body:{...profile.body,
      chestLeft:{center:{x:-.12,y:.65,z:.13},radius:.23},chestRight:{center:{x:.12,y:.65,z:.13},radius:.23},frontNormal:{x:0,y:0,z:1}}};
    const pose={shoulder:{x:-.5,y:.9,z:0},elbow:{x:-.12,y:.75,z:0},wrist:{x:-.12,y:.4,z:0}};
    const contact=queryAvatarArmBodyCollisions(chestProfile,"left",pose).find(c=>c.armPart==="forearm"&&c.bodyPart==="chestLeft");
    expect(contact?.surfaceNormal.z).toBeGreaterThan(0);
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
