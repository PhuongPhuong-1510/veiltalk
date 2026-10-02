/** Independent opt-in mechanisms; all false reproduces the AR9 baseline. */
export interface FaceContactResearchOptions {
  headSurface: boolean;
  jointProbeSelection: boolean;
  registeredDepth: boolean;
  meshSurface: boolean;
  finalRefinement: boolean;
  indexTip: boolean;
}

export const FACE_CONTACT_BASELINE: Readonly<FaceContactResearchOptions> = Object.freeze({
  headSurface: false, jointProbeSelection: false, registeredDepth: false,
  meshSurface: false, finalRefinement: false, indexTip: false,
});
export const FACE_CONTACT_COMBINED: Readonly<FaceContactResearchOptions> = Object.freeze({
  headSurface: true, jointProbeSelection: true, registeredDepth: true,
  meshSurface: true, finalRefinement: true, indexTip: false,
});
export const FACE_CONTACT_EXPERIMENT_VERSION = "face-contact-v1-2026-10-02";

export const FACE_CONTACT_ABLATIONS = [
  { name: "AR9 baseline", options: FACE_CONTACT_BASELINE },
  { name: "A1 head surface", options: { ...FACE_CONTACT_BASELINE, headSurface: true } },
  { name: "A2 joint probe selection", options: { ...FACE_CONTACT_BASELINE, jointProbeSelection: true } },
  { name: "A3 registered depth", options: { ...FACE_CONTACT_BASELINE, registeredDepth: true } },
  { name: "A4 mesh surface", options: { ...FACE_CONTACT_BASELINE, meshSurface: true } },
  { name: "A5 final refinement (renderer)", options: { ...FACE_CONTACT_BASELINE, meshSurface: true, finalRefinement: true } },
  { name: "Combined", options: FACE_CONTACT_COMBINED },
  { name: "Combined minus head surface", options: { ...FACE_CONTACT_COMBINED, headSurface: false } },
  { name: "Combined minus joint selection", options: { ...FACE_CONTACT_COMBINED, jointProbeSelection: false } },
  { name: "Combined minus registered depth", options: { ...FACE_CONTACT_COMBINED, registeredDepth: false } },
  { name: "Combined minus mesh", options: { ...FACE_CONTACT_COMBINED, meshSurface: false, finalRefinement: false } },
  { name: "Combined minus final refinement", options: { ...FACE_CONTACT_COMBINED, finalRefinement: false } },
  { name: "Combined + index tip", options: { ...FACE_CONTACT_COMBINED, indexTip: true } },
] as const;
