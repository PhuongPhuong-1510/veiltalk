import { HandLandmarker } from "@mediapipe/tasks-vision";
import wasmModuleLoader from "@mediapipe/tasks-vision/vision_wasm_module_internal.js?url";
import wasmModuleBinary from "@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url";
import type { HandWorkerRequest, HandWorkerResponse, HandRoiReason } from "./handWorkerProtocol";
import type { ConfiguredDelegate } from "./mediaPipeRuntime";
import { drawHandInput, HandSensitivitySelector, mapHandResultFromInput, planPoseGuidedHandInput } from "./poseGuidedHandInput";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<HandWorkerRequest>) => void) | null;
  postMessage(message: HandWorkerResponse): void;
};
let hands: HandLandmarker | null = null;
let sensitiveHands: HandLandmarker | null = null;
const selector = new HandSensitivitySelector();
const handCanvas = new OffscreenCanvas(512, 512);
let roiMisses = 0;

scope.onmessage = (event) => {
  const receivedAt = performance.now();
  const request = event.data;
  void handle(request, receivedAt).catch((error: unknown) => {
    scope.postMessage({ kind: "error", id: request.id, message: error instanceof Error ? error.message : String(error) });
  });
};

async function handle(request: HandWorkerRequest, receivedAt: number): Promise<void> {
  if (request.kind === "initialize") {
    const create = async (delegate: ConfiguredDelegate, sensitive = false) => {
      // A module worker needs the ES module loader, not the public classic-script
      // loader (whose top-level ModuleFactory is not installed on globalThis).
      // Use the matched loader/binary from the installed package, served locally.
      // A CPU retry must rerun the loader: MediaPipe consumes/clears ModuleFactory.
      const loader = new URL(wasmModuleLoader, self.location.href);
      loader.searchParams.set("delegate", `${delegate}-${sensitive ? "sensitive" : "normal"}`);
      const vision = { wasmLoaderPath: loader.href, wasmBinaryPath: new URL(wasmModuleBinary, self.location.href).href };
      const task = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: new URL("models/hand_landmarker.task", request.assetBase).href, delegate },
        canvas: new OffscreenCanvas(1, 1), runningMode: "VIDEO", numHands: 2,
        ...(sensitive ? { minHandDetectionConfidence: .3, minTrackingConfidence: .3, minHandPresenceConfidence: .5 } : {}),
      });
      // Warm graph/shaders before accepting camera frames, outside the latency budget.
      try { task.detectForVideo(new OffscreenCanvas(32, 32), 0); return task; }
      catch (error) { task.close(); throw error; }
    };
    let delegate: ConfiguredDelegate = request.delegate === "CPU" ? "CPU" : "GPU";
    try { hands = await create(delegate); }
    catch (error) {
      if (request.delegate !== "AUTO") throw error;
      delegate = "CPU"; hands = await create(delegate);
    }
    if (request.adaptiveHandConfidence) {
      try { sensitiveHands = await create(delegate, true); }
      catch { sensitiveHands = null; } // Keep the normal detector available on memory-limited devices.
    }
    selector.reset();
    roiMisses = 0;
    scope.postMessage({ kind: "ready", id: request.id, delegate, adaptiveAvailable: sensitiveHands !== null });
    return;
  }
  try {
    if (!hands) throw new Error("Hand worker chưa sẵn sàng.");
    const started = performance.now();
    const hint = request.poseHint ?? null;
    const plan = planPoseGuidedHandInput(hint);
    const confidenceMode = sensitiveHands && selector.select(plan, request.sampledAtMs) === "sensitive" ? "sensitive" : "normal";
    const detector = confidenceMode === "sensitive" ? sensitiveHands! : hands;
    let source: ImageBitmap | OffscreenCanvas = request.bitmap;
    let usedPlan = null;
    let roiReason: HandRoiReason = !request.poseGuidedHands ? "disabled" : !hint ? "no-hint"
      : hint.ageMs > 120 ? "stale-hint" : !plan ? "invalid-plan" : roiMisses >= 2 ? "miss-limit" : "roi";
    if (request.poseGuidedHands && plan && roiMisses < 2) {
      try { drawHandInput(request.bitmap, plan, handCanvas); source = handCanvas; usedPlan = plan; }
      catch { source = request.bitmap; roiReason = "draw-error"; }
    }
    const inferenceStartedAt = performance.now();
    const raw = detector.detectForVideo(source, request.timestampMs);
    const inferenceEndedAt = performance.now();
    const result = usedPlan ? mapHandResultFromInput(raw, usedPlan) : raw;
    const mappingEndedAt = performance.now();
    roiMisses = usedPlan ? result.landmarks.length ? 0 : roiMisses + 1 : 0;
    scope.postMessage({ kind: "result", id: request.id, result, sampledAtMs: request.sampledAtMs, inferenceMs: performance.now() - started,
      timings: { roiPreparationMs: inferenceStartedAt - started, inferenceMs: inferenceEndedAt - inferenceStartedAt,
        mappingMs: mappingEndedAt - inferenceEndedAt, workerTotalMs: performance.now() - receivedAt },
      inputMode: usedPlan?.layout ?? "full-frame", confidenceMode, roiReason });
  } finally { request.bitmap.close(); }
}
