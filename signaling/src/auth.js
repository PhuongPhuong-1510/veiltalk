const jwt = require("jsonwebtoken");

// Signaling Server chỉ validate chữ ký + claim JWT tại handshake; không gọi
// Backend API để xác minh — tránh tăng độ trễ thiết lập cuộc gọi (SAD mục 4.2).
function verifyAccessToken(token, secret) {
  const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
  if (payload.type !== "access" || typeof payload.sub !== "string" || !payload.sub) {
    throw new Error("Token is not a valid access token");
  }
  return payload;
}

function extractToken(requestUrl) {
  const url = new URL(requestUrl, "http://localhost");
  const tokens = url.searchParams.getAll("token");
  if (tokens.length !== 1 || !tokens[0]) {
    return null;
  }
  return tokens[0];
}

module.exports = { verifyAccessToken, extractToken };
