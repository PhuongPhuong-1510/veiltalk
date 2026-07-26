const { WebSocketServer } = require("ws");
const { verifyAccessToken, extractToken } = require("./auth");

function createServer({ port, jwtSecret, log = console.log }) {
  if (!jwtSecret) {
    throw new Error("jwtSecret is required to start the signaling server");
  }

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

    ws.on("close", () => {
      removeConnection(userId, ws);
      log(`Signaling WS disconnected: user ${userId}`);
    });
  });

  return { wss, connectionsByUserId };
}

module.exports = { createServer };
