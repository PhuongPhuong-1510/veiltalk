import { describe, expect, it } from "vitest";
import { distributeHeadNeckRotation } from "./headNeckDistribution";
import { angularDeltaDegrees, multiplyQuaternions } from "./motionMath";

describe("Phase 3D head/neck distribution", () => {
  it("uses light and large per-axis shares with a continuous curve", () => {
    const light = distributeHeadNeckRotation({ yaw: 10, pitch: 5, roll: 5 }, { head: true, neck: true });
    expect(light.axes.yaw.headShare).toBeCloseTo(.75); expect(light.axes.yaw.neckShare).toBeCloseTo(.25); expect(light.axes.yaw.progress).toBe(0);
    expect(light.axes.pitch.headShare).toBeCloseTo(.7); expect(light.axes.pitch.neckShare).toBeCloseTo(.3); expect(light.axes.pitch.progress).toBe(0);
    const large = distributeHeadNeckRotation({ yaw: 60, pitch: 40, roll: 35 }, { head: true, neck: true });
    expect(large.axes.yaw.headShare).toBeCloseTo(.5); expect(large.axes.pitch.headShare).toBeCloseTo(.5); expect(large.axes.roll.headShare).toBeCloseTo(.55);
    const around = [14.99, 15, 15.01].map((yaw) => distributeHeadNeckRotation({ yaw, pitch: 0, roll: 0 }, { head: true, neck: true }).axes.yaw.headShare);
    expect(Math.max(...around) - Math.min(...around)).toBeLessThan(1e-5);
  });

  it("preserves the total target without double rotation for combined axes", () => {
    const value = distributeHeadNeckRotation({ yaw: 42, pitch: -23, roll: 17 }, { head: true, neck: true });
    expect(value.neck).not.toBeNull(); expect(value.head).not.toBeNull();
    expect(angularDeltaDegrees(multiplyQuaternions(value.neck!, value.head!), value.total)).toBeLessThan(1e-6);
    for (const axis of Object.values(value.axes)) expect(axis.headShare + axis.neckShare).toBeCloseTo(1);
  });
  it("preserves hierarchy target when head rest-local rotation is not identity", () => {
    const half = Math.PI / 8; const rest = { x: Math.sin(half), y: 0, z: 0, w: Math.cos(half) };
    const value = distributeHeadNeckRotation({ yaw: 42, pitch: -23, roll: 17 }, { head: true, neck: true, headRestLocalRotation: rest });
    const actual = multiplyQuaternions(multiplyQuaternions(value.neck!, rest), value.head!);
    const expected = multiplyQuaternions(rest, value.total);
    expect(angularDeltaDegrees(actual, expected)).toBeLessThan(1e-6);
  });

  it("falls back explicitly and rejects a missing head", () => {
    const fallback = distributeHeadNeckRotation({ yaw: 30, pitch: 10, roll: 5 }, { head: true, neck: false });
    expect(fallback).toMatchObject({ mode: "head-only-fallback", neck: null }); expect(fallback.head).toEqual(fallback.total);
    expect(distributeHeadNeckRotation({ yaw: 30, pitch: 0, roll: 0 }, { head: false, neck: true })).toMatchObject({ mode: "unsupported", head: null, neck: null });
  });
});
