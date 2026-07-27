# P4-T10 — Phase 3A Acceptance Report

> Phạm vi: anatomical arm-frame foundation  
> Trạng thái: **IMPLEMENTED — MANUAL BROWSER GATE PENDING**

## Contract

`AvatarPosePacketV1.jointRotations` vẫn là normalized-humanoid parent-local,
rest-relative delta. Renderer vẫn áp `restLocal × deltaLocal`; diagnostics không nằm trong
packet. `headRotation` giữ hành vi legacy/unverified và không thuộc arm acceptance.

## Implementation

- Inferred-elbow fallback dùng Pose shoulder + Pose wrist, human segment lengths được lấy median từ cửa sổ observed-only theo từng bên tay; không dùng avatar bone length và không học lại từ inferred pose.
- Two-bone inference có triangle reachability/slack gate, confidence decay, finite timeout và previous/rest bend prior. Nghiệm unreachable/expired chuyển về hold/return.
- Chuyển nguồn `observed ↔ inferred` đi qua temporal recovery blend; inferred elbow chỉ điều khiển arm swing/bend, không có quyền tạo palm/forearm twist.
- Partial-segment observation: wrist mất chỉ làm lower arm hold/return parent-local; upper swing vẫn cập nhật từ shoulder–elbow.
- Direction validity, pole validity và twist observability được báo riêng; pole suy biến không còn loại direction hợp lệ.
- Upper/lower có temporal channel riêng nhưng vẫn dùng shared arm continuity state.
- Secondary axis được parallel-transport theo primary mới; candidate mới được chọn dấu gần history để ngăn frame flip. Phase 3A bảo toàn axial twist, palm twist vẫn thuộc Phase 3B.
- Frozen `tracked` frame trùng pose timestamp được phát lại mà không làm arm loss state già đi; DEV replay-as-new tạo timestamp mới rõ ràng.
- Geometry/rejection diagnostics gần nhất được giữ qua `not-sampled`/`lost`; `sampleDisposition` tách trạng thái sample khỏi kết quả geometry.
- Torso semantic basis fallback theo `fresh → previous → rest` và diagnostics ghi rõ source khi camera bán thân không thấy hip.

- Torso basis từ shoulder/hip, chỉ làm semantic reference; không animate chest.
- Rig profile cache torso rest reference và anatomical primary/secondary/binormal frame.
- Three-point arm-frame dùng shoulder/elbow/wrist và elbow-offset pole.
- Enter/exit hysteresis; previous pole rồi rest-frame fallback khi near-straight.
- Per-side image-space bounds/visibility gate; sample bị reject không update direction/pole filter.
- Normalized elbow offset và depth alignment chọn fresh pole hay projected previous/rest pole.
- Pole angular-outlier gate có điều kiện và One Euro pole filter sau rejection.
- Invalid grace/recovery confirmation dùng thời gian, không phụ thuộc FPS.
- Full target frame được chuyển về parent-local/rest-relative theo hierarchy Phase 2.
- State trái/phải riêng phát hold, return về identity, idle identity và recovery blend thật.
- Swing–twist utility có round-trip/sign/near-180 tests; production limits để Phase 3C.

## Automated evidence

- Torso basis finite, orthonormal và right-handed.
- Fresh/previous/rest pole, zero segment và non-identity ancestor tests.
- Sáu preset Phase 2 đạt direction gate `≤3°` với constraints off.
- Hold → returning → idle → recovering timeline thay đổi quaternion thật.
- Packet vẫn plain-data; renderer absolute apply tests không đổi.

Full gate cuối:

```text
npm.cmd test -- --run                     → 25 files, 130/130 PASS
npm.cmd test -- --run <Phase-3A files>    → PASS
npm.cmd run lint                          → PASS
npm.cmd run build                         → PASS, 1,820 modules
git diff --check                          → PASS
```

## Manual/browser evidence

DEV route `/dev/avatar-renderer` trả HTTP 200; model tham chiếu trả HTTP 200, 18,900,420
bytes. Browser-control runtime không có browser khả dụng, vì vậy canvas/preset/webcam manual
gate chưa được chạy lại. Không tuyên bố Phase 3A PASS và không tạo commit acceptance.

## Deferred by scope

- Phase 3B: palm basis, Pose/Hand skew gate, wrist fusion và palm recovery.
- Phase 3C: production anatomical constraints, twist calibration, full browser/performance.
- Head retargeting semantic vẫn legacy/unverified.
