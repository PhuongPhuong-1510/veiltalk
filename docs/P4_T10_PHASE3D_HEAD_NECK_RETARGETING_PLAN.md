# P4-T10 Phase 3D — Head & Neck Retargeting

## 1. Trạng thái và quyết định phạm vi

**Trạng thái:** COMPLETE — automated 105/105 và manual acceptance được người dùng xác nhận 2026-07-30.

Phase 3D thay thế đường `headRotation` legacy/unverified bằng contract camera/model rõ ràng,
neutral-relative, parent-local và rest-relative; sau đó phân phối chuyển động giữa `neck` và `head`.

Phạm vi gồm quay trái/phải, gật/cúi/ngửa, nghiêng đầu, calibration trung tính, gain/dead-zone,
constraints, temporal filtering, loss/recovery, diagnostics và nghiệm thu nhiều model.

Không thuộc 3D:

- Xoay/nghiêng/cúi thân và phân phối `hips/spine/chest/upperChest` — phải mở phase riêng.
- Sửa Hand twist Phase 3B, finger orientation hoặc arm collision.
- WebRTC/jitter buffer và đồng bộ phía nhận.
- Thay đổi database/API hoặc thêm thư viện.

Ảnh webcam, facial transform và landmarks chỉ được xử lý local; packet chỉ chứa quaternion semantic
đã xử lý, không chứa matrix/landmark/ảnh thô.

## 2. Root cause đã xác nhận từ code hiện tại

- `AvatarMotionProcessor` lấy trực tiếp quaternion từ MediaPipe facial transform.
- `AvatarRenderer` coi quaternion đó là `head` parent-local/rest-relative delta dù contract chưa được
  kiểm chứng.
- Toàn bộ rotation dồn vào `head`; `neck` đã load nhưng không nhận target.
- Không có neutral orientation calibration, gain curve hoặc constraints theo yaw/pitch/roll.
- Face loss trả `headRotation = null`; renderer bỏ qua target nên head có thể kẹt ở pose cuối.
- Reacquire áp target mới trực tiếp; chưa có confirmation/recovery blend cho head/neck.
- Chưa có test khóa trục, dấu, biên độ, hierarchy và multi-model rest rotation.

## 3. Contract đích

```text
MediaPipe facial transform (camera space)
  → verified coordinate adapter
  → neutral-relative orientation
  → yaw / pitch / roll semantic
  → dead-zone + per-axis gain curve
  → anatomical constraints
  → magnitude-aware head/neck distribution
  → per-axis temporal filter
  → loss / recovery state machine
  → parent-local, rest-relative neck/head deltas
  → AvatarPosePacketV1
  → restLocal × deltaLocal tại renderer
```

Invariants:

- Không gán camera/world quaternion trực tiếp vào local bone.
- Không ghi bone position/scale.
- Mỗi sample timestamp chỉ cập nhật filter một lần; duplicate/not-sampled không bơm filter.
- Quaternion luôn finite, normalized và hemisphere-continuous.
- `neck` là parent của `head`; solver phải tính child trong target hierarchy, không dựa vào animated
  renderer state.
- Tổng head+neck phản ánh đúng chiều động tác người dùng và không vượt giới hạn đã định nghĩa.

## 4. Kế hoạch triển khai theo thứ tự

### 3D-01 — Diagnostics và frozen evidence

**Trạng thái:** COMPLETE — AUTOMATED + MANUAL PASS (2026-07-30).

- Hiển thị raw facial quaternion/matrix-derived yaw-pitch-roll, neutral-relative target, filtered
  target, distributed neck/head và rendered local/world rotations.
- Thêm frozen presets: neutral, yaw ±15/35/60°, pitch ±10/25/40°, roll ±10/25°.
- Đo angular error, sign, amplitude ratio và latency từng tầng.
- Raw diagnostics DEV-only, không đi vào packet.

**Gate:** xác định được biên độ bị mất hoặc sai tại input, conversion, calibration, distribution,
filter hay renderer; frozen replay deterministic.

Evidence hiện có: DEV harness hiển thị raw quaternion/Euler, neutral, neutral-relative target và lý do
reject; có preset neutral, yaw ±15/35/60°, pitch ±10/25/40° và roll ±10/25°. Raw diagnostics vẫn
local-only và không đi vào packet.

### 3D-02 — Coordinate contract và neutral calibration

**Trạng thái:** COMPLETE — AUTOMATED + MANUAL PASS (2026-07-30).

- Xác minh storage order của MediaPipe matrix và camera axes bằng synthetic matrices + webcam.
- Chuyển orientation sang motion frame đúng một lần.
- Calibration có chủ đích lưu neutral orientation; output là `inverse(neutral) × current` theo
  convention đã test.
- Reject calibration khi mặt chuyển động nhanh, matrix invalid hoặc tracking không ổn định.
- Reset theo lifecycle; không tự học lại neutral âm thầm.

**Gate:** neutral gần identity; yaw/pitch/roll đúng dấu ở cả hai phía; camera/model rest offset không
đi vào chuyển động.

Implementation: `headOrientation.ts` sở hữu contract matrix column-major và conversion một lần qua
`coordinateAdapter`; Face Calibration có chủ đích đồng thời lưu `headNeutralRotation`; packet chỉ phát
`inverse(neutral) × current`, còn trước khi profile ready trả `null` với diagnostic
`neutral-unavailable`. Không tự neo neutral từ live frame đầu tiên.

Quyết định DEV UI 2026-07-30: các panel điều khiển/capability Phase 3C đã gỡ sau manual PASS. Chỉ giữ
một dòng `Start Face Calibration` + trạng thái vì neutral profile vẫn là dependency trực tiếp của 3D-02;
logic runtime Phase 3C không bị xóa.

DEV harness cũng ẩn các control/preset chỉ phục vụ Phase 3A/3B đã PASS (Hand twist, hand neutral,
arm frozen presets, Hand Calibration, conversion/pose-model experiments) và các control trùng lặp
(sample name, freeze countdown, simulate-all). Phase 3D giữ freeze/replay, filter/constraints/smoothing,
Face loss, framing, head presets và Face Calibration.

Các panel kết quả Phase 3A/3B (`H1/H6 angular evidence`, arm `Normalized rest basis`) cũng đã gỡ.
Evidence được thu gọn về timestamp/mode Phase 3D, capability chỉ báo model/head/neck, và diagnostic chỉ
hiển thị `motionDiagnostics.head`; Realtime + Tracking state được giữ cho gate latency/loss-recovery.

### 3D-03 — Semantic yaw/pitch/roll và response curve

**Trạng thái:** COMPLETE — AUTOMATED + MANUAL PASS (2026-07-30).

- Tách semantic yaw, pitch, roll theo thứ tự/convention đã khóa bằng test, không dùng Euler tùy tiện.
- Dead-zone nhỏ loại jitter neutral.
- Gain riêng từng trục và response curve liên tục: chuyển động nhỏ chính xác, chuyển động lớn đủ
  biên độ nhưng không nhảy.
- Clamp invalid/NaN/spike trước temporal state.

**Gate:** quay, gật và nghiêng phân biệt; không đảo dấu; output tăng đơn điệu theo input và không có
vách ngưỡng.

Implementation dùng Euler semantic order `YXZ` đã khóa từ 3D-02, dead-zone liên tục và curve riêng:
yaw dead-zone 1.5°/gain 1.35, pitch 1.5°/1.35, roll 2°/1.2; large-motion boost tăng dần theo bình
phương normalized magnitude. Safety input/output clamp chỉ chống invalid/spike; anatomical per-bone
constraints vẫn thuộc 3D-05. Diagnostics ghi response input/output Euler và clamp flag.

Targeted automated evidence 3D-03: `headOrientation.test.ts` + `avatarMotionProcessor.test.ts` —
68/68 PASS; TypeScript và lint các file liên quan PASS. Webcam phát hiện pitch camera/avatar bị đảo
ngày 2026-07-30; đã sửa tại semantic composition, khóa regression cho cả up/down và manual retest PASS.

### 3D-04 — Phân phối rotation giữa neck và head

**Trạng thái:** COMPLETE — AUTOMATED + MANUAL PASS (2026-07-30).

- Quay nhẹ: chủ yếu `head`, `neck` tham gia ít.
- Quay lớn: tăng dần tỷ lệ `neck`, không đổi mode đột ngột.
- Phân phối riêng theo yaw/pitch/roll; tổng target không double rotation.
- Tính parent-local/rest-relative theo hierarchy neck → head của rig hiện tại.
- Model thiếu neck phải báo capability/fallback rõ ràng; không silent no-op.

Giá trị khởi đầu để tuning, chưa phải acceptance cuối:

| Trục | Nhẹ — head/neck | Lớn — head/neck |
|---|---:|---:|
| Yaw | 75% / 25% | 50% / 50% |
| Pitch | 70% / 30% | 50% / 50% |
| Roll | 75% / 25% | 55% / 45% |

**Gate:** không dồn toàn bộ vào một bone; tổng rotation đúng target; distribution liên tục và ổn
định trên nhiều rest pose.

#### Kế hoạch triển khai chi tiết

1. **Khóa output contract**
   - Giữ field `headRotation` của packet V1 nhưng đổi payload thành **head share** đã phân bổ; semantic
     tổng chỉ tồn tại trong processor diagnostics, không được renderer áp thêm.
   - Phát `jointRotations.neck` là neck share; cả hai đều theo parent-local/rest-relative contract.
   - Chỉ có một owner áp rotation cho mỗi bone; không để legacy head path cộng thêm lần hai.

2. **Tách semantic theo từng trục**
   - Nhận Euler yaw/pitch/roll sau response curve 3D-03.
   - Tính magnitude/progress riêng từng trục; không dùng một độ lớn tổng khiến yaw làm thay đổi tỷ lệ pitch.
   - Preserve sign và recomposition theo order `YXZ` đã khóa.

3. **Curve phân bổ liên tục**
   - Vùng nhẹ dùng tỷ lệ khởi đầu yaw 75% head + 25% neck, pitch 70% + 30%; roll được retune sau
     manual 3E thành 85% head + 15% neck để giảm cảm giác cổ bị bẻ.
   - Khi magnitude tăng, nội suy smoothstep đến yaw/pitch 50% + 50%; roll đạt 70% head + 30% neck.
   - Không có `if small/large` đổi mode đột ngột; tổng tỷ lệ mỗi trục luôn bằng 1.

4. **Hierarchy-safe composition**
   - `neck` nhận delta local của nó trước; `head` nhận residual delta local trong parent neck target.
   - Test tổng world orientation tương đương semantic target trong tolerance, kể cả restLocal khác identity.
   - Không ghi position/scale và không lấy animated renderer state làm input solver.

5. **Capability và fallback**
   - Model có cả head+neck: dùng distributed mode.
   - Model có head nhưng thiếu neck: head nhận 100%, diagnostics báo `head-only-fallback`.
   - Model thiếu head: reject rõ ràng, không phát target giả hoặc silent no-op.

6. **Diagnostics DEV-only**
   - Hiển thị mode, magnitude/progress từng trục, tỷ lệ head/neck, semantic tổng và hai delta output.
   - Capability panel báo `distributed`, `head-only-fallback` hoặc `unsupported`.

7. **Targeted automated tests**
   - Neutral, dấu hai phía và tổng tỷ lệ bằng 1.
   - Nhẹ/lớn đúng tỷ lệ; curve đơn điệu/liên tục quanh mọi mốc.
   - Recomposition không double rotation.
   - Rest rotation khác identity, model thiếu neck và model thiếu head.
   - Processor packet + renderer ownership; chỉ chạy file liên quan.

8. **Manual webcam acceptance**
   - Quay nhẹ/lớn trái-phải, cúi-ngẩng nhẹ/lớn, nghiêng hai phía.
   - Cổ phải tham gia thấy được ở động tác lớn; động tác nhỏ vẫn linh hoạt ở đầu.
   - Không tăng tổng biên độ ngoài target 3D-03, không giật khi đi từ nhẹ sang lớn.
   - Reload ít nhất hai model có neck; nếu có model thiếu neck thì xác nhận fallback vẫn chuyển động.

Implementation evidence: `headNeckDistribution.ts` phân bổ từng trục bằng smoothstep và tính head
residual để `neck × head == total`; rig profile phát capability head/neck, packet dùng
`jointRotations.neck` + `headRotation`, renderer giữ một owner mỗi bone. Năm file targeted — 82/82
PASS; TypeScript và lint các file liên quan PASS.

Manual tuning 2026-07-30: người dùng nhận xét neck share ban đầu khó quan sát; tăng neck từ
15–20%/35–40% lên 25–30% ở chuyển động nhẹ và 45–50% ở chuyển động lớn. Hai file liên quan 65/65
PASS sau tuning; tổng target không đổi. Người dùng xác nhận manual PASS sau tuning.

### 3D-05 — Constraints và temporal filtering

**Trạng thái:** COMPLETE — AUTOMATED + MANUAL PASS (2026-07-30).

- Giới hạn yaw/pitch/roll riêng cho head và neck; pitch lên/xuống có thể bất đối xứng.
- Filter theo sample timestamp, không theo render FPS; tuning riêng yaw/pitch/roll.
- Giữ responsiveness dưới 100 ms trong chuyển động bình thường; spike bị giới hạn theo angular
  velocity nhưng không làm mất biên độ pose giữ ổn định.
- Renderer không smooth lần hai khi processor đã sở hữu temporal output.

Ngưỡng khởi đầu để test: head yaw ±45°, neck yaw ±25°; head pitch xuống/lên 30°/25°, neck 15°/10°;
head roll ±20°, neck roll ±10°.

**Gate:** không jitter neutral, không vượt constraint, không double-smoothing và không giảm biên độ
pose giữ lâu.

Implementation: `headTemporal.ts` clamp semantic tổng yaw ±70°, pitch up +35°/down -45°, roll ±36°;
One Euro riêng yaw/pitch/roll theo face `sampledAtMs`, duplicate timestamp giữ exact output và pose giữ
ổn định hội tụ đủ biên độ. Renderer xác định head/neck là processor-timed nên không quaternion-smooth
lần hai. DEV harness bật Filter + Constraints mặc định để khớp production. Bốn file targeted — 71/71
PASS; TypeScript/lint PASS.

Manual webcam constraints, timestamp smoothing, held amplitude và no-double-smoothing được người dùng
xác nhận PASS ngày 2026-07-30.

### 3D-06 — Loss, recovery và lifecycle

**Trạng thái:** COMPLETE — AUTOMATED + MANUAL PASS (2026-07-30).

- Loss ngắn giữ exact neck/head output cuối.
- Loss dài easing cả hai bone về identity/neutral.
- Reacquire cần sample confirmation rồi recovery blend; không snap.
- Duplicate/not-sampled giữ state đúng; timestamp regression, reset, dispose, model reload và tracking
  restart xóa temporal state đúng một lần.
- Không dùng expression loss state để suy ngầm head state; có diagnostics rõ ràng nhưng timing có thể
  dùng chung policy đã kiểm chứng.

**Gate:** che/mở mặt không kẹt head, không snap và không reset lặp mỗi frame.

#### Kế hoạch triển khai chi tiết

1. **State machine và ownership**
   - Tạo state riêng: `idle → active → held → returning → confirming → recovering → active`.
   - State machine sở hữu semantic Euler cuối sau 3D-05 và trước 3D-04 distribution.
   - 3D-05 chỉ lọc target từ sample mới; 3D-06 quyết định output nào được phân bổ/render.
   - Không đọc state nội bộ của `FaceExpressionLossProcessor`; chỉ dùng cùng policy timing đã kiểm chứng.

2. **Phân loại input**
   - `new-sample`: face tracked, timestamp hợp lệ và lớn hơn sample đã consume.
   - `duplicate`: timestamp bằng sample cuối; giữ exact output, không tăng confirmation/filter.
   - `not-sampled`: pipeline chưa chạy Face ở frame này; giữ state, không tính là loss.
   - `lost/invalid`: Face đã sample nhưng không có transform hợp lệ; bắt đầu/tiếp tục loss epoch.
   - Timestamp regression: lifecycle discontinuity, reset một lần rồi chờ sample mới.

3. **Loss ngắn — exact hold**
   - Mốc khởi đầu: giữ exact output cuối trong `250 ms`.
   - `head` và `neck` giữ cùng semantic total snapshot rồi distribution lại deterministic; không drift.
   - Frame duplicate/not-sampled không tự làm loss duration tăng từ sample timestamp giả.

4. **Loss dài — return neutral**
   - Sau hold, easing semantic yaw/pitch/roll về zero trong `500 ms` bằng smoothstep theo elapsed time.
   - Return bắt đầu từ exact held snapshot, không từ raw/filter state đang thay đổi.
   - Khi đạt zero chuyển `idle`; head/neck packet tiếp tục phát identity đủ để xóa target stale.

5. **Reacquire confirmation và recovery**
   - Cần `2` sample mới liên tiếp, timestamp tăng, transform hợp lệ trước khi nhận target trở lại.
   - Trong `confirming`, output vẫn giữ pose loss/return hiện tại; sample reject không tạo snap.
   - Khi đủ confirmation, blend từ output đang render tới target mới trong `180 ms` bằng smoothstep.
   - Filter 3D-05 được reset/seed tại boundary recovery đúng một lần để không kéo history trước loss.

6. **Interruption rules**
   - Mất lại trong `confirming/recovering`: bắt đầu loss epoch mới từ output hiện tại, không từ target.
   - Reacquire trong lúc `held/returning/idle` đều đi qua confirmation; không bypass vì loss ngắn.
   - Pose/expression/hand tracking tiếp tục độc lập; Simulate Face loss không được làm tay mất.

7. **Lifecycle reset**
   - `processor.reset`, `dispose`, model/rig change, tracking restart và timestamp regression xóa head
     temporal + loss state đúng một lần.
   - Face Calibration start/cancel/reset xóa head temporal/loss output; profile mới không blend với neutral cũ.
   - Diagnostics có `lossEpochId` và `resetReason` để phát hiện reset lặp mỗi frame.

8. **Diagnostics DEV-only**
   - Hiển thị state, input classification, loss duration, held snapshot, return/recovery progress,
     confirmation count, epoch id, reset reason và semantic output cuối.
   - Không đưa raw transform, diagnostics hoặc state machine metadata vào packet.

9. **Targeted automated tests**
   - Exact hold trước/sau mốc 250 ms; return monotonic và identity tại 750 ms.
   - Duplicate/not-sampled không advance filter/confirmation; timestamp regression reset một lần.
   - Hai sample confirmation; recovery không snap, monotonic và đạt target tại 180 ms.
   - Loss lại giữa confirming/recovering; reset/dispose/rig/calibration lifecycle.
   - Packet identity xóa stale head/neck; Simulate Face loss không làm arm packet đổi ownership.

10. **Manual webcam acceptance**
    - Che mặt nhanh rồi mở: pose giữ ngắn, không snap khi trở lại.
    - Che lâu: head/neck về neutral mượt, không kẹt pose cuối.
    - Mở mặt khi đang returning và sau idle: đều confirming rồi recovery mượt.
    - Che/mở liên tục; quay đầu sang góc khác trước khi mở; ánh sáng yếu/transform chập chờn.
    - Quan sát tay vẫn tracking khi chỉ bật `Simulate Face loss`; reload model/tracking restart không giữ stale pose.

Implementation: `headLossRecovery.ts` sở hữu semantic output sau temporal và trước distribution; exact
hold 250 ms, smooth return 500 ms, hai sample confirmation, recovery 180 ms, duplicate/not-sampled
hold, interrupted recovery và timestamp regression reset. Identity vẫn được phát để xóa stale target.
Bốn file targeted — 71/71 PASS; TypeScript/lint PASS.

Manual Face-only loss, exact hold, return neutral, recovery, repeated loss và arm independence được
người dùng xác nhận PASS ngày 2026-07-30.

### 3D-07 — Integration, hierarchy và arm invariants

**Trạng thái:** COMPLETE — AUTOMATED + MANUAL PASS (2026-07-30).

- Mở rộng rig profile/rest capture cho `neck` và `head` đủ dữ liệu parent-local.
- Packet phát verified head + neck delta; xóa nhãn legacy sau khi gate contract đạt.
- Renderer áp đúng `restLocal × deltaLocal` và reset stale targets.
- Kiểm tra arm world direction không sai khi neck/head chuyển động; Phase 3D không animate chest nên
  không được thay đổi arm solver output.
- Chạy trên các VRM hiện có; model thiếu bone/cấu trúc lạ báo capability rõ ràng.

**Gate:** hierarchy đúng trên model có rest rotation khác identity; tay không regression; privacy packet
giữ nguyên.

#### Kế hoạch triển khai chi tiết 3D-07

1. Audit packet ownership: `headRotation` chỉ là head share, `jointRotations.neck` chỉ là neck share;
   renderer không còn đường legacy hoặc target stale cạnh tranh.
2. Khóa rest-relative apply bằng synthetic hierarchy `chest → neck → head`, gồm rest quaternion khác
   identity; kiểm tra local/world result và không ghi position/scale.
3. Kiểm tra capability ba mode: `distributed`, `head-only-fallback`, `unsupported`; reload/swap model
   phải reset cached rotations và temporal/loss state.
4. Test tối thiểu hai VRM hiện có: bone mapping, rest capture, head/neck parent chain và output hữu hình.
5. Arm invariant: cùng Pose input, bật/tắt head motion không thay đổi arm packet quaternion; parent torso
   không bị Phase 3D animate nên world direction tay không regression.
6. Privacy/serialization: packet không chứa facial matrix, landmark, diagnostic, model node/UUID hoặc
   ảnh; chỉ chứa quaternion semantic và tracking metadata hiện có.
7. DEV diagnostics chỉ giữ panel cần nghiệm thu; mode capability và head loss/distribution phải đọc được.

Implementation evidence: rig profile capture rest-local head/neck; residual hierarchy dùng
`Rh⁻¹·Dn⁻¹·Rh·T`, có regression rest khác identity. Packet ownership/privacy và arm invariants nằm
trong targeted processor/renderer gate.

### 3D-08 — Automated và manual acceptance

**Trạng thái:** COMPLETE — AUTOMATED + MANUAL PASS (2026-07-30).

- Unit test conversion, neutral delta, sign, decomposition/recomposition, gain, distribution,
  constraints, filtering, loss/recovery và lifecycle.
- Renderer/real-model test rest-relative hierarchy, stale reset và multi-model capability.
- Manual webcam: neutral; yaw nhỏ/lớn hai phía; pitch lên/xuống; roll hai phía; chuyển động kết hợp;
  chậm/nhanh; giữ pose; che/mở mặt; reload model; chạy liên tục.
- Chỉ test các file liên quan trong từng task con; gate tổng hợp chạy khi người dùng duyệt 3D-08.

**Gate:** chuyển động đầu–cổ đúng chiều, đủ biên độ, mượt nhưng không lag rõ, không dồn một bone,
không snap/loss-kẹt và không regression expression/arms.

#### Kế hoạch gate tổng hợp 3D-08

1. Chạy **chỉ targeted suite Phase 3D**: orientation/calibration, response, distribution, temporal,
   loss/recovery, processor packet, model loader, renderer rest/smoothing và privacy serialization.
2. Chạy TypeScript, lint các file Phase 3D bị ảnh hưởng và `git diff --check`; không chạy toàn bộ test repo.
3. Manual matrix trên ít nhất hai model:
   - neutral; yaw/pitch/roll nhẹ-lớn và kết hợp;
   - giữ pose, chuyển chậm/nhanh, giới hạn góc;
   - face loss ngắn/dài, recovery, loss lặp;
   - reload model/tracking restart;
   - head/neck distribution và tay/biểu cảm không regression.
4. Performance evidence: tracking/pipeline ổn định, processor→draw không vượt mục tiêu 100 ms trong
   điều kiện webcam đã dùng; không yêu cầu benchmark toàn hệ thống.
5. Đối chiếu packet/privacy và trạng thái capability/fallback; ghi rõ model nào không có neck/head.
6. Chỉ khi automated gate sạch và người dùng xác nhận manual matrix mới đánh dấu 3D COMPLETE; cập nhật
   Roadmap, Architecture, Codebase Guide và Development/Testing trong cùng phiên.

Automated final gate: 10 targeted files, 105/105 PASS; TypeScript PASS; lint Phase 3D files PASS;
`git diff --check` PASS. Người dùng xác nhận manual acceptance ngày 2026-07-30.

Manual regression 2026-07-30 phát hiện rời khung lâu rồi quay lại avatar đứng idle. Root cause: long-loss
expression calibration reset làm mất head neutral và idle-after-loss bị coi như first activation. Fix giữ
head neutral qua ordinary face loss, chỉ xóa ở lifecycle/calibration chủ đích; idle-after-loss luôn đi qua
confirmation/recovery. Targeted final gate tăng lên 105/105 PASS; chờ manual retest.

Sau manual PASS, neutral calibration được tích hợp tự động vào `Start tracking`; nút calibration và
các panel/preset Phase 3D đã gỡ khỏi DEV harness. Runtime Phase 3D và diagnostics nội bộ vẫn được giữ.

## 5. Tài liệu bị ảnh hưởng khi triển khai

- Kiến trúc/packet: `docs/02_SYSTEM_ARCHITECTURE.md`.
- Code map: `docs/06_CODEBASE_GUIDE.md`.
- Test/manual evidence: `docs/07_DEVELOPMENT_AND_TESTING.md`.
- Trạng thái task: `docs/09_ROADMAP_AND_TASKS.md`.
- Không sửa API/database nếu contract vẫn nằm trong `AvatarPosePacketV1`; nếu cần đổi transport version
  phải mở quyết định riêng trước.

## 6. Điều kiện hoàn thành

Phase 3D chỉ COMPLETE khi 3D-01→08 đạt gate, manual webcam được người dùng xác nhận, targeted tests,
lint/build sạch và tài liệu được cập nhật cùng phiên. Automated PASS không thay thế visual acceptance.

Targeted automated evidence 3D-01/02 ngày 2026-07-30: `coordinateAdapter.test.ts`,
`headOrientation.test.ts`, `faceCalibration.test.ts`, `avatarMotionProcessor.test.ts` — 77/77 PASS;
TypeScript build check PASS.
