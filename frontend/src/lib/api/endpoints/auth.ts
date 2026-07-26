import { request } from "../client";
import type { Tokens, User } from "../types";

export function register(email: string, password: string, displayName: string) {
  return request<{ user: User; tokens: Tokens }>("/auth/register", {
    method: "POST",
    body: { email, password, display_name: displayName },
  });
}

export function login(email: string, password: string) {
  return request<{ user: User; tokens: Tokens }>("/auth/login", {
    method: "POST",
    body: { email, password },
  });
}

export function refresh(refreshToken: string) {
  return request<{ access_token: string; expires_in: number }>("/auth/refresh", {
    method: "POST",
    body: { refresh_token: refreshToken },
  });
}

export function logout(refreshToken: string) {
  return request<void>("/auth/logout", {
    method: "POST",
    body: { refresh_token: refreshToken },
  });
}
