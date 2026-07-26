const test = require("node:test");
const assert = require("node:assert/strict");
const { createCallNotifyClient } = require("./callNotifyClient");

test("sends POST with correct headers, body and Authorization header", async () => {
  let capturedUrl;
  let capturedOptions;
  const fetchImpl = async (url, options) => {
    capturedUrl = url;
    capturedOptions = options;
    return { ok: true };
  };
  const client = createCallNotifyClient({
    backendUrl: "http://backend:8080",
    secret: "test-secret",
    fetchImpl,
  });

  const result = await client.notify("caller-id", "callee-id");

  assert.strictEqual(result, "notified");
  assert.strictEqual(capturedUrl, "http://backend:8080/internal/call/notify");
  assert.strictEqual(capturedOptions.method, "POST");
  assert.strictEqual(capturedOptions.headers.Authorization, "Bearer test-secret");
  assert.strictEqual(capturedOptions.headers["Content-Type"], "application/json");
  assert.deepStrictEqual(JSON.parse(capturedOptions.body), {
    caller_id: "caller-id",
    callee_id: "callee-id",
  });
});

test("returns failed when backend responds with non-2xx (e.g. 404 callee not found)", async () => {
  const fetchImpl = async () => ({ ok: false, status: 404 });
  const client = createCallNotifyClient({
    backendUrl: "http://backend:8080",
    secret: "test-secret",
    fetchImpl,
    log: () => {},
  });

  const result = await client.notify("caller-id", "unknown-callee");

  assert.strictEqual(result, "failed");
});

test("returns failed when fetch rejects (backend unreachable)", async () => {
  const fetchImpl = async () => {
    throw new Error("connection refused");
  };
  const client = createCallNotifyClient({
    backendUrl: "http://backend:8080",
    secret: "test-secret",
    fetchImpl,
    log: () => {},
  });

  const result = await client.notify("caller-id", "callee-id");

  assert.strictEqual(result, "failed");
});

test("returns failed when request exceeds timeout", async () => {
  const fetchImpl = (url, options) =>
    new Promise((resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")));
    });
  const client = createCallNotifyClient({
    backendUrl: "http://backend:8080",
    secret: "test-secret",
    timeoutMs: 20,
    fetchImpl,
    log: () => {},
  });

  const result = await client.notify("caller-id", "callee-id");

  assert.strictEqual(result, "failed");
});

test("throws when backendUrl or secret is missing", () => {
  assert.throws(() => createCallNotifyClient({ secret: "s" }));
  assert.throws(() => createCallNotifyClient({ backendUrl: "http://backend:8080" }));
});
