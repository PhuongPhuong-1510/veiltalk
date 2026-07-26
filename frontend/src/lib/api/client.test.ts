import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureAuthHooks, request } from "./client";
import { ApiError } from "./types";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api client", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let accessToken: string | null;
  let refreshToken: string | null;
  let onAuthFailure: (() => void) & ReturnType<typeof vi.fn>;
  let onTokensRefreshed: ((accessToken: string) => void) & ReturnType<typeof vi.fn>;

  beforeEach(() => {
    accessToken = "initial-access-token";
    refreshToken = "valid-refresh-token";
    onAuthFailure = vi.fn(() => {});
    onTokensRefreshed = vi.fn((newToken: string): void => {
      accessToken = newToken;
    });

    configureAuthHooks({
      getAccessToken: () => accessToken,
      getRefreshToken: () => refreshToken,
      onTokensRefreshed,
      onAuthFailure,
    });

    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("gắn Authorization header với access token hiện tại", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: "u1" }));

    await request("/users/me");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer initial-access-token");
  });

  it("401 -> refresh -> retry đúng 1 lần -> thành công", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: "UNAUTHORIZED", message: "expired" } }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "new-access-token", expires_in: 900 }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "u1" }));

    const result = await request<{ id: string }>("/users/me");

    expect(result).toEqual({ id: "u1" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onTokensRefreshed).toHaveBeenCalledWith("new-access-token");

    const retryCall = fetchMock.mock.calls[2];
    expect(retryCall[1].headers.Authorization).toBe("Bearer new-access-token");
  });

  it("401 -> refresh cũng 401 -> gọi onAuthFailure, không lặp vô hạn", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: { code: "UNAUTHORIZED", message: "expired" } }))
      .mockResolvedValueOnce(
        jsonResponse(401, { error: { code: "UNAUTHORIZED", message: "refresh token invalid" } }),
      );

    await expect(request("/users/me")).rejects.toBeInstanceOf(ApiError);

    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("nhiều request 401 cùng lúc chỉ gọi /auth/refresh đúng 1 lần", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/auth/refresh")) {
        return Promise.resolve(jsonResponse(200, { access_token: "new-access-token", expires_in: 900 }));
      }
      const alreadyRefreshed = accessToken === "new-access-token";
      return Promise.resolve(
        alreadyRefreshed ? jsonResponse(200, { ok: true }) : jsonResponse(401, { error: { code: "UNAUTHORIZED", message: "expired" } }),
      );
    });

    const results = await Promise.all([
      request("/users/me"),
      request("/avatars/me"),
      request("/videos"),
    ]);

    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);

    const refreshCalls = fetchMock.mock.calls.filter(([url]) => String(url).includes("/auth/refresh"));
    expect(refreshCalls).toHaveLength(1);
  });

  it("request tới /auth/refresh mà 401 thì không tự gọi refresh lại", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { code: "UNAUTHORIZED", message: "refresh token invalid" } }),
    );

    await expect(request("/auth/refresh", { method: "POST", body: {} })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("lỗi mạng map thành ApiError NETWORK_ERROR", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    let error: ApiError | undefined;
    try {
      await request("/users/me");
    } catch (e) {
      error = e as ApiError;
    }

    expect(error).toBeInstanceOf(ApiError);
    expect(error?.code).toBe("NETWORK_ERROR");
    expect(error?.status).toBe(0);
  });

  it("error envelope 403 map đúng code/message/details", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(403, {
        error: { code: "FORBIDDEN", message: "Không có quyền", details: { reason: "not-member" } },
      }),
    );

    let error: ApiError | undefined;
    try {
      await request("/conversations/abc");
    } catch (e) {
      error = e as ApiError;
    }

    expect(error).toBeInstanceOf(ApiError);
    expect(error?.status).toBe(403);
    expect(error?.code).toBe("FORBIDDEN");
    expect(error?.details).toEqual({ reason: "not-member" });
  });

  it("token đã hết hạn ngay khi khởi động app (không có refresh token) -> đá về login êm, không throw ngoài tầm kiểm soát", async () => {
    refreshToken = null;
    fetchMock.mockResolvedValueOnce(
      jsonResponse(401, { error: { code: "UNAUTHORIZED", message: "expired" } }),
    );

    await expect(request("/users/me")).rejects.toBeInstanceOf(ApiError);

    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("204 No Content trả về undefined thay vì lỗi parse JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    const result = await request("/videos/abc");

    expect(result).toBeUndefined();
  });
});
