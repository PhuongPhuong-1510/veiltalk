import { request } from "../client";

export function sendClientMetrics(fields: {
  session_type: "call" | "preview";
  tracking_latency_ms?: number;
  fps?: number;
  webrtc_rtt_ms?: number;
  timestamp: string;
}) {
  return request<void>("/metrics/client", { method: "POST", body: fields });
}
