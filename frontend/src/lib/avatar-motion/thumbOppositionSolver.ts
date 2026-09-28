/**
 * Human-domain helpers for the thumb root.
 *
 * The existing finger solver already measures the root direction in the palm
 * basis (`mcpAbduction`).  For the four regular fingers that value represents
 * spread/adduction.  For the thumb it is more useful to interpret the same
 * observation as CMC sweep: a second degree of freedom that complements the
 * thumb flexion axis and is essential for opposition/pinch/OK poses.
 *
 * Nothing in this module knows about a named gesture or a concrete VRM axis.
 */

export const THUMB_SWEEP_LIMIT_RADIANS = 70 * Math.PI / 180;
export const THUMB_CONTACT_FLEX_ASSIST_RADIANS = 10 * Math.PI / 180;
export const INDEX_CONTACT_FLEX_ASSIST_RADIANS = 6 * Math.PI / 180;

export const wrapAnglePi = (value: number): number => {
  let result = value;
  while (result > Math.PI) result -= Math.PI * 2;
  while (result < -Math.PI) result += Math.PI * 2;
  return result;
};

export function resolveThumbSweepDelta(
  observedSweepRad: number,
  restSweepRad: number,
): number {
  const delta = wrapAnglePi(observedSweepRad - restSweepRad);
  return Math.max(-THUMB_SWEEP_LIMIT_RADIANS, Math.min(THUMB_SWEEP_LIMIT_RADIANS, delta));
}

/**
 * Small retargeting assist used only when the human fingertips are already
 * close.  It compensates for different avatar finger proportions; it does not
 * create a pose by itself and fades to zero before the fingers are near contact.
 */
export function contactFlexAssist(contactProximity: number, maxRadians: number): number {
  const t = Math.max(0, Math.min(1, (contactProximity - 0.45) / 0.55));
  const smooth = t * t * (3 - 2 * t);
  return smooth * maxRadians;
}
