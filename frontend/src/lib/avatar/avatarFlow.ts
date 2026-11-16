export type AvatarFlowMode = "onboarding" | "edit";

export function avatarDraftKey(userId: string, modelId: string): string {
  return `veiltalk.avatar-customization.${userId}.${modelId}`;
}

export function avatarFlowPath(mode: AvatarFlowMode, step: "setup" | "customize" | "preview", modelId?: string): string {
  const base = mode === "edit" ? `/avatar/edit/${step}` : `/avatar/${step}`;
  return modelId ? `${base}?model=${encodeURIComponent(modelId)}` : base;
}
