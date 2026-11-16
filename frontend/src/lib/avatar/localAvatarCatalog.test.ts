import { describe, expect, it } from "vitest";
import { AVATARS_PER_PAGE, LOCAL_AVATAR_MODELS, getAvatarPage } from "./localAvatarCatalog";

describe("local avatar catalog", () => {
  it("contains every local reference avatar", () => {
    expect(LOCAL_AVATAR_MODELS).toHaveLength(10);
    expect(LOCAL_AVATAR_MODELS.map((model) => model.id)).toEqual([
      "reference-avatar-2", "reference-avatar-3", "reference-avatar-4", "reference-avatar-5",
      "reference-avatar-6", "reference-avatar-7", "reference-avatar-8", "reference-avatar-9",
      "reference-avatar-10", "reference-avatar-11",
    ]);
  });

  it("paginates six avatars at a time and clamps invalid pages", () => {
    expect(AVATARS_PER_PAGE).toBe(6);
    expect(getAvatarPage(1)).toMatchObject({ page: 1, pageCount: 2 });
    expect(getAvatarPage(1).models).toHaveLength(6);
    expect(getAvatarPage(2).models).toHaveLength(4);
    expect(getAvatarPage(99).page).toBe(2);
    expect(getAvatarPage(0).page).toBe(1);
  });

  it("uses lightweight VRMs for selection while retaining full-quality URLs", () => {
    expect(LOCAL_AVATAR_MODELS.every((model) => model.previewUrl.startsWith("/models/avatars-preview/"))).toBe(true);
    expect(LOCAL_AVATAR_MODELS.every((model) => model.url.startsWith("/models/avatars/"))).toBe(true);
  });
});
