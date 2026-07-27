import { describe, expect, it } from "vitest";
import type { AvatarModel } from "../api/types";
import { getAvatarCustomizationPath, getAvatarThumbnailSrc } from "./avatarSetup";

const model: AvatarModel = {
  id: "avatar_model_01",
  name: "Sakura",
  thumbnail_url: "https://cdn.veiltalk.example.com/models/thumb.png",
  model_url: "https://cdn.veiltalk.example.com/models/model.glb",
  supported_customizations: [],
  outfit_options: [],
};

describe("avatar setup", () => {
  it("dùng local fallback cho URL catalog placeholder", () => {
    expect(getAvatarThumbnailSrc(model, "/fallback.png")).toBe("/fallback.png");
  });

  it("giữ URL thumbnail thật", () => {
    expect(getAvatarThumbnailSrc({ ...model, thumbnail_url: "https://cdn.kokoro.app/a.png" }, "/fallback.png"))
      .toBe("https://cdn.kokoro.app/a.png");
  });

  it("encode model id khi chuyển bước", () => {
    expect(getAvatarCustomizationPath("model 01/美")).toBe("/avatar/customize?model=model%2001%2F%E7%BE%8E");
  });
});
