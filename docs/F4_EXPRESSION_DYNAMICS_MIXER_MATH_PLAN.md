# F4 — Kế hoạch toán cho Expression Dynamics và Mixer

Trạng thái: **FAST-SPEECH HYBRID CORRECTIVE COMPLETE — 61 files / 690 tests + build/lint PASS; chờ manual webcam retest nói nhanh/pucker/m-b-p/silent-smile và D1–D10**  
Ngày lập: 2026-09-11

## 1. Mục tiêu

F4 nhận các target biểu cảm tức thời từ F1–F3 và tạo ra bộ expression cuối cùng ổn định để đưa vào
`AvatarPosePacketV1`:

1. Mỗi nhóm cơ có tốc độ riêng: mí và môi nhanh, chân mày vừa, má chậm hơn.
2. Môi khép nhanh khi bằng chứng hình ảnh cho thấy `mouthClose`/`mouthPress` tăng, chuẩn bị nền cho m/b/p.
3. Các kênh đối kháng không kéo mesh theo hai hướng trái ngược cùng lúc.
4. Tổng cường độ được giới hạn theo từng vùng giải phẫu, không dùng một budget toàn mặt.
5. Mất rồi bắt lại khuôn mặt không giữ pose cũ, không giật và không tạo “năng lượng ẩn” bật ra sau đó.
6. Local và remote nhìn thấy cùng một expression packet; renderer không tự diễn giải dynamics lần hai.

F4 không nhận diện âm vị m/b/p. Webcam chỉ cung cấp bằng chứng khép/ép môi; F5 mới dùng audio để xác nhận
âm vị, VAD, coarticulation, jitter buffer và đồng bộ miệng–tiếng.

## 2. Ngoài phạm vi

- Không dùng microphone, không lưu audio, frame hoặc landmark.
- Không thêm thư viện.
- Không thay đổi schema packet hay giao thức mạng.
- Không sửa công thức neutral calibration F1, blink hysteresis F2 hoặc vowel geometry F3.
- Không tạo cảm xúc hội thoại, micro-expression hoặc idle motion; đó là F6.
- Không tự suy đoán raw morph cho model lạ; capability/profile vẫn là nguồn sự thật của F0.

## 3. Vấn đề gốc trong code hiện tại

Expression đang bị smoothing ở hai tầng:

```text
F1/F2/F3 target
  → OneEuro dùng chung cho mọi expression trong AvatarMotionProcessor
  → packet
  → exponential damping lần hai trong AvatarRenderer
  → VRM/raw morph
```

Hệ quả:

- môi, má và chân mày dùng chung một đặc tính thời gian dù sinh lý khác nhau;
- blink có ngoại lệ damping riêng ở renderer nhưng vẫn đã qua filter ở processor;
- môi khép nhanh có thể bị hai tầng filter làm chậm;
- local và remote phụ thuộc nhịp render, nên cùng packet có thể cho chuyển động khác nhau;
- reset timestamp dài ở `OneEuroScalarFilter` có thể seed thẳng target mới và gây snap;
- các kênh F2/F3 đều hợp lệ riêng lẻ nhưng khi cộng trên cùng mesh vẫn có thể quá mức.

Đây là lỗi kiến trúc cần sửa ở F4; không giải quyết bằng cách tiếp tục tăng damping riêng lẻ.

## 4. Quyền sở hữu sau F4

```text
F1 calibrated coefficients
  → F2/F3 semantic targets
  → pre-mix: sanitize + conflict + budget target
  → facial dynamics: attack/release theo nhóm cơ
  → post-mix safety projection
  → AvatarPosePacketV1.expressions
  → renderer áp expression đúng giá trị packet
```

Quy ước trách nhiệm:

- F2 vẫn sở hữu xác nhận blink/wink và chống false blink. Đây là quyết định semantic, không phải amplitude smoothing.
- F3 vẫn sở hữu hình học miệng và phân bố năm vowel.
- `FacialExpressionDynamicsMixer` mới là nơi duy nhất sở hữu thời gian đáp ứng của expression.
- `AvatarRenderer` vẫn smooth bone rotation, nhưng không smooth expression lần hai.
- `Filter OFF` trong DEV chỉ bypass temporal dynamics; sanitize, conflict và safety budget luôn bật. Mỗi sample
  OFF vẫn phải ghi `state = final visible output`, để bật ON tiếp tục từ đúng khuôn mặt đang hiển thị.

Pre-mix tạo target giải phẫu hợp lệ. Post-mix là cần thiết vì khi đổi từ một antagonist sang antagonist kia,
giá trị cũ đang release có thể chồng lên giá trị mới đang attack. Đây là hai phép chiếu constraint, không phải
hai tầng smoothing.

## 5. Ký hiệu và điều kiện an toàn

```text
safe01(x) = Number.isFinite(x) ? min(1, max(0, x)) : 0
dtRaw     = (timestamp[n] - timestamp[n-1]) / 1000
dt        = min(dtRaw, dtMax)
α(dt,τ)   = 1 - exp(-dt / τ)
```

Mọi config phải được validate một lần khi tạo processor:

- tất cả số phải hữu hạn;
- `τ > 0`, `dtMax > 0`;
- budget dương;
- gain/threshold được giới hạn đúng miền đã khai báo;
- một semantic chỉ thuộc đúng một dynamics group.

Input runtime không hữu hạn trở thành 0; output cuối luôn hữu hạn và trong `[0,1]`.

### 5.1 Duplicate, timestamp đảo và gap dài

- Cùng sample timestamp: trả nguyên state hiện tại, không tiến filter.
- Timestamp đảo: bỏ sample đó, không reset thẳng sang target.
- Gap bình thường: dùng thời gian thật để đáp ứng độc lập FPS.
- Gap lớn hơn `maxContinuousGapMs`: giữ output hiện tại, chỉ rebase clock và bắt đầu attack từ output đó.
- `dtMax` ngăn frame đầu sau khi tab/camera treo có `α ≈ 1` và snap.

Giá trị khởi tạo đã review: `dtMax = 0.08 s`, `maxContinuousGapMs = 250 ms`. `dtMax=80 ms` giữ nguyên
wall-clock ở stress test 15 FPS (`dt≈66.7 ms`) nhưng vẫn chặn bước nhảy lớn sau khi tab/camera treo. Hai giá trị
phải được kiểm chứng bằng test 15/30/60 FPS và webcam, không rải magic number.

## 6. Temporal dynamics bất đối xứng

Với target đã mix `x[n]`, output trước đó `y[n-1]`:

```text
τ = x[n] > y[n-1] ? τAttack(group) : τRelease(group)
y[n] = y[n-1] + α(dt,τ) × (x[n] - y[n-1])
```

Thời gian đạt 90% bước nhảy là `t90 ≈ 2.303τ`. Bảng dưới là seed để review/webcam gate, chưa phải số đã
nghiệm thu:

| Nhóm | Semantic chính | `τAttack` | `τRelease` | `t90 attack` |
|---|---|---:|---:|---:|
| Eyelid | blink trái/phải | 10 ms | 30 ms | 23 ms |
| Lip closure | `mouthClose`, `mouthPress*` | 12 ms | 45 ms | 28 ms |
| Vowel | `aa/ih/ou/ee/oh` | 20 ms | 50 ms | 46 ms |
| Jaw/lip shape | jaw, pucker, funnel, narrow, wide | 25 ms | 60 ms | 58 ms |
| Lip detail/corner | upper/lower, smile/frown L/R | 35 ms | 90 ms | 81 ms |
| Brow | inner/outer up, down L/R | 45 ms | 100 ms | 104 ms |
| Cheek/nose | squint, puff, sneer | 70 ms | 150 ms | 161 ms |

Má chậm không đồng nghĩa pipeline trễ 161 ms: output bắt đầu đổi ở frame đầu, còn `t90` mô tả thời gian settle.
Acceptance latency tổng thể vẫn theo FR-05: tracking→render dưới 100 ms và ít nhất 24 FPS.

### 6.1 Fast close cho m/b/p

F4 không biết chữ người dùng phát âm. Nó chỉ phản ứng nhanh với bằng chứng nhìn thấy:

```text
Ctarget = mouthClose                 // canonical closure đã được F3 suy ra
C       = dynamics(Ctarget, τAttack=12 ms, τRelease=45 ms)
Bvowel  = (1 - C)^γ                  // γ=1 ở V1
vowels  = project(vowels, Bvowel)
```

Projection được áp lại ở post-mix bằng `C` đã dynamics để phần vowel cũ không tiếp tục lộ trong lúc môi đang khép,
nhưng chạy lại không tiếp tục nhân nhỏ vowel. `mouthPress*` giữ dynamics/morph riêng; F4 không suy lại closure từ
chúng vì F3 đã sở hữu công thức geometry.
`jawOpen` vẫn độc lập: người dùng có thể hạ hàm nhưng khép hai môi. F5 sẽ cung cấp thêm phoneme evidence để
khép đúng thời điểm m/b/p, không thay công thức giải phẫu này.

## 7. Conflict resolution

### 7.1 Hàm antagonist cơ sở

Với hai evidence đối kháng `a,b`:

```text
resolve(a,b) = (max(0, a-b), max(0, b-a))
```

Hàm liên tục theo giá trị, giữ phía có bằng chứng mạnh hơn và đưa về neutral khi detector mâu thuẫn ngang nhau.
Không dùng winner-takes-all vì sẽ nhảy khi `a-b` đổi dấu quanh 0.

Áp theo từng bên cho:

- `mouthSmileLeft` ↔ `mouthFrownLeft`, tương tự bên phải;
- `eyeWideLeft` ↔ `eyeSquintLeft`, tương tự bên phải;
- brow-up ↔ brow-down từng bên;
- `mouthWide` ↔ `mouthNarrow`;
- `jawLeft` ↔ `jawRight`.

Blink có priority cao hơn eye-wide/squint bằng available-budget projection:

```text
Beye = (1 - blinkSide)^γ             // γ=1 ở V1
[eyeWideSide, eyeSquintSide] = project([eyeWideSide, eyeSquintSide], Beye)
```

Không dùng phép nhân `x *= (1-priority)` trong primitive chạy ở cả pre/post vì phép đó không idempotent.
`mouthClose` có priority cao hơn vowel nhưng không xóa `jawOpen`. Pucker và funnel không bị coi là antagonist
tuyệt đối vì chúng có thể cùng mô tả một khẩu hình tròn; chúng được quản lý bằng budget.

### 7.2 Chân mày inner/outer

F2 giữ kênh chi tiết để model có capability dùng được. `browInnerUp` là một semantic global và có thể đồng xuất
hiện với `browDown` trong nét lo lắng/buồn, nên không bị tách giả thành hai scalar hoặc coi là antagonist tuyệt đối.
Chỉ resolve cặp outer-up/down theo từng bên:

```text
(browOuterUpLeft,  browDownLeft)  = resolve(...)
(browOuterUpRight, browDownRight) = resolve(...)
```

Sau đó mới dựng aggregate fallback `browUpCandidate=max(browInnerUp, avg(outerLeft,outerRight))` và
`browDownCandidate=avg(downLeft,downRight)`, rồi resolve riêng cặp aggregate. Average giữ được phần inner-up phía
không bị down trong tình huống bất đối xứng; không dùng preset cảm xúc toàn mặt
để giả chân mày cho model thiếu capability.

### 7.3 Full-face emotion

F4 bỏ phép suy trực tiếp `happy = average(mouthSmileLeft, mouthSmileRight)` khỏi mapper. Nụ cười miệng
không được tự động biến thành preset vui toàn mặt vì preset đó có thể kéo cả mắt/má/miệng và cộng chồng
với F2/F3. Aggregate smile được tách theo độ mở hàm: `mouthSmileClosed` đi tới `MTH_Fun`, còn
`mouthSmileOpen` đi tới `MTH_Joy`; smooth transition, gain và suppression của vowel/lip-shape ngăn hai pose
cộng thành miệng há quá mức. Aggregate frown đi tới `MTH_Sorrow`. Đây đều là morph riêng vùng miệng,
không phải full-face emotion. F6 là chủ sở hữu duy nhất của `happy/angry/sad/surprised` tổng hợp.

Nếu packet tương lai nhận explicit full-face emotion, F4 chỉ clamp/project nhóm emotion với tổng budget 1;
không tự sinh cảm xúc mới.

## 8. Saturation budget theo vùng

Không dùng một budget toàn mặt: chớp mắt không được làm yếu khẩu hình và nói không được làm yếu chân mày.

### 8.1 Phép chiếu budget

Với vector không âm `z` và budget `B`:

```text
S = Σ z[i]
project(z,B) = z                         nếu S <= B
             = z × B / max(S, ε)        nếu S > B
```

Phép chiếu giữ tỷ lệ tương đối và không đổi kết quả đã nằm trong miền hợp lệ.

### 8.2 Budget khởi tạo

| Vùng | Quy tắc |
|---|---|
| Vowel | `Σ(aa,ih,ou,ee,oh) <= 1` |
| Mouth base | closure có priority; jaw độc lập |
| Lip shape | pucker/funnel/narrow/wide tối đa `0.80`; đồng thời vowel + closure + lip shape tối đa `1.35` |
| Lip vertical | upper/lower tối đa `0.80` theo từng bên |
| Mouth corner | smile/frown/dimple/stretch tối đa `1.0` theo từng bên, tránh cười hai bên bị yếu hơn cười lệch |
| Mỗi mắt | sau blink gate: `blink + wide + squint <= 1` |
| Mỗi bên chân mày | up/down đã resolve, tổng `<= 1` |
| Cheek/nose | budget từng bên `0.8`; puff bị giảm theo squint mạnh |
| Full-face emotion | tổng `happy+angry+sad+surprised <= 1`, F4 không tự sinh |

Với lip-shape sum `R`:

```text
available = min(0.80, max(0, 1.35 - closure - vowelSum))
lipShape = project(lipShape, available)
```

Các số `0.80/1.35` là seed tuning đã được reviewer chấp nhận có điều kiện. F4 không dùng budget theo tên raw
morph vì packet phải model-independent.

## 9. Thứ tự xử lý và chống “năng lượng ẩn”

Mỗi sample mới:

```text
raw semantic target
  → safe01
  → preMix(raw)
  → asymmetricDynamics(previousOutput, desired, dt)
  → postMixSafety(smoothed)
  → store(finalOutput) làm state cho frame sau
```

Phải lưu `finalOutput` sau post-mix, không lưu giá trị trước projection. Nếu lưu state chưa project, một vowel
đang bị `mouthClose` che vẫn tồn tại bên trong filter và sẽ bật lại đột ngột khi môi mở; đó là “năng lượng ẩn”.

Pre-mix và post-mix phải dùng cùng primitive conflict/budget để test được idempotence gần đúng:

```text
mix(mix(x)) ≈ mix(x)
```

## 10. Mất và bắt lại khuôn mặt

F4 dùng lifecycle hiện có của tracking nhưng trở thành nơi duy nhất điều khiển amplitude expression:

1. `active + fresh`: tiến dynamics theo target mới.
2. `active + duplicate/not-sampled`: giữ nguyên output; không coi là missing frame mới.
3. `held`: giữ output tin cậy cuối trong `holdMs`.
4. `returning`: fade từ một snapshot cố định ở đầu pha return về 0 bằng cubic smoothstep.
5. `idle`: output đúng 0 và clear state.
6. Reacquire: attack từ output hiện tại tới target mới; không seed thẳng target.

Envelope return:

```text
u       = clamp((now - returnStartedAt) / returnMs, 0, 1)
Ereturn = 1 - u²(3 - 2u)
y       = returnStartVector × Ereturn
```

Snapshot ở đầu return ngăn lỗi nhân fade lặp trên chính output đã fade. Tại `u=1`, output đạt đúng 0 nên không
có snap lúc chuyển sang idle. Model switch, processor reset và session mới clear state về neutral.

F4 sẽ thay đường release expression hiện tại của F1; F1 vẫn sở hữu neutral baseline/calibration lifecycle,
không còn một fade amplitude thứ hai.

## 11. Cấu trúc code dự kiến

Không thêm dependency. Tên cuối có thể đổi nhẹ khi implement nhưng trách nhiệm không được nhập nhằng:

```text
frontend/src/lib/avatar-motion/
  facialExpressionMixer.ts
  facialExpressionMixer.test.ts
  facialExpressionDynamics.ts
  facialExpressionDynamics.test.ts
```

Thay đổi tích hợp dự kiến:

- `motionConfig.ts`: dynamics groups, τ, gap và regional budgets.
- `avatarMotionProcessor.ts`: F2/F3 → mixer/dynamics; bỏ OneEuro dùng chung cho expression và nối lifecycle.
- `expressionMapper.ts`: bỏ derived full-face `happy`; giữ map coefficient nền.
- `avatarRenderer.ts`: expression áp đúng packet; smoothing bone không đổi.
- `AvatarRendererDevHarness.tsx`: thêm panel F4 và làm rõ `Filter` chỉ điều khiển temporal dynamics.
- Test renderer/processor liên quan được cập nhật để khóa single-owner contract.

Không sửa `oneEuroFilter.ts`: bone/vector pipeline vẫn có thể dùng nó. Chỉ expression rời khỏi cấu hình OneEuro
dùng chung hiện tại.

## 12. Diagnostic local-only

Panel F4 tại `/dev/avatar-renderer` hiển thị dữ liệu số, không lưu frame:

- `raw → desired → dynamic → final` cho các kênh đang hoạt động mạnh nhất;
- dynamics group, `dt`, attack/release đang dùng;
- conflict nào vừa suppress kênh nào;
- scale của từng regional budget;
- lifecycle `active/held/returning/idle/reacquiring`;
- cờ `duplicate`, `gap-rebase`, `filter-bypassed`;
- tổng vowel, mouth corrective, eye/brow/cheek từng bên.

Diagnostic phải dùng chính intermediate result của thuật toán, không tính lại công thức riêng trong UI.

### 12.1 Corrective fast-speech telemetry — 2026-09-14

Telemetry được bổ sung trước khi chỉnh thuật toán để tách đúng tầng làm mất biên độ. Processor giữ cửa sổ peak
1 giây theo timestamp của fresh face sample, thay vì dựa vào nhịp render panel 400 ms. Dữ liệu chỉ gồm scalar:

- raw và calibrated `jawOpen` cùng các kênh hình học miệng đã chọn;
- `visibleOpening`, round, stretch và activity candidate không chứa smile/viseme feedback;
- vowel sum và closure tại F3 mapped → F4 desired → dynamic → final;
- sample count, effective face sample FPS, active sample count và peak 1 giây;
- semantic, model expression name và weight đã clamp thực sự gửi vào renderer.

Telemetry không lưu frame, ảnh, landmark hay audio; reset cùng facial lifecycle/model switch. Bước này không thay
đổi expression output. Mid-range curve, peak-decay, mixer/model gain và adaptive attack chỉ được triển khai sau
khi baseline webcam xác định tầng attenuation thực tế.

### 12.2 Fast-speech corrective implementation — 2026-09-14

Telemetry thực tế cho thấy sample lỗi có `raw/calibrated jaw peak = 0.03`, `visibleOpening = 0`, nhưng F3 vowel
và cả F4 desired/dynamic/final đều đạt peak `1.00`. Vì vậy F4 temporal/mixer không phải tầng attenuation chính;
adaptive attack chưa có bằng chứng để triển khai.

Corrective được đặt trước mixer với tuning ban đầu đã review:

- activity onset/full `0.05/0.55`, lấy max của opening, round và stretch đã loại smile;
- mid-range lift `0.35`, chỉ tăng amplitude của tỷ lệ `aa/ih/ou/ee/oh` F3 hiện tại;
- normalized-shape envelope exponential decay `90 ms` theo timestamp;
- viseme mới thay toàn bộ shape cũ, không peak-hold từng vowel độc lập;
- strong closure `0.65` reset opening envelope nhưng không xóa `mouthClose`;
- gap trên `250 ms`, face returning/model reset xóa temporal state;
- Filter OFF vẫn có bounded amplitude mapping nhưng không giữ peak theo thời gian.

Không có global jaw gain, không dùng smile làm speech evidence, không tạo viseme khi current vowel sum bằng 0.
Model-specific gain chưa được thêm vì chưa có gate đa model; nếu final/renderer target đã cao nhưng morph vẫn yếu,
đó là capability/profile decision riêng sau manual test.

### 12.3 Hybrid lip-aperture corrective — 2026-09-14

Manual retest sau envelope cho thấy hai lỗi đồng thời: nói tự nhiên vẫn có thể không tạo `jawOpen`, còn pucker nhẹ
lại thành `ou` gần cực đại. Đây không thể sửa bằng tăng gain/hold tiếp. F3 được bổ sung bằng chứng hình học:

1. Lấy inner lip `13/14` và hai khóe `61/291` từ Face Mesh.
2. Đo khe môi theo pháp tuyến của trục hai khóe để head roll không biến dịch ngang thành opening.
3. Dùng pixel aspect thật rồi chuẩn hóa khe môi bằng bề rộng miệng, loại phụ thuộc khoảng cách camera.
4. Map aperture ratio bằng smoothstep `0.02 → 0.32` và lấy max với blendshape jaw đã map.
5. Closure hiện hành vẫn dập visible opening; landmark không đi vào pose packet hay renderer diagnostics ngoài scalar.

Pucker/funnel activation được nén lần lượt từ `0.07/0.55` thành `0.12/0.85` và từ `0.07/0.55` thành
`0.10/0.80`. Input cực đại vẫn đạt 1; chỉ vùng vừa giảm độ nhạy. Automated test khóa scale normalization,
roll invariance, video aspect, invalid geometry, landmark fallback khi raw jaw thấp và moderate-pucker compression.

## 13. Kế hoạch test tự động

### 13.1 Unit — mixer

1. Clamp NaN/Infinity/âm/quá 1.
2. Vowel sum không vượt 1 ở lưới input.
3. Smile/frown, wide/narrow, eye wide/squint, brow up/down không cùng thắng.
4. Blink suppress eye-wide/squint đúng từng bên.
5. Mouth close suppress vowel nhưng không sửa jawOpen.
6. Regional budget không làm yếu vùng không liên quan.
7. Left/right mirror symmetry.
8. `mix(mix(x)) ≈ mix(x)`.
9. Không có output NaN/Infinity.

### 13.2 Unit — dynamics

1. Step response khớp công thức tại 15/30/60 FPS theo cùng thời gian thực.
2. Unit test với synthetic `dt` nhỏ xác nhận lip closure đạt 90% quanh 28 ms; ở cadence 24–30 FPS,
   lần update đầu sau closure phải vượt 90%. Cheek chậm hơn lip.
3. Attack/release bất đối xứng đúng config.
4. Duplicate không tiến state.
5. Timestamp đảo bị bỏ, không snap.
6. Gap dài rebase clock và ramp từ output cũ.
7. Filter OFF trả target đã mix ngay nhưng vẫn giữ safety constraints.
8. Reset/model switch trả neutral.

### 13.3 Integration — processor/lifecycle

1. Fresh → held → returning → idle về đúng 0 liên tục.
2. Reacquire ở mọi pha không seed thẳng target.
3. Closure bật khi vowel cũ còn release không làm vowel ló lại sau khi closure tắt.
4. Đổi antagonist liên tục không overshoot hoặc tích state ẩn.
5. Packet chỉ chứa số hữu hạn `[0,1]` và serialize được.
6. F1 calibration reset vẫn reset đúng F4 state.

### 13.4 Renderer regression

1. Expression value packet được áp trực tiếp dù bone smoothing bật.
2. Bone rotation smoothing vẫn giữ nguyên.
3. VRM preset và raw morph production profile nhận cùng final semantic value.
4. `vrm.update()` không ghi đè raw morph đã map.

## 14. Webcam acceptance

Chạy ít nhất `reference-avatar-2`, `reference-avatar-3` và một model capability yếu:

| Case | Thao tác | PASS |
|---|---|---|
| D1 | Nhắm/chớp nhanh từng mắt và hai mắt | Mí đóng đủ, không chậm nhão, mở lại không bật |
| D2 | Ép môi nhanh nhiều lần như m/b/p, rồi giữ neutral, chưa bật audio | Môi khép rõ ngay update đầu; jaw không bị ép về 0; neutral không false-close/rung |
| D3 | `aa → ou → ee → neutral` chậm rồi nhanh | Không cộng vowel quá mức, không giật khi đổi shape |
| D4 | Cười lệch trái/phải rồi cau miệng | Không có smile và frown mạnh cùng một bên |
| D5 | Mở to mắt đồng thời nhướng/cau mày | Mắt và mày không đấu nhau hoặc làm mesh quá mức |
| D6 | Chớp trong lúc đang mở to mắt | Blink thắng tức thời, sau blink không bật eye-wide đột ngột |
| D7 | Cố tình làm nhiều biểu cảm cực đại cùng lúc | Không méo/explode mặt; vùng không liên quan vẫn hoạt động |
| D8 | Giữ neutral 10 giây | Môi/má/mày ổn định; F4 không tự tạo cảm xúc |
| D9 | Che mặt ngắn, che tới returning, rồi xuất hiện lại | Hold/fade đúng; reacquire không snap |
| D10 | Tắt/bật Filter trong DEV | OFF phản hồi tức thời nhưng vẫn không vượt budget; ON không nhảy state |

Độ rõ blendshape khác nhau giữa model là capability/profile issue. F4 PASS khi dynamics và constraint đúng trên
kênh model thực sự hỗ trợ; không dùng full-face preset để che giấu kênh thiếu.

## 15. Acceptance criteria cuối F4

- Chỉ một tầng sở hữu expression dynamics.
- Fast lip closure đạt response gate tự động và nhìn rõ qua webcam.
- Mí/môi nhanh hơn chân mày; chân mày nhanh hơn má theo test wall-clock.
- Conflict và budget đúng theo từng vùng, không có global face scale.
- Duplicate, gap, loss và reacquire không snap hoặc phát lại state ẩn.
- Không phát sinh camera/audio/landmark egress và không đổi packet contract.
- Toàn bộ frontend unit test, build và lint PASS.
- Manual gate D1–D10 được chủ dự án xác nhận trước khi đánh dấu DONE.

## 16. Quyết định sau AI review

Reviewer kết luận **APPROVE WITH REQUIRED CHANGES**; các thay đổi bắt buộc đã được đưa vào code:

1. Processor là temporal owner duy nhất; renderer áp expression packet trực tiếp.
2. Priority dùng available-budget projection idempotent, không dùng phép nhân lặp ở pre/post.
3. `dtMax=80 ms` để stress test 15 FPS vẫn theo đúng wall-clock.
4. F4 chỉ đọc canonical `mouthClose`; không suy lại closure từ `mouthPress*`.
5. `browInnerUp` giữ global; outer-up/down resolve theo side, aggregate fallback resolve riêng.
6. Budget khóe miệng tách theo side; symmetric smile không yếu đi chỉ vì có hai kênh.
7. Filter OFF vẫn lưu final visible output vào temporal state.
8. Chưa thêm velocity cap; chỉ xem xét sau khi có bằng chứng webcam mà chỉnh `τ` không đủ.
9. Corrective webcam: bỏ hoàn toàn đường `eyeSquint → blink`. Bằng chứng mới cho thấy blink diagnostic bằng
   0 nhưng raw eye Joy vẫn đóng mắt, nên `Fcl_EYE_Joy_L/R` cũng bị loại khỏi production profile; blink thật
   vẫn có toàn quyền đóng mí.
10. Corrective webcam: tách aggregate smile thành closed/open theo max của `jawOpen` và độ tách môi
    trên/dưới, map lần lượt tới mouth Fun/Joy, giới hạn gain và giảm vowel/lip-shape cộng chồng; frown map
    tới mouth Sorrow. Không dùng preset `happy`.
11. Corrective model 2: bỏ mapping Narrow/Wide số 29/30 vì asset này thiếu Small/Large. Bỏ cả mapping
    `mouthClose → 25`: metadata gọi đây là thành phần của expression Extra và forensic vertex bounds cho thấy
    nó dịch chuyển cả vùng mắt. Model 2 khép m/b/p bằng việc closure triệt vowel về rest pose.
12. Webcam tuning: tăng riêng `mouthSmileOpen` gain từ `0.50` lên `0.60` để cười hở răng rõ hơn; closed smile,
    closure m/b/p và các budget khác giữ nguyên.

Reviewer chấp nhận antagonist difference làm V1, nhưng yêu cầu giữ diagnostic before/after và kiểm tra riêng
`mouthWide↔mouthNarrow` bằng webcam. Các budget và time constant vẫn là seed tuning cho manual gate.
