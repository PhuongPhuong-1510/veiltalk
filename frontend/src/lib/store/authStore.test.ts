import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Môi trường test chạy Node (không jsdom) — cấp sessionStorage tối thiểu để
// authStore (dùng Web Storage API) chạy được mà không cần thêm dependency.
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

const authApiMock = {
  login: vi.fn(),
  register: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
};
const usersApiMock = {
  getMe: vi.fn(),
};

vi.mock("../api", () => ({
  authApi: authApiMock,
  usersApi: usersApiMock,
}));

const user = {
  id: "u1",
  email: "a@b.com",
  display_name: "A",
  role: "user",
  created_at: "2026-01-01T00:00:00Z",
};
const tokens = { access_token: "access-1", refresh_token: "refresh-1", expires_in: 900 };

describe("authStore", () => {
  let useAuthStore: typeof import("./authStore").useAuthStore;

  beforeEach(async () => {
    sessionStorage.clear();
    vi.resetModules();
    Object.values(authApiMock).forEach((fn) => fn.mockReset());
    usersApiMock.getMe.mockReset();
    ({ useAuthStore } = await import("./authStore"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("login thành công cập nhật state và lưu refresh token vào sessionStorage", async () => {
    authApiMock.login.mockResolvedValueOnce({ user, tokens });

    await useAuthStore.getState().login("a@b.com", "pw");

    const state = useAuthStore.getState();
    expect(state.user).toEqual(user);
    expect(state.accessToken).toBe("access-1");
    expect(state.status).toBe("authenticated");
    expect(sessionStorage.getItem("veiltalk_refresh_token")).toBe("refresh-1");
  });

  it("login thất bại không đổi state và ném lỗi ra ngoài", async () => {
    authApiMock.login.mockRejectedValueOnce(new Error("bad creds"));

    await expect(useAuthStore.getState().login("a@b.com", "wrong")).rejects.toThrow("bad creds");

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.status).toBe("idle");
    expect(state.isLoading).toBe(false);
  });

  it("restoreSession không có refresh token -> unauthenticated ngay, không gọi API", async () => {
    await useAuthStore.getState().restoreSession();

    expect(useAuthStore.getState().status).toBe("unauthenticated");
    expect(authApiMock.refresh).not.toHaveBeenCalled();
  });

  it("restoreSession có refresh token hợp lệ -> authenticated với user mới", async () => {
    sessionStorage.setItem("veiltalk_refresh_token", "refresh-1");
    vi.resetModules();
    ({ useAuthStore } = await import("./authStore"));
    authApiMock.refresh.mockResolvedValueOnce({ access_token: "access-2", expires_in: 900 });
    usersApiMock.getMe.mockResolvedValueOnce(user);

    await useAuthStore.getState().restoreSession();

    const state = useAuthStore.getState();
    expect(state.status).toBe("authenticated");
    expect(state.accessToken).toBe("access-2");
    expect(state.user).toEqual(user);
  });

  it("restoreSession refresh token hết hạn -> unauthenticated, xóa sessionStorage", async () => {
    sessionStorage.setItem("veiltalk_refresh_token", "refresh-1");
    vi.resetModules();
    ({ useAuthStore } = await import("./authStore"));
    authApiMock.refresh.mockRejectedValueOnce(new Error("expired"));

    await useAuthStore.getState().restoreSession();

    const state = useAuthStore.getState();
    expect(state.status).toBe("unauthenticated");
    expect(state.user).toBeNull();
    expect(sessionStorage.getItem("veiltalk_refresh_token")).toBeNull();
  });

  it("logout xóa state và sessionStorage kể cả khi API logout lỗi mạng", async () => {
    authApiMock.login.mockResolvedValueOnce({ user, tokens });
    await useAuthStore.getState().login("a@b.com", "pw");
    authApiMock.logout.mockRejectedValueOnce(new Error("network"));

    await useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(state.status).toBe("unauthenticated");
    expect(sessionStorage.getItem("veiltalk_refresh_token")).toBeNull();
  });

  it("onAuthFailure từ client.ts (401 -> refresh cũng 401) clear toàn bộ state qua hook thật", async () => {
    vi.doUnmock("../api");
    vi.resetModules();
    ({ useAuthStore } = await import("./authStore"));
    const { request } = await import("../api/client");

    sessionStorage.setItem("veiltalk_refresh_token", "refresh-1");
    useAuthStore.setState({ user, accessToken: "access-1", status: "authenticated" });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "expired" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(request("/users/me")).rejects.toBeTruthy();

    const state = useAuthStore.getState();
    expect(state.status).toBe("unauthenticated");
    expect(state.user).toBeNull();
    expect(state.accessToken).toBeNull();
    expect(sessionStorage.getItem("veiltalk_refresh_token")).toBeNull();

    vi.unstubAllGlobals();
    vi.stubGlobal("sessionStorage", new MemoryStorage());
    vi.doMock("../api", () => ({ authApi: authApiMock, usersApi: usersApiMock }));
  });

  it("bootstrap store cắm auth hook kể cả khi API client được nạp trước", async () => {
    vi.doUnmock("../api");
    vi.resetModules();
    const { request } = await import("../api/client");
    ({ useAuthStore } = await import("./authStore"));
    useAuthStore.getState();
    useAuthStore.setState({ accessToken: "access-bootstrap" });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "u1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await request("/users/me");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: expect.objectContaining({ Authorization: "Bearer access-bootstrap" }),
    });

    vi.unstubAllGlobals();
    vi.stubGlobal("sessionStorage", new MemoryStorage());
    vi.doMock("../api", () => ({ authApi: authApiMock, usersApi: usersApiMock }));
  });
});
