# P4-T10 — Phase 1 Retargeting Diagnostics Report

**Dự án:** VeilTalk  
**Task:** P4-T10 — Three.js Avatar Renderer  
**Phạm vi:** Phase 1 — Prove Root Cause  
**Trạng thái:** Hoàn thành chẩn đoán; chưa triển khai Phase 2  
**Ngày hoàn tất:** 27/07/2026

## 1. Mục tiêu và phạm vi

Phase 1 được thực hiện để thu thập bằng chứng định lượng cho các giả thuyết gây hiện tượng vai, cánh tay, khuỷu và cổ tay avatar bị xoắn/gập không tự nhiên.

Phase này chỉ bổ sung instrumentation và test DEV-only. Không thực hiện:

- thay production joint solver;
- parent-local solver mới;
- two-bone IK, elbow pole hoặc swing–twist;
- Pose/Hand fusion;
- thay model, dependency, constraint hoặc filter production;
- thay contract `RawTrackingFrameV1`;
- commit hoặc đánh dấu P4-T10 hoàn thành.

## 2. Executive diagnosis

Hai nguyên nhân chính đã được xác nhận:

1. **H1 — Critical:** solver tạo quaternion từ direction mang tính world/semantic nhưng renderer gán quaternion đó trực tiếp như local bone rotation. Sai số tăng mạnh khi parent bone rời rest pose.
2. **H2 — Critical:** solver dùng một vector cho mỗi đoạn xương nên không thể xác định twist quanh trục xương.

Hai giả thuyết đã bị bác bỏ đối với model và webcam kiểm thử:

3. **H3 — Rejected:** hard-coded normalized rest axes `left +X`, `right -X` khớp normalized skeleton của model tham chiếu.
4. **H6 — Rejected:** conversion hiện tại `(x,y,z) → (x,-y,-z)` cho đúng semantic X/Y/Z trên các frozen frame webcam thật.

Kết luận: lỗi chính nằm ở kiến trúc retargeting, không phải model, mirror webcam hay coordinate conversion production hiện tại.

## 3. Pipeline được kiểm tra

```text
MediaPipe Tasks result
→ RawTrackingFrameV1
→ AvatarMotionProcessor
→ solvePoseJointRotations()
→ AvatarPosePacketV1
→ AvatarRenderer.applyPose()
→ normalized VRM humanoid bones
→ vrm.update(delta)
→ WebGLRenderer.render()
```

Tracking và render chạy local trong browser. Webcam preview bị mirror bằng CSS; frame đưa vào MediaPipe không bị mirror.

## 4. Instrumentation Phase 1

Route DEV `/dev/avatar-renderer` được bổ sung:

- normalized node name/UUID và parent;
- normalized rest local/world transforms;
- normalized rest direction, hard-coded direction, dot product và angular difference;
- root transform sau VRM0 rotation;
- tracked direction trước/sau conversion;
- solver, parent-world, target-local và applied-local quaternion;
- resulting child world direction và angular error;
- shoulder–elbow–wrist plane normal;
- axes và rest/tracked/result direction helpers;
- freeze/replay raw frame trong memory;
- freeze tự động sau 5 giây;
- deterministic pose presets;
- conversion selector;
- filter/constraint/smoothing isolation toggles.

Chế độ đo nền:

```text
solver on
filter off
constraints off
smoothing off
frozen frame
```

## 5. Model và normalized rest basis

Model được kiểm tra: `frontend/public/models/avatars/reference-avatar.vrm`.

| Thuộc tính | Kết quả |
|---|---|
| Format | VRM |
| VRM version | 0.x |
| Humanoid rig | Có |
| Rest pose | T-pose |
| Forward axis sau normalization | `-Z` |
| Root position | `(0,0,0)` |
| Root quaternion | xấp xỉ `(0,1,0,0)` |
| Root scale | `(1,1,1)` |
| Required arm bones | Đầy đủ |

### Normalized rest-basis table

| Bone | Normalized world rest direction | Hard-coded | Dot | Sai lệch |
|---|---:|---:|---:|---:|
| leftUpperArm | `(1,0,≈0)` | `(+1,0,0)` | `1.000000` | `≈0.000001°` |
| leftLowerArm | `(0.999998,0.000011,0.001751)` | `(+1,0,0)` | `0.999998` | `0.10034°` |
| rightUpperArm | `(-1,0,≈0)` | `(-1,0,0)` | `1.000000` | `≈0.000001°` |
| rightLowerArm | `(-0.999998,0.000011,0.001751)` | `(-1,0,0)` | `0.999998` | `0.10034°` |

Kết luận H3: hard-coded axes khớp normalized rest basis của model tham chiếu. Dấu raw child offset khác normalized world direction do VRM0 root rotation và không phải bằng chứng mapping sai.

## 6. H1 — World-like rotation được dùng như local rotation

Production solver hiện có dạng:

```text
d_tracked = normalize(convert(to - from))
q_solver = quatFromUnitVectors(d_rest_hardcoded, d_tracked)
q_applied_local = q_rest_local × q_solver
```

Không có phép chuyển target world orientation qua nghịch đảo rotation của parent.

### Angular error trên model thật và deterministic presets

Filter, constraints và smoothing đều tắt.

| Pose | Left upper | Left lower | Right upper | Right lower |
|---|---:|---:|---:|---:|
| T-pose | `≈0°` | `0.10°` | `≈0°` | `0.10°` |
| Arms down | `180°` | `90.00°` | `180°` | `90.00°` |
| Left arm up | `180°` | `90.00°` | `≈0°` | `0.10°` |
| Right arm up | `≈0°` | `0.10°` | `180°` | `90.00°` |
| Left elbow 90° | `≈0°` | `179.90°` | `≈0°` | `0.10°` |
| Right elbow 90° | `≈0°` | `0.10°` | `≈0°` | `179.90°` |

Sai số gần bằng 0 tại rest pose nhưng tăng tới 90–180° khi parent hoặc elbow rời rest pose.

**Kết luận H1: Confirmed — Critical.**

## 7. H2 — One-vector solver không xác định twist

Hai debug input được tạo với:

- cùng direction `shoulder → elbow`;
- khác direction `elbow → wrist` và bend plane.

Kết quả:

```text
leftUpperArmQuaternion(input A)
=== leftUpperArmQuaternion(input B)
```

Một direction chỉ xác định swing, không xác định rotation quanh chính trục xương. Solver không có elbow pole, palm normal, swing–twist decomposition hoặc previous-frame twist reference.

**Kết luận H2: Confirmed — Critical.**

## 8. H6 — Webcam coordinate conversion

Các conversion được đánh giá:

1. Current: `(x,y,z) → (x,-y,-z)`.
2. None: không đảo trục.
3. Only Y: `(x,-y,z)`.
4. Only Z: `(x,y,-z)`.

Việc kết luận dựa trên raw frozen landmarks và semantic direction, không dựa vào avatar trông đẹp/xấu hoặc chỉ dựa vào angular error.

### Pose A — T-pose

Frozen sample `#3`, raw timestamp `50977`. Visibility của shoulder/elbow/wrist từ `0.899` trở lên.

| Quan sát | Kết quả |
|---|---|
| Left upper X | `+0.2228` |
| Right upper X | `-0.1924` |
| Handedness | Đúng |
| Mirror ảnh hưởng semantic contract | Không |

### Pose B — Left arm up

Frozen sample `#6`, raw timestamp `410939`.

```text
Left shoulder → wrist raw:
X = +0.135653
Y = -0.150055
Z = -0.267724
```

Tay thực hướng lên nhưng raw Y âm. Semantic avatar dùng hướng lên là `+Y`, do đó Y phải đảo dấu.

### Pose E1 — Left arm forward

Frozen sample `#7`, raw timestamp `456236`. Tất cả shoulder/elbow/wrist visibility từ `0.938` trở lên.

```text
Left shoulder → wrist raw:
X = +0.050999
Y = +0.161793
Z = -0.277290
```

Tay thực hướng về webcam nhưng raw Z âm. Camera nằm phía `+Z` của avatar, do đó Z phải đảo dấu để semantic target hướng về camera.

### So sánh conversion

| Conversion | X/handedness | Y khi giơ tay | Z khi hướng camera | Kết quả |
|---|---|---|---|---|
| Current `(-Y,-Z)` | Đúng | Đúng | Đúng | **Đạt** |
| None | Đúng | Sai | Sai | Loại |
| Only Y | Đúng | Đúng | Sai | Loại |
| Only Z | Đúng | Sai | Đúng | Loại |

**Kết luận H6: Rejected.** Conversion production hiện tại là phù hợp:

```text
(x,y,z) → (x,-y,-z)
```

## 9. Deterministic replay và lifecycle

- Frozen mode bỏ qua tracking frame mới.
- Raw frozen frame chỉ được clone và giữ trong memory.
- Replay cùng frame cho cùng joint rotation output.
- rAF loop có guard chống start trùng.
- `stop()` hủy đúng frame đang sở hữu.
- Helpers/axes được remove và dispose khi tắt, reload hoặc unmount.
- Không có duplicate renderer ownership sau React Strict Mode cleanup.

## 10. Filter, constraint và smoothing isolation

- One Euro Filter áp trên vector components, không áp độc lập lên quaternion components.
- Renderer smoothing dùng normalized quaternion slerp và frame-rate-independent damping.
- Khi Filter/Constraints/Smoothing đều off, lỗi H1/H2 vẫn xuất hiện.
- Vì vậy filter hoặc smoothing không phải nguyên nhân gốc và không thể sửa coordinate/local-space error.
- Dao động nhỏ ở LIVE mode là dự kiến khi các lớp ổn định đều tắt; FROZEN mode phải đứng yên.

## 11. Test, lint và build

Kết quả cuối Phase 1:

```text
Test files: 19 passed
Tests:      88 passed
Lint:       PASS
Build:      PASS
```

Automated tests bao gồm:

- rest direction extraction;
- world direction và angular error;
- conversion variants;
- deterministic preset/replay;
- H2 one-vector limitation;
- helper cleanup;
- duplicate rAF prevention;
- production build exclusion.

Production bundle không chứa route hoặc nội dung của retargeting diagnostics.

## 12. Privacy evidence

- Diagnostics chỉ tồn tại trong DEV route.
- Không upload hoặc tạo network request mới.
- Không capture ảnh/video.
- Không ghi raw frame ra disk.
- Không log raw landmarks liên tục vào console.
- UI realtime được throttle.
- Chỉ sáu landmark shoulder/elbow/wrist cần thiết được hiển thị.
- Tracking, frozen frame và rendering tồn tại local trong browser.

## 13. Root causes sau Phase 1

| Mức độ | Giả thuyết | Kết luận |
|---|---|---|
| Critical | H1 — world-like quaternion gán vào local bone | Confirmed |
| Critical | H2 — one-vector solver không xác định twist | Confirmed |
| Low với model hiện tại | H3 — normalized rest axes sai | Rejected |
| Low | H6 — coordinate conversion production sai | Rejected |
| High, chưa sửa | Wrist không dùng palm orientation | Giữ cho phase sau |
| High, chưa sửa | Loss state chưa tạo return pose thực | Ngoài Phase 1 |

## 14. Proposed Phase 2 design — chưa triển khai

Phase 2 đề xuất giữ:

- conversion `(x,-y,-z)`;
- normalized VRM bones;
- mapping trái/phải hiện tại;
- model tham chiếu hiện tại.

Nền toán học đề xuất:

```text
d_target_world = normalize(convert(tracked segment))

q_target_world =
  q_swing_world
  × q_rest_world

q_target_local =
  inverse(q_parent_target_world)
  × q_target_world

q_delta_local =
  inverse(q_rest_local)
  × q_target_local

q_applied_local =
  q_rest_local
  × q_delta_local
```

Hierarchy phải được giải theo thứ tự parent → child trong cùng target pose, không dùng current parent tạo feedback loop.

Two-bone IK, elbow pole, swing–twist và Pose/Hand palm fusion phải được xem là các bước riêng sau khi nền parent-local/rest-relative được chứng minh đúng.

## 15. Kết luận và trạng thái

Phase 1 đã hoàn thành mục tiêu chứng minh nguyên nhân:

- H1 và H2 được xác nhận bằng code audit, deterministic presets và angular measurement.
- H3 bị bác bỏ bằng normalized rest basis của model thật.
- H6 bị bác bỏ bằng frozen webcam evidence cho T-pose, tay trái giơ lên và tay trái hướng camera.
- Instrumentation deterministic, local-only và không xuất hiện trong production bundle.

P4-T10 vẫn **IN PROGRESS**. Chưa được bắt đầu Phase 2 cho tới khi thiết kế parent-local/rest-relative được phê duyệt.

