import { describe, expect, it } from "vitest";
import { DEFAULT_DEV_AVATAR_MODEL_ID, DEV_AVATAR_MODELS, getDevAvatarModel } from "./devAvatarModels";

describe("DEV avatar model catalog", () => {
  it("lists all five local VRM fixtures with unique ids and URLs", () => {
    expect(DEV_AVATAR_MODELS).toHaveLength(5);
    expect(new Set(DEV_AVATAR_MODELS.map((model) => model.id)).size).toBe(5);
    expect(new Set(DEV_AVATAR_MODELS.map((model) => model.url)).size).toBe(5);
    expect(DEV_AVATAR_MODELS.every((model) => model.url.startsWith("/models/avatars/") && model.url.endsWith(".vrm"))).toBe(true);
  });

  it("keeps reference-avatar-2 as the existing default", () => {
    expect(getDevAvatarModel(DEFAULT_DEV_AVATAR_MODEL_ID)).toMatchObject({
      label: "reference-avatar-2.vrm",
      url: "/models/avatars/reference-avatar-2.vrm",
    });
  });

  it("rejects an unknown model id", () => {
    expect(getDevAvatarModel("missing-model")).toBeNull();
  });
});
