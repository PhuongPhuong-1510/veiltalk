import { Object3D, Quaternion, Vector3 } from "three";
import { VRMLookAtBoneApplier, VRMLookAtExpressionApplier, type VRM } from "@pixiv/three-vrm";
import type { GazeStateV1, QuaternionData, Vector3Data } from "../avatar-motion/avatarPoseTypes";
import type { GazeEyelidSupport } from "../avatar-motion/gazeEyelidCoupling";

export type GazeAdapterKind = "vrm-look-at-bone" | "vrm-look-at-expression" | "eye-bones" | "unsupported";

export interface GazeCapability {
  kind: GazeAdapterKind;
  yawLeftLimit: number;
  yawRightLimit: number;
  pitchUpLimit: number;
  pitchDownLimit: number;
  handlesVerticalEyelid: boolean;
}

export interface AppliedGazeDiagnostic {
  kind: GazeAdapterKind;
  semantic: { yaw: number; pitch: number } | null;
  appliedDegrees: { yaw: number; pitch: number } | null;
  rejected: "missing" | "nonfinite" | "unsupported" | null;
}

interface EyeRestProfile {
  left: { node: Object3D; restLocal: QuaternionData; yawAxisLocal: Vector3Data; pitchAxisLocal: Vector3Data };
  right: { node: Object3D; restLocal: QuaternionData; yawAxisLocal: Vector3Data; pitchAxisLocal: Vector3Data };
}

const DEFAULT_EYE_BONE_LIMITS = { yawLeftLimit: 30, yawRightLimit: 30, pitchUpLimit: 20, pitchDownLimit: 20 };
/** Manual AR3: chừa headroom ở biên để hai mắt không tạo cảm giác hội tụ quá mạnh trên VRM. */
export const GAZE_APPLIED_RANGE_GAIN = .85;
const finitePositive = (value: number) => Number.isFinite(value) && value > 0;
const quaternionData = (value: Quaternion): QuaternionData => ({ x: value.x, y: value.y, z: value.z, w: value.w });
const vectorData = (value: Vector3): Vector3Data => ({ x: value.x, y: value.y, z: value.z });
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Chỉ exact semantic đã có trong verified/profile expression map mới được coi production-safe. */
export function buildGazeEyelidSupport(capability: GazeCapability, expressionMap: Readonly<Record<string, string>>): GazeEyelidSupport {
  return Object.freeze({
    handlesVerticalEyelid: capability.handlesVerticalEyelid,
    targets: Object.freeze({
      downLeft: Boolean(expressionMap.eyeLidDownLeft),
      downRight: Boolean(expressionMap.eyeLidDownRight),
      upLeft: Boolean(expressionMap.eyeLidUpLeft),
      upRight: Boolean(expressionMap.eyeLidUpRight),
    }),
  });
}

export class GazeCapabilityAdapter {
  private readonly vrm: VRM | null;
  readonly capability: GazeCapability;
  private diagnostic: AppliedGazeDiagnostic;
  private readonly eyeRest: EyeRestProfile | null;

  constructor(vrm: VRM | null) {
    this.vrm = vrm;
    const lookAt = vrm?.lookAt ?? null;
    const applier = lookAt?.applier;
    if (lookAt && (applier instanceof VRMLookAtBoneApplier || applier instanceof VRMLookAtExpressionApplier)
        && usableRangeMaps(applier)) {
      const expression = applier instanceof VRMLookAtExpressionApplier;
      const horizontalInputLimit = expression
        ? applier.rangeMapHorizontalOuter.inputMaxValue
        : Math.min(applier.rangeMapHorizontalInner.inputMaxValue, applier.rangeMapHorizontalOuter.inputMaxValue);
      this.capability = Object.freeze({
        kind: expression ? "vrm-look-at-expression" : "vrm-look-at-bone",
        yawLeftLimit: horizontalInputLimit,
        yawRightLimit: horizontalInputLimit,
        pitchUpLimit: applier.rangeMapVerticalUp.inputMaxValue,
        pitchDownLimit: applier.rangeMapVerticalDown.inputMaxValue,
        handlesVerticalEyelid: expression,
      });
      lookAt.autoUpdate = false;
      this.eyeRest = null;
    } else {
      this.eyeRest = buildEyeRestProfile(vrm);
      this.capability = Object.freeze(this.eyeRest
        ? { kind: "eye-bones" as const, ...DEFAULT_EYE_BONE_LIMITS, handlesVerticalEyelid: false }
        : { kind: "unsupported" as const, yawLeftLimit: 0, yawRightLimit: 0, pitchUpLimit: 0, pitchDownLimit: 0, handlesVerticalEyelid: false });
    }
    this.diagnostic = { kind: this.capability.kind, semantic: null, appliedDegrees: null, rejected: this.capability.kind === "unsupported" ? "unsupported" : "missing" };
  }

  apply(gaze: GazeStateV1 | null | undefined): void {
    if (!gaze) { this.reset(); this.diagnostic = { kind: this.capability.kind, semantic: null, appliedDegrees: null, rejected: "missing" }; return; }
    if (!Number.isFinite(gaze.yaw) || !Number.isFinite(gaze.pitch)) {
      this.reset(); this.diagnostic = { kind: this.capability.kind, semantic: null, appliedDegrees: null, rejected: "nonfinite" }; return;
    }
    if (this.capability.kind === "unsupported") {
      this.diagnostic = { kind: "unsupported", semantic: { yaw: clamp(gaze.yaw, -1, 1), pitch: clamp(gaze.pitch, -1, 1) }, appliedDegrees: null, rejected: "unsupported" }; return;
    }
    const yawSemantic = clamp(gaze.yaw, -1, 1), pitchSemantic = clamp(gaze.pitch, -1, 1);
    const yawDegrees = yawSemantic * (yawSemantic >= 0 ? this.capability.yawRightLimit : this.capability.yawLeftLimit) * GAZE_APPLIED_RANGE_GAIN;
    // THREE/VRM pitch quanh +X nhìn xuống; semantic AR3 quy ước +pitch là nhìn lên.
    const pitchDegrees = -pitchSemantic * (pitchSemantic >= 0 ? this.capability.pitchUpLimit : this.capability.pitchDownLimit) * GAZE_APPLIED_RANGE_GAIN;
    if (this.vrm?.lookAt && this.capability.kind.startsWith("vrm-look-at")) {
      this.vrm.lookAt.yaw = yawDegrees; this.vrm.lookAt.pitch = pitchDegrees;
    } else if (this.eyeRest) {
      applyEyeBone(this.eyeRest.left, yawDegrees, pitchDegrees);
      applyEyeBone(this.eyeRest.right, yawDegrees, pitchDegrees);
    }
    this.diagnostic = { kind: this.capability.kind, semantic: { yaw: yawSemantic, pitch: pitchSemantic }, appliedDegrees: { yaw: yawDegrees, pitch: pitchDegrees }, rejected: null };
  }

  reset(): void {
    if (this.vrm?.lookAt && this.capability.kind.startsWith("vrm-look-at")) this.vrm.lookAt.reset();
    if (this.eyeRest) for (const eye of [this.eyeRest.left, this.eyeRest.right]) eye.node.quaternion.set(eye.restLocal.x, eye.restLocal.y, eye.restLocal.z, eye.restLocal.w).normalize();
  }

  snapshot(): AppliedGazeDiagnostic { return structuredClone(this.diagnostic); }
}

function usableRangeMaps(applier: VRMLookAtBoneApplier | VRMLookAtExpressionApplier): boolean {
  const maps = [applier.rangeMapHorizontalOuter, applier.rangeMapVerticalUp, applier.rangeMapVerticalDown];
  if (applier instanceof VRMLookAtBoneApplier) maps.push(applier.rangeMapHorizontalInner);
  return maps
    .every((map) => finitePositive(map.inputMaxValue) && finitePositive(map.outputScale));
}

function buildEyeRestProfile(vrm: VRM | null): EyeRestProfile | null {
  const head = vrm?.humanoid.getNormalizedBoneNode("head");
  const left = vrm?.humanoid.getNormalizedBoneNode("leftEye");
  const right = vrm?.humanoid.getNormalizedBoneNode("rightEye");
  if (!head || !left || !right) return null;
  head.updateWorldMatrix(true, false); left.updateWorldMatrix(true, false); right.updateWorldMatrix(true, false);
  const headWorld = head.getWorldQuaternion(new Quaternion()).normalize();
  const worldUp = new Vector3(0, 1, 0).applyQuaternion(headWorld).normalize();
  const worldRight = new Vector3(1, 0, 0).applyQuaternion(headWorld).normalize();
  const eye = (node: Object3D) => {
    const inverseEyeWorld = node.getWorldQuaternion(new Quaternion()).normalize().invert();
    return {
      node,
      restLocal: quaternionData(node.quaternion.clone().normalize()),
      yawAxisLocal: vectorData(worldUp.clone().applyQuaternion(inverseEyeWorld).normalize()),
      pitchAxisLocal: vectorData(worldRight.clone().applyQuaternion(inverseEyeWorld).normalize()),
    };
  };
  return { left: eye(left), right: eye(right) };
}

function applyEyeBone(eye: EyeRestProfile["left"], yawDegrees: number, pitchDegrees: number): void {
  const yaw = new Quaternion().setFromAxisAngle(new Vector3(eye.yawAxisLocal.x, eye.yawAxisLocal.y, eye.yawAxisLocal.z), yawDegrees * Math.PI / 180);
  const pitch = new Quaternion().setFromAxisAngle(new Vector3(eye.pitchAxisLocal.x, eye.pitchAxisLocal.y, eye.pitchAxisLocal.z), pitchDegrees * Math.PI / 180);
  const delta = yaw.multiply(pitch).normalize();
  const target = new Quaternion(eye.restLocal.x, eye.restLocal.y, eye.restLocal.z, eye.restLocal.w).multiply(delta).normalize();
  if (eye.node.quaternion.dot(target) < 0) target.set(-target.x, -target.y, -target.z, -target.w);
  eye.node.quaternion.copy(target);
}
