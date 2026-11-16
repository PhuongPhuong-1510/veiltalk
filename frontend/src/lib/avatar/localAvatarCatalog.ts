export interface LocalAvatarModel {
  id: string;
  name: string;
  url: string;
  previewUrl: string;
}

// Files in public/ cannot be enumerated by the browser at runtime. Keep this
// small manifest in sync when a VRM is added to public/models/avatars.
export const LOCAL_AVATAR_MODELS: readonly LocalAvatarModel[] = Object.freeze([
  ...Array.from({ length: 10 }, (_, index) => {
    const number = index + 2;
    const fileName = `reference-avatar-${number}.vrm`;
    return {
      id: `reference-avatar-${number}`,
      name: `Avatar ${String(number).padStart(2, "0")}`,
      url: `/models/avatars/${fileName}`,
      previewUrl: `/models/avatars-preview/${fileName}`,
    };
  }),
]);

export const AVATARS_PER_PAGE = 6;

export function getAvatarPage(page: number) {
  const pageCount = Math.max(1, Math.ceil(LOCAL_AVATAR_MODELS.length / AVATARS_PER_PAGE));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const start = (safePage - 1) * AVATARS_PER_PAGE;
  return {
    page: safePage,
    pageCount,
    models: LOCAL_AVATAR_MODELS.slice(start, start + AVATARS_PER_PAGE),
  };
}
