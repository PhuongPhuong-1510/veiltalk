export interface FacialExpressionMixerConfig {
  priorityExponent: number;
  epsilon: number;
  smile: {
    openOnset: number;
    openFull: number;
    closedGain: number;
    openGain: number;
    frownGain: number;
    vowelSuppression: number;
    lipShapeSuppression: number;
  };
  budgets: {
    lipShape: number;
    mouthBase: number;
    lipVerticalPerSide: number;
    mouthCornerPerSide: number;
    cheekNosePerSide: number;
    emotion: number;
  };
}

export interface FacialBudgetDiagnostic {
  before: number;
  limit: number;
  scale: number;
}

export interface FacialExpressionMixerSnapshot {
  conflicts: readonly string[];
  budgets: Readonly<Record<string, FacialBudgetDiagnostic>>;
}

export interface FacialExpressionMixerResult {
  expressions: Record<string, number>;
  snapshot: FacialExpressionMixerSnapshot;
}

const VOWELS = ["aa", "ih", "ou", "ee", "oh"] as const;
const LIP_SHAPES = ["mouthPucker", "mouthFunnel", "mouthNarrow", "mouthWide"] as const;
const EMOTIONS = ["happy", "angry", "sad", "surprised"] as const;

export function safeExpressionWeight(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function validateFacialExpressionMixerConfig(config: FacialExpressionMixerConfig): void {
  if (!Number.isFinite(config.priorityExponent) || config.priorityExponent <= 0) {
    throw new RangeError("Facial mixer priorityExponent phải hữu hạn và > 0.");
  }
  if (!Number.isFinite(config.epsilon) || config.epsilon <= 0 || config.epsilon > 1) {
    throw new RangeError("Facial mixer epsilon phải hữu hạn và nằm trong (0, 1].");
  }
  if (![config.smile.openOnset, config.smile.openFull, config.smile.closedGain, config.smile.openGain, config.smile.frownGain, config.smile.vowelSuppression, config.smile.lipShapeSuppression]
    .every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
    throw new RangeError("Facial mixer smile config must stay within [0, 1].");
  }
  if (config.smile.openOnset >= config.smile.openFull) {
    throw new RangeError("Facial mixer smile openOnset must be smaller than openFull.");
  }
  for (const [name, value] of Object.entries(config.budgets)) {
    if (!Number.isFinite(value) || value <= 0) throw new RangeError(`Facial mixer budget ${name} phải hữu hạn và > 0.`);
  }
}

function sum(values: Readonly<Record<string, number>>, names: readonly string[]): number {
  return names.reduce((total, name) => total + (values[name] ?? 0), 0);
}

function project(
  values: Record<string, number>,
  names: readonly string[],
  limit: number,
  label: string,
  epsilon: number,
  diagnostics: Record<string, FacialBudgetDiagnostic>,
): void {
  const safeLimit = Math.max(0, limit);
  const before = sum(values, names);
  const scale = before > safeLimit ? safeLimit / Math.max(before, epsilon) : 1;
  if (scale < 1) for (const name of names) values[name] = (values[name] ?? 0) * scale;
  diagnostics[label] = { before, limit: safeLimit, scale };
}

function resolvePair(values: Record<string, number>, aName: string, bName: string, conflicts: string[]): void {
  const a = values[aName] ?? 0;
  const b = values[bName] ?? 0;
  if (a > 0 && b > 0) conflicts.push(`${aName}↔${bName}`);
  values[aName] = Math.max(0, a - b);
  values[bName] = Math.max(0, b - a);
}

function average(a: number, b: number): number { return (a + b) / 2; }
function smoothActivation(value: number, onset: number, full: number): number {
  const t = safeExpressionWeight((value - onset) / Math.max(1e-6, full - onset));
  return t * t * (3 - 2 * t);
}

/**
 * F4: phép chiếu stateless, model-independent. Hàm này được dùng ở cả trước và sau dynamics,
 * vì vậy mọi primitive phải idempotent; tuyệt đối không nhân lặp `x *= (1-priority)`.
 */
export function mixFacialExpressions(
  input: Readonly<Record<string, number>>,
  config: FacialExpressionMixerConfig,
): FacialExpressionMixerResult {
  const values = Object.fromEntries(Object.entries(input).map(([name, value]) => [name, safeExpressionWeight(value)]));
  const conflicts: string[] = [];
  const budgets: Record<string, FacialBudgetDiagnostic> = {};

  resolvePair(values, "jawLeft", "jawRight", conflicts);
  resolvePair(values, "mouthLeft", "mouthRight", conflicts);
  resolvePair(values, "mouthWide", "mouthNarrow", conflicts);
  for (const side of ["Left", "Right"] as const) {
    resolvePair(values, `mouthSmile${side}`, `mouthFrown${side}`, conflicts);
    resolvePair(values, `eyeWide${side}`, `eyeSquint${side}`, conflicts);
    resolvePair(values, `browOuterUp${side}`, `browDown${side}`, conflicts);
    project(
      values,
      [`mouthSmile${side}`, `mouthFrown${side}`, `mouthDimple${side}`, `mouthStretch${side}`],
      config.budgets.mouthCornerPerSide,
      `mouthCorner${side}`,
      config.epsilon,
      budgets,
    );
  }

  const closure = safeExpressionWeight(values.mouthClose);
  values.mouthClose = closure;
  const smile = average(values.mouthSmileLeft ?? 0, values.mouthSmileRight ?? 0);
  const frown = average(values.mouthFrownLeft ?? 0, values.mouthFrownRight ?? 0);
  // A teeth-bearing smile does not always open the jaw far enough for jawOpen
  // alone. Upper/lower lip separation provides the missing visual evidence.
  const upperSeparation = average(values.mouthUpperUpLeft ?? values.mouthUpperUp ?? 0, values.mouthUpperUpRight ?? values.mouthUpperUp ?? 0);
  const lowerSeparation = average(values.mouthLowerDownLeft ?? values.mouthLowerDown ?? 0, values.mouthLowerDownRight ?? values.mouthLowerDown ?? 0);
  const smileOpenEvidence = Math.max(values.jawOpen ?? 0, average(upperSeparation, lowerSeparation));
  const smileOpenGate = smoothActivation(smileOpenEvidence, config.smile.openOnset, config.smile.openFull);
  values.mouthSmileClosed = smile * (1 - smileOpenGate) * config.smile.closedGain;
  values.mouthSmileOpen = smile * smileOpenGate * config.smile.openGain;
  values.mouthFrown = frown * config.smile.frownGain;
  const vowelLimit = Math.pow(1 - closure, config.priorityExponent)
    * (1 - smile * config.smile.vowelSuppression);
  project(values, VOWELS, vowelLimit, "vowel", config.epsilon, budgets);

  const vowelSum = sum(values, VOWELS);
  const lipShapeLimit = Math.min(config.budgets.lipShape, Math.max(0, config.budgets.mouthBase - closure - vowelSum))
    * (1 - smile * config.smile.lipShapeSuppression);
  project(values, LIP_SHAPES, lipShapeLimit, "lipShape", config.epsilon, budgets);

  for (const side of ["Left", "Right"] as const) {
    const blink = Math.max(values[`blink${side}`] ?? 0, values[`eyeBlink${side}`] ?? 0);
    values[`blink${side}`] = blink;
    values[`eyeBlink${side}`] = blink;
    project(
      values,
      [`eyeWide${side}`, `eyeSquint${side}`],
      Math.pow(1 - blink, config.priorityExponent),
      `eye${side}`,
      config.epsilon,
      budgets,
    );
    // Closed-lip phonemes can falsely raise MediaPipe eyeSquint. Keep a genuine
    // blink authoritative, but do not let mouth closure drive a raw eyelid morph.
    project(
      values,
      [`eyeSquint${side}`],
      Math.pow(1 - closure, config.priorityExponent),
      `eyeSquintMouthGuard${side}`,
      config.epsilon,
      budgets,
    );
    project(
      values,
      [`mouthUpperUp${side}`, `mouthLowerDown${side}`],
      config.budgets.lipVerticalPerSide,
      `lipVertical${side}`,
      config.epsilon,
      budgets,
    );
    project(
      values,
      [`cheekSquint${side}`, `noseSneer${side}`],
      config.budgets.cheekNosePerSide,
      `cheekNose${side}`,
      config.epsilon,
      budgets,
    );
  }
  project(
    values,
    ["mouthRollUpper", "mouthRollLower", "mouthShrugUpper", "mouthShrugLower"],
    config.budgets.lipVerticalPerSide,
    "lipVerticalGlobal",
    config.epsilon,
    budgets,
  );

  values.cheekPuff = Math.min(values.cheekPuff ?? 0, config.budgets.cheekNosePerSide);
  values.eyeWide = Math.max(values.eyeWideLeft ?? 0, values.eyeWideRight ?? 0);
  values.mouthPress = average(values.mouthPressLeft ?? 0, values.mouthPressRight ?? 0);
  values.mouthUpperUp = average(values.mouthUpperUpLeft ?? 0, values.mouthUpperUpRight ?? 0);
  values.mouthLowerDown = average(values.mouthLowerDownLeft ?? 0, values.mouthLowerDownRight ?? 0);

  // Inner-up là global và có thể cùng xuất hiện với down trong nét lo lắng. Chỉ aggregate
  // fallback cho rig yếu mới được resolve thành một cặp toàn cục không xung đột.
  values.browUp = Math.max(
    values.browInnerUp ?? 0,
    average(values.browOuterUpLeft ?? 0, values.browOuterUpRight ?? 0),
  );
  values.browDown = average(values.browDownLeft ?? 0, values.browDownRight ?? 0);
  resolvePair(values, "browUp", "browDown", conflicts);

  project(values, EMOTIONS, config.budgets.emotion, "emotion", config.epsilon, budgets);
  for (const [name, value] of Object.entries(values)) values[name] = safeExpressionWeight(value);
  return { expressions: values, snapshot: { conflicts, budgets } };
}

export function createFacialExpressionMixer(config: FacialExpressionMixerConfig) {
  validateFacialExpressionMixerConfig(config);
  return (input: Readonly<Record<string, number>>) => mixFacialExpressions(input, config);
}
