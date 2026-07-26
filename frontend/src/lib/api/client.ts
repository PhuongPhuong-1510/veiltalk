import { ApiError, type ErrorEnvelope } from "./types";

const BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";

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
  try {
    const body: ErrorEnvelope = await response.json();
    return new ApiError(response.status, body.error.code, body.error.message, body.error.details);
  } catch {
    return new ApiError(response.status, "UNKNOWN", "Lỗi không xác định từ server");
  }
}

async function doFetch(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const accessToken = authHooks.getAccessToken();
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  return fetch(buildUrl(path, options.query), {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

export async function request<T>(path: string, options: RequestOptions = {}, _retried = false): Promise<T> {
  let response: Response;
  try {
    response = await doFetch(path, options);
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Không thể kết nối tới server");
  }

  if (response.status === 401 && !_retried && !NO_REFRESH_PATHS.includes(path)) {
    await refreshAccessToken();
    return request<T>(path, options, true);
  }

  if (!response.ok) {
    throw await parseErrorBody(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
