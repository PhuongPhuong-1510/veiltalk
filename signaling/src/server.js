const { WebSocketServer } = require("ws");
const { verifyAccessToken, extractToken } = require("./auth");
const { resolveClientIp, parseTrustedProxyIps, createConnectionRateLimiter } = require("./rateLimiter");

const RELAY_MESSAGE_TYPES = new Set(["CALL_OFFER", "CALL_ANSWER", "ICE_CANDIDATE"]);

function createServer({ port, jwtSecret, trustedProxyIps = "", log = console.log }) {
  if (!jwtSecret) {
    throw new Error("jwtSecret is required to start the signaling server");
  }

  const trustedProxies = parseTrustedProxyIps(trustedProxyIps);
  const rateLimiter = createConnectionRateLimiter();

  // userId -> Set<WebSocket>, dùng cho relay ở P3-T02.
  const connectionsByUserId = new Map();

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
      log(`Signaling WS disconnected: user ${userId}`);
    });
  });

  function sendJson(ws, message) {
    ws.send(JSON.stringify(message));
  }

  // Relay CALL_OFFER/CALL_ANSWER/ICE_CANDIDATE tới target_user_id (API Design mục 10.2).
  // Message không parse được / type không thuộc danh sách relay bị bỏ qua với client
  // (không phản hồi lỗi cho input rác) nhưng vẫn log phía server để debug.
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

    const relayed = { ...message, from_user_id: senderUserId };
    for (const targetWs of targetConnections) {
      sendJson(targetWs, relayed);
    }
  }

  return { wss, connectionsByUserId };
}

module.exports = { createServer };
