# AR5-T01 — Kế hoạch Anatomical Arm Constraints

Ngày lập: 2026-09-16

Trạng thái: **IMPLEMENTATION ĐÃ ROLLBACK — CHƯA CODE TRÊN MAIN — CẦN CORRECTIVE REVIEW**

Review toán học đã hợp nhất: 2026-09-16

Lần triển khai thử ngày 2026-09-16 đã được gỡ hoàn toàn theo yêu cầu chủ dự án vì gây lỗi chuyển động tay.
Tài liệu này được giữ làm đầu vào cho corrective review; không được diễn giải là code hiện hành đã triển khai.

Phụ thuộc roadmap: **AR1-T04, AR4-T06**. AR4-T06 đã DONE theo owner acceptance 2026-09-16. AR1 chưa được đóng
theo đúng chuỗi roadmap; việc chuyển tiếp dùng owner waiver đã áp dụng cho nhánh AR3/AR4. AR5-T01-01 phải audit
và hoàn thiện đúng capability/profile subset mà arm constraint cần; waiver không được diễn giải thành AR1-T04 DONE.

Ước tính: **14–22 giờ code/test**, chưa gồm manual tuning trên nhiều VRM

## 1. Mục tiêu và tuyên bố sau task

AR5-T01 biến ràng buộc tay hiện tại từ clamp một góc quaternion tổng quát thành constraint giải phẫu theo
từng trục, từng bên tay và đúng rest basis của VRM. Task phải xử lý năm phần:

1. Shoulder cone bất đối xứng quanh rest pose.
2. Elbow flexion như một hinge có giới hạn, không cho hyperextension.
3. Elbow-side hysteresis để không đổi nhánh vì một frame nhiễu.
4. Pole continuity khi arm axis thay đổi hoặc khuỷu gần duỗi thẳng.
5. Upper-arm axial twist theo rig, tách khỏi pronation/supination của cổ tay.

Sau task có thể tuyên bố: “Cánh tay được giới hạn bằng anatomical frame của đúng avatar, giữ phía khuỷu
ổn định và không sinh rotation ngoài miền an toàn đã cấu hình.” Không tuyên bố mô phỏng y khoa chính xác và
không tuyên bố đã giải quyết contact/collision hoàn chỉnh.

## 2. Ngoài phạm vi

- Không kéo vai/ngực/thân để với target ngoài tầm; thuộc AR5-T02.
- Không giải wrist flex/extension, radial/ulnar deviation hoặc palm absolute; thuộc AR5-T03.
- Không thay ownership/fusion Pose–Hand; thuộc AR5-T04.
- Không thêm continuous finger solver; thuộc AR6.
- Không penetration correction, contact state machine hoặc mesh collision; thuộc AR9.
- Không thay packet V1/V2 và không gửi raw landmark ra khỏi thiết bị.
- Không thêm neural model, dependency hoặc worker mới.

## 3. Audit nền code hiện tại

### 3.1 Phần được giữ lại

- `armFrameSolver.ts` đã có anatomical rest basis, torso basis, two-bone elbow inference, quét vòng nghiệm,
  palm/face/collision scoring và nguồn pole `fresh/hand/previous/rest`.
- `armTemporalState.ts` đã có hold/return/recovery theo từng segment, quaternion hemisphere continuity và
  state lưu pole/elbow history.
- `normalizedRigProfile.ts` đã lưu rest local/world rotation, primary/secondary/binormal basis, hierarchy,
  model generation/fingerprint và collision reference.
- `avatarMotionProcessor.ts` đã có source-change reacquire blend, segment-specific loss và Hand twist tách khỏi
  swing.
- `jointConstraints.ts` vẫn là safety net cuối cho quaternion không hữu hạn hoặc vượt giới hạn tổng quát.

### 3.2 Khoảng trống phải đóng

- `JOINT_LIMITS` chỉ clamp tổng angle 150°/140°; một rotation có tổng angle hợp lệ vẫn có thể sai hướng.
- Shoulder chưa có cone theo elevation/forward/backward và chưa dùng final animated parent từ AR4 làm frame.
- Elbow chưa được biểu diễn chính thức thành flexion angle + hinge/bend direction.
- Chống lật hiện dựa nhiều vào candidate/history nhưng chưa có state xác nhận đổi phía theo thời gian.
- Pole có fallback/filter nhưng chưa có parallel-transport continuity và unwrap rõ ở tầng constraint.
- Upper-arm twist đang phát sinh gián tiếp từ target frame; chưa decompose, clamp và chẩn đoán riêng.
- Constraint violation trước/sau, projection error và side transition chưa có telemetry/metric hoàn chỉnh.

## 4. Bất biến kiến trúc

1. Mọi tính toán dùng semantic/world convention hiện có; đổi dấu chỉ tại observation boundary.
2. Constraint profile thuộc đúng `modelGeneration` và `modelFingerprint`; reload không tái dùng state/profile cũ.
3. Shoulder cone được tính tương đối với **animated parent world rotation cuối của AR4**, không với parent rest.
4. Constraint là deterministic theo sample timestamp. Không dùng render time hoặc số frame để xác nhận state.
5. Hình học và constraint chạy trước temporal smoothing; không thêm lớp smoothing quaternion thứ hai.
6. Hai tay có state độc lập. Chỉ đọc chung torso/AR4 parent pose; T01 không ghi ngược vào torso.
7. Xương chỉ được quay, không scale/translate; bone-length invariant được bảo toàn bởi renderer skeleton.
8. Dữ liệu thiếu/không hữu hạn phải giữ output trước rồi return-to-rest theo lifecycle hiện hữu; không đoán vô hạn.
9. Constraint thiếu capability chỉ disable phần liên quan và báo reason; không làm sập toàn avatar.
10. Palm twist của Phase 3B tiếp tục thuộc lower-arm/Hand pipeline; T01 không tính lại wrist pronation.

## 5. Kiểu dữ liệu và capability mới

Tạo `armConstraintProfile.ts`:

```ts
type ArmConstraintCapability = "full" | "reduced" | "unsupported";

interface AsymmetricAngularLimit {
  negative: number;
  positive: number;
}

interface ArmSideConstraintProfileV1 {
  side: "left" | "right";
  shoulderParentJoint: "leftShoulder" | "rightShoulder";
  restPrimaryParentLocal: Vector3Data;
  coneUpParentLocal: Vector3Data;
  coneForwardParentLocal: Vector3Data;
  sideReferenceRestParentLocal: Vector3Data;
  shoulderElevation: AsymmetricAngularLimit;
  shoulderForeAft: AsymmetricAngularLimit;
  elbowFlexion: { min: number; max: number };
  upperArmTwist: AsymmetricAngularLimit;
  poleReferenceParentLocal: Vector3Data;
}

interface ArmConstraintProfileV1 {
  version: 1;
  modelGeneration: number;
  modelFingerprint: string;
  capability: ArmConstraintCapability;
  sides: Partial<Record<"left" | "right", ArmSideConstraintProfileV1>>;
}
```

Profile được tạo lúc load model, freeze sâu và validate:

- Các axis finite, unit và trực giao trong tolerance `1e-4`.
- Basis phải right-handed theo convention đã khóa: `dot(cross(primary, secondary), binormal) > 1 - 1e-4`.
  Loader dựng semantic axes, Gram–Schmidt, dựng axis cuối bằng `cross`, rồi mới validate; không mirror frame bằng
  cách negate tùy tiện vì reflection có determinant `-1` và không biểu diễn được bằng quaternion rotation.
- Các giới hạn finite, `0 <= min < max < π` khi áp dụng.
- Side, parent bone và fingerprint phải khớp rig profile.
- `full`: đủ rest basis + parent + upper/lower arm hai bên.
- `reduced`: chỉ một bên hoặc thiếu semantic axis phụ; bật được hinge/total-angle safety nhưng không giả cone/twist.
- `unsupported`: thiếu chuỗi arm hoặc basis suy biến; giữ pipeline cũ và diagnostic rõ.

Không tăng version packet. Có thể thêm optional `armConstraintProfile` vào `NormalizedAvatarRigProfile`; fixture V1
cũ không có trường này vẫn hợp lệ và chạy legacy safety net.

## 6. Safety seed cần AI/manual review

Các số dưới đây chỉ là khởi điểm an toàn, không phải kết quả y khoa hay acceptance cuối:

| Thành phần | Seed |
|---|---:|
| Shoulder elevation lên | 150° |
| Shoulder elevation xuống | 40° |
| Shoulder đưa ra trước | 120° |
| Shoulder đưa ra sau | 45° |
| Elbow flexion nhỏ nhất | 0° |
| Elbow flexion lớn nhất | 145° |
| Upper-arm internal twist | 70° |
| Upper-arm external twist | 90° |
| Near-straight enter | 8° |
| Near-straight exit | 12° |
| Minimum opposite-hemisphere depth | 25° |
| Side-change confirm | 120 ms |
| Minimum side-change quality | 0.65 |
| Maximum strong-evidence gap | 100 ms (provisional) |

Các giới hạn phải nằm trong config/profile, không rải magic number trong solver. Left/right dùng cùng độ lớn nhưng
semantic sign được dựng bằng right-handed basis riêng từng side, không mirror quaternion/frame bằng cách negate
một axis. Không tuning riêng bằng URL/model name. Vì VRM có thể có rest primary gần T-pose, tên “up 150°” chỉ là
tọa độ swing tương đối với rest basis, không đồng nghĩa nâng tay 150° trong world space. Toàn bộ seed, đặc biệt
150°/120°, 8°/12°, quality 0.65 và evidence gap 100 ms, phải được xác nhận bằng fixture + baseline ba VRM.

## 7. Mô hình toán học

Quy ước cho một bên:

- `qP`: animated world rotation của parent shoulder sau AR4.
- `p0`, `u0`, `f0`: rest primary, cone-up và cone-forward trong parent-local.
- `dRaw`: unit direction shoulder→elbow quan sát/được suy ra ở world space.
- `u`: unit direction shoulder→elbow sau shoulder constraint.
- `vRaw`: unit direction elbow→wrist trước elbow constraint.
- `b`: unit bend direction, vuông góc `u`.
- `n = normalize(u × b)`: hinge/pole normal.

### 7.1 Đưa shoulder direction vào animated-parent local

Không dùng hai Euler angle hoặc hai `tan(angle)` độc lập vì cách đó mất quadrant khi swing vượt 90°. Dùng
axis-angle trên sphere quanh rest primary:

```text
d = normalize(rotate(inverse(qP), dRaw))
x = clamp(dot(d, p0), -1, 1)
y = dot(d, u0)
z = dot(d, f0)
rho = atan2(hypot(y, z), x)           // tổng swing ổn định, 0..π
tangentLength = hypot(y, z)
t = tangentLength > eps
  ? normalize(y * u0 + z * f0)        // hướng swing trên tangent plane
  : transported/previous tangent
```

Với `cy = dot(t,u0)` và `cz = dot(t,f0)`, chọn giới hạn bất đối xứng `Ly` theo dấu `cy` (up/down) và `Lz`
theo dấu `cz` (front/back). Bán kính góc của elliptical cone theo hướng `t` là:

```text
rhoLimit = 1 / sqrt((cy / Ly)^2 + (cz / Lz)^2)
rhoC = min(rho, rhoLimit)
dC = cos(rhoC) * p0 + sin(rhoC) * t
u = normalize(rotate(qP, dC))
```

`rhoLimit` và mọi seed phải nhỏ hơn `π`; công thức này giữ quadrant và liên tục qua 90°. Trường hợp chính xác
antipodal (`d ≈ -p0`) không có tangent duy nhất: ưu tiên transported tangent từ state, sau đó pole reference của
rig; nếu cả hai suy biến thì giữ output trước với reason `antipodal-shoulder-direction`, không chọn axis ngẫu nhiên.

### 7.2 Phân rã forearm thô và near-straight

Không dùng `acos(dot(u,vRaw))` vì kém ổn định gần `0/π` và không mang dấu hinge. Trước tiên chỉ lấy độ lớn góc
và bend observation để đánh giá singularity:

```text
xRaw = clamp(dot(u, vRaw), -1, 1)
perpRaw = vRaw - xRaw * u
sinThetaRaw = length(perpRaw)
thetaAbsRaw = atan2(sinThetaRaw, xRaw)
bObserved = sinThetaRaw > eps ? perpRaw / sinThetaRaw : null
```

`thetaAbsRaw` chỉ dùng cho near-straight gate/diagnostic. Nó chưa có quyền quyết định flexion sign. Khi vào
near-straight, không cập nhật pole/twist anchor hoặc side pending; dùng temporal pole đã transport. Ngưỡng
enter/exit là seed data-driven, không khóa trước baseline A5.

### 7.3 Parallel transport cho pole continuity

Với `uPrev`, `bPrev` và `u`:

1. Tính minimal rotation `qTransport` đưa `uPrev → u`.
2. `bTransport = rotate(qTransport, bPrev)`.
3. Project lại `bTransport` lên mặt phẳng vuông góc `u` và normalize.
4. Nếu `dot(uPrev,u)` nhỏ hơn antipodal threshold trong một source sample, coi là glitch/reacquire: giữ previous
   constraint output, gắn reason `antipodal-arm-axis` và kích hoạt lifecycle recovery; không cố xoay 180°.
5. Căn hemisphere để `dot(bCandidate, bTransport) >= 0` trừ khi side-change state đã commit.

Khi `thetaAbsRaw` đi vào near-straight `<8°`, pole observation không đủ điều kiện đổi side hoặc cập nhật twist
anchor. Chỉ thoát singular mode khi `thetaAbsRaw >12°` để tránh chattering.

### 7.4 Anatomical side reference và elbow-side hysteresis

Không dùng torso-outward chiếu lên `u⊥` làm reference duy nhất vì nó suy biến tại T-pose khi `u ≈ outward`.
Profile lưu `sideReferenceRest` vuông góc `p0`. Tạo canonical reference trực tiếp từ rest, không tích lũy theo
trajectory:

```text
qSwing = shortestArc(p0, dC)
sideReferenceLocal = rotate(qSwing, sideReferenceRest)
sideReference = normalize(rotate(qP, sideReferenceLocal))
sideScore = dot(bCandidate, sideReference)
side = sign(sideScore)
sideEvidenceAngle = asin(clamp(abs(sideScore), 0, 1))
```

Nếu shortest arc hoặc reference suy biến, giữ accepted side/previous output và không update state. Torso-outward
chỉ là evidence phụ khi projection length đủ lớn; không bao giờ normalize vector gần zero. `25°` được định nghĩa
là độ sâu `sideEvidenceAngle` vào hemisphere đối diện, không phải angular distance tới previous pole.

State mỗi bên:

```ts
interface ElbowSideState {
  accepted: -1 | 0 | 1;
  pending: -1 | 0 | 1;
  pendingSinceMs: number | null;
  lastStrongObservedAtMs: number | null;
}
```

Luật chuyển:

- Cold start chỉ commit khi pole observed đủ quality; nếu không dùng rig prior nhưng đánh dấu `provisional`.
- Cùng side: cập nhật bình thường và xóa pending.
- Side đối diện: chỉ mở pending khi elbow thật observed, không near-straight, quality đạt ngưỡng và evidence vượt
  angular threshold.
- Chỉ commit sau `sourceSampleTimestamp - pendingSince >= confirmMs` với các sample mới liên tục.
- Mỗi strong sample phải thỏa `sourceSampleTimestamp - lastStrongObservedAtMs <= maxSideEvidenceGapMs`; vượt gap
  thì reset pending trước khi mở lại. Missing/inferred sample không nối hai đoạn evidence rời rạc.
- Duplicate sample không làm đồng hồ tiến; inferred/history không được tự lật side đã commit.
- Tracking loss ngắn giữ accepted side; reset session/model/camera xóa toàn bộ state.

### 7.5 Anatomical zero-twist reference và upper-arm twist

Upper-arm twist ở T01 biểu diễn internal/external shoulder rotation cần để giữ elbow plane; nó không phải palm
pronation của T03.

Temporal transport ở §7.3 chỉ giữ continuity và phụ thuộc trajectory. Nó tuyệt đối không được dùng làm zero-twist
reference. Reference giải phẫu phải tính trực tiếp từ rest pose ở mỗi source sample:

```text
qSwing = shortestArc(p0, dC)
rLocal = rotate(qSwing, poleReferenceParentLocal)
r = normalize(rotate(qP, rLocal))
```

Nếu rest→current gần antipodal/seam, không cập nhật twist và giữ output trước. Bình thường shoulder cone `<π` ngăn
solver đi tới đúng antipodal.

1. Side gate chọn `bCandidate`; temporal `bTransport` chỉ giúp chọn hemisphere/continuity.
2. Đo signed twist quanh `u`:

```text
phiRaw = atan2(dot(u, cross(r, bCandidate)), dot(r, bCandidate))
```

3. Unwrap `phiRaw` về nhánh gần `phiPrevious` nhất.
4. Clamp theo internal/external limit đúng side: `phi = clamp(phiUnwrapped, minTwist, maxTwist)`.
5. Dựng **secondary có thẩm quyền duy nhất**:

```text
bHinge = rotateAroundAxis(r, u, phi)
n = normalize(cross(u, bHinge))
bHinge = normalize(cross(n, u))
```

6. Không truyền twist quaternion riêng xuống `targetBoneWorld()`. API chỉ nhận final frame
   `(primary=u, secondary=bHinge, binormal=n)` để không double-apply.

Hand twist hiện hữu chỉ compose sau lower-arm temporal như hiện tại và không thay đổi shoulder internal/external
twist của T01.

### 7.6 Signed elbow flexion trong final hinge plane

Chỉ sau khi có `bHinge` mới đo flexion có dấu:

```text
x = dot(vRaw, u)
y = dot(vRaw, bHinge)
z = dot(vRaw, n)                    // off-hinge-plane diagnostic
thetaRawSigned = atan2(y, x)
theta = clamp(thetaRawSigned, elbowMin, elbowMax)
v = normalize(cos(theta) * u + sin(theta) * bHinge)
```

`thetaRawSigned < elbowMin` biểu diễn bend qua phía hinge bị cấm/hyperextension tương đối với anatomical hinge.
Nếu lấy `bHinge` trực tiếp từ `bObserved` mà bỏ side/twist authority thì `y` luôn dương và công thức mất khả năng
phát hiện hyperextension; implementation không được đi đường tắt đó. Projection áp dụng cho cả observed/inferred.

Postcondition bắt buộc:

```text
abs(dot(u, bHinge)) <= eps
abs(dot(v, n)) <= eps
abs(length(u)-1), abs(length(v)-1), abs(length(bHinge)-1), abs(length(n)-1) <= eps
```

### 7.7 Candidate preview, scoring và commit

Không thay bộ quét 24 nghiệm bằng solver mới. Phải project/evaluate từng candidate bằng hàm pure trước khi rank:

```text
raw candidate
  → constraint preview không mutate state
  → projected candidate
  → recompute target error + face/collision/anatomy metrics trên hình học projected
  → normalized cost
  → rank
winner → commitSelectedCandidate() đúng một lần/source sample
```

Cost dùng đại lượng không thứ nguyên:

```text
C = C_existing_projected
  + wCone * (coneViolation / coneSoftScale)²
  + wFlex * (flexViolation / flexSoftScale)²
  + wPole * (poleDelta / poleSoftScale)²
  + wSide * sideMismatchPenalty
  + wTwist * (twistViolation / twistSoftScale)²
  + wTarget * normalizedWristTargetError²
```

- `normalizedWristTargetError = wristError / (upperLength + lowerLength)` để so sánh được giữa các VRM.
- Non-finite/profile mismatch: hard reject hoặc capability fallback. Anatomical domain dùng hard projection; các
  candidate projected được rank bằng target/collision/face/history cost mềm.
- Face/collision penalty phải tính lại trên hình học projected, không tái dùng penalty của raw candidate.
- `evaluateCandidate()` không được sửa pending timer, previous pole/twist hoặc accepted side. Chỉ winner gọi
  `commitSelectedCandidate()` đúng một lần.
- Với elbow observed, không bỏ ngay observation chỉ vì soft violation; chạy cùng projection để output bounded.

## 8. Thứ tự pipeline bắt buộc

```text
Raw Pose/Hand sample
  → coordinate adaptation + visibility hysteresis
  → AR4 final torso/shoulder parent pose
  → arm observation / wrist evidence / elbow candidates hiện có
  → AR5-T01 anatomical constraint solve
      shoulder cone
      temporal pole transport
      rest-derived anatomical reference
      raw forearm decomposition + near-straight gate
      elbow-side hysteresis
      upper-arm twist decomposition/clamp → bHinge
      signed elbow flexion → final forearm direction
  → target world frames → parent-local rest-relative deltas
  → temporal hold/recovery hiện có
  → existing Hand forearm twist composition
  → capability-aware safety net
  → packet/renderer
```

Constraint output phải được tính từ source sample một lần. Render frames lặp lại chỉ đọc state/output, không chạy
lại side confirmation hoặc unwrap. Với capability `full`, safety net cuối chỉ finite-check, normalize và kiểm tra
postcondition/emergency gross-invalid; không áp clamp tổng 140°/150°. Path `reduced/legacy` mới giữ clamp cũ.

## 9. Runtime state

Tạo `armConstraintState.ts` hoặc đặt type/state cạnh solver nếu review thấy module riêng quá nhỏ:

```ts
interface ArmConstraintSideState {
  modelGeneration: number;
  previousUpperDirection: Vector3Data | null;
  previousPole: Vector3Data | null;
  previousUnwrappedTwist: number | null;
  previousFinalFrame: { primary: Vector3Data; secondary: Vector3Data; binormal: Vector3Data } | null;
  nearStraight: boolean;
  elbowSide: ElbowSideState;
}
```

Reset khi:

- model generation/fingerprint đổi;
- camera device hoặc mirror convention đổi;
- processor `reset()`/`dispose()`;
- timestamp lùi hoặc gap vượt `maximumTimestampGapMs`;
- rig profile validation fail.

Tracking loss bình thường không reset ngay accepted side; temporal lifecycle hiện hữu sở hữu hold/return. Sau return
về rest hoàn tất, constraint state được xóa để session mới không kế thừa pole cũ.

## 10. Thay đổi code theo file

### File mới

| File | Trách nhiệm |
|---|---|
| `avatar-motion/armConstraintProfile.ts` | Types, seed config, validation, freeze, capability classification |
| `avatar-motion/anatomicalArmConstraints.ts` | Pure preview math + single-winner commit: cone, signed flexion, transport, side gate, twist và aggregate solve |
| `avatar-motion/anatomicalArmConstraints.test.ts` | Unit/property/fixture tests cho toàn bộ toán học |
| `avatar-motion/armConstraintProfile.test.ts` | Profile validation, mirror, reload/fingerprint |

### File sửa

| File | Thay đổi |
|---|---|
| `avatar-renderer/modelLoader.ts` | Dựng constraint axes từ rest rig/torso semantic axes; không theo URL model |
| `avatar-motion/normalizedRigProfile.ts` | Thêm profile optional, validate/freeze sâu; giữ fixture cũ tương thích |
| `avatar-motion/armFrameSolver.ts` | Preview/project từng candidate, recompute face/collision/target cost, rank rồi commit winner một lần trước target frame |
| `avatar-motion/armTemporalState.ts` | Chứa/reset state discrete nếu không tách module; không thêm smoothing |
| `avatar-motion/avatarMotionProcessor.ts` | Truyền final AR4 animated parent, reset theo lifecycle, xuất metric |
| `avatar-motion/avatarMotionDiagnostics.ts` | Snapshot constraint trước/sau và reason flags |
| `avatar-motion/motionConfig.ts` | Threshold hysteresis/quality/cost; validate quan hệ enter/exit |
| `avatar-motion/jointConstraints.ts` | Full path chỉ finite/normalize/postcondition; total-angle clamp chỉ cho reduced/legacy path |
| `components/dev/AvatarRendererDevHarness.tsx` | Panel AR5-T01, freeze metric/manual case marker |
| Các test arm/processor/loader hiện hữu | Regression và fixture cập nhật tối thiểu |

Không đổi `AvatarCanvas` public API nếu không cần. Không thêm dữ liệu constraint vào network packet vì receiver tự
adapt theo capability model đang render.

## 11. Diagnostic và metric

Mỗi bên cần ít nhất:

```ts
interface ArmConstraintDiagnostic {
  capability: ArmConstraintCapability;
  applied: boolean;
  rejectionReason: string | null;
  shoulder: { rawSwingUpAngularCoord: number | null; rawSwingForeAftAngularCoord: number | null;
    finalSwingUpAngularCoord: number | null; finalSwingForeAftAngularCoord: number | null; projected: boolean };
  elbow: { rawAbsoluteFlexion: number | null; rawSignedFlexion: number | null; finalFlexion: number | null;
    offHingePlane: number | null; nearStraight: boolean; side: -1 | 0 | 1;
    pendingSide: -1 | 0 | 1; sideEvidenceAngle: number | null; sideChanged: boolean };
  pole: { source: PoleSource; transportDelta: number | null; continuityCorrection: number | null };
  twist: { raw: number | null; unwrapped: number | null; final: number | null; clamped: boolean };
  targetError: { elbow: number | null; wrist: number | null; normalizedWrist: number | null };
  safetyNetActivated: boolean;
  violations: string[];
}
```

Aggregate metric trong cửa sổ local-only:

- `shoulderConeProjectionCount` và projection angle p50/p95/max.
- `elbowFlexClampCount` và violation max.
- `elbowSidePendingCount`, committed flip count, rejected flip count.
- `poleAngularDeltaDeg` raw/final p95/max.
- `upperArmTwistClampCount`, raw/final twist range.
- `constraintNonFiniteCount`.
- `boneLengthRelativeError` từ reconstructed diagnostic chain.
- Output upper/lower-arm angular delta p95/max sau temporal.
- `constraintProjectionDutyCycle` và `continuousProjectionDurationMs`; chỉ dùng cùng manual action label/target
  error để tuning, không tự động FAIL khi người dùng chủ động giữ tay ở limit.
- `sideCommitLatencyMs` từ strong continuous evidence đầu tiên đến commit, p50/p95.
- `anatomicalSafetyNetActivationCount`; full path bình thường phải bằng `0`.

DEV panel không hiển thị raw landmarks và không persist/export tự động.

## 12. Automated test plan

### 12.1 Profile/loader

- Hai VRM rest orientation khác nhau tạo semantic constraint tương đương.
- Left/right mirror cho cùng độ lớn, đúng sign.
- Missing shoulder/arm/basis trả `reduced/unsupported`, không throw.
- Axis không trực giao, sai handedness/determinant, NaN, zero-length hoặc sai fingerprint bị reject.
- Profile immutable; reload generation mới không giữ state generation cũ.

### 12.2 Shoulder cone math

- Inside cone giữ nguyên trong tolerance.
- Mỗi biên up/down/front/back project đúng phía.
- Góc chéo project đúng ellipse, không clamp từng axis thành hình chữ nhật.
- Antipodal/qua 90°/zero/non-finite không NaN, không mất quadrant và trả reason xác định.
- Parent AR4 yaw/pitch/roll/lean/shrug khác nhau vẫn cho cùng local semantic result.
- Idempotence `P(P(x)) ≈ P(x)`, inside-domain identity và rotation equivariance đều PASS.
- Perturb input epsilon quanh cone boundary không tạo output jump.

### 12.3 Elbow hinge và side

- Straight, flexed, max-flex và hyperextension.
- Near-straight enter/exit hysteresis không chatter.
- Một frame side đối diện không commit.
- Evidence đối diện đủ quality và đủ milliseconds mới commit.
- Evidence bị ngắt quá `maxSideEvidenceGapMs` phải reset pending.
- Duplicate timestamp không tiến confirm timer.
- Inferred/history không tự lật accepted observed side.
- Tracking gap/reset/model reload xóa state đúng contract.
- Test cùng trajectory ở 15/30/60 FPS cho cùng trạng thái cuối và thời điểm tương đương theo milliseconds.

### 12.4 Pole và twist

- Parallel transport qua đường cong arm axis liên tục.
- Qua biên `-π/π` unwrap không nhảy gần `2π`.
- `uPrev ≈ -u` giữ previous output và kích hoạt recovery, không dựng rotation π tùy ý.
- Temporal transport và rest-derived zero-twist reference có test riêng; cùng final pose không phụ thuộc trajectory.
- Twist clamp internal/external đúng side và đúng rest basis model.
- Shoulder twist không cộng đôi với existing Hand forearm twist.
- Khi near-straight, pole/twist anchor giữ; khi thoát singular blend qua temporal hiện có.
- Final hinge coherence: `u⊥bHinge`, `v⊥n`, mọi axis unit và twist-clamped `v` được dựng lại từ `bHinge`.

### 12.5 Integration/regression

- Observed elbow ngoài limit được project, không hard drop cả arm.
- Inferred elbow candidate được pure-preview/project trước khi rank; face/collision cost tính lại trên projected geometry.
- Scan 24 candidate không mutate state; state chỉ advance một lần cho winner của source sample.
- Lower mất wrist vẫn hold riêng; upper tiếp tục hoạt động như contract hiện tại.
- AR4 lean/yaw/shrug đổi animated parent nhưng arm local output không double-rotate.
- Hai tay state độc lập.
- Filter ON/OFF đều finite; OFF chỉ bỏ smoothing, không bỏ constraint.
- Constraints toggle OFF phục vụ DEV giữ behavior legacy; production default ON.
- Full capability path không bị generic 140°/150° clamp; safety-net activation bằng 0 trong fixture bình thường.
- Packet V1/V2 schema, privacy tests, gesture, hand twist, gaze/face và renderer lifecycle không regression.
- Full frontend `test`, `lint`, `build` PASS.

Ưu tiên test pure functions trước processor integration. Mỗi bug manual phải có fixture/regression tái hiện trước patch.

## 13. Manual webcam gate A1–A14

Chạy trái/phải, filter ON, constraints ON, faithful mode trên ít nhất ba VRM có rest axis/chiều dài tay khác nhau:

| ID | Động tác | Kỳ vọng |
|---|---|---|
| A1 | T-pose/rest rồi thả tay | Không lệch rest, không shoulder projection giả |
| A2 | Dang tay ngang rồi đưa lên cao | Shoulder đi liên tục tới cone, không snap |
| A3 | Đưa tay ra trước/sau | Đúng hướng, không đảo do mirror |
| A4 | Gập/duỗi khuỷu chậm | Flexion đơn điệu, không cong ngược |
| A5 | Giữ tay gần thẳng 10 giây | Pole/elbow side không rung/lật |
| A6 | Đi qua near-straight rồi gập lại | Giữ side cũ, recovery không snap |
| A7 | Chủ động đổi mặt phẳng khuỷu | Chỉ đổi side sau evidence mạnh/liên tục |
| A8 | Cross-body | Không flip chỉ vì vượt giữa torso; collision chỉ là diagnostic hiện hữu |
| A9 | Tay gần mặt/đầu | Không regression face/collision candidate hiện có |
| A10 | Cánh tay chĩa gần camera | Deterministic degrade, không pole spin |
| A11 | Xoay upper arm nhưng giữ palm | Shoulder twist bounded, không cộng đôi forearm twist |
| A12 | Che elbow ngắn rồi hiện lại | Không inferred tự khóa sai side |
| A13 | Hai tay chuyển động khác nhau | State hai bên độc lập |
| A14 | Đổi/reload model giữa tracking | Không dùng profile/state của model cũ |

Quay thêm 60 giây giữ tay ở A5 và 60 giây chuyển động hỗn hợp A2/A4/A8/A10 cho mỗi model để lấy baseline metric.
Đây là stability sampling của T01, không thay performance gate toàn AR5-T05.

## 14. Acceptance criteria

AR5-T01 chỉ `DONE` khi:

1. Profile/model-generation lifecycle và capability fallback PASS.
2. Shoulder cone, signed elbow flex, side hysteresis, temporal pole transport, anatomical zero-twist reference và
   upper-arm twist đều có unit test độc lập.
3. Sau constraint không còn violation vượt `0.5°` so với limit cấu hình trong fixture toán học.
4. Bone-length relative error của reconstructed diagnostic chain `<1e-5` trong synthetic fixtures.
5. Không có committed elbow-side flip trong A5/A6/A10 nếu người dùng không chủ động đổi mặt phẳng.
6. Deliberate side change A7 vẫn thực hiện được; hysteresis không khóa vĩnh viễn.
7. Không NaN/Infinity, không quaternion hemisphere jump, không path-dependent anatomical twist và không stale
   state sau reload.
8. AR4 parent motion, existing collision scoring, Hand twist, partial-arm loss/recovery và packet privacy không regression.
9. Manual A1–A14 PASS trên ít nhất ba VRM hoặc có `N/A` kèm capability evidence.
10. Candidate scan không mutate state; full anatomical path có `anatomicalSafetyNetActivationCount == 0` trong
    fixture và manual motion bình thường.
11. Projection duty/duration, normalized target error và deliberate side-commit latency được baseline; không dùng
    riêng duty cycle làm PASS/FAIL khi người dùng chủ động giữ limit.
12. Full frontend test/lint/build PASS và báo cáo ghi baseline/ngưỡng trung thực.
13. Chủ dự án xác nhận manual gate trước khi đổi trạng thái `DONE`.

Các ngưỡng cảm nhận như jitter/output angular delta chưa được bịa trước khi có baseline. Sau vòng manual đầu, chốt
ngưỡng p95/max bằng evidence và thêm vào report; không tăng smoothing để che constraint discontinuity.

## 15. Trình tự implementation

### AR5-T01-01 — Contract và profile

- Thêm types/validator/freeze/capability.
- Loader sinh right-handed axes bằng semantic construction + Gram–Schmidt + cross theo rest rig và parent.
- Test mirror equivalence, reflected basis rejection, invalid rig, generation/reload.
- Gate: targeted tests + typecheck.

### AR5-T01-02 — Pure shoulder cone

- Implement signed coordinates và elliptical projection.
- Xử lý antipodal/degenerate deterministically.
- Property tests finite/idempotent/inside-limit.
- Chưa nối runtime.

### AR5-T01-03 — Elbow hinge và pole transport

- Implement `atan2` raw flex decomposition, temporal parallel transport và singular hysteresis.
- Tách rest-derived anatomical reference khỏi temporal reference; antipodal temporal sample phải hold/recover.
- Test trajectory 15/30/60 FPS.
- Chưa nối side commit runtime.

### AR5-T01-04 — Elbow-side state machine

- Timestamp-based pending/commit/reset.
- Chỉ strong observed evidence được đổi side.
- Thêm `maxSideEvidenceGapMs` và định nghĩa `sideEvidenceAngle` tới hemisphere boundary.
- Duplicate/inferred/evidence-gap/loss/reload tests.

### AR5-T01-05 — Upper-arm twist

- Signed twist, unwrap, clamp thành `bHinge` authority duy nhất; sau đó signed flexion và forearm reconstruction.
- Chứng minh không double-apply với Hand twist.
- Test hinge coherence, path independence và hai rig rest orientation khác nhau.

### AR5-T01-06 — Tích hợp arm solver

- Pure-preview/project từng candidate trước khi rank; chuẩn hóa cost và recompute target/face/collision metrics.
- Commit side/pole/twist state đúng một lần cho winner; project observed/inferred trước `targetBoneWorld()`.
- Dùng animated parent cuối AR4.
- Nối lifecycle/reset/toggle; full path bỏ generic total-angle clamp, reduced/legacy path giữ clamp cũ.

### AR5-T01-07 — Diagnostics và automated gate

- Nối snapshot/metrics/DEV panel.
- Targeted → full frontend test → lint → build.
- Kiểm tra packet/privacy và regression AR4/hand twist.

### AR5-T01-08 — Manual gate và corrective

- A1–A14 × ít nhất ba VRM.
- Ghi model fingerprint, mode, metric và PASS/FAIL.
- Bug phải có regression trước corrective.
- Chủ dự án xác nhận rồi cập nhật roadmap `DONE`; khi đó mới bắt đầu AR5-T02.

Không gộp nhiều lát cắt trước khi gate của lát cắt trước xanh. Không tune seed limits theo một ảnh đơn hoặc một VRM.

## 16. Quyết định sau AI review

| Chủ đề | Quyết định đã khóa cho implementation |
|---|---|
| Shoulder cone | Giữ radial projection trong spherical/log angular space cho T01; không tuyên bố nearest-point |
| Angle math | Dùng `atan2`, không dùng `acos`, cho shoulder swing và elbow angle quan trọng |
| Frame lưu trữ | Lưu parent-local, loader dựng canonical right-handed rest basis và kiểm tra handedness |
| Projection order | Sequential shoulder→hinge đủ cho T01; đo normalized target error, chưa thêm joint optimizer |
| Side hysteresis | 120 ms là seed; quality, 8°/12° và evidence gap phải chốt từ baseline A5/A7 |
| Side reference | Rest-derived canonical reference là primary; torso-outward chỉ là non-degenerate evidence phụ |
| Pole references | Temporal transport cho continuity; rest-derived direct swing cho anatomical zero twist |
| Single authority | `bHinge` sau side + twist clamp là secondary duy nhất; forearm dựng lại từ `bHinge` |
| Candidate scan | Pure preview/project/recompute cost cho 24 candidate; commit winner đúng một lần |
| Hard/soft | Non-finite/profile mismatch hard reject/fallback; anatomical domain hard-project; rank bằng normalized soft cost |
| Generic clamp | Full path bỏ clamp tổng 140°/150°; reduced/legacy giữ; safety-net activation phải đo |
| AR4 parent | Dùng full final animated parent world rotation; translation chỉ ảnh hưởng joint origin/target error |
| Versioning | Giữ outer `NormalizedAvatarRigProfile.version=1` với optional field; `ArmConstraintProfileV1` version riêng |
| Metrics | Thêm projection duty/duration, side latency, normalized target error và safety-net activation |

Review đã giải quyết các blocker toán học. Nếu implementation cần đổi một quyết định trong bảng này, phải cập nhật
kế hoạch và review lại phần bị đổi trước khi tiếp tục; không đổi ngầm trong code.

## 17. Điều kiện dừng và rollback

- Nếu constraint layer làm AR4 parent transform bị áp hai lần: dừng integration, sửa ownership trước tuning.
- Nếu solver chỉ PASS bằng cách tăng temporal smoothing: rollback tuning, tìm discontinuity tại cone/pole/twist boundary.
- Nếu ≥2/3 VRM không dựng được semantic cone axes: không hard-code theo model; quay lại profile/capability design.
- Nếu target error do sequential projection quá lớn ở tư thế thường: mở corrective design trong T01; không lén kéo torso
  trước AR5-T02.
- Feature flag DEV cho phép so sánh legacy/AR5-T01 trong lúc nghiệm thu; không duy trì hai production path sau DONE.
