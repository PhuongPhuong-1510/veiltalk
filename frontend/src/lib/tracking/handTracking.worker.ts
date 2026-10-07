import { HandLandmarker } from "@mediapipe/tasks-vision";
import wasmModuleLoader from "@mediapipe/tasks-vision/vision_wasm_module_internal.js?url";
import wasmModuleBinary from "@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url";
import type { HandWorkerRequest, HandWorkerResponse } from "./handWorkerProtocol";
import type { ConfiguredDelegate } from "./mediaPipeRuntime";

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<HandWorkerRequest>) => void) | null;
  postMessage(message: HandWorkerResponse): void;
};
let hands: HandLandmarker | null = null;

scope.onmessage = (event) => {
  const request = event.data;
  void handle(request).catch((error: unknown) => {
    scope.postMessage({ kind: "error", id: request.id, message: error instanceof Error ? error.message : String(error) });
  });
};

async function handle(request: HandWorkerRequest): Promise<void> {
  if (request.kind === "initialize") {
    const create = async (delegate: ConfiguredDelegate) => {
      // A module worker needs the ES module loader, not the public classic-script
      // loader (whose top-level ModuleFactory is not installed on globalThis).
      // Use the matched loader/binary from the installed package, served locally.
      // A CPU retry must rerun the loader: MediaPipe consumes/clears ModuleFactory.
      const loader = new URL(wasmModuleLoader, self.location.href);
      loader.searchParams.set("delegate", delegate);
      const vision = { wasmLoaderPath: loader.href, wasmBinaryPath: new URL(wasmModuleBinary, self.location.href).href };
      const task = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: new URL("models/hand_landmarker.task", request.assetBase).href, delegate },
        canvas: new OffscreenCanvas(1, 1), runningMode: "VIDEO", numHands: 2,
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
    scope.postMessage({ kind: "ready", id: request.id, delegate });
    return;
  }
  try {
    if (!hands) throw new Error("Hand worker chưa sẵn sàng.");
    const started = performance.now();
    const result = hands.detectForVideo(request.bitmap, request.timestampMs);
    scope.postMessage({ kind: "result", id: request.id, result, sampledAtMs: request.sampledAtMs, inferenceMs: performance.now() - started });
  } finally { request.bitmap.close(); }
}
