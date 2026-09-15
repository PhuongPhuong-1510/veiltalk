# AR3 — Kế hoạch triển khai Mắt, Ánh nhìn và Sự chú ý

Trạng thái: **AR3-T01–T04 CODE/TOOLING COMPLETE — UNIFIED MANUAL GATE PENDING**  
Ngày cập nhật theo review: 2026-09-14  
Phạm vi: **AR3-T01 → AR3-T04** trong `docs/11_AVATAR_EVOLUTION_ROADMAP.md`

> Implementation ngày 2026-09-14: T01 gaze core; T02 conditional dedicated-eyelid coupling; T03 faithful mặc
> định + cinematic opt-in; T04 local scalar metrics và unified DEV controls đã nối production/harness. Gaze v1
> không có convergence/prediction; renderer không smoothing gaze lần hai. Automated gate: **68 files / 723 tests
> PASS**, lint PASS, TypeScript + Vite production build PASS. Chưa tuyên bố DONE trước khi webcam/head-relative/
> đa-model gate được chủ dự án xác nhận.

> Manual smoke ngày 2026-09-14: UI và chuyển động mắt PASS cơ bản; chủ dự án phản hồi bước gaze hơi nhanh và
> đôi lúc tạo cảm giác lé. Corrective giảm One Euro response (`minCutoff 1.15`, `beta 0.035`) và chỉ dùng 85%
> range góc adapter; regression center→edge đã thêm. Cần webcam retest trước khi đóng manual gate.

## 1. Quyết định sau review

| Hạng mục | Quyết định |
|---|---|
| AR3-T01 Gaze Core | **CODE COMPLETE; MANUAL PENDING** |
| AR3-T02 Eyelid coupling | **CODE COMPLETE; CAPABILITY/MANUAL PENDING** — runtime chỉ chạy khi adapter không tự xử lý mí và model có exact target production-safe |
| AR3-T03 Cinematic gaze | **CODE COMPLETE; MANUAL PENDING** — faithful vẫn là mặc định; không convergence/prediction |
| AR3-T04 | **TOOLING COMPLETE; MANUAL PENDING** — automated/DEV gate đã hợp nhất để chủ dự án test một lượt |
| Vergence | **REMOVED FROM V1** — webcam đơn và capability hiện tại chưa đủ tin cậy |
| Packet gaze v1 | Optional, chỉ có `version`, `yaw`, `pitch` |
| Production mode | `faithful` |
| Partial eye bones | `unsupported`, no-op |
| Head rotation | AR3 không sửa; head/neck retargeting thuộc AR4 |

Thứ tự thực tế:

```text
F4 fast-speech corrective
→ AR3-T01 gaze core
→ AR3-T02 conditional eyelid + AR3-T03 cinematic (đã được chủ dự án mở lại)
→ AR3-T04 local metrics/DEV tooling
→ unified manual gate trên ba model
→ đóng AR3
```

## 2. Mục tiêu AR3-Core

1. Avatar nhìn trái/phải/lên/xuống đúng chiều, ổn định và độc lập tương đối với quay đầu.
2. Observation/solver luôn tạo semantic gaze dù model local không hỗ trợ; chỉ renderer quyết định apply/no-op.
3. VRM LookAt usable và đủ hai eye bones có adapter độc quyền; không double-apply.
4. Eye-bone adapter luôn áp `restLocal × deltaLocal`, không tích lũy trên output frame trước.
5. Mất tracking, duplicate, reload/model swap và reacquire không gây snap, drift hoặc kẹt mắt.
6. F2 tiếp tục sở hữu blink/wink; gaze không biến squint, closure hoặc tracking loss thành blink giả.
7. T04A chạy trên ít nhất ba VRM khác capability, có automated evidence, webcam evidence và metric.
8. Không truyền ảnh, webcam, raw landmark hoặc raw coefficient qua mạng.

## 3. Nguồn chân lý và ràng buộc

- Roadmap: `docs/11_AVATAR_EVOLUTION_ROADMAP.md`, Giai đoạn 3 và bảng AR3.
- SRS: FR-05, FR-07, FR-09; NFR-01, NFR-02, NFR-06.
- Kiến trúc: `docs/02_SYSTEM_ARCHITECTURE.md` mục 4.1.1, 4.1.2 và `AvatarPosePacketV1`.
- Test: `docs/07_DEVELOPMENT_AND_TESTING.md`.
- `facialCapability.ts` hiện đã audit `vrm.lookAt`, `leftEye`, `rightEye` và expression bind.
- F2 là owner duy nhất của observed blink/wink; F4 là temporal/conflict owner của facial-expression morph.
- Motion processor sender là owner duy nhất của observation smoothing cho gaze.
- Renderer không thêm gaze smoothing. Network interpolation/jitter handling, nếu cần, thuộc task transport;
  không âm thầm thêm tầng smoothing thứ hai vào adapter.
- Không thêm thư viện và không suy capability theo tên file/model.

## 4. Ngoài phạm vi AR3-Core

- Convergence/ước lượng khoảng cách nhìn.
- Saccade, prediction, eye-contact assist, procedural idle blink và cinematic attention.
- Sửa mouth/viseme, F4 dynamics, F6 hoặc audio fusion.
- Phân phối head rotation qua neck/chest; thuộc AR4.
- Contact, hair interaction, full-body gaze target hoặc AI attention prediction.
- Dùng iris/raw landmark làm payload mạng.

## 5. Kiến trúc và quyền sở hữu

```text
RawTrackingFrameV1.face (local-only)
  → F1 neutral calibration
  → gaze observation mapper (fresh sample only)
  → conjugate gaze fusion + quality/reject reason
  → semantic clamp
  → gaze temporal/loss/reacquire
  → AvatarPosePacketV1.gaze { version, yaw, pitch }
  → renderer capability adapter
       ├─ vrm-look-at-bone
       ├─ vrm-look-at-expression
       ├─ eye-bones
       └─ unsupported: no-op + diagnostic

F2 blink/wink → F4 facial dynamics → expressions
T02 eyelid secondary (conditional) ───────┘
```

- Observation mapper chỉ đọc coefficient đã neutral-calibrate và sample metadata; không biết model.
- Solver sở hữu quy ước dấu, binocular conjugate fusion, quality và semantic clamp; không biết model.
- Temporal sở hữu smoothing/hold/return/reacquire; duplicate render không phải observation mới.
- Renderer chọn đúng một adapter theo model và áp gaze. Capability local không được tắt sender solver.
- Diagnostics không nằm trong packet và không upload.

## 6. Contract dữ liệu

### 6.1 Packet semantic tối thiểu

```ts
interface GazeStateV1 {
  version: 1;
  yaw: number;   // [-1, 1], + phải theo góc nhìn avatar
  pitch: number; // [-1, 1], + lên theo góc nhìn avatar
}
```

`AvatarPosePacketV1` thêm `gaze?: GazeStateV1 | null`. Receiver cũ bỏ qua field optional; receiver mới no-op khi
field thiếu/null/invalid. `mode`, `outputState`, `sampledAtMs`, `quality` và `rejectReason` không đi qua packet.
Packet cha đã có sequence/source/processed timestamp nên không lặp timestamp trong gaze.

### 6.2 Diagnostic local-only

```ts
interface GazeDiagnostics {
  outputState: "active" | "held" | "returning" | "idle";
  quality: number;
  rejectReason: string | null;
  rawLeft: { horizontal: number; vertical: number } | null;
  rawRight: { horizontal: number; vertical: number } | null;
  fused: { yaw: number; pitch: number };
  head: { yaw: number; pitch: number } | null;
  finalSemantic: { yaw: number; pitch: number };
  adapterKind: GazeAdapterKind;
  clampFlags: readonly string[];
}
```

Panel hiển thị raw L/R, fused gaze, head yaw/pitch, final head-relative candidate, state, reject reason, adapter
và applied output. Telemetry phải chứng minh eye-look coefficient có thật sự tương đối với đầu; không suy diễn
từ tên coefficient.

### 6.3 Capability

```ts
type GazeAdapterKind =
  | "vrm-look-at-bone"
  | "vrm-look-at-expression"
  | "eye-bones"
  | "unsupported";

interface GazeCapability {
  kind: GazeAdapterKind;
  yawLeftLimit: number;
  yawRightLimit: number;
  pitchUpLimit: number;
  pitchDownLimit: number;
  handlesVerticalEyelid: boolean;
}
```

`vrm.lookAt` tồn tại chưa đủ. Loader phải xác định applier/range map thực tế và usable state. Nếu LookAt tự
điều khiển expression/mí, `handlesVerticalEyelid=true` để T02 không double-apply. Thiếu một eye bone là
`unsupported`, không điều khiển một mắt.

## 7. Mô hình toán AR3-T01 v1

### 7.1 Observation mỗi mắt

```text
hLeft  = activate(lookOutLeft)  - activate(lookInLeft)
hRight = activate(lookInRight)  - activate(lookOutRight)
vLeft  = activate(lookUpLeft)   - activate(lookDownLeft)
vRight = activate(lookUpRight)  - activate(lookDownRight)
```

Đây là semantic dự kiến; key và dấu phải được khóa bằng fixture MediaPipe, mirror test và DEV arrows trước khi
nối renderer. Input qua `safe01`; threshold nằm trong config validate một lần.

### 7.2 Conjugate fusion và quality

```text
yawRaw   = weightedMean(hLeft, hRight)
pitchRaw = weightedMean(vLeft, vRight)
conjugateDisagreement = distance(leftDirection, rightDirection)
quality = faceFreshness × visibilityProxy × agreementGate(conjugateDisagreement)
```

V1 chỉ giữ chuyển động đồng hướng. Disparity không đổi thành convergence. MediaPipe không có confidence riêng
từng blendshape; `visibilityProxy` chỉ là evidence tổng hợp từ face state, closure và tính hữu hạn. Một mắt đóng
làm giảm weight bên đó nhưng không đảo gaze mắt còn lại.

### 7.3 Head-relative validation

1. Giữ mắt nhìn thẳng tương đối với đầu.
2. Quay đầu trái/phải/lên/xuống.
3. Ghi raw eye-look, head yaw/pitch và fused gaze local-only.
4. Nếu eye-look thay đổi mạnh theo head, dừng T01 để thiết kế compensation/calibration có evidence; không tuning
   gain để che lỗi.

### 7.4 Semantic clamp

```text
r² = (yaw / yawLimit)² + (pitch / pitchLimit)²
if r² > 1: scale yaw,pitch by 1 / sqrt(r²)
```

Limit semantic được phép bất đối xứng. Adapter đổi semantic sang giới hạn thật của model. Safety clamp tại
adapter không làm temporal smoothing lần hai.

### 7.5 Temporal/loss

- Fresh sample: filter theo wall-clock; attack nhanh hơn settle.
- Duplicate/reversed timestamp: không promote observation hoặc tích lũy state.
- Mất ngắn: hold tối đa `holdMs`, sau đó smoothstep về center trong `returnMs`.
- Mất dài/reset: exact center và xóa velocity.
- Reacquire: blend từ output hiện tại; không snap hoặc neo neutral từ sample đầu.
- Blink ngắn không phải gaze loss; closure dài/face loss giảm quality và return.
- Với cùng **timestamped observation trajectory**, output ở cùng wall-clock tương đương trong tolerance định
  trước; không yêu cầu webcam FPS khác nhau tạo dữ liệu giống hệt nhau.

## 8. AR3-T01 — Gaze Core

### 8.1 Phạm vi

1. Audit key/sign/mirror và head-relative behavior bằng fixture + telemetry.
2. Implement observation, conjugate fusion, quality, ellipse clamp và temporal lifecycle.
3. Mở rộng capability thành bốn adapter kind ở mục 6.3.
4. Renderer ưu tiên VRM LookAt usable, fallback đủ hai eye bones, partial/missing no-op.
5. Eye-bone adapter chụp rest/local axes riêng từng mắt theo model generation, áp
   `finalLocal = restLocal × gazeDeltaLocal`, giữ hemisphere continuity, không tích lũy; idle/swap/dispose trả
   rig cũ về rest.
6. Solver vẫn chạy và packet vẫn có gaze khi model local unsupported.
7. Thêm diagnostics/DEV panel theo mục 6.2.

### 8.2 File dự kiến

- Mới: `avatar-motion/gazeObservation.ts`, `gazeSolver.ts`, `gazeTemporal.ts` và test.
- Sửa: `avatarPoseTypes.ts`, `avatarMotionProcessor.ts`, `motionConfig.ts`.
- Mới: `avatar-renderer/gazeCapabilityAdapter.ts` và test.
- Sửa: `facialCapability.ts`, `modelTypes.ts`, `modelLoader.ts`, `avatarRenderer.ts`.
- Sửa DEV harness/diagnostics và tài liệu kiến trúc/codebase guide/roadmap.

### 8.3 Automated acceptance

- Center/trái/phải/lên/xuống đúng dấu; mirror fixture không double-negate.
- Một mắt thiếu/đóng không NaN hoặc đảo side; disagreement hạ quality có kiểm soát.
- Output hữu hạn, trong ellipse semantic và capability limits.
- Cùng timestamped trajectory ở 15/30/60 render FPS cho output wall-clock tương đương trong tolerance.
- Duplicate không promote; loss → hold → return → exact center; reacquire không snap.
- Eye-bone output luôn `rest × delta`, không tích lũy và giữ hemisphere continuity.
- Không đồng thời apply LookAt và eye bones; LookAt-expression được nhận diện để T02 không áp mí lần hai.
- Local model unsupported vẫn phát semantic gaze; remote model capability khác vẫn áp đúng hướng.
- Model swap khi gaze lệch trả rig cũ về rest và không dùng axes/profile generation cũ.
- Invalid/nonfinite packet không làm mắt kẹt.
- Packet không chứa raw coefficient/landmark; compatibility và size test PASS.
- F1–F4, arm/hand và renderer lifecycle regression PASS.

### 8.4 Manual baseline

- Center và bốn hướng trên một model LookAt và một model eye-bone nếu catalog có đủ.
- Quay đầu khi giữ mắt nhìn thẳng theo đầu; đối chiếu raw/fused/head telemetry.
- Che/nhắm một mắt, face loss và reacquire: không flip/kẹt/snap.
- Model local unsupported vẫn cho diagnostic/packet semantic hợp lệ.

Sau automated gate T01, chạy T04A core gate ngay; không bắt T01 chờ T02/T03.

## 9. AR3-T02 — Eyelid coupling có điều kiện

Trạng thái: **CODE COMPLETE; CAPABILITY/MANUAL PENDING**. Runtime chỉ bật exact semantic target có trong
verified/profile expression map; LookAt-expression hoặc model không có target phù hợp trả no-op reason rõ ràng.

### 9.1 Entry gate

Chỉ bắt đầu trên model khi T01 telemetry chứng minh đồng thời:

1. Adapter không tự xử lý vertical eyelid (`handlesVerticalEyelid=false`).
2. Model có target eyelid-down/up production-safe đã audit theo fingerprint.
3. Target không phải `blink`, `eyeSquint` hoặc preset full-face.

Không đủ điều kiện thì T02 no-op cho model đó. Nếu không model nào đủ, ghi `NOT APPLICABLE` kèm evidence;
không tạo morph giả để hoàn thành task.

### 9.2 Quy tắc và acceptance

```text
lidDownSide = capDown × activate(-pitch) × (1 - blinkSide)
lidUpSide   = capUp   × activate(+pitch) × (1 - blinkSide)
```

Target semantic chỉ khóa sau capability audit. Secondary đi qua F4 conflict/budget. F2 blink thắng tuyệt đối.

- F2 blink/wink không regression; LookAt expression có eyelid follow không bị double-apply.
- Loss, closure, squint, duplicate hoặc FPS khác nhau không tạo false blink.
- Model thiếu target no-op; không fallback sang blink/squint/full-face preset.
- Nhìn lên/xuống chỉ coupling nhẹ, đúng dấu, không cực đại hoặc kẹt.

## 10. AR3-T03 — Cinematic gaze

Trạng thái: **CODE COMPLETE; MANUAL PENDING** theo quyết định mở lại ngày 2026-09-14.

Đã triển khai soft attention bias → deterministic micro-saccade → procedural idle blink, có transition blend và
suppression khi tracking loss. `faithful` vẫn là mặc định/control group. Prediction chưa triển khai vì telemetry
chưa chứng minh cần; cinematic không sửa head rotation và không có convergence. “Mắt dẫn đầu head” vẫn thuộc AR4.

## 11. AR3-T04A — Core Eye Gate

### 11.1 Ma trận model

Ít nhất ba VRM, bao phủ tối đa capability catalog có: LookAt bone, LookAt expression, đủ hai eye bones và
unsupported/partial. Không chọn ba model cùng capability rồi kết luận đa-model. Ghi fingerprint, adapter, limits
và `handlesVerticalEyelid`.

### 11.2 Ma trận webcam

| Case | Thao tác | Kỳ vọng |
|---|---|---|
| E1 | Center 5 giây | Không drift/rung thấy rõ |
| E2 | Trái → center → phải | Đúng chiều, không snap, biên độ tương đương |
| E3 | Lên → center → xuống | Đúng chiều; T02 chỉ chạy khi capability đủ |
| E4 | Nhìn bốn góc | Clamp ellipse, không kẹt corner |
| E5 | Giữ mắt thẳng theo đầu rồi quay đầu | Telemetry chứng minh head-relative hoặc chỉ ra compensation cần |
| E6 | Blink hai mắt | Blink thật, gaze không reset sai |
| E7 | Wink trái/phải | Đúng bên; mắt còn mở giữ gaze hợp lý |
| E8 | Che một mắt rồi mở | Không false blink/flip; reacquire mượt |
| E9 | Che mặt/ra khung rồi trở lại | Hold/return/reacquire đúng lifecycle |
| E10 | Reload/đổi model khi gaze lệch | Rig cũ về rest; adapter/profile mới đúng generation |
| E11 | Sender local unsupported, receiver hỗ trợ | Semantic vẫn tồn tại và receiver áp đúng hướng |
| E12 | Chạy 60 giây | Không kẹt/drift; performance và privacy đạt gate |

### 11.3 Metric

- `semanticGazeJitterP95`, `semanticReacquirePeakDelta` và settle time.
- Fixture sign correctness; webcam bốn hướng đánh giá manual. Không gọi là direction error khi chưa có ground
  truth/UI target calibration.
- `appliedEyeRotationDegrees` sau adapter nếu cần metric góc thật.
- `clampHitRatio`, thời gian kẹt clamp và invalid/nonfinite count đã có trong local scalar collector.
- `falseBlinkCount`, `blinkSideMismatchCount`, direction correctness và adapter mismatch cần ground truth/manual
  annotation nên không được tự suy thành số. `unsupported` hiện thể hiện trực tiếp bằng capability/adapter reason.
- Tracking→render avg/p95, FPS 60 giây và packet-size delta.

Ngưỡng số được đặt sau baseline và cần duyệt; seed không tự thành chuẩn sản phẩm. Diagnostic local-only, không
lưu ảnh/landmark/biometric trace.

### 11.4 Definition of Done AR3-Core

- T01 automated/manual core gate PASS trên ≥3 model capability-diverse.
- T02 PASS ở model đủ điều kiện, hoặc `NOT APPLICABLE` có evidence.
- T03/T04B code/tooling complete nhưng chỉ DONE sau unified manual gate; không đánh đồng automated PASS với DONE.
- TypeScript, lint, build và toàn bộ regression frontend PASS.
- Không regression F1–F4, arm/hand, privacy, packet compatibility hoặc renderer lifecycle.
- Metric có baseline/ngưỡng được duyệt và report PASS/FAIL trung thực.
- Corrective từ manual gate có regression trước production patch.
- Cập nhật kiến trúc, codebase guide và roadmap trong phiên đóng task.
- Chủ dự án xác nhận manual gate; `CODE COMPLETE` không đồng nghĩa `DONE`.

## 12. Checkpoint triển khai

1. T01 code audit: API three-vrm, expression keys, capability và packet/renderer lifecycle.
2. T01 implementation: observation → solver → temporal → packet → adapter → diagnostics.
3. T01 automated gate: targeted tests rồi full frontend test/lint/build.
4. T02 conditional implementation + T03 cinematic implementation + T04 scalar metrics/DEV controls.
5. Unified manual gate: E1–E12 trên faithful, T02 capability/no-op evidence và các case cinematic liên quan.
6. Corrective từ manual evidence phải có regression; sau đó chốt baseline/ngưỡng metric.
7. Chủ dự án xác nhận rồi mới đóng AR3 và cập nhật trạng thái DONE.

## 13. Rủi ro và cách chặn

| Rủi ro | Cách chặn |
|---|---|
| MediaPipe/VRM/mirror khác convention | Fixture từng lớp + DEV arrows + manual bốn hướng trước tuning |
| Coefficient không head-relative | Raw/fused/head telemetry; dừng thiết kế compensation nếu fail |
| LookAt tồn tại nhưng unusable | Capability theo applier/range map thực tế, không chỉ existence |
| LookAt và eye bones cùng apply | Adapter kind độc quyền + assertion/test |
| Eye bone sai rest/local axis | Profile per-eye, `rest × delta`, generation guard và swap test |
| Blink/squint làm gaze nhảy | Per-eye weight/closure gate; F2 giữ ownership blink |
| T02 double-apply mí | `handlesVerticalEyelid` + production-safe target gate |
| Hai tầng smoothing gây lag | Sender temporal duy nhất; renderer chỉ apply/safety clamp |
| Local unsupported làm mất remote gaze | Solver model-independent; no-op chỉ tại renderer local |
| Packet phụ thuộc rig gửi | Chỉ gửi yaw/pitch normalized; receiver tự adapt |
| Tuning theo một model | Gate ≥3 VRM capability-diverse; profile fingerprint khi cần |
| Realtime allocation/GC | Validate config một lần, tránh allocation trong loop, benchmark T04A |
