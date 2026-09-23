# AR6 — Kế hoạch Continuous Finger Tracking

Ngày lập: 2026-09-23

Trạng thái: **PLANNED — REVIEWED, READY AFTER CONTRACT CORRECTIONS — CHƯA CODE**

Nguồn toán đầu vào: `veiltalk_phase6_continuous_finger_tracking_math.md` do chủ dự án cung cấp ngày
2026-09-23. Tài liệu này đã được rà lại theo code hiện hành; các hiệu chỉnh bắt buộc về handedness,
palm-local frame, khả năng quan sát của thumb, thứ tự confidence/temporal và VRM mapping đã được hợp nhất
vào kế hoạch dưới đây.

Phụ thuộc roadmap: **owner waiver ngày 2026-09-23 cho phép AR6 bắt đầu trên baseline P4-T10/AR4 hiện hành
trong khi AR5-T01→T05 deferred**.

Ước tính tổng: **48–74 giờ implementation + automated test + DEV telemetry**, cộng **16–30 giờ manual
validation/tuning/regression trên ít nhất ba VRM**. Phần manual là điều kiện hoàn thành, không phải buffer tùy chọn.

## 1. Quyết định triển khai

AR6 được triển khai thẳng thành production code; không có nhánh prototype hoặc proof-of-concept riêng. Tuy nhiên,
mỗi solver toán học bắt buộc có synthetic geometric fixture và unit test trước khi nối vào runtime:

```text
contract → geometric fixture → unit test → solver → processor integration
```

Không yêu cầu người dùng thu dataset trước khi bắt đầu code. Fixture ở đây là ground-truth hình học có kiểm soát,
không phải prototype hoặc dữ liệu webcam thủ công.

Automated test được viết cùng module; manual/multi-model/performance gate
chạy sau khi code hoàn tất và là điều kiện đánh dấu `DONE`. Không dùng kết quả của gesture preset cũ làm bằng
chứng rằng continuous solver đúng.

Kiến trúc nguồn pose phải đổi từ:

```text
Hand landmarks → curl tổng → gesture label → preset → finger quaternion
```

thành:

```text
Hand landmarks
  → palm-local joint observations
  → per-joint confidence và source selection
  → anatomical projection/temporal
  → human-to-avatar retarget
  → rest-relative bone-local quaternion
```

Gesture classifier vẫn có thể chạy song song để tạo semantic/diagnostic nhưng không được quyết định rotation
xương ngón. Một pose không có tên vẫn phải được avatar biểu diễn liên tục.

## 2. Tuyên bố hoàn thành AR6

Sau AR6-T04 chỉ được tuyên bố:

> VeilTalk ánh xạ liên tục chuyển động quan sát được của MCP/PIP/DIP bốn ngón và mô hình thumb riêng sang
> finger bones của VRM; mỗi joint có confidence/source, giới hạn giải phẫu, temporal lifecycle và fallback khi
> che khuất. Gesture semantic không sở hữu finger pose.

Không tuyên bố:

- đo chính xác y khoa mọi DoF của bàn tay;
- quan sát trực tiếp axial twist/opposition tuyệt đối của thumb từ 21 point landmarks;
- giải finger–finger, finger–palm hoặc finger–body contact;
- giải penetration mesh;
- suy đúng vật thể đang cầm;
- AR5 arm/wrist đã hoàn thành;
- raw landmark được phép rời khỏi client.

## 3. Ngoài phạm vi

- Không thay ownership `leftHand`/`rightHand`, lower-arm hoặc forearm twist.
- Không thêm wrist flex/extension, radial/ulnar deviation hay reachability; thuộc AR5.
- Không dùng IK/contact để ép thumb vào một `fist` đẹp dựa trên gesture label.
- Không thêm neural model, dịch vụ server, worker hoặc dependency runtime mới.
- Không đổi MediaPipe task/model trong AR6.
- Không truyền raw hand landmark, confidence chi tiết hoặc camera frame qua network.
- Không triển khai global nonlinear optimizer trong production v1.
- Không dùng model URL/tên file để hard-code dấu, axis hoặc gain.

## 4. Audit code và chiến lược migration

### 4.1 Phần giữ lại

- `rawTrackingTypes.ts` và `rawTrackingMapper.ts`: nguồn 21 image/world landmarks, timestamp và new/duplicate sample.
- `handPoseMatching.ts`: gán candidate ổn định cho left/right.
- `handPalmBasis.ts`: Gram–Schmidt palm basis và geometry quality; mở rộng thay vì tạo implementation thứ hai.
- `fingerRig.ts`: phát hiện chuỗi VRM, rest geometry và bone-local flex axis; nâng version/profile thay vì bỏ.
- `avatarPoseTypes.ts`: 30 tên finger joint và packet quaternion hiện hành.
- `modelLoader.ts`: load bone/capability theo model generation.
- `oneEuroFilter.ts`: tái sử dụng `OneEuroScalarFilter` cho joint angle.
- Renderer: `restLocal × deltaLocal`, finger joint không bị renderer smoothing lần hai.
- Lifecycle reset/dispose/model reload và nguyên tắc finger không ghi đè wrist/arm.

### 4.2 Phần ngừng làm nguồn animation

- `gestureClassifier.ts` không còn chọn pose xương.
- `gestureTemporal.ts` không còn là temporal owner của finger rotations.
- `fingerPosePresets.ts` không còn là target production của local continuous tracking.
- `fingerPosePlanner.ts` không còn tạo quaternion chính từ gesture label.
- `fingerPoseTemporal.ts` không còn blend giữa các preset cho đường continuous.

Các file này chưa xóa trong T01 để giữ regression và semantic diagnostic. Sau T04, code chết mới được xóa hoặc
đánh dấu legacy bằng một commit riêng. Không vừa thay pipeline vừa xóa toàn bộ fallback trong cùng bước đầu.

### 4.3 Điểm nối runtime phải thay

`AvatarMotionProcessor.applyFingerGesture()` được thay bằng `applyContinuousFingerMotion()` chạy sau arm/wrist
như hiện tại và chỉ được ghi `AvatarFingerJointName`. Đường semantic gesture nhận `ContinuousFingerState` hoặc
feature cũ song song, không có đường gọi ngược từ label sang bone plan.

Feature flags:

```ts
interface AvatarMotionProcessorOptions {
  continuousFingerEnabled?: boolean;
  gestureSemanticEnabled?: boolean;
}
```

- `continuousFingerEnabled`: owner duy nhất của finger rotations.
- `gestureSemanticEnabled`: chỉ diagnostic/UI; bật/tắt không đổi quaternion.
- Không cho preset và continuous cùng sở hữu một joint trong một frame.
- Chuyển owner phải phát identity/rebase đúng một lần, không giữ pose cũ.

## 5. Bất biến kiến trúc

1. Tính toán từ sample timestamp, không từ số render frame.
2. Duplicate/older hand sample không được cập nhật observation, calibration hoặc velocity.
3. Hai tay có state độc lập; không dùng state bên kia để vá một tay bị mất.
4. Mọi basis dùng cho quaternion phải finite, trực chuẩn và right-handed với determinant gần `+1`.
5. Handedness được canonicalize đúng một lần tại observation boundary.
6. Angle semantic được tính trong palm-local/human-joint frame, không hard-code camera/world X/Y/Z.
7. Joint `source="observed"` chỉ khi angle thật sự đến từ observation đủ confidence.
8. Prior/prediction không override observation tốt để ép về pose quen thuộc.
9. Final output luôn finite, normalized, rest-relative và bone-local.
10. Finger solver không ghi `leftHand`, `rightHand`, lowerArm, upperArm hoặc torso joint.
11. Model generation/fingerprint đổi phải reset profile, calibration, filters, history và owned joints.
12. Tracking loss dài phải về safe relaxed pose rồi nhả ownership; không extrapolate vô hạn.
13. Privacy contract giữ nguyên: raw landmark chỉ tồn tại local và không vào packet/telemetry bền vững.
14. Một model thiếu chain chỉ disable đúng joint/side đó; không làm sập avatar hoặc tay còn lại.
15. Human palm-local/human-joint space và avatar hand-local/bone-local space là hai domain tách biệt; chỉ semantic
    angle/capability contract được đi qua boundary retarget.
16. Human observation là absolute semantic angle đã sửa detector bias nhỏ; avatar output là rest-relative delta.
    Avatar rest chỉ được trừ đúng một lần.

## 6. Hệ tọa độ và quy ước dấu

### 6.1 Palm frame quan sát

Với `W=p0`, `I=p5`, `M=p9`, `L=p17`:

```text
r0 = I - L
f0 = M - W
r  = normalize(r0)
f  = normalize(f0 - dot(f0,r) r)
n  = normalize(cross(r,f))
f  = normalize(cross(n,r))
R_palm = [r f n]
```

Reject nếu vector không hữu hạn, dưới epsilon, triangle area nhỏ hoặc determinant không gần `+1`.

`handPalmBasis.ts` hiện dựng raw basis. AR6 thêm một canonicalization function dùng convention đã kiểm chứng của
`handTwistRig.ts`; không sửa dấu lần hai trong solver. Palm-local point/vector:

```text
pLocal = transpose(R_palm) (p - W)
vLocal = transpose(R_palm) vWorld
```

Scale dùng cho distance/confidence, không dùng lại để thay angle:

```text
s = length(I - L)
pNormalized = pLocal / max(s, epsilon)
```

### 6.2 Tách human observation space và avatar rig space

Hai domain không được dùng lẫn vector:

```text
HUMAN DOMAIN                         AVATAR DOMAIN
MediaPipe landmarks                  VRM rest skeleton
→ HumanPalmLocal                     → AvatarHandRestFrame
→ absolute semantic angle   ───────→ → bone-local anatomical axes
```

`HumanPalmLocal` chỉ thuộc observation/calibration của người. `AvatarHandRestFrame` chỉ được dựng từ VRM đang
load. Không được dùng trực tiếp một vector human palm-local như avatar palm-local; cầu nối duy nhất là semantic
angle kèm confidence/source.

### 6.3 Finger rest basis đúng handedness

Mọi avatar rest direction được lưu trong **avatar hand-rest-local space**, không phải world space hoặc
HumanPalmLocal:

```text
d0 = normalize(PIP0 - MCP0)
a0 = normalize(rPalm - dot(rPalm,d0) d0)
c0 = normalize(cross(a0,d0))
F0 = [a0 d0 c0]
```

Điều kiện:

```text
dot(cross(a0,d0),c0) > 1 - tolerance
```

Không dùng công thức `c0 = cross(d0,a0)` vì nó tạo basis determinant `-1`.

### 6.3 Semantic left/right

- `r` luôn mang nghĩa radial: từ pinky về index.
- `f` luôn mang nghĩa wrist về finger roots.
- `n` được canonicalize thành cùng semantic palm/dorsal convention cho hai tay.
- Flexion dương, extension âm cho cả hai tay.
- Abduction sign được định nghĩa một lần theo radial axis; test mirror chốt sign, không rải `side === right ? -1`.

## 7. Kiểu dữ liệu production

Tạo `continuousFingerTypes.ts`:

```ts
export type FingerJointSource =
  | "observed"
  | "predicted"
  | "pip-dip-prior"
  | "synergy"
  | "held"
  | "safe-return"
  | "unavailable";

export interface FingerJointObservation {
  absoluteSemanticAngleRad: number | null;
  rawAbsoluteSemanticAngleRad: number | null;
  detectorBiasRad: number;
  confidence: number;
  source: FingerJointSource;
  sampledAtMs: number | null;
  limited: boolean;
  rejectionReason: string | null;
}

export interface RegularFingerState {
  mcpFlexion: FingerJointObservation;
  mcpAbduction: FingerJointObservation;
  pipFlexion: FingerJointObservation;
  dipFlexion: FingerJointObservation;
}

export interface ThumbState {
  cmcFlexion: FingerJointObservation;
  cmcAbduction: FingerJointObservation;
  cmcOpposition: FingerJointObservation;
  mcpFlexion: FingerJointObservation;
  ipFlexion: FingerJointObservation;
  oppositionObservable: false;
}

export interface ContinuousHandFingerState {
  side: "left" | "right";
  trackingState: "active" | "holding" | "predicting" | "returning" | "idle";
  palmConfidence: number;
  index: RegularFingerState;
  middle: RegularFingerState;
  ring: RegularFingerState;
  little: RegularFingerState;
  thumb: ThumbState;
}
```

`cmcOpposition` không được đánh dấu `observed`: 21 point landmarks không quan sát duy nhất axial rotation quanh
first metacarpal. Source hợp lệ của nó trong v1 là `synergy`, `held`, `predicted`, `safe-return` hoặc
`unavailable`.

## 8. Finger rig profile v2

Nâng `FingerRigProfile.version` từ 1 lên 2 và thêm:

```ts
interface FingerSegmentRigV2 extends FingerSegmentRig {
  restDirectionAvatarHandLocal: Vector3Data;
  flexAxisBoneLocal: Vector3Data;
  abductionAxisBoneLocal?: Vector3Data;
  restSemanticFlexionRad: number;
  restSemanticAbductionRad?: number;
  avatarDeltaLimits: { flexion: AngularLimit; abduction?: AngularLimit };
}

interface ThumbRigV2 {
  cmcSwingBasisLocal: Matrix3Data;
  oppositionAxisLocal: Vector3Data | null;
  oppositionCapability: "inferred" | "unsupported";
  mcpFlexAxisLocal: Vector3Data;
  ipFlexAxisLocal: Vector3Data;
}
```

Profile phải:

- thuộc đúng model generation/fingerprint;
- immutable/deep-freeze sau load;
- validate finite/unit/orthogonal/right-handed;
- lưu rest semantic angle để retarget human angle về avatar rest;
- báo capability theo joint, không chỉ tổng segment count;
- từ chối axis suy biến thay vì fallback world axis tùy ý.

Contract góc bắt buộc cho một hinge:

```text
thetaHumanAbsolute  = geometric signed angle from HumanPalmLocal/human-joint frame
thetaHumanCorrected = thetaHumanAbsolute - clamp(detectorBias, -biasCap, +biasCap)
thetaAvatarAbsolute = gain_j * thetaHumanCorrected + offset_j
deltaAvatar         = thetaAvatarAbsolute - thetaAvatarRest
deltaSafe           = clamp(deltaAvatar, avatarDeltaMin, avatarDeltaMax)
qDelta              = axisAngle(flexAxisBoneLocal, deltaSafe)
```

`thetaHumanAbsolute` không được zero hóa tùy ý theo tư thế calibration. Ví dụ PIP thẳng xấp xỉ `0°`; nếu người
dùng giữ PIP cong `15°` lúc calibration, hệ thống không được coi `15°` đó là neutral `0°`. Calibration chỉ được
sửa detector bias nhỏ có cap. Renderer vẫn áp `restLocal * qDelta`, vì vậy `thetaAvatarRest` chỉ bị trừ đúng một
lần tại boundary retarget này.

Seed `gain=1`, `offset=0`; chúng nằm trong profile/config và chỉ đổi sau acceptance evidence, không theo URL.

MCP 2-DoF dùng convention intrinsic đã khóa:

```text
qDelta = qAbduction * qFlexion
```

Trong Three.js, quaternion bên phải được áp trước. Test phải chứng minh flex axis vận động đúng sau abduction;
nếu fixture cho thấy convention rig cần transported flex axis thì planner phải dựng swing quaternion trực tiếp,
không đổi thứ tự bằng cảm tính.

## 9. Four-finger solver

### 9.1 Vector và angle

Với mỗi chain `MCP=A`, `PIP=B`, `DIP=C`, `TIP=D`:

```text
v0 = normalize(B-A)
v1 = normalize(C-B)
v2 = normalize(D-C)
```

Đưa `v0` vào current palm-local và rest finger basis:

```text
x = dot(v0Palm,a0)
y = dot(v0Palm,d0)
z = dot(v0Palm,c0)
phiMcp   = atan2(x,y)
thetaMcp = atan2(-z,hypot(x,y))
```

Dấu cuối được chốt bằng mirror/geometric fixture: flexion thật phải dương ở cả hai tay. Không đổi dấu riêng theo
webcam screenshot.

PIP/DIP dùng signed hinge angle:

```text
theta = atan2(dot(h,cross(a,b)), clamp(dot(a,b),-1,1))
```

`h` là semantic hinge axis được transport từ rest/history, chiếu vuông góc segment hiện tại rồi normalize. Khi
`length(cross(a,b))` dưới threshold, giữ axis trước và hạ plane confidence; observation suy biến không cập nhật
axis history.

### 9.2 Confidence

Mỗi joint kết hợp:

- palm geometry quality;
- finite/segment degeneracy;
- normalized bone-length consistency;
- bend-plane observability;
- angular velocity quality;
- hand match continuity/freshness.

Bone-length error dùng tỷ lệ theo palm width để không phạt uniform scale drift:

```text
Lnorm = segmentLength / palmWidth
eL = abs(Lnorm - medianReference) / max(medianReference,epsilon)
cL = exp(-0.5 * square(eL/sigmaL))
```

Weighted geometric mean tính trong log space:

```text
logC = sum(wi * log(max(ci,confidenceFloor))) / sum(wi)
c = exp(logC)
```

Hand-level confidence là gate rõ ràng hoặc một term có trọng số; không được liệt kê nhưng quên khỏi công thức.

### 9.3 Human observation validation và avatar safety projection

Không dùng một bảng limit cho cả dữ liệu người và output rig:

- `humanObservationLimits`: kiểm tra/reject hoặc hạ confidence cho góc absolute semantic của người;
- `avatarDeltaLimits`: safety clamp rest-relative theo capability/profile của VRM.

Seed dưới đây là **human absolute semantic observation limits** ban đầu:

| Joint | Minimum | Maximum |
|---|---:|---:|
| Regular MCP flexion | -15° | 90° |
| Regular MCP abduction | -25° | 25° |
| PIP flexion | 0° | 105° |
| DIP flexion | 0° | 85° |

Đây là validation seed, không phải tuyên bố y khoa hay acceptance tự động. PIP/DIP có thể cho phép một vùng
extension âm nhỏ nếu fixture và webcam evidence chứng minh cần thiết; không ép mọi bàn tay mở về đúng `0°`.
`avatarDeltaLimits` được suy/seed riêng theo rig và luôn clamp output cuối. Soft-limit zone làm giảm tốc gần biên;
hard clamp cuối bảo đảm output không vượt miền. Abduction limit giảm dần khi MCP flexion cao để tránh xòe mạnh
trong nắm tay, nhưng observation tốt vẫn được chiếu tới biên gần nhất chứ không đổi thành preset.

Anti-claw/PIP–DIP relation chỉ có trọng số `1-confidence`. DIP observation tốt thắng prior.

## 10. Thumb solver

### 10.1 Mô hình quan sát được

Thumb dùng `CMC=p1`, `MCP=p2`, `IP=p3`, `TIP=p4`, tách hoàn toàn khỏi four-finger solver.

- CMC direction trong palm-local cung cấp hai DoF swing quan sát được.
- MCP flexion lấy signed angle giữa CMC→MCP và MCP→IP.
- IP flexion lấy signed angle giữa MCP→IP và IP→TIP.
- Axial opposition/twist quanh CMC→MCP không quan sát duy nhất từ point chain; v1 suy bằng calibrated coupling
  và luôn báo đúng source.

Không dựng thumb frame chỉ từ hai segment liên tiếp rồi coi là luôn hợp lệ. Khi chúng gần song song, secondary
axis suy biến đúng lúc thumb duỗi. Secondary direction ưu tiên:

1. Projection của palm axis lên mặt phẳng vuông góc first metacarpal.
2. Previous valid thumb plane trong cùng tracking epoch.
3. Rig/calibrated opposition prior với confidence thấp.
4. `unavailable` nếu cả ba không hợp lệ.

### 10.2 CMC swing

Trong palm-local:

```text
u = normalize(MCP-CMC)
u0 = calibrated/rest human thumb direction
qSwing = shortestArc(u0,u)
```

Không phát `qSwing` trực tiếp cho avatar. Decompose/project nó vào rig CMC swing basis v2, clamp ellipse
flexion/abduction, rồi tạo bone-local rest delta. Antipodal direction dùng previous swing plane; không chọn axis
ngẫu nhiên.

### 10.3 Opposition inferred

V1 dùng bounded coupling:

```text
oppositionTarget = kFlex * cmcFlexion + kAbd * cmcAbduction + bias
opposition = confidenceAwareBlend(previousOrNeutral, oppositionTarget)
```

Source là `synergy`, không phải `observed`. Coupling không đọc gesture label. Mục tiêu là làm thumb đi ngang vào
lòng khi landmark thể hiện chuyển động đó, không phải `if fist → opposition`.

### 10.4 Thumb limits

CMC flexion, CMC abduction, inferred opposition, MCP và IP có limit/confidence/filter riêng. Không dùng giới hạn
bốn ngón. Thumb-tip diagnostic tính trong palm-local và avatar-rest geometry, nhưng không ép vào index/middle
chỉ vì classifier gọi pose là `fist`.

## 11. Source selection, occlusion và temporal

Thứ tự production bắt buộc:

```text
raw validation/matching
→ palm-local observations
→ per-joint confidence
→ source selection (observed/held/predicted/prior/safe-return)
→ reacquire blending
→ anatomical projection và soft limits
→ per-joint One Euro filter
→ final hard clamp
→ VRM mapping
```

### 11.1 Lifecycle từng joint

```text
Observed → Held → Predicted → Prior/SafeReturning → Idle
                    ↑                 ↓
                    └── Reacquiring ──┘
```

- `Observed`: fresh sample và confidence trên enter threshold.
- `Held`: loss rất ngắn; giữ output, velocity decay.
- `Predicted`: constant angular velocity có clamp trong cửa sổ ngắn.
- `Prior`: DIP hoặc opposition có prior hợp lệ.
- `SafeReturning`: smoothstep về relaxed rest-relative target.
- `Reacquiring`: blend output hiện tại tới observation mới; không snap.
- `Idle`: exact safe/rest và có thể nhả ownership.

Enter/exit confidence dùng hysteresis. Một frame xấu không được bật qua lại giữa observed/prior.

### 11.2 Prediction và loss

```text
deltaPred = clamp(filteredOmega * dt,-maxPredDelta,+maxPredDelta)
thetaPred = lastTheta + deltaPred
cLoss = c0 * exp(-lossMs/tau)
```

Không extrapolate sau prediction window. Safe return:

```text
u = clamp((lossMs-holdMs)/(returnMs-holdMs),0,1)
w = u*u*(3-2*u)
thetaOut = lerp(thetaPred,thetaSafe,w)
```

Timing seed phải nằm trong config, không rải magic number. Khởi điểm:

| Tham số | Seed |
|---|---:|
| Hold | 80 ms |
| Prediction end | 180 ms |
| Safe return end | 450 ms |
| Reacquire | 120 ms |
| Max prediction delta/frame-equivalent | 8° |

Các seed được chỉnh sau manual evidence nhưng code production không chờ một prototype riêng.

### 11.3 Filter

Mỗi scalar angle có một `OneEuroScalarFilter`; derivative dùng sample timestamp. Reset filter khi gap vượt config,
model/session/side epoch đổi hoặc input không hữu hạn. Confidence thấp thay source/target influence; không chỉ nhân
cứng alpha khiến joint đóng băng.

## 12. Calibration

AR6 không yêu cầu người dùng thu một dataset trước khi code. Runtime calibration là một component production:

- Palm width và normalized bone lengths dùng median/trimmed mean của fresh high-quality samples.
- Không thu neutral khi joint angular velocity cao hoặc pose gần limit.
- Neutral bias chỉ sửa sai lệch nhỏ của detector/user; không biến một bàn tay đang cong thành toàn bộ zero pose.
- Neutral/detector bias có cap rõ ràng, không đổi contract absolute semantic angle thành user-neutral-relative.
- Avatar rest semantic angle đến từ rig profile v2, độc lập user calibration.
- Calibration giữ riêng side/session và reset khi model fingerprint/generation đổi.
- Reacquire ngắn giữ calibration; long reset không tái dùng velocity/history cũ.

Nếu calibration chưa đủ, solver vẫn chạy bằng conservative defaults với capability/diagnostic `uncalibrated`; không
lùi về gesture preset.

## 13. Diagnostics và metrics

Tạo `continuousFingerDiagnostics.ts` và `continuousFingerMetrics.ts`.

DEV snapshot local-only gồm:

- side/model generation/fingerprint;
- palm basis determinant/quality/rejection;
- raw/limited/filtered angle từng joint;
- confidence terms và combined confidence;
- source/lifecycle/timestamp/age;
- clamp count, source transition, prediction duration;
- rig capability và joint mapping;
- thumb opposition source;
- max angular velocity/jitter;
- owned finger joints;
- gesture semantic chỉ để quan sát, không gắn ownership.

Metric cửa sổ:

- P50/P95 angular jitter khi hold still;
- P95 observation→applied delta;
- joint-limit violation trước/sau projection;
- non-finite count;
- source ratio observed/predicted/prior/safe-return;
- reacquire discontinuity;
- mirror mismatch;
- processing time p50/p95;
- FPS/tracking→render được đo theo protocol chung.

Không log raw landmark, ảnh hoặc biometric trace ra server.

## 14. Packet và renderer

AR6 local không cần version packet mới: `jointRotations` đã hỗ trợ 30 finger keys. Sender phát final
**avatar-rig-local rest-relative quaternion**. Đây không phải universal semantic pose và không portable mặc định
giữa hai VRM khác rig.

Trước AR7, chỉ được dùng quaternion contract này qua network khi sender/receiver đã xác nhận cùng rig/profile
fingerprint và version. Khác fingerprint/version phải fail closed cho finger quaternion (safe rest/no-op), không
áp quaternion bone-local của rig A lên rig B.

Tuy nhiên AR7 vẫn phải quyết định network representation lâu dài. AR6 không được âm thầm truyền human raw angle
hoặc landmark dưới Packet V1/V2.

Renderer giữ:

```text
appliedLocal = restLocal * deltaLocal
```

và không thêm smoothing finger lần hai. Mọi quaternion phải normalized và hemisphere-continuous trước packet.

## 15. Cấu trúc file dự kiến

### File mới

| File | Trách nhiệm |
|---|---|
| `continuousFingerTypes.ts` | Contract/state/source |
| `continuousFingerGeometry.ts` | Palm-local vectors, basis, signed angles |
| `continuousFingerCalibration.ts` | Bone-length/bias calibration |
| `continuousFingerConfidence.ts` | Per-joint confidence |
| `continuousFourFingerSolver.ts` | MCP/PIP/DIP observations |
| `continuousThumbSolver.ts` | CMC swing, MCP/IP, inferred opposition |
| `continuousFingerConstraints.ts` | Limits, coupling, anti-claw |
| `continuousFingerTemporal.ts` | Hold/predict/return/reacquire/filter |
| `continuousFingerRetarget.ts` | Semantic angle → rig v2 quaternion |
| `continuousFingerDiagnostics.ts` | Snapshot/rejection/source |
| `continuousFingerMetrics.ts` | Runtime aggregate metrics |

Mỗi production file có `.test.ts` tương ứng. End-to-end thêm `continuousFingerPipeline.test.ts` và
`continuousFingerLifecycle.test.ts`.

### File sửa

- `handPalmBasis.ts`: canonical motion/palm-local adapter dùng chung, không phá Hand Twist convention.
- `fingerRig.ts`: profile v2, rest semantic axes/angles/limits/capability.
- `modelLoader.ts`, `modelTypes.ts`: load profile v2 và lifecycle.
- `motionConfig.ts`: config/validation/seeds AR6.
- `avatarMotionProcessor.ts`: continuous owner và semantic branch song song.
- `avatarMotionDiagnostics.ts`: optional finger diagnostic summary.
- `AvatarRendererDevHarness.tsx`: toggle, per-joint table, sources/metrics.
- `avatarRenderer.ts`: chỉ sửa nếu contract ownership/clear cần thiết; không thêm filter.

## 16. Trình tự code chi tiết

### AR6-T01 — Continuous four-finger solver — 18–26 giờ

#### T01-01 Contract và config

- Thêm types/source/lifecycle/config validator.
- Khóa absolute human semantic angle, capped detector bias và avatar rest-relative delta; cấm double-rest.
- Tách `humanObservationLimits` khỏi `avatarDeltaLimits`.
- Tách `continuousFingerEnabled` khỏi gesture semantic.
- Chốt reset/model lifecycle và owner exclusivity.

#### T01-02 Palm-local geometry

- Tái sử dụng `handPalmBasis`.
- Canonicalize left/right đúng một boundary.
- Thêm finite/right-handed/determinant validation.
- Thêm vector/point conversion và normalized scale.
- Viết fixture neutral, flexion, extension, abduction, flex+abduction, rigid transform, scale và left/right mirror
  trước khi integration runtime.

#### T01-03 Finger rig v2

- Dựng avatar hand-rest-local bases cho bốn ngón; không dùng HumanPalmLocal làm rig space.
- Tính flex/abduction axis local, rest semantic angle và capability.
- Validate/deep-freeze/profile generation.

#### T01-04 Four-finger observations

- MCP flexion/abduction liên tục.
- PIP/DIP signed flexion và hinge-axis continuity.
- Không gộp thành một curl để điều khiển bone.

#### T01-05 Confidence, constraints và temporal

- Per-joint confidence.
- Soft/final hard limit.
- One Euro scalar per joint.
- Basic loss lifecycle đủ an toàn; full occlusion refinement thuộc T03.

#### T01-06 Retarget và processor integration

- Human semantic angle → avatar rest delta.
- Chỉ ghi chain controllable.
- Preset path không còn sở hữu bone khi continuous bật.
- DEV table cho bốn ngón.

#### T01 Definition of Done

- Co/duỗi từng ngón tạo output tỷ lệ liên tục, không nhảy giữa preset.
- MCP abduction thay đổi độc lập với flexion trong miền hợp lệ.
- Rigid rotation và scale không đổi semantic angle quá tolerance.
- Mirror left/right cho cùng semantic sign.
- Không NaN, reverse bend hay claw do single-frame outlier.
- Không thay bất kỳ arm/wrist quaternion nào.

### AR6-T02 — Continuous thumb solver — 14–22 giờ

#### T02-01 Thumb rig/capability

- CMC swing basis, MCP/IP flex axes và inferred-opposition capability.
- Không dùng một flex axis cho toàn thumb semantics.

#### T02-02 Thumb observations

- CMC two-DoF swing trong palm-local.
- MCP/IP signed flexion.
- Plane degeneracy/history rõ ràng.

#### T02-03 Opposition inference

- Bounded continuous coupling từ observed CMC components.
- Source luôn là `synergy`/fallback, không giả observed.
- Không đọc `fist`, `point`, `thumbsUp` hoặc `thumbsDown`.

#### T02-04 Retarget và integration

- Map CMC/MCP/IP theo thumb rig v2.
- Per-joint constraints/filter/lifecycle.
- Thumb-tip diagnostic và anti-penetration chỉ diagnostic; contact correction để AR9.

#### T02 Definition of Done

- Thumb CMC swing, MCP và IP mở/khép liên tục theo landmark đủ confidence.
- Opposition biến đổi liên tục bằng bounded calibrated coupling, không đọc gesture label và luôn báo source khác
  `observed` (`synergy` hoặc lifecycle fallback).
- Khi nắm tay, thumb có xu hướng đi vào phía lòng bàn tay theo observed CMC geometry + inferred coupling; không
  cam kết tiếp xúc/vắt chính xác qua index-middle khi axial opposition không quan sát được.
- Thumb pose lạ vẫn bám observation.
- Không flip khi thumb gần thẳng hoặc palm xoay.
- UI/diagnostic không gọi inferred opposition là observed.

### AR6-T03 — Occlusion, inference và recovery — 12–18 giờ

#### T03-01 Per-joint source selection

- Confidence hysteresis.
- Joint độc lập: DIP yếu không làm mất MCP/PIP tốt.
- Duplicate sample không tiến observation timer.

#### T03-02 Hold/predict/safe return

- Constant angular velocity prediction có clamp/decay.
- Smoothstep safe return.
- Exact idle/rest ownership release.

#### T03-03 Coupling/prior

- PIP→DIP per-finger fallback.
- Weak cross-finger/relaxed prior chỉ khi confidence thấp.
- Thumb opposition inferred và temporal continuity.

#### T03-04 Reacquire

- Reacquire blend theo timestamp.
- Không seed velocity bằng discontinuity đầu tiên.
- Giữ calibration qua loss ngắn; reset history qua loss dài/model reload.

#### T03 Definition of Done

- Che một đầu ngón không làm cả bàn tay snap.
- Source từng joint phản ánh đúng observed/inferred/predicted.
- Không bật giữa hai gesture preset khi visibility thay đổi.
- Reacquire không có discontinuity vượt gate.

### AR6-T04 — Gate, cleanup và tài liệu — 8–12 giờ

#### T04-01 Automated gate

- Geometry invariants: rigid transform, scale, mirror, A→B→A.
- Synthetic continuous sweeps cho từng joint; monotonicity và limits.
- Degenerate/NaN/truncated landmarks.
- Timestamp/duplicate/gap/reset/model reload.
- Thumb straight-plane degeneracy và unusual pose.
- Occlusion/partial loss/reacquire.
- Ownership: continuous/semantic toggle không ghi đè arm/wrist.
- ≥3 synthetic rig profiles khác rest axis/proportion.

#### T04-02 Manual webcam gate

Chạy hai tay trên ít nhất ba VRM:

1. Open → half curl → full curl chậm và nhanh.
2. Co riêng trỏ/giữa/áp út/út.
3. MCP abduction/adduction khi ngón gần thẳng và đang cong.
4. Fist với thumb ngoài, thumb ngang, thumb khép; avatar không dùng một fist pose duy nhất.
5. Thumb CMC flex/abduction, MCP/IP flex và chuyển động opposition.
6. Palm up/down/edge-on và forearm twist; finger angle không đổi giả.
7. Che TIP/DIP, che cả ngón, mất cả bàn tay.
8. Reacquire, đổi side gần nhau, ra/vào khung.
9. Model reload trong lúc tay đang cong.
10. Unknown pose không có gesture label.

#### T04-03 Performance/privacy

- Benchmark tối thiểu 60 giây/model.
- Ghi finger processing p50/p95 và ảnh hưởng FPS.
- Mục tiêu chung tracking→render `<100 ms`, FPS `≥24` trên máy tham chiếu.
- Xác nhận packet/log không chứa raw landmark/frame.

#### T04-04 Cleanup

- Xóa đường preset khỏi production ownership sau khi continuous gate PASS.
- Giữ semantic classifier nếu có consumer thật; nếu không, đánh dấu legacy rõ.
- Cập nhật roadmap/status/architecture/test report.
- Không đánh dấu AR6 DONE nếu thiếu manual evidence hoặc metric bắt buộc.

## 17. Automated acceptance chi tiết

### 17.1 Geometry

- Mọi vector/quaternion finite.
- Basis determinant `> 1-1e-4` sau orthonormalization.
- Hai landmark trùng nhau trả rejection, không normalize zero.
- `R p + t` không đổi semantic joint angles trong tolerance.
- Uniform scale không đổi angles/confidence length ratio.

### 17.2 Four fingers

- Sweep 0→limit tăng đơn điệu ở đúng joint.
- MCP abduction không làm PIP/DIP tự đổi.
- PIP observation tốt không bị coupling sửa.
- DIP mất chuyển đúng source `pip-dip-prior`.
- Hyperextension/out-of-range bị project/clamp và ghi diagnostic.

### 17.3 Thumb

- CMC swing hai trục độc lập trong fixture.
- MCP/IP flexion không dùng regular-finger preset/range.
- Collinear thumb không sinh random plane/flip.
- Opposition inferred không bao giờ báo observed.
- Thumb unusual pose không bị ép thành fist/thumbsUp/down.

### 17.4 Temporal/lifecycle

- Kết quả gần bất biến giữa 15/30/60 FPS với cùng timestamp trajectory.
- Duplicate/reversed timestamp không đẩy velocity/filter/calibration.
- Loss theo đúng held→predicted→safe-return→idle.
- Reacquire blend không đổi hemisphere quaternion.
- Reset/dispose/reload phát identity đúng lifecycle và không giữ state model cũ.

### 17.5 Integration

- Finger output chỉ có `AvatarFingerJointName`.
- Byte-equivalent arm/wrist output khi bật/tắt continuous finger trên cùng input.
- Gesture semantic bật/tắt không đổi finger rotations.
- Model thiếu một chain vẫn điều khiển các chain còn lại.
- Non-VRM hoặc rig unsupported là safe no-op.

## 18. Manual acceptance và ngưỡng duyệt

Các ngưỡng cuối phải được ghi trong báo cáo T04. Seed gate ban đầu:

| Metric | Gate ban đầu |
|---|---:|
| Non-finite output | 0 |
| Post-clamp joint violation | 0 |
| Wrong-side/mirror inversion | 0 |
| Arm/wrist key regression | 0 |
| Random 180° finger flip | 0 |
| Hold-still P95 jitter MCP/PIP | ≤ 3° |
| Hold-still P95 jitter DIP/thumb inferred opposition | ≤ 5° |
| Reacquire single-frame discontinuity | ≤ 12°/joint |
| Continuous solver processing p95 | ≤ 2 ms/hand trên máy tham chiếu |
| Tested VRM | ≥ 3 |

Nếu webcam/MediaPipe noise thực tế khiến một seed không hợp lý, phải ghi raw metric, lý do và ngưỡng thay thế
trong acceptance report; không âm thầm nới config chỉ để PASS.

## 19. Review checklist cho AI khác

Reviewer cần trả lời từng mục:

1. HumanPalmLocal và AvatarHandRestFrame có type/tên/boundary riêng, không dùng lẫn vector không?
2. Left/right canonicalization có đúng một owner không?
3. Signed angle có axis continuity ở singularity không?
4. Có DoF nào bị gọi observed dù point landmarks không quan sát được không?
5. Human joint angle có giữ absolute semantic contract, chỉ trừ capped detector bias và không bị neutral-zero hóa không?
6. Avatar rest có chỉ bị trừ đúng một lần để tạo rest-relative delta không?
7. `humanObservationLimits` và `avatarDeltaLimits` có tách biệt không?
8. Human joint angle có được retarget qua avatar rest/profile thay vì áp trực tiếp world rotation không?
9. Quaternion order có fixture endpoint chứng minh không?
10. Confidence/source selection xảy ra trước filter và prior có bị giới hạn bởi confidence không?
11. Final safety clamp có chạy sau temporal không?
12. Gesture label có bất kỳ đường nào ghi bone rotation không?
13. Finger có thể ghi đè wrist/arm không?
14. Duplicate timestamp/model reload/loss/reacquire có reset đúng không?
15. Privacy và packet compatibility có giữ nguyên không?
16. Network quaternion có same fingerprint/version guard và fail-closed khi khác rig không?
17. Test có kiểm geometry endpoint/invariant, không chỉ label/quaternion khác identity không?
18. Synthetic fixture có tồn tại trước processor integration không?
19. Manual evidence có đủ hai tay và ≥3 VRM không?

## 20. Điều kiện đánh dấu task

- `AR6-T01 DONE`: four-finger continuous production path, automated gate và integration ownership PASS.
- `AR6-T02 DONE`: thumb continuous/inferred-opposition path và thumb automated gate PASS.
- `AR6-T03 DONE`: per-joint occlusion/source/reacquire automated gate PASS.
- `AR6-T04 DONE`: manual ≥3 VRM, performance/privacy report và cleanup hoàn tất.
- `AR6 DONE`: chỉ khi cả T01→T04 DONE; code xanh một mình không đủ.

Sau AR6-T04 quay lại corrective review AR5-T01 theo roadmap. Mọi thay đổi AR5 sau đó phải chạy lại toàn bộ
finger ownership, palm rotation, occlusion và multi-model regression của AR6.
