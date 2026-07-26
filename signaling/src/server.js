const { WebSocketServer } = require("ws");
const { verifyAccessToken, extractToken } = require("./auth");
const { resolveClientIp, parseTrustedProxyIps, createConnectionRateLimiter } = require("./rateLimiter");

const RELAY_MESSAGE_TYPES = new Set(["CALL_OFFER", "CALL_ANSWER", "ICE_CANDIDATE", "CALL_REJECT", "CALL_END"]);
const SESSION_TIMEOUT_MS = 30_000;
const SESSION_SWEEP_INTERVAL_MS = 5_000;

function createServer({
  port,
  jwtSecret,
  trustedProxyIps = "",
  log = console.log,
  sessionTimeoutMs = SESSION_TIMEOUT_MS,
  sessionSweepIntervalMs = SESSION_SWEEP_INTERVAL_MS,
}) {
  if (!jwtSecret) {
    throw new Error("jwtSecret is required to start the signaling server");
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
    const { peerUserId } = session;
    callSessionsByUserId.delete(userId);
    callSessionsByUserId.delete(peerUserId);

    if (notifyReason) {
      const endMessage = { type: "CALL_END", data: { reason: notifyReason }, from_user_id: userId };
      notifyPeer(peerUserId, endMessage);
      notifyPeer(userId, endMessage);
    }
  }

  function sweepTimedOutSessions() {
    const now = Date.now();
    for (const [userId, session] of callSessionsByUserId) {
      if (session.status === "pending" && now - session.lastActivityAt > sessionTimeoutMs) {
        endSession(userId, { notifyReason: "timeout" });
      }
    }
  }

  const sweepInterval = setInterval(sweepTimedOutSessions, sessionSweepIntervalMs);

  const wss = new WebSocketServer({ port, path: "/ws/signaling" });

  wss.on("connection", (ws, request) => {
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

    let payload;
    try {
      payload = verifyAccessToken(token, jwtSecret);
    } catch (error) {
      ws.close(4001, "invalid token");
      return;
    }

    const userId = payload.sub;
    addConnection(userId, ws);
    log(`Signaling WS connected: user ${userId}`);

    ws.on("message", (raw) => {
      relayMessage(userId, raw, log);
    });

    ws.on("close", () => {
      removeConnection(userId, ws);
      // Ngắt kết nối đột ngột khi đang có cuộc gọi (pending hoặc active): báo CALL_END
      // cho phía còn lại và dọn session, để peer không bị treo chờ vô thời hạn.
      endSession(userId, { notifyReason: "peer_disconnected" });
      log(`Signaling WS disconnected: user ${userId}`);
    });
  });

  // Relay CALL_OFFER/CALL_ANSWER/ICE_CANDIDATE/CALL_REJECT/CALL_END tới target_user_id
  // (API Design mục 10.2), đồng thời cập nhật vòng đời session theo userId. Message
  // không parse được / type không thuộc danh sách relay bị bỏ qua với client (không
  // phản hồi lỗi cho input rác) nhưng vẫn log phía server để debug.
  function relayMessage(senderUserId, raw, log) {
    let message;
    try {
      message = JSON.parse(raw);
    } catch (error) {
      log(`Signaling WS: invalid JSON from user ${senderUserId}`);
      return;
    }

    const { type, target_user_id: targetUserId } = message ?? {};
    if (!RELAY_MESSAGE_TYPES.has(type) || typeof targetUserId !== "string" || !targetUserId) {
      log(`Signaling WS: ignoring message with type "${type}" from user ${senderUserId}`);
      return;
    }

    const targetConnections = connectionsByUserId.get(targetUserId);
    if (!targetConnections || targetConnections.size === 0) {
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
      return;
    }

    if (type === "CALL_REJECT" || type === "CALL_END") {
      // Xoá session trước khi relay - không notifyReason ở đây vì message gốc
      // (CALL_REJECT/CALL_END) đã được relay nguyên văn tới peer bên dưới.
      endSession(senderUserId, {});
    } else if (type === "CALL_OFFER") {
      const now = Date.now();
      callSessionsByUserId.set(senderUserId, { peerUserId: targetUserId, status: "pending", lastActivityAt: now });
      callSessionsByUserId.set(targetUserId, { peerUserId: senderUserId, status: "pending", lastActivityAt: now });
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
    for (const targetWs of targetConnections) {
      sendJson(targetWs, relayed);
    }
  }

  function stop() {
    clearInterval(sweepInterval);
    return new Promise((resolve) => wss.close(resolve));
  }

  return { wss, connectionsByUserId, callSessionsByUserId, stop };
}

module.exports = { createServer };
