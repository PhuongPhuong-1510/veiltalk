import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string) {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  key(index: number) {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
}
vi.stubGlobal("sessionStorage", new MemoryStorage());

const authApiMock = { login: vi.fn(), register: vi.fn(), refresh: vi.fn(), logout: vi.fn() };
const usersApiMock = { getMe: vi.fn() };
const refreshAccessTokenMock = vi.fn();

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return {
    authApi: authApiMock,
    usersApi: usersApiMock,
    configureAuthHooks: actual.configureAuthHooks,
    refreshAccessToken: refreshAccessTokenMock,
  };
});

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code = 1000) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code });
  }

  triggerOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  triggerMessage(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  triggerRawMessage(raw: string) {
    this.onmessage?.({ data: raw });
  }

  triggerClose(code: number) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code });
  }
}

describe("messagingWS", () => {
  let useAuthStore: typeof import("../store/authStore").useAuthStore;
  let ws: typeof import("./messagingWS");

  beforeEach(async () => {
    vi.useFakeTimers();
    sessionStorage.clear();
    vi.resetModules();
    MockWebSocket.instances = [];
    refreshAccessTokenMock.mockReset();
    vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);

    ({ useAuthStore } = await import("../store/authStore"));
    ws = await import("./messagingWS");

    useAuthStore.setState({
      user: { id: "u1", email: "a@b.com", display_name: "A", role: "user", created_at: "2026-01-01T00:00:00Z" },
      accessToken: "token-1",
      status: "authenticated",
    });
  });

  afterEach(() => {
    ws.disconnectMessagingWS();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.stubGlobal("sessionStorage", new MemoryStorage());
  });

  it("connect gắn đúng access token hiện tại vào query", () => {
    ws.connectMessagingWS();
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toContain("token=token-1");
  });

  it("connect không tạo socket thứ hai khi đã đang mở (idempotent)", () => {
    ws.connectMessagingWS();
    MockWebSocket.instances[0].triggerOpen();
    ws.connectMessagingWS();
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("connect không tạo socket thứ hai khi socket còn đang CONNECTING (idempotent)", () => {
    ws.connectMessagingWS();
    expect(MockWebSocket.instances[0].readyState).toBe(MockWebSocket.CONNECTING);

    ws.connectMessagingWS();

    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("NEW_MESSAGE -> đúng handler được gọi với đúng data", () => {
    const handler = vi.fn();
    ws.onMessage("NEW_MESSAGE", handler);
    ws.connectMessagingWS();
    MockWebSocket.instances[0].triggerOpen();
    MockWebSocket.instances[0].triggerMessage({ type: "NEW_MESSAGE", data: { id: "m1" } });
    expect(handler).toHaveBeenCalledWith({ id: "m1" });
  });

  it("onMessage unsubscribe -> handler không còn được gọi", () => {
    const handler = vi.fn();
    const unsubscribe = ws.onMessage("NEW_MESSAGE", handler);
    ws.connectMessagingWS();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    unsubscribe();
    socket.triggerMessage({ type: "NEW_MESSAGE", data: { id: "m1" } });

    expect(handler).not.toHaveBeenCalled();
  });

  it("một message handler throw -> handler kế tiếp vẫn chạy", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const throwingHandler = vi.fn(() => {
      throw new Error("handler failed");
    });
    const nextHandler = vi.fn();
    ws.onMessage("NEW_MESSAGE", throwingHandler);
    ws.onMessage("NEW_MESSAGE", nextHandler);
    ws.connectMessagingWS();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();

    expect(() => socket.triggerMessage({ type: "NEW_MESSAGE", data: { id: "m1" } })).not.toThrow();
    expect(throwingHandler).toHaveBeenCalledOnce();
    expect(nextHandler).toHaveBeenCalledWith({ id: "m1" });
    consoleError.mockRestore();
  });

  it("JSON hỏng -> không throw, không gọi handler nào", () => {
    const handler = vi.fn();
    ws.onMessage("NEW_MESSAGE", handler);
    ws.connectMessagingWS();
    MockWebSocket.instances[0].triggerOpen();
    expect(() => MockWebSocket.instances[0].triggerRawMessage("{not json")).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("type lạ -> bỏ qua, không crash, không gọi handler", () => {
    const handler = vi.fn();
    ws.onMessage("NEW_MESSAGE", handler);
    ws.connectMessagingWS();
    MockWebSocket.instances[0].triggerOpen();
    expect(() => MockWebSocket.instances[0].triggerMessage({ type: "SOME_FUTURE_TYPE", data: {} })).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("PING -> tự trả PONG, không emit ra ngoài", () => {
    const pingHandler = vi.fn();
    ws.onMessage("PING", pingHandler);
    ws.connectMessagingWS();
    const socket = MockWebSocket.instances[0];
    socket.triggerOpen();
    socket.triggerMessage({ type: "PING" });

    expect(socket.sent).toEqual([JSON.stringify({ type: "PONG" })]);
    expect(pingHandler).not.toHaveBeenCalled();
  });

  it("close code 1006 sau khi đã nhận message -> reconnect sau backoff ~1s", () => {
    ws.connectMessagingWS();
    const first = MockWebSocket.instances[0];
    first.triggerOpen();
    first.triggerMessage({ type: "NEW_MESSAGE", data: {} });
    first.triggerClose(1006);

    expect(MockWebSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1300);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("reconnect thành công reset backoff -> lần rớt tiếp theo quay lại ~1s", () => {
    ws.connectMessagingWS();
    const first = MockWebSocket.instances[0];
    first.triggerOpen();
    first.triggerMessage({ type: "NEW_MESSAGE", data: {} });
    first.triggerClose(1006);

    vi.advanceTimersByTime(1300);
    const failedOnce = MockWebSocket.instances[1];
    failedOnce.triggerMessage({ type: "NEW_MESSAGE", data: {} });
    failedOnce.triggerClose(1006);

    vi.advanceTimersByTime(2500);
    const failedTwice = MockWebSocket.instances[2];
    failedTwice.triggerMessage({ type: "NEW_MESSAGE", data: {} });
    failedTwice.triggerClose(1006);

    vi.advanceTimersByTime(5000);
    const reconnected = MockWebSocket.instances[3];
    reconnected.triggerOpen();
    reconnected.triggerMessage({ type: "NEW_MESSAGE", data: {} });
    reconnected.triggerClose(1006);

    vi.advanceTimersByTime(1300);
    expect(MockWebSocket.instances).toHaveLength(5);
  });

  it("close code 1000 (client tự đóng) -> không reconnect", () => {
    ws.connectMessagingWS();
    const first = MockWebSocket.instances[0];
    first.triggerOpen();
    first.triggerClose(1000);

    vi.advanceTimersByTime(60000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("close ngay sau khi mở, chưa nhận message nào (nghi 401) -> gọi refreshAccessToken rồi reconnect", async () => {
    refreshAccessTokenMock.mockImplementationOnce(async () => {
      useAuthStore.setState({ accessToken: "token-2" });
      return "token-2";
    });
    ws.connectMessagingWS();
    const first = MockWebSocket.instances[0];
    first.triggerClose(1006);

    await vi.waitFor(() => expect(refreshAccessTokenMock).toHaveBeenCalledTimes(1));
    vi.advanceTimersByTime(1300);
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(MockWebSocket.instances[1].url).toContain("token=token-2");
  });

  it("logout giữa lúc đang chờ reconnect -> không tạo socket mới", () => {
    ws.connectMessagingWS();
    const first = MockWebSocket.instances[0];
    first.triggerOpen();
    first.triggerMessage({ type: "NEW_MESSAGE", data: {} });
    first.triggerClose(1006);

    useAuthStore.setState({ status: "unauthenticated", user: null, accessToken: null });

    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("vượt quá maxAttempts -> dừng hẳn, status closed, không còn timer treo", () => {
    const statusHandler = vi.fn();
    ws.onStatusChange(statusHandler);
    ws.connectMessagingWS();
    // Lần connect đầu: mở thành công rồi rớt, mới bắt đầu chuỗi reconnect thất bại liên tục.
    const opened = MockWebSocket.instances[0];
    opened.triggerOpen();
    opened.triggerMessage({ type: "NEW_MESSAGE", data: {} });
    opened.triggerClose(1006);

    for (let i = 0; i < 11; i++) {
      vi.advanceTimersByTime(40000);
      const last = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      // Không triggerOpen — mô phỏng connect thất bại liên tiếp (giữ nguyên reconnectAttempts).
      last.triggerClose(1006);
    }
    vi.advanceTimersByTime(40000);

    expect(statusHandler).toHaveBeenCalledWith("closed");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("disconnectMessagingWS hủy timer đang chờ reconnect", () => {
    ws.connectMessagingWS();
    const first = MockWebSocket.instances[0];
    first.triggerOpen();
    first.triggerMessage({ type: "NEW_MESSAGE", data: {} });
    first.triggerClose(1006);

    ws.disconnectMessagingWS();
    vi.advanceTimersByTime(60000);
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("reconnect thành công đọc token MỚI từ authStore, không dùng token cũ", () => {
    ws.connectMessagingWS();
    const first = MockWebSocket.instances[0];
    first.triggerOpen();
    first.triggerMessage({ type: "NEW_MESSAGE", data: {} });
    first.triggerClose(1006);

    useAuthStore.setState({ accessToken: "token-fresh" });
    vi.advanceTimersByTime(1300);

    expect(MockWebSocket.instances[1].url).toContain("token=token-fresh");
  });
});
