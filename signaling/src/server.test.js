const test = require("node:test");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const { createServer } = require("./server");

const TEST_SECRET = "test-only-secret-not-used-anywhere-else-1234567890";

function signAccessToken(secret, overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    type: "access",
    jti: "22222222-2222-2222-2222-222222222222",
    iat: now,
    exp: now + 900,
    sub: "a310fc8c-109f-4e53-91ee-8fcd508f7512",
    role: "user",
    ...overrides,
  };
  return jwt.sign(payload, secret, { algorithm: "HS256", noTimestamp: true });
}

function startTestServer() {
  const { wss, connectionsByUserId } = createServer({
    port: 0,
    jwtSecret: TEST_SECRET,
    log: () => {},
  });
  const { port } = wss.address();
  return { wss, connectionsByUserId, port };
}

function closeServer(wss) {
  for (const client of wss.clients) {
    client.terminate();
  }
  return new Promise((resolve) => wss.close(resolve));
}

test("accepts connection with a valid access token (TC-48)", async () => {
  const { wss, connectionsByUserId, port } = startTestServer();
  const token = signAccessToken(TEST_SECRET);
  const ws = new WebSocket(`ws://localhost:${port}/ws/signaling?token=${token}`);

  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("close", (code) => reject(new Error(`unexpected close: ${code}`)));
    ws.on("error", reject);
  });

  assert.strictEqual(
    connectionsByUserId.get("a310fc8c-109f-4e53-91ee-8fcd508f7512")?.size,
    1
  );

  ws.close();
  await closeServer(wss);
});

test("rejects connection without a token using close code 4001 (TC-49)", async () => {
  const { wss, port } = startTestServer();
  const ws = new WebSocket(`ws://localhost:${port}/ws/signaling`);

  const closeCode = await new Promise((resolve, reject) => {
    ws.on("close", resolve);
    ws.on("error", reject);
  });

  assert.strictEqual(closeCode, 4001);
  await closeServer(wss);
});

test("rejects connection with an invalid token using close code 4001", async () => {
  const { wss, port } = startTestServer();
  const ws = new WebSocket(`ws://localhost:${port}/ws/signaling?token=not-a-real-jwt`);

  const closeCode = await new Promise((resolve, reject) => {
    ws.on("close", resolve);
    ws.on("error", reject);
  });

  assert.strictEqual(closeCode, 4001);
  await closeServer(wss);
});

test("removes connection from the map on disconnect", async () => {
  const { wss, connectionsByUserId, port } = startTestServer();
  const token = signAccessToken(TEST_SECRET);
  const ws = new WebSocket(`ws://localhost:${port}/ws/signaling?token=${token}`);

  await new Promise((resolve) => ws.on("open", resolve));

  const serverSideClosed = new Promise((resolve) => {
    for (const client of wss.clients) {
      client.on("close", resolve);
    }
  });
  ws.close();
  await serverSideClosed;

  assert.strictEqual(
    connectionsByUserId.has("a310fc8c-109f-4e53-91ee-8fcd508f7512"),
    false
  );

  await closeServer(wss);
});
