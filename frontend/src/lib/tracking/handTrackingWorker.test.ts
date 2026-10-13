import { afterEach, describe, expect, it, vi } from "vitest";
import { HandTrackingWorker } from "./handTrackingWorker";
import type { HandWorkerRequest, HandWorkerResponse } from "./handWorkerProtocol";

function setup(timeout = 350) {
  const worker = {
    onmessage: null as Worker["onmessage"], onerror: null as Worker["onerror"], onmessageerror: null as Worker["onmessageerror"],
    postMessage: vi.fn(), terminate: vi.fn(),
  };
  const client = new HandTrackingWorker("https://local.test/mediapipe/", "GPU", () => worker, timeout);
  const send = (response: HandWorkerResponse) => worker.onmessage?.call(worker as unknown as Worker, { data: response } as MessageEvent);
  const lastRequest = () => worker.postMessage.mock.calls.at(-1)![0] as HandWorkerRequest;
  const ready = async () => { const promise = client.initialize(); send({ kind: "ready", id: lastRequest().id, delegate: "GPU" }); await promise; };
  return { worker, client, send, lastRequest, ready };
}
const bitmap = () => ({ close: vi.fn() }) as unknown as ImageBitmap;
const empty = { landmarks: [], worldLandmarks: [], handedness: [], handednesses: [] };
afterEach(() => vi.useRealTimers());

describe("Hand worker transport", () => {
  it.each(["GPU", "CPU", "AUTO"] as const)("sends the requested %s delegate unchanged", async delegate => {
    const t = setup();
    const client = new HandTrackingWorker("https://local.test/", delegate, () => t.worker);
    const pending = client.initialize();
    expect(t.lastRequest()).toMatchObject({ kind: "initialize", delegate });
    t.send({ kind: "ready", id: t.lastRequest().id, delegate: delegate === "CPU" ? "CPU" : "GPU" });
    await pending; client.dispose();
  });

  it("coalesces initialize calls", async () => {
    const t = setup(); const a = t.client.initialize(), b = t.client.initialize();
    expect(t.worker.postMessage).toHaveBeenCalledOnce();
    t.send({ kind: "ready", id: t.lastRequest().id, delegate: "GPU" });
    await Promise.all([a, b]); t.client.dispose();
  });

  it("rejects repeated or decreasing source timestamps before transferring ownership", async () => {
    const t = setup(); await t.ready();
    const first = t.client.detect(bitmap(), 100, 100);
    t.send({ kind: "result", id: t.lastRequest().id, timestampMs: 100, sampledAtMs: 100, result: empty, inferenceMs: 1 }); await first;
    for (const [timestamp, sampledAt] of [[100, 101], [101, 100], [99, 102], [NaN, 102]]) {
      const image = bitmap(); await expect(t.client.detect(image, timestamp, sampledAt)).rejects.toThrow("timestamp");
      expect(image.close).toHaveBeenCalledOnce();
    }
    expect(t.worker.postMessage).toHaveBeenCalledTimes(2); t.client.dispose();
  });

  it("rejects a response with the wrong detector timestamp", async () => {
    const t = setup(); await t.ready(); const promise = t.client.detect(bitmap(), 100, 99);
    t.send({ kind: "result", id: t.lastRequest().id, timestampMs: 98, sampledAtMs: 99, result: empty, inferenceMs: 1 });
    await expect(promise).rejects.toThrow("sai frame"); t.client.dispose();
  });

  it("old Worker error and response handlers cannot terminate or resolve its replacement", async () => {
    const a = setup(), b = setup(); let selected = a.worker;
    const client = new HandTrackingWorker("https://local.test/", "GPU", () => selected);
    const init = client.initialize(); const oldMessage = a.worker.onmessage!, oldError = a.worker.onerror!, oldMessageError = a.worker.onmessageerror!;
    const rejection = expect(init).rejects.toThrow("dừng"); client.dispose();
    selected = b.worker; const next = client.initialize();
    oldError.call(a.worker as unknown as Worker, { preventDefault: vi.fn(), message: "late error" } as unknown as ErrorEvent);
    oldMessageError.call(a.worker as unknown as Worker, {} as MessageEvent);
    oldMessage.call(a.worker as unknown as Worker, { data: { kind: "ready", id: b.lastRequest().id, delegate: "CPU" } } as MessageEvent);
    expect(client.selectedDelegate).toBeNull(); expect(b.worker.terminate).not.toHaveBeenCalled();
    b.send({ kind: "ready", id: b.lastRequest().id, delegate: "GPU" });
    await rejection; await next; expect(client.selectedDelegate).toBe("GPU"); client.dispose();
  });
  it("reports postMessage initiation duration and preserves worker-local phase durations", async () => {
    const t = setup(); await t.ready();
    let clock = 100;
    const now = vi.spyOn(performance, "now").mockImplementation(() => clock);
    try {
      t.worker.postMessage.mockImplementation(() => { clock += 2; });
      const promise = t.client.detect(bitmap(), 100, 100);
      const timings = { roiPreparationMs: 3, inferenceMs: 20, mappingMs: 1, workerTotalMs: 24 };
      clock = 150;
      t.send({ kind: "result", id: t.lastRequest().id, timestampMs: 100, result: empty, sampledAtMs: 100, inferenceMs: 24, timings });
      expect(await promise).toMatchObject({ timings, postMessageMs: 2 });
      t.client.dispose();
    } finally { now.mockRestore(); }
  });
  it("transfers bitmap ownership, preserves sample time and ignores mismatched request ids", async () => {
    const t = setup(); await t.ready();
    const image = bitmap(), promise = t.client.detect(image, 123, 120), request = t.lastRequest();
    expect(t.worker.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ timestampMs: 123, sampledAtMs: 120 }), [image]);
    t.send({ kind: "result", id: request.id - 1, timestampMs: 123, result: empty, sampledAtMs: 1, inferenceMs: 4 });
    t.send({ kind: "result", id: request.id, timestampMs: 123, result: empty, sampledAtMs: 120, inferenceMs: 9 });
    expect(await promise).toMatchObject({ sampledAtMs: 120, inferenceMs: 9, result: empty });
    expect(image.close).not.toHaveBeenCalled(); // Worker now owns and closes it.
    t.client.dispose();
  });

  it("rejects extra frames rather than growing a queue and closes the rejected bitmap", async () => {
    const t = setup(); await t.ready();
    const first = t.client.detect(bitmap(), 1, 1), dropped = bitmap();
    await expect(t.client.detect(dropped, 2, 2)).rejects.toThrow("bận");
    expect(dropped.close).toHaveBeenCalledOnce();
    const stopped = expect(first).rejects.toThrow("dừng"); t.client.dispose(); await stopped;
    expect(t.worker.terminate).toHaveBeenCalledOnce();
  });

  it("terminates timed-out inference and does not accept its late result", async () => {
    vi.useFakeTimers(); const t = setup(100); await t.ready();
    const promise = t.client.detect(bitmap(), 1, 1), id = t.lastRequest().id;
    const rejected = expect(promise).rejects.toThrow("quá hạn");
    await vi.advanceTimersByTimeAsync(101); await rejected;
    expect(t.worker.terminate).toHaveBeenCalledOnce();
    t.send({ kind: "result", id, timestampMs: 1, result: empty, sampledAtMs: 1, inferenceMs: 200 });
    expect(t.client.selectedDelegate).toBeNull();
  });

  it("cleans up initialization errors and transferred-frame failures", async () => {
    const t = setup(); const init = t.client.initialize();
    t.send({ kind: "error", id: t.lastRequest().id, message: "GPU unavailable" });
    await expect(init).rejects.toThrow("GPU unavailable"); expect(t.worker.terminate).toHaveBeenCalled();
    const next = setup(); await next.ready(); next.worker.postMessage.mockImplementation(() => { throw new Error("transfer failed"); });
    const image = bitmap(); await expect(next.client.detect(image, 1, 1)).rejects.toThrow("transfer failed");
    expect(image.close).toHaveBeenCalledOnce(); expect(next.worker.terminate).toHaveBeenCalledOnce();
  });

  it("rejects a response carrying a different sample clock", async () => {
    const t = setup(); await t.ready(); const promise = t.client.detect(bitmap(), 10, 10);
    t.send({ kind: "result", id: t.lastRequest().id, timestampMs: 10, result: empty, sampledAtMs: 20, inferenceMs: 2 });
    await expect(promise).rejects.toThrow("sai frame"); t.client.dispose();
  });
});
