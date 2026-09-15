export interface ActivationRange { onset: number; full: number }

export interface MouthExpressionConfig {
  activation: {
    jawOpen: ActivationRange;
    mouthClose: ActivationRange;
    pucker: ActivationRange;
    funnel: ActivationRange;
    stretch: ActivationRange;
    lip: ActivationRange;
    corner: ActivationRange;
  };
  /** Tỉ lệ khe môi trong / bề rộng miệng, đã bất biến theo scale camera. */
  landmarkAperture: ActivationRange;
  aperture: {
    low: ActivationRange;
    midEnter: ActivationRange;
    midExit: ActivationRange;
    high: ActivationRange;
  };
  pressClosureGain: number;
  roundWideAntagonism: number;
  puckerOpenSuppression: number;
  funnelClosedGain: number;
  aaRoundSuppression: number;
  aaWideSuppression: number;
  roundedBaseEvidence: number;
  epsilon: number;
}

export interface MouthExpressionSnapshot {
  geometry: {
    jawOpen: number;
    blendshapeJawOpen: number;
    landmarkJawOpen: number;
    closure: number;
    visibleOpening: number;
    pucker: number;
    funnel: number;
    stretch: number;
    round: number;
    width: number;
    activity: number;
  };
  corrective: {
    pucker: number;
    funnel: number;
    narrow: number;
    wide: number;
    upperUp: number;
    lowerDown: number;
  };
  visemes: { aa: number; ih: number; ou: number; ee: number; oh: number };
}

export interface MouthExpressionResult {
  expressions: Record<string, number>;
  snapshot: MouthExpressionSnapshot;
}

export interface MouthExpressionGeometryEvidence { landmarkJawOpen?: number }

const RANGE_NAMES = ["jawOpen", "mouthClose", "pucker", "funnel", "stretch", "lip", "corner"] as const;
const APERTURE_RANGE_NAMES = ["low", "midEnter", "midExit", "high"] as const;

/** Chặn dữ liệu detector không hữu hạn trước khi nó lan sang toàn bộ vector biểu cảm. */
export function safe01(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

function assertRange(name: string, range: ActivationRange): void {
  if (![range.onset, range.full].every(Number.isFinite) || range.onset < 0 || range.full > 1 || range.onset >= range.full) {
    throw new RangeError(`Mouth expression range ${name} phải thỏa 0 <= onset < full <= 1.`);
  }
}

export function validateMouthExpressionConfig(config: MouthExpressionConfig): void {
  for (const name of RANGE_NAMES) assertRange(`activation.${name}`, config.activation[name]);
  assertRange("landmarkAperture", config.landmarkAperture);
  for (const name of APERTURE_RANGE_NAMES) assertRange(`aperture.${name}`, config.aperture[name]);
  const unitGains = [
    "pressClosureGain", "roundWideAntagonism", "puckerOpenSuppression", "funnelClosedGain",
    "aaRoundSuppression", "aaWideSuppression", "roundedBaseEvidence",
  ] as const;
  for (const name of unitGains) if (!Number.isFinite(config[name]) || config[name] < 0 || config[name] > 1) {
    throw new RangeError(`Mouth expression gain ${name} phải nằm trong [0, 1].`);
  }
  if (!Number.isFinite(config.epsilon) || config.epsilon <= 0 || config.epsilon > 1) {
    throw new RangeError("Mouth expression epsilon phải hữu hạn và nằm trong (0, 1].");
  }
}

function smoothActivation(value: unknown, range: ActivationRange): number {
  const t = safe01((safe01(value) - range.onset) / (range.full - range.onset));
  return t * t * (3 - 2 * t);
}

const average = (left: number, right: number) => (left + right) / 2;

export function createNeutralMouthExpressionSnapshot(): MouthExpressionSnapshot {
  return {
    geometry: { jawOpen: 0, blendshapeJawOpen: 0, landmarkJawOpen: 0, closure: 0, visibleOpening: 0, pucker: 0, funnel: 0, stretch: 0, round: 0, width: 0, activity: 0 },
    corrective: { pucker: 0, funnel: 0, narrow: 0, wide: 0, upperUp: 0, lowerDown: 0 },
    visemes: { aa: 0, ih: 0, ou: 0, ee: 0, oh: 0 },
  };
}

/**
 * F3 webcam-only mouth mapper. Hàm thuần: không smoothing, hysteresis, audio hay model state.
 * F1 sở hữu neutral calibration; F4/F5 lần lượt sở hữu dynamics và audio fusion.
 */
function computeValidatedMouthExpressions(
  input: Readonly<Record<string, number>>,
  config: MouthExpressionConfig,
  geometryEvidence?: Readonly<MouthExpressionGeometryEvidence>,
): MouthExpressionResult {
  const read = (name: string) => safe01(input[name]);

  const blendshapeJawOpen = smoothActivation(read("jawOpen"), config.activation.jawOpen);
  const landmarkJawOpen = safe01(geometryEvidence?.landmarkJawOpen);
  const jawOpen = Math.max(blendshapeJawOpen, landmarkJawOpen);
  const pressLeft = smoothActivation(read("mouthPressLeft"), config.activation.lip);
  const pressRight = smoothActivation(read("mouthPressRight"), config.activation.lip);
  const press = average(pressLeft, pressRight);
  const closureEvidence = Math.max(read("mouthClose"), config.pressClosureGain * press);
  const closure = smoothActivation(closureEvidence, config.activation.mouthClose);
  const visibleOpening = jawOpen * (1 - closure);

  const pucker = smoothActivation(read("mouthPucker"), config.activation.pucker);
  const funnel = smoothActivation(read("mouthFunnel"), config.activation.funnel);
  const stretchLeft = smoothActivation(read("mouthStretchLeft"), config.activation.stretch);
  const stretchRight = smoothActivation(read("mouthStretchRight"), config.activation.stretch);
  const stretch = average(stretchLeft, stretchRight);
  const roundEvidence = Math.max(pucker, funnel);
  const width = stretch * (1 - config.roundWideAntagonism * roundEvidence);
  const round = roundEvidence * (1 - config.roundWideAntagonism * stretch);

  const low = 1 - smoothActivation(visibleOpening, config.aperture.low);
  const mid = smoothActivation(visibleOpening, config.aperture.midEnter)
    * (1 - smoothActivation(visibleOpening, config.aperture.midExit));
  const high = smoothActivation(visibleOpening, config.aperture.high);

  const roundedEvidenceFloor = config.roundedBaseEvidence;
  const scores = {
    aa: visibleOpening * (1 - config.aaRoundSuppression * round) * (1 - config.aaWideSuppression * width),
    ih: width * low * (1 - round),
    ee: width * mid * (1 - round),
    ou: round * low * (roundedEvidenceFloor + (1 - roundedEvidenceFloor) * pucker),
    oh: round * Math.max(mid, high) * (roundedEvidenceFloor + (1 - roundedEvidenceFloor) * funnel),
  };
  const scoreSum = Object.values(scores).reduce((sum, value) => sum + value, 0);
  const activity = Math.max(jawOpen, roundEvidence, stretch) * (1 - closure);
  const visemes = Object.fromEntries(Object.entries(scores).map(([name, score]) => [
    name,
    scoreSum <= config.epsilon ? 0 : safe01(activity * score / scoreSum),
  ])) as MouthExpressionSnapshot["visemes"];

  const upperLeft = smoothActivation(read("mouthUpperUpLeft"), config.activation.lip);
  const upperRight = smoothActivation(read("mouthUpperUpRight"), config.activation.lip);
  const lowerLeft = smoothActivation(read("mouthLowerDownLeft"), config.activation.lip);
  const lowerRight = smoothActivation(read("mouthLowerDownRight"), config.activation.lip);
  const smileLeft = smoothActivation(read("mouthSmileLeft"), config.activation.corner);
  const smileRight = smoothActivation(read("mouthSmileRight"), config.activation.corner);
  const frownLeft = smoothActivation(read("mouthFrownLeft"), config.activation.corner);
  const frownRight = smoothActivation(read("mouthFrownRight"), config.activation.corner);
  const corrective = {
    pucker: pucker * (1 - config.puckerOpenSuppression * visibleOpening),
    funnel: funnel * (config.funnelClosedGain + (1 - config.funnelClosedGain) * visibleOpening),
    narrow: roundEvidence,
    wide: stretch,
    upperUp: average(upperLeft, upperRight),
    lowerDown: average(lowerLeft, lowerRight),
  };

  return {
    expressions: {
      jawOpen,
      mouthClose: closure,
      mouthPress: press,
      mouthPressLeft: pressLeft,
      mouthPressRight: pressRight,
      mouthPucker: corrective.pucker,
      mouthFunnel: corrective.funnel,
      mouthNarrow: corrective.narrow,
      mouthWide: corrective.wide,
      mouthUpperUp: corrective.upperUp,
      mouthUpperUpLeft: upperLeft,
      mouthUpperUpRight: upperRight,
      mouthLowerDown: corrective.lowerDown,
      mouthLowerDownLeft: lowerLeft,
      mouthLowerDownRight: lowerRight,
      mouthSmileLeft: smileLeft,
      mouthSmileRight: smileRight,
      mouthFrownLeft: frownLeft,
      mouthFrownRight: frownRight,
      ...visemes,
    },
    snapshot: {
      geometry: { jawOpen, blendshapeJawOpen, landmarkJawOpen, closure, visibleOpening, pucker, funnel, stretch, round, width, activity },
      corrective,
      visemes,
    },
  };
}

/** Entry-point tiện cho unit test/caller đơn lẻ; luôn validate config trước khi tính. */
export function computeMouthExpressions(
  input: Readonly<Record<string, number>>,
  config: MouthExpressionConfig,
  geometryEvidence?: Readonly<MouthExpressionGeometryEvidence>,
): MouthExpressionResult {
  validateMouthExpressionConfig(config);
  return computeValidatedMouthExpressions(input, config, geometryEvidence);
}

/** Validate đúng một lần cho pipeline realtime; mapper trả về vẫn là hàm thuần theo input. */
export function createMouthExpressionMapper(
  config: MouthExpressionConfig,
): (input: Readonly<Record<string, number>>, geometryEvidence?: Readonly<MouthExpressionGeometryEvidence>) => MouthExpressionResult {
  validateMouthExpressionConfig(config);
  return (input, geometryEvidence) => computeValidatedMouthExpressions(input, config, geometryEvidence);
}
