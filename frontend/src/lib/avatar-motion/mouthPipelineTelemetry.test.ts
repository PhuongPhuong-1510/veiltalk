import { describe, expect, it } from "vitest";
import { MouthPipelineTelemetry } from "./mouthPipelineTelemetry";
import { createNeutralMouthExpressionSnapshot, type MouthExpressionSnapshot } from "./mouthExpression";
import type { FacialExpressionDynamicsSnapshot } from "./facialExpressionDynamics";
import { createNeutralMouthSpeechCorrectiveSnapshot } from "./mouthSpeechCorrective";

const mouth = (opening: number, round = 0, stretch = 0, closure = 0, vowel = opening): MouthExpressionSnapshot => ({
  ...createNeutralMouthExpressionSnapshot(),
  geometry: { ...createNeutralMouthExpressionSnapshot().geometry, visibleOpening: opening, round, width: stretch, closure },
  visemes: { aa: vowel, ih: 0, ou: 0, ee: 0, oh: 0 },
});

const dynamics = (desired: number, dynamic: number, final: number, closure = 0): FacialExpressionDynamicsSnapshot => ({
  lifecycle: "active", sampleDisposition: "fresh", filtered: true, dtMs: 50, gapRebased: false,
  raw: {},
  desired: { aa: desired, mouthClose: closure },
  dynamic: { aa: dynamic, mouthClose: closure },
  final: { aa: final, mouthClose: closure },
  preMix: { conflicts: [], budgets: {} },
  postMix: { conflicts: [], budgets: {} },
  mouthCorrective: createNeutralMouthSpeechCorrectiveSnapshot(),
});

describe("mouth pipeline telemetry", () => {
  it("keeps one-second stage peaks so a slow UI poll does not miss a one-frame mouth pulse", () => {
    const telemetry = new MouthPipelineTelemetry(1_000);
    telemetry.record({ sampledAtMs: 100, raw: { jawOpen: .3 }, calibrated: { jawOpen: .2 }, mouth: mouth(.4), dynamics: dynamics(.35, .3, .25) });
    telemetry.record({ sampledAtMs: 150, raw: { jawOpen: 0 }, calibrated: { jawOpen: 0 }, mouth: mouth(0), dynamics: dynamics(0, .1, .08) });
    expect(telemetry.snapshot().window).toMatchObject({
      sampleCount: 2,
      sampleRateFps: 20,
      activeSampleCount: 1,
      peaks: { rawJawOpen: .3, calibratedJawOpen: .2, visibleOpening: .4, f3VowelSum: .4, desiredVowelSum: .35, dynamicVowelSum: .3, finalVowelSum: .25 },
    });
  });

  it("uses geometry without smile or viseme feedback to form the diagnostic activity candidate", () => {
    const telemetry = new MouthPipelineTelemetry();
    telemetry.record({ sampledAtMs: 10, raw: {}, calibrated: {}, mouth: mouth(.1, .7, .4, 0, 1), dynamics: dynamics(1, 1, 1) });
    expect(telemetry.snapshot().current?.speechActivity).toEqual({ visibleOpening: .1, round: .7, stretch: .4, candidate: .7 });
  });

  it("drops expired samples, rejects duplicate timestamps and resets without retaining facial values", () => {
    const telemetry = new MouthPipelineTelemetry(100);
    telemetry.record({ sampledAtMs: 0, raw: { jawOpen: 1 }, calibrated: { jawOpen: 1 }, mouth: mouth(1), dynamics: dynamics(1, 1, 1) });
    telemetry.record({ sampledAtMs: 0, raw: { jawOpen: 0 }, calibrated: { jawOpen: 0 }, mouth: mouth(0), dynamics: dynamics(0, 0, 0) });
    telemetry.record({ sampledAtMs: 150, raw: { jawOpen: .2 }, calibrated: { jawOpen: .2 }, mouth: mouth(.2), dynamics: dynamics(.2, .2, .2, .8) });
    expect(telemetry.snapshot().window).toMatchObject({ sampleCount: 1, peaks: { rawJawOpen: .2, finalClosure: .8 } });
    telemetry.reset();
    expect(telemetry.snapshot()).toMatchObject({ current: null, window: { sampleCount: 0, activeSampleCount: 0 } });
  });
});
