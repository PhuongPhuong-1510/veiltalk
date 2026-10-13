import type { HandLandmarkerResult } from "@mediapipe/tasks-vision";
import type { ConfiguredDelegate, DelegateSelection } from "./mediaPipeRuntime";
import type { HandPoseHint } from "./poseGuidedHandInput";
import type { HandInputDiagnostics } from "./handRoiPolicy";
export interface HandWorkerExperiments { cachedPoseHint?: boolean; handRoiRecovery?: boolean }

export interface HandWorkerTiming {
  roiPreparationMs: number;
  inferenceMs: number;
  mappingMs: number;
  /** Worker message receipt to response-ready; excludes response transfer and bitmap close. */
  workerTotalMs: number;
}

export type HandWorkerRequest =
  | { kind: "initialize"; id: number; assetBase: string; delegate: DelegateSelection; adaptiveHandConfidence?: boolean; experiments?: HandWorkerExperiments }
  | { kind: "detect"; id: number; bitmap: ImageBitmap; timestampMs: number; sampledAtMs: number; poseHint?: HandPoseHint | null; poseGuidedHands?: boolean };

export type HandWorkerResponse =
  | { kind: "ready"; id: number; delegate: ConfiguredDelegate; adaptiveAvailable?: boolean }
  | { kind: "result"; id: number; timestampMs: number; result: HandLandmarkerResult; sampledAtMs: number; inferenceMs: number; timings?: HandWorkerTiming; postMessageMs?: number; inputMode?: "full-frame" | "single" | "combined" | "split"; confidenceMode?: "normal" | "sensitive"; diagnostics?: HandInputDiagnostics }
  | { kind: "error"; id: number; message: string };

export interface HandWorkerSample {
  result: HandLandmarkerResult;
  sampledAtMs: number;
  inferenceMs: number;
  timings?: HandWorkerTiming;
  /** Duration of the main-thread postMessage call, not transfer completion or queue latency. */
  postMessageMs?: number;
  inputMode?: "full-frame" | "single" | "combined" | "split";
  confidenceMode?: "normal" | "sensitive";
  diagnostics?: HandInputDiagnostics;
}

export interface HandTrackingExecutor {
  readonly selectedDelegate: ConfiguredDelegate | null;
  readonly adaptiveAvailable?: boolean;
  initialize(): Promise<void>;
  /** Takes ownership of bitmap, including failure paths. Only one request may be in flight. */
  detect(bitmap: ImageBitmap, timestampMs: number, sampledAtMs: number, poseHint?: HandPoseHint | null, poseGuidedHands?: boolean): Promise<HandWorkerSample>;
  dispose(): void;
}
