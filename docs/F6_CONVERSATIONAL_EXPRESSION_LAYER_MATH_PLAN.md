# F6 — Kế hoạch toán cho Conversational Expression Layer

Trạng thái: **DRAFT — chờ chủ dự án/reviewer duyệt trước khi code**  
Ngày lập: 2026-09-14

## 1. Mục tiêu

F6 làm cho biểu cảm hội thoại có sự phối hợp giữa các vùng mặt nhưng vẫn trung thành với webcam:

1. Giữ được cười/cau mày lệch trái–phải thay vì ép mặt đối xứng.
2. Bổ sung coupling nhỏ và có giới hạn giữa khóe miệng, má, mũi, mắt và chân mày.
3. Không biến một tín hiệu đơn lẻ như há miệng khi nói thành `surprised`, hoặc mím môi thành nhắm mắt.
4. Có `faithful` mode giữ nguyên output F2/F3 và `lively` mode mới bật phần bổ sung.
5. Micro-motion phải deterministic, cùng timestamp cho cùng kết quả và không tự tạo cảm xúc khi mặt neutral.
6. Triệt residual của chính lớp F6 về exact zero khi người dùng trở lại neutral; không tạo drift tích lũy.
7. Chỉ dùng channel model đã có capability production-safe; không đoán raw morph theo tên hoặc thứ tự.

F6 không phải bộ nhận diện cảm xúc nội tâm. Các đại lượng `smile`, `frown`, `surprise-like` và
`anger-like` bên dưới chỉ là **intent hình học quan sát được**, dùng để phối hợp morph, không phải kết luận
người dùng thật sự vui, buồn, giận hay ngạc nhiên.

## 2. Ngoài phạm vi

- Không microphone, audio emotion, phoneme, VAD, jitter buffer hoặc coarticulation; F5 đang deferred.
- Không sửa công thức neutral calibration F1, blink/wink F2, miệng/vowel F3 hoặc dynamics/budget F4.
- Không thêm thư viện.
- Không đổi `AvatarPosePacketV1`, giao thức mạng hoặc privacy contract.
- Không tự bật preset full-face `happy/angry/sad/surprised` chỉ vì preset có tên/bind.
- Không tạo idle eye dart, gaze target, head nod, breathing hay body motion; các phần đó thuộc AR3–AR5.
- Không làm tongue/teeth hoặc corrective morph theo mesh.

## 3. Quyền sở hữu và vị trí trong pipeline

```text
F1 calibrated MediaPipe coefficients
  → F2 eye/brow semantic + F3 mouth semantic
  → F6 observed-intent + bounded secondary targets
  → F4 pre-mix → dynamics → post-mix
  → AvatarPosePacketV1.expressions
  → renderer áp đúng packet
```

Quy ước bắt buộc:

- F2 là nơi duy nhất quyết định blink/wink; F6 không được ghi `blink*` hoặc `eyeBlink*`.
- F3 là nơi duy nhất tạo `jawOpen`, `mouthClose`, năm vowel và hình học khẩu hình; F6 không sửa chúng.
- F4 là temporal owner duy nhất. F6 không thêm EMA/OneEuro/attack-release thứ hai.
- F4 vẫn là nơi resolve antagonist, saturation và lưu final state chống hidden energy.
- F6 chạy **trước** `FacialExpressionDynamics.processFresh()` và chỉ trên fresh face sample.
- Duplicate/reversed/loss/reacquire tiếp tục đi qua lifecycle hiện có của F4; F6 không có clock hold/fade riêng.

## 4. Chế độ vận hành

```ts
type ConversationalExpressionMode = "faithful" | "lively";
```

### 4.1 `faithful`

Đây là mặc định và là control group:

```text
F6_faithful(x) = copy(x)
```

Không thêm, bớt hay đổi bất kỳ semantic weight nào. Test phải kiểm tra deep equality của mọi scalar hữu hạn
sau bước sanitize đã có. Việc thêm F6 không được làm thay đổi trải nghiệm F4 hiện tại nếu người dùng không bật
`lively`.

### 4.2 `lively`

Giữ nguyên primary target quan sát được và chỉ thêm secondary target vào phần headroom còn lại:

```text
merge(primary, secondary) = primary + (1 - primary) × secondary
```

`secondary` luôn ở `[0, secondaryCap]`; vì vậy F6 không làm yếu tín hiệu thật, không vượt 1 và không tạo
antagonist âm. F4 phía sau vẫn có quyền giảm kết quả nếu conflict/budget yêu cầu.

DEV harness có dropdown `F6 expression mode: faithful | lively`. Chưa đổi mặc định production trước khi F7
nghiệm thu nhiều model.

## 5. Hàm chuẩn hóa dùng chung

```text
safe01(x) = Number.isFinite(x) ? min(1, max(0, x)) : 0

u          = safe01((x - onset) / max(full - onset, ε))
activate(x)= u²(3 - 2u)
```

Mọi threshold, gain, cap, period và epsilon nằm trong một config object được validate khi tạo processor:

- số phải hữu hạn;
- `0 <= onset < full <= 1`;
- `0 <= gain <= cap <= 1`;
- period dương;
- một channel không được vừa là primary bị cấm sửa, vừa là secondary output.

Không rải magic number trong processor hoặc UI.

## 6. Intent liên tục từ bằng chứng quan sát

Ký hiệu `A(x)` là `activate(x)` với threshold riêng theo loại bằng chứng. Mọi intent ở `[0,1]`.

### 6.1 Smile và frown bất đối xứng

```text
S_L = A_smile(mouthSmileLeft)
S_R = A_smile(mouthSmileRight)
F_L = A_frown(mouthFrownLeft)
F_R = A_frown(mouthFrownRight)

S_bilateral = sqrt(S_L × S_R)
F_bilateral = sqrt(F_L × F_R)
S_asymmetry = S_L - S_R
F_asymmetry = F_L - F_R
```

Geometric mean chỉ cao khi cả hai bên cùng có bằng chứng. Coupling theo bên dùng `S_L/S_R` hoặc `F_L/F_R`,
không dùng average toàn mặt; nhờ đó smirk thật được giữ nguyên.

### 6.2 Surprise-like phải có đồng thuận vùng

Há miệng khi nói không đủ để coi là ngạc nhiên:

```text
B_up = A_brow(max(browInnerUp, average(browOuterUpLeft, browOuterUpRight)))
E_wide = A_eye(average(eyeWideLeft, eyeWideRight))
J_open = A_jaw(jawOpen)

U = B_up × max(E_wide, J_open)
```

Vì có tích với `B_up`, `jawOpen` đơn độc trong lúc nói cho `U = 0`. `eyeWide` đơn độc do nhiễu cũng không đủ.

### 6.3 Anger-like theo từng bên

```text
A_L = A_down(browDownLeft)
      × max(A_squint(eyeSquintLeft), A_frown(mouthFrownLeft), A_sneer(noseSneerLeft))

A_R = A_down(browDownRight)
      × max(A_squint(eyeSquintRight), A_frown(mouthFrownRight), A_sneer(noseSneerRight))
```

Một lần mím môi hoặc squint giả không đủ tạo nét giận. Công thức theo bên giữ được nét lệch.

### 6.4 Sad/frown-like

```text
D = A_inner(browInnerUp) × F_bilateral
```

Frown đơn độc vẫn được F3/F4 truyền trung thực, nhưng chỉ khi inner brow và hai khóe cùng hỗ trợ thì F6 mới
tạo coupling vùng khác. Không dùng nhãn `sad` để mở/đóng mắt hoặc miệng.

## 7. Bảng coupling v1

F6 chỉ tạo **candidate secondary** sau đây trong `lively`:

| Intent | Secondary candidate | Công thức trước cap | Cap khởi tạo |
|---|---|---:|---:|
| `S_L` | `cheekSquintLeft` | `gainCheekSmile × S_L × eyeGuardLeft` | `0.18` |
| `S_R` | `cheekSquintRight` | `gainCheekSmile × S_R × eyeGuardRight` | `0.18` |
| `S_L/S_R` | `browOuterUpLeft/Right` | `gainBrowSmile × S_side` | `0.06` |
| `A_L/A_R` | `noseSneerLeft/Right` | `gainNoseAnger × A_side` | `0.12` |
| `U` | `browOuterUpLeft/Right` | `gainBrowSurprise × U` | `0.12` |
| `U` | `eyeWideLeft/Right` | `gainEyeSurprise × U × eyeGuardSide` | `0.10` |
| `D` | `browInnerUp` | `gainBrowFrown × D` | `0.10` |

```text
eyeGuardSide = (1 - blinkSide) × (1 - mouthClosureLeakGuard)
mouthClosureLeakGuard = A_close(mouthClose) × A_squint(eyeSquintSide)
```

Guard không chặn blink thật của F2; nó chỉ chặn phần **secondary eye/cheek do F6 tạo** khi closure m/b/p đồng
thời gây squint giả. F6 không sinh hoặc tăng `jawOpen`, `mouthClose`, vowel, pucker/funnel, smile/frown khóe.

Các cap trên là seed cần reviewer duyệt và manual tuning; không được coi là ngưỡng sản phẩm trước F7.

## 8. Capability policy — không fallback mù

F6 cần một support map chỉ gồm các semantic production-safe của model hiện tại:

```ts
interface ConversationalExpressionSupport {
  modelFingerprint: string | null;
  productionSafe: ReadonlySet<string>;
  verifiedFullFacePresets: ReadonlySet<"happy" | "angry" | "sad" | "surprised">;
}
```

Nguồn support:

1. VRM preset có bind thật; và
2. raw morph nằm trong `buildVerifiedFacialExpressionMap()` của đúng fingerprint/profile đã nghiệm thu.

`FacialCapabilityManifest` hiện chưa phản ánh raw mapping đã verify vì manifest được dựng trước
`expressionMap`. F6 sẽ sửa boundary loader để manifest đánh dấu đúng semantic đã verify; không đưa logic tên model
vào motion processor.

Quy tắc output:

- Secondary channel unsupported: bỏ candidate và ghi diagnostic `unsupported`.
- Không chuyển cheek/nose/brow thiếu capability sang `happy/angry/sad/surprised` toàn mặt.
- Standard full-face preset dù `bound` vẫn chưa đủ chứng minh an toàn vùng. V1 để
  `verifiedFullFacePresets` rỗng và **không tự phát bốn preset này**.
- Chỉ sau F7 manual audit xác nhận preset không kéo sai mắt/miệng mới thêm allowlist theo fingerprint.

Quyết định này tránh tái diễn lỗi đã đo ở model 2: một morph có tên/position tưởng là miệng nhưng thực tế dịch
chuyển cả vertex vùng mắt.

## 9. Micro-motion deterministic

Micro-motion v1 chỉ điều biến phần secondary đã có intent; không tạo nét mặt ở neutral và không đụng primary:

```text
m(name,t) = 0.65 sin(2πt/T1 + phase(name))
          + 0.35 sin(2πt/T2 + 1.7 phase(name))

secondary' = secondary × (1 + amplitude × m(name,t))
```

- `phase(name)` lấy từ stable string hash, không dùng `Math.random()`.
- `t = sampledAtMs / 1000`, không dùng render clock.
- `T1/T2` là hai period khác nhau và dương; output cuối vẫn clamp theo cap.
- `amplitude` khởi tạo tối đa `0.06` tương đối, nên với cap `0.18` độ lệch tuyệt đối không quá `0.0108`.
- Khi intent bằng 0 thì micro-motion bằng 0 chính xác.
- Cùng semantic + timestamp + input + config phải cho output bit-stable trong cùng JS runtime.

F4 xử lý attack/release sau đó; F6 không lưu oscillator state nên không thể tích lũy drift hoặc lệ thuộc FPS.

## 10. Neutral drift correction của F6

F1 tiếp tục là owner của neutral bias raw. F6 chỉ chống residual của **intent/coupling do chính nó tạo**:

```text
observedEnergy = max(
  S_L, S_R, F_L, F_R, B_up, E_wide,
  A_down(browDownLeft), A_down(browDownRight)
)

neutral = observedEnergy <= neutralEnter
active  = observedEnergy >= neutralExit
```

Với `neutralEnter < neutralExit`, vùng giữa giữ trạng thái gate gần nhất. Tuy nhiên gate chỉ cập nhật trên fresh
sample timestamp và không filter amplitude. Sau `neutralDwellMs` liên tục:

- mọi secondary candidate F6 bằng exact zero;
- diagnostic đánh dấu `neutralLocked=true`;
- oscillator vẫn là hàm timestamp thuần nhưng bị nhân zero;
- F4 release output cũ về neutral theo dynamics hiện có.

Face loss/reset/model swap xóa gate/dwell của F6. Short duplicate không tăng dwell. Không tự cập nhật baseline F1
trong lớp này và không sửa primary target.

## 11. Full-face emotion preset

V1 **không phát** `happy`, `angry`, `sad`, `surprised` tự động. F6 vẫn tính intent tương ứng để coupling và
telemetry, nhưng full-face preset thường chứa nhiều bind không tách vùng; phát cùng F2/F3 có thể:

- cười mỉm lại há miệng;
- m/b/p làm mắt nhắm;
- `happy` cộng với smile mouth thành quá mức;
- mỗi model cho kết quả khác nhau dù cùng weight.

Sau F7, một preset chỉ được bật nếu asset audit chứng minh vùng ảnh hưởng và manual matrix pass. Khi đó:

```text
emotionCandidate = intent × modelSpecificGain
```

và vẫn đi qua emotion budget của F4. Không có fallback chung cho model chưa audit.

## 12. State, lifecycle và đổi model

`ConversationalExpressionLayer` chỉ giữ:

- mode;
- model support/fingerprint;
- neutral hysteresis state và thời điểm bắt đầu dwell;
- snapshot diagnostic cuối.

Nó không giữ output amplitude. Lifecycle:

- fresh sample: tính intent/candidate;
- duplicate/reversed: processor không gọi F6, F4 giữ output;
- held/returning/idle: F4 giữ/return như hiện tại;
- reset/dispose/model fingerprint đổi: reset neutral dwell, support và diagnostic;
- đổi `lively → faithful`: reset state F6; sample fresh kế tiếp trả đúng F2/F3, F4 release phần secondary;
- đổi `faithful → lively`: không seed pose; chỉ sample fresh kế tiếp mới tạo candidate.

## 13. Telemetry DEV/local-only

Thêm panel `F6 conversational expression`:

- mode và fingerprint;
- neutral gate, observed energy, dwell;
- `S_L/S_R`, `F_L/F_R`, `U`, `A_L/A_R`, `D`;
- primary / secondary / merged cho từng channel F6 chạm tới;
- candidate bị bỏ vì `unsupported`, `neutral-lock`, `eye-guard` hoặc `faithful`;
- full-face preset policy luôn hiển thị `disabled` trong v1.

Telemetry chỉ giữ scalar của sample mới nhất, không chứa frame/landmark/audio, không log mỗi frame và không vào
packet. UI poll 400 ms như F1–F4.

## 14. Thiết kế code dự kiến

### File mới

- `frontend/src/lib/avatar-motion/conversationalExpressionLayer.ts`
- `frontend/src/lib/avatar-motion/conversationalExpressionLayer.test.ts`

### File sửa

- `motionConfig.ts`: thêm config F6 và validation.
- `avatarMotionProcessor.ts`: nối F2/F3 → F6 → F4; setter mode/support; reset lifecycle; getter snapshot.
- `facialCapability.ts` và `modelLoader.ts`: hợp nhất VRM binds với verified raw expression map thành support
  production-safe, không thay quy tắc candidate.
- `AvatarRendererDevHarness.tsx`: dropdown mode, truyền support khi load model, panel telemetry.
- test processor/loader/harness liên quan.
- `docs/06_CODEBASE_GUIDE.md`, `docs/11_AVATAR_EVOLUTION_ROADMAP.md` sau khi implementation và gate hoàn tất.

Không sửa packet schema và không thêm dependency.

## 15. Automated test gate

### 15.1 Pure math/invariant

1. Mọi input NaN/Infinity/out-of-range cho output hữu hạn trong `[0,1]`.
2. `faithful` giữ nguyên toàn bộ semantic target.
3. F6 không bao giờ ghi blink, jaw, closure, vowel hoặc mouth-shape primary.
4. `merge` monotonic, không làm yếu primary và không vượt 1.
5. Left/right mirror cho kết quả mirror; smirk một bên không bị copy sang bên kia.
6. Neutral exact zero, không có micro-motion khi intent zero.
7. Cùng timestamp/input/config cho kết quả deterministic.
8. Config invalid fail fast.

### 15.2 Semantic regression

1. `jawOpen=1` đơn độc không tạo surprise/coupling.
2. `mouthClose + eyeSquint` khi đọc m/b/p không tạo cheek/eye secondary và không đổi blink.
3. Smile kín không mở hàm, không tạo vowel và không phát `happy`.
4. Smile hở răng vẫn do F3/F4 quyết định độ mở; F6 chỉ thêm vùng hỗ trợ an toàn.
5. Frown/pout giữ mouth corner; coupling chỉ xuất hiện khi có đồng thuận brow.
6. Blink trong lúc cười vẫn do F2 đóng/mở; F6 eye secondary bị guard.
7. Brow up + eye wide tạo surprise-like; jaw speech không bắt buộc.
8. Brow down đơn độc không tạo anger-like; cần bằng chứng vùng thứ hai.
9. Unsupported target bị bỏ, không fallback full-face.

### 15.3 Temporal/integration

1. F6 không thay đổi số lần F4 cập nhật hoặc `dt`.
2. Duplicate/reversed không tăng neutral dwell.
3. 15/30/60 FPS cho intent/candidate tương ứng tại cùng wall-clock timestamp.
4. Face loss → return → idle không giữ secondary hidden energy.
5. Reacquire và model swap không mang neutral gate/support của model cũ.
6. Toggle faithful/lively không snap thẳng target ở renderer và không tạo double smoothing.
7. Local packet và packet được apply lại cho remote cho cùng expression scalar.
8. Toàn bộ test F0–F4 và arm/hand vẫn xanh.

## 16. Manual webcam gate

Chạy `faithful` làm baseline rồi `lively` trên tối thiểu model 2, model 3 và một model khác:

| Case | Thao tác | PASS |
|---|---|---|
| F6-M01 | Mặt neutral 20 giây | Không tự cười/cau mày; secondary về 0, không drift |
| F6-M02 | Cười mỉm nhẹ → vừa → mạnh | Mức tăng liên tục; không tự há miệng hoặc nhắm mắt |
| F6-M03 | Cười hở răng nhẹ → mạnh | Miệng vẫn theo F3/F4; má/mày hỗ trợ nhỏ, không thành mặt méo |
| F6-M04 | Cười lệch từng bên | Avatar giữ đúng bên, không bị đối xứng hóa |
| F6-M05 | Trề môi/dỗi, frown lệch và hai bên | Khóe đi xuống thấy được; không biến thành preset lạ |
| F6-M06 | Ngạc nhiên bằng mắt + mày, rồi thêm há miệng | Nét tăng tự nhiên; chỉ há miệng nói không kích hoạt |
| F6-M07 | Cau mày + squint/frown | Mày/mũi phối hợp nhẹ; một tín hiệu đơn lẻ không thành mặt giận |
| F6-M08 | Đọc nhanh “bập bẹ ba mẹ, mập mờ” | Mắt không nhắm do môi; F6 không làm chậm khẩu hình |
| F6-M09 | Blink/wink khi đang cười | Blink đúng F2, không giữ mí sau khi mở mắt |
| F6-M10 | Che/mất mặt rồi xuất hiện lại | Hold/return/reacquire như F4, không snap secondary |
| F6-M11 | Toggle faithful ↔ lively khi neutral và khi cười | Faithful khớp baseline; lively khác nhỏ nhưng nhìn thấy |
| F6-M12 | Đổi/reload ba model | Không mang state; unsupported không kéo nhầm morph |

Nếu lively không thấy khác trên một model vì model không có channel production-safe, đó là kết quả capability
đúng, không được phép vá bằng full-face preset. Model đó chỉ được cải thiện sau khi F0/F7 audit raw morph riêng.

## 17. Hiệu năng và acceptance

- Không thêm inference model, Worker hoặc dependency.
- Benchmark layer pure scalar riêng và whole-app LIVE; báo avg/p95, không đo khi Frozen.
- NFR giữ nguyên: tracking→render `<100 ms`, toàn app `>=24 FPS` trên máy tham chiếu.
- Ngân sách nội bộ đề xuất cho F6 scalar layer: `p95 <= 0.20 ms/sample`; reviewer phải duyệt trước code.
- Automated tests, production build và lint phải pass.
- F6 chỉ được đánh dấu DONE sau manual F6-M01–M12 trên ít nhất ba VRM.

## 18. Hai quyết định cần reviewer chốt

1. **APPROVE đề xuất:** `faithful` là default; `lively` chỉ bật explicit trong DEV cho tới F7.
2. **APPROVE đề xuất:** v1 không phát full-face preset. Chỉ coupling theo vùng production-safe; preset được xét
   lại theo fingerprint sau manual asset audit.

Nếu reviewer yêu cầu bật preset ngay, cần chỉ rõ model/fingerprint, preset, vùng vertex ảnh hưởng và gain đã
nghiệm thu. Không chấp nhận một gain chung cho mọi model.
