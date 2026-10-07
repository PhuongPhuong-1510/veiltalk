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
  it("transfers bitmap ownership, preserves sample time and ignores mismatched request ids", async () => {
    const t = setup(); await t.ready();
    const image = bitmap(), promise = t.client.detect(image, 123, 120), request = t.lastRequest();
    expect(t.worker.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ timestampMs: 123, sampledAtMs: 120 }), [image]);
    t.send({ kind: "result", id: request.id - 1, result: empty, sampledAtMs: 1, inferenceMs: 4 });
    t.send({ kind: "result", id: request.id, result: empty, sampledAtMs: 120, inferenceMs: 9 });
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
    t.send({ kind: "result", id, result: empty, sampledAtMs: 1, inferenceMs: 200 });
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
    t.send({ kind: "result", id: t.lastRequest().id, result: empty, sampledAtMs: 20, inferenceMs: 2 });
    await expect(promise).rejects.toThrow("sai frame"); t.client.dispose();
  });
});
