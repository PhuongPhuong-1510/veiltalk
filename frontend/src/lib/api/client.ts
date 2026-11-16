import { ApiError, type ErrorEnvelope } from "./types";

const BASE_URL = import.meta.env.VITE_API_BASE_URL
  ?? (import.meta.env.DEV ? "http://localhost:8080" : window.location.origin);

export function resolveMediaUrl(value?: string | null): string | null {
  if (!value) return null;
  if (/^(?:https?:|blob:|data:)/i.test(value)) return value;
  if (value.startsWith("/avatars/")) return new URL(value, BASE_URL).toString();
  return value;
}

const NO_REFRESH_PATHS = ["/auth/login", "/auth/register", "/auth/refresh"];

interface AuthHooks {
  getAccessToken: () => string | null;
  getRefreshToken: () => string | null;
  onTokensRefreshed: (accessToken: string) => void;
  onAuthFailure: () => void;
}

let authHooks: AuthHooks = {
  getAccessToken: () => null,
  getRefreshToken: () => null,
  onTokensRefreshed: () => {},
  onAuthFailure: () => {},
};

export function configureAuthHooks(hooks: AuthHooks): void {
  authHooks = hooks;
}

let refreshPromise: Promise<string> | null = null;

// export: messagingWS.ts cũng cần chủ động refresh trước khi reconnect,
// tái dùng đúng cơ chế (và refreshPromise dedupe) thay vì tự viết lại.
export async function refreshAccessToken(): Promise<string> {
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    const refreshToken = authHooks.getRefreshToken();
    if (!refreshToken) {
      authHooks.onAuthFailure();
      throw new ApiError(401, "UNAUTHORIZED", "Không có refresh token");
    }

    const response = await fetch(`${BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    if (!response.ok) {
      authHooks.onAuthFailure();
      throw new ApiError(response.status, "UNAUTHORIZED", "Refresh token không hợp lệ hoặc đã hết hạn");
    }

    const data: { access_token: string; expires_in: number } = await response.json();
    authHooks.onTokensRefreshed(data.access_token);
    return data.access_token;
  })().finally(() => {
    refreshPromise = null;
  });

  return refreshPromise;
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(`${BASE_URL}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

async function parseErrorBody(response: Response): Promise<ApiError> {
  const retryAfterValue = response.headers.get("Retry-After");
  const retryAfterSeconds = retryAfterValue === null ? undefined : Number.parseInt(retryAfterValue, 10);
  try {
    const body: ErrorEnvelope = await response.json();
    return new ApiError(
      response.status,
      body.error.code,
      body.error.message,
      body.error.details,
      Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
    );
  } catch {
    return new ApiError(
      response.status,
      "UNKNOWN",
      "Lỗi không xác định từ server",
      undefined,
      Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
    );
  }
}

async function doFetch(path: string, options: RequestOptions): Promise<Response> {
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers: Record<string, string> = isFormData ? {} : { "Content-Type": "application/json" };
  const accessToken = authHooks.getAccessToken();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  return fetch(buildUrl(path, options.query), {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined
      ? isFormData ? options.body as FormData : JSON.stringify(options.body)
      : undefined,
    signal: options.signal,
  });
}

export async function request<T>(path: string, options: RequestOptions = {}, _retried = false): Promise<T> {
  let response: Response;
  try {
    response = await doFetch(path, options);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError(0, "NETWORK_ERROR", "Không thể kết nối tới server");
  }

  if (response.status === 401 && !_retried && !NO_REFRESH_PATHS.includes(path)) {
    await refreshAccessToken();
    return request<T>(path, options, true);
  }

  if (!response.ok) {
    throw await parseErrorBody(response);
  }

  if (response.status === 204 || response.headers.get("Content-Length") === "0") {
    return undefined as T;
  }

  const body = await response.text();
  return (body ? JSON.parse(body) : undefined) as T;
}
