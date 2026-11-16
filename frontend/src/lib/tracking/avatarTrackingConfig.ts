import type { TrackingPipelineOptions } from "./trackingPipeline";

/** Webcam configuration selected from the avatar tracking comparison. */
export const AVATAR_TRACKING_CONFIG = Object.freeze({
  delegate: "GPU",
  handWorkerDelegate: "GPU",
  experiments: Object.freeze({ callbackAhead: true }),
} satisfies Pick<TrackingPipelineOptions, "delegate" | "handWorkerDelegate" | "experiments">);
