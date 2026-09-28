import { Vector3 } from "three";
import type { RawNormalizedLandmarkV1 } from "../tracking/rawTrackingTypes";
import type { HandBasisResult } from "./handPalmBasis";

export type BimanualFingerName = "thumb" | "index" | "middle" | "ring" | "little";

export interface BimanualPairMetric {
  distance: number;
  proximity: number;
}

export interface BimanualHandFeatures {
  valid: boolean;
  normalizedByPalmWidth: number;
  wristDistance: number;
  palmCenterDistance: number;
  tipCentroidDistance: number;
  thumbThumb: BimanualPairMetric;
  indexIndex: BimanualPairMetric;
  leftThumbRightIndex: BimanualPairMetric;
  rightThumbLeftIndex: BimanualPairMetric;
  nearestRegularTipDistance: number;
  regularTipContactCount: number;
  regularSegmentIntersectionCount: number;
  regularSegmentIntersectionScore: number;
  palmsFacing: number;
  palmsSameDirection: number;
  palmForwardAlignment: number;
  heartVerticalOrder: number;
}

export interface BimanualHandFeatureInput {
  leftLandmarks: readonly RawNormalizedLandmarkV1[] | null | undefined;
  rightLandmarks: readonly RawNormalizedLandmarkV1[] | null | undefined;
  leftWorldBasis?: HandBasisResult | null;
  rightWorldBasis?: HandBasisResult | null;
  videoWidth: number;
  videoHeight: number;
}

const TIP_INDEX: Record<BimanualFingerName, number> = {
  thumb: 4,
  index: 8,
  middle: 12,
  ring: 16,
  little: 20,
};
const MCP_INDEX: Record<Exclude<BimanualFingerName, "thumb">, number> = {
  index: 5,
  middle: 9,
  ring: 13,
  little: 17,
};
const REGULAR = ["index", "middle", "ring", "little"] as const;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smoothstep01 = (value: number): number => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const finite = (point: RawNormalizedLandmarkV1 | undefined): point is RawNormalizedLandmarkV1 =>
  Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));

function imagePoint(point: RawNormalizedLandmarkV1, aspectY: number): Vector3 {
  return new Vector3(point.x, point.y * aspectY, 0);
}

function pairMetric(a: Vector3, b: Vector3, palmWidth: number): BimanualPairMetric {
  const distance = a.distanceTo(b) / Math.max(1e-6, palmWidth);
  // Strong contact below ~0.12 palm widths; fades out by ~0.45.
  const proximity = 1 - smoothstep01((distance - 0.10) / 0.35);
  return { distance, proximity };
}

function palmCenter(landmarks: readonly RawNormalizedLandmarkV1[], aspectY: number): Vector3 | null {
  const ids = [0, 5, 9, 17];
  const points = ids.map((id) => landmarks[id]);
  if (!points.every(finite)) return null;
  const center = new Vector3();
  for (const point of points) center.add(imagePoint(point, aspectY));
  return center.multiplyScalar(1 / points.length);
}

function tipCentroid(landmarks: readonly RawNormalizedLandmarkV1[], aspectY: number): Vector3 | null {
  const points = Object.values(TIP_INDEX).map((id) => landmarks[id]);
  if (!points.every(finite)) return null;
  const center = new Vector3();
  for (const point of points) center.add(imagePoint(point, aspectY));
  return center.multiplyScalar(1 / points.length);
}

function orientationScores(left: HandBasisResult | null | undefined, right: HandBasisResult | null | undefined): {
  palmsFacing: number;
  palmsSameDirection: number;
  palmForwardAlignment: number;
} {
  if (!left || !right) return { palmsFacing: 0, palmsSameDirection: 0, palmForwardAlignment: 0 };
  const leftNormal = new Vector3(left.normal.x, left.normal.y, left.normal.z);
  const rightNormal = new Vector3(right.normal.x, right.normal.y, right.normal.z);
  const leftForward = new Vector3(left.forward.x, left.forward.y, left.forward.z);
  const rightForward = new Vector3(right.forward.x, right.forward.y, right.forward.z);
  if ([leftNormal, rightNormal, leftForward, rightForward].some((value) => value.lengthSq() < 1e-8)) {
    return { palmsFacing: 0, palmsSameDirection: 0, palmForwardAlignment: 0 };
  }

  // computeHandPalmBasis deliberately does not chirality-correct the normal. Across(index→pinky)
  // flips between left/right hands, so canonicalize the right normal before comparing physical palms.
  leftNormal.normalize();
  rightNormal.normalize().negate();
  leftForward.normalize();
  rightForward.normalize();
  const normalDot = Math.max(-1, Math.min(1, leftNormal.dot(rightNormal)));
  const forwardDot = Math.max(-1, Math.min(1, leftForward.dot(rightForward)));
  return {
    palmsFacing: clamp01((1 - normalDot) * 0.5),
    palmsSameDirection: clamp01((1 + normalDot) * 0.5),
    palmForwardAlignment: clamp01((1 + forwardDot) * 0.5),
  };
}

function orientation2D(a: Vector3, b: Vector3, c: Vector3): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a: Vector3, b: Vector3, c: Vector3, d: Vector3): boolean {
  const o1 = orientation2D(a, b, c);
  const o2 = orientation2D(a, b, d);
  const o3 = orientation2D(c, d, a);
  const o4 = orientation2D(c, d, b);
  const epsilon = 1e-7;
  if ([o1, o2, o3, o4].some((value) => Math.abs(value) <= epsilon)) return false;
  return Math.sign(o1) !== Math.sign(o2) && Math.sign(o3) !== Math.sign(o4);
}

export function computeBimanualHandFeatures(input: BimanualHandFeatureInput): BimanualHandFeatures | null {
  const { leftLandmarks: left, rightLandmarks: right } = input;
  if (!left || !right || !(input.videoWidth > 0) || !(input.videoHeight > 0)) return null;
  const aspectY = input.videoHeight / input.videoWidth;
  const required = [0, 4, 5, 8, 9, 12, 13, 16, 17, 20];
  if (!required.every((index) => finite(left[index]) && finite(right[index]))) return null;

  const leftIndexMcp = imagePoint(left[5], aspectY);
  const leftLittleMcp = imagePoint(left[17], aspectY);
  const rightIndexMcp = imagePoint(right[5], aspectY);
  const rightLittleMcp = imagePoint(right[17], aspectY);
  const leftPalmWidth = leftIndexMcp.distanceTo(leftLittleMcp);
  const rightPalmWidth = rightIndexMcp.distanceTo(rightLittleMcp);
  const palmWidth = (leftPalmWidth + rightPalmWidth) * 0.5;
  if (!Number.isFinite(palmWidth) || palmWidth <= 1e-6) return null;

  const leftWrist = imagePoint(left[0], aspectY);
  const rightWrist = imagePoint(right[0], aspectY);
  const leftPalmCenter = palmCenter(left, aspectY);
  const rightPalmCenter = palmCenter(right, aspectY);
  const leftTipCenter = tipCentroid(left, aspectY);
  const rightTipCenter = tipCentroid(right, aspectY);
  if (!leftPalmCenter || !rightPalmCenter || !leftTipCenter || !rightTipCenter) return null;

  const lp = (finger: BimanualFingerName) => imagePoint(left[TIP_INDEX[finger]], aspectY);
  const rp = (finger: BimanualFingerName) => imagePoint(right[TIP_INDEX[finger]], aspectY);
  const thumbThumb = pairMetric(lp("thumb"), rp("thumb"), palmWidth);
  const indexIndex = pairMetric(lp("index"), rp("index"), palmWidth);
  const leftThumbRightIndex = pairMetric(lp("thumb"), rp("index"), palmWidth);
  const rightThumbLeftIndex = pairMetric(rp("thumb"), lp("index"), palmWidth);

  let nearestRegularTipDistance = Infinity;
  let regularTipContactCount = 0;
  let regularSegmentIntersectionCount = 0;
  for (const leftFinger of REGULAR) {
    for (const rightFinger of REGULAR) {
      const distance = lp(leftFinger).distanceTo(rp(rightFinger)) / palmWidth;
      nearestRegularTipDistance = Math.min(nearestRegularTipDistance, distance);
      if (distance <= 0.34) regularTipContactCount += 1;

      const leftBase = imagePoint(left[MCP_INDEX[leftFinger]], aspectY);
      const rightBase = imagePoint(right[MCP_INDEX[rightFinger]], aspectY);
      if (segmentsIntersect(leftBase, lp(leftFinger), rightBase, rp(rightFinger))) {
        regularSegmentIntersectionCount += 1;
      }
    }
  }
  if (!Number.isFinite(nearestRegularTipDistance)) nearestRegularTipDistance = 99;

  const intersectionsScore = smoothstep01((regularSegmentIntersectionCount - 1) / 5);
  const orientation = orientationScores(input.leftWorldBasis, input.rightWorldBasis);

  // In a heart silhouette the two index tips should sit above the thumb tips in image space.
  // y grows downward after aspect correction, so positive (thumbY - indexY) supports the shape.
  const indexY = (lp("index").y + rp("index").y) * 0.5;
  const thumbY = (lp("thumb").y + rp("thumb").y) * 0.5;
  const verticalGap = (thumbY - indexY) / palmWidth;
  const heartVerticalOrder = smoothstep01((verticalGap - 0.05) / 0.45);

  return {
    valid: true,
    normalizedByPalmWidth: palmWidth,
    wristDistance: leftWrist.distanceTo(rightWrist) / palmWidth,
    palmCenterDistance: leftPalmCenter.distanceTo(rightPalmCenter) / palmWidth,
    tipCentroidDistance: leftTipCenter.distanceTo(rightTipCenter) / palmWidth,
    thumbThumb,
    indexIndex,
    leftThumbRightIndex,
    rightThumbLeftIndex,
    nearestRegularTipDistance,
    regularTipContactCount,
    regularSegmentIntersectionCount,
    regularSegmentIntersectionScore: intersectionsScore,
    ...orientation,
    heartVerticalOrder,
  };
}
