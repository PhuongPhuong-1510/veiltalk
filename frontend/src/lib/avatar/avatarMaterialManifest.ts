export type AvatarColorSlot = "hair" | "outfit" | "eyes" | "accessory" | "aura";

export type AvatarSlotColors = Record<AvatarColorSlot, string | null>;

export interface AvatarMaterialSlotDefinition {
  key: AvatarColorSlot;
  label: string;
  fallback: string;
  materialNames: readonly string[];
  materialLabels: Readonly<Record<string, string>>;
}

export interface AvatarMaterialManifest {
  modelId: string;
  sourceMaterialCount: number;
  slots: readonly AvatarMaterialSlotDefinition[];
  lockedMaterialNames: readonly string[];
}

export const EMPTY_AVATAR_SLOT_COLORS: AvatarSlotColors = {
  hair: null,
  outfit: null,
  eyes: null,
  accessory: null,
  aura: null,
};

const SLOT_DEFAULTS: Record<AvatarColorSlot, Pick<AvatarMaterialSlotDefinition, "label" | "fallback">> = {
  hair: { label: "Tóc", fallback: "#8c5fc7" },
  outfit: { label: "Trang phục", fallback: "#d958b8" },
  eyes: { label: "Mắt", fallback: "#55bfe5" },
  accessory: { label: "Phụ kiện", fallback: "#f0b84b" },
  aura: { label: "Hào quang", fallback: "#f6c945" },
};

function slot(
  key: AvatarColorSlot,
  materials: readonly (readonly [name: string, label: string])[],
  label = SLOT_DEFAULTS[key].label,
): AvatarMaterialSlotDefinition {
  return {
    key,
    label,
    fallback: SLOT_DEFAULTS[key].fallback,
    materialNames: materials.map(([name]) => name),
    materialLabels: Object.fromEntries(materials.map(([name, materialLabel]) => [name, materialLabel])),
  };
}

const MANIFESTS: Record<string, AvatarMaterialManifest> = {
  "reference-avatar-2": {
    modelId: "reference-avatar-2",
    sourceMaterialCount: 15,
    slots: [
      slot("hair", [["F00_000_HairBack_00_HAIR", "Tóc phía sau"], ["F00_000_Hair_00_HAIR_01", "Tóc mái"], ["F00_000_Hair_00_HAIR_02", "Lọn tóc phía trước"], ["F00_000_00_FaceBrow_00_FACE", "Lông mày"]]),
      slot("outfit", [["F00_002_03_Tops_01_CLOTH", "Váy"], ["F00_002_01_Shoes_01_CLOTH", "Giày"]]),
      slot("eyes", [["F00_000_00_EyeIris_00_EYE", "Tròng mắt"]]),
    ],
    lockedMaterialNames: ["F00_000_00_FaceMouth_00_FACE", "F00_000_00_EyeWhite_00_EYE", "F00_000_00_FaceEyeline_00_FACE", "F00_000_00_FaceEyelash_00_FACE", "F00_000_00_EyeHighlight_00_EYE", "F00_000_00_Face_00_SKIN", "F00_000_00_EyeExtra_01_EYE", "F00_000_00_Body_00_SKIN"],
  },
  "reference-avatar-3": {
    modelId: "reference-avatar-3",
    sourceMaterialCount: 15,
    slots: [
      slot("hair", [["N00_000_00_HairBack_00_HAIR (Instance)", "Tóc phía sau"], ["N00_000_Hair_00_HAIR (Instance)", "Tóc mái"], ["N00_000_00_FaceBrow_00_FACE (Instance)", "Lông mày"]]),
      slot("outfit", [["N00_010_01_Onepiece_00_CLOTH (Instance)", "Váy liền"], ["N00_007_01_Tops_01_CLOTH (Instance)", "Thân áo"], ["N00_008_01_Shoes_01_CLOTH (Instance)", "Tất và giày"], ["N00_007_03_Tops_01_CLOTH (Instance)", "Chi tiết áo"]]),
      slot("eyes", [["N00_000_00_EyeIris_00_EYE (Instance)", "Tròng mắt"]]),
    ],
    lockedMaterialNames: ["N00_000_00_FaceMouth_00_FACE (Instance)", "N00_000_00_EyeHighlight_00_EYE (Instance)", "N00_000_00_Face_00_SKIN (Instance)", "N00_000_00_EyeWhite_00_EYE (Instance)", "N00_000_00_FaceEyelash_00_FACE (Instance)", "N00_000_00_FaceEyeline_00_FACE (Instance)", "N00_000_00_Body_00_SKIN (Instance)"],
  },
  "reference-avatar-4": {
    modelId: "reference-avatar-4",
    sourceMaterialCount: 17,
    slots: [
      slot("hair", [["FrontHair", "Tóc phía trước"], ["BackHair", "Tóc phía sau"]]),
      slot("outfit", [["Skirt", "Chân váy"], ["Dress", "Thân váy"], ["Heel", "Giày cao gót"]]),
      slot("eyes", [["Eyes", "Tròng mắt"], ["Eyes3", "Ánh mắt"]]),
      slot("accessory", [["Accs", "Trang sức"], ["Crown", "Vương miện"]]),
      slot("aura", [["Fire1", "Hào quang ngoài"], ["Fire2", "Hào quang trong"]]),
    ],
    lockedMaterialNames: ["Skin", "Face", "Teeth", "Mouth", "Eyelash", "EyeWhite"],
  },
  "reference-avatar-5": {
    modelId: "reference-avatar-5",
    sourceMaterialCount: 12,
    slots: [
      slot("hair", [["Alicia_hair", "Tóc chính"], ["Alicia_hair_trans_zwrite", "Lớp tóc trong suốt"], ["Alicia_hair_wear", "Phụ kiện tóc"], ["Alicia_hair_trans", "Lọn tóc mảnh"]]),
      slot("outfit", [["Alicia_body_wear", "Trang phục ôm thân"], ["Alicia_wear", "Trang phục ngoài"]]),
      slot("eyes", [["Alicia_eye", "Tròng mắt"]]),
    ],
    lockedMaterialNames: ["Alicia_body", "Alicia_face", "Alicia_eye_white", "Alicia_face_mastuge", "Alicia_other_zwrite"],
  },
  "reference-avatar-6": {
    modelId: "reference-avatar-6",
    sourceMaterialCount: 18,
    slots: [
      slot("hair", [["N00_000_00_HairBack_00_HAIR (Instance)", "Tóc phía sau"], ["N00_000_Hair_00_HAIR (Instance)", "Tóc mái"], ["N00_000_00_FaceBrow_00_FACE (Instance)", "Lông mày"]]),
      slot("outfit", [["N00_001_01_Bottoms_01_CLOTH (Instance)", "Quần hoặc váy dưới"], ["N00_008_01_Shoes_01_CLOTH (Instance)", "Tất và giày"], ["N00_007_03_Tops_01_CLOTH_01 (Instance)", "Áo ngoài"], ["N00_007_01_Tops_01_CLOTH_01 (Instance)", "Thân áo"], ["N00_007_01_Tops_01_CLOTH_02 (Instance)", "Chi tiết thân áo"], ["N00_007_03_Tops_01_CLOTH_02 (Instance)", "Viền áo"], ["N00_007_03_Tops_01_CLOTH_03 (Instance)", "Họa tiết áo"]]),
      slot("eyes", [["N00_000_00_EyeIris_00_EYE (Instance)", "Tròng mắt"]]),
    ],
    lockedMaterialNames: ["N00_000_00_FaceMouth_00_FACE (Instance)", "N00_000_00_EyeHighlight_00_EYE (Instance)", "N00_000_00_Face_00_SKIN (Instance)", "N00_000_00_EyeWhite_00_EYE (Instance)", "N00_000_00_FaceEyelash_00_FACE (Instance)", "N00_000_00_FaceEyeline_00_FACE (Instance)", "N00_000_00_Body_00_SKIN (Instance)"],
  },
  "reference-avatar-7": {
    modelId: "reference-avatar-7",
    sourceMaterialCount: 15,
    slots: [
      slot("hair", [["12.HairBack", "Tóc phía sau"], ["13.Hair_Front", "Tóc phía trước"], ["14.Hair_Spec", "Ánh tóc"], ["7.Face_Brow", "Lông mày"]]),
      slot("outfit", [["1.Cloth1_Uber", "Lớp trang phục chính"], ["2.Cloth1_Double_Uber", "Mặt trong trang phục"], ["3.Cloth1_UberTrans", "Lớp vải trong suốt"], ["4.Cloth2_Uber", "Trang phục phụ"], ["5.Cloth2_Silkstock_Uber", "Tất lụa"]]),
      slot("eyes", [["8.Eye", "Tròng mắt"]]),
    ],
    lockedMaterialNames: ["0.Cloth2_Skin", "10.EyeHi", "6.Face", "9.Face_EyeWhite", "11.EyeShadow"],
  },
  "reference-avatar-8": {
    modelId: "reference-avatar-8",
    sourceMaterialCount: 18,
    slots: [
      slot("hair", [["16.Hair", "Tóc chính"], ["17.Hair", "Lớp tóc phụ"]]),
      slot("outfit", [["11.Cloth1A", "Trang phục lớp 1"], ["12.Cloth1B", "Chi tiết lớp 1"], ["13.Cloth2A", "Trang phục lớp 2"], ["14.Cloth2B", "Chi tiết lớp 2"], ["15.Socks", "Tất"]]),
      slot("eyes", [["8.Eyes", "Tròng mắt"]]),
    ],
    lockedMaterialNames: ["10.BodySkin", "0.Face", "1.Mouth", "2.Teeth", "3.Teeth", "4.Tongue", "5.EyeWhite", "6.EyeLid", "7.Lashes", "9.Eyes+"],
  },
  "reference-avatar-9": {
    modelId: "reference-avatar-9",
    sourceMaterialCount: 15,
    slots: [
      slot("hair", [["8.kisaki_", "Ngọn tóc"], ["9.mae_", "Tóc mái"], ["6.mayu", "Lông mày"]]),
      slot("outfit", [["10.fukujou", "Áo trên"], ["11.fukuka", "Trang phục dưới"], ["12.fuku_", "Chi tiết trang phục"], ["14.__", "Tất và giày"]]),
      slot("eyes", [["1.me", "Tròng mắt"]]),
    ],
    lockedMaterialNames: ["2.meHL", "13.hada", "0.men", "3.mejiro", "4.mekage", "5.matsuge", "7.kouzetsu_hana__kuchi_"],
  },
  "reference-avatar-10": {
    modelId: "reference-avatar-10",
    sourceMaterialCount: 31,
    slots: [
      // The source names are misleading: geometry bounds place 2.__/3.__2 on the head,
      // while mae__/zenkawa_ are clothing pieces below the neck.
      slot("hair", [["2.__", "Tóc chính"], ["3.__2", "Lớp tóc phụ"], ["8.meimao", "Lông mày"]]),
      slot("outfit", [["16.__", "Trang phục chính"], ["17._ko", "Chi tiết trang phục"], ["19.minoruko", "Lớp áo trong"], ["20.mae__", "Vạt áo trước"], ["21.zenkawa_", "Viền da"], ["25.jouhanshin", "Áo thân trên"]]),
      slot("eyes", [["24.eye", "Tròng mắt"]]),
      slot("accessory", [["18.__kinzoku", "Phụ kiện kim loại"], ["26.xianlian", "Dây chuyền"]]),
    ],
    lockedMaterialNames: ["12.nose", "13.ear", "22.K_momo", "23.meshiro2", "0.meshiro3", "1.shintai", "4.teeth", "5.she", "6.chun", "7.kou", "9.jie", "10.bai", "11.zhi", "14.face", "15.hou", "27.eye+", "28.star", "29.heart", "30.Cheek"],
  },
  "reference-avatar-11": {
    modelId: "reference-avatar-11",
    sourceMaterialCount: 7,
    slots: [
      slot("hair", [["N00_000_Hair_00_HAIR_01 (Instance)", "Tóc"]]),
      // Despite its source name, this primitive spans the complete outfit, not only shoes.
      slot("outfit", [["N00_005_01_Shoes_01_CLOTH (Instance)", "Toàn bộ trang phục"]]),
      slot("eyes", [["N00_000_00_EyeIris_00_EYE (Instance)", "Tròng mắt"]]),
    ],
    lockedMaterialNames: ["N00_000_00_FaceMouth_00_FACE (Instance)", "N00_000_00_EyeHighlight_00_EYE (Instance)", "N00_000_00_Face_00_SKIN (Instance)", "N00_000_00_Body_00_SKIN (Instance)"],
  },
};

export function getAvatarMaterialManifest(modelId: string): AvatarMaterialManifest {
  const manifest = MANIFESTS[modelId];
  if (!manifest) throw new Error(`Chưa có material manifest cho avatar ${modelId}`);
  return manifest;
}

export function getAvatarMaterialSlot(modelId: string, materialName: string): AvatarColorSlot | null {
  const definition = getAvatarMaterialManifest(modelId).slots.find((item) => item.materialNames.includes(materialName));
  return definition?.key ?? null;
}

export function getAvatarMaterialLabel(modelId: string, materialName: string): string | null {
  const definition = getAvatarMaterialManifest(modelId).slots.find((item) => item.materialNames.includes(materialName));
  return definition?.materialLabels[materialName] ?? null;
}

export function getAvatarMaterialTargetId(slotKey: AvatarColorSlot, materialName: string): string {
  return `${slotKey}:${materialName}`;
}

export function createAvatarSlotRecord<T>(factory: (slotKey: AvatarColorSlot) => T): Record<AvatarColorSlot, T> {
  return {
    hair: factory("hair"),
    outfit: factory("outfit"),
    eyes: factory("eyes"),
    accessory: factory("accessory"),
    aura: factory("aura"),
  };
}
