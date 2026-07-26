require("dotenv").config({ quiet: true });

const { createServer } = require("./server");
const { createCallNotifyClient } = require("./callNotifyClient");

const port = process.env.PORT || 3000;
const jwtSecret = process.env.SIGNALING_JWT_SECRET;

if (!jwtSecret) {
  console.error("SIGNALING_JWT_SECRET is required to start the signaling server");
  process.exit(1);
}

const callNotifySecret = process.env.INTERNAL_CALL_NOTIFY_SECRET;
if (!callNotifySecret) {
  console.error("INTERNAL_CALL_NOTIFY_SECRET is required to start the signaling server");
  process.exit(1);
}

const backendUrl = process.env.BACKEND_URL || "http://localhost:8080";
const callNotifyTimeoutMs = Number(process.env.CALL_NOTIFY_TIMEOUT_MS) || 2500;

const trustedProxyIps = process.env.TRUSTED_PROXY_IPS || "";

const callNotifyClient = createCallNotifyClient({
  backendUrl,
  secret: callNotifySecret,
  timeoutMs: callNotifyTimeoutMs,
});

createServer({ port, jwtSecret, trustedProxyIps, callNotifyClient });

console.log(`VeilTalk signaling server listening on port ${port}`);
