import type { HandLandmarkerResult } from "@mediapipe/tasks-vision";
import type { ConfiguredDelegate, DelegateSelection } from "./mediaPipeRuntime";
import type { HandPoseHint } from "./poseGuidedHandInput";

export type HandWorkerRequest =
  | { kind: "initialize"; id: number; assetBase: string; delegate: DelegateSelection; adaptiveHandConfidence?: boolean }
  | { kind: "detect"; id: number; bitmap: ImageBitmap; timestampMs: number; sampledAtMs: number; poseHint?: HandPoseHint | null; poseGuidedHands?: boolean };

export type HandWorkerResponse =
  | { kind: "ready"; id: number; delegate: ConfiguredDelegate; adaptiveAvailable?: boolean }
  | { kind: "result"; id: number; result: HandLandmarkerResult; sampledAtMs: number; inferenceMs: number; inputMode?: "full-frame" | "single" | "combined" | "split"; confidenceMode?: "normal" | "sensitive" }
  | { kind: "error"; id: number; message: string };

export interface HandWorkerSample {
  result: HandLandmarkerResult;
  sampledAtMs: number;
  inferenceMs: number;
  inputMode?: "full-frame" | "single" | "combined" | "split";
  confidenceMode?: "normal" | "sensitive";
}

export interface HandTrackingExecutor {
  readonly selectedDelegate: ConfiguredDelegate | null;
  readonly adaptiveAvailable?: boolean;
  initialize(): Promise<void>;
  /** Takes ownership of bitmap, including failure paths. Only one request may be in flight. */
  detect(bitmap: ImageBitmap, timestampMs: number, sampledAtMs: number, poseHint?: HandPoseHint | null, poseGuidedHands?: boolean): Promise<HandWorkerSample>;
  dispose(): void;
}
