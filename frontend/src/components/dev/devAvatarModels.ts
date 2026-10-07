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
  { id: "reference-avatar-2", label: "reference-avatar-2.vrm", url: "/models/avatars/reference-avatar-2.vrm" },
  { id: "reference-avatar-3", label: "reference-avatar-3.vrm", url: "/models/avatars/reference-avatar-3.vrm" },
  { id: "reference-avatar-4", label: "reference-avatar-4.vrm", url: "/models/avatars/reference-avatar-4.vrm" },
  { id: "reference-avatar-5", label: "reference-avatar-5.vrm", url: "/models/avatars/reference-avatar-5.vrm" },
  { id: "reference-avatar-6", label: "reference-avatar-6.vrm", url: "/models/avatars/reference-avatar-6.vrm" },
  { id: "reference-avatar-7", label: "reference-avatar-7.vrm", url: "/models/avatars/reference-avatar-7.vrm" },
  { id: "reference-avatar-8", label: "reference-avatar-8.vrm", url: "/models/avatars/reference-avatar-8.vrm" },
  { id: "reference-avatar-9", label: "reference-avatar-9.vrm", url: "/models/avatars/reference-avatar-9.vrm" },
  { id: "reference-avatar-11", label: "reference-avatar-11.vrm", url: "/models/avatars/reference-avatar-11.vrm" },
]);

export const DEFAULT_DEV_AVATAR_MODEL_ID = "reference-avatar-2";

export function getDevAvatarModel(modelId: string): DevAvatarModel | null {
  return DEV_AVATAR_MODELS.find((model) => model.id === modelId) ?? null;
}
