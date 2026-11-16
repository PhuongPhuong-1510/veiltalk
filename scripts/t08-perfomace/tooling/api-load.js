import http from "k6/http";
import { check, sleep } from "k6";

const baseUrl = __ENV.BASE_URL || "http://host.docker.internal:8081";
const email = __ENV.TEST_EMAIL;
const password = __ENV.TEST_PASSWORD || "PerfTest123!";

export const options = {
  vus: Number(__ENV.VUS || 10),
  duration: __ENV.DURATION || "30s",
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{endpoint:conversations}": ["p(95)<200"],
    "http_req_duration{endpoint:messages}": ["p(95)<200"],
    "http_req_duration{endpoint:send_message}": ["p(95)<300"],
    "http_req_duration{endpoint:avatar_models}": ["p(95)<100"],
  },
};

function uuidV4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === "x" ? random : (random & 3) | 8).toString(16);
  });
}

export function setup() {
  if (!email) throw new Error("TEST_EMAIL is required");
  const login = http.post(`${baseUrl}/auth/login`, JSON.stringify({ email, password }), {
    headers: { "Content-Type": "application/json" },
    tags: { endpoint: "login" },
  });
  if (login.status !== 200) throw new Error(`Login failed with HTTP ${login.status}: ${login.body}`);
  const accessToken = login.json("tokens.access_token");
  const headers = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
  const conversations = http.get(`${baseUrl}/conversations?limit=20`, { headers, tags: { endpoint: "conversations" } });
  if (conversations.status !== 200) throw new Error(`Conversation bootstrap failed with HTTP ${conversations.status}`);
  const conversationId = conversations.json("data.0.id");
  if (!conversationId) throw new Error("Seed account has no conversation");
  return { headers, conversationId };
}

export default function (data) {
  const conversations = http.get(`${baseUrl}/conversations?limit=20`, {
    headers: data.headers,
    tags: { endpoint: "conversations" },
  });
  check(conversations, { "conversation list 200": (response) => response.status === 200 });

  const messages = http.get(`${baseUrl}/conversations/${data.conversationId}/messages?limit=30`, {
    headers: data.headers,
    tags: { endpoint: "messages" },
  });
  check(messages, { "message history 200": (response) => response.status === 200 });

  const models = http.get(`${baseUrl}/avatars/models`, {
    tags: { endpoint: "avatar_models" },
  });
  check(models, { "avatar catalog 200": (response) => response.status === 200 });

  if (__ITER % 10 === 0) {
    const sent = http.post(
      `${baseUrl}/conversations/${data.conversationId}/messages`,
      JSON.stringify({ id: uuidV4(), content: `k6 VU ${__VU} iteration ${__ITER}`, client_timestamp: new Date().toISOString() }),
      { headers: data.headers, tags: { endpoint: "send_message" } },
    );
    check(sent, { "send message 200 or 201": (response) => response.status === 200 || response.status === 201 });
  }
  sleep(Number(__ENV.SLEEP_SECONDS || 0.2));
}
