# F3 — Kế hoạch toán cho Webcam Mouth Core

Trạng thái: **DONE — 637/637 automated test + build/lint PASS; manual webcam gate PASS 2026-09-11**  
Ngày lập: 2026-09-11

## 1. Mục tiêu và ranh giới

F3 biến các hệ số blendshape MediaPipe đã qua neutral calibration F1 thành hai lớp dữ liệu:

1. Cơ sở hình học của miệng: độ mở hàm, độ khép môi, độ tròn, độ kéo ngang và các phần môi độc lập.
2. Năm target khẩu hình VRM: `aa`, `ih`, `ou`, `ee`, `oh`.

F3 là suy luận **hình dạng nhìn thấy từ webcam**, không khẳng định đã nhận diện đúng âm vị người dùng nói.
Những âm có hình môi giống nhau không thể phân biệt chắc chắn chỉ bằng ảnh. Audio/VAD, timestamp alignment,
jitter buffer và coarticulation thuộc F5; dynamics, filter theo nhóm cơ và expression budget thuộc F4.

Không thêm thư viện, không lưu frame, không dùng microphone và không thay đổi packet/network trong F3.

## 2. Hiện trạng cần thay

`mapMediaPipeExpressions` hiện gán trực tiếp:

```text
aa = jawOpen
```

Do đó avatar chỉ giống một hàm mở/đóng; `ih/ou/ee/oh` chưa được suy ra. F3 phải bỏ phép gán này và giữ
`jawOpen` độc lập với `mouthClose`.

## 3. Ký hiệu toán

Mọi input `x_k` đi qua F1 neutral calibration, nhưng F3 vẫn phải tự bảo vệ trước dữ liệu không hữu hạn.

```text
safe01(x)  = Number.isFinite(x) ? min(1, max(0, x)) : 0
t          = safe01((safe01(x) - a) / (b - a))
S(x; a,b)  = t²(3 - 2t)                 // smoothstep có đạo hàm liên tục ở hai đầu
avg(L,R)   = (L + R) / 2
```

Config phải được validate một lần khi tạo processor: mọi `a/b/gain` hữu hạn, `0 <= a < b <= 1` và
mọi gain nằm trong miền được khai báo. Config sai phải throw rõ ràng; không âm thầm chia cho 0 hoặc dùng
fallback. `safe01` xử lý dữ liệu runtime lỗi, còn validation xử lý lỗi lập trình/cấu hình.

Các ngưỡng dưới đây là **giá trị khởi tạo để webcam gate**, không phải hằng số đã nghiệm thu:

| Đại lượng | onset `a` | full `b` |
|---|---:|---:|
| `jawOpen` | 0.06 | 0.70 |
| inner-lip aperture ratio | 0.02 | 0.32 |
| seal/`mouthClose` | 0.08 | 0.55 |
| `mouthPucker` | 0.12 | 0.85 |
| `mouthFunnel` | 0.10 | 0.80 |
| horizontal stretch | 0.06 | 0.50 |
| upper/lower lip và corner | 0.05 | 0.50 |

Tất cả ngưỡng phải nằm trong `motionConfig`, không rải magic number trong processor.

## 4. Bước A — Chuẩn hóa bằng chứng hình học

### 4.1 Hàm và độ khép môi là hai bậc tự do

```text
Jblend = S(jawOpen; 0.06, 0.70)
Jlip   = S(innerLipGap / mouthWidth; 0.02, 0.32)
J      = max(Jblend, Jlip)
Press = avg(mouthPressLeft, mouthPressRight)
C0    = max(mouthClose, 0.75 × Press)
C     = S(C0; 0.08, 0.55)
O     = J × (1 - C)
```

- Output vẫn giữ riêng `jawOpen = J` và `mouthClose = C`.
- `O` chỉ là độ mở **nhìn thấy giữa hai môi**, dùng để suy ra vowel.
- Không thay `J` bằng `J × (1-C)`: người dùng có thể hạ hàm nhưng vẫn ép hai môi; dữ liệu phải giữ được
  trạng thái đó. Với model chỉ có vowel preset mà không có jaw morph riêng, đây là giới hạn capability.
- `mouthClose` chặn vowel, nhưng không xóa dữ liệu hàm.

### 4.2 Tròn môi và kéo ngang

```text
P0 = S(mouthPucker; 0.12, 0.85)
F0 = S(mouthFunnel; 0.10, 0.80)
T0 = S(avg(mouthStretchLeft, mouthStretchRight); 0.06, 0.50)

R0 = max(P0, F0)          // round evidence
W  = T0 × (1 - 0.50×R0)  // width evidence
R  = R0 × (1 - 0.50×T0)  // round evidence sau antagonism
```

Không dùng `mouthSmile` làm nguồn chính cho `W`, vì nếu dùng thì một nụ cười im lặng sẽ bị hiểu thành
khẩu hình `ih`. F5 có VAD mới được phép dùng audio để phân biệt “đang nói” và “đang cười”.

Diagnostics phải tách bằng chứng detector khỏi giá trị corrective để biết lỗi nằm ở MediaPipe hay mapper:

```text
geometry.pucker = P0
geometry.funnel = F0
```

Các corrective semantic độc lập:

```text
mouthPucker = P0 × (1 - 0.65×O)
mouthFunnel = F0 × (0.35 + 0.65×O)
mouthNarrow = max(P0, F0)
mouthWide   = T0
```

### 4.3 Môi trên/dưới và bất đối xứng

```text
upperLeft  = S(mouthUpperUpLeft;    0.05, 0.50)
upperRight = S(mouthUpperUpRight;   0.05, 0.50)
lowerLeft  = S(mouthLowerDownLeft;  0.05, 0.50)
lowerRight = S(mouthLowerDownRight; 0.05, 0.50)

mouthUpperUp  = avg(upperLeft, upperRight)
mouthLowerDown = avg(lowerLeft, lowerRight)
```

Kênh trái/phải vẫn được giữ riêng trong packet. Hai giá trị trung bình chỉ là fallback cho model có một
morph đối xứng. `mouthSmileLeft/Right`, `mouthFrownLeft/Right` cũng giữ độc lập; F3 không ép hai bên bằng
nhau và không trộn chúng thành emotion toàn mặt.

## 5. Bước B — Suy ra năm khẩu hình webcam

Từ độ mở nhìn thấy `O`, tạo ba membership liên tục:

```text
Low  = 1 - S(O; 0.18, 0.42)
Mid  = S(O; 0.12, 0.38) × (1 - S(O; 0.55, 0.85))
High = S(O; 0.40, 0.80)
```

Điểm thô của năm khẩu hình:

```text
q_aa = O × (1 - 0.80×R) × (1 - 0.15×W)
q_ih = W × Low × (1 - R)
q_ee = W × Mid × (1 - R)
q_ou = R × Low × (0.60 + 0.40×P0)
q_oh = R × max(Mid, High) × (0.60 + 0.40×F0)
```

Ý nghĩa:

| Hình học nhìn thấy | Target ưu tiên |
|---|---|
| Mở lớn, không tròn | `aa` |
| Kéo ngang, mở ít | `ih` |
| Kéo ngang, mở vừa | `ee` |
| Tròn/chu, mở ít | `ou` |
| Tròn/phễu, mở vừa–lớn | `oh` |

### 5.1 Chuẩn hóa để không cộng quá mức

```text
A0 = max(J, R0, T0)              // evidence trước antagonism và trước closure
A  = A0 × (1 - C)                // closure chỉ suppress activity đúng một lần
Q  = q_aa + q_ih + q_ou + q_ee + q_oh

nếu Q <= ε: v_k = 0
ngược lại: v_k = A × q_k / Q
```

Không lấy amplitude từ `max(O,R,W) × (1-C)`: vì `O` đã chứa `(1-C)`, cách cũ làm closure tác động hai
lần trong ca jaw-dominant. Cũng không lấy amplitude từ `R/W` sau antagonism, vì mâu thuẫn round–wide chỉ
được đổi **phân phối** vowel, không được làm sụt tổng cường độ hình học.

Bất biến phải giữ:

```text
0 <= v_k <= 1
sum(v_k) <= 1
neutral => mọi v_k = 0
C tiến về 1 => mọi vowel tiến về 0
```

Đây là normalization cục bộ bắt buộc để F3 không làm méo mặt. Saturation budget cho toàn bộ cơ mặt,
conflict priority và recovery dynamics vẫn để F4 sở hữu.

F3 v1 giữ proportional normalization, tương đương sharpening exponent `gamma = 1`. Không hard top-2 vì
F3 không có hysteresis và việc đổi hạng sát nhau sẽ gây bật/tắt morph. Nếu webcam gate cho thấy 3–4 vowel
trộn quá “nhão”, phương án thử đầu tiên là `q'_k = q_k^gamma`, `gamma > 1`, rồi normalize lại; chỉ đưa vào
sau khi có bằng chứng webcam, không thêm config chưa dùng ở bản đầu.

### 5.2 Quyết định rõ cho `O = 0`

**Cho phép** `ih` mạnh khi `O=0, W>>0, C=0` và cho phép `ou` mạnh khi `O=0, R>>0, C=0`.

Lý do: `i/u` có thể có jaw opening rất nhỏ; `C` mới là bằng chứng lip seal. `O=0` nhưng `C=0` và stretch
hoặc pucker mạnh vẫn là một hình miệng có chủ ý. F3 mô phỏng geometry nên chuyển động im lặng vẫn được
phản ánh; F5 mới dùng VAD để giảm vowel khi người dùng không nói. Không thêm aperture gate chung vì nó sẽ
giết `ih/ou`. Hai hành vi zero-opening này phải có test explicit để không thay đổi vô tình về sau.

## 6. Quy tắc actuation theo capability model

Processor phát semantic, renderer chỉ áp channel mà model thực sự hỗ trợ:

1. `aa/ih/ou/ee/oh` dùng VRM ExpressionManager khi preset có bind thật.
2. Raw morph nâng cao chỉ được dùng khi nằm trong profile đã nghiệm thu theo fingerprint.
3. Một raw target không được gán cho hai semantic khác nhau trong cùng profile.
4. Không dùng preset `happy/angry/surprised` toàn mặt để giả một bộ phận môi.
5. Model thiếu channel sẽ bỏ qua channel đó; không suy đoán theo tên file hoặc số thứ tự morph của model lạ.

Audit asset hiện tại:

| Model | Năm vowel preset | Corrective mouth |
|---|---|---|
| `reference-avatar` | 5/5 bind thật | VRM 0 mất raw target name; chỉ thêm key số sau allowlist fingerprint |
| `reference-avatar-1` | 0/5 bind thật | Không có bộ mouth morph độc lập đủ dùng; không thể đạt năm vowel nếu không re-rig model |
| `reference-avatar-2` | 5/5 bind thật | VRM 0 key số; profile riêng theo fingerprint |
| `reference-avatar-3` | 5/5 bind thật | Có `Fcl_MTH_Close/Up/Down/Small/Large` và tên vowel rõ |
| `reference-avatar-4` | 5/5 bind thật | Có raw morph Nhật cho rộng/hẹp/môi trên/dưới; chỉ bật sau manual semantic gate |

Với hai VRoid VRM 0 đã mất tên, các key corrective dự kiến cần xác nhận bằng F0 trước khi production:

```text
reference-avatar:   close=25, upper=26, lower=27, narrow=29, wide=30
reference-avatar-2: close=25, upper=26, lower=27, narrow=29, wide=30
```

Năm vowel của hai model này vẫn dùng preset VRM có bind thật, không điều khiển trực tiếp key số vowel.

## 7. Kiến trúc code dự kiến

Không viết F3 vào `expressionMapper.ts` thành một hàm lớn. Tách trách nhiệm:

```text
F1 calibrated MediaPipe coefficients
  -> computeMouthExpressions (pure, không state thời gian)
     -> mouth geometry diagnostics: J/C/O/R/W
     -> semantic outputs: jaw/close/correctives + aa/ih/ou/ee/oh
  -> existing face lifecycle/filter
  -> AvatarPosePacketV1
  -> capability/profile-aware renderer
```

File dự kiến:

- `mouthExpression.ts`: `safe01`, config validation, công thức pure và snapshot diagnostic tách
  `geometry.*` khỏi `corrective.*`.
- `mouthExpression.test.ts`: example tests + grid/property invariants, không thêm test library.
- `avatarMotionProcessor.ts`: gọi mouth processor sau F1, song song với F2 eye/brow processor.
- `motionConfig.ts`: toàn bộ onset/full/gain.
- `facialExpressionProfile.ts`: chỉ bổ sung raw corrective đã nghiệm thu.
- `AvatarRendererDevHarness.tsx`: panel F3 raw/calibrated geometry và năm vowel.

F3 không tạo temporal state riêng. Smoothing hiện tại tiếp tục chạy một lần ở processor; F4 sẽ thay bằng
dynamics theo nhóm cơ. Khi face loss/model change/reset, lifecycle F1 hiện có tiếp tục đưa mọi key về 0.

## 8. Test toán bắt buộc trước webcam gate

### 8.1 Unit/invariant

- Mọi tổ hợp input hữu hạn đều cho output hữu hạn trong `[0,1]`.
- Quét lưới `J/C/P/F/T` từ 0 đến 1: tổng năm vowel không vượt 1.
- Neutral trả toàn bộ mouth output về 0.
- Tăng `jawOpen` trong ca không tròn/không kéo ngang làm `aa` không giảm.
- Tăng `mouthClose` làm tổng vowel không tăng; tại closure mạnh tổng vowel gần 0.
- Mở ít + kéo ngang: `ih` lớn nhất; mở vừa + kéo ngang: `ee` lớn nhất.
- Mở ít + tròn/chu: `ou` lớn nhất; mở vừa/lớn + funnel: `oh` lớn nhất.
- Mở lớn, không tròn: `aa` lớn nhất.
- Chỉ cười, không stretch/jaw/round: không tự phát vowel mạnh.
- Chỉ kích hoạt bên trái không làm mất giá trị trái/phải và aggregate đúng trung bình.
- Input thiếu key được coi là 0; input `NaN/Infinity` bị clamp an toàn.
- `J>0, 0<C<1, R=W=0`: tổng activity bằng `J×(1-C)`, bắt regression closure bị nhân hai lần.
- `O=0, C=0, W>>0`: cho phép `ih` mạnh theo quyết định thiết kế.
- `O=0, C=0, R>>0`: cho phép `ou` mạnh theo quyết định thiết kế.
- `P0≈1, F0≈1, T0≈1`: output vẫn hữu hạn, tổng activity không collapse vì antagonism.
- Kiểm tra continuity tại mọi `a/b ± epsilon` của `Low/Mid/High` và input remap.
- Config có `NaN/Infinity`, `a>=b` hoặc ngoài miền phải bị từ chối rõ ràng.
- Từng input lần lượt nhận `NaN/+Infinity/-Infinity` không được poison output khác.
- Đổi toàn bộ left↔right phải đổi output tương ứng và giữ nguyên aggregate đối xứng.

### 8.2 Integration

- Gỡ regression `aa = jawOpen`; packet có đủ năm vowel và `jawOpen/mouthClose` riêng.
- Duplicate face sample không chạy lại công thức/filter.
- Face loss release mọi mouth key về 0; đổi model/reset không giữ khẩu hình cũ.
- Renderer không áp raw morph chưa nằm trong verified profile.
- Toàn bộ test frontend và production build phải xanh trước webcam gate.

### 8.3 Webcam gate

Positive gate theo thứ tự: model 3, model 2, model 4, rồi `reference-avatar`. Negative capability gate cuối
cùng với model 1: không crash, không đoán raw morph, không biến dạng sai và degrade an toàn; model 1 không
bị yêu cầu đạt năm vowel vì file có `0/5` vowel bind thật.

Trên từng model positive:

1. Mặt neutral, môi thư giãn.
2. Há miệng nhưng không tròn môi.
3. Làm lần lượt hình miệng `i/e/u/o` không cần phát tiếng.
4. Khép môi rồi hạ nhẹ hàm để kiểm tra `jawOpen` và `mouthClose` độc lập.
5. Chu môi, funnel, kéo ngang.
6. Nâng môi trên, hạ môi dưới, kéo riêng khóe trái/phải.
7. Chuyển chậm và chuyển nhanh giữa các hình; F3 chỉ xét đúng target, độ “mượt/có hồn” chốt ở F4.

Panel DEV phải cho thấy `J/C/O/R/W`, năm vowel và channel corrective để phân biệt lỗi detector, công thức
và model mapping.

## 9. Tiêu chí DONE F3

- Không còn phép `aa = jawOpen` đơn giản.
- Năm vowel thay đổi đúng chiều theo bảng hình học và đạt webcam gate trên mọi model có preset bind thật.
- `jawOpen`/`mouthClose` độc lập trong semantic output; closure không để vowel xuyên qua.
- Corrective chỉ chạy theo capability/profile, không kéo emotion toàn mặt.
- Neutral, face loss, duplicate sample và model switch không gây mouth freeze/snap.
- Test toàn bộ frontend và build PASS; tài liệu codebase/roadmap được cập nhật cùng phiên.

## 10. Chốt review công thức

Bản review độc lập được chấp nhận với các quyết định cuối:

1. **Đồng ý sửa blocker:** amplitude dùng `A=max(J,R0,T0)×(1-C)` để closure chỉ tác động một lần và
   antagonism không làm collapse tổng activity.
2. **Đồng ý sửa blocker:** mọi input qua `safe01`; config invalid bị từ chối trước khi process.
3. **Chốt hành vi còn mở:** cho phép zero-jaw-opening `ih/ou` khi lips không sealed và stretch/round mạnh.
4. **Giữ nguyên:** `Low/Mid/High` overlap, hệ số antagonism khởi tạo `0.50`, pucker/funnel cross-talk
   `0.60+0.40×evidence` và proportional normalization.
5. **Không dùng hard top-2:** chỉ cân nhắc soft sharpening sau webcam evidence; temporal rank hysteresis
   thuộc F4 nếu sau này cần.
6. **Đồng ý mở rộng gate:** bốn positive model và một negative capability model; thêm đầy đủ boundary,
   nonfinite, invalid-config, coactivation và mirror tests.

Kế hoạch sau các chỉnh sửa trên là bản cuối để implement F3; thay đổi công thức tiếp theo phải dựa trên
diagnostic webcam định lượng, không tinh chỉnh lý thuyết trước khi có evidence.

## 11. Implementation evidence

Hoàn thành code ngày 2026-09-11:

- `mouthExpression.ts` chứa `safe01`, config validation, mapper realtime validate-once và toàn bộ công
  thức pure đã duyệt.
- `expressionMapper.ts` đã bỏ regression `aa = jawOpen`; `avatarMotionProcessor.ts` phát semantic F3,
  giữ snapshot diagnostic và dùng lifecycle F1 hiện có cho duplicate/loss/reset/model switch.
- `facialExpressionProfile.ts` map corrective VRoid có tên và allowlist key số cho đúng fingerprint hai
  VRM 0; model lạ không được suy đoán.
- `/dev/avatar-renderer` có panel F3 geometry/viseme/corrective để manual gate.
- 11 unit/invariant test F3 gồm nonfinite, invalid config, five-shape dominance, zero-aperture `ih/ou`,
  single closure suppression, contradictory evidence, asymmetry/mirror, continuity, monotonicity và lưới
  hơn 3.000 tổ hợp. Integration processor và profile tests cũng đã bổ sung.
- Toàn bộ frontend: **55 test files, 637 tests PASS**; `tsc -b && vite build` và lint PASS.

Chủ dự án đã xác nhận manual webcam gate PASS ngày 2026-09-11; F3 chính thức DONE.

Corrective 2026-09-14 sau manual fast-speech regression: `jawOpen` blendshape có thể giữ gần 0 dù khe môi thật
đang chuyển động, trong khi pucker mức vừa bị map quá mạnh. F3 nay lấy max giữa jaw blendshape và aperture hình
học từ inner lip 13/14 theo pháp tuyến hai khóe 61/291, chuẩn hóa bằng mouth width với video aspect thật.
Pucker/funnel curve được nén theo bảng trên; input cực đại vẫn đạt 1. Corrective không dùng audio, không thêm
landmark vào packet và giữ nguyên closure/mixer ownership. Toàn frontend sau corrective: **61 files / 690 tests
PASS**, production build và lint PASS; trạng thái DONE của F3 không thay thế manual F4 regression đang chờ.
