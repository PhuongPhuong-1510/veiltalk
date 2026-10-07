import type { HandLandmarkerResult } from "@mediapipe/tasks-vision";
import type { ConfiguredDelegate, DelegateSelection } from "./mediaPipeRuntime";

export type HandWorkerRequest =
  | { kind: "initialize"; id: number; assetBase: string; delegate: DelegateSelection }
  | { kind: "detect"; id: number; bitmap: ImageBitmap; timestampMs: number; sampledAtMs: number };

export type HandWorkerResponse =
  | { kind: "ready"; id: number; delegate: ConfiguredDelegate }
  | { kind: "result"; id: number; result: HandLandmarkerResult; sampledAtMs: number; inferenceMs: number }
  | { kind: "error"; id: number; message: string };

export interface HandWorkerSample {
  result: HandLandmarkerResult;
  sampledAtMs: number;
  inferenceMs: number;
}

export interface HandTrackingExecutor {
  readonly selectedDelegate: ConfiguredDelegate | null;
  initialize(): Promise<void>;
  /** Takes ownership of bitmap, including failure paths. Only one request may be in flight. */
  detect(bitmap: ImageBitmap, timestampMs: number, sampledAtMs: number): Promise<HandWorkerSample>;
  dispose(): void;
}
