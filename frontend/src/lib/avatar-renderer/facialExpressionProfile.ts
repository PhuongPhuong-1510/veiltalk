/**
 * Mapping raw morph đã được chủ dự án kiểm tra bằng F0 Lab cho họ model VRoid. Nhận dạng theo suffix
 * morph chuẩn, không theo tên file; profile explicit truyền vào loader luôn có quyền ghi đè.
 */
const VERIFIED_VROID_SUFFIXES: Readonly<Record<string, readonly string[]>> = {
  browDown: ["Fcl_BRW_Angry"],
  browUp: ["Fcl_BRW_Surprised"],
  eyeWide: ["Fcl_EYE_Spread"],
  mouthClose: ["Fcl_MTH_Close"],
  mouthUpperUp: ["Fcl_MTH_Up"],
  mouthLowerDown: ["Fcl_MTH_Down"],
  mouthNarrow: ["Fcl_MTH_Small"],
  mouthWide: ["Fcl_MTH_Large"],
  mouthSmileClosed: ["Fcl_MTH_Fun"],
  mouthSmileOpen: ["Fcl_MTH_Joy"],
  mouthFrown: ["Fcl_MTH_Sorrow"],
};

/**
 * Một số exporter VRM 0 bỏ `extras.targetNames`, khiến Three.js chỉ còn key số. Các profile dưới
 * đây là allowlist theo đúng fingerprint asset đã được nghiệm thu bằng F0; tuyệt đối không suy đoán
 * semantic chỉ từ số lượng/thứ tự morph của một model lạ.
 */
const VERIFIED_MODEL_TARGETS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "/models/avatars/reference-avatar.vrm#vrm:0": {
    browDown: "6",
    browUp: "10",
    eyeWide: "22",
    mouthClose: "25",
    mouthUpperUp: "26",
    mouthLowerDown: "27",
    mouthNarrow: "29",
    mouthWide: "30",
    mouthSmileClosed: "32",
    mouthSmileOpen: "33",
    mouthFrown: "34",
  },
  "/models/avatars/reference-avatar-2.vrm#vrm:0": {
    browDown: "6",
    browUp: "10",
    eyeWide: "22",
    mouthUpperUp: "26",
    mouthLowerDown: "27",
    // This export has no safe standalone Close/Small/Large. Raw 25 belongs to
    // the custom Extra expression and moves eye vertices; 29/30 are Neutral/Fun.
    mouthSmileClosed: "30",
    mouthSmileOpen: "31",
    mouthFrown: "32",
  },
};

const normalized = (value: string) => value.toLocaleLowerCase().replace(/[\s_.-]/g, "");

export function buildVerifiedFacialExpressionMap(
  morphNames: Iterable<string>,
  modelFingerprint?: string,
): Record<string, string> {
  const names = [...morphNames];
  const output: Record<string, string> = {};
  for (const [semantic, suffixes] of Object.entries(VERIFIED_VROID_SUFFIXES)) {
    const target = names.find((name) => suffixes.some((suffix) => normalized(name).endsWith(normalized(suffix))));
    if (target) output[semantic] = target;
  }
  const verifiedTargets = modelFingerprint ? VERIFIED_MODEL_TARGETS[modelFingerprint] : undefined;
  if (verifiedTargets) for (const [semantic, target] of Object.entries(verifiedTargets)) {
    if (names.includes(target)) output[semantic] = target;
  }
  return output;
}

/** Một raw morph không được nhận hai semantic vì thứ tự apply khi đó sẽ quyết định pose ngoài ý muốn. */
export function assertUniqueFacialExpressionTargets(expressionMap: Readonly<Record<string, string>>): void {
  const owners = new Map<string, string>();
  for (const [semantic, target] of Object.entries(expressionMap)) {
    const owner = owners.get(target);
    if (owner) throw new Error(`Raw facial target ${target} bị gán trùng cho ${owner} và ${semantic}.`);
    owners.set(target, semantic);
  }
}
