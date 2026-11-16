const { WebSocketServer } = require("ws");
const { verifyAccessToken, extractToken } = require("./auth");
const { resolveClientIp, parseTrustedProxyIps, createConnectionRateLimiter } = require("./rateLimiter");
const { createCallNotifyClient } = require("./callNotifyClient");

const RELAY_MESSAGE_TYPES = new Set(["CALL_OFFER", "CALL_ANSWER", "ICE_CANDIDATE", "CALL_REJECT", "CALL_END"]);
const SESSION_TIMEOUT_MS = 30_000;
const SESSION_SWEEP_INTERVAL_MS = 5_000;
const REVOCATION_SWEEP_INTERVAL_MS = 1_000;

function createServer({
  port,
  jwtSecret,
  trustedProxyIps = "",
  log = console.log,
  sessionTimeoutMs = SESSION_TIMEOUT_MS,
  sessionSweepIntervalMs = SESSION_SWEEP_INTERVAL_MS,
  callNotifyClient,
  revocationStore,
}) {
  if (!jwtSecret) {
    throw new Error("jwtSecret is required to start the signaling server");
  }
  if (!callNotifyClient) {
    throw new Error("callNotifyClient is required to start the signaling server");
  }
  if (!revocationStore) {
    throw new Error("revocationStore is required to start the signaling server");
  }

  const trustedProxies = parseTrustedProxyIps(trustedProxyIps);
  const rateLimiter = createConnectionRateLimiter();

  // userId -> Set<WebSocket>, dùng cho relay ở P3-T02.
  const connectionsByUserId = new Map();

  // Session ở đây gắn theo userId, KHÔNG phải call_session_id (field đó chỉ tồn tại
  // ở CALL_INCOMING trên kênh Messaging - API 04 mục 10.1). Với model 1-1, mỗi user
  // chỉ ở một cuộc gọi tại một thời điểm nên map userId -> peer là đủ, không cần
  // một Map<call_session_id, ...> riêng. Xem docs/02_SYSTEM_ARCHITECTURE.md mục 4.2.
  // status: "pending" (đã gửi CALL_OFFER, chưa nhận CALL_ANSWER) hay "active" (đã answered).
  // Timeout 30s (UC-01 no-answer) chỉ áp cho "pending" - một khi đã "active", signaling
  // không còn thấy activity nào (client nói chuyện P2P), nên "active" bị loại khỏi sweep.
  // userId -> { peerUserId, status, lastActivityAt }
  const callSessionsByUserId = new Map();
  const recentCallIds = new Map();
  const authenticatedSockets = new Map();
  const isUuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  async function revoked(payload) {
    return !payload || payload.exp <= Math.floor(Date.now() / 1000)
      || await revocationStore.isRevoked(payload.jti, payload.sub, payload.iat);
  }
  function closeRevoked(ws) {
    if (ws.readyState === 1) ws.close(4001, "revoked token");
  }
  let checkingRevocations = false;
  const revocationSweep = setInterval(async () => {
    if (checkingRevocations) return;
    checkingRevocations = true;
    try {
      for (const [ws, payload] of authenticatedSockets) {
        try {
          if (await revoked(payload)) closeRevoked(ws);
        } catch (error) {
          log(`Signaling revocation check failed: ${error.message}`);
          closeRevoked(ws);
        }
      }
    } finally { checkingRevocations = false; }
  }, REVOCATION_SWEEP_INTERVAL_MS);

  function addConnection(userId, ws) {
    let connections = connectionsByUserId.get(userId);
    if (!connections) {
      connections = new Set();
      connectionsByUserId.set(userId, connections);
    }
    connections.add(ws);
  }

  function removeConnection(userId, ws) {
    const connections = connectionsByUserId.get(userId);
    if (!connections) {
      return;
    }
    connections.delete(ws);
    if (connections.size === 0) {
      connectionsByUserId.delete(userId);
    }
  }

  function sendJson(ws, message) {
    ws.send(JSON.stringify(message));
  }

  function notifyPeer(userId, message) {
    const connections = connectionsByUserId.get(userId);
    for (const ws of connections ?? []) {
      sendJson(ws, message);
    }
  }

  // Xoá session của cả hai phía. Tra peerUserId đã lưu trong session của chính
  // userId thay vì tin vào target_user_id do client gửi, để một bên không thể
  // xoá/giả mạo session của một cặp khác bằng cách gửi target_user_id tuỳ ý.
  function endSession(userId, { notifyReason } = {}) {
    const session = callSessionsByUserId.get(userId);
    if (!session) {
      return;
    }
    const { peerUserId, callId } = session;
    callSessionsByUserId.delete(userId);
    callSessionsByUserId.delete(peerUserId);

    if (notifyReason) {
      const endMessage = { type: "CALL_END", call_id: callId, data: { reason: notifyReason }, from_user_id: userId };
      notifyPeer(peerUserId, endMessage);
      notifyPeer(userId, endMessage);
    }
  }

  function sweepTimedOutSessions() {
    const now = Date.now();
    for (const [callId, expiresAt] of recentCallIds) {
      if (expiresAt <= now) recentCallIds.delete(callId);
    }
    for (const [userId, session] of callSessionsByUserId) {
      if (session.status === "pending" && now - session.lastActivityAt > sessionTimeoutMs) {
        endSession(userId, { notifyReason: "timeout" });
      }
    }
  }

  const sweepInterval = setInterval(sweepTimedOutSessions, sessionSweepIntervalMs);

  const wss = new WebSocketServer({ port, path: "/ws/signaling" });

  wss.on("connection", async (ws, request) => {
    const clientIp = resolveClientIp(request, trustedProxies);
    if (!rateLimiter.isAllowed(clientIp)) {
      ws.close(4029, "rate limit exceeded");
      return;
    }

    const token = extractToken(request.url);
    if (!token) {
      ws.close(4001, "missing token");
      return;
    }

    // WebSocket can be open on the client before the Redis revocation lookup
    // finishes. Keep frames until authentication completes so an immediate
    // CALL_OFFER cannot be lost.
    let authenticated = false;
    const pendingMessages = [];
    let messageWork = Promise.resolve();
    function processMessage(raw, userId) {
      messageWork = messageWork
        .then(async () => {
          if (ws.readyState !== 1) return;
          if (await revoked(payload)) {
            closeRevoked(ws);
            return;
          }
          await relayMessage(userId, raw, log);
        })
        .catch((error) => log(`Signaling WS: unexpected error relaying message from user ${userId}: ${error.message}`));
    }
    ws.on("message", (raw) => {
      if (!authenticated) {
        pendingMessages.push(raw);
      } else {
        processMessage(raw, payload.sub);
      }
    });

    let payload;
    try {
      payload = verifyAccessToken(token, jwtSecret);
      if (await revoked(payload)) {
        ws.close(4001, "revoked token");
        return;
      }
    } catch (error) {
      ws.close(4001, "invalid token");
      return;
    }

    const userId = payload.sub;
    if (ws.readyState !== 1) return;
    addConnection(userId, ws);
    authenticatedSockets.set(ws, payload);
    log(`Signaling WS connected: user ${userId}`);

    ws.on("close", () => {
      authenticatedSockets.delete(ws);
      removeConnection(userId, ws);
      // Ngắt kết nối đột ngột khi đang có cuộc gọi (pending hoặc active): báo CALL_END
      // cho phía còn lại và dọn session, để peer không bị treo chờ vô thời hạn.
      if (!connectionsByUserId.has(userId)) {
        endSession(userId, { notifyReason: "peer_disconnected" });
      }
      log(`Signaling WS disconnected: user ${userId}`);
    });

    const pending = callSessionsByUserId.get(userId);
    if (pending?.status === "pending" && pending.offer) {
      sendJson(ws, pending.offer);
    }
    authenticated = true;
    for (const raw of pendingMessages) processMessage(raw, userId);
    pendingMessages.length = 0;
  });

  function sendTargetOffline(senderUserId, targetUserId) {
    const senderConnections = connectionsByUserId.get(senderUserId);
    for (const senderWs of senderConnections ?? []) {
      sendJson(senderWs, {
        type: "ERROR",
        data: {
          code: "TARGET_OFFLINE",
          message: "Target user is not connected to the signaling server",
          target_user_id: targetUserId,
        },
      });
    }
  }

  function sendInvalidSession(senderUserId) {
    notifyPeer(senderUserId, {
      type: "ERROR",
      data: { code: "INVALID_CALL_SESSION", message: "No matching call session" },
    });
  }
  function sendBusy(senderUserId, targetUserId) {
    notifyPeer(senderUserId, { type: "ERROR", data: { code: "TARGET_BUSY", target_user_id: targetUserId } });
  }

  // Relay CALL_OFFER/CALL_ANSWER/ICE_CANDIDATE/CALL_REJECT/CALL_END tới target_user_id
  // (API Design mục 10.2), đồng thời cập nhật vòng đời session theo userId. Message
  // không parse được / type không thuộc danh sách relay bị bỏ qua với client (không
  // phản hồi lỗi cho input rác) nhưng vẫn log phía server để debug.
  async function relayMessage(senderUserId, raw, log) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch (error) {
      log(`Signaling WS: invalid JSON from user ${senderUserId}`);
      return;
    }

    const { type, target_user_id: targetUserId, call_id: callId } = message ?? {};
    if (!RELAY_MESSAGE_TYPES.has(type) || typeof targetUserId !== "string" || !targetUserId) {
      log(`Signaling WS: ignoring message with type "${type}" from user ${senderUserId}`);
      return;
    }
    if (type === "CALL_OFFER" && !isUuid(callId)) {
      sendInvalidSession(senderUserId);
      return;
    }
    if (type !== "CALL_OFFER" && (!isUuid(callId)
        || callSessionsByUserId.get(senderUserId)?.callId !== callId
        || callSessionsByUserId.get(targetUserId)?.callId !== callId)) {
      sendInvalidSession(senderUserId);
      return;
    }

    // CALL_OFFER: gọi backend TRƯỚC khi kiểm tra/relay qua Signaling WS. B thường
    // CHƯA có kết nối Signaling WS ở thời điểm này (đó là lý do P3-T04 tồn tại) —
    // notify đẩy CALL_INCOMING cho B qua Messaging WS. Callee không tồn tại/xoá
    // mềm và callee offline được gộp thành CÙNG một lỗi trung tính cho A
    // (anti-enumeration ở ranh giới signaling->client, không phải backend->signaling).
    if (type === "CALL_OFFER") {
      if (recentCallIds.has(callId)) {
        sendInvalidSession(senderUserId);
        return;
      }
      if (callSessionsByUserId.has(senderUserId) || callSessionsByUserId.has(targetUserId)) {
        sendBusy(senderUserId, targetUserId);
        return;
      }
      const newCallId = callId;
      const now = Date.now();
      recentCallIds.set(newCallId, now + 15 * 60_000);
      const offer = { ...message, call_id: newCallId, from_user_id: senderUserId };
      callSessionsByUserId.set(senderUserId, { peerUserId: targetUserId, callId: newCallId, status: "pending", lastActivityAt: now });
      callSessionsByUserId.set(targetUserId, { peerUserId: senderUserId, callId: newCallId, status: "pending", lastActivityAt: now, offer });
      const result = await callNotifyClient.notify(senderUserId, targetUserId, newCallId);
      if (result !== "notified") {
        if (callSessionsByUserId.get(senderUserId)?.callId === newCallId) endSession(senderUserId);
        sendTargetOffline(senderUserId, targetUserId);
        return;
      }
      if (callSessionsByUserId.get(senderUserId)?.callId !== newCallId) return;
      message = offer;
    }

    if (type !== "CALL_OFFER") {
      const senderSession = callSessionsByUserId.get(senderUserId);
      const targetSession = callSessionsByUserId.get(targetUserId);
      if (!senderSession || !targetSession
          || senderSession.peerUserId !== targetUserId
          || targetSession.peerUserId !== senderUserId
          || (type === "CALL_ANSWER" && senderSession.status !== "pending")
          || (type === "CALL_REJECT" && senderSession.status !== "pending")) {
        sendInvalidSession(senderUserId);
        return;
      }
    }

    const targetConnections = connectionsByUserId.get(targetUserId);
    if (!targetConnections || targetConnections.size === 0) {
      if (type !== "CALL_OFFER") {
        sendTargetOffline(senderUserId, targetUserId);
        return;
      }
    }

    if (type === "CALL_REJECT" || type === "CALL_END") {
      // Xoá session trước khi relay - không notifyReason ở đây vì message gốc
      // (CALL_REJECT/CALL_END) đã được relay nguyên văn tới peer bên dưới.
      endSession(senderUserId, {});
    } else if (type === "CALL_ANSWER") {
      const senderSession = callSessionsByUserId.get(senderUserId);
      const targetSession = callSessionsByUserId.get(targetUserId);
      if (senderSession) senderSession.status = "active";
      if (targetSession) targetSession.status = "active";
    } else if (type === "ICE_CANDIDATE") {
      const senderSession = callSessionsByUserId.get(senderUserId);
      if (senderSession) senderSession.lastActivityAt = Date.now();
    }

    const relayed = { ...message, from_user_id: senderUserId };
    for (const targetWs of targetConnections ?? []) {
      sendJson(targetWs, relayed);
    }
  }

  function stop() {
    clearInterval(sweepInterval);
    clearInterval(revocationSweep);
    return new Promise((resolve) => wss.close(resolve));
  }

  return { wss, connectionsByUserId, callSessionsByUserId, stop };
}

module.exports = { createServer };
