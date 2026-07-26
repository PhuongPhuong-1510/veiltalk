const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const dotenv = require("dotenv");
const jwt = require("jsonwebtoken");
const { verifyAccessToken, extractToken } = require("./auth");

const { parsed: envFromFile } = dotenv.config({
  path: path.resolve(__dirname, "..", "..", ".env"),
  quiet: true,
});

function signAccessToken(secret, overrides = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    type: "access",
    jti: "11111111-1111-1111-1111-111111111111",
    iat: now,
    exp: now + 900,
    sub: "a310fc8c-109f-4e53-91ee-8fcd508f7512",
    role: "user",
    ...overrides,
  };
  return jwt.sign(payload, secret, { algorithm: "HS256", noTimestamp: true });
}

test("JWT_SECRET and SIGNALING_JWT_SECRET in .env are identical", () => {
  assert.ok(envFromFile, ".env file must exist at repo root for this check");
  assert.ok(envFromFile.JWT_SECRET, "JWT_SECRET must be set in .env");
  assert.strictEqual(
    envFromFile.SIGNALING_JWT_SECRET,
    envFromFile.JWT_SECRET,
    "SIGNALING_JWT_SECRET must match JWT_SECRET exactly, or backend-issued tokens will fail signaling auth"
  );
});

test("verifyAccessToken accepts a token signed with the real SIGNALING_JWT_SECRET", () => {
  const token = signAccessToken(envFromFile.SIGNALING_JWT_SECRET);

  const claims = verifyAccessToken(token, envFromFile.SIGNALING_JWT_SECRET);

  assert.strictEqual(claims.sub, "a310fc8c-109f-4e53-91ee-8fcd508f7512");
  assert.strictEqual(claims.type, "access");
});

test("verifyAccessToken rejects a token signed with a different secret", () => {
  const token = signAccessToken("a-completely-different-secret-value");

  assert.throws(() => verifyAccessToken(token, envFromFile.SIGNALING_JWT_SECRET));
});

test("verifyAccessToken rejects a refresh token", () => {
  const token = signAccessToken(envFromFile.SIGNALING_JWT_SECRET, {
    type: "refresh",
    sub: undefined,
    role: undefined,
  });

  assert.throws(() => verifyAccessToken(token, envFromFile.SIGNALING_JWT_SECRET));
});

test("extractToken reads a single token query parameter", () => {
  assert.strictEqual(extractToken("/ws/signaling?token=abc123"), "abc123");
});

test("extractToken returns null when token is missing", () => {
  assert.strictEqual(extractToken("/ws/signaling"), null);
});

test("extractToken returns null when token is duplicated", () => {
  assert.strictEqual(extractToken("/ws/signaling?token=a&token=b"), null);
});
