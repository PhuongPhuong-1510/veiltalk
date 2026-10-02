import { Object3D, Quaternion, Vector3 } from "three";
import { solveContactArmIk } from "../avatar-motion/contactArmIk";
import type { AvatarProbeProfile } from "../avatar-motion/avatarContactRig";
import type { SemanticBoneFrame } from "./renderedContactGeometry";
import { semanticRenderedRotation } from "./renderedContactGeometry";

export interface FinalFaceContactDiagnostic { applied: boolean; reason: string; before: number | null; after: number | null; normalDegrees: number | null; localPenetration: number | null }
export interface FinalFaceContactInput {
  side: "left" | "right";
  owned: boolean;
  fresh: boolean;
  goalKey: string;
  dt: number;
  faceHeight: number;
  influence: number;
  bones: Partial<Record<string, Object3D>>;
  frames: Map<string, SemanticBoneFrame>;
  probe: AvatarProbeProfile;
  renderedProbe?:()=>{point:Vector3;normal:Vector3}|null;
  target: () => { point: Vector3; normal: Vector3 } | null;
  sync: () => void;
  clearanceScore: () => number;
  acceptJointConstraints?:()=>boolean;
}
const finite = (v: Vector3) => v.toArray().every(Number.isFinite);
const vec = (v: { x: number; y: number; z: number }) => new Vector3(v.x, v.y, v.z);
const data = (v: Vector3) => ({ x: v.x, y: v.y, z: v.z });

/** A bounded final pass delegated by the contact owner; detector state/targets are never acquired here. */
export class FinalFaceContactRefiner {
  private key: string | null = null;
  private offsets = new Map<string, Quaternion>();
  reset(): void { this.key = null; this.offsets.clear(); }
  refine(input: FinalFaceContactInput): FinalFaceContactDiagnostic {
    const out: FinalFaceContactDiagnostic = { applied: false, reason: "inactive", before: null, after: null, normalDegrees: null, localPenetration: null };
    if (!input.owned || !input.fresh || !(input.faceHeight > 1e-5) || !(input.influence > 0) || !Number.isFinite(input.dt) || input.dt <= 0) { this.reset(); return out; }
    if (this.key !== input.goalKey) { this.reset(); this.key = input.goalKey; }
    const names = [input.side + "UpperArm", input.side + "LowerArm", input.side + "Hand"];
    const bones = names.map(n => input.bones[n]), frames = names.map(n => input.frames.get(n));
    if (bones.some(b => !b) || frames.some(f => !f)) { this.reset(); out.reason = "missing-chain"; return out; }
    const [upper, lower, hand] = bones as Object3D[], [uf, lf, hf] = frames as SemanticBoneFrame[];
    const baseline = bones.map(b => b!.quaternion.clone());
    const measure = () => {
      const target = input.target(); if (!target) return null;
      const q = semanticRenderedRotation(hf), actual=input.renderedProbe?.();
      if(input.renderedProbe&&!actual)return null;
      const p = actual?.point??vec(input.probe.frameOffset).applyQuaternion(q).add(hf.bone.getWorldPosition(new Vector3()));
      const normal = actual?.normal??vec(input.probe.contactNormal).applyQuaternion(q).normalize();
      if (!finite(p) || !finite(target.point) || !finite(target.normal)) return null;
      return { target, p, normal, gap: p.distanceTo(target.point), angle: normal.angleTo(target.normal.clone().negate()), signed: p.clone().sub(target.point).dot(target.normal) };
    };
    input.sync(); const original = measure(), clearanceBefore = input.clearanceScore();
    if (!original || !Number.isFinite(clearanceBefore)) { this.reset(); out.reason = "missing-surface"; return out; }
    out.before = original.gap;
    const restore = () => { bones.forEach((b, i) => b!.quaternion.copy(baseline[i])); input.sync(); this.offsets.clear(); };
    // Reapply a bounded delta relative to this packet's current baseline, never accumulated bone positions.
    names.forEach((n, i) => { const offset = this.offsets.get(n); if (offset) bones[i]!.quaternion.multiply(offset).normalize(); }); input.sync();
    const current = measure();
    if (!current || current.gap > input.faceHeight * .30) { restore(); out.reason = "residual-too-large"; return out; }
    const shoulder = uf.bone.getWorldPosition(new Vector3()), elbow = lf.bone.getWorldPosition(new Vector3()), wrist = hf.bone.getWorldPosition(new Vector3());
    const delta = current.target.point.clone().sub(current.p), budget = input.faceHeight * Math.min(.06, Math.min(.05, input.dt) * 1.5) * Math.min(1, input.influence);
    if (delta.length() > budget) delta.setLength(budget);
    const ik = solveContactArmIk({ shoulder: data(shoulder), wristTarget: data(wrist.clone().add(delta)), upperLength: shoulder.distanceTo(elbow), lowerLength: elbow.distanceTo(wrist), preferredPole: data(elbow.clone().sub(shoulder)) });
    if (!ik || ik.projected) { restore(); out.reason = "unreachable"; return out; }
    const handWorld = semanticRenderedRotation(hf);
    const rotateWorld = (bone: Object3D, from: Vector3, to: Vector3) => {
      const world = bone.getWorldQuaternion(new Quaternion()), target = new Quaternion().setFromUnitVectors(from.normalize(), to.normalize()).multiply(world);
      bone.quaternion.copy((bone.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion()).invert().multiply(target)).normalize(); bone.updateWorldMatrix(false, true);
    };
    rotateWorld(upper, elbow.clone().sub(shoulder), vec(ik.elbow).sub(shoulder));
    input.sync();
    rotateWorld(lower, hf.bone.getWorldPosition(new Vector3()).sub(lf.bone.getWorldPosition(new Vector3())), vec(ik.wrist).sub(vec(ik.elbow)));
    hand.quaternion.copy((hand.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion()).invert().multiply(handWorld)).normalize();
    const currentNormal = current.normal;
    const normalDelta = new Quaternion().setFromUnitVectors(currentNormal, current.target.normal.clone().negate());
    const angle = new Quaternion().angleTo(normalDelta), normalBudget = Math.min(.05, input.dt) * 1.2;
    if (angle < Math.PI * .5) {
      const limited = new Quaternion().slerp(normalDelta, Math.min(1, normalBudget / Math.max(1e-8, angle)));
      const desired = limited.multiply(handWorld); hand.quaternion.copy((hand.parent?.getWorldQuaternion(new Quaternion()) ?? new Quaternion()).invert().multiply(desired)).normalize();
    }
    if (bones.some((b, i) => baseline[i].angleTo(b!.quaternion) > (i === 2 ? 8 : 12) * Math.PI / 180)||input.acceptJointConstraints?.()===false) { restore(); out.reason = "angular-or-joint-budget"; return out; }
    input.sync(); const after = measure(), clearanceAfter = input.clearanceScore();
    if (!after || !Number.isFinite(clearanceAfter) || clearanceAfter > clearanceBefore + 1e-10 || after.gap >= original.gap - 1e-8 || after.angle > original.angle + .02 || Math.max(0, -after.signed) > Math.max(0, -original.signed) + input.faceHeight * .002) {
      restore(); out.reason = "rollback-no-safe-improvement"; out.after = original.gap; return out;
    }
    names.forEach((n, i) => this.offsets.set(n, baseline[i].clone().invert().multiply(bones[i]!.quaternion).normalize()));
    out.applied = true; out.reason = "bounded-final-pass"; out.after = after.gap; out.normalDegrees = after.angle * 180 / Math.PI; out.localPenetration = Math.max(0, -after.signed); return out;
  }
}
