import type { RawNormalizedLandmarkV1, RawTrackingFrameV1 } from "../tracking/rawTrackingTypes";
import type { ContactDepthEvidence, HandContactProbe } from "./bodyContactTypes";
import type { FaceSurfaceLocation, HumanFaceContactSurface } from "./humanFaceContactSurface";

export interface ContactRegistrationDiagnostic {
  source: "weak-perspective-wrist-nose-registration";
  reason: string;
  samples: number;
  sampleSkewMs: number | null;
  handImageScale: number | null;
  poseImageScale: number | null;
  reprojectionRms: number | null;
  wristMismatch: number | null;
  signedGapFaceHeights: number | null;
  uncertaintyFaceHeights: number | null;
  quality: number;
  /** Same underlying registration; it is never counted as two independent depth measurements. */
  correlatedSources: readonly ["pose-wrist-nose", "hand-local-shape", "face-local-shape"];
}
const empty = (): ContactRegistrationDiagnostic => ({ source: "weak-perspective-wrist-nose-registration", reason: "missing-data", samples: 0, sampleSkewMs: null, handImageScale: null, poseImageScale: null, reprojectionRms: null, wristMismatch: null, signedGapFaceHeights: null, uncertaintyFaceHeights: null, quality: 0, correlatedSources: ["pose-wrist-nose", "hand-local-shape", "face-local-shape"] });
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const valid = (p: RawNormalizedLandmarkV1 | undefined) => p && [p.x, p.y, p.z].every(Number.isFinite);
const visible = (p: RawNormalizedLandmarkV1 | undefined) => valid(p) && (p!.visibility === null || p!.visibility >= .6);

/** Fit a shared positive XY scale, after centering, with actual reprojection error. z is not fit. */
export function fitImageWorldScale(image: readonly RawNormalizedLandmarkV1[], world: readonly RawNormalizedLandmarkV1[], ids: readonly number[], aspect: number): { scale: number; rms: number } | null {
  if (!ids.every(i => valid(image[i]) && valid(world[i]))) return null;
  const mean = (axis: "x" | "y", points: readonly RawNormalizedLandmarkV1[], factor = 1) => ids.reduce((s, i) => s + points[i][axis] * factor, 0) / ids.length;
  const ix = mean("x", image), iy = mean("y", image, aspect), wx = mean("x", world), wy = mean("y", world);
  let numerator = 0, denominator = 0;
  for (const i of ids) { const x = world[i].x - wx, y = world[i].y - wy; numerator += x * (image[i].x - ix) + y * (image[i].y * aspect - iy); denominator += x * x + y * y; }
  if (denominator < 1e-7) return null;
  const scale = numerator / denominator;
  if (!(scale > .02 && scale < 20)) return null;
  const squared = ids.reduce((s, i) => s + (image[i].x - ix - (world[i].x - wx) * scale) ** 2 + (image[i].y * aspect - iy - (world[i].y - wy) * scale) ** 2, 0);
  return { scale, rms: Math.sqrt(squared / ids.length) };
}

/** Relative geometry registration with a reported uncertainty floor, not measured metric contact. */
export class ContactDepthRegistration {
  private lastAt: number | null = null;
  private samples = 0;
  private scales: number[] = [];
  reset(): void { this.lastAt = null; this.samples = 0; this.scales = []; }
  unavailable(reason:string):ContactRegistrationDiagnostic {this.reset();return{...empty(),reason};}
  update(frame: RawTrackingFrameV1, side: "left" | "right", image: RawNormalizedLandmarkV1[] | null, world: RawNormalizedLandmarkV1[] | null, at: number, now: number, surface: HumanFaceContactSurface | null, location: FaceSurfaceLocation | undefined, probe: HandContactProbe): ContactRegistrationDiagnostic {
    const out = empty();
    const poseImage = frame.pose.landmarks, poseWorld = frame.pose.worldLandmarks, face = frame.face.landmarks;
    const times = [frame.face.sampledAtMs, frame.pose.sampledAtMs, at];
    const invalidate = (reason: string) => { this.reset(); out.reason = reason; return out; };
    if (!Number.isFinite(now) || !Number.isFinite(at) || times.some(t => t === null || !Number.isFinite(t))) return invalidate("missing-clock");
    const clockValues = times as number[];
    out.sampleSkewMs = Math.max(...clockValues) - Math.min(...clockValues);
    if (at > now || clockValues.some(t => now - t > 150 || now < t) || out.sampleSkewMs > 100 || frame.face.state === "lost" || frame.pose.state === "lost") return invalidate("stale-or-skewed");
    if (this.lastAt !== null && at <= this.lastAt) { out.reason = "duplicate-or-reversed"; out.samples = this.samples; return out; }
    if (this.lastAt !== null && at - this.lastAt > 250) this.reset();
    if(!image)return invalidate("missing-hand-image");
    if(!world)return invalidate("missing-hand-world");
    if(!poseImage)return invalidate("missing-pose-image");
    if(!poseWorld)return invalidate("missing-pose-world");
    if(!face)return invalidate("missing-face-landmarks");
    if(!surface)return invalidate("invalid-face-surface");
    if(!location)return invalidate("probe-outside-face-surface");
    if(!frame.videoWidth||!frame.videoHeight)return invalidate("invalid-video-size");
    const wrist = side === "left" ? 15 : 16;
    const poseIds = [11, 12, side === "left" ? 13 : 14, wrist];
    if (![0, wrist, ...poseIds].every(i => visible(poseImage[i]) && visible(poseWorld[i])) || !valid(world[0]) || !valid(image[0]) || !valid(face[1])) return invalidate("unobserved-pose-reference");
    const aspect = frame.videoHeight / frame.videoWidth;
    const handFit = fitImageWorldScale(image, world, [0, 5, 9, 13, 17], aspect), poseFit = fitImageWorldScale(poseImage, poseWorld, poseIds, aspect);
    if (!handFit || !poseFit) return invalidate("projection-scale-unresolved");
    out.handImageScale = handFit.scale; out.poseImageScale = poseFit.scale;
    out.reprojectionRms = Math.hypot(handFit.rms, poseFit.rms) / surface.faceHeight;
    out.wristMismatch = Math.hypot(image[0].x - poseImage[wrist].x, (image[0].y - poseImage[wrist].y) * aspect) / surface.faceHeight;
    if (out.reprojectionRms > .12 || out.wristMismatch > .20) return invalidate("registration-residual");
    this.lastAt = at; this.samples++; this.scales.push(poseFit.scale); if (this.scales.length > 8) this.scales.shift();
    const sorted = [...this.scales].sort((a, b) => a - b), poseScale = sorted[Math.floor(sorted.length / 2)];
    const scaleSpread = Math.max(...this.scales) / Math.min(...this.scales) - 1;
    const ids = probe === "indexTip" ? [8] : probe === "palmCenter" ? [5, 9, 13, 17] : probe === "radialEdge" ? [5] : [17];
    if (!ids.every(i => valid(world[i]))) return invalidate("missing-probe-shape");
    const localDepth = (ids.reduce((s, i) => s + world[i].z, 0) / ids.length - world[0].z) * (probe === "indexTip" ? 1 : probe === "palmCenter" ? .52 : .5);
    // Register Hand local displacement via its observed image scale into the Pose projection;
    // anchor at the same anatomical wrist. Face local depth is registered at the shared nose.
    const probeZ = poseWorld[wrist].z + localDepth * handFit.scale / poseScale;
    const faceZ = poseWorld[0].z + (location.point.z - face[1].z) / poseScale;
    const faceHeightWorld = surface.faceHeight / poseScale;
    out.signedGapFaceHeights = (probeZ - faceZ) / faceHeightWorld;
    // Learned scale/depth biases remain after XY fitting. Never report zero uncertainty.
    out.uncertaintyFaceHeights = .10 + out.reprojectionRms * 2 + out.wristMismatch * .5 + Math.min(.4, scaleSpread) * .15 + (1 - location.quality) * .10;
    out.samples = this.samples;
    out.quality = clamp01((1 - out.reprojectionRms / .15) * (1 - out.wristMismatch / .25) * location.quality * Math.min(1, this.samples / 4));
    out.reason = this.samples < 4 ? "warming-up" : out.uncertaintyFaceHeights > .25 ? "depth-uncertain" : "registered-relative";
    return out;
  }
}

export function registeredContactDepth(registration: ContactRegistrationDiagnostic, orientation: number | null, settled: number | null, continuity: number): ContactDepthEvidence {
  const sources = { occlusion: null, scaleChange: null, posePrior: null, probeDepth: registration.quality, motionConsistency: settled, history: continuity };
  const unknown = (): ContactDepthEvidence => ({ relation: "unknown", confidence: Math.min(.55, registration.quality), sources, rejectionReason: "insufficient-cues" });
  const gap = registration.signedGapFaceHeights, uncertainty = registration.uncertaintyFaceHeights;
  if (gap === null || uncertainty === null || registration.samples < 4 || registration.quality < .45) return unknown();
  if (Math.abs(gap) > uncertainty + .45) return { relation: gap < 0 ? "in-front-separated" : "behind", confidence: registration.quality, sources, rejectionReason: gap < 0 ? "separated-evidence" : "behind-evidence" };
  if (registration.reason !== "registered-relative" || orientation === null || orientation < .55 || (settled ?? 0) < .55 || Math.abs(gap) > .12) return unknown();
  return { relation: "surface-compatible", confidence: Math.min(.9, registration.quality * .6 + orientation * .25 + (settled ?? 0) * .15), sources, rejectionReason: "none" };
}
