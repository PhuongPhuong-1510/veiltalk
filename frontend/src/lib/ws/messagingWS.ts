import { refreshAccessToken } from "../api";
import { useAuthStore } from "../store/authStore";

const BASE_WS_URL = (import.meta.env.VITE_WS_BASE_URL ?? "ws://localhost:8080").replace(/^http/, "ws");

// Close code do server chủ động đóng vì lý do "không tự phục hồi" — không nên
// reconnect. 1006/1011/1001/4002/4003 đều thuộc nhóm "mất kết nối cần khôi
// phục": 1006 mất mạng, 1011/1001 lỗi/tắt server, 4002 token hết hạn giữa
// chừng (reconnect sẽ tự refresh), 4003 chỉ là timeout heartbeat (tab bị
// throttle ở background hoặc mất mạng), KHÔNG phải bị từ chối quyền truy cập
// (API 04 mục 10.1) — nên vẫn coi là đáng thử lại.
const NO_RECONNECT_CODES = new Set([1000]);

interface ServerMessage {
  type: string;
  data?: unknown;
}

type MessageHandler = (data: unknown) => void;
type ConnectionStatus = "connecting" | "open" | "reconnecting" | "closed";
type StatusHandler = (status: ConnectionStatus) => void;

const KNOWN_SERVER_TYPES = new Set([
  "NEW_MESSAGE",
  "MESSAGE_STATUS_UPDATE",
  "CALL_INCOMING",
  "PING",
  "ERROR",
]);

const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;
const MAX_ATTEMPTS = 10;

let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempts = 0;
let manuallyClosed = false;
let unsubscribeAuth: (() => void) | null = null;

const messageHandlers = new Map<string, Set<MessageHandler>>();
const statusHandlers = new Set<StatusHandler>();

function emitStatus(status: ConnectionStatus): void {
  for (const handler of statusHandlers) {
    handler(status);
  }
}

function clearReconnectTimer(): void {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(): void {
  if (manuallyClosed || useAuthStore.getState().status !== "authenticated") {
    return;
  }
  if (reconnectAttempts >= MAX_ATTEMPTS) {
    emitStatus("closed");
    return;
  }

  reconnectAttempts += 1;
  const exponential = Math.min(BASE_DELAY_MS * 2 ** (reconnectAttempts - 1), MAX_DELAY_MS);
  const jitter = exponential * (0.8 + Math.random() * 0.4);

  emitStatus("reconnecting");
  clearReconnectTimer();
  reconnectTimer = setTimeout(() => {
    if (manuallyClosed || useAuthStore.getState().status !== "authenticated") {
      return;
    }
    openSocket();
  }, jitter);
}

function dispatchMessage(raw: string): void {
  let parsed: ServerMessage;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn("[messagingWS] frame JSON không hợp lệ, bỏ qua");
    return;
  }

  if (typeof parsed.type !== "string" || !KNOWN_SERVER_TYPES.has(parsed.type)) {
    console.warn("[messagingWS] type không nhận diện được, bỏ qua:", parsed.type);
    return;
  }

  if (parsed.type === "PING") {
    socket?.send(JSON.stringify({ type: "PONG" }));
    return;
  }

  const handlers = messageHandlers.get(parsed.type);
  if (!handlers) {
    return;
  }
  for (const handler of handlers) {
    try {
      handler(parsed.data);
    } catch (error) {
      console.error(`[messagingWS] handler cho ${parsed.type} lỗi:`, error);
    }
  }
}

// 401 trước upgrade (TC-47) khiến trình duyệt chỉ báo `close` mơ hồ, không lộ
// status code thật. Ta không phân biệt được với mất mạng thuần túy từ code đó
// — nên coi "đóng gần như ngay sau khi mở, chưa từng nhận message nào" là dấu
// hiệu nghi auth, thử refresh một lần trước khi rơi vào chuỗi reconnect thường.
async function tryRefreshThenReconnect(): Promise<void> {
  try {
    await refreshAccessToken();
  } catch {
    // refreshAccessToken() đã tự gọi onAuthFailure() khi thất bại; authStore
    // chuyển sang unauthenticated, scheduleReconnect() sẽ tự dừng ở đó.
  }
  scheduleReconnect();
}

function openSocket(): void {
  const accessToken = useAuthStore.getState().accessToken;
  if (!accessToken) {
    return;
  }

  manuallyClosed = false;
  emitStatus(reconnectAttempts > 0 ? "reconnecting" : "connecting");

  const ws = new WebSocket(`${BASE_WS_URL}/ws/messaging?token=${encodeURIComponent(accessToken)}`);
  socket = ws;

  const openedAt = Date.now();
  let receivedAnything = false;

  ws.onopen = () => {
    reconnectAttempts = 0;
    emitStatus("open");
  };

  ws.onmessage = (event) => {
    receivedAnything = true;
    dispatchMessage(event.data);
  };

  ws.onclose = (event) => {
    if (socket === ws) {
      socket = null;
    }

    if (manuallyClosed || NO_RECONNECT_CODES.has(event.code)) {
      emitStatus("closed");
      return;
    }

    const suspiciousAuthFailure = !receivedAnything && Date.now() - openedAt < 1000;
    if (suspiciousAuthFailure) {
      void tryRefreshThenReconnect();
      return;
    }

    scheduleReconnect();
  };

  ws.onerror = () => {
    // onclose luôn bắn theo sau onerror cho lỗi kết nối — không cần scheduleReconnect ở đây.
  };
}

export function connectMessagingWS(): void {
  if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) {
    return;
  }

  manuallyClosed = false;
  reconnectAttempts = 0;
  clearReconnectTimer();

  if (!unsubscribeAuth) {
    unsubscribeAuth = useAuthStore.subscribe((state) => {
      if (state.status === "unauthenticated") {
        disconnectMessagingWS("logout");
      }
    });
  }

  openSocket();
}

export function disconnectMessagingWS(reason: "logout" | "manual" = "manual"): void {
  manuallyClosed = true;
  clearReconnectTimer();
  reconnectAttempts = 0;

  if (socket) {
    socket.close(1000, reason);
    socket = null;
  }

  emitStatus("closed");
}

function send(type: string, data: unknown): void {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type, data }));
  }
}

export function sendTyping(conversationId: string): void {
  send("TYPING", { conversation_id: conversationId });
}

export function sendTypingStop(conversationId: string): void {
  send("TYPING_STOP", { conversation_id: conversationId });
}

export function onMessage(type: string, handler: MessageHandler): () => void {
  let handlers = messageHandlers.get(type);
  if (!handlers) {
    handlers = new Set();
    messageHandlers.set(type, handlers);
  }
  handlers.add(handler);
  return () => {
    handlers?.delete(handler);
  };
}

export function onStatusChange(handler: StatusHandler): () => void {
  statusHandlers.add(handler);
  return () => {
    statusHandlers.delete(handler);
  };
}
