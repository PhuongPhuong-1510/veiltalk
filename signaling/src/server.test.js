const test = require("node:test");
const assert = require("node:assert/strict");
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");
const { createServer } = require("./server");

const TEST_CALL_ID = "11111111-1111-4111-8111-111111111111";
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

function createStubCallNotifyClient(result = "notified") {
  const calls = [];
  return {
    calls,
    notify: async (callerId, calleeId) => {
      calls.push({ callerId, calleeId });
      return result;
    },
  };
}

function startTestServer(overrides = {}) {
  const callNotifyClient = overrides.callNotifyClient ?? createStubCallNotifyClient();
  const { wss, connectionsByUserId, callSessionsByUserId, stop } = createServer({
    port: 0,
    jwtSecret: TEST_SECRET,
    log: () => {},
    revocationStore: { isRevoked: async () => false },
    ...overrides,
    callNotifyClient,
  });
  const { port } = wss.address();
  return { wss, connectionsByUserId, callSessionsByUserId, stop, port, callNotifyClient };
}

function connect(port, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws/signaling?token=${token}`);
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
  });
}

function nextMessage(ws) {
  return new Promise((resolve) => {
    ws.once("message", (raw) => resolve(JSON.parse(raw)));
  });
}

function closeServer({ wss, stop }) {
  for (const client of wss.clients) {
    client.terminate();
  }
  return stop();
}

test("accepts connection with a valid access token (TC-48)", async () => {
  const { wss, connectionsByUserId, port, stop } = startTestServer();
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
  await closeServer({ wss, stop });
});

test("rejects connection without a token using close code 4001 (TC-49)", async () => {
  const { wss, port, stop } = startTestServer();
  const ws = new WebSocket(`ws://localhost:${port}/ws/signaling`);

  const closeCode = await new Promise((resolve, reject) => {
    ws.on("close", resolve);
    ws.on("error", reject);
  });

  assert.strictEqual(closeCode, 4001);
  await closeServer({ wss, stop });
});

test("rejects connection with an invalid token using close code 4001", async () => {
  const { wss, port, stop } = startTestServer();
  const ws = new WebSocket(`ws://localhost:${port}/ws/signaling?token=not-a-real-jwt`);

  const closeCode = await new Promise((resolve, reject) => {
    ws.on("close", resolve);
    ws.on("error", reject);
  });

  assert.strictEqual(closeCode, 4001);
  await closeServer({ wss, stop });
});

test("removes connection from the map on disconnect", async () => {
  const { wss, connectionsByUserId, port, stop } = startTestServer();
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

  await closeServer({ wss, stop });
});

const USER_B = "b420fc8c-109f-4e53-91ee-8fcd508f7513";

test("relays CALL_OFFER from sender to target user, tagging from_user_id", async () => {
  const { wss, port, stop } = startTestServer();
  const tokenA = signAccessToken(TEST_SECRET);
  const tokenB = signAccessToken(TEST_SECRET, { sub: USER_B });

  const wsA = await connect(port, tokenA);
  const wsB = await connect(port, tokenB);

  const received = nextMessage(wsB);
  wsA.send(JSON.stringify({ type: "CALL_OFFER", call_id: TEST_CALL_ID, data: { sdp: "fake-sdp" }, target_user_id: USER_B }));

  const message = await received;
  assert.strictEqual(message.type, "CALL_OFFER");
  assert.strictEqual(message.data.sdp, "fake-sdp");
  assert.strictEqual(message.from_user_id, "a310fc8c-109f-4e53-91ee-8fcd508f7512");

  wsA.close();
  wsB.close();
  await closeServer({ wss, stop });
});

test("calls backend call notify before relaying CALL_OFFER (P3-T04)", async () => {
  const { wss, port, stop, callNotifyClient } = startTestServer();
  const tokenA = signAccessToken(TEST_SECRET);
  const tokenB = signAccessToken(TEST_SECRET, { sub: USER_B });
  const wsA = await connect(port, tokenA);
  const wsB = await connect(port, tokenB);

  const received = nextMessage(wsB);
  wsA.send(JSON.stringify({ type: "CALL_OFFER", call_id: TEST_CALL_ID, data: { sdp: "s" }, target_user_id: USER_B }));
  await received;

  assert.strictEqual(callNotifyClient.calls.length, 1);
  assert.strictEqual(callNotifyClient.calls[0].callerId, "a310fc8c-109f-4e53-91ee-8fcd508f7512");
  assert.strictEqual(callNotifyClient.calls[0].calleeId, USER_B);

  wsA.close();
  wsB.close();
  await closeServer({ wss, stop });
});

test("sends TARGET_OFFLINE to caller when call notify fails, even though callee has a signaling connection open", async () => {
  const failingClient = createStubCallNotifyClient("failed");
  const { wss, port, stop } = startTestServer({ callNotifyClient: failingClient });
  const tokenA = signAccessToken(TEST_SECRET);
  const tokenB = signAccessToken(TEST_SECRET, { sub: USER_B });
  const wsA = await connect(port, tokenA);
  const wsB = await connect(port, tokenB);

  const received = nextMessage(wsA);
  wsA.send(JSON.stringify({ type: "CALL_OFFER", call_id: TEST_CALL_ID, data: { sdp: "s" }, target_user_id: USER_B }));

  const message = await received;
  assert.strictEqual(message.type, "ERROR");
  assert.strictEqual(message.data.code, "TARGET_OFFLINE");

  wsA.close();
  wsB.close();
  await closeServer({ wss, stop });
});

test("does not relay CALL_OFFER to callee's signaling connection when call notify fails", async () => {
  const failingClient = createStubCallNotifyClient("failed");
  const { wss, port, stop } = startTestServer({ callNotifyClient: failingClient });
  const tokenA = signAccessToken(TEST_SECRET);
  const tokenB = signAccessToken(TEST_SECRET, { sub: USER_B });
  const wsA = await connect(port, tokenA);
  const wsB = await connect(port, tokenB);

  let receivedOnB = false;
  wsB.on("message", () => {
    receivedOnB = true;
  });

  const errorReceived = nextMessage(wsA);
  wsA.send(JSON.stringify({ type: "CALL_OFFER", call_id: TEST_CALL_ID, data: { sdp: "s" }, target_user_id: USER_B }));
  await errorReceived;
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.strictEqual(receivedOnB, false);

  wsA.close();
  wsB.close();
  await closeServer({ wss, stop });
});

test("relays CALL_ANSWER and ICE_CANDIDATE", async () => {
  const { wss, port, stop } = startTestServer();
  const tokenA = signAccessToken(TEST_SECRET);
  const tokenB = signAccessToken(TEST_SECRET, { sub: USER_B });
  const wsA = await connect(port, tokenA);
  const wsB = await connect(port, tokenB);

  const offerReceived = nextMessage(wsB);
  wsA.send(JSON.stringify({ type: "CALL_OFFER", call_id: TEST_CALL_ID, data: { sdp: "offer-sdp" }, target_user_id: USER_B }));
  await offerReceived;

  const answerReceived = nextMessage(wsA);
  wsB.send(JSON.stringify({ type: "CALL_ANSWER", call_id: TEST_CALL_ID, data: { sdp: "answer-sdp" }, target_user_id: "a310fc8c-109f-4e53-91ee-8fcd508f7512" }));
  const answer = await answerReceived;
  assert.strictEqual(answer.type, "CALL_ANSWER");
  assert.strictEqual(answer.from_user_id, USER_B);

  const iceReceived = nextMessage(wsB);
  wsA.send(JSON.stringify({ type: "ICE_CANDIDATE", call_id: TEST_CALL_ID, data: { candidate: "c", sdp_mid: "0" }, target_user_id: USER_B }));
  const ice = await iceReceived;
  assert.strictEqual(ice.type, "ICE_CANDIDATE");
  assert.strictEqual(ice.data.candidate, "c");

  wsA.close();
  wsB.close();
  await closeServer({ wss, stop });
});

test("holds offer until target connects after call notification", async () => {
  const { wss, port, stop } = startTestServer();
  const tokenA = signAccessToken(TEST_SECRET);
  const wsA = await connect(port, tokenA);

  wsA.send(JSON.stringify({ type: "CALL_OFFER", call_id: TEST_CALL_ID, data: { sdp: "fake-sdp" }, target_user_id: USER_B }));
  const wsB = new WebSocket(`ws://localhost:${port}/ws/signaling?token=${signAccessToken(TEST_SECRET, { sub: USER_B })}`);
  const received = nextMessage(wsB);
  const message = await received;
  assert.strictEqual(message.type, "CALL_OFFER");
  assert.strictEqual(message.call_id, TEST_CALL_ID);

  wsA.close();
  wsB.close();
  await closeServer({ wss, stop });
});

test("ignores malformed JSON and unknown message types without crashing", async () => {
  const { wss, port, stop } = startTestServer();
  const tokenA = signAccessToken(TEST_SECRET);
  const tokenB = signAccessToken(TEST_SECRET, { sub: USER_B });
  const wsA = await connect(port, tokenA);
  const wsB = await connect(port, tokenB);

  wsA.send("not json");
  wsA.send(JSON.stringify({ type: "TYPING", target_user_id: USER_B }));

  const stillWorks = nextMessage(wsB);
  wsA.send(JSON.stringify({ type: "CALL_OFFER", call_id: TEST_CALL_ID, data: { sdp: "ok" }, target_user_id: USER_B }));
  const message = await stillWorks;
  assert.strictEqual(message.type, "CALL_OFFER");

  wsA.close();
  wsB.close();
  await closeServer({ wss, stop });
});

test("closes connections beyond the per-IP rate limit with code 4029", async () => {
  const { wss, port, stop } = startTestServer({ trustedProxyIps: "" });
  const opened = [];

  for (let i = 0; i < 20; i += 1) {
    const token = signAccessToken(TEST_SECRET, { jti: `conn-${i}` });
    opened.push(await connect(port, token));
  }

  const tokenExtra = signAccessToken(TEST_SECRET, { jti: "conn-extra" });
  const wsExtra = new WebSocket(`ws://localhost:${port}/ws/signaling?token=${tokenExtra}`);
  const closeCode = await new Promise((resolve, reject) => {
    wsExtra.on("close", resolve);
    wsExtra.on("error", reject);
  });

  assert.strictEqual(closeCode, 4029);

  for (const ws of opened) {
    ws.close();
  }
  await closeServer({ wss, stop });
});

test("rate limit resists forged X-Forwarded-For when the connecting IP is not a trusted proxy", async () => {
  // Không cấu hình trustedProxyIps => Server phải bỏ qua X-Forwarded-For và
  // dùng remoteAddress thật (luôn giống nhau ở đây) cho mọi kết nối — nếu
  // không, một client tự đặt header với 25 giá trị giả khác nhau sẽ né được
  // giới hạn 20 conn/IP/phút hoàn toàn (SAD mục 4.2, 9.4).
  const { wss, port, stop } = startTestServer({ trustedProxyIps: "" });

  let closed4029 = 0;
  let closedOther = 0;

  for (let i = 0; i < 25; i += 1) {
    const token = signAccessToken(TEST_SECRET, { jti: `forged-${i}` });
    const ws = new WebSocket(`ws://localhost:${port}/ws/signaling?token=${token}`, {
      headers: { "X-Forwarded-For": `10.0.0.${i}` },
    });
    // Chờ "close" thay vì suy luận từ "open": phía client "open" fire ngay sau
    // khi bắt tay xong, TRƯỚC KHI server kịp gửi close frame 4029 (bất đồng bộ) —
    // dùng "open" để kết luận sẽ cho kết quả dương tính giả rằng rate limit bị né.
    await new Promise((resolve) => {
      ws.on("open", resolve);
      ws.on("close", (code) => {
        if (code === 4029) closed4029 += 1;
        else closedOther += 1;
        resolve();
      });
      ws.on("error", resolve);
    });
  }

  await new Promise((resolve) => setTimeout(resolve, 200));

  assert.strictEqual(wss.clients.size, 20);
  assert.strictEqual(closed4029, 5);
  assert.strictEqual(closedOther, 0);

  await closeServer({ wss, stop });
});

test("relays CALL_REJECT to caller and clears session on both sides", async () => {
  const { wss, port, stop, callSessionsByUserId } = startTestServer();
  const tokenA = signAccessToken(TEST_SECRET);
  const tokenB = signAccessToken(TEST_SECRET, { sub: USER_B });
  const wsA = await connect(port, tokenA);
  const wsB = await connect(port, tokenB);

  wsA.send(JSON.stringify({ type: "CALL_OFFER", call_id: TEST_CALL_ID, data: { sdp: "s" }, target_user_id: USER_B }));
  await nextMessage(wsB);
  assert.strictEqual(callSessionsByUserId.size, 2);

  const rejectReceived = nextMessage(wsA);
  wsB.send(JSON.stringify({ type: "CALL_REJECT", call_id: TEST_CALL_ID, data: { reason: "busy" }, target_user_id: "a310fc8c-109f-4e53-91ee-8fcd508f7512" }));
  const reject = await rejectReceived;

  assert.strictEqual(reject.type, "CALL_REJECT");
  assert.strictEqual(reject.data.reason, "busy");
  assert.strictEqual(reject.from_user_id, USER_B);
  assert.strictEqual(callSessionsByUserId.size, 0);

  wsA.close();
  wsB.close();
  await closeServer({ wss, stop });
});

test("relays CALL_END and clears session on both sides", async () => {
  const { wss, port, stop, callSessionsByUserId } = startTestServer();
  const tokenA = signAccessToken(TEST_SECRET);
  const tokenB = signAccessToken(TEST_SECRET, { sub: USER_B });
  const wsA = await connect(port, tokenA);
  const wsB = await connect(port, tokenB);

  wsA.send(JSON.stringify({ type: "CALL_OFFER", call_id: TEST_CALL_ID, data: { sdp: "s" }, target_user_id: USER_B }));
  await nextMessage(wsB);
  wsB.send(JSON.stringify({ type: "CALL_ANSWER", call_id: TEST_CALL_ID, data: { sdp: "a" }, target_user_id: "a310fc8c-109f-4e53-91ee-8fcd508f7512" }));
  await nextMessage(wsA);
  assert.strictEqual(callSessionsByUserId.size, 2);

  const endReceived = nextMessage(wsB);
  wsA.send(JSON.stringify({ type: "CALL_END", call_id: TEST_CALL_ID, target_user_id: USER_B }));
  const end = await endReceived;

  assert.strictEqual(end.type, "CALL_END");
  assert.strictEqual(callSessionsByUserId.size, 0);

  wsA.close();
  wsB.close();
  await closeServer({ wss, stop });
});

test("sends CALL_END to peer when a session participant disconnects abruptly", async () => {
  const { wss, port, stop, callSessionsByUserId } = startTestServer();
  const tokenA = signAccessToken(TEST_SECRET);
  const tokenB = signAccessToken(TEST_SECRET, { sub: USER_B });
  const wsA = await connect(port, tokenA);
  const wsB = await connect(port, tokenB);

  wsA.send(JSON.stringify({ type: "CALL_OFFER", call_id: TEST_CALL_ID, data: { sdp: "s" }, target_user_id: USER_B }));
  await nextMessage(wsB);
  assert.strictEqual(callSessionsByUserId.size, 2);

  const endReceived = nextMessage(wsB);
  wsA.close();
  const end = await endReceived;

  assert.strictEqual(end.type, "CALL_END");
  assert.strictEqual(end.data.reason, "peer_disconnected");
  assert.strictEqual(end.call_id, TEST_CALL_ID);
  assert.strictEqual(callSessionsByUserId.size, 0);

  wsB.close();
  await closeServer({ wss, stop });
});

test("times out a pending (unanswered) session after sessionTimeoutMs and notifies both sides (UC-01 no-answer)", async () => {
  const { wss, port, stop, callSessionsByUserId } = startTestServer({
    sessionTimeoutMs: 50,
    sessionSweepIntervalMs: 20,
  });
  const tokenA = signAccessToken(TEST_SECRET);
  const tokenB = signAccessToken(TEST_SECRET, { sub: USER_B });
  const wsA = await connect(port, tokenA);
  const wsB = await connect(port, tokenB);

  const offerReceived = nextMessage(wsB);
  wsA.send(JSON.stringify({ type: "CALL_OFFER", call_id: TEST_CALL_ID, data: { sdp: "s" }, target_user_id: USER_B }));
  await offerReceived;

  const endOnA = nextMessage(wsA);
  const endOnB = nextMessage(wsB);
  const [a, b] = await Promise.all([endOnA, endOnB]);

  assert.strictEqual(a.type, "CALL_END");
  assert.strictEqual(a.data.reason, "timeout");
  assert.strictEqual(a.call_id, TEST_CALL_ID);
  assert.strictEqual(b.type, "CALL_END");
  assert.strictEqual(b.data.reason, "timeout");
  assert.strictEqual(b.call_id, TEST_CALL_ID);
  assert.strictEqual(callSessionsByUserId.size, 0);

  wsA.close();
  wsB.close();
  await closeServer({ wss, stop });
});

test("does NOT time out an active (already answered) session even after sessionTimeoutMs of silence", async () => {
  const { wss, port, stop, callSessionsByUserId } = startTestServer({
    sessionTimeoutMs: 50,
    sessionSweepIntervalMs: 20,
  });
  const tokenA = signAccessToken(TEST_SECRET);
  const tokenB = signAccessToken(TEST_SECRET, { sub: USER_B });
  const wsA = await connect(port, tokenA);
  const wsB = await connect(port, tokenB);

  wsA.send(JSON.stringify({ type: "CALL_OFFER", call_id: TEST_CALL_ID, data: { sdp: "s" }, target_user_id: USER_B }));
  await nextMessage(wsB);
  wsB.send(JSON.stringify({ type: "CALL_ANSWER", call_id: TEST_CALL_ID, data: { sdp: "a" }, target_user_id: "a310fc8c-109f-4e53-91ee-8fcd508f7512" }));
  await nextMessage(wsA);

  let gotUnexpectedEnd = false;
  wsA.on("message", (raw) => {
    if (JSON.parse(raw).type === "CALL_END") gotUnexpectedEnd = true;
  });
  wsB.on("message", (raw) => {
    if (JSON.parse(raw).type === "CALL_END") gotUnexpectedEnd = true;
  });

  await new Promise((resolve) => setTimeout(resolve, 200));

  assert.strictEqual(gotUnexpectedEnd, false);
  assert.strictEqual(callSessionsByUserId.size, 2);

  wsA.close();
  wsB.close();
  await closeServer({ wss, stop });
});

test("a pending call blocks a second offer without replacing the original call", async () => {
  const server = startTestServer();
  const a = await connect(server.port, signAccessToken(TEST_SECRET));
  const b = await connect(server.port, signAccessToken(TEST_SECRET, { sub: USER_B }));
  const cId = "c530fc8c-109f-4e53-91ee-8fcd508f7514";
  const c = await connect(server.port, signAccessToken(TEST_SECRET, { sub: cId }));
  const firstOffer = nextMessage(b);
  a.send(JSON.stringify({ type: "CALL_OFFER", call_id: TEST_CALL_ID, target_user_id: USER_B, data: { sdp: "first" } }));
  await firstOffer;
  const busy = nextMessage(c);
  c.send(JSON.stringify({ type: "CALL_OFFER", call_id: "22222222-2222-4222-8222-222222222222", target_user_id: USER_B, data: { sdp: "second" } }));
  assert.equal((await busy).data.code, "TARGET_BUSY");
  assert.equal(server.callSessionsByUserId.get(USER_B).callId, TEST_CALL_ID);
  const answer = nextMessage(a);
  b.send(JSON.stringify({ type: "CALL_ANSWER", call_id: TEST_CALL_ID, target_user_id: "a310fc8c-109f-4e53-91ee-8fcd508f7512", data: { sdp: "answer" } }));
  assert.equal((await answer).call_id, TEST_CALL_ID);
  await closeServer(server);
});

test("a revoked open socket cannot relay and closes with 4001", async () => {
  let revoked = false;
  const notify = createStubCallNotifyClient();
  const server = startTestServer({ callNotifyClient: notify, revocationStore: { isRevoked: async () => revoked } });
  const a = await connect(server.port, signAccessToken(TEST_SECRET));
  const b = await connect(server.port, signAccessToken(TEST_SECRET, { sub: USER_B }));
  revoked = true;
  const closed = new Promise(resolve => a.once("close", resolve));
  a.send(JSON.stringify({ type: "CALL_OFFER", call_id: TEST_CALL_ID, target_user_id: USER_B, data: { sdp: "blocked" } }));
  assert.equal(await closed, 4001);
  assert.equal(notify.calls.length, 0);
  assert.equal(server.callSessionsByUserId.size, 0);
  b.close();
  await closeServer(server);
});

test("overlapping offers reserve the callee before async notify completes", async () => {
  let releaseNotify;
  const callNotifyClient = { notify: () => new Promise(resolve => { releaseNotify = resolve; }) };
  const server = startTestServer({ callNotifyClient });
  const a = await connect(server.port, signAccessToken(TEST_SECRET));
  const b = await connect(server.port, signAccessToken(TEST_SECRET, { sub: USER_B }));
  const cId = "c530fc8c-109f-4e53-91ee-8fcd508f7514";
  const c = await connect(server.port, signAccessToken(TEST_SECRET, { sub: cId }));
  a.send(JSON.stringify({ type: "CALL_OFFER", call_id: TEST_CALL_ID, target_user_id: USER_B, data: { sdp: "first" } }));
  const deadline = Date.now() + 2000;
  while (!releaseNotify && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.ok(releaseNotify);
  const busy = nextMessage(c);
  c.send(JSON.stringify({ type: "CALL_OFFER", call_id: "33333333-3333-4333-8333-333333333333", target_user_id: USER_B, data: { sdp: "second" } }));
  assert.equal((await busy).data.code, "TARGET_BUSY");
  const accepted = nextMessage(b);
  releaseNotify("notified");
  assert.equal((await accepted).call_id, TEST_CALL_ID);
  assert.equal(server.callSessionsByUserId.get(USER_B).callId, TEST_CALL_ID);
  await closeServer(server);
});

test("late event from previous call ID cannot mutate the next call", async () => {
  const server = startTestServer();
  const a = await connect(server.port, signAccessToken(TEST_SECRET));
  const b = await connect(server.port, signAccessToken(TEST_SECRET, { sub: USER_B }));
  const firstOffer = nextMessage(b);
  a.send(JSON.stringify({ type: "CALL_OFFER", call_id: TEST_CALL_ID, target_user_id: USER_B, data: { sdp: "first" } }));
  await firstOffer;
  const ended = nextMessage(b);
  a.send(JSON.stringify({ type: "CALL_END", call_id: TEST_CALL_ID, target_user_id: USER_B }));
  await ended;
  const secondId = "44444444-4444-4444-8444-444444444444";
  const secondOffer = nextMessage(b);
  a.send(JSON.stringify({ type: "CALL_OFFER", call_id: secondId, target_user_id: USER_B, data: { sdp: "second" } }));
  await secondOffer;
  const error = nextMessage(b);
  b.send(JSON.stringify({ type: "ICE_CANDIDATE", call_id: TEST_CALL_ID, target_user_id: "a310fc8c-109f-4e53-91ee-8fcd508f7512", data: { candidate: "late" } }));
  assert.equal((await error).data.code, "INVALID_CALL_SESSION");
  assert.equal(server.callSessionsByUserId.get(USER_B).callId, secondId);
  await closeServer(server);
});

test("closing one of multiple sockets for a user does not end the active call", async (t) => {
  const server = startTestServer();
  t.after(async () => closeServer(server));

  const userA = "a310fc8c-109f-4e53-91ee-8fcd508f7512";
  const tokenA = signAccessToken(TEST_SECRET, { sub: userA });
  const primaryA = await connect(server.port, tokenA);
  const secondaryA = await connect(server.port, tokenA);
  const socketB = await connect(
    server.port,
    signAccessToken(TEST_SECRET, { sub: USER_B })
  );

  const offerOnB = nextMessage(socketB);
  primaryA.send(JSON.stringify({
    type: "CALL_OFFER",
    call_id: TEST_CALL_ID,
    target_user_id: USER_B,
    data: { sdp: "offer-from-primary-tab" },
  }));
  await offerOnB;

  const answerOnPrimary = nextMessage(primaryA);
  const answerOnSecondary = nextMessage(secondaryA);
  socketB.send(JSON.stringify({
    type: "CALL_ANSWER",
    call_id: TEST_CALL_ID,
    target_user_id: userA,
    data: { sdp: "answer-from-b" },
  }));
  await Promise.all([answerOnPrimary, answerOnSecondary]);
  assert.strictEqual(server.callSessionsByUserId.get(userA)?.status, "active");

  const messagesOnB = [];
  socketB.on("message", (raw) => messagesOnB.push(JSON.parse(raw)));
  const secondaryClosed = new Promise((resolve) => secondaryA.once("close", resolve));
  secondaryA.close();
  await secondaryClosed;
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.strictEqual(primaryA.readyState, WebSocket.OPEN);
  assert.strictEqual(server.connectionsByUserId.get(userA)?.size, 1);
  assert.strictEqual(server.callSessionsByUserId.get(userA)?.callId, TEST_CALL_ID);
  assert.strictEqual(server.callSessionsByUserId.get(USER_B)?.callId, TEST_CALL_ID);
  assert.strictEqual(
    messagesOnB.some((message) => message.type === "CALL_END"),
    false,
    "closing a secondary socket must not disconnect the user's active call"
  );
  const finalEndOnB = nextMessage(socketB);
  primaryA.close();
  const finalEnd = await finalEndOnB;
  assert.strictEqual(finalEnd.type, "CALL_END");
  assert.strictEqual(finalEnd.call_id, TEST_CALL_ID);
  assert.strictEqual(finalEnd.data.reason, "peer_disconnected");
  assert.strictEqual(messagesOnB.filter((message) => message.type === "CALL_END").length, 1);
  assert.strictEqual(server.callSessionsByUserId.size, 0);
});
