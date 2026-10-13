# Camera cadence comparison (DEV)

Use one camera page at a time, with consistent lighting, visible preview and movement.
This compares browser video presentation cadence, not sensor capture timestamps.
The independent requestVideoFrameCallback subscription still shares the main thread.

1. `/dev/tracking`: Tasks = Camera only, 720p. This opens CameraController directly;
   no runtime initialization, bitmap capture, inference or renderer runs.
2. Stop, then Tasks = All three, Delegate = GPU, Hands Worker delegate = GPU,
   Tracking strategy = B2 Callback ahead, Profile = Full-rate, overlay OFF.
   Pose Full, parallel Hands, pose-guided Hands and adaptive confidence match
   the avatar harness. All three runs tracking without motion processing or rendering.
3. Stop, then `/dev/avatar-renderer`: same GPU/Callback ahead, Pose Full,
   parallel Hands / pose-guided Hands / adaptive confidence ON, renderer running.
   Freeze, simulated loss, recording and replay OFF.

For each run: Start, warm up 20–30 seconds, use **Reset camera measurement** in
**Đo camera / tracking / avatar**, measure 30 seconds, and click
**Xuất camera comparison JSON** before Stop. Use the same scenario each time.
Three exports suffice; there is no need to repeat seven strategies.

The JSON records the mode, camera dimensions/configured frame rate, environment,
independent video cadence and (except camera-only) pipeline metrics. FPS uses a
rolling 10-second window. Cadence reset is immediate; the pipeline resets at its
next accepted frame, so their boundaries differ slightly. Exports flag missing
reset, pending pipeline reset, unavailable cadence, worker fallback, hidden page,
or conflicting avatar states. Validity does not verify equal physical conditions.
No device ID or webcam images are exported.

The old Phase B export remains available. Use the new comparison export for all
three runs so the cadence measurement and report format match.
