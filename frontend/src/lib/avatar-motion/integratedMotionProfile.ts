import { FACE_CONTACT_COMBINED } from "./faceContactResearch";

/** Webcam profile shared by the preview and diagnostics pages. */
export const INTEGRATED_MOTION_PROFILE = Object.freeze({
  filtered: true,
  constraints: true,
  smoothing: true,
  handTwistEnabled: true,
  continuousFingerEnabled: true,
  bimanualPalmAssistEnabled: true,
  fingertipContactEnabled: true,
  dofConstraintsEnabled: true,
  bodyDepthBarrierEnabled: true,
  depthFusionEnabled: true,
  rigEndpointEnabled: true,
  elbowBranchSwitchEnabled: true,
  handConditioningEnabled: true,
  poseDepthConditioningEnabled: true,
  parallelHands: true,
  poseGuidedHands: true,
  adaptiveHandConfidence: true,
  processorArmTemporal: true,
  contactShadowEnabled: true,
  contactCorrectionEnabled: true,
  // Index-tip contact only takes effect when both tracking and the VRM rig support it.
  faceContactResearch: Object.freeze({ ...FACE_CONTACT_COMBINED, indexTip: true }),
});
