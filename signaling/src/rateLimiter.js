const WINDOW_MS = 60 * 1000;
const MAX_CONNECTIONS_PER_WINDOW = 20;

// Chỉ tin X-Forwarded-For khi request đến từ proxy nằm trong danh sách tin cậy
// (ví dụ Nginx trên internal-net). Không cấu hình / rỗng => không tin proxy nào,
// dùng remoteAddress — an toàn hơn là mặc định tin mọi header do client tự set
// (kẻ tấn công có thể giả X-Forwarded-For để né rate limit).
function resolveClientIp(request, trustedProxyIps) {
  const remoteAddress = request.socket.remoteAddress;
  const forwardedFor = request.headers["x-forwarded-for"];

  if (!forwardedFor || !trustedProxyIps.has(remoteAddress)) {
    return remoteAddress;
  }

  const [clientIp] = forwardedFor.split(",");
  return clientIp.trim() || remoteAddress;
}

function parseTrustedProxyIps(value) {
  if (!value) {
    return new Set();
  }
  return new Set(
    value
      .split(",")
      .map((ip) => ip.trim())
      .filter(Boolean)
  );
}

// 20 connections/IP/phút (SAD mục 4.2, 9.4) chống flood WebSocket handshake vào Signaling Server.
function createConnectionRateLimiter({ windowMs = WINDOW_MS, maxConnections = MAX_CONNECTIONS_PER_WINDOW } = {}) {
  const countersByIp = new Map();

  function isAllowed(ip) {
    const now = Date.now();
    const counter = countersByIp.get(ip);

    if (!counter || now - counter.windowStart >= windowMs) {
      countersByIp.set(ip, { windowStart: now, count: 1 });
      return true;
    }

    if (counter.count >= maxConnections) {
      return false;
    }

    counter.count += 1;
    return true;
  }

  return { isAllowed };
}

module.exports = { resolveClientIp, parseTrustedProxyIps, createConnectionRateLimiter };
