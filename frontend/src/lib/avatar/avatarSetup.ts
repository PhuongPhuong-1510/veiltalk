import type { AvatarModel } from "../api/types";

export function getAvatarThumbnailSrc(model: AvatarModel, localFallback: string): string {
  try {
    return new URL(model.thumbnail_url).hostname.endsWith(".example.com")
      ? localFallback
      : model.thumbnail_url;
  } catch {
    return localFallback;
  }
}

export function getAvatarCustomizationPath(modelId: string): string {
  return `/avatar/customize?model=${encodeURIComponent(modelId)}`;
}
