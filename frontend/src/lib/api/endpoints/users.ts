import { request } from "../client";
import type { User, UserSettings } from "../types";

export function getMe() {
  return request<User>("/users/me");
}

export function updateMe(fields: { display_name?: string }) {
  return request<User>("/users/me", { method: "PUT", body: fields });
}

export function deleteMe(password: string) {
  return request<void>("/users/me", { method: "DELETE", body: { password } });
}

export function getSettings() {
  return request<UserSettings>("/users/me/settings");
}

export function updateSettings(fields: Partial<UserSettings>) {
  return request<UserSettings>("/users/me/settings", { method: "PUT", body: fields });
}

export function searchUsers(email: string) {
  return request<{ found: boolean; user?: { id: string; display_name: string; avatar_url?: string | null } }>("/users/search", {
    method: "POST",
    body: { email },
  });
}

export interface UsernameSearchResult {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string | null;
}

export function searchUsernames(query: string, signal?: AbortSignal) {
  return request<{
    data: UsernameSearchResult[];
    meta: { limit: number; truncated: boolean };
  }>("/users/search/usernames", {
    method: "POST",
    body: { query, limit: 10 },
    signal,
  });
}
