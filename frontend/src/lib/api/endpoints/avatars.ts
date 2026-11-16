import { request } from "../client";
import type { AvatarModel, AvatarProfile, User } from "../types";

export function getModels() {
  return request<{ models: AvatarModel[] }>("/avatars/models");
}

export function getMyAvatar() {
  return request<AvatarProfile>("/avatars/me");
}

export function completeMyAvatar(fields: {
  requestId: string;
  expectedRevision?: string | null;
  modelId: string;
  customizations: Record<string, unknown>;
  portrait: Blob;
}) {
  const body = new FormData();
  body.set("request_id", fields.requestId);
  if (fields.expectedRevision) body.set("expected_revision", fields.expectedRevision);
  body.set("model_id", fields.modelId);
  body.set("customizations", JSON.stringify(fields.customizations));
  body.set("portrait", fields.portrait, "avatar-portrait.png");
  return request<{ profile: AvatarProfile; user: User }>("/avatars/me/complete", { method: "PUT", body });
}

export function getAvatarOf(userId: string) {
  return request<AvatarProfile>(`/avatars/${userId}`);
}
