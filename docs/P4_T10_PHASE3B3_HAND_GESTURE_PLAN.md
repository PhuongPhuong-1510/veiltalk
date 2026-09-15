# P4-T10 — Phase 3B.3: Discrete Hand Gestures & Finger Pose (kế hoạch)

> Trạng thái: **DEFERRED theo quyết định chủ dự án ngày 2026-09-10 — giữ nguyên code/test hiện có,
> chưa tuyên bố manual acceptance hoặc hoàn thành. Trước khi defer: v5 đang thực hiện theo lộ trình từng dáng (xem §4.2). Bước 0 XONG; sửa
> directional swing ngón cái đang làm (xem §4.11).**
> Phạm vi: nhận dạng 5 cử chỉ bàn tay rời rạc (`open`, `fist`, `point`, `thumbsUp`, `thumbsDown`)
> và phát tư thế ngón lên avatar.
> Đánh số: **3B.3** vì đây là nhánh nối tiếp Hand pipeline của Phase 3B (tái dùng matching,
> palm basis, sample classification). 3B.3 chỉ thêm finger-rig calibration tối thiểu theo từng
> model để điều khiển gesture; không thay thế rig calibration tổng quát của Phase 3C.

## 0. Thay đổi so với kế hoạch v1

Review đã chặn 10 điểm. Bản v3 giữ các sửa đó và bổ sung các quyết định mới:

| # | Vấn đề v1 | Sửa ở v2 |
|---|---|---|
| 1 | Chord ratio là phép đo curl duy nhất | Kết hợp góc MCP/PIP/DIP + chord; chord chỉ là kiểm chứng hỗ trợ (§3.2) |
| 2 | `thumbsUp` thực chất chỉ là "chỉ ngón cái duỗi" | Thêm điều kiện hướng ngón cái; không đủ điều kiện hướng → `thumbExtended` (§3.3) |
| 3 | Gate chỉ dựa `worldGeometryQuality` | Thêm `gestureObservability.ts` đa tiêu chí (§3.1) |
| 4 | `unknown` gộp làm một | Tách `unknown-low-quality` / `unknown-observed` / `hand-lost` (§3.4) |
| 5 | Giữ gesture cũ vô hạn | `unknown-observed` ổn định → release về relaxed (§3.4) |
| 6 | Preset gộp cả blend | Tách `fingerPosePresets` / `fingerPosePlanner` / `fingerPoseTemporal` (§3.5) |
| 7 | Preset quaternion dùng chung mọi VRM | Preset là **semantic flexion**; adapter đổi sang quaternion theo flex axis từng rig (§3.6) |
| 8 | Ngưỡng 0.3/0.7 chung mọi ngón | Ngưỡng theo từng ngón, chưa khóa trước manual calibration (§3.3) |
| 9 | Temporal chưa nói rõ bất biến FPS | Test 15/30/60 FPS, duplicate không đẩy nhanh promotion (§5) |
| 10 | Tên phase đè lên Face Expression 3C | Đổi thành 3B.3 |

### Các quyết định hiện hành

| Chủ đề | Quyết định |
|---|---|
| Arm partial-occlusion | Giữ invariant hiện hành: upper/lower xử lý độc lập theo segment; SAD §4.1.2 cũ đã được sửa cho khớp acceptance report. |
| `thumbsUp` / `thumbsDown` | Nhãn hướng vẫn đo theo camera/image-up đã aspect-corrected. Khi render, preset chỉ nêu `direction: "up"` / `"down"`; `fingerRig` mới suy directional swing tới torso-up/torso-down theo rest pose từng VRM (§4.11). |
| Semantic output | Tách observation (`unknown-*`, `hand-lost`) khỏi pose (`open`, `fist`, `point`, `thumbsUp`, `thumbsDown`, `relaxed`, `rest`). |
| Low-quality hold | `unknown-low-quality` giữ pose tối đa `lowQualityHoldMs=500`; sau đó về `relaxed`. `hand-lost` dùng `gestureHoldMs=500` để về `rest`; `unknown-observed` release sau khoảng 350ms. |
| Finger rig | `fingerRig` là capability optional, gồm chain liên tục, flex axis/sign và directional swing ngón cái suy theo rest pose + `torsoUp` của từng model. Không dùng một trục/góc dang cố định cho mọi VRM. |
| Smoothing | `fingerPoseTemporal` là owner duy nhất của blend ngón; renderer không slerp lần hai cho finger joints. |
| Source hysteresis | Không kéo source hysteresis vào 3B.3; chỉ giữ regression không đổi side, còn acceptance hysteresis thuộc task sở hữu. |

**Đính chính hai phát biểu quá mạnh ở v1:**

- ~~"Ngón bị che vẫn đoán được từ ngón còn thấy"~~ → Đây là **giả thuyết cần nghiệm thu webcam**,
  không phải bảo đảm. MediaPipe Hand Landmarker không trả confidence riêng từng landmark, nên
  landmark của ngón bị che có thể chỉ là suy đoán của model mà ta không có cách biết độ tin cậy.
- ~~"Không phụ thuộc xa/gần camera"~~ → Chord ratio chỉ bất biến với **uniform scale**. Nó không
  chống được foreshortening khi ngón chĩa về phía camera, landmark chiều sâu rung, hay ngón duỗi
  xiên làm chord bị rút ngắn.

## 1. Quyết định nền tảng (giữ nguyên từ v1)

**Không theo dõi từng ngón liên tục.** Nhận dạng cử chỉ **rời rạc** rồi phát tư thế dựng sẵn.

| | Theo dõi từng ngón | Nhận dạng cử chỉ (chọn cái này) |
|---|---|---|
| Đầu ra | 15 góc/tay mỗi frame | 1 nhãn ổn định |
| Landmark lệch 15% | Avatar rung 15% | Thường vẫn cùng nhãn |
| Độ khó | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ |

Nguyên tắc kế thừa từ Phase 3B: dữ liệu không đủ tin cậy thì **lượng tử hoá đầu ra rồi ổn định
theo thời gian**, đừng bám từng frame.

## 2. Đã có sẵn (không làm lại)

| Thứ | Ở đâu |
|---|---|
| 21 landmark/tay | `rawHands` trong `RawTrackingFrameV1` |
| Ghép tay↔bên cơ thể, continuity | `handPoseMatching.ts` |
| `handedness` | `HandSideMatchResult` |
| Palm basis + quality | `handPalmBasis.ts` |
| Phân loại sample duplicate | `HandSampleClassification` |
| API xương VRM | `vrm.humanoid.getNormalizedBoneNode()` |

## 3. Kiến trúc

```text
rawHands + matching result
  → [3.1] gestureObservability.ts : sample có đủ điều kiện đo không
  → [3.2] fingerFeatures.ts       : góc + chord → feature mỗi ngón
  → [3.3] gestureClassifier.ts    : feature → nhãn + confidence có cấu trúc
  → [3.4] gestureTemporal.ts      : state machine 4 trạng thái
  → [3.5] fingerPosePlanner.ts    : nhãn → semantic pose, lọc theo capability
  → [3.6] fingerPoseTemporal.ts   : blend theo thời gian → jointRotations
```

### 3.1. `gestureObservability.ts` — gate đa tiêu chí

Không dùng riêng `worldGeometryQuality` (nó chỉ phản ánh mức dựng được palm basis, **không**
đại diện cho ngón bị che / đầu ngón nhảy / bàn tay quá nhỏ).

```ts
interface GestureObservability {
  usable: boolean;
  overallQuality: number;
  palmBasisQuality: number;          // từ handPalmBasis (đã có)
  projectedHandSizeQuality: number;  // bàn tay có đủ lớn trong khung không
  projectedPalmVisibilityQuality: number; // edge-on/foreshortening trong ảnh
  boneLengthConsistency: number;     // chiều dài đốt có hợp lý không
  temporalStability: number;         // landmark có nhảy bất thường không
  sampleFreshness: number;           // sample mới hay stale
  rejectionReason: GestureRejectionReason | null;
}
```

Tối thiểu bản đầu: matched, sample mới/không stale, palm basis hợp lệ, bàn tay không quá nhỏ,
palm không edge-on quá mức, không có landmark jump bất thường. Temporal stability chỉ đo residual
sau rigid-palm alignment và bone-length ratio; không dùng chuyển động nhanh của cả bàn tay để loại
một gesture hợp lệ.

### 3.2. `fingerFeatures.ts` — feature mỗi ngón

Đổi tên từ `fingerCurl.ts`: ngón cái cần nhiều hơn một số curl.

**Bốn ngón thường** — kết hợp góc và chord, không dùng chord đơn lẻ:

```ts
interface FingerCurlFeatures {
  mcpFlexion: number;   // trọng số thấp — dễ lẫn với xoè/khép ngón
  pipFlexion: number;   // quan trọng nhất
  dipFlexion: number;   // quan trọng thứ hai
  chordCurl: number;    // kiểm chứng hỗ trợ
  combinedCurl: number;
  valid: boolean;
}
```

Góc đo trong **palm-local space** để bất biến với xoay bàn tay. Trọng số chưa khóa; hiệu chỉnh
sau khi có fixture webcam.

**Ngón cái** — feature riêng, không quy về một số curl:

```ts
interface ThumbFeatures {
  flexion: number;
  extension: number;
  opposition: number;              // ngang qua lòng bàn tay
  directionInPalmSpace: Vec3;      // shape/opposition; không mang nghĩa “lên” toàn cục
  directionInImage: Vec2;          // dùng cho camera-up của thumbsUp
  valid: boolean;
}
```

Các giá trị này **chỉ phục vụ classifier**, không retarget liên tục lên avatar.

### 3.3. `gestureClassifier.ts` — luật theo từng ngón

Rule-based, không ML, không thêm thư viện. Ngưỡng **riêng từng ngón**, đặt trong config,
**chưa khóa** trước manual calibration:

| Nhãn | Điều kiện |
|---|---|
| `open` | 4 ngón thường duỗi; ngón cái **không đóng mạnh** (không đòi duỗi hoàn hảo) |
| `fist` | 4 ngón thường co; ngón cái co **hoặc** nằm ngang |
| `point` | trỏ duỗi; giữa/áp út/út co; ngón cái **wildcard** |
| `thumbsUp` | 4 ngón co; ngón cái duỗi; hướng ngón cái trong image-space đi lên đủ ngưỡng |
| `thumbExtended` | nhãn quan sát/fallback khi ngón cái duỗi nhưng hướng camera-up không thoả; không có preset riêng |
| `unknown-observed` | geometry tốt, không khớp luật nào |
| `unknown-low-quality` | `observability.usable === false` |

Ngón cái chúc xuống hoặc chỉ ngang **không được** ra `thumbsUp` — đây là lỗi chính của v1.

**Confidence có cấu trúc**, không phải "biên nhỏ nhất":

```ts
interface GestureClassification {
  label: GestureLabel;
  classScore: number;          // mức thoả luật của lớp thắng
  separationMargin: number;    // score lớp thắng − lớp nhì
  observabilityQuality: number;
  confidence: number;          // kết hợp ba giá trị trên
}
```

### 3.4. `gestureTemporal.ts` — state machine 4 trạng thái

```text
STABLE_LABEL
  ├─ candidate mới ổn định ≥ gesturePromotionMs (~120ms) → STABLE_LABEL mới
  ├─ unknown-low-quality                                  → HOLD tối đa lowQualityHoldMs (~500ms) → RELAXED
  ├─ unknown-observed ổn định ≥ unknownReleaseMs (~350ms) → RELAXED
  └─ hand-lost ≥ gestureHoldMs (~500ms)                   → REST
```

Điểm mấu chốt: **`unknown-observed` PHẢI release nhãn cũ.** Bàn tay hiện rõ nhưng đang ở tư thế
không hỗ trợ (`peace`, `ok`, nghỉ) mà avatar giữ `fist` vô hạn là **stale semantic state**, không
phải chống rung. Chỉ `unknown-low-quality` mới được giữ nhãn cũ, và chỉ tạm thời. `RELAXED` phải
phát target relaxed; `REST` phải phát identity delta cho mọi finger bone đã từng được planner sở hữu,
không được chỉ bỏ key khỏi packet vì renderer sẽ giữ rotation cũ.

Ba timer độc lập. Tính theo **thời gian thực**, không theo số frame.

### 3.5. Tách preset / planner / temporal

| File | Trách nhiệm | Có state? |
|---|---|---|
| `fingerPosePresets.ts` | Chỉ chứa target pose bất biến (pure data) | Không |
| `fingerPosePlanner.ts` | Lọc theo capability, tạo joint rotation plan | Không |
| `fingerPoseTemporal.ts` | Blend từ pose hiện tại sang target theo thời gian | Có |

Bắt buộc: quaternion hemisphere continuity, slerp theo elapsed time (không theo số render frame),
quaternion luôn normalized, không ghi rotation cho bone thiếu trong capability chain, phát identity
khi clear pose, **không ghi đè `leftHand`/`rightHand` wrist rotation của Phase 3B**. Renderer phải
bỏ smoothing chung cho finger joints để tránh double-smoothing.

### 3.6. Preset là semantic flexion, không phải quaternion

**Không** hardcode `rotationX = -60°` dùng chung mọi VRM — trục gập ngón khác nhau giữa các model.

```text
preset (semantic):        indexProximal = 0.8 flex
                          indexIntermediate = 0.9 flex
                          indexDistal = 0.6 flex

rig adapter (per-model):  semantic flex → quaternion quanh flexAxis
                          lấy từ fingerRig calibration của chính model
```

`normalizedRigProfile.ts` mở rộng bằng field `fingerRig` optional. Mỗi finger joint phải có flex
axis/sign đã calibration. Với ngón cái, rig còn có `directionalSwingLocal` rest-relative từ tia
thumb ở rest tới torso-up/torso-down; preset chỉ chọn `direction: "up" | "down"`, không mang
quaternion hay góc dang dùng chung. Arm profile cũ vẫn hợp lệ khi `fingerRig` thiếu; khi thiếu
calibration, planner fallback về rest và DEV báo capability.

### 3.7. Capability theo chuỗi, không theo từng bone rời

VRM 1.0 định nghĩa 15 xương ngón mỗi tay nhưng **tất cả đều tùy chọn**, và xương con chỉ hợp lệ
khi xương cha tồn tại. Kiểm tra theo **chuỗi liên tục từ gốc**:

```text
proximal có, intermediate thiếu, distal có
→ chỉ điều khiển tới proximal, KHÔNG ghi vào distal
```

Thiếu xương → không ghi phần chưa bao giờ sở hữu, nhưng nếu bone từng được điều khiển thì phải
phát identity để clear. Panel DEV báo rõ capability. **Không crash, không chặn người dùng.**

## 4. Thứ tự thực hiện

| Việc | Nội dung | Đụng avatar? |
|---|---|---|
| **0** | **Thu fixture webcam thật** (xem §4.1) | Không |
| 1 | `gestureObservability.ts` + test | Không |
| 2 | `fingerFeatures.ts` + test | Không |
| 3 | `gestureClassifier.ts` + test | Không |
| 4 | `gestureTemporal.ts` + test state machine | Không |
| 5 | Rig: joint names, load xương ngón, capability chuỗi, flex axis | Có |
| 6 | Presets + planner + temporal blend + nối processor | Có |
| 7 | Panel DEV + nghiệm thu webcam | Có |

### 4.1. Việc 0 — fixture webcam (bắt buộc, làm trước)

Bài học trực tiếp từ Phase 3B: **390/390 automated PASS nhưng webcam vẫn lộ 2 lỗi**. Nếu chỉ test
bằng bàn tay tổng hợp "đẹp", mọi thứ sẽ PASS mà thực tế hỏng.

Lưu landmark thật (JSON, local-only, không ảnh) cho các tình huống:

```text
trái/phải × open/fist/point/thumbsUp/other
lòng bàn tay hướng camera / mu bàn tay
bàn tay nghiêng cạnh
gần camera / xa camera
một phần ngón bị che
ngón cái hướng lên / ngang / xuống
```

Mỗi sample mang split `calibration` hoặc `holdout`; không dùng holdout để chọn threshold. Không
cần dataset lớn — mục đích là có ca thật để classifier không tự lừa mình.

### 4.2. Lộ trình v4 — làm từng dáng, test webcam sau mỗi dáng

**Quyết định của chủ dự án (2026-08-01):** không thu fixture trước khi code. Việc 0 đổi vai từ
*cổng chặn bắt buộc* thành *công cụ chẩn đoán tuỳ chọn* — chỉ dùng khi chỉnh ngưỡng theo mô tả
qua 3–4 vòng vẫn không ổn. `gestureFixture.ts` giữ nguyên, không xoá.

Thay cho thứ tự theo module ở §4, làm **từng dáng đi hết đường tới avatar**, mỗi dáng có một
lượt nghiệm thu webcam trước khi sang dáng kế:

| Bước | Nội dung | Trạng thái |
|---|---|---|
| 0 | Hạ tầng: kiểu 30 xương ngón, loader nạp ngón, capability chuỗi, flex axis theo model, renderer bỏ double-smooth, công tắc + panel DEV | ✅ **XONG** |
| 1 | Dáng `fist` — features 4 ngón thường → classifier `fist`/`not-fist` → temporal → preset/planner/blend → nối processor | ✅ **XONG — webcam PASS sau 2 vòng sửa (§4.5, §4.6)** |
| 2 | Dáng `open` — đối cực của `fist`, chỉnh ranh giới giữa hai đầu | ✅ **XONG — webcam PASS ngay vòng đầu** |
| 3 | Dáng `point` — ngưỡng riêng từng ngón; không được lẫn với `fist` | ✅ **XONG — webcam PASS sau 2 vòng chỉnh preset (§4.9)** |
| 4 | Dáng `thumbsUp` / `thumbsDown` — `ThumbFeatures`, điều kiện hướng image-space và directional swing per-rig | 🔄 đang làm; scalar abduction v2 đã bị thay thế (§4.11) |
| 5 | Hoàn thiện: `unknown-observed` release, FPS-invariance, model thiếu xương ngón | ⏳ |

Ngưỡng đặt bằng suy luận rồi chỉnh theo **mô tả của người test**, không theo phân bố fixture. Bù
lại: mỗi dáng được người test duyệt phải có test tự động chốt ngay, để chỉnh dáng sau không âm
thầm phá dáng trước.

Phạm vi v5 là **5 nhãn cốt lõi**: `open`, `fist`, `point`, `thumbsUp`, `thumbsDown`. Các dáng
khác trong dropdown fixture (`peace`, `ok`, `rock`, `heartFinger`, `callMe`) là ca
`unknown-observed` để kiểm tra avatar biết nhả cử chỉ; `thumbSide` vẫn là bẫy hướng, còn
`thumbDown` đã là nhãn đầu ra hợp lệ.

### 4.3. Bước 0 — những gì đã làm và hai lỗi đã bắt được

Đã làm: `AvatarFingerJointName` (30 xương) tách riêng khỏi `AvatarJointName`; loader nạp xương
ngón (optional, thiếu thì bỏ qua); `fingerRig.ts` dựng capability chuỗi + flex axis theo model;
renderer bỏ slerp riêng cho finger joint; `setGestureEnabled` mặc định **false** + checkbox DEV.

Hai lỗi thật bị bắt ngay trong bước hạ tầng, đều thuộc loại chỉ lộ ra trên model cụ thể:

1. **Ngón cái không có đốt `Intermediate`.** VRM 1.0 dùng `Metacarpal`/`Proximal`/`Distal` cho
   thumb. Sinh tên `leftThumbIntermediate` là bone không tồn tại trong bất kỳ VRM nào.
2. **Ngưỡng tuyệt đối trên tích có hướng phụ thuộc kích thước model.** Bàn tay VRM rộng vài
   centimet nên tích có hướng chưa chuẩn hoá chỉ cỡ `1e-4`, bị ngưỡng `1e-6` loại nhầm. Phải
   chuẩn hoá trước rồi mới so — sau chuẩn hoá đại lượng đo là `sin(góc)`, độc lập kích thước.
   Cùng lúc đó, pháp tuyến lòng bàn tay chỉ thử đúng cặp index↔little sẽ làm model thiếu một
   trong hai ngón đó mất trục gập của **cả bàn tay**; nay thử nhiều cặp từ xa tới gần.

### 4.4. Bước 1 — dáng `fist`: ngưỡng khởi tạo và quyết định thiết kế

Ngưỡng dưới đây đặt bằng **suy luận**, chưa qua webcam. Ghi lại để lần chỉnh sau biết đang đổi
từ đâu:

| Tham số | Giá trị | Lý do chọn |
|---|---|---|
| Trọng số curl | mcp .15 / pip .4 / dip .15 / chord .3 | PIP quyết định "nắm hay không" và ổn định hơn đầu ngón; MCP còn lẫn xoè/khép; DIP rung nhất |
| Ngưỡng co | trỏ/giữa .55 · áp út .5 · út .45 | Ngón út/áp út khi thả tự nhiên đã cong hơn ngón trỏ |
| Ngưỡng duỗi | trỏ/giữa .3 · áp út .32 · út .34 | Khoảng giữa hai ngưỡng là vùng trung gian, không kết luận |
| `promotionMs` | 120 | Lọc nhiễu 1–2 sample, vẫn dưới ngưỡng cảm nhận trễ (~150ms) |
| `unknownReleaseMs` | 350 | Ngắn hơn low-quality vì đây là quan sát TỐT nói tư thế đã đổi |
| `lowQualityHoldMs` | 500 | Che lúc tay lướt qua vùng khuất, không lâu tới mức thành sai |
| `blendMs` | 140 | Đủ nhanh để nắm tay dứt khoát, đủ chậm để không giật |

**Quyết định quan trọng — điểm lớp `fist` lấy `min` chứ không phải trung bình.** Trung bình cho
phép ba ngón cuộn chặt bù cho một ngón duỗi thẳng; đó chính là tư thế `point`, và nó sẽ ra điểm
`fist` cao. Lấy min buộc **mọi** ngón phải thoả, đúng định nghĩa nắm đấm. Có test chốt ca này.

**Preset `fist` cố ý gập ngón cái ít hơn nhiều (0.45 so với 0.9).** Ngón cái thật vắt ngang bên
ngoài các ngón kia chứ không cuộn vào lòng; gập hết biên độ sẽ làm ngón cái đâm xuyên các ngón
khác — lỗi hình ảnh dễ thấy nhất trên avatar.

**Một lỗi đã bắt được khi nối pipeline:** vòng dọn dẹp `ownedFingerJoints` chạy mỗi side nhưng
tập lại chứa joint của cả hai tay, nên xử lý tay trái xoá sạch joint tay phải và ngược lại — cuối
vòng lặp tập rỗng, và khi tắt tính năng sẽ không có joint nào được phát identity để nhả (ngón
đóng băng ở tư thế cuối). Đã lọc theo prefix side; có test chốt.

### 4.5. Nghiệm thu webcam #1 — lỗi "móng vuốt" và cách sửa gốc

**Hiện tượng:** nhãn `fist` đúng cả hai tay, nhưng ngón avatar **duỗi thẳng và bẻ ngược ra sau**
như móng vuốt thay vì cuộn vào lòng.

**Chẩn đoán:** lỗi nằm ở `fingerRig`, không phải classifier hay preset — dấu của trục gập không
xác định. Hai nguồn sai độc lập, cả hai đều là *suy đoán dấu*:

1. `cross(palmNormal, boneDirection)` cho trục vuông góc đúng, nhưng **chiều** phụ thuộc dấu của
   `palmNormal`, vốn suy từ thứ tự index→little rồi lật tay phải theo giả định chirality. Giả định
   đó không kiểm chứng được trên model thật.
2. Nhánh `cross(bone, child)` còn tệ hơn: dấu phụ thuộc hoàn toàn vào hướng cong **ngẫu nhiên**
   của rest pose. Model có ngón hơi ưỡn ra sau ở rest sẽ cho trục ngược hẳn.

**Sửa gốc — bỏ suy đoán dấu, neo vào dữ kiện giải phẫu quan sát được:**

- `resolvePalmDirectionWorld` xác định "hướng về phía lòng bàn tay" bằng **vị trí ngón cái**.
  Ngón cái luôn nằm phía lòng, với mọi model và cả hai tay — đây là dữ kiện đọc trực tiếp từ hình
  học model, không phải quy ước trục cần đoán. Lấy vector gốc-ngón-cái → gốc-ngón-giữa rồi trừ đi
  thành phần dọc ngón và thành phần ngang bàn tay; phần còn lại chính là hướng lòng.
- `resolveFlexAxisWorld` dựng trục vuông góc rồi **neo dấu bằng kiểm tra vật lý**: quay thử hướng
  ngón một góc nhỏ quanh trục, nếu đầu ngón tiến về phía lòng thì dấu đúng, ngược lại thì lật.
  Kiểm tra này đúng với mọi model bất kể quy ước trục.
- Nhánh dự phòng (model thiếu ngón cái) vẫn dùng chirality, nhưng đã thu hẹp phạm vi.

**Bài học về test tổng hợp:** bàn tay giả trong test ban đầu **phẳng lì** — mọi ngón kể cả ngón
cái nằm cùng mặt phẳng, và hai tay dựng giống hệt nhau. Hình học đó không tồn tại trên bàn tay
thật, nên nó PASS trong khi model thật hỏng. Đã sửa: ngón cái lệch về phía lòng, tay phải là ảnh
gương của tay trái. Test chirality cũ (so dấu trục giữa hai tay) được thay bằng test kiểm đúng
thứ cần kiểm: **quay quanh trục gập phải đưa đầu ngón về phía lòng bàn tay**, kiểm cho cả hai tay
và cả bốn ngón.

### 4.6. Nghiệm thu webcam #2 — ngón cái thẳng đơ

**Hiện tượng:** bốn ngón đã cuộn vào lòng đúng hướng (sửa ở §4.5 có tác dụng), nhưng ngón cái
đứng thẳng không gập được.

**Chẩn đoán — lỗi tự gây ra bởi chính cách neo ở §4.5.** `palmDirection` được định nghĩa **bằng
chính vị trí ngón cái**. Với bốn ngón thường, hướng ngón và `palmDirection` lệch nhau rõ nên tích
có hướng cho trục tốt. Nhưng với **ngón cái**, hai vector gần như song song → tích có hướng suy
biến → trục bằng 0 → không quay được. Cách neo đúng cho bốn ngón lại tự phá ngón cái.

**Sửa:** `resolveFlexTargetWorld` cho ngón cái một **hướng đích riêng**. Về giải phẫu ngón cái
không cuộn vào lòng mà vắt **ngang qua lòng bàn tay** về phía ngón út (opposition). Hướng đích
mới = (gốc ngón trỏ → gốc ngón út) pha thêm 0.5 phần `palmDirection`, cho tư thế nắm tự nhiên
thay vì quét thuần ngang. Bốn ngón thường giữ nguyên `palmDirection`.

Kèm theo, biên độ và preset ngón cái được nâng vì trước đó bị kẹp nhỏ do lo đâm xuyên: biên độ
0.6/0.7/0.7 → 0.9/1.0/0.9 rad, preset `fist` 0.45/0.5/0.35 → 0.7/0.75/0.6. Hướng gập đã đúng nên
gập mạnh hơn không còn làm ngón cái xuyên qua các ngón kia.

Hai test mới chốt: ngón cái phải có trục gập chuẩn hoá khác 0 (cả hai tay), và trục gập ngón cái
phải **khác mặt phẳng** bốn ngón còn lại (`|dot| < 0.95`).

### 4.7. Bước 1 PASS — một câu hỏi đã làm rõ

Nghiệm thu lần 3: `fist` đạt. Người test hỏi về việc **duỗi tay ra thì ngón avatar hơi cong chứ
không thẳng** — xác nhận đây **không phải bug** mà là preset `relaxed` hoạt động đúng thiết kế:
bàn tay người ở trạng thái nghỉ luôn hơi cong, duỗi phẳng lì trông như tay ma-nơ-canh. Người test
đồng ý giữ nguyên.

Lưu ý khi nghiệm thu các bước sau: `open` hiện **chưa có preset riêng**, đang tạm lùi về
`relaxed`. Xoè tay lúc này không ra tư thế xoè thật — đó là việc của Bước 2.

### 4.8. Bước 2 — dáng `open`

Thêm lớp `open` vào classifier và preset `OPEN_PRESET`. Ba quyết định:

**1. `scoreOpen` cũng lấy `min`, không lấy trung bình.** Cùng lý do như `fist`: ba ngón duỗi không
được bù cho một ngón đang co. Nếu lấy trung bình, tư thế `point` (một ngón trỏ duỗi, ba ngón co)
sẽ có điểm `open` không nhỏ và sẽ tranh chấp với chính `point` ở Bước 3.

**2. `open` KHÔNG xét ngón cái** (§3.3: "`open` không đòi ngón cái hoàn hảo"). Khi xoè tay, ngón
cái có thể duỗi thẳng, hơi khép hoặc chĩa ngang tuỳ người và tuỳ góc nhìn; bắt nó phải duỗi chuẩn
làm `open` khó đạt một cách vô lý.

**3. `separationMargin` giờ mới có tác dụng thật và được đưa vào `confidence`.** Từ Bước 2 có hai
lớp cạnh tranh, nên một bàn tay nửa co nửa duỗi có thể đạt điểm `open` và `fist` xấp xỉ nhau.
Công thức mới nhân thêm hệ số `0.5 + 0.5·min(1, 2·margin)`: margin nhỏ làm confidence tụt xuống
dưới ngưỡng promotion, buộc temporal chờ thay vì chọn bừa lớp nhỉnh hơn vài phần trăm rồi nhấp
nháy qua lại giữa nắm và xoè. Sàn 0.5 để margin nhỏ chỉ *làm chậm* promotion chứ không triệt tiêu
hẳn nhãn.

`OPEN_PRESET` duỗi thẳng rõ rệt hơn `RELAXED_PRESET` (0.04–0.07 so với 0.12–0.26): xoè tay là cử
chỉ **có chủ ý**, phải nhìn thấy khác với bàn tay đang nghỉ. Không đặt về 0 tuyệt đối — số 0 dành
riêng cho `rest` (trả model về nguyên trạng). Có test chốt: góc giữa quaternion `fist` và `open`
của cùng một đốt phải trên 30° để người dùng thấy được khác biệt.

### 4.9. Bước 3 — dáng `point`

`scorePoint` = `min(độ duỗi của trỏ, độ co của giữa/áp út/út)`. Ngón cái là **wildcard** (§3.3):
khi chỉ tay, ngón cái có thể áp sát các ngón đang co, chĩa lên, hoặc duỗi ngang — cả ba đều là
"chỉ tay" với người xem.

**Vì sao vẫn phải lấy `min` chứ không chỉ xét ngón trỏ:** nếu chỉ hỏi "ngón trỏ có duỗi không"
thì `peace` (trỏ + giữa cùng duỗi) sẽ ra `point`. Điều kiện ngón giữa phải CO là thứ phân biệt
hai tư thế đó. `peace` nằm ngoài phạm vi năm nhãn nên phải rơi vào `unknown-observed` — có test
chốt riêng.

Ba ranh giới được test chốt: `point` không thành `fist` (ba ngón cuộn chặt không được kéo cả tư
thế thành nắm đấm — chính là ca đã thúc đẩy quyết định lấy `min` từ Bước 1), `point` không thành
`open`, và ngược lại `fist`/`open` không thành `point`.

`POINT_PRESET` ghép ngón trỏ của `open` với giữa/áp út/út của `fist`. Vì classifier để ngón cái
là wildcard nên preset phải chọn tư thế trông tự nhiên với mọi cách người dùng đặt ngón cái.

Test end-to-end kiểm trên **rotation thật** chứ không chỉ nhãn: ngón trỏ giữa `point` và `fist`
phải lệch trên 30°, còn ngón giữa của hai tư thế đó phải trùng nhau dưới 10°.

#### Nghiệm thu webcam #3 — chỉnh ngón cái toàn bảng preset

Phản hồi: `fist` gập ngón cái đã đúng, nhưng `point` **chưa gập đủ sâu**; kèm yêu cầu rà lại ngón
cái ở mọi tư thế.

Hai chỗ sửa:

- **`point`: 0.5 → 0.65.** Khi chỉ tay, ngón cái người thật *tựa lên ngón giữa đang co* — tức đã
  gập khá sâu, chỉ dừng sớm hơn nắm đấm một chút vì nó dừng ở ngón giữa thay vì vắt qua cả bốn
  ngón. Giá trị 0.5 trông lửng lơ, không giống tư thế chỉ tay thật.
- **`relaxed`: 0.12 → 0.28.** Phát hiện khi rà cả bảng: 0.12 gần như bằng `open` (0.05), làm tay
  nghỉ và tay xoè trông giống nhau ở ngón cái. Ở tư thế nghỉ, ngón cái người thật nghiêng vào
  phía lòng bàn tay rõ hơn bốn ngón kia.

Thứ bậc ngón cái sau khi sửa: `fist` 0.7 > `point` 0.65 > `relaxed` 0.28 > `open` 0.05.

Thêm `fingerPosePresets.test.ts` chốt **quan hệ** giữa các preset thay vì con số cụ thể — để lần
chỉnh sau không âm thầm phá thứ bậc: fist sâu nhất, point sâu và cách fist dưới 0.2, open duỗi
nhất, relaxed cách open trên 0.1, và trong `relaxed` thì ngón cái phải khép hơn bốn ngón kia.

#### Nghiệm thu webcam #4 — ngón duỗi vẫn cong

Phản hồi: ngón trỏ khi `point` và bốn ngón khi `open` **vẫn không thẳng**.

**Nguyên nhân là một sai lầm về đơn vị, không phải về giải phẫu.** Bản đầu đặt 0.04–0.07 với lý
lẽ "ngón người xoè hết vẫn còn cong rất nhẹ". Lý lẽ đúng, con số sai: biên độ mỗi đốt là 1.55–1.75
rad, nên 0.05 thành ~5° mỗi đốt và **ba đốt cộng lại ~15°** — thừa đủ để mắt thấy cong.

**Sửa: `open` (bốn ngón thường) và `point` (ngón trỏ) về 0 tuyệt đối.** Điểm mấu chốt khiến việc
này an toàn: flexion là **rest-relative delta**, nên 0 nghĩa là *giữ nguyên rest pose của model*
chứ không phải bẻ ngón thành đường thẳng hình học. Model VRM đã dựng bàn tay xoè ở rest với độ
cong tự nhiên sẵn có — độ cong đó đến từ model, preset không cần (và không nên) thêm vào nữa.

Ngón cái của `open` giữ 0.05 vì ở rest pose VRM nó thường đã hơi tách ra.

Bất biến test được sửa theo: bỏ "`open` luôn > 0" (dựa trên lý lẽ đã bác bỏ), thay bằng hai điều
kiện đúng — `open` bốn ngón thường = 0, và `point` ngón trỏ = 0.

Lưu ý `open` toàn 0 vẫn KHÁC `rest`: `rest` đi đường plan rỗng (nhả quyền sở hữu joint), còn
`open` vẫn ghi rotation identity và giữ quyền sở hữu.

### 4.10. Bước 4 — dáng `thumbsUp`

Khác ba dáng trước: cần **hướng**, không chỉ độ co. `thumbsUp`, `thumbSide` và `thumbDown` có
hình dạng bàn tay **giống hệt nhau** (bốn ngón co + ngón cái duỗi), chỉ khác hướng ngón cái.

**`ThumbFeatures` đo hướng trong KHÔNG GIAN ẢNH, không phải palm-local.** "Lên" của `thumbsUp` là
lên theo *người xem*. Nếu đo trong palm-local, xoay cổ tay 180° sẽ biến thumbsUp thành thumbsDown
mà giá trị đo không đổi. Trục y được **đảo dấu** so với toạ độ ảnh gốc (ảnh có y tăng xuống), nên
`upwardness > 0` đọc trực tiếp là "chĩa lên" mà không phải nhớ quy ước ngược. Hướng cũng được
**sửa aspect ratio**: toạ độ MediaPipe chuẩn hoá theo từng chiều riêng, nên ở khung 16:9 một vector
chéo 45° thật sẽ đo ra góc sai nếu không nhân lại tỉ lệ — có test chốt riêng.

**Luật:** bốn ngón co (dùng lại điểm `fist`) ∧ ngón cái duỗi ∧ `upwardness ≥ 0.35` (≈20° trên
phương ngang). Ngưỡng đặt dương hẳn chứ không phải 0 để `thumbSide` bị loại dứt khoát.

**Không đo được hướng → trả 0, lùi về `fist`.** Thà bỏ sót còn hơn khẳng định sai: `thumbsUp` mang
nghĩa tán thành, nhận nhầm khi người dùng đang chúc ngón cái xuống là lỗi có hậu quả xã hội chứ
không chỉ là lỗi hiển thị.

**Một bẫy về thứ tự ứng viên đã phải xử lý riêng.** `thumbsUp` là *đặc biệt hoá* của `fist` (bốn
ngón co **cộng thêm** điều kiện ngón cái), nên vì lấy `min` điểm nó **không bao giờ vượt** `fist`.
Sắp xếp thuần theo điểm sẽ khiến `fist` luôn thắng và `thumbsUp` không bao giờ xuất hiện — lỗi im
lặng, không có triệu chứng nào ngoài việc nhãn không bao giờ hiện. Cách xử lý: khi `thumbsUp` đã
đạt ngưỡng 0.5 thì loại `fist` khỏi danh sách ứng viên. Có test chốt.

Ở bản đầu, `THUMBS_UP_PRESET` = bốn ngón của `fist` + ngón cái duỗi thẳng tuyệt đối (0), cùng lý
do như ngón trỏ của `point`. Cách đó chỉ đúng cho **flexion**; phần hướng dựng ngón cái đã được
thiết kế lại thành directional swing per-rig ở §4.11.

#### Nghiệm thu webcam #5 — avatar kẹt ở `thumbsUp` khi đã chúc xuống

**Hiện tượng:** giơ ngón cái lên, sang ngang, chúc xuống — avatar giơ ngón cái ở **cả ba**.

**Điều tra loại trừ:** dựng probe chạy trực tiếp `computeThumbFeatures` + `classifyGesture` trên
ba hướng. Kết quả `UP → thumbsUp`, `SIDE → fist`, `DOWN → fist` — **luật và phép đo hướng đều
đúng**. Nghĩa là lỗi không nằm ở nhận dạng mà ở chỗ **nhãn cũ không được nhả**.

**Nguyên nhân:** classifier chỉ đổi nhãn khi có lớp khác *thắng thay*. Khi xoay ngón cái xuống,
`thumbsUp` tụt về 0 — nhưng `fist` cũng **không đạt ngưỡng**, vì nắm tay lúc chỉ-để-giơ-ngón-cái
bao giờ cũng **lỏng hơn** nắm đấm thật. Không lớp nào thắng ⇒ temporal giữ nguyên nhãn cũ ⇒ avatar
vẫn giơ ngón cái. Đây đúng là lỗi nghiêm trọng nhất mà plan cảnh báo, chỉ khác đường đi.

**Sửa:** thêm điều kiện chủ động nhả — ngón cái **đang duỗi** nhưng **không chĩa lên** thì trả
`unknown-observed`, buộc temporal nhả nhãn cũ, thay vì chờ lớp khác thắng. Loại trừ `open` và
`point` khỏi quy tắc này: ở hai tư thế đó ngón cái duỗi là bình thường và hướng của nó không mang
ý nghĩa gì.

#### Nghiệm thu webcam #6 — `thumbsUp` chập chờn

**Hiện tượng:** giơ like hai tay thì "lúc được, lúc bị cụp xuống"; xoay ngang cũng không ổn định.

**Hai lỗi độc lập, cùng lộ ra qua một triệu chứng.**

**Lỗi 1 — hệ số aspect đặt sai vế.** Toạ độ MediaPipe chuẩn hoá `x` theo chiều rộng và `y` theo
chiều cao, nên cùng một số đơn vị chuẩn hoá ứng với số pixel khác nhau ở hai trục. Bản đầu nhân
`dy` với `videoHeight/videoWidth`, tức **nén** thành phần dọc 0.5625 lần thay vì quy hai trục về
cùng đơn vị pixel. Hậu quả đo được: ngón cái nghiêng **30° thật chỉ ra `upwardness` 0.309** thay
vì 0.5. Sửa: nhân `dx` với `videoWidth/videoHeight`, để `dy` nguyên.

**Lỗi 2 — ngưỡng quá cao và không có hysteresis.** Probe cho thấy ngưỡng cũ cần ngón cái nghiêng
**trên 40°** mới đạt điểm 0.5, trong khi giơ like tự nhiên chỉ 30–45° và **dao động liên tục**
quanh mốc đó. Mỗi lần vượt qua là một lần bật/tắt nhãn. Sửa:

- Hạ `thumbUpMinUpwardness` 0.35 → 0.20 (≈11.5°) và `thumbUpFullUpwardness` 0.75 → 0.50.
- Thêm `thumbUpReleaseUpwardness` = 0.04: **đang** ở `thumbsUp` thì ngưỡng tụt xuống mức này mới
  nhả. Đặt sát 0 để `thumbSide` (ngang dứt khoát) vẫn nhả được — chỉ dao động vài độ mới bỏ qua.

Hysteresis phải áp **nhất quán ở ba chỗ**, thiếu một chỗ là vô hiệu hoá cả cơ chế: (1) khoảng nội
suy trong `scoreThumbsUp` — dịch **cả hai đầu**, vì chỉ hạ đầu dưới sẽ làm khoảng giãn rộng và
điểm lại tụt dưới 0.5; (2) cờ `thumbExtendedButNotUp`; (3) ngưỡng loại `fist` khỏi danh sách ứng
viên, cùng với ngoại lệ cho `winner.score < 0.5` khi đang giữ `thumbsUp`.

**Lưu ý phạm vi:** ảnh nghiệm thu còn cho thấy cẳng tay/cổ tay bất ổn khi thả tay xuống. Đó là
Phase 3B (arm/twist), **không** thuộc 3B.3 — không sửa trong task này.

#### Nghiệm thu webcam #7 — ngón cái `thumbsUp` nằm ngang: giới hạn kiến trúc

**Hiện tượng:** giơ like đứng thì avatar để ngón cái ngang; chúc xuống thì avatar không xuống; để
ngang thì avatar chìa ngược. Nói cách khác, **hướng ngón cái avatar không bám theo tay người dùng
ở bất kỳ tư thế nào.**

**Đây không phải lỗi ngưỡng mà là hệ quả của thiết kế §1.** Kiến trúc chọn *nhận dạng cử chỉ rời
rạc rồi phát tư thế dựng sẵn*, nên avatar luôn phát một tư thế **cố định** cho mỗi nhãn. Thêm vào
đó, `FingerFlexionTarget` ban đầu chỉ có **độ gập**, không có khái niệm hướng. `THUMBS_UP_PRESET`
đặt thumb flexion 0 — mà flexion là rest-relative delta, nên 0 = *giữ nguyên rest pose*, và rest
pose T-pose của model có ngón cái **nằm ngang**. Kết quả: avatar "like" với ngón cái ngang.

**Quyết định của chủ dự án:** giữ kiến trúc cử chỉ rời rạc, sửa preset — chấp nhận hướng ngón cái
là **cố định** (không bám theo góc ngón cái thật). Phương án tracking liên tục cho riêng ngón cái
bị loại vì mở rộng phạm vi ngoài 3B.3.

**Thử nghiệm v2 — thêm scalar abduction (đã bị thay thế bởi directional swing ở §4.11):**

- `FingerSegmentRig.abductionAxisLocal`: vuông góc với **cả** hướng xương lẫn trục gập. Xoay quanh
  nó *nhấc ngón ra khỏi mặt phẳng gập*, đúng chuyển động cần để dựng ngón cái lên. Dấu được neo
  bằng kiểm tra vật lý như trục gập, nhưng hướng đích **ngược** với hướng lòng bàn tay (dang là
  nhấc RA XA lòng).
- `FingerFlexionTarget.abduction` (optional): chỉ ngón cái dùng, chỉ `thumbsUp` đặt > 0.
- Planner áp abduction **chỉ ở đốt gốc** — về giải phẫu, nhấc ngón khỏi mặt phẳng bàn tay là
  chuyển động của khớp gốc; áp cả ở đốt ngọn sẽ làm ngón cong vẹo sang bên thay vì dựng thẳng.
  Thứ tự nhân: dang trước, gập sau.

Bốn test của thử nghiệm v2 từng chốt: trục dang vuông góc trục gập; quay quanh nó đưa ngón RA XA
lòng (cả hai tay); chỉ `thumbsUp`/`thumbsDown` có `abduction ≠ 0`; và trên pipeline thật, đốt gốc
ngón cái phải lệch rõ khỏi identity còn đốt ngọn xoay ít hơn hẳn. Các test này không đủ: chúng chỉ
chứng minh quaternion khác identity/đảo chiều, không chứng minh tia ngón cái đã tới `torsoUp` hay
`torsoDown`.

#### Nghiệm thu webcam #8 — chỉnh dáng `thumbsUp` và THÊM nhãn thứ năm (thử nghiệm v2)

**Phần 1 — `thumbsUp` vống quá.** Người test xác nhận nhãn đúng và ngón đúng (ngón cái), nhưng
dang 66° làm ngón cái dựng thẳng đuỗn như cột. Ngón cái người thật khi like vẫn hơi ngả ra trước
và cong nhẹ ở khớp. Giảm dang xuống ~45° (`abduction` 1 → 0.7) và thêm gập nhẹ ở hai đốt ngoài
(`intermediate` 0.18, `distal` 0.22).

**Phần 2 — thêm nhãn `thumbsDown`.** Người test yêu cầu avatar chúc ngón cái xuống thật, thay vì
nhả cử chỉ. Đây là **mở rộng phạm vi có chủ đích** so với bốn nhãn đã chốt ở §4.2; thử nghiệm ban
đầu có chi phí thấp vì
hạ tầng abduction vừa dựng xong ở §4.7 dùng lại được nguyên vẹn.

Thay đổi:

- `scoreThumbsUp` tổng quát hoá thành `scoreThumbDirected(input, config, sign)` — `sign` nhân vào
  `upwardness` để hai nhãn dùng **chung một công thức**, gồm cả hysteresis. Tránh nhân bản logic,
  vốn là chỗ dễ để hai nhãn lệch hành vi theo thời gian.
- Cờ `thumbExtendedButNotUp` đổi thành `thumbExtendedButSideways` (`|upwardness| < ngưỡng`): từ
  khi có `thumbsDown`, **chỉ vùng ngang** mới là "không thuộc nhãn nào"; chúc xuống đã hợp lệ.
- Planner kẹp `abduction` về **[−1, 1]** thay vì [0, 1] — dang âm là chúc xuống, đối xứng qua
  cùng một trục.
- `THUMBS_DOWN_PRESET` đối xứng hoàn toàn với `THUMBS_UP_PRESET`, chỉ đảo dấu `abduction`.
- **`FINGER_POSE_PRESET_VERSION` 1 → 2**: bảng preset đã đổi, hai bên network không được dựng
  khác nhau từ cùng một nhãn (§6).

Test chốt: hai nhãn không lẫn nhau; ngang không ra nhãn nào; xoay lên↔xuống chuyển nhãn không kẹt;
hysteresis áp cho cả hai; preset đối xứng; và trên pipeline thật rotation đốt gốc của hai nhãn
phải **ngược chiều** nhau (tích vô hướng phần vector < 0).

**Một phát hiện phụ về test tổng hợp:** thang `curl` của bàn tay giả **không khớp** thang thật.
Đo thực tế cho thấy `curl 0.55` chỉ ra `combinedCurl ≈ 0.40` (dưới ngưỡng co 0.55, bị coi là
duỗi), còn nắm lỏng thật tương ứng `curl ≈ 0.7`. Test đầu tiên viết với 0.55 đã fail vì lý do
này, không phải vì code sai — nhắc lại bài học §4.5: hình học tổng hợp phải được kiểm chứng lại
với thang giá trị thật trước khi tin vào kết quả PASS.

### 4.11. Sửa v3 — directional swing ngón cái theo từng rig (**đang thực hiện**)

**Trạng thái:** thay thế cơ chế `abduction` scalar của thử nghiệm v2. Automated verification v3
đã PASS: `npm.cmd run test` = 45 files / 567 tests, `npm.cmd run lint` PASS, và `npm.cmd run build`
(TypeScript + Vite) PASS. Chưa có nghiệm thu webcam cho sửa v3 trong tài liệu này.

**Root cause.** `abductionAxisLocal` chỉ là **một trục** và preset v2 chỉ cung cấp **một góc**
(ví dụ `+0.7` / `-0.7`). Với một rest pose cụ thể, xoay quanh một trục chỉ quét một quỹ đạo một
bậc tự do của tia ngón cái. Trong khi đó `torsoUp` / `torsoDown` là mục tiêu hướng 3D xác định.
Trục, rest orientation và hướng ngón cái thay đổi giữa các VRM, nên không có một biên độ scalar
nào bảo đảm tia ngón đạt `+torsoUp` hoặc `-torsoUp` trên mọi model. Tăng góc chỉ đẩy ngón đi xa
hơn trên quỹ đạo sai — vì vậy các vòng 45°/66° có thể cho dáng cứng hoặc vẫn nằm ngang, chứ không
sửa được nguyên nhân.

**Thiết kế thay thế — semantic directional swing per-rig.** Preset không mang trục, góc hay
quaternion cứng. `FingerFlexionTarget.direction?: "up" | "down"`: `thumbsUp` đặt `"up"`,
`thumbsDown` đặt `"down"`. Khi tải từng VRM, `fingerRig` sẽ:

1. Lấy tia ngón cái ở rest (từ `ThumbMetacarpal` tới xương con) và `torsoUp` rest reference của
   chính rig: hướng chest→neck; chỉ với minimal rig thiếu dữ liệu này mới fallback `+Y`.
2. Tính shortest-arc swing từ tia rest đó tới `+torsoUp` hoặc `-torsoUp`.
3. Đổi hai swing về đúng delta **parent-local, rest-relative** của `ThumbMetacarpal` và lưu ở
   `directionalSwingLocal?: { up: QuaternionData; down: QuaternionData }`, để renderer vẫn áp
   contract không đổi: `absoluteLocal = restLocal × deltaLocal`.

Nếu chest→neck thiếu hoặc suy biến, rig tối giản dùng fallback scene `+Y` đã chuẩn hóa; nếu thiếu
xương, tia thumb suy biến hoặc quaternion không hữu hạn, capability directional swing mới không
hợp lệ và planner lùi an toàn về flexion/rest. Không được quay lại đoán bằng trục/góc scalar dùng
chung giữa các model.

Planner chỉ áp directional swing ở `ThumbMetacarpal`. Preset v3 giữ root flexion `0` và flexion
nhẹ đã được duyệt ở hai đốt ngoài (`0.18` tại `ThumbProximal`, `0.22` tại `ThumbDistal`) để dáng
không thẳng đơ; các đốt ngoài không nhận directional swing. Khi cùng có swing và flexion ở đốt
gốc, delta được ghép `directionalSwing × flexion`, rồi renderer ghép với rest rotation như trên.
`thumbsDown` là một target `-torsoUp` được solve độc lập theo rig, **không** là lấy `thumbsUp`
đảo dấu quanh trục abduction cũ.

**Version/network.** Bảng preset đổi từ version 2 lên **`FINGER_POSE_PRESET_VERSION = 3`**. Wire
state phải nhận đủ năm nhãn cốt lõi, gồm `thumbsDown`; receiver không hỗ trợ version 3 tiếp tục
fallback an toàn về `rest` theo §6.

**Regression bắt buộc cho v3 (đã xanh trong suite 45 files / 567 tests):**

- Rig có rest thumb nằm ngang và ít nhất hai rest orientation khác nhau: world ray sau swing phải
  tiến gần `+torsoUp` / `-torsoUp` tương ứng, không chỉ khác identity hay ngược dấu với nhau.
- Up/down phải có angular error nhỏ với hai target đối nghịch trên cùng rig; regression phải bắt
  trường hợp scalar rotation chỉ nâng ngón một phần nhưng không tới hướng torso.
- Chỉ `ThumbMetacarpal` nhận directional swing; `ThumbProximal`/`ThumbDistal` chỉ giữ flexion nhẹ.
- `restLocal × deltaLocal` vẫn tái tạo đúng local quaternion và không ghi đè wrist/arm; preset
  version 3 cùng năm nhãn được truyền tới planner/network boundary.

Automated regression đã xanh; còn phải chạy lại webcam với cả hai tay, hướng lên/ngang/xuống và
ít nhất hai VRM trước khi tuyên bố sửa v3 được nghiệm thu. Không suy diễn PASS từ việc classifier
vẫn nhận đúng nhãn.

## 5. Acceptance

### Automated — feature extraction
- Bất biến uniform scale; bất biến xoay trong palm-local space.
- Không NaN khi hai landmark trùng nhau.
- Ngón chĩa về camera **không** cho curl chắc chắn giả (foreshortening).
- Nhiễu nhỏ không làm curl nhảy qua hai vùng open/fist.
- Edge-on/foreshortening không tạo confidence cao giả.

### Automated — classifier
- Ngón cái hướng **xuống** → `thumbsDown`, không phải `thumbsUp`.
- Ngón cái hướng **ngang** → không phải `thumbsUp` hoặc `thumbsDown`.
- `point` cho phép ngón cái ở vùng trung gian.
- `open` không đòi ngón cái hoàn hảo.
- Tư thế không hỗ trợ + geometry tốt → `unknown-observed`.
- `separationMargin` phản ánh đúng khi hai lớp cạnh tranh.

### Automated — temporal
- **15/30/60 FPS cho kết quả promotion tương đương** (bất biến FPS).
- Duplicate sample **không** đẩy nhanh promotion.
- Render frame không có hand sample mới không tính như detection mới.
- `unknown-low-quality` chỉ hold tạm thời.
- `unknown-low-quality` quá 500ms phải về `relaxed`.
- `unknown-observed` ổn định **phải** release nhãn cũ.
- `hand-lost` và `unknown-observed` dùng timer riêng.

### Automated — rig
- Chỉ có proximal / có proximal+intermediate / đủ ba bone / hierarchy malformed.
- VRM 0.x và VRM 1.0.
- Hai model rest orientation khác nhau.
- Directional swing per-rig đưa tia `ThumbMetacarpal` gần `+torsoUp` cho `thumbsUp` và
  `-torsoUp` cho `thumbsDown`; không chỉ kiểm quaternion khác identity hoặc đảo dấu.
- Directional swing chỉ có ở `ThumbMetacarpal`; các đốt ngoài chỉ nhận flexion nhẹ. Contract
  `restLocal × deltaLocal` và wrist/arm không đổi.
- Không ghi đè wrist rotation; không regression upper/lower arm.
- `rest` clear mọi finger bone đã từng được sở hữu; renderer không giữ pose cũ sau khi key biến mất.
- Rig arm profile v1 không bị invalid khi `fingerRig` thiếu.

### Manual webcam (automated không thay thế)

| Thao tác | Kỳ vọng |
|---|---|
| Xoè bàn tay | `open` |
| Nắm đấm | `fist` |
| Chỉ tay | `point` |
| Ngón cái hướng lên | `thumbsUp`; avatar hướng ngón cái gần `torsoUp` |
| Ngón cái hướng **ngang** | Không `thumbsUp` hoặc `thumbsDown` |
| Ngón cái hướng **xuống** | `thumbsDown`; avatar hướng ngón cái gần `torsoDown` |
| Giữ `peace` rõ trong 1 giây | **Avatar không kẹt ở `fist`** → về relaxed |
| Mu bàn tay hướng camera | Ổn định hoặc `unknown` có kiểm soát |
| Chuyển nhanh giữa 2 cử chỉ | Không nhấp nháy, blend mượt |
| Bàn tay nghiêng cạnh | `unknown-low-quality`, giữ nhãn cũ tối đa 500ms rồi relaxed |
| Đưa tay gần rồi xa | Nhãn không đổi sai |
| Ngón chĩa thẳng vào camera | Không confidence cao giả |
| Hai tay bắt chéo ngực | Không đổi side trong phạm vi matcher hiện có; source hysteresis đầy đủ thuộc task riêng |
| Hạ tay khỏi khung | Giữ ~500ms rồi về nghỉ |
| Model đủ / thiếu / một phần xương ngón | Không crash, capability đúng |

## 6. Network contract (đã quyết định)

VRM có **15 xương ngón mỗi tay, tổng 30 xương cho cả hai tay** — tối đa 30 quaternion, không phải
60 (số liệu ở bản nháp trước sai).

Quyết định kiến trúc:

- `AvatarPosePacketV1` **nội bộ** vẫn được phép chứa rotation của 30 xương ngón để render local.
- Đến P4-T15, **không** mặc định truyền toàn bộ quaternion ngón ở 24 FPS.
- Network contract ưu tiên truyền **semantic state**:

```ts
interface GestureNetworkStateV1 {
  leftPose: "open" | "fist" | "point" | "thumbsUp" | "thumbsDown" | "relaxed" | "rest";
  rightPose: "open" | "fist" | "point" | "thumbsUp" | "thumbsDown" | "relaxed" | "rest";
  presetVersion: number;   // để hai bên không lệch bảng preset
  sequence: number;
  timestampMs: number;             // chỉ dùng theo clock của sender; ordering dùng sequence
}
```

- Bên nhận **tự dựng** finger preset, lọc theo capability của model remote đang render và blend cục bộ.
- Wire state là field semantic của `AvatarPosePacketV1` ở P4-T15, không tạo protocol WebSocket mới.
- `unknown-*`/`hand-lost` không truyền qua wire; dùng `relaxed`/`rest`. `presetVersion` không hỗ trợ
  phải fallback an toàn về `rest`, còn stale/out-of-order packet bị loại theo `sequence`.
- Chỉ xem xét truyền quaternion ngón nếu sau này có yêu cầu **continuous finger tracking**; không
  dùng cho năm gesture rời rạc hiện tại.

Hệ quả thiết kế: `fingerPosePresets.ts` và `fingerPosePlanner.ts` phải chạy được **độc lập với
nguồn nhãn** — nhãn có thể đến từ classifier local hoặc từ network. `presetVersion` bảo đảm hai
bên dựng cùng một tư thế từ cùng một nhãn.

## 7. Rủi ro đã biết

- **Ngón bị che**: chưa có cách biết độ tin cậy từng landmark; phụ thuộc nghiệm thu webcam.
- **Trọng số/ngưỡng chưa khóa**: cần fixture thật để hiệu chỉnh. Không được tự đặt ngưỡng rồi coi
  đó là quyết định đã được chứng minh — phải phân tích phân bố feature từ fixture, chọn ngưỡng ban
  đầu, rồi xác nhận lại bằng manual webcam gate.

## 8. Ngoài phạm vi

- `ok`, `peace` — dễ nhầm với `point` và với nhau; thêm sau khi 5 nhãn cốt lõi ổn định.
- Theo dõi góc từng ngón liên tục.
- Cử chỉ động (vẫy tay — cần chuỗi thời gian).
- Va chạm ngón–ngón, ngón–thân.
