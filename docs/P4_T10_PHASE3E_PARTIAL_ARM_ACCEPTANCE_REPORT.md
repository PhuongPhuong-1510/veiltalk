# P4-T10 — Phase 3E Acceptance Report

> Phạm vi: partial arm tracking — ổn định cánh tay khi Pose chỉ quan sát được 2 trong 3 khớp
> (shoulder / elbow / wrist)
> Trạng thái: **IMPLEMENTED — MANUAL BROWSER GATE PASS (case A + case B)**

## Vấn đề

Tay avatar bị quằn hoặc bật về tư thế duỗi thẳng khi một phần cánh tay bị che hoặc ra ngoài
khung hình. Hai kịch bản người dùng báo:

1. Thấy vai + khuỷu, **mất bàn tay/cổ tay**.
2. Thấy vai + cổ tay, **mất khuỷu** (giơ tay chào, khuỷu bị khung hình cắt).

## Contract

`AvatarPosePacketV1` **không đổi**. `jointRotations` vẫn là normalized-humanoid parent-local,
rest-relative delta; renderer vẫn áp `restLocal × deltaLocal`. Diagnostics không nằm trong packet.
Không thêm thư viện mới.

## Case A — mất cổ tay không được giết cánh tay trên

### Root cause

`avatarMotionProcessor.ts` ép cả hai đoạn xương dùng chung một điều kiện hợp lệ:

```ts
const chainGeometryValid = Boolean(geometry?.segmentValidity.upper && geometry.segmentValidity.lower);
const currentUpperTarget = isNewSample && chainGeometryValid ? … : null;
```

Mất cổ tay → `segmentValidity.lower = false` → **upper cũng bị ép `null`** dù vai và khuỷu vẫn
quan sát rõ → cả tay hold rồi return về idle pose.

Ràng buộc này từng được thêm có chủ ý để chống lỗi "forearm quét ngang mặt". Nỗi lo đó chỉ đúng
nếu hold lưu **world rotation**. `updateSegmentTemporalOutput` lưu **parent-local rest-relative
delta**, nên lower bị hold vẫn xoay theo upper như một khối cứng và giữ nguyên góc gập.

### Implementation

- `chainGeometryValid` chỉ còn hỏi "chuỗi tay còn gốc hợp lệ không" (`segmentValidity.upper`);
  thêm `lowerGeometryValid` độc lập.
- Vòng lặp segment gate riêng từng đoạn: lower không có nghiệm thì `solvedDelta = null` đưa riêng
  nó vào hold, upper vẫn nhận target mới từ shoulder→elbow.
- Hand twist gate theo `lowerGeometryValid` thay vì chain — cẳng tay đóng băng thì twist freeze
  theo, không xoay một đoạn xương đã held.

## Case B — suy đoán khuỷu không được lật phía, không hết hạn oan

### Root cause (đo bằng test thăm dò, không suy đoán)

| Nghi vấn ban đầu | Kết luận sau khi đo |
|---|---|
| Inferred elbow ghi đè observed history | **Không phải lỗi** — code đã chỉ ghi `previousPole` khi `acceptedFreshPole` |
| Khuỷu lật phía khi pole yếu | **Lỗi thật** — `bendPlaneQuality ≈ 0.04`, prior `+Y` cho `elbow.y = +0.001`, prior `−Y` cho `−0.001` |
| Pole lịch sử dùng vô thời hạn | **Lỗi thật** — `inferElbow` đọc `previousPole` không kiểm tra tuổi, trong khi tầng chọn pole đã bỏ nó sau `poleFallbackTimeoutMs` |
| Timeout 1200 ms | **Lỗi thật** (phát hiện muộn, qua webcam) — khuỷu bị khung hình cắt không bao giờ quan sát lại được, đồng hồ chạy mãi, tay rơi xuống giữa lúc người dùng vẫn đang giơ |
| Cẳng tay xuyên thân | **Lỗi thật** (lộ ra sau khi gỡ timeout) — nghiệm đúng toán học nhưng prior trỏ vào trong thân |

### Implementation

- **Khóa phía gập.** `inferElbow` nhận `previousElbowDirection` làm mỏ neo; nghiệm rơi sang nửa
  mặt phẳng đối diện thì lật pole lại. Mỏ neo chỉ được ghi khi
  `bendPlaneQuality ≥ elbowInferenceMinimumBendQuality` — frame suy biến giữ mỏ neo cũ, vì đó
  chính là lúc cần nó nhất. Flag `elbow-side-flip-prevented`.
- **Ràng buộc giải phẫu, thắng mỏ neo lịch sử.** Khuỷu người thật luôn lệch ra phía ngoài thân
  (trái lệch trái, phải lệch phải). Dùng `torso.right` xác định phía ngoài theo từng bên; nghiệm
  lấn vào trong thân bị lật ra **bất kể prior và mỏ neo nói gì**. Ràng buộc này không phụ thuộc
  dữ liệu cũ nên đúng cả khi khuỷu chưa từng được quan sát ở tư thế hiện tại. Flag
  `elbow-anatomy-flip`.
- **Prior pole có hạn.** Quá `elbowInferencePoleMaxAgeMs` thì lùi về rest prior có kiểm soát,
  thay vì chạy trên pole cũ vô thời hạn.
- **Timeout theo bản chất, không theo đồng hồ.** Timeout tồn tại để chặn sai số *tích luỹ*. Khi
  vai + cổ tay quan sát tươi ngay frame này **và** chiều dài xương đã calibrate từ quan sát thật,
  nghiệm là hình học đầy đủ — không có gì tích luỹ, suy đoán chạy tiếp (flag
  `elbow-inference-sustained`), confidence không suy giảm theo thời gian. Chỉ có prior giải phẫu
  thì timeout giữ nguyên.

### Config mới (`motionConfig.ts`)

```text
elbowInferenceMinimumBendQuality: 0.15
elbowInferenceMinimumLateralBias:  0.05
elbowInferencePoleMaxAgeMs:        2000
elbowInferenceUnboundedWhenFullyObserved: true
```

## Sửa kèm — diagnostics báo sai

`elbowInference.source` đọc `geometry?.elbowSource`, mà `geometry` là `null` trên frame duplicate
(không phải sample mới). Ở ~14 FPS phần lớn frame là duplicate → panel báo `unavailable` dù cánh
tay đang chạy bình thường, che mất trạng thái thật khi chẩn đoán. Nay lùi về `state.elbowSource`.

DEV harness thêm panel **Phase 3E partial-arm**: loss state từng đoạn, nguồn khuỷu, nguồn pole,
các flag lật phía, lý do reject.

## Automated evidence

- Upper tiếp tục đổi theo khuỷu khi chỉ mất cổ tay; lower giữ nguyên local delta; che lâu thì chỉ
  lower `returning`, upper vẫn `active`.
- Lower local delta **bất biến** qua 3 frame liên tiếp trong lúc upper đổi hướng — khóa chống tái
  phát lỗi "forearm quét ngang mặt".
- Lower blend chứ không snap khi cổ tay quay lại.
- Prior pole đảo dấu cho cùng một nghiệm khuỷu (mỏ neo quyết định phía, không phải dấu prior).
- Prior **và** mỏ neo cùng trỏ vào trong thân vẫn cho nghiệm nằm ngoài thân; nghiệm đã đúng phía
  không bị ràng buộc giải phẫu đụng tới. Chiều dài xương khớp tuyệt đối sau khi lật.
- Suy đoán chạy tiếp quá timeout khi có calibration quan sát; **vẫn timeout** khi chỉ có prior
  giải phẫu.
- Mỏ neo không được ghi từ frame near-straight suy biến.

Full gate cuối:

```text
cd frontend && npx vitest run   → 36 files, 394/394 PASS
cd frontend && npm run lint     → PASS
cd frontend && npm run build    → PASS, 1,820 modules
```

## Manual browser gate

| Kịch bản | Kết quả |
|---|---|
| Che bàn tay, giữ vai + khuỷu rõ | **PASS** — upper bám người thật, cẳng tay giữ góc gập, không duỗi thẳng, không quét ngang |
| Giơ tay chào, khuỷu ngoài khung, giữ > 2 s | **PASS** — tay giữ tư thế giơ, không rơi xuống |
| Giơ tay chào — kiểm tra xuyên thân | **PASS** — cẳng tay nằm ngoài thân |

## Ngoài phạm vi (chưa làm)

- **Hand wrist substitution**: khi Pose mất cổ tay nhưng MediaPipe Hand vẫn thấy bàn tay, chưa
  dùng hand landmark làm nguồn wrist thay thế. Cần xác minh coordinate space giữa hai pipeline
  trước (Pose world vs Hand landmarks không cùng metric space).
- **Source hysteresis** ở tầng mode: che/mở nhanh liên tục có thể làm mode dao động.
- **Mất vai** (elbow + wrist rõ): giữ nguyên hành vi hold — không đủ ràng buộc để suy ra, và giữ
  tư thế là hành vi đúng.
- **Prediction**: không triển khai; hold đúng quan trọng hơn.
- **Hiệu năng**: pipeline đo được ~14 FPS trên máy test, dưới mục tiêu 24 FPS (NFR). Không gây ra
  các lỗi trên nhưng làm mọi mốc thời gian mong manh (`invalidGraceMs = 80 ms` ≈ 1 frame). Cần xử
  lý riêng.
