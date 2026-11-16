import { Euler, Object3D, Quaternion, Vector3 } from "three";
import type { VRM } from "@pixiv/three-vrm";
import type { LoadedAvatarModel } from "../avatar-renderer/modelTypes";
import { buildIdleArmPose } from "../avatar-motion/idleArmPose";
import type { QuaternionData } from "../avatar-motion/avatarPoseTypes";
import type { ControlledArmJoint, NormalizedAvatarRigProfile } from "../avatar-motion/normalizedRigProfile";

export type PreviewMotion = "wave-right" | "wave-left" | "wave-both" | "raise-right" | "raise-left" | "raise-both" | "sway" | "nod" | "look-around" | "bounce";
type BodyBone = "head" | "neck" | "chest" | "upperChest" | "spine" | "hips" | "leftShoulder" | "rightShoulder";
type Side = "left" | "right";

interface Options {
  vrm: VRM | null;
  root: Object3D;
  bones: LoadedAvatarModel["bones"];
  rigProfile: NormalizedAvatarRigProfile | null;
  motion: PreviewMotion;
  modelWidth: number;
}

const BODY_BONES: BodyBone[] = ["head", "neck", "chest", "upperChest", "spine", "hips", "leftShoulder", "rightShoulder"];
const EXPRESSIONS = ["blink", "blinkLeft", "blinkRight", "happy", "relaxed", "surprised"] as const;
const q = (value: QuaternionData) => new Quaternion(value.x, value.y, value.z, value.w).normalize();
const smoothstep = (value: number) => {
  const n = Math.max(0, Math.min(1, value));
  return n * n * (3 - 2 * n);
};

export function previewBlinkValue(elapsedSeconds: number, phase = 0): number {
  const cycle = (elapsedSeconds + phase) % 4.7;
  if (cycle < 0.08) return smoothstep(cycle / 0.08);
  if (cycle < 0.18) return 1;
  if (cycle < 0.32) return 1 - smoothstep((cycle - 0.18) / 0.14);
  return 0;
}

function directionDelta(profile: NormalizedAvatarRigProfile, joint: ControlledArmJoint, parentWorld: Quaternion, direction: Vector3) {
  const rest = profile.joints[joint];
  const restDirection = new Vector3(rest.restWorldDirection.x, rest.restWorldDirection.y, rest.restWorldDirection.z).normalize();
  const targetWorld = new Quaternion().setFromUnitVectors(restDirection, direction.clone().normalize())
    .multiply(q(rest.restWorldRotation)).normalize();
  const targetLocal = parentWorld.clone().invert().multiply(targetWorld).normalize();
  return { delta: q(rest.restLocalRotation).invert().multiply(targetLocal).normalize(), targetWorld };
}

export function createAvatarPreviewMotionController({ vrm, root, bones, rigProfile, motion, modelWidth }: Options) {
  let currentMotion = motion;
  let latestElapsed = 0;
  let motionChangedAt = 0;
  const rootRestPosition = root.position.clone();
  const rootRestRotation = root.quaternion.clone();
  const rests = new Map<string, Quaternion>();
  for (const name of [...BODY_BONES, "leftHand", "rightHand"] as const) {
    if (bones[name]) rests.set(name, bones[name]!.quaternion.clone());
  }
  const manager = vrm?.expressionManager;
  const available = manager?.expressionMap ?? {};
  const expression = (name: typeof EXPRESSIONS[number], value: number) => {
    if (name in available) manager?.setValue(name, Math.max(0, Math.min(1, value)));
  };
  const relative = (name: BodyBone, x: number, y: number, z: number) => {
    const bone = bones[name];
    const rest = rests.get(name);
    if (bone && rest) bone.quaternion.copy(rest).multiply(new Quaternion().setFromEuler(new Euler(x, y, z, "XYZ"))).normalize();
  };

  const applyArms = (elapsed: number) => {
    if (!rigProfile) return;
    const cycle = elapsed % 4.2;
    const blend = cycle < 0.55 ? smoothstep(cycle / 0.55) : cycle < 3.15 ? 1 : cycle < 3.8 ? 1 - smoothstep((cycle - 3.15) / 0.65) : 0;
    const wave = Math.sin(Math.max(0, cycle - 0.55) * Math.PI * 3.4);
    const idle = { left: buildIdleArmPose(rigProfile, "left"), right: buildIdleArmPose(rigProfile, "right") };
    const right = new Vector3(rigProfile.torsoReference.rightWorld.x, rigProfile.torsoReference.rightWorld.y, rigProfile.torsoReference.rightWorld.z).normalize();
    const up = new Vector3(rigProfile.torsoReference.upWorld.x, rigProfile.torsoReference.upWorld.y, rigProfile.torsoReference.upWorld.z).normalize();
    const forward = new Vector3(rigProfile.torsoReference.forwardWorld.x, rigProfile.torsoReference.forwardWorld.y, rigProfile.torsoReference.forwardWorld.z).normalize();
    const apply = (joint: ControlledArmJoint, delta: QuaternionData | Quaternion) => {
      const bone = bones[joint];
      if (bone) bone.quaternion.copy(q(rigProfile.joints[joint].restLocalRotation)).multiply(delta instanceof Quaternion ? delta : q(delta)).normalize();
    };
    apply("leftUpperArm", idle.left.upper); apply("leftLowerArm", idle.left.lower);
    apply("rightUpperArm", idle.right.upper); apply("rightLowerArm", idle.right.lower);

    const animate = (side: Side, waving: boolean) => {
      const sign = side === "left" ? 1 : -1;
      const upperName = `${side}UpperArm` as ControlledArmJoint;
      const lowerName = `${side}LowerArm` as ControlledArmJoint;
      const handName = `${side}Hand` as "leftHand" | "rightHand";
      const upperDirection = up.clone().multiplyScalar(waving ? 0.72 : 0.84)
        .addScaledVector(right, sign * (waving ? 0.68 : 0.48)).addScaledVector(forward, waving ? 0.12 : 0.22).normalize();
      const upper = directionDelta(rigProfile, upperName, q(rigProfile.joints[upperName].parentRestWorldRotation), upperDirection);
      const lowerDirection = up.clone().multiplyScalar(waving ? 0.9 : 0.78)
        .addScaledVector(right, waving ? wave * 0.38 : sign * 0.16).addScaledVector(forward, waving ? 0.16 : 0.48 + wave * 0.06).normalize();
      const lower = directionDelta(rigProfile, lowerName, upper.targetWorld, lowerDirection);
      apply(upperName, q(idle[side].upper).slerp(upper.delta, blend));
      apply(lowerName, q(idle[side].lower).slerp(lower.delta, blend));
      const hand = bones[handName];
      const rest = rests.get(handName);
      if (hand && rest) hand.quaternion.copy(rest).multiply(new Quaternion().setFromEuler(new Euler(0.04 * blend, 0, (waving ? 0.32 : 0.08) * wave * blend * sign))).normalize();
    };
    const waveRight = currentMotion === "wave-right" || currentMotion === "wave-both";
    const waveLeft = currentMotion === "wave-left" || currentMotion === "wave-both";
    const raiseRight = currentMotion === "raise-right" || currentMotion === "raise-both" || currentMotion === "bounce";
    const raiseLeft = currentMotion === "raise-left" || currentMotion === "raise-both" || currentMotion === "bounce";
    if (waveRight || raiseRight) animate("right", waveRight);
    if (waveLeft || raiseLeft) animate("left", waveLeft);
    for (const side of ["left", "right"] as const) {
      const handName = `${side}Hand` as "leftHand" | "rightHand";
      const active = side === "left" ? waveLeft || raiseLeft : waveRight || raiseRight;
      if (!active && bones[handName] && rests.get(handName)) bones[handName]!.quaternion.copy(rests.get(handName)!);
    }
  };

  return {
    update(elapsed: number) {
      latestElapsed = elapsed;
      for (const name of BODY_BONES) if (bones[name] && rests.get(name)) bones[name]!.quaternion.copy(rests.get(name)!);
      for (const name of EXPRESSIONS) expression(name, 0);
      const breathe = Math.sin(elapsed * 1.7), slow = Math.sin(elapsed * 0.85), side = Math.sin(elapsed * 1.25);
      let rootSway = side * 0.18, rootBounce = 0;
      let pitch = breathe * 0.018, yaw = slow * 0.035, roll = -side * 0.025;
      let chestRoll = side * 0.018, chestYaw = slow * 0.015;
      if (currentMotion.startsWith("wave")) {
        const direction = currentMotion === "wave-left" ? -1 : 1;
        roll += direction * 0.09; yaw += direction * 0.055; chestRoll -= direction * 0.035;
        expression("happy", 0.42 + 0.08 * breathe);
      } else if (currentMotion.startsWith("raise") || currentMotion === "bounce") {
        rootBounce = Math.max(0, Math.sin(elapsed * 2.6)) * 0.012;
        pitch -= 0.04 + 0.025 * breathe; chestRoll += side * 0.035;
        expression(currentMotion === "raise-both" || currentMotion === "bounce" ? "surprised" : "happy", 0.35);
      } else if (currentMotion === "nod") {
        pitch += Math.sin(elapsed * 2.2) * 0.13; rootSway *= 0.35; expression("happy", 0.25);
      } else if (currentMotion === "look-around") {
        yaw += Math.sin(elapsed * 0.72) * 0.26; roll += Math.sin(elapsed * 0.51) * 0.055;
        chestYaw -= yaw * 0.18; expression("relaxed", 0.2);
      } else {
        rootSway = side * 0.75; roll -= side * 0.075; chestRoll = side * 0.055; expression("relaxed", 0.3);
      }
      relative("head", pitch, yaw, roll); relative("neck", pitch * 0.28, yaw * 0.32, roll * 0.25);
      relative(bones.chest ? "chest" : bones.upperChest ? "upperChest" : "spine", breathe * 0.012, chestYaw, chestRoll);
      relative("leftShoulder", 0, 0, -0.018 * breathe - (currentMotion.includes("left") || currentMotion === "wave-both" ? 0.035 : 0));
      relative("rightShoulder", 0, 0, 0.018 * breathe + (currentMotion.includes("right") || currentMotion === "wave-both" ? 0.035 : 0));
      applyArms(elapsed - motionChangedAt);
      const blink = previewBlinkValue(elapsed, currentMotion.length * 0.17);
      if ("blink" in available) expression("blink", blink); else { expression("blinkLeft", blink); expression("blinkRight", blink); }
      root.position.copy(rootRestPosition).add(new Vector3(modelWidth * 0.018 * rootSway, rootBounce, 0));
      root.quaternion.copy(rootRestRotation).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.045 * rootSway)).normalize();
    },
    setMotion(nextMotion: PreviewMotion) {
      if (nextMotion === currentMotion) return;
      currentMotion = nextMotion;
      motionChangedAt = latestElapsed;
    },
  };
}
