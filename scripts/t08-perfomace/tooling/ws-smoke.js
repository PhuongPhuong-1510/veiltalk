import ws from "k6/ws";
import { check } from "k6";

export const options = {
  vus: Number(__ENV.VUS || 1),
  iterations: Number(__ENV.ITERATIONS || __ENV.VUS || 1),
  thresholds: { checks: ["rate==1"], ws_connecting: ["p(95)<1000"] },
};

export default function () {
  const wsUrl = __ENV.WS_URL || "ws://host.docker.internal:8081/ws/messaging";
  const token = __ENV.ACCESS_TOKEN;
  if (!token) throw new Error("ACCESS_TOKEN is required");
  const response = ws.connect(`${wsUrl}?token=${encodeURIComponent(token)}`, {}, (socket) => {
    socket.on("open", () => socket.setTimeout(() => socket.close(), Number(__ENV.HOLD_MS || 5000)));
    socket.on("message", (payload) => {
      const event = JSON.parse(payload);
      if (event.type === "PING") socket.send(JSON.stringify({ type: "PONG" }));
    });
  });
  check(response, { "websocket upgraded": (result) => result && result.status === 101 });
}
