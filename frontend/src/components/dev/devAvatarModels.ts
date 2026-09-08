export interface DevAvatarModel {
  id: string;
  label: string;
  url: string;
}

/**
 * Chỉ dùng trong DEV harness. Các VRM local là asset kiểm thử rig, không phải catalog production
 * và không được tự động đưa vào luồng chọn avatar của người dùng.
 */
export const DEV_AVATAR_MODELS: readonly DevAvatarModel[] = Object.freeze([
  { id: "reference-avatar", label: "reference-avatar.vrm", url: "/models/avatars/reference-avatar.vrm" },
  { id: "reference-avatar-1", label: "reference-avatar-1.vrm", url: "/models/avatars/reference-avatar-1.vrm" },
  { id: "reference-avatar-2", label: "reference-avatar-2.vrm", url: "/models/avatars/reference-avatar-2.vrm" },
  { id: "reference-avatar-3", label: "reference-avatar-3.vrm", url: "/models/avatars/reference-avatar-3.vrm" },
  { id: "reference-avatar-4", label: "reference-avatar-4.vrm", url: "/models/avatars/reference-avatar-4.vrm" },
]);

export const DEFAULT_DEV_AVATAR_MODEL_ID = "reference-avatar-2";

export function getDevAvatarModel(modelId: string): DevAvatarModel | null {
  return DEV_AVATAR_MODELS.find((model) => model.id === modelId) ?? null;
}
