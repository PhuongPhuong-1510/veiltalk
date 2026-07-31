# P4-T10 — Phase 3A Acceptance Report

> Phạm vi: anatomical arm-frame foundation  
> Trạng thái: **IMPLEMENTED — MANUAL BROWSER GATE CHƯA ĐẠT ỔN ĐỊNH, ROOT CAUSE CÒN MỞ**
>
> ⚠️ **Tài liệu lịch sử.** Phần partial-segment occlusion (mục "Implementation" và mục 71) mô tả
> hành vi "upper/lower cùng hold/return" đã **bị thay thế** bởi bản sửa occlusion Phase 3B — hai đoạn nay nghiệm
> thu độc lập. Hành vi hiện hành: `docs/P4_T10_PHASE3B_PARTIAL_ARM_ACCEPTANCE_REPORT.md`.

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
- Secondary axis được parallel-transport theo primary mới. Khi pole unavailable, history continuity vẫn được giữ; palm/forearm twist vẫn thuộc Phase 3B.
- Fresh elbow/hand pole không còn điều khiển axial orientation của `upperArm`: Phase 3A dựng upper secondary từ minimal-twist rest frame đã parallel-transport theo torso + primary và gắn flag `upper-secondary-minimal-twist`. Vì vậy pole đối dấu 180° hoặc lệch 90° không còn làm vùng vai roll dù checkbox Constraints tắt. UpperArm vẫn swing đầy đủ theo hướng shoulder→elbow; upper-arm axial calibration/constraint được giữ cho Phase 3C.
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
- Regression hai bên khóa hai trường hợp upper direction đúng rest nhưng fresh pole đối dấu 180° hoặc lệch 90°: upperArm delta phải gần identity, không được axial roll.
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

Gate gần nhất sau bản sửa upperArm secondary branch ngày 2026-07-29:

```text
npm.cmd test                              → 36 files, 386/386 PASS
npm.cmd run lint                          → PASS
npm.cmd run build                         → PASS, 1,820 modules
```

## Manual/browser evidence

Ảnh webcam trước đó cho thấy vùng vai vẫn axial roll sau hemisphere-only fix: fresh pole lệch khoảng 90° vẫn điều khiển full upper frame. Regression thứ hai đã tái tạo đúng lỗ hổng `dot=0`; bản sửa sau đó chuyển upperArm sang minimal-twist swing-only trong Phase 3A và đã qua automated gate.

Sau khi re-test bản minimal-twist swing-only, người dùng vẫn quan sát thấy tay/vùng vai đôi lúc xoắn bất thường nhưng chưa tái hiện được theo một chuỗi động tác ổn định. Vì vậy:

Lần quan sát tiếp theo đã khóa được một trigger cụ thể: khi Pose wrist bị che/mất một phần, implementation cũ vẫn nhận upperArm mới nhưng giữ lowerArm cũ. RED regression tái hiện đúng `{upper: active, lower: held}` ở cả hai bên. Bản sửa hiện tại chỉ nhận nghiệm khi cả chain upper/lower hợp lệ, cho hai segment cùng hold/return, yêu cầu 80 ms hợp lệ liên tục rồi recovery blend đồng thời. Automated gate mới đạt 386/386; webcam re-test cho chính chuỗi che/mở tay này vẫn chưa thực hiện.

- Hai regression 180° và 90° chứng minh và khóa hai lỗi toán học cụ thể đã tìm thấy; chúng chỉ là các nguyên nhân đóng góp đã biết, không phải bằng chứng rằng root cause cuối cùng của lỗi webcam đã được xử lý hết.
- Automated gate 386/386 chỉ chứng minh các invariant và tình huống synthetic hiện có; không thay thế manual browser gate.
- Phase 3A chưa PASS, chưa được tạo commit acceptance và không được mô tả bản sửa hiện tại là xử lý dứt điểm lỗi xoắn runtime.

## Điều tra còn mở

Các mục dưới đây là **giả thuyết cần dữ liệu**, chưa phải kết luận nguyên nhân:

- Parallel transport từ history có thể tích lũy axial roll theo đường chuyển động (holonomy), nhất là khi fresh pole không dùng được trong nhiều frame.
- Việc chuyển nguồn giữa minimal-twist rest frame và history continuity có thể tạo nhánh orientation không liên tục.
- `Quaternion.setFromUnitVectors()` có thể mơ hồ khi primary direction tiến gần hướng đối nhau.
- Chuyển nguồn torso semantic basis giữa `fresh → previous → rest` có thể thay đổi reference frame đột ngột.
- Rest basis, skin weight của VRM hoặc ảnh hưởng hình học từ lowerArm có thể làm vùng vai trông xoắn dù quaternion upperArm không vượt invariant hiện có.

Bước chẩn đoán tiếp theo được đề xuất, **chưa triển khai**, là bộ ghi bất thường local-only:

- Giữ ring buffer khoảng 2–3 giây và tự kích hoạt khi upper-arm axial twist hoặc quaternion delta vượt ngưỡng.
- Ghi primary/secondary upper frame, axial twist, nguồn branch/pole/torso, trạng thái reacquire, angular delta, `sampleDisposition` và `dt` quanh sự kiện.
- Chỉ xuất JSON diagnostics theo yêu cầu; không upload, không lưu raw frame/ảnh khuôn mặt và không thay đổi privacy contract.

Không tiếp tục sửa công thức chuyển động theo các giả thuyết trên trước khi có capture tái hiện sự kiện.

## Deferred by scope

- Phase 3B: palm basis, Pose/Hand skew gate, wrist fusion và palm recovery.
- Phase 3C: production anatomical constraints, twist calibration, full browser/performance.
- Head retargeting semantic vẫn legacy/unverified.
