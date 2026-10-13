# Phase B1–B4: implementation and webcam verification

Production tracking remains full-rate, GPU, Pose Full, 720p, all three tasks, with
the existing ROI/adaptive-confidence defaults. New experimental options default
OFF. No motion solver, renderer, or RawTrackingFrameV1 changes are required.

## Implemented decisions

| Phase | Implementation | Default | Remaining evidence |
| --- | --- | --- | --- |
| B1 | Separate `handWorkerDelegate`, inheriting main delegate when omitted; DEV Inherit/GPU/CPU selection | Inherit | CPU/GPU webcam A/B; no automatic CPU promotion |
| B2 | Callback-ahead registration with a single processing token; busy callbacks dropped without storing images/metadata | Off | Real browser scheduling and latency |
| B2 | Bounded Pose policy: at most one skipped processed frame; only after tracked Pose; Hand–Pose source skew <100ms and predicted publish age ≤120ms | Off | Shoulder/elbow/wrist continuity; estimator cannot guarantee future runtime |
| B3 | Preserve same-frame join; reject mismatched detector/source timestamps, duplicate/decreasing requests, late IDs and old Worker events; coalesce initialization | On | Real Worker/GPU stress and resource observation |
| B4 | Allow reliable `not-sampled` Pose geometry as an ROI hint without changing state/timestamp, with the original 120ms limit | Off | Fast motion and occlusion; age alone cannot establish geometry accuracy |
| B4 | Missing-region recovery after two ROI misses, plus full-frame probes after eight ROI samples or 500ms | Off | Per-hand recall/reacquire, cost and tracker-history transitions |
| Measurement | Reset at the next accepted frame boundary, per-mode timings/coverage, accepted observation Hz, observation-based loss/reacquire | Available | Human-labelled coverage and sensor-to-display latency |

No async latest-completed observation is attached to another source frame. That
strategy cannot satisfy the existing `handSampledThisFrame` contract without a
separate contract design. Join remains deliberate, not an unimplemented claim.

Two bitmap captures remain: one immutable source for Face/Pose and a transferable
copy for Hands. Transferring the original first detaches the main input; sending it
after main inference serializes Hands. Neither is promoted as an optimization.
Capture preparation timings remain available to decide a subsequent experiment.

Main-thread duplicate ROI planning was removed when the Worker owns the plan.
No model assets, thresholds, 120/150ms limits, camera constraints or confidence
selector hysteresis were relaxed. Adaptive mode still uses two persistent models;
only one detects per input. It may fail to allocate the sensitive model; compare
`adaptiveHandAvailable`, not just the requested flag.

## Start the DEV application

From `C:\project\veiltalk\frontend`:

```powershell
npm.cmd run dev -- --host 127.0.0.1
```

Open `http://127.0.0.1:5173/dev/avatar-renderer` (use the port Vite prints if different).
DEV controls intentionally do not appear in production. Production preview lives
at `/avatar/motion`. The avatar renderer must remain running during comparisons.

## Controlled webcam trial

1. Use the same webcam, browser, avatar, lighting, distance, power mode and window
   size. Keep Pose **Full**, all three tasks and the existing ROI/adaptive options.
2. Choose **Baseline — full-rate** and **Inherit** (or explicit GPU). Select a
   measurement scenario. Turn recording, replay, frozen input and simulated loss OFF.
3. Click **Start tracking**, permit the camera, and warm up for at least 20 seconds
   including the movements used in the test. Wait for stable timings. Warm-up is
   not a guarantee of thermal equilibrium; extend it if needed.
4. Expand **Performance – Phase B**. Click **Reset Measurement sau warm-up**.
   Wait for **Measurement ID** to increase. This resets metrics only: camera,
   landmarker history, ROI recovery, scheduler state and motion calibration stay live.
   A frame already processing when the button was pressed finishes in the old window.
5. Measure at least 30 seconds per scenario (prefer 60 for moving/occlusion).
   Choose a scenario before resetting, and do not change motion class mid-window.
6. Export JSON **before Stop tracking**; Stop clears the harness's displayed metrics.
7. Stop tracking; choose a different delegate or a single experimental preset.
   Start, warm up, reset and repeat the same scenario. Changing configuration
   intentionally rebuilds the pipeline; diagnostics rerenders do not.
8. Repeat A/B pairs in both AB and BA order, preferably three pairs per scenario.
   Start with GPU vs CPU on baseline; then test each scheduler/ROI feature separately.
9. Compare `bounded-pose-v1` with `pose-cached-hint-v1` to isolate cached hints. Cached
   hints alone often do nothing on full-rate because Pose is sampled every frame.
10. Try `combined-v1` only after individual tests. Do not assume benefits add up.
11. Send the paired JSON files and notes about hardware, lighting, observed motion
    quality and expected visible hands to the reviewer.

The exporter flags Worker fallback, missing measurement reset, paused renderer and
replay/freeze/recording/simulated loss as unsuitable for controlled comparison.
Its validity flag is only a configuration check; it is NOT proof of equivalent
capture cadence, sufficient warm-up, or good motion quality. Requested CPU with
GPU main-thread fallback is never a successful CPU Worker run. A fallback reason
remains visible even after measurement reset.

## What to compare

- Tracking publish, Face/Hands/Pose inference Hz, **accepted Hands observation Hz**,
  avatar apply and render FPS separately. Accepted includes valid empty detections:
  it measures accepted observations, not the count of hands found or matched.
- `timings.handsInferenceMs` is pure detection; legacy `inferenceTimeMs.hands` in
  Worker mode includes ROI/mapping. Do not compare those as the same quantity.
- Main inference, Worker wait/round-trip, bitmap preparation and total avg/p95.
  Worker wait overlaps neither already-finished main work nor the whole round-trip;
  do not add both round-trip and all model durations to estimate total work.
- Sample ages, Hand–Pose source skew and stale Hand drops. A faster publisher with
  older/less frequent Pose is not automatically an improvement.
- `observations.byInputMode`: full-frame/single/combined/split attempts, accepted
  results, detections, expected/covered Pose regions and preparation/inference/mapping.
  `attempts` counts completed inference calls (including empty/stale results), not
  requests that failed before returning a result; those appear in Worker errors/fallback.
- `observations.detectorLabelCoverage`: per-side tracked/observed counts and true
  observed loss/reacquire transitions, ignoring not-sampled and duplicate inputs.
  This is **detector-label coverage**, not persistent matched identity or labelled
  recall. Initial absence is not counted as a loss. A loss ongoing at the end has
  no completed reacquire duration; inspect loss/reacquire counts together.
- `hintStatus`, `roiReason`, confidence counts/switches, actual execution/delegate,
  sensitive-model availability and all experimental booleans/version.

FPS uses a rolling 10-second window; durations retain the last 600 samples per
metric/mode; counts accrue since Start/Reset. These windows differ. Do not average
snapshot p95s to manufacture an overall p95. The existing top-level `stateRatio`
and `lossEvents` describe publish-frame states; use observation metrics for new
Hand observation quality. Renderer metrics use their own unchanged window.

Source time is not relabelled: `frameTimestampMs` remains video media time;
`sampledAtMs` remains main-thread monotonic source acquisition time. Worker-local
durations do not require comparing Worker `performance.now()` with main time.
`applyPose` accepts a target; it is not a draw or sensor timestamp. No reported
timing establishes camera-sensor-to-visible-avatar latency below 100ms.

## Motion checklist (same actions for every configuration)

- One hand, then both; move left/right independently and rotate wrists.
- Cross both hands and separate; look for swapped identity or finger/wrist snaps.
- Hide one hand while the other remains visible, then uncover it several times.
- Move each hand out of the frame and back, both near and far from the camera.
- Fast hand motion, elbow occlusion, hand near face, reaching forward and sideways.
- Inspect shoulder continuity, elbow branch changes, wrist reconstruction, fingers,
  mouth, gaze and facial expressions. Unit tests cannot qualify these visually.
- Stop/restart the camera repeatedly, including during motion; check no stale pose
  from the prior camera session, duplicate loops or unreleased camera indicator.
- For `bounded-pose`, check age/skew p95 and reacquisition under fluctuating FPS;
  large recent processing times should force Pose sampling rather than more skips.

Reject an experimental setting if hand coverage, reacquire, identity, continuity,
or freshness worsens, even when publish FPS rises. Keep GPU/full-rate baseline
when improvement is inconsistent. No experiment is ready for production promotion
solely because its synthetic tests pass.

## Validation commands

```powershell
npm.cmd test -- src/lib/tracking src/components/dev/trackingPhaseB.test.tsx
npm.cmd run build
```

Synthetic Worker tests exercise the real Worker handler with mocked models/canvas.
DOM component tests use Happy DOM as a development-only dependency; they do not
validate WebGL, webcam, GPU execution, visual layout or camera permissions.
No connected browser was available during implementation, so actual browser UI,
GPU/CPU and webcam quality verification remain part of the trial above.
