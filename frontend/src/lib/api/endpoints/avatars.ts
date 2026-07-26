import { request } from "../client";
import type { AvatarModel, AvatarProfile } from "../types";

export function getModels() {
  return request<{ models: AvatarModel[] }>("/avatars/models");
}

export function getMyAvatar() {
  return request<AvatarProfile>("/avatars/me");
}

export function upsertMyAvatar(modelId: string, customizations?: Record<string, string>) {
  return request<AvatarProfile>("/avatars/me", {
    method: "PUT",
    body: { model_id: modelId, customizations },
  });
}

export function getAvatarOf(userId: string) {
  return request<AvatarProfile>(`/avatars/${userId}`);
}
