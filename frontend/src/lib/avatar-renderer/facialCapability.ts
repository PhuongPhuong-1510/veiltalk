import type { VRM } from "@pixiv/three-vrm";
import type { GazeCapability } from "./gazeCapabilityAdapter";

export const STANDARD_FACIAL_CHANNELS = [
  "neutral", "aa", "ih", "ou", "ee", "oh",
  "blink", "blinkLeft", "blinkRight",
  "happy", "angry", "sad", "relaxed", "surprised",
  "lookUp", "lookDown", "lookLeft", "lookRight",
] as const;

export const ADVANCED_FACIAL_CHANNELS = [
  "mouthClose", "mouthWide", "mouthNarrow", "mouthUpperUp", "mouthLowerDown",
  "mouthSmileLeft", "mouthSmileRight", "mouthFrownLeft", "mouthFrownRight",
  "mouthPucker", "mouthFunnel", "mouthPress", "jawLeft", "jawRight", "jawForward",
  "browInnerUp", "browOuterUpLeft", "browOuterUpRight", "browDownLeft", "browDownRight",
  "cheekSquintLeft", "cheekSquintRight", "cheekPuff", "noseSneerLeft", "noseSneerRight",
  "eyeSquintLeft", "eyeSquintRight", "eyeWideLeft", "eyeWideRight",
] as const;

export type StandardFacialChannel = typeof STANDARD_FACIAL_CHANNELS[number];
export type AdvancedFacialChannel = typeof ADVANCED_FACIAL_CHANNELS[number];
export type FacialChannelStatus = "bound" | "zero-bind" | "raw-candidate" | "unsupported";

export interface FacialChannelCapability {
  status: FacialChannelStatus;
  expressionName: string | null;
  bindCount: number;
  rawMorphCandidates: readonly string[];
  /** Chỉ preset VRM có bind thật mới được dùng thẳng ở production. Raw candidate cần nghiệm thu profile riêng. */
  productionReady: boolean;
}

export interface FacialCapabilityManifest {
  version: 1;
  modelFingerprint: string;
  vrmVersion: string | null;
  standard: Readonly<Record<StandardFacialChannel, FacialChannelCapability>>;
  advanced: Readonly<Record<AdvancedFacialChannel, FacialChannelCapability>>;
  lookAt: Readonly<{
    supported: boolean;
    leftEyeBone: boolean;
    rightEyeBone: boolean;
  }>;
  gaze: Readonly<GazeCapability>;
  rawMorphTargets: readonly string[];
  warnings: readonly string[];
}

const normalizeName = (value: string) => value.toLocaleLowerCase().replace(/[\s_.-]/g, "");

const STANDARD_RAW_ALIASES: Partial<Record<StandardFacialChannel, readonly string[]>> = {
  aa: ["a", "あ"], ih: ["i", "い"], ou: ["u", "う"], ee: ["e", "え"], oh: ["o", "お"],
  blink: ["blink", "まばたき"], blinkLeft: ["blinkl", "blinkleft"], blinkRight: ["blinkr", "blinkright"],
  happy: ["happy", "joy", "smile", "fun", "笑い"], angry: ["angry", "怒り"], sad: ["sad", "sorrow", "悲しい"],
  relaxed: ["relaxed"], surprised: ["surprised", "驚き"],
};

const ADVANCED_RAW_ALIASES: Record<AdvancedFacialChannel, readonly string[]> = {
  mouthClose: ["mouthclose", "mthclose", "口閉じ", "口閉"],
  mouthWide: ["mouthwide", "mouthlarge", "mthlarge", "口横広げ"],
  mouthNarrow: ["mouthnarrow", "mouthsmall", "mthsmall", "口横狭め"],
  mouthUpperUp: ["mouthupperup", "mthup", "upperlipup", "口上"],
  mouthLowerDown: ["mouthlowerdown", "mthdown", "lowerlipdown", "口下"],
  mouthSmileLeft: ["mouthsmileleft", "mouthsmilel", "smileleft", "smilel"],
  mouthSmileRight: ["mouthsmileright", "mouthsmiler", "smileright", "smiler"],
  mouthFrownLeft: ["mouthfrownleft", "mouthfrownl", "frownleft", "frownl"],
  mouthFrownRight: ["mouthfrownright", "mouthfrownr", "frownright", "frownr"],
  mouthPucker: ["mouthpucker", "pucker", "chu"],
  mouthFunnel: ["mouthfunnel", "funnel"],
  mouthPress: ["mouthpress", "press", "mimp", "purse"],
  jawLeft: ["jawleft", "jawl"], jawRight: ["jawright", "jawr"], jawForward: ["jawforward"],
  browInnerUp: ["browinnerup", "browinner", "brwsurprised"],
  browOuterUpLeft: ["browouterupleft", "browouterupl", "brwsurprised"], browOuterUpRight: ["browouterupright", "browouterupr", "brwsurprised"],
  browDownLeft: ["browdownleft", "browdownl", "brwangry"], browDownRight: ["browdownright", "browdownr", "brwangry"],
  cheekSquintLeft: ["cheeksquintleft", "cheeksquintl"], cheekSquintRight: ["cheeksquintright", "cheeksquintr"],
  cheekPuff: ["cheekpuff", "puff"],
  noseSneerLeft: ["nosesneerleft", "nosesneerl"], noseSneerRight: ["nosesneerright", "nosesneerr"],
  eyeSquintLeft: ["eyesquintleft", "eyesquintl", "eyejoyl"], eyeSquintRight: ["eyesquintright", "eyesquintr", "eyejoyr"],
  eyeWideLeft: ["eyewideleft", "eyewidel", "eyespread"], eyeWideRight: ["eyewideright", "eyewider", "eyespread"],
};

function matchingRawMorphs(rawMorphTargets: readonly string[], aliases: readonly string[] | undefined): readonly string[] {
  if (!aliases?.length) return Object.freeze([]);
  const normalizedAliases = aliases.map(normalizeName);
  return Object.freeze(rawMorphTargets.filter((name) => {
    const normalized = normalizeName(name);
    return normalizedAliases.some((alias) => normalized === alias || normalized.endsWith(alias));
  }));
}

function expressionEntry(vrm: VRM | null, semantic: string, rawCandidates: readonly string[]): FacialChannelCapability {
  const map = vrm?.expressionManager?.expressionMap ?? {};
  const expressionName = Object.keys(map).find((name) => name.toLocaleLowerCase() === semantic.toLocaleLowerCase()) ?? null;
  const bindCount = expressionName ? map[expressionName].binds.length : 0;
  const status: FacialChannelStatus = bindCount > 0 ? "bound" : expressionName ? "zero-bind" : rawCandidates.length > 0 ? "raw-candidate" : "unsupported";
  return Object.freeze({ status, expressionName, bindCount, rawMorphCandidates: rawCandidates, productionReady: status === "bound" });
}

function rawCandidateEntry(rawCandidates: readonly string[]): FacialChannelCapability {
  return Object.freeze({
    status: rawCandidates.length > 0 ? "raw-candidate" : "unsupported",
    expressionName: null,
    bindCount: 0,
    rawMorphCandidates: rawCandidates,
    productionReady: false,
  });
}

function hasEyeBone(vrm: VRM | null, name: "leftEye" | "rightEye"): boolean {
  return Boolean(vrm?.humanoid.getNormalizedBoneNode(name));
}

/**
 * Tạo manifest chỉ từ metadata/runtime object của model, không suy diễn theo tên file.
 * Raw morph chỉ được ghi nhận là candidate để thử trong DEV Lab; không tự động bật production.
 */
export function buildFacialCapabilityManifest(
  vrm: VRM | null,
  morphTargets: ReadonlyMap<string, unknown>,
  modelFingerprint: string,
  gaze: GazeCapability = { kind: "unsupported", yawLeftLimit: 0, yawRightLimit: 0, pitchUpLimit: 0, pitchDownLimit: 0, handlesVerticalEyelid: false },
): FacialCapabilityManifest {
  const rawMorphTargets = Object.freeze([...morphTargets.keys()].sort((a, b) => a.localeCompare(b)));
  const standard = {} as Record<StandardFacialChannel, FacialChannelCapability>;
  for (const semantic of STANDARD_FACIAL_CHANNELS) {
    standard[semantic] = expressionEntry(vrm, semantic, matchingRawMorphs(rawMorphTargets, STANDARD_RAW_ALIASES[semantic]));
  }
  const advanced = {} as Record<AdvancedFacialChannel, FacialChannelCapability>;
  for (const semantic of ADVANCED_FACIAL_CHANNELS) {
    advanced[semantic] = rawCandidateEntry(matchingRawMorphs(rawMorphTargets, ADVANCED_RAW_ALIASES[semantic]));
  }

  const zeroBindNames = STANDARD_FACIAL_CHANNELS.filter((name) => standard[name].status === "zero-bind");
  const rawCandidateCount = [...Object.values(standard), ...Object.values(advanced)].filter((entry) => entry.status === "raw-candidate").length;
  const warnings: string[] = [];
  if (!vrm?.expressionManager) warnings.push("Model không có VRM ExpressionManager; chỉ có thể kiểm tra raw morph trong DEV Lab.");
  if (zeroBindNames.length > 0) warnings.push(`Expression có tên nhưng không có bind thật: ${zeroBindNames.join(", ")}.`);
  if (rawCandidateCount > 0) warnings.push(`${rawCandidateCount} semantic có raw morph candidate; chưa được dùng production trước khi nghiệm thu profile.`);

  return Object.freeze({
    version: 1,
    modelFingerprint,
    vrmVersion: vrm?.meta.metaVersion ?? null,
    standard: Object.freeze(standard),
    advanced: Object.freeze(advanced),
    lookAt: Object.freeze({ supported: Boolean(vrm?.lookAt), leftEyeBone: hasEyeBone(vrm, "leftEye"), rightEyeBone: hasEyeBone(vrm, "rightEye") }),
    gaze: Object.freeze({ ...gaze }),
    rawMorphTargets,
    warnings: Object.freeze(warnings),
  });
}

/** DEV preview helper: giữ clamp thống nhất và dễ unit-test mà không cần WebGL context. */
export function clampFacialPreviewWeight(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}
