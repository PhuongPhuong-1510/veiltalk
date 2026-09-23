# AR4-T06 — Hybrid Torso Fore/Aft Lean cho khung gọi video

Ngày lập: 2026-09-15  
Trạng thái: **DONE — OWNER ACCEPTANCE 2026-09-16; VERIFICATION FOLLOW-UP DEFERRED**
Phụ thuộc: AR4-T01–T05 và AR4-T03.1 vertical shrug  
Ước tính: **16–24 giờ code/test + manual tuning trên ít nhất 3 VRM**

## 1. Mục tiêu

Cho avatar có thể chúi thân về phía camera hoặc ngả thân ra sau mà vẫn dùng được trong hai kiểu khung hình:

- `full-torso`: thấy vai và hông, đo torso pitch trực tiếp từ shoulder–hip axis;
- `shoulder-only`: chỉ thấy đầu, vai và một phần cánh tay, dùng proxy bảo thủ từ image scale/depth;
- hông chỉ nâng chất lượng quan sát, không được làm gain đổi đột ngột giữa phiên;
- đầu/cổ giữ quan hệ đúng với thân, không tạo lại lỗi “đầu một nơi, người một nẻo”;
- không thêm root translation, camera zoom, chest translation hoặc full-body locomotion.

Tuyên bố sản phẩm sau task phải giới hạn như sau:

- `full-torso`: “observed torso fore/aft lean approximation”;
- `shoulder-only`: “conservative approach/lean proxy”, không tuyên bố khôi phục chính xác torso depth;
- webcam đơn không phân biệt tuyệt đối rigid-body lean với cả người tiến gần camera.

## 2. Hiện trạng và khoảng trống

AR4-T02 hiện đã phát torso yaw/roll trong `shoulder-only`, nhưng cố ý xóa thành phần pitch vì hai vai không quan sát
được rotation quanh shoulder axis. `full-torso` có shoulder–hip basis nên có pitch, nhưng chất lượng phụ thuộc việc hông
được thấy rõ. Điều này an toàn nhưng khiến khung gọi video thông thường trông cứng theo chiều trước/sau.

AR4-T06 giữ contract nhún vai, nhưng có một corrective coupling bắt buộc sau manual test:

- vertical shrug tiếp tục dùng Pose image-space;
- torso lean không được lấy từ thay đổi gap tai–vai hoặc nose–vai;
- lean được giải trước shoulder; khi depth/torso-angle cho thấy lean rõ, chỉ thành phần dịch dọc **chung** của hai vai bị giảm để perspective không bị hiểu thành bilateral shrug;
- thành phần chênh lệch trái/phải vẫn được giữ; simultaneous bilateral shrug + lean là trường hợp mơ hồ và được degrade bảo thủ;
- shoulder translation vẫn chỉ áp cục bộ lên hai raw shoulder bone.

## 3. Quyết định kiến trúc cần reviewer duyệt

| Chủ đề | Quyết định đề xuất |
|---|---|
| Packet | Giữ `AvatarPosePacketV2`; torso lean đi trong `jointRotations`, không thêm field packet |
| Temporal owner | Processor là owner duy nhất; renderer áp trực tiếp quaternion như AR4 hiện tại |
| Full source | Shoulder–hip axis trong Pose world-space, neutral-relative |
| Shoulder-only source | Multi-cue proxy từ Pose image shoulder scale, Face image scale và Pose relative depth |
| Session mode | Mode calibration tiếp tục khóa cho cả phiên; `shoulder-only` không tự promote khi hông xuất hiện |
| Full mất hông | Blend 220 ms từ full observation sang proxy; không snap về 0 hoặc đổi gain tức thì |
| Translation | Không root/chest translation; chỉ rotation qua hips/spine/chest/upperChest |
| Head ownership | Head-relative solver hiện hữu là owner duy nhất và nhận final torso-parent delta; T06 không sửa head sau composer |
| Faithful mode | Chỉ chuyển động có evidence; không tự sinh procedural lean |
| Privacy | Chỉ scalar/quaternion đã solve vào packet; landmark/matrix vẫn local-only |

## 4. Quy ước dấu và hệ tọa độ

Giữ semantic frame hiện tại:

```text
MediaPipe (x, y, z) → semantic (x, -y, -z)
+X: phải màn hình
+Y: lên theo cơ thể
+Z: forward semantic đã chuẩn hóa bởi coordinateAdapter
```

Không gắn dấu avatar trực tiếp vào dấu MediaPipe. Solver tạo scalar có tên giải phẫu:

```text
leanAngle > 0  := torso chúi về phía camera/forward
leanAngle < 0  := torso ngả ra sau
```

Adapter duy nhất chuyển `leanAngle` sang semantic pitch X. Unit test fixture phải chứng minh:

- shoulder center tiến forward so với hip center → avatar chúi tới;
- shoulder center lùi sau hip center → avatar ngả sau;
- mirror camera không đảo dấu;
- đổi model không đổi dấu.

Không tune dấu bằng cách chèn `-1` rải rác trong solver/composer/renderer.

## 5. Quan sát `full-torso`

Với shoulder center `Cs`, hip center `Ch`, neutral axes `U0/F0` và torso vector `T = Cs - Ch`:

```text
u          = dot(T, U0)
f          = dot(T, F0)
theta      = atan2(f, u)
thetaFull  = wrapPi(theta - thetaNeutral)
```

Phép đo góc không phụ thuộc độ dài `T`. Trước khi chấp nhận sample:

```text
qLandmark  = min(visibility[11], visibility[12], visibility[23], visibility[24])
qLength    = smoothstep(0.35 × L0, 0.70 × L0, |T|)
qBasis     = 1 - smoothstep(0.80, 0.98, abs(dot(normalize(T), R0)))
qFull      = qLandmark × qLength × qBasis × freshness
```

Reject thay vì clamp mù khi torso vector suy biến hoặc nonfinite. Seed mapping:

```text
dead-zone full = 1.0°
forward cap    = +18°
backward cap   = -12°
```

Các cap là safety seed, phải tune bằng webcam trên ba VRM.

## 6. Quan sát `shoulder-only`

### 6.1 Image-space scale

Từ Pose normalized landmarks đã sửa aspect ratio:

```text
W  = abs((xLeftShoulder - xRightShoulder) × videoWidth/videoHeight)
sW = log(W / W0)
```

Face scale dùng khoảng cách hai tâm mắt trong Face Mesh:

```text
leftEyeCenter  = mean(face[33], face[133])
rightEyeCenter = mean(face[362], face[263])
F  = distanceAspectCorrected(leftEyeCenter, rightEyeCenter)
sF = log(F / F0)
sRelative = sW - sF
```

`sRelative` chỉ là **consistency/ambiguity cue**, không map trực tiếp thành lean angle. Nó giúp phân loại vai thay đổi
khác mặt hay toàn khung đang scale đồng đều. Nếu chỉ mặt tiến gần nhưng vai ổn định thì proxy phải gần 0, không kéo
cả torso theo đầu.

### 6.2 Relative depth cue

Pose normalized Z chỉ là cue mềm, không phải mét thật:

```text
Zs       = (semanticZ(leftShoulder) + semanticZ(rightShoulder)) / (2 × W)
sDepth   = Zs - ZsNeutral
```

Dấu `sDepth → leanAngle` phải được khóa bằng recorded/synthetic fixture trước khi bật. Không dùng Z khi:

- nonfinite hoặc shoulder visibility dưới gate;
- variance trong cửa sổ 150 ms vượt baseline;
- vai gần mép ảnh;
- shoulder span quá nhỏ;
- Pose sample duplicate/reversed.

### 6.3 Fusion và ambiguity gate

Depth là angle cue duy nhất của shoulder-only seed; scale không trực tiếp tạo góc:

```text
thetaDepth    = kDepth × sDepth       // kDepth chỉ khóa sau sign/scale fixture
thetaProxyRaw = thetaDepth
```

Confidence:

```text
cScaleConsistency = combine(qShoulders, qFace, agreement(sW, sF, sRelative))
cDepth    = qShoulders × qDepthStability × qInFrame

headPenalty  = smoothstep(12°, 25°, abs(headPitchDelta))
yawPenalty   = smoothstep(15°, 30°, abs(torsoYaw))
rollPenalty  = smoothstep(12°, 25°, abs(torsoRoll))
shrugPenalty = smoothstep(0.15, 0.35, abs(commonShoulderVertical))

hardValidityGate = min(qInFrame, qFinite, qVisibility)
softPenalty = 0.30×headPenalty + 0.25×yawPenalty + 0.20×rollPenalty + 0.25×shrugPenalty
baseConfidence = combine(cScaleConsistency, cDepth)
cProxy = baseConfidence × hardValidityGate × (1 - clamp01(softPenalty))
```

Không nhân liên tiếp mọi soft gate. Source confidence dùng hysteresis `proxyEnter=0.60`, `proxyExit=0.50`.

Trường hợp uniform scale `sW ≈ sF` là mơ hồ giữa lean rigid-body và tiến gần camera:

- không phát full-strength lean;
- nếu depth cue cũng yếu/không ổn định: observation unavailable;
- nếu depth cue nhất quán: cho phép “approach gesture” seed `+2°/-1.5°`, hard maximum ±3°;
- diagnostic phải báo `ambiguous-camera-approach`, không gọi là observed torso pitch.

Depth-only không bao giờ được promote thành full-strength proxy chỉ vì ổn định. Khi Face scale thiếu hoặc scale
agreement không đủ, nó luôn dùng cùng low cap như ambiguous approach.

Seed giới hạn shoulder-only:

```text
dead-zone proxy = 1.5°
forward cap     = +6°
backward cap    = -4°
proxy enter/exit = 0.60 / 0.50
```

Không hạ confidence gate chỉ để demo có chuyển động. Nếu evidence yếu thì avatar về neutral mượt.

## 7. Source state machine và continuity

```text
TorsoLeanSource =
  | full-torso
  | shoulder-proxy
  | ambiguous-camera-approach
  | unavailable
```

- Phiên `full-torso`: ưu tiên full source; khi mất hông, giữ ngắn rồi blend 220 ms sang proxy nếu proxy hợp lệ.
- Phiên `shoulder-only`: chỉ dùng proxy trong cả phiên; hông xuất hiện giữa chừng không promote và không đổi gain.
- Recalibration mới được phép đổi session mode.
- Khi source thay đổi, blend từ **giá trị đang phát**, không blend từ raw target cũ.
- Duplicate/reversed timestamp không cập nhật observation, confidence history hoặc source dwell.
- Mất mọi source: dùng lifecycle torso hiện có `hold 160 ms → return 420 ms → exact neutral`.
- Reacquire dùng 220 ms, không snap.

Full và proxy đều phải map vào cùng semantic `leanAngle` trước source transition. Không blend quaternion của hai hệ quy
chiếu chưa chuẩn hóa.

## 8. Temporal và responsiveness

Không thêm renderer smoothing. Raw fused lean được đưa vào temporal torso hiện có trước hierarchy composition:

```text
alpha(dt, tau) = 1 - exp(-dt/tau)
filtered = previous + alpha × (target - previous)

attack tau  = 110 ms
release tau = 180 ms
```

Nếu One Euro torso hiện hữu được tái sử dụng thì không thêm exponential filter thứ hai; các hằng số trên trở thành
target response để tune One Euro. Gate định lượng:

- `t50 ≤ 150 ms`;
- `t90 ≤ 380 ms`;
- overshoot ≤ 5%;
- neutral jitter final ≤ 0.35° standard deviation;
- giảm jitter ít nhất 30% so với raw nhưng không đạt bằng cách làm trễ vượt gate.

## 9. Phân phối xương và giữ hướng đầu

`leanAngle` được phân phối qua các torso bone khả dụng bằng weight chuẩn hóa:

| Bone | Seed weight |
|---|---:|
| hips | 0.10 |
| spine | 0.25 |
| chest | 0.35 |
| upperChest | 0.30 |

Bone thiếu thì redistribute trên bone còn lại; mỗi joint vẫn chịu ellipsoid cap của rig profile. Không dồn residual
vượt cap vào một joint cuối.

Sau khi có final torso parent-world chain, head target phải tính lại trên các **neutral-relative semantic delta**
(không nhân rest/world quaternion vào công thức delta này):

```text
QheadWorldDeltaDesired = QfaceDelta
QtorsoParentWorldDelta = delta(QtorsoParentWorldNeutral, QtorsoParentWorldFinal)
QheadRelativeDelta = inverse(QtorsoParentWorldDelta) ⊗ QheadWorldDeltaDesired
```

`QheadRelativeDelta` sau đó mới phân phối qua neck/head theo capability. Mục tiêu:

- người chúi thân nhưng vẫn nhìn camera → thân cúi, mặt avatar vẫn nhìn camera;
- người cúi cả thân lẫn đầu → cả hai chuyển động được giữ;
- không cộng torso pitch lần hai vào head;
- model thiếu neck/upperChest vẫn redistribute có cap và báo residual.

Arm solver tiếp tục nhận animated parent world rotation cuối cùng. Không sửa wrist/hand/finger semantics.

## 10. Tương tác với shrug và life motion

- Thứ tự owner cố định: solve torso lean → tính `commonMotionGain` → solve vertical shoulder → temporal/composition.
- Không dùng shoulder output làm confidence input của lean vì tạo vòng phụ thuộc; `shrug` chỉ còn là diagnostic compatibility field.
- `commonMotionGain = 1 - smoothstep(0.5°, 1.5°, |leanEvidence|)`, trong đó full dùng torso angle và proxy dùng raw depth-angle trước dead-zone/cap.
- Gain chỉ áp lên trung bình L/R của ear-gap hoặc nose-gap; differential L/R không bị triệt.
- Manual corrective 2026-09-16: tiến/lùi làm `Vertical raw L/R` bão hòa cùng dấu ±1.00 và avatar rụt cổ/co vai. Trường hợp này là FAIL và đã có regression để common shoulder output gần 0 khi lean evidence rõ.
- Không lấy breathing hoặc `speechChest` làm evidence lean.
- Faithful mode đứng yên: lean target bằng 0; chỉ breathing sinh lý hiện hữu tiếp tục.
- Cinematic sway không được cộng pitch fore/aft mới trong task này.
- Lean và shoulder local translation compose đúng một lần; không dịch chest/root để “tăng cảm giác”.

## 11. Capability và safe degradation

| Capability/evidence | Hành vi |
|---|---|
| Full torso bones + hips visible | Full observation và phân phối đầy đủ |
| Hips visible, thiếu một số torso bone | Full observation; redistribute trên bone hợp lệ |
| Shoulder-only + Face/Pose tốt | Proxy cap thấp |
| Face scale thiếu nhưng Pose depth ổn định | Depth-only ambiguous proxy; seed cap `+2°/-1.5°`, hard max ±3° |
| Pose depth yếu nhưng relative scale tốt | Relative-scale-only proxy với confidence/cap giảm |
| Chỉ face hoặc chỉ một shoulder | Unavailable → hold/return |
| Model head-only | Không torso lean; head legacy/AR4 path vẫn hoạt động |
| Nonfinite/profile mismatch/model swap | Reset exact neutral, không giữ state model cũ |

## 12. Diagnostics local-only

DEV AR4 thêm:

```text
Lean session mode: shoulder-only | full-torso
Lean source: full-torso | shoulder-proxy | ambiguous-camera-approach | unavailable
Full raw/final angle
sW · sF · sRelative · sDepth
Confidence: relative/depth/final
Gate: head/yaw/roll/shrug/in-frame
Applied torso pitch · aggregate clamp · residual
Source dwell · loss/reacquire state
```

`Freeze current` chỉ giữ scalar/quaternion diagnostic trong RAM. Không lưu hoặc upload ảnh, raw landmark hay Face
matrix. Packet serialization test phải chứng minh các diagnostic field không xuất hiện trong payload.

## 13. Thứ tự triển khai AR4-T06-01 → 06

### AR4-T06-01 — Contract và telemetry

Trạng thái code: **COMPLETE**.

- Thêm internal result/source/diagnostic types; không đổi Packet V2.
- Thêm config validate finite/range và reset ownership.
- DEV panel hiển thị raw cues nhưng chưa bật output behavior.

### AR4-T06-02 — Full-torso observation

Trạng thái code: **COMPLETE**.

- Tách fore/aft angle từ shoulder–hip vector và neutral axes.
- Khóa sign, scale invariance, degeneracy và visibility/freshness gate.
- So sánh với pitch AR4-T02 hiện tại; chỉ giữ một owner, không cộng hai pitch.

### AR4-T06-03 — Shoulder-only proxy

Trạng thái code: **COMPLETE**.

- Capture neutral shoulder/face scale và shoulder depth.
- Aspect correction, log-ratio, depth stability và ambiguity classification.
- Head/yaw/roll/shrug/in-frame gates; conservative caps.

### AR4-T06-04 — Fusion, temporal và source lifecycle

Trạng thái code: **COMPLETE**; manual tuning/source transition vẫn thuộc final gate.

- Session-mode policy, full→proxy fallback, source dwell/blend.
- Duplicate/loss/return/reacquire/exact-neutral.
- Không double smoothing.

### AR4-T06-05 — Hierarchy/head/arm integration

Trạng thái code: **COMPLETE**.

- Phân phối lean qua torso hierarchy.
- Truyền final torso-parent delta vào head-relative solver hiện hữu; T06 không tạo head correction owner thứ hai.
- Chạy lại animated-parent arm, shoulder translation, Hand Twist và finger regression.

### AR4-T06-06 — Automated/manual/performance gate

Trạng thái: **AUTOMATED PASS; MANUAL/PERFORMANCE PENDING**.

- Chạy toàn frontend test/lint/build.
- Manual matrix trên ít nhất ba VRM.
- Benchmark 60 giây/model và cập nhật docs trạng thái trung thực.

Không code bước sau nếu contract/sign fixture của bước trước chưa PASS.

## 14. Automated test gate

### Observation

- Neutral full/proxy = 0.
- Full forward/back đúng dấu và scale invariant.
- Mirror image không đảo fore/aft sign.
- Shoulder-only close crop nhận proxy khi hông invisible.
- Cả người tiến gần: không vượt cap `ambiguous-camera-approach`.
- Chỉ đầu tiến gần hoặc gật đầu: torso gần 0.
- Bilateral/unilateral shrug: torso proxy gần 0.
- Fore/aft lean làm hai vai trôi dọc cùng dấu trong image-space: shoulder common gần 0; differential vẫn hoạt động.
- Yaw/roll lớn hạ proxy confidence, không phát pitch giả.
- Zoom/aspect 4:3, 16:9 và portrait cho kết quả trong tolerance.
- Nonfinite, span nhỏ, mép ảnh, visibility 0.54/0.55/0.56 đúng boundary.
- Bốn soft quality cùng bằng 0.8 không làm source vô lý thành unavailable.
- Uniform shoulder + face + hips translation Z: full angle gần 0, proxy không vượt ambiguous cap.

### Temporal/source

- Session shoulder-only không promote khi hips xuất hiện.
- Full mất hips: transition 220 ms, không discontinuity.
- Duplicate/reversed không promote filter/source history.
- Hold→return→exact zero; reacquire không snap.
- A–B–A dài không drift; model swap không state leak.
- Confidence `.54/.56/.53/.57/.54/.56` không làm proxy source flap.
- t50/t90, jitter reduction và overshoot cùng PASS.

### Hierarchy/regression

- Tổng torso pitch sau distribution bằng target trong tolerance khi không clamp.
- Missing bone redistribution không vượt joint cap.
- Head world target không double-apply torso pitch.
- Head compensation vẫn đúng khi người nhìn camera trong lúc lean.
- Torso và head cùng lean 10°: không counter-rotate head giả về camera.
- Elbow/wrist world error và pole/twist continuity không regression.
- Shoulder vertical displacement đi theo parent đúng một lần.
- V1 legacy và V2 không-lean fixture byte-equivalent với baseline.
- Packet privacy: không landmark/matrix/diagnostic/raw cue.

Gate cuối: toàn bộ `npm test`, `npm run lint`, `npm run build` PASS.

## 15. Manual webcam gate

Chạy cả `shoulder-only` và `full-torso`, Dynamics/filter ON, trên ít nhất ba VRM:

| Mã | Kịch bản | Kỳ vọng |
|---|---|---|
| TL-U1 | Neutral 10 giây | Không tự chúi/ngả; chỉ breathing rất nhẹ |
| TL-U2 | Full-torso chúi tới 5 lần | Đúng hướng, liên tục, không root slide |
| TL-U3 | Full-torso ngả sau 5 lần | Đúng hướng, cap an toàn |
| TL-U4 | Shoulder-only chúi nhẹ khi vẫn nhìn camera | Avatar phản ứng nhẹ, không cần thấy hông |
| TL-U5 | Shoulder-only ngả nhẹ | Có phản ứng bảo thủ, không snap |
| TL-U6 | Chỉ đưa đầu gần/xa, vai giữ yên | Torso gần 0; đầu/cổ vẫn đúng |
| TL-U7 | Cả người tiến gần/lùi camera | Chỉ approach cap nhỏ hoặc unavailable; không full-strength lean |
| TL-U8 | Cúi/ngửa đầu tại chỗ | Không tạo torso pitch giả |
| TL-U9 | Nhún riêng/cả hai vai | Không tạo torso lean giả; shoulder vẫn hoạt động |
| TL-U9A | Chúi/ngả làm cả hai vai trôi dọc cùng dấu trên camera | Avatar không co vai/rụt cổ; `lean common gain` về gần 0 và shoulder raw L/R gần 0 |
| TL-U10 | Yaw/roll 20–30° rồi lean | Không đảo dấu; proxy degrade an toàn khi quá góc |
| TL-U11 | Full session mất hông rồi có lại | Blend mượt, không đổi biên độ đột ngột |
| TL-U12 | Giơ tay/chéo tay khi lean | Arm/shoulder/wrist không bật, lật hoặc xuyên thân tăng rõ |
| TL-U13 | Lean nhưng giữ mắt nhìn camera | Đầu/cổ bù đúng, không “đầu một nơi người một nẻo” |
| TL-U14 | Mất Pose rồi reacquire | Hold/return/reacquire mượt |
| TL-U15 | Tiến/lùi camera, 4:3 và 16:9 | Không đổi dấu, không nhảy gain |
| TL-U16 | Reload và đổi ≥3 VRM | Không state leak; model reduced degrade đúng capability |
| TL-U17 | LIVE 60 giây/model | Không drift, invalid 0, đạt FPS/latency NFR |

### Kết quả manual ngày 2026-09-16

| Phạm vi | Model/mode | Kết quả | Bằng chứng |
|---|---|---|---|
| Corrective fore/aft visual + TL-U9A | `reference-avatar-2.vrm`, `shoulder-only` | **PASS — chủ dự án xác nhận** | Chúi tới: lean `shoulder-proxy`, raw/final `6°/6°`, confidence `0.68`, `commonMotionGain=0`, shoulder raw gần `0/-0.01`; avatar không còn co vai/rụt cổ bất tự nhiên. Ngả sau được chủ dự án xác nhận đạt về cảm nhận hình ảnh |

Kết quả này đóng manual corrective trên model đang thử. Ngày 2026-09-16, chủ dự án xác nhận AR4-T06 và toàn bộ
AR4 hoàn thành, cho phép chuyển sang AR5-T01. TL-U1→TL-U17 trên ít nhất ba VRM và benchmark LIVE 60 giây/model
chưa có bằng chứng được giữ làm verification follow-up/deferred; không ghi nhận các mục này là đã PASS.

## 16. Điều kiện DONE

Chỉ đánh dấu AR4-T06 DONE khi:

1. AR4-T06-01→06 hoàn tất theo thứ tự.
2. Automated test/lint/build xanh.
3. TL-U1→TL-U17 được chủ dự án xác nhận trên ít nhất ba VRM.
4. Shoulder-only không cần thấy hông và không mạnh lên đột ngột khi hông xuất hiện.
5. Head/arm/vertical shrug không regression.
6. Benchmark tracking→render `<100 ms`, FPS `≥24` trên máy tham chiếu.
7. Architecture, testing, codebase guide, roadmap và performance docs được cập nhật cùng phiên code.

Nếu shoulder-only chỉ đạt phản ứng nhẹ nhưng ổn định, task có thể PASS đúng tuyên bố “conservative proxy”. Không được
hạ tiêu chí false-positive để quảng bá nó như true torso depth reconstruction.

## 17. Rủi ro cần reviewer tập trung

| Rủi ro | Chốt chặn |
|---|---|
| Lean và tiến gần camera không phân biệt tuyệt đối | Ambiguity source riêng, cap ±3°, tuyên bố giới hạn rõ |
| Head nod tạo face-scale/depth giả | Head pitch gate + shoulder-relative evidence |
| Shrug làm shoulder cue thay đổi | Không dùng vertical gap; common-shrug confidence suppression |
| Hông xuất hiện làm avatar đổi gain | Session mode lock; chỉ recalibration đổi mode |
| Torso pitch cộng lần hai vào đầu | Head-relative recompute từ final torso parent + world-target test |
| Torso hierarchy làm lệch tay | Animated-parent arm regression và end-effector metric |
| Proxy rung do Pose Z | Stability window, confidence gate, dead-zone và conservative cap |
| Filter mượt nhưng quá trễ | Jitter gate luôn đi cặp t50/t90/overshoot |

## 18. Câu hỏi bắt buộc cho AI reviewer

1. Công thức full-torso `atan2(forward, up)` và sign boundary đã đủ chặt chưa?
2. Proxy có cue nào đang double-count camera approach hoặc cần loại bỏ hoàn toàn không?
3. Ambiguous approach cap ±3° có quá cao đối với khung gọi video không?
4. Việc recompute head-relative từ final torso parent có xung đột với composer hiện tại không?
5. Bộ gate head/yaw/roll/shrug có tạo vùng chết quá lớn hoặc cần hysteresis riêng không?
6. Automated/manual matrix đã đủ chứng minh không phụ thuộc hông và không regression arm/shoulder chưa?
