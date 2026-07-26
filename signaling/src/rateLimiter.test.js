const test = require("node:test");
const assert = require("node:assert/strict");
const { resolveClientIp, parseTrustedProxyIps, createConnectionRateLimiter } = require("./rateLimiter");

test("resolveClientIp uses remoteAddress when proxy is not trusted", () => {
  const request = {
    socket: { remoteAddress: "203.0.113.5" },
    headers: { "x-forwarded-for": "198.51.100.9" },
  };
  const ip = resolveClientIp(request, parseTrustedProxyIps(""));
  assert.strictEqual(ip, "203.0.113.5");
});

test("resolveClientIp uses X-Forwarded-For only when remoteAddress is a trusted proxy", () => {
  const request = {
    socket: { remoteAddress: "127.0.0.1" },
    headers: { "x-forwarded-for": "198.51.100.9, 10.0.0.1" },
  };
  const ip = resolveClientIp(request, parseTrustedProxyIps("127.0.0.1"));
  assert.strictEqual(ip, "198.51.100.9");
});

test("resolveClientIp falls back to remoteAddress when X-Forwarded-For is missing", () => {
  const request = { socket: { remoteAddress: "127.0.0.1" }, headers: {} };
  const ip = resolveClientIp(request, parseTrustedProxyIps("127.0.0.1"));
  assert.strictEqual(ip, "127.0.0.1");
});

test("createConnectionRateLimiter allows up to the max within the window", () => {
  const limiter = createConnectionRateLimiter({ windowMs: 60000, maxConnections: 20 });
  for (let i = 0; i < 20; i += 1) {
    assert.strictEqual(limiter.isAllowed("1.2.3.4"), true);
  }
  assert.strictEqual(limiter.isAllowed("1.2.3.4"), false);
});

test("createConnectionRateLimiter tracks IPs independently", () => {
  const limiter = createConnectionRateLimiter({ windowMs: 60000, maxConnections: 1 });
  assert.strictEqual(limiter.isAllowed("1.1.1.1"), true);
  assert.strictEqual(limiter.isAllowed("2.2.2.2"), true);
  assert.strictEqual(limiter.isAllowed("1.1.1.1"), false);
});

test("createConnectionRateLimiter resets after the window elapses", async () => {
  const limiter = createConnectionRateLimiter({ windowMs: 20, maxConnections: 1 });
  assert.strictEqual(limiter.isAllowed("1.1.1.1"), true);
  assert.strictEqual(limiter.isAllowed("1.1.1.1"), false);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.strictEqual(limiter.isAllowed("1.1.1.1"), true);
});
