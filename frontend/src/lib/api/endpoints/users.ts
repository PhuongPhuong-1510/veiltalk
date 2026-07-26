import { request } from "../client";
import type { User, UserSettings } from "../types";

export function getMe() {
  return request<User>("/users/me");
}

export function updateMe(fields: { display_name?: string; avatar_url?: string | null }) {
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
  return request<{ found: boolean; user?: { id: string; display_name: string } }>("/users/search", {
    method: "POST",
    body: { email },
  });
}
