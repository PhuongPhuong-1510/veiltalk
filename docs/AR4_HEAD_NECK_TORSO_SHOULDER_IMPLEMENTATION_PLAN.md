# AR4 — Kế hoạch triển khai Đầu, Cổ, Thân trên và Vai

Trạng thái: **CORRECTIVE IMPLEMENTED — AUTOMATED GATE PASS — MANUAL RETEST/PERFORMANCE GATE PENDING**  
Ngày lập/cập nhật: 2026-09-15  
Phạm vi nền đã triển khai: **AR4-T01 → AR4-T05** trong `docs/11_AVATAR_EVOLUTION_ROADMAP.md`; extension
**AR4-T06 Hybrid Torso Fore/Aft Lean** đã được lập kế hoạch riêng tại `docs/AR4_T06_HYBRID_TORSO_LEAN_PLAN.md`
và đang chờ AI review, chưa code.

> Kế hoạch này khóa kiến trúc và công thức trước khi sửa runtime. AR3 đã code complete nhưng corrective giảm
> độ nhạy gaze còn cần webcam retest. Có thể review AR4 ngay; chỉ bắt đầu behavioral code AR4 sau khi AR3 được
> chủ dự án xác nhận đủ điều kiện chuyển phase.

Chủ dự án cho phép bắt đầu code ngày 2026-09-14. Infrastructure và behavior AR4-T01–T04 đã được nối vào
DEV local pipeline; AR4-T05 có automated/telemetry tooling. Curl giữ `disabled/N/A` vì chưa có baseline ba model.
Chưa tuyên bố AR4 DONE trước manual U1–U13, vertical shrug VS-U1–VS-U16 và benchmark 60 giây trên ít nhất ba VRM.
AR4-T03.1 đã thêm semantic vertical shoulder translation theo kế hoạch
`docs/AR4_T03_VERTICAL_SHRUG_EXTENSION_PLAN.md`; full-state Packet V2 scalar, current torso-up adapter và head-tilt
gate đã implement, còn manual/performance gate. Lệnh cuối phiên: **76 test files / 766 tests PASS**, lint và
production build PASS. Quyết định bắt đầu code của
chủ dự án cho phép implementation đi trước audit năm model; audit/manual/performance gate không vì vậy được suy thành PASS.

Corrective webcam 2026-09-14: mọi detector xử lý cùng một camera frame dùng chung source-sample timestamp;
inference completion time chỉ thuộc performance metric, không được tạo skew calibration giả. Trong trạng thái
AR4 `idle/collecting`, processor tiếp tục phát Packet V1 legacy để head hiện hữu không bị khóa; chỉ chuyển nguyên tử
sang Packet V2 sau khi đủ paired neutral và trạng thái là `calibrated`.

### 0.2 Corrective sau manual webcam đầu–vai

Manual webcam phát hiện bốn lỗi liên quan: calibration bắt buộc hông nên kẹt `0/30` trong khung gọi thông thường;
pitch Face bị đảo; Pose torso yaw ngược Face; shoulder solver phụ thuộc hông nên không shrug và V1 fallback làm
đầu chuyển động tách khỏi cổ/thân. Corrective chốt lại contract:

- Face pitch giữ dấu X; chỉ Y/Z đổi basis.
- Calibration bắt buộc Face + hai vai. Hông là evidence tùy chọn.
- Nếu ít nhất 80% paired sample có hông đạt quality gate thì khóa mode `full-torso`; ngược lại khóa
  `shoulder-only` cho cả phiên, không tự promote khi người dùng tiến/lùi camera.
- Face và Pose đều neutral hóa riêng. Pose yaw được sửa tại observation boundary rồi mới tính
  `QheadRelative = inverse(QshoulderDelta) ⊗ QfaceDelta`.
- `shoulder-only` giữ torso pitch bằng 0 vì hai vai không quan sát được rotation quanh shoulder axis; yaw/roll,
  head–neck distribution, shoulder và arm vẫn chạy.
- Shrug không dùng hông làm điều kiện: elevation theo thay đổi khoảng vai–tai, fallback differential giữa hai vai;
  protraction trực tiếp vẫn chỉ claim differential.
- Phiên calibrated full có thể tạm fallback về shoulder observation khi mất hông bằng transition 220 ms; phiên
  calibrated shoulder-only không tự đổi full giữa chừng.

Review lần 1: **8.5/10 — CONDITIONAL APPROVAL / CHANGES REQUIRED**. Bản này đã xử lý toàn bộ blocker và
khuyến nghị: animated-parent arm infrastructure chuyển lên trước T01; temporal/loss hoàn tất trước hierarchy;
aggregate joint clamp; Packet V2; paired calibration + source hysteresis; `rotationOnlyTorsoOffsetProxy`; curl experimental;
shoulder common/differential; pause-safe life clock; speech component riêng; exact-neutral terminal assignment;
responsiveness metric và sáu regression còn thiếu.

### 0.1 Đóng từng ý review

| Review | Quyết định trong bản sửa |
|---|---|
| T01 animate chest trước arm parent fix | **Đã sửa:** arm parent-target support là infrastructure bắt buộc trước T01 behavior |
| Temporal/loss sau arm solve | **Đã sửa:** final primary temporal/lifecycle chạy trước layer compose, hierarchy và arm solve |
| Chỉ clamp từng layer | **Đã sửa:** thêm aggregate quaternion → log → joint ellipsoid clamp → exp |
| V1 đổi semantic `headRotation` | **Đã sửa:** chọn `AvatarPosePacketV2`; renderer có explicit V1 legacy fallback |
| Calibration khác cadence | **Đã sửa:** pair skew gate 50 ms và không reuse pair đã consume |
| Source threshold flapping | **Đã sửa:** freshness enter/exit hysteresis + minimum transition duration |
| “Weight shift” quá claim | **Đã sửa:** đổi thành `rotationOnlyTorsoOffsetProxy` |
| Curl chưa đủ chắc | **Đã sửa:** experimental/baseline-gated; unstable thì disable, không hạ threshold |
| Shoulder common/bilateral | **Đã sửa:** tách common shrug/differential; bilateral protraction ghi rõ unobservable |
| Raw wall clock làm phase jump | **Đã sửa:** dùng pause-aware `continuousLifeTime` accumulator |
| Speech chỉ modulate breathing | **Đã sửa:** tách `speechChest` response component, breathing modulation chỉ phụ |
| Exact neutral chưa toán học | **Đã sửa:** elapsed ≥ duration gán identity + zero velocity + idle |
| Jitter có thể đổi bằng lag | **Đã sửa:** gate jitter đi cặp t50/t90 response |
| T01 manual U3/U4 quá sớm | **Đã sửa:** T01 chỉ telemetry observation subset; full U3/U4 thuộc T02 |
| Thiếu automated cases | **Đã sửa:** thêm aggregate cap, temporal-parent, pause, skew, flapping và V1/V2 compatibility |

## 1. Mục tiêu

1. Không dồn toàn bộ yaw/pitch/roll vào `head`; phân phối liên tục qua chuỗi thân trên theo capability model.
2. Theo được nghiêng, xoay, cúi/ngả và curl thân trên từ Pose World Landmarks mà không tạo chuyển động giả khi
   evidence yếu.
3. Vai/xương đòn phản ứng độc lập với shrug và reach, nhưng không ghi đè hoặc làm lệch arm solver.
4. Có breathing nền, `speechChest` rất nhẹ và settle tự nhiên; faithful mode không tự sinh cử chỉ mang nghĩa.
5. Duplicate/loss/reacquire/model swap không snap, flip, drift hoặc giữ quaternion của model cũ.
6. Giữ nguyên privacy: camera, landmark và matrix chỉ xử lý trong browser; packet chỉ chứa rotation semantic đã solve.
7. Đạt NFR-01 `<100 ms`, NFR-02 `≥24 FPS` trên máy tham chiếu và FR-07 giảm jitter tối thiểu 30% so với raw.

## 2. Nguồn chân lý và phạm vi

- Roadmap: `docs/11_AVATAR_EVOLUTION_ROADMAP.md`, AR4-T01–T06.
- SRS: FR-05, FR-06, FR-07, FR-08, FR-09; NFR-01, NFR-02, NFR-06.
- Kiến trúc: `docs/02_SYSTEM_ARCHITECTURE.md`, client tracking/retargeting và packet motion hiện tại.
- Test/performance: `docs/07_DEVELOPMENT_AND_TESTING.md`, `docs/10_PERFORMANCE.md`.
- Baseline code: `torsoBasis.ts`, `coordinateAdapter.ts`, `avatarMotionProcessor.ts`, `armFrameSolver.ts`,
  `normalizedRigProfile.ts`, `modelLoader.ts`, `avatarRenderer.ts`.

Ngoài phạm vi AR4:

- Root translation hoặc full-body locomotion.
- Reachability IK chủ động kéo thân tới target ngoài tầm; thuộc AR5-T02.
- Continuous fingers, contact/collision state machine, hair/cloth physics.
- Audio model mới. Speech-chest AR4 chỉ được dùng activity scalar local đã có từ webcam mouth.
- Gaze prediction/convergence hoặc “mắt dẫn đầu đầu”; chỉ giữ contract để AR12 có thể dùng sau.
- Scapula bone thật: VRM humanoid không chuẩn hóa bone này; AR4 chỉ approximation qua shoulder/clavicle.

## 3. Audit baseline và khoảng trống bắt buộc xử lý

| Hiện trạng | Khoảng trống AR4 |
|---|---|
| `headRotation` là facial quaternion legacy/unverified và áp thẳng vào head | Chưa neutral-relative, chưa tách head so với torso, chưa loss/reacquire riêng |
| `AvatarJointName` có `neck`, `chest`, shoulder nhưng thiếu `spine`, `upperChest`, `hips` | Chưa mô tả đủ chuỗi AR4 |
| Loader mới capture head/neck/chest/hips/shoulder | Phải audit/capture thêm spine và upperChest, cùng rest hierarchy/axes |
| `buildTorsoBasis` đã có shoulder/hip basis | Chưa calibration, quality, curl, torso-offset proxy hoặc temporal owner |
| Upper arm dùng `parentRestWorldRotation` vì shoulder được coi fixed-rest | Khi chest/shoulder quay, arm world target sẽ sai nếu không đổi parent target |
| Renderer áp `restLocal × deltaLocal` | Có thể tái dùng, nhưng phải có đúng một composer phía processor |

Điểm khóa kiến trúc: **AR4 không được chỉ ghi thêm chest/shoulder quaternion vào packet**. Upper-body target phải
được compose trước; arm solver phải nhận world rotation thực của parent đã animate.

## 4. Quyết định kiến trúc cần reviewer duyệt

| Chủ đề | Quyết định đề xuất |
|---|---|
| Temporal owner | Processor là owner duy nhất; renderer không smoothing head/torso/shoulder lần hai |
| Packet version | Tạo `AvatarPosePacketV2`; V2 định nghĩa rõ calibrated rest-relative head và optional upper-body joints |
| Head compatibility | Renderer nhận V1 qua legacy path và V2 qua AR4 path; không diễn giải cùng field theo hai semantic |
| Rig profile | Tạo `UpperBodyRigProfileV1` riêng, gắn model generation/fingerprint; không làm phình arm profile hiện tại |
| Neutral | Calibration đồng thời face + torso; mọi output là delta so với neutral session, không áp absolute camera pose |
| Capability thiếu bone | Redistribute weight trên bone còn tồn tại, có per-joint cap; không giả shoulder bằng upperArm |
| Composition | Temporal/loss primary hoàn tất trước; `UpperBodyComposer` aggregate-clamp rồi tạo final parent-world chain cho arm |
| Root motion | Không thêm root/chest position hoặc scale; AR4-T03.1 chỉ thêm optional semantic shoulder displacement scalar để renderer dịch cục bộ hai shoulder bone |
| Faithful | Chỉ observed motion + breathing sinh lý nhỏ; idle sway procedural chỉ bật ở cinematic |
| Loss | Hold → return → exact neutral; breathing có thể tiếp tục, sway/shoulder assist dừng |
| Validation | Config/profile validate một lần khi construct/load, không validate/allocation lớn trong frame loop |

## 5. Quy ước toán học dùng chung

### 5.1 Hệ tọa độ

Giữ convention hiện tại:

```text
MediaPipe (x, y, z) → motion semantic (x, -y, -z)
+X: phải màn hình
+Y: lên
+Z: hướng semantic đã được coordinateAdapter chuẩn hóa
```

Mọi quaternion phải unit length, finite và dùng hemisphere continuity:

```text
if dot(qPrevious, qCurrent) < 0 then qCurrent = -qCurrent
```

Không trừ Euler trực tiếp giữa hai pose.

### 5.2 Quaternion delta, log và exp

Với phép nhân `⊗` và quaternion đơn vị:

```text
delta(q0, q) = inverse(q0) ⊗ q

q = [v, w], chọn hemisphere w ≥ 0
theta = 2 × atan2(|v|, w)
log(q) = theta × v / |v|                    nếu |v| > epsilon
log(q) = (0,0,0)                            nếu |v| ≤ epsilon

exp(r) = [sin(|r|/2) × r/|r|, cos(|r|/2)]
q^a = exp(a × log(q))
```

`log(q)` tạo rotation vector radian để phân phối theo trục mà không cộng Euler không giao hoán.

### 5.3 Clamp giải phẫu

Trong semantic vector `r = (pitch, yaw, roll)`, dùng ellipsoid bất đối xứng:

```text
Lpitch = pitch ≥ 0 ? pitchUpLimit : pitchDownLimit
Lyaw   = yaw   ≥ 0 ? yawRightLimit : yawLeftLimit
Lroll  = roll  ≥ 0 ? rollRightLimit : rollLeftLimit

rho² = (pitch/Lpitch)² + (yaw/Lyaw)² + (roll/Lroll)²
scale = rho² > 1 ? 1/sqrt(rho²) : 1
rSafe = scale × r
```

Các giới hạn dưới đây là **safety seed cần review**, không phải threshold nghiệm thu cuối:

| Joint/intent | Yaw | Pitch lên/xuống | Roll |
|---|---:|---:|---:|
| Tổng head-relative | ±50° | +25° / -35° | ±25° |
| Head contribution | ±32° | +20° / -25° | ±18° |
| Neck contribution | ±22° | +12° / -16° | ±12° |
| Chest/upperChest cho head-relative | ±8° | ±6° | ±5° |
| Tổng torso observed | ±30° | +18° / -25° | ±20° |
| Shoulder elevation/protraction | ±12° | — | protract +10° / retract -6° |

### 5.4 Temporal

Observation filter theo **sample timestamp**, không theo render FPS. Với scalar/quaternion-log component:

```text
alpha(dt, tau) = 1 - exp(-dt/tau)
xFiltered = xPrevious + alpha × (xTarget - xPrevious)
```

One Euro vẫn dùng cho observed head/torso; exponential/slerp chỉ dùng cho mode/source transition và loss return.
Duplicate/reversed timestamp không promote filter, calibration hoặc metric fresh-sample.

Freshness mode có hysteresis để không flap ở biên:

```text
enter torso-relative khi agePose ≤ 60ms và skew ≤ 60ms
exit torso-relative  khi agePose ≥ 90ms hoặc skew ≥ 90ms
minimumSourceDwell = 180ms
```

Settle dùng critically damped spring, không overshoot:

```text
x'' + 2ζω x' + ω²(x - xTarget) = 0,  ζ = 1
```

Tích phân semi-implicit với `dt` clamp; reset velocity khi model swap hoặc timestamp gap vượt cấu hình.

## 6. Contract dữ liệu và capability

### 6.1 Packet V2 và joint keys

AR4 tạo contract mới thay vì đổi nghĩa `headRotation` trong V1:

```ts
interface AvatarPosePacketV2 {
  version: 2;
  // Các field tracking/expressions/gaze/handMotion giữ contract tương ứng từ V1.
  headRotation: QuaternionData | null; // calibrated, rest-relative normalized humanoid delta
  jointRotations: Partial<Record<AvatarPoseJointNameV2, QuaternionData>>;
  // Full-state snapshot [-1,1]; optional để receiver V2 cũ ignore an toàn.
  shoulderMotion?: { version: 1; leftVertical: number; rightVertical: number } | null;
}
```

Mở rộng joint type V2:

```ts
type AvatarUpperBodyJointName =
  | "hips" | "spine" | "chest" | "upperChest"
  | "neck" | "leftShoulder" | "rightShoulder";
```

`head` tiếp tục ở `headRotation`, nhưng semantic mới chỉ tồn tại trong packet `version: 2`. Mọi joint khác đi
trong `jointRotations` dưới dạng normalized-humanoid parent-local/rest-relative delta. Không đưa landmark, matrix,
neutral sample hoặc diagnostics vào packet.

`shoulderMotion` là ngoại lệ displacement semantic đã xử lý, không phải raw/model-space position: sender mới emit ở
mọi V2 packet khi feature khả dụng; duplicate/loss vẫn mang state held/returning/idle. Omitted/null nghĩa sender cũ
hoặc capability unavailable. Renderer scale theo rig shoulder width và áp từ rest position theo current torso-up.

Compatibility bắt buộc:

- Renderer dispatch bằng discriminated union `AvatarPosePacketV1 | AvatarPosePacketV2`, không đoán theo field.
- V1 giữ nguyên legacy head behavior trong thời gian chuyển đổi; V2 dùng AR4 behavior.
- Sender AR4 chỉ phát V2 sau khi local renderer V2 gate PASS.
- Không có persisted/replay packet production hiện tại; test fixture V1 vẫn phải render như trước.
- Unknown V2 joint/bone bị ignore an toàn; invalid/nonfinite trả bone về rest theo ownership.
- Trước P4-T15, serializer/deserializer và mixed-version test phải khóa rõ reject/fallback; DataChannel không gửi
  V2 cho peer chỉ khai báo V1.

### 6.2 UpperBodyRigProfileV1

Profile bất biến theo model generation gồm:

- Bone availability và hierarchy thực: hips/spine/chest/upperChest/neck/head/leftShoulder/rightShoulder.
- `restLocalRotation`, `restWorldRotation`, `parentRestWorldRotation` từng joint.
- Rest semantic axes chuyển vào local của từng bone.
- Rest segment lengths: hip→spine→chest→upperChest→neck→head và shoulder width.
- Axis/cap map từng joint; side sign cho shoulder elevation/protraction.
- Fingerprint + model generation; mismatch bắt buộc no-op/reset.

Capability class:

| Class | Điều kiện | Hành vi |
|---|---|---|
| Full | spine, chest, upperChest, neck, head, hai shoulder | Đủ T01–T04 |
| Reduced | head + neck và ít nhất một torso bone | Redistribute có cap; diagnostic degraded |
| Head-only | chỉ head usable | T01 head-only conservative; T02/T03 N/A |
| Partial shoulder | chỉ một shoulder | Side đó chạy; side thiếu no-op, không fallback upperArm |
| Unsupported | không head và không torso usable | AR4 no-op; arm/face/gaze cũ vẫn chạy |

### 6.3 Single-owner composition

Thứ tự bắt buộc trong mỗi fresh output:

```text
raw observations
→ quality/freshness + paired-source selection
→ source transition + observation temporal filter
→ hold/return/reacquire primary FINAL targets
→ head-relative + torso + shoulder + life layer intents
→ clamp từng layer/intent
→ compose layer quaternions theo joint
→ FINAL aggregate joint clamp
→ parent-to-child FINAL target world rotations
→ arm solver dùng FINAL animated parent target
→ packet rest-relative deltas
→ renderer apply trực tiếp restLocal × deltaLocal
```

Nếu nhiều layer cùng tác động joint, composer ghép theo thứ tự cố định:

```text
deltaJoint = torsoBase ⊗ headRelative ⊗ observedShoulder ⊗ lifeSecondary
```

Sau composition:

```text
rAggregate = log(deltaJoint)
rFinal = clampJointEllipsoid(rAggregate, jointCaps)
deltaJointFinal = exp(rFinal)
```

Mỗi layer chỉ xuất semantic contribution; không layer nào tự ghi packet. Arm solver tuyệt đối không được nhận raw
hoặc pre-temporal parent target.

## 7. AR4-T01 — Head–neck–spine distribution

### 7.1 Entry slice: capability + baseline trước behavioral code

1. Audit 5 VRM DEV: bone availability, hierarchy, rest axes, model fingerprint.
2. Thêm raw-vs-current-head metric-only telemetry, không đổi animation.
3. Thu baseline neutral/head yaw/pitch/roll, jitter, latency/FPS trên ít nhất 3 model.
4. Duyệt safety limits và metric thresholds trước khi bật solver mới.

### 7.2 Infrastructure bắt buộc hoàn thành trước T01 behavior

Infrastructure không phải feature torso và không được dời sang T02:

1. `UpperBodyRigProfileV1`, quaternion math, V1/V2 packet dispatch.
2. Primary temporal/lifecycle finalization trước composition.
3. `UpperBodyComposer` với final aggregate joint clamp.
4. Parent-to-child final world hierarchy.
5. `armFrameSolver(parentTargetWorldRotation)` và world-direction invariance regression.

Với arm world target `QarmWorld*` và **final post-temporal/post-clamp** parent target `QparentWorld*`:

```text
Qlocal* = inverse(QparentWorld*) ⊗ QarmWorld*
deltaArm = inverse(QrestLocal) ⊗ Qlocal*
```

Ngay cả T01 chỉ phân phối vài phần trăm vào chest/upperChest, arm solver vẫn phải dùng công thức này. Không có
infrastructure gate PASS thì chest/upperChest contribution của T01 không được bật.

### 7.3 Neutral head-relative observation

Tại calibration, chỉ nhận pair Face/shoulder-Pose mới và chưa từng consume:

```text
abs(tFace - tPose) ≤ calibrationSkewLimitMs = 50ms
faceFresh && poseFresh && qualityFace ≥ gate && qualityShoulders ≥ gate
```

`tFace` và `tPose` là source-sample time. Khi Face/Pose cùng đọc một camera frame, hai giá trị phải bằng nhau dù
các model inference chạy nối tiếp và kết thúc ở hai thời điểm khác nhau.

Không ghép `Qface` mới với cached Pose cũ để tăng giả số sample. Thu `Qface0`, `Qshoulder0` và — khi đủ hông —
`Qtorso0` bằng quaternion geodesic mean trên paired sample được chấp nhận. Với frame mới:

```text
QfaceDelta     = inverse(Qface0)     ⊗ Qface
QshoulderDelta = poseYawCorrect(inverse(Qshoulder0) ⊗ Qshoulder)
QheadIntent    = inverse(QshoulderDelta) ⊗ QfaceDelta
```

Face/pose có cadence khác nhau. Runtime dùng freshness hysteresis `enter 60ms / exit 90ms`, source dwell tối thiểu
180ms và transition slerp. Nếu torso-relative mode đã exit, dùng face delta neutral:

```text
QfaceDelta = inverse(Qface0) ⊗ Qface
```

Chuyển `torso-relative ↔ face-only` bằng slerp source transition; không đổi mode trong một frame và không restart
transition do threshold dao động.

Quality:

```text
qFace = validMatrix × freshnessFace
qShoulders = min(visibility shoulders) × freshnessPose × basisQuality
qFullTorso = min(visibility shoulders/hips) × freshnessPose × basisQuality
qHead = qFace × (0.65 + 0.35 × qShoulders)
```

Matrix nonfinite/degenerate bị reject; không phát identity như observation fresh.

### 7.4 Phân phối rotation

```text
rHead = clampEllipsoid(log(QheadIntent))
rJoint(axis) = normalizedWeight(joint, axis, capability) × rHead(axis)
```

Seed weights, tổng mỗi cột bằng 1:

| Joint | Yaw | Pitch | Roll |
|---|---:|---:|---:|
| chest | 0.04 | 0.03 | 0.03 |
| upperChest | 0.08 | 0.06 | 0.06 |
| neck | 0.30 | 0.26 | 0.24 |
| head | 0.58 | 0.65 | 0.67 |

Nếu bone thiếu: bỏ weight của bone đó rồi normalize lại trên bone hiện hữu. Nếu bone nhận vượt cap, giữ tại cap
và redistribute phần dư có giới hạn; không ép phần dư vào head bằng mọi giá. Residual bị drop phải hiện telemetry.

### 7.5 T01 acceptance

- Neutral không drift; yaw/pitch/roll đúng dấu trên fixture và webcam.
- Tổng contribution gần desired trong cap; không double-apply head.
- Missing upperChest/spine vẫn continuity, head-only không vượt cap.
- Duplicate/reversed/loss/reacquire/model swap đúng lifecycle.
- AR3 gaze và F1–F4 không regression khi đầu quay.
- Packet V2/renderer AR4 dùng calibrated rest-relative `headRotation`; V1 fixture giữ legacy path không đổi.
- Parent temporal consistency PASS ngay khi chest/upperChest contribution của T01 được bật.

## 8. AR4-T02 — Torso motion

### 8.1 Torso observation

Từ Pose World Landmarks đã đổi coordinate:

```text
S = (leftShoulder + rightShoulder) / 2
H = (leftHip + rightHip) / 2
R = normalize(leftShoulder - rightShoulder)
Uraw = normalize(S - H)
U = normalize(Uraw - dot(Uraw,R)R)
F = normalize(R × U)
Qtorso = quaternionFromBasis(R,U,F)
QtorsoDelta = inverse(Qtorso0) ⊗ Qtorso
```

Trong khung đầu–vai, dùng basis tối thiểu:

```text
R = normalize(leftShoulder - rightShoulder)
U = normalize(cameraUp - dot(cameraUp,R)R)
F = normalize(R × U)
Qshoulder = basis(R,U,F)

rawDelta = inverse(Qshoulder0) ⊗ Qshoulder
shoulderDelta = exp(log(rawDelta).x, -log(rawDelta).y, log(rawDelta).z)
shoulderDelta.pitch = 0
```

Đảo yaw chỉ diễn ra một lần tại Pose observation boundary để đồng nhất với Face; không đảo trong từng solver hoặc
renderer. `shoulder-only` không claim torso pitch/curl. `full-torso` dùng đủ shoulder–hip basis; nếu hông tạm mất,
blend về shoulder delta đã được calibration cùng phiên trong 220 ms.

Basis quality giảm theo min visibility, shoulder/hip width collapse, non-orthogonality trước Gram–Schmidt và
face/pose inconsistency. Không lấy image landmark thay world landmark khi depth thiếu.

### 8.2 Bend/twist/lean, experimental curl và torso-offset proxy

```text
rTorso = log(QtorsoDelta)
pitch/bend = dot(rTorso, Xneutral)
yaw/twist  = dot(rTorso, Yneutral)
roll/lean  = dot(rTorso, Zneutral)
```

Curl approximation dùng ear center `E` khi hai ear đủ quality:

```text
lower = normalize(projectSagittal(S - H))
upper = normalize(projectSagittal(E - S))
curlRaw = atan2(dot(R, lower × upper), dot(lower, upper))
curl = curlRaw - curlNeutral
```

Vì ear chịu ảnh hưởng quay đầu, curl là **experimental / baseline-gated**, không phải core T02 v1. Nó chỉ chạy
khi head yaw/roll dưới gate và quality đủ; nếu không thì giữ ngắn rồi fade, không suy từ face matrix. Nếu baseline
trên ba model không ổn định, `curlEnabled=false` trong v1; tuyệt đối không hạ quality threshold để cố giữ feature.

`rotationOnlyTorsoOffsetProxy` (không gọi là weight/CoM shift):

```text
height = max(epsilon, dot(S-H, Uneutral))
lateralOffsetProxy = atan2(dot(S-H, Rneutral), height) - lateralNeutral
depthOffsetProxy   = atan2(dot(S-H, Fneutral), height) - depthNeutral
```

Đây chỉ là orientation/offset của shoulder center so với hip center, không chứng minh chuyển trọng lượng thật qua
chân hoặc center of mass. AR4 v1 ánh xạ proxy thành hips/chest counter-rotation nhỏ; không phát translation giả.

### 8.3 Phân phối torso chain

| Joint | Yaw/twist | Pitch/bend | Roll/lean |
|---|---:|---:|---:|
| hips | 0.10 | 0.08 | 0.08 |
| spine | 0.22 | 0.25 | 0.22 |
| chest | 0.34 | 0.35 | 0.35 |
| upperChest | 0.34 | 0.32 | 0.35 |

Các rotation cùng trục semantic được phân đoạn để cumulative descendant orientation xấp xỉ torso intent.
Head-relative intent T01 được ghép **sau** torso base, nên khi người dùng quay cả thân và giữ đầu thẳng theo thân,
head thừa hưởng torso mà không bị counter-rotate giả.

### 8.4 Dùng lại ancestor-aware infrastructure

T02 chỉ thêm torso observation/layer vào infrastructure đã PASS ở T01. `armFrameSolver` luôn nhận final animated
parent target; T02 không được tạo một nhánh parent composition thứ hai. Regression temporal-parent chạy lại với
raw torso target khác filtered torso target để chứng minh arm dùng đúng final parent.

### 8.5 T02 acceptance

- Bend/twist/lean đúng dấu; telemetry dùng `rotationOnlyTorsoOffsetProxy`, không claim true weight shift.
- Curl chỉ xuất hiện khi baseline gate đủ; nếu không thì disabled/N/A có evidence.
- Head-relative orientation giữ ổn định khi torso chuyển động.
- Không làm lệch wrist/elbow world target hoặc phá pole/twist continuity hiện tại.
- Model thiếu torso bone redistribute hoặc N/A rõ ràng; không NaN.
- Loss/reacquire torso không kéo head/arms snap.

## 9. AR4-T03 — Shoulder/clavicle/scapula approximation

### 9.1 Evidence theo từng bên

Với side `i`, shoulder `Si`, ear `Ai`, elbow `Ei`, wrist `Wi`, shoulder width neutral `W0` và neutral basis
`(R0,U0,F0)`:

```text
shoulderSpan = leftShoulder - rightShoulder
differentialShrug = (dot(shoulderSpan,U0) - neutralSpanUp) / (2W0)
headGap_i = dot(Ai - Si,U0)
earShrug_i = (neutralHeadGap_i - headGap_i) / W0

observedElevation_i = earShrug_i
fallback nếu ear i không đạt quality:
  observedElevationLeft  = +differentialShrug
  observedElevationRight = -differentialShrug

differentialProtraction = (dot(shoulderSpan,F0) - neutralSpanForward) / (2W0)
observedProtractionLeft  = +differentialProtraction
observedProtractionRight = -differentialProtraction

upperDir_i = normalize(Ei - Si)
reachUp_i = smoothstep((dot(upperDir_i,U0) - upOnset) / (upFull-upOnset))
reachForward_i = smoothstep((dot(Wi-Si,F0)/W0 - forwardOnset) / (forwardFull-forwardOnset))
```

Khoảng vai–tai cho phép nhận cả shrug một bên và hai bên trong khung không thấy hông. Dùng neutral axes thay vì
current shoulder basis để đường vai hiện tại không tự triệt tiêu chính elevation cần đo. Observed differential và arm-derived
clavicle assist được fusion theo confidence:

```text
elevation_i = clamp(kObserved × observedElevation_i + kUp × reachUp_i, -downCap, upCap)
protraction_i = clamp(kDifferential × observedProtraction_i + kForward × reachForward_i, retractCap, protractCap)
```

`kUp/kForward` chỉ là clavicle assist nhỏ, không phải reachability solver. Hai side có state/filter riêng.

Giới hạn observability phải hiện trong diagnostic/acceptance: hai vai cùng protract một lượng giống nhau làm midpoint
`S` cùng đi tới trước, nên shoulder geometry không tách chắc được bilateral protraction khỏi torso fore/aft offset.
AR4 chỉ claim **observed differential protraction**; bilateral protraction chủ yếu là bounded reach-derived assist,
không được báo là direct shoulder observation.

### 9.2 Rest-derived axes

Không hard-code local X/Y/Z cho mọi model. Loader dựng world semantic axes từ torso rest frame và đổi về local:

```text
axisLocal = inverse(QshoulderRestWorld) rotate axisWorld
elevationAxisWorld(side) = sideSign × Frest
protractionAxisWorld(side) = sideSign × Urest
```

Side sign và hướng thực được khóa bằng fixture model. Delta shoulder:

```text
Qshoulder = exp(elevation × elevationAxisLocal)
          ⊗ exp(protraction × protractionAxisLocal)
```

Nếu shoulder bone thiếu, output side đó N/A; tuyệt đối không ghi compensation vào upperArm.

### 9.3 Arm integration

Composer cập nhật shoulder target world trước khi solve upper arm. Upper/lower-arm target vẫn do arm solver sở hữu;
T03 chỉ sở hữu `leftShoulder/rightShoulder`. Khi shoulder assist bật, arm solver recompute local upperArm delta để
world direction/end-effector không bị double-rotate.

### 9.4 T03 acceptance

- Shrug/hạ từng vai đúng bên; vai còn lại không cross-talk rõ.
- Hai vai cùng nhún vẫn giữ torso center, không biến thành head bob.
- Nâng tay cao có clavicle assist nhẹ; không còn “tay cao nhưng vai đứng yên”.
- Arm world direction, elbow pole, hand twist và finger output không regression.
- Partial shoulder capability no-op đúng side; swap model reset rest.

## 10. AR4-T04 — Breathing, idle và settle

### 10.1 Breathing

Breathing dùng pause-aware `continuousLifeTime`, không đọc raw absolute wall clock trực tiếp:

```text
if documentVisible && 0 ≤ dt ≤ lifeGapLimit:
    continuousLifeTime += dt
else:
    continuousLifeTime += 0

phase = 2π × continuousLifeTime/T + phi
b(t) = 0.72 sin(phase) + 0.18 sin(2phase + 0.4)
```

Khi `visibilitychange → visible` hoặc gap lớn, frame đầu giữ nguyên phase/output, đặt lại time anchor rồi tiếp tục.
Không cố nhảy ngay tới phase “đáng lẽ” theo đồng hồ thật. Mode transition blend output life motion; không reset phase.

Seed ban đầu: `T = 4.2 s`; chest pitch ≤0.6°, upperChest pitch ≤0.8°, shoulder elevation ≤0.25°. Đây là
rotation proxy vì AR4 v1 không truyền scale/position. Khi tracking active, breathing cộng sau observed torso với cap;
khi mất tracking, breathing có thể tiếp tục quanh neutral.

### 10.2 Speech-modulated breathing và speechChest riêng

Dùng webcam mouth activity scalar đã có, không dùng microphone/model mới:

```text
sTarget = clamp01(visibleOpening × (1 - closure))
s = attackRelease(sTarget, attack=80ms, release=260ms)
A_breath = A_idle × (1 + 0.35s)
speechChest = clamp(kSpeech × s, 0, speechChestCap)
lifeChest = breathingChest + speechChest
```

`speechChest` là response component riêng theo speech envelope với cap seed ≤0.35°; amplitude modulation chỉ là
secondary. Nhờ đó ngực có phản hồi đúng lúc nói thay vì chỉ chờ phase thở. Không suy emotion hoặc nhịp câu.

### 10.3 Idle sway và posture correction

- Faithful: sway procedural = 0; chỉ observed posture + breathing.
- Cinematic: band-limited sway deterministic, tổng yaw/roll ≤0.4°, tắt khi motion magnitude cao hoặc evidence loss.
- Không random per-frame. Seed theo session và phase liên tục để đổi mode không jump.
- Posture correction chỉ là critically damped settle về observed/neutral target; không tự tạo gesture.

### 10.4 Settle

Khi angular velocity observed giảm dưới onset liên tục trong cửa sổ ổn định, target về pose quan sát cuối và velocity
spring decay về 0. Không overshoot (`ζ=1`). Reacquire blend có ưu tiên cao hơn idle sway; breathing không làm metric
settle bị tính nhầm, vì metric đo observed/primary channel riêng.

Spring chỉ điều khiển đoạn chuyển tiếp. Exact terminal contract:

```text
if elapsedReturn >= returnDuration:
    primaryRotation = identity
    primaryAngularVelocity = (0,0,0)
    lifecycle = idle
```

Không dùng epsilon/asymptotic decay để quyết định “exact neutral”.

### 10.5 T04 acceptance

- Breathing tinh tế, không giống gật đầu hoặc nhún vai.
- Faithful bit-exact ngoài observed motion + breathing đã định nghĩa; không có sway/cử chỉ ngẫu nhiên.
- Cinematic sway deterministic, bounded và không sửa ý định primary.
- 15/30/60 render FPS cho cùng timestamp trajectory tạo kết quả tương đương.
- Loss, tab pause, timestamp gap và model swap không gây phase jump/NaN; first-resume angular delta nằm trong gate.

## 11. Lifecycle và state machine chung

Mỗi source face/pose/shoulder có state độc lập:

```text
idle → active → held → returning → idle
                 ↘ reacquiring → active
```

Seed timing cần review:

| Source | Hold | Return | Reacquire |
|---|---:|---:|---:|
| Head/face | 120 ms | 300 ms | 180 ms |
| Torso/pose | 160 ms | 420 ms | 220 ms |
| Shoulder side | 120 ms | 300 ms | 180 ms |

Quy tắc:

- Face loss nhưng Pose còn: torso/shoulder tiếp tục; head-relative hold rồi return về neutral trên torso hiện tại.
- Pose loss nhưng Face còn: torso/shoulder hold-return; head chuyển source có blend, không dùng torso stale vô hạn.
- Cả hai loss: toàn primary return neutral; breathing tiếp tục, cinematic sway tắt.
- Mọi primary return dùng progress hữu hạn theo `returnDuration`; ngay khi `elapsedReturn >= returnDuration`, gán chính xác
  rotation = identity, angular velocity = 0 và lifecycle = `idle` thay vì chờ spring tiệm cận epsilon.
- Model swap/dispose: reset profile generation, filters, neutral, spring velocity và mọi applied joint về rest.
- Toggle Filter OFF: bỏ observation smoothing nhưng vẫn giữ safety clamp/lifecycle; dùng cho diagnostic, không default.

## 12. AR4-T05 — Automated, manual và performance gate

### 12.1 Automated matrix

| Nhóm | Ca bắt buộc |
|---|---|
| Math | Quaternion log/exp round-trip, hemisphere, near-zero/near-π, ellipsoid clamp |
| Calibration | Neutral offset bất kỳ vẫn ra identity; paired face/pose skew 49/50/51 ms; không consume pair trùng; reject nonfinite/low-quality; model fingerprint reset |
| Distribution | Weight sum, missing-bone redistribution, cap/residual, không double-apply head; **aggregate cap** khi torso + head + life cùng gần cap |
| Torso | Global camera rotation invariance, bend/twist/lean sign, curl confidence gate, degenerate basis |
| Temporal | Fresh/duplicate/reversed, timestamp gap, 15/30/60 render FPS, hold/return/terminal exact neutral/reacquire; source enter/exit flapping + minimum dwell |
| Shoulder | Left/right sign, independent state, missing side, reach assist cap, no fallback upperArm |
| Composition | Parent target world đúng hierarchy; rest-relative delta; arm world target invariant khi torso/vai ON; **raw parent 30°/filtered parent 15°** chứng minh arm dùng final 15° |
| Lifecycle | Face-only loss, pose-only loss, both loss, reload/swap/dispose, Filter ON/OFF; hidden 10s rồi resume không life-phase jump |
| Regression | F1–F4, AR3 gaze, arm/hand/finger, renderer smoothing ownership, V1 legacy replay + V2 dispatch/unknown-joint, packet serialization/privacy |
| Performance | Allocation bounded, solver timing avg/p95, packet-size delta, no landmark/matrix in packet |

### 12.2 Manual webcam matrix trên ≥3 VRM capability-diverse

Chạy mỗi model trước ở khung gọi thông thường chỉ thấy đầu–vai: calibration phải đạt `30/30`, badge báo
`shoulder-only`, Packet V2 và U1/U2/U6/U7 vẫn hoạt động. Sau đó mới chạy thêm khung thấy eo; recalibrate để badge
báo `full-torso` rồi kiểm U3–U5. Không yêu cầu người dùng phải thấy hông để dùng đầu/cổ/vai.

| Case | Thao tác | Kỳ vọng |
|---|---|---|
| U1 | Neutral 10 giây | Head/torso/shoulder không drift; breathing chỉ rất nhẹ |
| U2 | Quay/ngẩng/cúi/nghiêng đầu ở khung đầu–vai | Đúng dấu, chuyển động phân phối qua cổ/đầu/ngực nhẹ, không cổ gãy |
| U3 | Quay thân khi đầu giữ theo thân | Thân quay; đầu thừa hưởng tự nhiên, gaze không chạy ngược |
| U4 | Quay thân nhưng giữ mặt nhìn camera | Head counter relative vừa đủ, không vượt clamp/snap |
| U5 | Nghiêng/cúi/ngả/co thân | Bend/lean/curl hợp lý; evidence yếu phải degrade thay vì rung |
| U6 | Không để hông trong khung; nhún vai trái, phải, rồi cả hai | Đúng side; cả hai vai nhận được; cross-talk thấp; không head bob giả |
| U6A | Sau calibration, tiến/lùi để hông xuất hiện hoặc mất | Mode phiên không tự promote; full→shoulder fallback có blend, không flip/snap |
| U7 | Nâng tay ngang/cao/đưa ra trước | Xương đòn tham gia nhẹ; wrist/elbow/hand không lệch hoặc flip |
| U8 | Kết hợp quay thân + hai tay + gaze/blink/mouth | Không layer nào ghi đè layer khác |
| U9 | Che mặt nhưng còn Pose; che Pose nhưng còn face | State độc lập, hold/return/reacquire không snap |
| U10 | Ra khung rồi trở lại; pause tab | Exact neutral/khôi phục mượt, không phase jump |
| U11 | Reload/đổi model giữa pose lệch | Model cũ về rest; profile/neutral generation mới, không state leak |
| U12 | Faithful ↔ cinematic | Faithful không sway; cinematic sway nhỏ, đổi mode có blend |
| U13 | Chạy LIVE 60 giây/model | Không drift/kẹt; FPS/latency đạt gate; không camera egress |

### 12.3 Metrics và ngưỡng

Ngưỡng cứng từ tài liệu:

- Tracking→render `<100 ms` theo NFR-01.
- Tracking/render `≥24 FPS` theo NFR-02.
- Filtered inter-frame standard deviation giảm `≥30%` so raw theo FR-07.
- Nonfinite output, joint-limit violation và privacy egress: `0`.

FR-07 chỉ PASS khi jitter và responsiveness cùng đạt; không được tăng smoothing đến mức lag để đổi lấy jitter đẹp.

Với step test, chiếu rotation-vector output lên trục target và lấy `t50`/`t90` là timestamp fresh đầu tiên đạt lần lượt
50%/90% biên độ target. Đo cả observation đã lọc và final primary output; loại riêng các ca bị joint clamp, evidence loss
hoặc source transition để không trộn độ trễ filter với safety/lifecycle.

Candidate threshold cần baseline + phê duyệt **trước behavioral implementation**:

| Metric | Candidate gate |
|---|---:|
| Stationary head angular jitter p95 | ≤1.5°/fresh sample |
| Stationary torso angular jitter p95 | ≤1.2°/fresh sample |
| Head filter step response | t50 ≤100 ms; t90 ≤280 ms |
| Torso filter step response | t50 ≤120 ms; t90 ≤320 ms |
| Reacquire peak discontinuity | ≤8° head; ≤6° torso/shoulder |
| Settle time | ≤450 ms primary motion |
| Arm world-direction regression do ancestor composition | ≤2° |
| Shoulder opposite-side cross-talk khi shrug một bên | ≤20% active side |
| Clamp-stuck duration khi đã về neutral | 0 ms sau return window |
| Upper-body solver p95 | ≤1.5 ms trên máy tham chiếu |

Không gọi webcam direction/curl error là số chính xác nếu chưa có target/ground-truth calibration. Manual annotation
và scalar telemetry phải tách rõ.

## 13. File dự kiến

| File | Thay đổi dự kiến |
|---|---|
| `avatarPoseTypes.ts` | Thêm `AvatarPosePacketV2`, V1 legacy union và upper-body joint keys V2 |
| `upperBodyRigProfile.ts` | Capability, hierarchy, rest axes/caps, validation/freeze |
| `upperBodyCalibration.ts` | Face/torso neutral đồng bộ và quality gate |
| `quaternionDistribution.ts` | log/exp, ellipsoid clamp, weight redistribution |
| `headNeckSolver.ts` | T01 head-relative observation/distribution |
| `torsoMotionSolver.ts` | T02 torso/experimental-curl/rotation-only-offset observation |
| `upperBodyComposer.ts` | Single-owner per-joint contribution + target-world hierarchy |
| `shoulderMotionSolver.ts` | T03 bilateral shoulder/reach assist |
| `upperBodyTemporal.ts` | Timestamp filter, source transition, hold/return/reacquire/spring |
| `upperBodyLifeMotion.ts` | T04 pause-safe breathing, speechChest envelope và cinematic sway |
| `upperBodyMetrics.ts` | T05 local scalar collector |
| `normalizedRigProfile.ts`, `modelLoader.ts`, `modelCapability.ts` | Capture upper-body bones/profile/generation |
| `armFrameSolver.ts` | Nhận animated parent target world rotation |
| `avatarMotionProcessor.ts` | Orchestration theo pipeline đã khóa |
| `avatarRenderer.ts` | Apply trực tiếp, reset/rest lifecycle; không smoothing lần hai |
| `AvatarRendererDevHarness.tsx` | Controls, raw/final telemetry, capability, metrics/manual matrix |

Mỗi module mới có unit test cùng tên; integration/replay đặt ở processor/renderer test hiện có khi phù hợp.

## 14. Thứ tự triển khai và checkpoint duyệt

### Checkpoint 0 — trước AR4-T01 behavior

- AR3 corrective webcam retest được xác nhận.
- Audit 5 VRM và baseline metric-only hoàn thành.
- Chủ dự án/AI reviewer duyệt coordinate convention, packet compatibility, safety limits và candidate metrics.

### AR4 Infrastructure — bắt buộc trước T01 behavior

1. Capability/profile, quaternion math và Packet V1/V2 dispatch.
2. Paired neutral calibration + temporal/lifecycle/source hysteresis.
3. UpperBodyComposer + final aggregate clamp + final parent world hierarchy.
4. Arm `parentTargetWorldRotation` support và temporal-parent/world-direction regression.
5. Chưa bật head/torso/shoulder animation cho tới khi infrastructure tests PASS.

### AR4-T01

1. Head-relative observation/source switching trên infrastructure đã khóa.
2. Distribution cho chest/upperChest/neck/head + aggregate clamp.
3. Automated gate → manual U1/U2 trên ≥3 model.
4. U3/U4 ở T01 chỉ kiểm **head-relative observation telemetry** bằng torso fixture chưa animate; không tuyên bố full PASS.

### AR4-T02

1. Torso observation/quality/offset proxy; curl chỉ bật nếu baseline gate đủ.
2. Torso distribution dùng final hierarchy đã có.
3. Chạy lại arm temporal-parent/invariance regression với torso active.
4. Automated gate → full manual U3–U5 và phần torso của U7.

### AR4-T03

1. Shoulder rest axes/profile.
2. Bilateral observed shrug + bounded reach assist.
3. Composer/arm integration.
4. Automated gate → manual U6–U8.

### AR4-T04

1. Pause-safe breathing + speech-modulated amplitude + speechChest component riêng.
2. Critical settle.
3. Cinematic-only deterministic sway và mode blend.
4. Automated gate → manual U1/U10/U12.

### AR4-T05

1. Full regression, privacy và packet compatibility.
2. Manual U1–U13 trên ≥3 capability-diverse VRM.
3. 60 giây × protocol performance, baseline/ngưỡng report PASS/FAIL trung thực.
4. Chỉ đánh dấu AR4 DONE sau xác nhận của chủ dự án.

## 15. Rủi ro và chốt chặn

| Rủi ro | Chốt chặn |
|---|---|
| Face matrix và Pose basis khác frame/convention | Neutral-relative fusion + sign fixtures + source telemetry; không tune mù |
| Cộng Euler gây sai khi rotation kết hợp | Quaternion log/exp + fixed-order composition |
| Chest/shoulder làm lệch tay | Animated parent target bắt buộc + world-direction regression |
| Missing upperChest/spine làm dồn hết lên head | Capability redistribution có per-joint cap/residual |
| Curl giả khi người dùng chỉ cúi đầu | Ear/head-yaw quality gate, cap thấp và fade |
| Shoulder assist biến thành reach solver | Gain/cap thấp; AR5 vẫn sở hữu reachability |
| Hai temporal owner gây lag | Processor-only; renderer direct apply |
| Procedural idle sai ý người dùng | Faithful sway=0; breathing nhỏ; cinematic explicit |
| Model swap giữ state rig cũ | Fingerprint/generation guard + reset-to-rest test |
| Realtime GC/FPS regression | Validate once, reuse state/buffer, solver timing metric |
| Privacy regression | Packet serialization test + network inspection; không diagnostic/raw data trong packet |

## 16. Checklist reviewer lần 2 trước code

1. Xác nhận Packet V2 + explicit V1 legacy fallback đã đóng semantic compatibility blocker.
2. Xác nhận temporal/lifecycle finalization đứng trước aggregate composition, hierarchy và arm solve.
3. Xác nhận arm animated-parent infrastructure hoàn thành trước khi T01 bật chest/upperChest contribution.
4. Xác nhận final quaternion aggregate clamp bảo đảm joint cap sau khi cộng mọi layer.
5. Xác nhận calibration skew 50 ms, freshness hysteresis 60/90 ms và dwell 180 ms đủ chặn source flapping.
6. Xác nhận curl experimental/baseline-gated và bilateral protraction limitation được mô tả trung thực.
7. Xác nhận pause-aware life clock, terminal exact-neutral và speechChest riêng đã đóng lifecycle blocker.
8. Duyệt hoặc điều chỉnh safety seeds và candidate jitter+t50/t90 metrics trước behavioral implementation.
