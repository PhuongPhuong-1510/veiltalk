# P4-T10 Phase 3C — Face Expression & Local Lip-sync

## 1. Trạng thái và quyết định phạm vi

**Trạng thái:** COMPLETE — 3C-01/02/03/04/05/06/07 COMPLETE; 3C-08 và 3C-09 đã bỏ khỏi phạm vi theo quyết định người dùng ngày 2026-07-30.

Cập nhật triển khai gần nhất:

- Capability matrix `mapped` / `fallback` / `unsupported` đã nối từ model loader tới renderer và
  DEV harness. Fallback chỉ dùng danh sách khai báo; explicit target bị thiếu được báo unsupported.
- DEV harness hiển thị raw MediaPipe, processor output và rendered value riêng biệt; mỗi semantic
  có local-only slider và nút clear. Override không đi vào `AvatarPosePacketV1`.
- Design audit đã được xử lý bằng apply plan có physical-target identity, ownership,
  deduplication, stale-target reset và deferred raw-morph apply sau `vrm.update()`.
- Automated gate: 38 test files, 396/396 PASS; lint và production build PASS.
- Manual browser/webcam gate của 3C-01/02/03 được người dùng xác nhận đạt ngày 2026-07-30.
- 3C-04 xử lý mouth-shape composition; regression bắt buộc là cười mím không được kích hoạt preset
  `happy` làm avatar há miệng/lộ răng.

Phase 3C cũ về mở rộng calibration/constraint cho tay bị hủy. Các hạng mục tay chưa hoàn tất
không được ngầm chuyển vào Phase 3C mới; chúng là backlog chưa gán phase và chỉ được làm khi có
quyết định riêng.

Phase 3C mới hoàn thiện biểu cảm khuôn mặt và lip-sync cục bộ trong trình duyệt. Phase này không
triển khai WebRTC, jitter buffer hoặc đồng bộ audio từ xa; các phần đó vẫn thuộc P4-T15/P4-T19.

Không thêm thư viện mới. Ảnh webcam và raw face landmarks chỉ tồn tại trong bộ nhớ trình duyệt,
không lưu, upload, log hoặc đưa vào `AvatarPosePacketV1`.

## 2. Mục tiêu nghiệm thu

- Tracking → render của biểu cảm phản ứng dưới 100 ms và pipeline duy trì tối thiểu 24 fps trên
  thiết bị tham chiếu trong điều kiện của NFR-01/NFR-02.
- Mặt trung tính không tự há miệng, chớp, nheo mắt, cau mày hoặc phồng má do nhiễu nền.
- Miệng đóng rõ trong khoảng nghỉ ngắn giữa âm tiết; không rung quanh ngưỡng đóng/mở.
- Chu môi, mím môi, kéo khóe, cười, cau/nhíu/nhướng mày và phồng má có phản ứng phân biệt được.
- Chớp mắt độc lập và biểu cảm trái/phải được giữ xuyên suốt pipeline khi model hỗ trợ.
- Mất tracking ngắn giữ trạng thái hợp lệ; mất dài trở về neutral; reacquire không snap.
- Ít nhất ba model VRM chạy cùng manual acceptance matrix hoặc bị từ chối với lý do capability rõ ràng.
- Model thiếu morph/expression dùng fallback đã khai báo; renderer không bỏ qua im lặng.
- Packet vẫn là plain data, không chứa ảnh, landmarks hoặc facial transform matrix.

Mục tiêu trên là mức nghiệm thu production cho phạm vi đồ án, không phải tuyên bố độ chính xác
“tối đa” trên mọi khuôn mặt, webcam và model VRM.

## 3. Kiến trúc dữ liệu

```text
MediaPipe face blendshapes
  → neutral calibration
  → semantic dead zone/gain/normalization
  → group-specific temporal policy
  → conflict/composition rules
  ├─ semantic face expressions (giữ left/right)
  │    → model expression adapter + declared fallback
  │    → target ownership/deduplicated apply plan
  │    → expression renderer
  └─ semantic eye gaze
       → model gaze adapter
       → một trong: VRM LookAt / eye bones / eye morph
```

Audio microphone chỉ cung cấp activity/envelope hỗ trợ nhịp đóng/mở miệng. Phase 3C không nhận
dạng phoneme và không tự tuyên bố tạo chính xác viseme A/I/U/E/O từ audio. Face blendshape vẫn là
nguồn chính cho hình dạng môi.

Code/test face tồn tại trước Phase 3C mới không mặc định được tính là kết quả hoàn thành. Chỉ tái
sử dụng thành phần cũ sau khi audit theo contract hiện tại và có test chứng minh đúng pipeline mới.

## 4. Kế hoạch triển khai bắt buộc theo thứ tự

### 3C-01 — Diagnostics và capability matrix

**Trạng thái:** COMPLETE — AUTOMATED PASS; MANUAL BROWSER GATE ACCEPTED 2026-07-30.

- Mở rộng DEV harness để hiển thị raw, calibrated, filtered và rendered value.
- Thêm slider kích hoạt từng semantic expression mà không cần webcam.
- Kiểm kê expression/morph target của từng model và fallback có thể dùng.
- Báo rõ `mapped`, `fallback` hoặc `unsupported`; không silent no-op.
- Gắn timestamp tracking, processing và render để đo latency.

**Gate:** xác định được vì sao một expression không xuất hiện: thiếu input, calibration/filter,
mapping hay capability model; mỗi physical target có đúng một owner, không double-apply và target
không còn xuất hiện ở frame mới được reset.

### 3C-02 — Neutral calibration

**Trạng thái:** COMPLETE — AUTOMATED PASS; MANUAL WEBCAM GATE ACCEPTED 2026-07-30. Nguồn chi tiết:
`docs/P4_T10_PHASE3C_02_NEUTRAL_CALIBRATION_PLAN.md`.

- Calibration được kích hoạt có chủ đích từ DEV/UI hoặc lifecycle đã định nghĩa; không tự học lại
  neutral âm thầm.
- Thu baseline trung tính 1–2 giây, không lưu ảnh/landmark.
- Semantic baseline, noise floor, dead zone, gain và normalization range độc lập theo expression.
- Chỉ nhận sample khi tracking liên tục, sample hợp lệ và neutral-candidate gate đạt. Gate loại frame
  có jaw, blink, smile, brow, cheek puff hoặc head motion vượt ngưỡng cấu hình.
- Không đủ sample trung tính trong timeout thì FAIL rõ ràng, không dùng baseline sai.
- Reset khi restart/dispose, đổi model, discontinuity hoặc mất mặt dài.
- Không tái neo neutral liên tục trong lúc người dùng đang biểu cảm.

**Gate:** neutral ổn định, không pumping và không làm mất biểu cảm nhẹ có chủ ý.

### 3C-03 — Miệng đóng/mở và nhịp lời nói

**Trạng thái:** COMPLETE — TARGETED PASS; MANUAL GATE ACCEPTED 2026-07-30. Nguồn chi tiết:
`docs/P4_T10_PHASE3C_03_MOUTH_TIMING_PLAN.md`.

- Tách policy `jawOpen` và `mouthClose`; dùng attack/release riêng thay vì một smoothing chung.
- Thêm hysteresis chống rung. `mouthClose`/press/roll tạo close-or-press strength để suppression mềm
  lên jaw; chỉ cưỡng chế đóng khi bằng chứng đủ mạnh và ổn định, không đóng cứng từ một frame đơn.
- Dùng audio envelope như tín hiệu phụ để nhận khoảng nói/nghỉ, không thay face tracking.
- Không cho smoothing renderer làm mất nhịp đóng nhanh đã tạo ở processor.

**Gate:** neutral đóng; nói chậm/nhanh có khoảng đóng nhìn thấy; không chỉ mở/đóng hàm kéo dài.

### 3C-04 — Hình dạng môi

**Trạng thái:** COMPLETE — TARGETED PASS; MANUAL GATE ACCEPTED 2026-07-30. Nguồn chi tiết:
`docs/P4_T10_PHASE3C_04_MOUTH_SHAPE_COMPOSITION_PLAN.md`.

- Chu môi: `mouthPucker`, `mouthFunnel`; fallback có khai báo sang preset phù hợp của VRM.
- Mím môi: `mouthPressLeft/Right`, `mouthRollUpper/Lower`, `mouthClose`.
- Kéo khóe: `mouthSmileLeft/Right`, `mouthStretchLeft/Right`, `mouthDimpleLeft/Right`.
- Đặt conflict rule để jaw, press, pucker và stretch không cộng tuyến tính gây méo mặt.
- Giữ trái/phải tới model adapter; chỉ tổng hợp nếu model không hỗ trợ hai phía.

**Gate:** pucker, funnel, press, smile, stretch và dimple tạo phản ứng phân biệt; không double-apply,
không méo do cộng nhiều tín hiệu; left/right không bị đảo hoặc tổng hợp sớm.

### 3C-05 — Mắt

**Trạng thái:** COMPLETE — TARGETED AUTOMATED GATE PASS; MANUAL GATE ACCEPTED 2026-07-30. Nguồn chi tiết:
`docs/P4_T10_PHASE3C_05_EYES_AND_GAZE_PLAN.md`.

- Blink trái/phải có attack/release và hysteresis riêng.
- Blink thắng `eyeWide`; chớp ngắn không bị smoothing triệt tiêu.
- `eyeSquintLeft/Right` và `cheekSquintLeft/Right` là nguồn chính cho nheo mắt.
- Smile chỉ bổ sung squint có giới hạn; không tự ép nheo khi cười nhẹ.
- Eye look và eye wide có dead zone chống rung.
- Capability xác định gaze dùng eye morph, VRM LookAt hay eye bones.
- Chỉ một gaze controller sở hữu mắt tại một thời điểm; không bật đồng thời automatic LookAt và
  custom eye-bone rotation.

**Gate:** blink từng mắt độc lập; blink ngắn không bị triệt tiêu; blink thắng wide; gaze neutral
không rung; squint không tự kích hoạt khi chỉ cười nhẹ; gaze chọn đúng một controller được hỗ trợ.

### 3C-06 — Mày, cười, cau mày và má

**Trạng thái:** COMPLETE — TARGETED AUTOMATED GATE PASS; MANUAL GATE ACCEPTED 2026-07-30. Nguồn chi tiết:
`docs/P4_T10_PHASE3C_06_BROWS_SMILE_FROWN_CHEEKS_PLAN.md`.

- Giữ độc lập `browDownLeft/Right`, `browInnerUp`, `browOuterUpLeft/Right`.
- `happy` chỉ là fallback tổng hợp; model giàu morph nhận các thành phần riêng.
- `mouthFrownLeft/Right` không bị gộp cứng với brow down.
- `cheekPuff` có calibration/dead zone riêng để tránh kích hoạt giả khi nói.
- Không giả lập phồng má bằng scale toàn đầu/mặt nếu model không hỗ trợ.

**Gate:** brow down, inner/outer up, frown, happy và cheek puff không bị gộp sai; neutral không tự
cau mày/phồng má; model thiếu cheek morph báo unsupported thay vì giả lập sai.

### 3C-07 — Face tracking loss/recovery

**Trạng thái:** COMPLETE — TARGETED AUTOMATED GATE PASS; MANUAL GATE ACCEPTED 2026-07-30. Nguồn chi tiết:
`docs/P4_T10_PHASE3C_07_FACE_LOSS_RECOVERY_PLAN.md`.

- Mất ngắn: hold expression hợp lệ cuối.
- Mất dài: easing về neutral, riêng miệng phải về đóng.
- Reacquire cần confirmation rồi recovery blend; không snap vào frame đầu tiên.
- Reset filter/calibration theo lifecycle đã định nghĩa, không reset mỗi frame mất tracking.

### Quyết định bỏ 3C-08 và 3C-09

Theo quyết định người dùng ngày 2026-07-30, hai task dự kiến 3C-08 (model-specific expression
adapter) và 3C-09 (acceptance tổng hợp riêng) đã bị loại khỏi phạm vi và không phải backlog ngầm.
Lý do: capability/mapping/apply-plan hiện tại đã đáp ứng bộ model đang dùng; từng task 3C-01→07 đã
có targeted automated gate và manual gate riêng. Không triển khai profile registry hoặc một vòng
acceptance tổng hợp mới. Nếu sau này model production mới cần mapping riêng, phải mở task mới và
quyết định phạm vi riêng, không tự khôi phục mã 3C-08/09.

## 5. Ranh giới với phase/task khác

- Phase 3B tiếp tục sở hữu Hand forearm twist và manual acceptance chưa hoàn tất.
- Hand/finger orientation, torso/collision và anatomical arm calibration/constraint không thuộc
  Phase 3C mới; hiện là backlog chưa gán phase.
- P4-T15 sở hữu WebRTC peer connection và truyền `AvatarPosePacketV1`.
- P4-T19 sở hữu jitter buffer, timestamp alignment và audio–expression skew dưới 120 ms ở phía nhận.
- Phase 3C không sửa API hoặc database.

## 6. Điều kiện hoàn thành

Phase 3C kết thúc ở 3C-07 và được đánh dấu COMPLETE vì 3C-01→07 đã đạt targeted automated/manual
gate tương ứng; 3C-08/09 đã bị bỏ khỏi phạm vi. Privacy contract được giữ và các tài liệu
`02_SYSTEM_ARCHITECTURE.md`, `06_CODEBASE_GUIDE.md`, `07_DEVELOPMENT_AND_TESTING.md`,
`09_ROADMAP_AND_TASKS.md` được cập nhật cùng phiên.
