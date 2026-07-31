# P4-T10 Phase 3E — Torso & Shoulder Retargeting

## 1. Trạng thái và quyết định phạm vi

**Trạng thái:** 3E-01/02/03 COMPLETE; 3E-04 và phần hierarchy-safe của 3E-06 đã REIMPLEMENTED ngày 2026-07-30, automated 521/521 PASS, build/lint PASS; manual webcam matrix PENDING. Shoulder độc lập 3E-05 vẫn DEFERRED.

Phase 3E bổ sung chuyển động thân trên và hai vai để avatar không còn cảm giác thân đứng cứng
trong khi đầu và tay chuyển động. Phase này dùng Pose landmarks đã có ở client, không thêm thư viện,
không thay đổi API/database và không truyền raw landmarks, ảnh hoặc video ra khỏi trình duyệt.

Phạm vi gồm:

- Xoay thân trái/phải (yaw), nghiêng thân (roll), cúi/ngửa nhẹ (pitch).
- Neutral calibration và semantic torso orientation tương đối với neutral.
- Phân bổ rotation liên tục giữa `hips`, `spine`, `chest` và `upperChest`; không dồn toàn bộ vào `chest`.
- Nhún vai, nâng vai theo động tác giơ tay, đưa vai ra trước/kéo về sau.
- Hai vai được giải độc lập từ torso + arm geometry.
- Giải lại arm chain theo target hierarchy của torso/shoulder trong cùng frame để cánh tay giữ đúng
  world orientation khi parent chuyển động.
- Constraints, filtering, loss/recovery, diagnostics và nghiệm thu nhiều model.

Không thuộc 3E:

- Dịch chuyển root/locomotion, chân, bàn chân hoặc full-body IK.
- Finger articulation, arm collision với thân và sửa Hand twist Phase 3B.
- Suy diễn hô hấp hoặc procedural idle animation không có tín hiệu tracking.
- WebRTC/jitter buffer phía nhận, thay đổi database/API hoặc thêm thư viện.

## 2. Hiện trạng và khoảng trống đã xác nhận

- `torsoBasis.ts` đã dựng `right/up/forward/worldRotation` từ hai vai và hai hông nhưng basis này
  hiện chỉ hỗ trợ arm geometry/fallback, chưa tạo torso joint rotation.
- `AvatarJointName` mới có `chest`; chưa có `hips`, `spine`, `upperChest` trong packet contract.
- `leftShoulder/rightShoulder` được loader nhận diện nhưng processor chưa phát rotation cho hai bone.
- Upper arm hiện khai báo parent mode `fixed-rest`; nếu torso/shoulder bắt đầu animate mà không đổi solver,
  tay sẽ được giải theo parent rest thay vì target parent của frame hiện tại.
- Đường nối hai vai hiện được dùng hợp lệ làm trục ngang của torso basis, nhưng không được dùng làm
  bone direction cho từng vai. Shoulder direction phải được suy từ torso frame và geometry riêng từng tay.

## 3. Contract đích

```text
MediaPipe Pose image/world landmarks (client-only)
  → visibility + geometry gate
  → torso semantic basis
  → neutral-relative torso yaw/pitch/roll
  → response curve + anatomical constraints + temporal filter
  → hips/spine/chest/upperChest distribution
  → independent left/right shoulder solve from torso + arm geometry
  → hierarchy-ordered arm solve using current-frame parent targets
  → loss/recovery
  → parent-local, rest-relative joint deltas
  → AvatarPosePacketV1
  → restLocal × deltaLocal tại renderer
```

Invariants:

- Tracking và solver chạy hoàn toàn phía client; packet chỉ chứa quaternion semantic đã xử lý.
- Không ghi bone position/scale và không lấy animated renderer state làm input solver.
- Mọi output là parent-local, rest-relative, finite, normalized và hemisphere-continuous.
- Thứ tự hierarchy trong một frame: torso chain → shoulder từng bên → upper arm → lower arm → hand.
- Child dùng target world của parent vừa tính trong cùng frame, không dùng `parentRestWorldRotation` khi
  parent đó đang được điều khiển.
- Tổng rotation torso phản ánh semantic target nhưng không double rotation qua các bone.
- Hai vai có state, confidence và loss/recovery độc lập.
- Shoulder-to-shoulder chỉ là trục tham chiếu torso; không phải bone direction của vai trái/phải.
- Duplicate/not-sampled không bơm filter hoặc calibration như sample mới.

## 4. Kế hoạch triển khai theo thứ tự

### 3E-01 — Diagnostics, capability và frozen evidence

**Trạng thái:** COMPLETE — targeted automated 83/83 PASS; manual acceptance được người dùng xác nhận 2026-07-30.

- Mở rộng capability report cho `hips`, `spine`, `chest`, `upperChest`, `leftShoulder`, `rightShoulder`.
- Hiển thị DEV-only torso basis, neutral-relative yaw/pitch/roll, distribution, shoulder target và
  rendered local/world rotations.
- Thêm frozen presets: neutral, torso yaw ±20/40°, pitch ±10/20°, roll ±10/20°, shrug từng bên/cả hai,
  arm raise từng bên và shoulder protraction/retraction.
- Chụp baseline chứng minh torso/shoulder hiện không nhận rotation và tay đang dùng fixed-rest parent.

**Gate:** xác định được lỗi nằm ở observation, semantic conversion, distribution, hierarchy conversion
hay renderer; replay deterministic và diagnostics không đi vào packet production.

Implementation hiện có:

- `ModelCapabilityReport.torsoShoulder` báo sáu bone, parent quan sát được, capability mode,
  trạng thái shoulder từng bên và baseline upper-arm parent `fixed-rest`.
- Torso diagnostics báo basis quaternion, visibility bốn landmark, source fresh/previous/rest và lý do
  reject cụ thể; dữ liệu chỉ nằm trong internal snapshot, không đi vào `AvatarPosePacketV1`.
- DEV harness có panel baseline local-only và 11 frozen observation presets torso/shoulder deterministic.
- Targeted gate năm file 83/83 PASS; TypeScript, lint và production build PASS.
- Full frontend suite hiện 471/475 PASS. Bốn lỗi cô lập trong
  `handTwistRootCauseValidation.test.ts` do mock renderer cũ thiếu `capability.gaze`; lỗi tái hiện khi chạy
  riêng file đó và không nằm trên đường code 3E-01, nên chưa sửa ngoài phạm vi.

### 3E-02 — Rig profile và packet hierarchy contract

**Trạng thái:** COMPLETE — targeted automated 98/98 PASS; manual acceptance được người dùng xác nhận 2026-07-30.

- Mở rộng joint contract cho `hips`, `spine`, `upperChest`; giữ `chest` và hai shoulder.
- Capture rest local/world rotation, parent rest world rotation và hierarchy/capability theo model generation.
- Không giả định mọi model có đủ bốn torso bone; capability phải mô tả chain thực tế.
- Fallback phân phối trên các torso bone hiện có, giữ tổng target và báo mode rõ ràng.
- Chuyển upper arm parent mode từ fixed-rest sang controlled khi shoulder/torso parent khả dụng.

**Gate:** rig có rest rotation khác identity vẫn tái tạo đúng; thiếu bone có fallback xác định, không silent
no-op; reload model không dùng profile/state cũ.

Implementation hiện có:

- `AvatarJointName` và model contract nhận `hips`, `spine`, `upperChest` bên cạnh `chest` và shoulders.
- Loader lấy normalized VRM torso nodes, capture rest local/world/parent-world quaternion theo model
  generation và lưu hierarchy/capability immutable trong rig profile.
- Capability phân biệt `full`, `without-upper-chest`, `reduced-chain`, `unsupported`; shoulder status và
  future controlled parent được ghi riêng từng bên.
- Rig profile vẫn lưu rest parent làm fallback, nhưng runtime hierarchy-safe truyền target world của shoulder trong cùng frame khi torso chain khả dụng.
- Renderer đã hỗ trợ semantic bone mới qua contract chung và có DEV-only synthetic torso probe;
  identity trả đúng rest, probe không đi vào packet/processor.
- Targeted sáu file 98/98 PASS; TypeScript, lint và production build PASS. Full suite vẫn có cùng bốn
  blocker Phase 3B mock `capability.gaze`, hiện 479/483 PASS.
- Manual evidence trên model `without-upper-chest`: `hips/spine/chest` và hai shoulder available,
  upper-arm parent baseline `fixed-rest`; synthetic torso +15°, clear, reload và tracking regression
  đều PASS. Frame evidence có hip visibility 0 nên torso observation fallback `rest` với
  `low-visibility`; đây là đúng diagnostic contract, không phải lỗi rig hierarchy.

### 3E-03 — Torso neutral và semantic yaw/pitch/roll

**Trạng thái:** COMPLETE — targeted automated 89/89 PASS; manual webcam acceptance PASS ngày 2026-07-30.

- Dùng bốn landmark vai/hông để dựng torso basis; khóa coordinate/sign bằng synthetic presets và webcam.
- Neutral calibration có chủ đích, reject khi visibility thấp, geometry suy biến hoặc người dùng đang
  chuyển động quá nhanh.
- Tính neutral-relative orientation rồi tách yaw/pitch/roll theo convention đã test.
- Dead-zone và response curve riêng từng trục; pitch/roll bảo thủ hơn yaw.

**Gate:** neutral gần identity; xoay, nghiêng, cúi/ngửa đúng dấu và tách biệt; output tăng liên tục theo
input, không nhảy tại dead-zone.

Implementation hiện có:

- `torsoOrientation.ts` sở hữu neutral calibration từ Pose sample mới hợp lệ và reject duplicate,
  degenerate shoulder geometry hoặc chuyển động giữa sample vượt gate. Full-torso mode dùng vai+hông.
  Theo quyết định manual ngày 2026-07-30, hông không phải điều kiện để chạy 3E: khi hông ngoài khung,
  `shoulder-only` chỉ quan sát torso yaw và body roll; torso pitch giữ neutral. 3E tuyệt đối không dùng
  tai/mũi hoặc head orientation, nên cúi/ngửa/nghiêng đầu tiếp tục chỉ thuộc 3D head/neck.
- Neutral dùng quaternion average có hemisphere continuity; semantic delta là
  `inverse(neutral) × current`, tách yaw/pitch/roll theo `YXZ`.
- Response curve liên tục dùng dead-zone 2°; yaw gain 1/max 45°, pitch gain 0.8/max 20° và roll gain
  0.9/max 25°. Đây là giá trị khởi đầu cần manual sign/amplitude tuning, chưa phải acceptance cuối.
- Start tracking reset/start torso calibration cùng lifecycle Face; DEV panel hiển thị calibration,
  observation rejection và input/output Y/P/R.
- Trước lần reimplementation, output 3E-03 chỉ nằm trong diagnostics. Runtime mới phát torso joint rotation sau calibration và qua loss/recovery mềm.
- Targeted năm file 89/89 PASS; TypeScript, lint và build PASS. Full suite gần nhất 484/488, vẫn chỉ có bốn
  blocker Phase 3B mock `capability.gaze` đã ghi nhận.

### 3E-04 — Phân bổ hips/spine/chest/upperChest

**Trạng thái:** REIMPLEMENTED — distribution/temporal runtime và torso joint packet output đã được khôi phục với current-frame parent targets; automated PASS, manual webcam PENDING.

- Phân bổ theo từng trục và theo capability, tổng share của mỗi trục luôn bằng 1.
- Không bone nào nhận 100% khi model có từ hai torso bone hợp lệ trở lên.
- Dùng curve liên tục theo magnitude: chuyển động nhẹ ưu tiên upper torso; chuyển động lớn tăng dần phần
  tham gia của spine/hips.
- Giá trị share và giới hạn góc cụ thể là tham số tuning, chỉ khóa sau automated + manual evidence.
- Tính hierarchy-safe parent-local deltas; test recomposition world target để chống double rotation.

**Gate:** chuyển động thân nhìn liên tục, không gãy ở eo/ngực, không dồn vào chest và tổng world orientation
khớp semantic target trong tolerance trên ít nhất hai model.

Implementation trước khi revert:

- `torsoDistribution.ts` phân bổ liên tục theo magnitude. Chuyển động nhẹ ưu tiên upper torso; chuyển động
  lớn tăng share của hips/spine. Các bone thiếu được loại rồi chuẩn hóa lại; chain từ hai bone trở lên không
  bone nào nhận 100%.
- Quaternion residual ở bone cuối bảo toàn chính xác tổng semantic target dù yaw/pitch/roll không giao hoán.
  Mỗi output được giải thành `restLocal × delta` từ target world và target world của parent, bao phủ rest
  rotation không-identity và tránh double rotation.
- Processor chỉ phát các torso joint có trong capability. Model manual hiện tại `without-upper-chest` phát
  `hips/spine/chest`, không phát `upperChest`; renderer dùng packet contract chung đã có.
- DEV diagnostics hiển thị distribution/loss mode. Regression cũ do gate không dùng arm/head đồng thời;
  runtime mới giải upper arm bằng shoulder target cùng frame và bù head/neck tương đối với torso để tránh double rotation.
- Theo manual evidence ngày 2026-07-30, camera-space yaw được đổi sang đúng chiều avatar semantic. Yaw giữ
  gần 1:1 từ vùng ngoài neutral deadband tới 70°, rồi soft-limit tiến dần về 80° để tránh snap khi quay gần
  ngang và một vai sắp bị che.
- Neutral deadband chuyển tiếp liên tục trong 1–3°. One Euro filter chạy theo Pose sample timestamp trên
  yaw/pitch/roll trước distribution; duplicate timestamp giữ nguyên output. Đây là stabilization tối thiểu
  được kéo sớm từ 3E-07 để 3E-04 có thể qua manual gate, chưa thay thế loss/recovery đầy đủ của 3E-07.
- Manual gate của model không thấy hông chỉ đánh giá torso yaw, body roll và neutral stability. Không dùng
  cúi/ngửa/nghiêng đầu làm input 3E; regression khóa các head landmarks không thay đổi torso output.
- Sau manual evidence `Input Roll 8.1° → Output 7.8°` làm avatar đứng lệch thấy rõ, shoulder-only body roll
  được tuning bảo thủ: deadband chuyển tiếp 2–4°, gain 0.65 và soft-limit 25°. Cùng input 8.1° tạo khoảng
  5.3° output; yaw giữ nguyên contract gần 1:1.

### 3E-05 — Independent shoulder solver

**Trạng thái:** DEFERRED — thử nghiệm không đạt manual acceptance trên model tham chiếu; shoulder rotation làm
upper arm nâng theo thay vì tạo shrug tự nhiên. Toàn bộ implementation/test/DEV UI đã được gỡ theo yêu cầu.

- Tạo shoulder observation riêng từng bên từ torso frame, shoulder position và upper-arm direction.
- Tách ba semantic component: elevation/depression (nhún/nâng), protraction/retraction (ra trước/về sau)
  và phần rotation cần thiết để nối tự nhiên sang upper arm.
- Arm raise phải tạo shoulder elevation tăng dần sau ngưỡng mềm, không bật mode đột ngột.
- Không lấy vector `leftShoulder → rightShoulder` hoặc chiều ngược lại làm bone direction.
- Confidence, constraint, filter và loss state độc lập trái/phải; một vai mất dữ liệu không làm vai kia
  mất theo.

**Gate:** nhún một/both shoulder, giơ từng tay và đưa từng vai trước/sau đúng bên; neutral không rung;
không có chuyển động đối xứng giả khi chỉ một bên hoạt động.

### 3E-06 — Hierarchy-safe torso → shoulder → arm integration

**Trạng thái:** PARTIAL IMPLEMENTED — phần torso→head/neck→arm hierarchy đã có và automated PASS; independent shoulder solve vẫn DEFERRED cùng 3E-05. Arm dùng current-frame shoulder target khi capability hợp lệ, fallback rest parent khi không hỗ trợ.

- Solver dựng target world theo đúng thứ tự torso chain, shoulder, upper arm và lower arm.
- Upper/lower arm tiếp tục giữ direction/pole đã được Phase 3A/3B khóa, nhưng phép đổi sang local dùng
  current-frame target world của parent.
- Torso-only motion với tay giữ yên phải làm tay đi cùng thân mà không đổi pose tương đối ngoài ý muốn.
- Arm-only motion trên torso trung tính phải giữ hành vi Phase 3A/3B hiện có.
- Chuyển động đồng thời torso + hai tay phải không double transform, không snap và không làm sai Hand twist.

**Gate:** regression world direction của hai arm chain qua torso yaw/pitch/roll; pose tay tương đối với thân
được bảo toàn; các test Phase 3A/3B liên quan vẫn xanh.

### 3E-07 — Constraints, temporal và loss/recovery

- Constraints semantic riêng cho torso và từng shoulder; không dùng radial clamp chung thay cho giới hạn
  giải phẫu theo trục.
- Filter theo Pose sample timestamp; renderer không smooth lần hai cho các bone processor-timed.
- Loss ngắn giữ exact output; loss dài easing torso/shoulder về neutral.
- Reacquire cần confirmation và recovery blend; reset/dispose/model reload/tracking restart xóa state đúng
  một lần.
- Mất landmark một bên chỉ ảnh hưởng shoulder/arm bên đó khi torso basis vẫn hợp lệ.

**Gate:** không jitter neutral, không kẹt pose, không snap khi che/mở lại và không vượt constraints.

### 3E-08 — Automated và manual acceptance

Automated matrix tối thiểu:

- Coordinate/sign, neutral, dead-zone, response continuity và quaternion validity.
- Distribution sum/recomposition, non-identity rest rotations và các capability fallback.
- Shoulder independence, arm-raise coupling và không dùng shoulder-line làm bone direction.
- Hierarchy regression cho torso-only, arm-only và torso+arm đồng thời.
- Duplicate/not-sampled/lost/reacquire/timestamp regression/lifecycle/model reload.
- Packet privacy: không raw landmark, matrix, ảnh hoặc video.
- Targeted performance không làm vi phạm NFR-01/NFR-02.

Manual webcam matrix tối thiểu trên ít nhất hai model:

1. Xoay thân trái/phải, nghiêng hai bên, cúi/ngửa nhẹ; đầu có thể giữ tương đối độc lập.
2. Nhún hai vai, từng vai; giơ từng tay; đưa từng vai ra trước/kéo về sau.
3. Kết hợp xoay thân với hai tay ở các pose khác nhau; tay không trượt, xoắn hoặc đổi hướng bất thường.
4. Che một vai/tay rồi reacquire; bên còn lại tiếp tục ổn định.
5. Giữ neutral và pose tĩnh để kiểm tra jitter; chuyển động nhanh vừa phải để kiểm tra latency/snap.

**Final gate:** toàn bộ targeted tests xanh, build/lint/typecheck xanh, manual matrix PASS, không có raw-data
egress và tài liệu trạng thái/evidence được cập nhật trước khi đánh dấu Phase 3E COMPLETE.

## 5. File dự kiến bị tác động khi triển khai

- `frontend/src/lib/avatar-motion/avatarPoseTypes.ts`
- `frontend/src/lib/avatar-motion/normalizedRigProfile.ts`
- `frontend/src/lib/avatar-motion/torsoBasis.ts`
- Các module mới dự kiến: torso orientation/distribution/temporal/loss và shoulder solver/temporal.
- `frontend/src/lib/avatar-motion/armFrameSolver.ts`
- `frontend/src/lib/avatar-motion/avatarMotionProcessor.ts`
- `frontend/src/lib/avatar-motion/avatarMotionDiagnostics.ts`
- `frontend/src/lib/avatar-renderer/modelLoader.ts`
- `frontend/src/lib/avatar-renderer/avatarRenderer.ts`
- `frontend/src/components/dev/AvatarRendererDevHarness.tsx`
- Các test tương ứng và tài liệu P4-T10 liên quan.

Tên module mới chỉ là dự kiến; khi bắt đầu từng subtask phải đối chiếu code hiện tại và trình bày kế hoạch
trước khi viết code.
