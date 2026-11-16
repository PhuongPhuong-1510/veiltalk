/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LOCAL_AVATAR_MODELS } from "./localAvatarCatalog";
import {
  getAvatarMaterialManifest,
  getAvatarMaterialLabel,
  getAvatarMaterialSlot,
  getAvatarMaterialTargetId,
} from "./avatarMaterialManifest";

function readSourceMaterialNames(modelId: string): string[] {
  const file = fileURLToPath(new URL(`../../../public/models/avatars-preview/${modelId}.vrm`, import.meta.url));
  const buffer = readFileSync(file);
  let offset = 12;
  while (offset < buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.toString("ascii", offset + 4, offset + 8);
    if (chunkType === "JSON") {
      const document = JSON.parse(buffer.toString("utf8", offset + 8, offset + 8 + chunkLength).replace(/\0+$/, "")) as {
        materials?: Array<{ name?: string }>;
      };
      return (document.materials ?? []).map((material) => material.name ?? "");
    }
    offset += 8 + chunkLength;
  }
  throw new Error(`Không đọc được GLB JSON của ${modelId}`);
}

describe("avatar material manifests", () => {
  it("defines a non-empty, unambiguous manifest for every local avatar", () => {
    for (const model of LOCAL_AVATAR_MODELS) {
      const manifest = getAvatarMaterialManifest(model.id);
      expect(manifest.modelId).toBe(model.id);
      expect(manifest.slots.length).toBeGreaterThan(0);

      const customizableNames = manifest.slots.flatMap((slot) => slot.materialNames);
      const allNames = [...customizableNames, ...manifest.lockedMaterialNames];
      expect(allNames.length).toBe(new Set(allNames).size);
      expect(allNames).toHaveLength(manifest.sourceMaterialCount);
      expect(manifest.slots.every((slot) => slot.materialNames.length > 0)).toBe(true);
      expect(manifest.slots.every((slot) => slot.materialNames.every((name) => Boolean(slot.materialLabels[name])))).toBe(true);
    }
  });

  it("accounts for every material that actually exists in every preview VRM", () => {
    for (const model of LOCAL_AVATAR_MODELS) {
      const manifest = getAvatarMaterialManifest(model.id);
      const accounted = [
        ...manifest.slots.flatMap((slot) => slot.materialNames),
        ...manifest.lockedMaterialNames,
      ].sort();
      expect(accounted, model.id).toEqual(readSourceMaterialNames(model.id).sort());
    }
  });

  it("keeps iris separate from eye whites and highlights", () => {
    expect(getAvatarMaterialSlot("reference-avatar-2", "F00_000_00_EyeIris_00_EYE")).toBe("eyes");
    expect(getAvatarMaterialSlot("reference-avatar-2", "F00_000_00_EyeWhite_00_EYE")).toBeNull();
    expect(getAvatarMaterialSlot("reference-avatar-3", "N00_000_00_EyeHighlight_00_EYE (Instance)")).toBeNull();
    expect(getAvatarMaterialSlot("reference-avatar-9", "2.meHL")).toBeNull();
  });

  it("does not classify Alicia hair-wear as outfit", () => {
    expect(getAvatarMaterialSlot("reference-avatar-5", "Alicia_hair_wear")).toBe("hair");
    expect(getAvatarMaterialManifest("reference-avatar-5").slots.find((slot) => slot.key === "outfit")?.materialNames)
      .not.toContain("Alicia_hair_wear");
  });

  it("includes detached brows with hair and Avatar 09 lower-leg clothing with outfit", () => {
    expect(getAvatarMaterialSlot("reference-avatar-2", "F00_000_00_FaceBrow_00_FACE")).toBe("hair");
    expect(getAvatarMaterialSlot("reference-avatar-6", "N00_000_00_FaceBrow_00_FACE (Instance)")).toBe("hair");
    expect(getAvatarMaterialSlot("reference-avatar-9", "6.mayu")).toBe("hair");
    expect(getAvatarMaterialSlot("reference-avatar-9", "14.__")).toBe("outfit");
    expect(getAvatarMaterialSlot("reference-avatar-10", "8.meimao")).toBe("hair");
  });

  it("uses a stable target id independent of traversal order", () => {
    expect(getAvatarMaterialTargetId("hair", "FrontHair")).toBe("hair:FrontHair");
  });

  it("uses model-specific, user-facing labels instead of source material names", () => {
    expect(getAvatarMaterialLabel("reference-avatar-2", "F00_002_03_Tops_01_CLOTH")).toBe("Váy");
    expect(getAvatarMaterialLabel("reference-avatar-2", "F00_002_01_Shoes_01_CLOTH")).toBe("Giày");
    expect(getAvatarMaterialLabel("reference-avatar-4", "Fire1")).toBe("Hào quang ngoài");
    expect(getAvatarMaterialLabel("reference-avatar-10", "26.xianlian")).toBe("Dây chuyền");
  });

  it("exposes Avatar 04 fire as an independent aura slot", () => {
    expect(getAvatarMaterialSlot("reference-avatar-4", "Fire1")).toBe("aura");
    expect(getAvatarMaterialSlot("reference-avatar-4", "Fire2")).toBe("aura");
    expect(getAvatarMaterialManifest("reference-avatar-4").slots.find((slot) => slot.key === "aura")?.label)
      .toBe("Hào quang");
  });

  it("describes partial customization honestly", () => {
    expect(getAvatarMaterialSlot("reference-avatar-10", "2.__")).toBe("hair");
    expect(getAvatarMaterialSlot("reference-avatar-10", "20.mae__")).toBe("outfit");
    expect(getAvatarMaterialSlot("reference-avatar-10", "26.xianlian")).toBe("accessory");
    expect(getAvatarMaterialSlot("reference-avatar-10", "28.star")).toBeNull();
    expect(getAvatarMaterialManifest("reference-avatar-11").slots.find((slot) => slot.key === "outfit")?.label)
      .toBe("Trang phục");
  });
});
