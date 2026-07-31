# P4-T10 Phase 3H — Camera Framing & Tracking Readiness

## 1. Trạng thái và mục tiêu

**Trạng thái:** PLANNED — chưa triển khai.

Phase 3H được thực hiện sau Phase 3E để đánh giá người dùng có ở vị trí phù hợp cho tracking và cung
cấp phản hồi ngay trên preview. Phase này chỉ phân loại điều kiện quan sát tương đối từ frame và
landmark; không đo hoặc tuyên bố khoảng cách vật lý theo mét/centimet khi camera chưa được calibration.

Mục tiêu:

- Tạo ba chỉ số local-only: `bodyVisiblePercent`, `frameOccupancyPercent`,
  `trackingQualityPercent`.
- Phân loại ổn định: `too-close`, `good`, `slightly-far`, `too-far`,
  `hands-out-of-frame`, `insufficient-light`.
- Hiển thị hướng dẫn ngắn, hành động được trên SCR-09 mà không chặn avatar.
- Giữ nguyên privacy boundary: ảnh, video, raw landmark và diagnostics không rời trình duyệt.

## 2. Phạm vi

Trong phạm vi:

- Dùng Pose/Hand/Face landmarks hiện có và thống kê độ sáng/độ tương phản tính tại client.
- Đánh giá các vùng cần thiết: mặt, vai, khuỷu tay, cổ tay và thân trên.
- Tính bounding box ổn định của người và tỷ lệ diện tích so với camera frame.
- Tổng hợp chất lượng tracking từ confidence, completeness, sát biên và ổn định thời gian.
- Smoothing, hysteresis, ưu tiên cảnh báo, lifecycle và loss/recovery.
- DEV diagnostics, automated tests, manual webcam matrix và tích hợp SCR-09.

Ngoài phạm vi:

- Ước lượng khoảng cách theo mét/centimet hoặc xác nhận thực tế 50–80 cm.
- Đo lux chính xác; `insufficient-light` chỉ là ước lượng chất lượng quan sát.
- Nhận diện/lưu đặc trưng sinh trắc học, depth estimation hoặc nhiều camera.
- Thay đổi API, database, WebSocket, RTCDataChannel hoặc thêm thư viện.
- Gửi các chỉ số readiness lên server.

## 3. Contract chỉ số

Mỗi chỉ số có miền `[0, 100]`, finite và được clamp:

### `bodyVisiblePercent`

- Tổng có trọng số của các nhóm mặt, vai, khuỷu và cổ tay đang hợp lệ; không đếm mọi landmark ngang nhau.
- Một nhóm phải đạt visibility/presence gate và nằm trong safe image bounds.
- Trái/phải độc lập; diagnostics phải giải thích phần điểm bị mất.
- Khi Pose không đủ để đánh giá, trả `unavailable`, không dùng `0` gây hiểu nhầm.

### `frameOccupancyPercent`

- Diện tích robust bounding box của người chia diện tích frame, nhân `100`.
- Box lấy từ Pose landmark tin cậy, loại outlier, có margin và clamp theo frame.
- Đây là proxy mức chiếm khung hình, không phải khoảng cách camera.
- Thiếu evidence thì trả `unavailable`, không giữ giá trị cũ vô hạn.

### `trackingQualityPercent`

- Điểm tổng hợp từ landmark confidence, body completeness, near-edge penalty, temporal stability và
  mức đồng thuận Pose/Hand/Face khi có sample mới.
- Duplicate/not-sampled không được tính như evidence mới.
- Điểm thấp luôn đi kèm reason code; không suy ra thiếu sáng chỉ từ quality thấp.

Internal snapshot đề xuất:

```ts
type CameraReadinessState =
  | 'unavailable'
  | 'too-close'
  | 'good'
  | 'slightly-far'
  | 'too-far'
  | 'hands-out-of-frame'
  | 'insufficient-light'

interface CameraReadinessSnapshot {
  bodyVisiblePercent: number | null
  frameOccupancyPercent: number | null
  trackingQualityPercent: number | null
  state: CameraReadinessState
  reasons: string[]
  timestampMs: number
}
```

Tên type/file cuối cùng chốt khi triển khai. Snapshot chỉ tồn tại local, không thêm vào
`AvatarPosePacketV1`.

## 4. Contract phân loại

- Bốn mức gần/xa suy từ occupancy đã smooth cùng quality/visibility tối thiểu.
- Không hiển thị “cách camera X cm” hoặc nội dung tương đương.
- `hands-out-of-frame` cần evidence theo từng bên từ wrist/elbow, Hand presence và biên ảnh; Hand task
  mất sample không mặc nhiên có nghĩa tay ngoài khung.
- `insufficient-light` dùng luminance/contrast lấy mẫu thưa kết hợp tracking suy giảm kéo dài. Đây không
  phải phép đo lux và phải chịu giới hạn auto-exposure/ngược sáng.
- Ưu tiên dự kiến: `insufficient-light` → gần/xa → `hands-out-of-frame` → `good`.
- Ngưỡng và thứ tự cuối chỉ khóa sau manual evidence, không khóa tùy ý ở bước lập kế hoạch.

## 5. Kế hoạch triển khai

### 3H-01 — Diagnostics và frozen evidence

**Trạng thái:** IMPLEMENTED — AUTOMATED GATE PASS; MANUAL WEBCAM/UI GATE PENDING.

Mục tiêu của 3H-01 là khóa evidence, diagnostics và dữ liệu kiểm thử cho 3H-02→3H-06; chưa tính ba
phần trăm production, chưa phân loại readiness cuối và chưa thay đổi SCR-09.

**Quyết định kiến trúc:**

- Module nằm tại `frontend/src/lib/tracking/camera-readiness/`, độc lập với `avatar-motion` và
  `avatar-renderer`.
- Input landmark là `RawTrackingFrameV1`; module không mutate input.
- `RawTrackingFrameV1` không chứa pixel, vì vậy 3H-01 không thêm pixel/luminance vào contract này.
  Light observation sẽ do adapter local-only của 3H-05 cung cấp riêng.
- DEV snapshot được đọc bởi `TrackingDevHarness`; không đi vào `AvatarPosePacketV1`, API, WebSocket,
  metrics gửi server, production log hoặc storage.
- Không thêm thư viện và không lưu ảnh trong frozen fixtures.

**Evidence inventory:**

| Evidence | Nguồn | Quy tắc |
|---|---|---|
| Pose state/time | `pose.state`, `pose.sampledAtMs` | Phân biệt tracked/lost/not-sampled và age |
| Pose image landmark | `pose.landmarks` | Kiểm finite, length, safe bounds |
| Visibility | `landmark.visibility` | `null` là unknown, không đổi thành 0 |
| Hand cadence | `handSampledThisFrame`, `handSampledAtMs` | Phân biệt detector chưa chạy với chạy nhưng không thấy tay |
| Hand candidates | `rawHands` | Chỉ diagnostics ở 3H-01 |
| Face evidence | `face.state`, `face.landmarks` | Availability/freshness, chưa double-count |
| Frame dimensions | `videoWidth`, `videoHeight` | Null/zero là unavailable; không giả định 1:1 |
| Luminance/contrast | Chưa có | `not-observed`, triển khai ở 3H-05 |

Semantic landmark index MediaPipe phải được khai báo một lần, không rải magic number. Tối thiểu gồm
nose/eyes/ears, left/right shoulder, elbow, wrist và hip.

**Contract diagnostics dự kiến:**

```ts
type ReadinessEvidenceReason =
  | 'valid' | 'not-sampled' | 'lost' | 'stale'
  | 'missing-landmarks' | 'missing-video-dimensions'
  | 'non-finite-coordinate' | 'unknown-visibility' | 'low-visibility'
  | 'outside-frame' | 'near-edge' | 'not-observed'

interface BodyRegionEvidence {
  region: 'face' | 'left-shoulder' | 'right-shoulder'
    | 'left-elbow' | 'right-elbow' | 'left-wrist' | 'right-wrist'
    | 'left-hip' | 'right-hip'
  available: boolean
  visibility: number | null
  imagePoint: { x: number; y: number } | null
  bounds: 'inside' | 'near-edge' | 'outside' | 'unknown'
  reasons: ReadinessEvidenceReason[]
}
```

Snapshot tổng phải có frame/sample timestamp, pose age/freshness, video size, region evidence, hand
sampling summary và `light: { state: 'not-observed' }`. Snapshot không chứa nguyên landmark arrays,
world landmarks, facial transform hoặc pixel buffer.

**Validity ban đầu:** coordinate phải finite; outside khi `x/y` ngoài `[0,1]`; near-edge dùng config có
tên và chưa phải ngưỡng sản phẩm. Freshness dùng sample timestamp, không dùng frame timestamp thay thế.
`not-sampled` không phải loss; cached landmark không phải evidence mới; visibility `null` là unknown.

**Frozen fixtures:** full upper-body centered; close crop; medium/far; very far; từng wrist ngoài biên;
mất một arm; Hand detector not-sampled; Hand sampled nhưng zero candidate; Pose duplicate/stale/lost;
invalid dimensions/coordinates; portrait/landscape. Fixture ánh sáng thật để 3H-05 bổ sung, 3H-01 chỉ
giữ `not-observed`.

**File map triển khai:**

| File | Trách nhiệm |
|---|---|
| `camera-readiness/readinessEvidence.ts` | Pure evidence extraction và reason codes |
| `camera-readiness/readinessTypes.ts` | Internal diagnostics types |
| `camera-readiness/readinessFixtures.ts` | DEV/test-only deterministic fixtures |
| `camera-readiness/readinessEvidence.test.ts` | Validity, freshness, bounds, privacy tests |
| `TrackingDevHarness.tsx` và CSS hiện có | Panel evidence DEV-only |

Không dự kiến sửa `rawTrackingTypes.ts`, `trackingPipeline.ts`, motion processor, renderer hoặc packet.
Nếu implementation cần sửa boundary này thì dừng để duyệt lại.

**Thứ tự:** tests trước → types/semantic map/extractor → fixtures → DEV panel → targeted/full tests,
TypeScript/lint/build → manual matrix.

**Automated gate:** phân biệt lost/not-sampled/stale; invalid/null/NaN không throw; bốn cạnh/góc báo đúng;
Hand not-sampled khác sampled-zero; replay deterministic; snapshot không chứa raw arrays/pixels; packet
và motion output không đổi.

**Manual gate:** kiểm tra vùng khi đứng giữa frame; đưa từng wrist qua bốn biên; đổi full-rate/staggered;
stop/start; đổi 720p/480p; kiểm tra Network và privacy diagnostics.

**Điểm dừng:** trình snapshot, fixtures và test evidence để người dùng duyệt; chưa bắt đầu 3H-02 trước
khi gate 3H-01 được chấp nhận.

**Evidence triển khai:** module `camera-readiness` đã có semantic Pose map, pure evidence extractor,
reason codes, freshness/bounds handling, deterministic fixtures và DEV-only panel. Targeted 3H-01/02
12/12 PASS; TypeScript, lint và production build PASS. HTTP smoke `/dev/tracking` trả 200. Browser skill
không có browser khả dụng trong phiên nên manual webcam/UI gate chưa chạy và không được coi là PASS.

### 3H-02 — `bodyVisiblePercent`

**Trạng thái:** IMPLEMENTED — AUTOMATED GATE PASS; MANUAL WEBCAM/UI GATE PENDING.

`bodyVisiblePercent` là tỷ lệ quan sát được của tập vùng cần cho upper-body avatar, không phải phần trăm
diện tích cơ thể, khoảng cách camera hay chất lượng tracking tổng thể.

**Contract:** output là số finite `[0,100]` hoặc `null`. `null` nghĩa chưa thể đánh giá do Pose
lost/stale/thiếu evidence nền; `0` nghĩa đã có observation hợp lệ nhưng không vùng nào đạt. Output luôn
kèm breakdown/reasons trong DEV. 3H-02 là pure scoring, chưa temporal smooth; temporal thuộc 3H-06.

**Trọng số v1 đề xuất để duyệt:**

| Nhóm | Thành phần | Trọng số |
|---|---|---:|
| Face | Gộp nose/eyes/ears | 20 |
| Shoulders | Trái 10 + phải 10 | 20 |
| Elbows | Trái 12.5 + phải 12.5 | 25 |
| Wrists | Trái 17.5 + phải 17.5 | 35 |
| **Tổng** | | **100** |

Hip là evidence phụ, không cộng vào score v1 vì Phase 3E cho phép shoulder-only fallback và preview tập
trung thân trên. Nếu đưa hip vào score sau manual evidence phải duyệt lại weights/regression. Các trọng
số trên là proposal, phải ở config có tên và chỉ khóa sau manual matrix.

**Công thức:**

```text
regionScore = visibilityScore × boundsScore × validityScore
bodyVisiblePercent = 100 × Σ(weight × regionScore) / Σ(activeWeight)
```

- Visibility dùng curve liên tục giữa low/high threshold; bounds inside=1, outside=0, near-edge giảm
  theo config; validity invalid=0.
- Unknown visibility phải theo fallback policy được test và giữ reason, không tự đổi thành 0/1.
- Không normalize lại chỉ vì mất một tay, vì sẽ che đúng vấn đề cần cảnh báo.
- Chỉ normalize active weights khi source thực sự không hỗ trợ một group theo contract.
- Internal giữ precision; chỉ UI diagnostics mới làm tròn.

**Face aggregation:** dùng nhiều Pose points nose/eyes/ears, cần core point + quorum hai phía; aggregate
bảo thủ bằng median/trimmed mean, không lấy max. Face Landmarker chưa double-count vào score 3H-02.

**Per-side semantics:** shoulder/elbow/wrist độc lập; wrist ngoài frame chỉ mất phần wrist; elbow mất
không xóa shoulder nhưng tạo reason `arm-chain-incomplete`. Hand Landmarker chưa cộng điểm ở 3H-02.

**Output triển khai:** `BodyVisibilitySnapshot` gồm `bodyVisiblePercent`, availability, region score/weight/
contribution/reasons, `leftArmComplete`, `rightArmComplete` và reasons tổng. Snapshot local-only, không
thêm vào raw frame hoặc avatar packet.

**File map triển khai:**

| File | Trách nhiệm |
|---|---|
| `camera-readiness/bodyVisibility.ts` | Pure scorer và config |
| `camera-readiness/bodyVisibility.test.ts` | Weight/curve/bounds/null/privacy tests |
| `camera-readiness/readinessTypes.ts` | Body visibility output types |
| `camera-readiness/readinessFixtures.ts` | Fixtures từng vùng/visibility/bounds |
| `TrackingDevHarness.tsx` | Total + breakdown DEV-only |

Không sửa pipeline, renderer, motion processor, SCR-09 production hoặc dependency trong 3H-02.

**Thứ tự:** duyệt groups/hip/weights → tests → pure scorer → DEV breakdown → targeted/full tests,
TypeScript/lint/build → manual tuning.

**Automated matrix:** all valid=100; Pose unavailable=`null`; valid nhưng tất cả fail=0; mất wrist trái
giảm đúng 17.5 theo proposal; mất face giảm đúng 20; near-edge giảm theo curve; visibility low→high đơn
điệu/liên tục; unknown/NaN có reason và không tạo NaN; hip missing không đổi score v1; Hand candidates
thay đổi nhưng Pose giữ nguyên thì score không đổi; replay deterministic; weights tổng bằng 100.

**Manual matrix:** upper body đầy đủ; từng wrist/elbow sát biên rồi ngoài frame; che mặt; hip vào/ra frame;
staggered duplicate/not-sampled; lost/reacquire. Manual gate chỉ đánh giá score/breakdown, chưa đánh giá
gần/xa hoặc ánh sáng.

**Điểm dừng:** trình weights/config, automated evidence và manual breakdown để người dùng duyệt; không
bắt đầu 3H-03 trước khi chốt semantics 3H-02.

**Evidence triển khai:** scorer v1 dùng weights Face 20 / Shoulders 20 / Elbows 25 / Wrists 35; hip và
Hand candidates không cộng điểm. `null`/`0`, near-edge, outside, unknown visibility, per-side completeness
và monotonic visibility curve đã có regression. Targeted chung 12/12 PASS. Full frontend suite 506/510;
bốn lỗi duy nhất thuộc blocker Phase 3B đã ghi nhận trong `handTwistRootCauseValidation.test.ts` do mock
renderer thiếu `capability.gaze`, không nằm trên đường code 3H. Manual gate vẫn PENDING.

### 3H-03 — `frameOccupancyPercent` và framing bands

**Trạng thái:** PLANNED — chỉ bắt đầu sau khi manual gate 3H-01/02 được người dùng chấp nhận hoặc người
dùng cho phép triển khai tiếp có điều kiện.

`frameOccupancyPercent` trả lời “phần thân người dùng cần cho tracking đang chiếm bao nhiêu phần khung
hình?”. Đây là proxy framing tương đối, không phải khoảng cách camera và không được đổi sang cm/m.

**Quyết định đo:**

- Dùng **core-body box ổn định**, không dùng toàn bộ silhouette. Vẫy hoặc dang tay không được làm hệ thống
  kết luận người dùng tiến gần camera.
- Core points ưu tiên face aggregate, hai vai, hai khuỷu và hai hip. Wrist không mở rộng box chính; wrist
  chỉ thuộc `bodyVisiblePercent` và cảnh báo tay ở 3H-05.
- `full-torso` khi face + hai vai + hip geometry đủ tin cậy.
- `upper-body` khi hip không thấy nhưng face + hai vai còn hợp lệ: đáy torso được ước lượng bảo thủ từ
  shoulder span bằng hệ số config. Mode này phải xuất hiện trong diagnostics, không giả là full-torso.
- Thiếu face hoặc không đủ hai vai/vertical anchor thì `unavailable`; không giữ occupancy cũ vô hạn và
  không suy diễn gần/xa từ một landmark đơn lẻ.

**Aspect-ratio contract:** image coordinates vẫn normalized `[0,1]`; diện tích box dùng tỷ lệ width/height
của frame. Các phép đo độ dài, outlier và shoulder-span fallback phải đổi sang pixel-corrected image space
bằng `videoWidth/videoHeight`, không giả định frame vuông. Không dùng world-landmark `z` làm khoảng cách.

**Robust box pipeline:**

```text
CameraReadinessEvidenceSnapshot
  → chọn core regions hợp lệ theo mode
  → đổi sang pixel-corrected image space
  → semantic outlier rejection quanh face/shoulder/hip geometry
  → dựng raw core-body box + anatomical margin có config
  → đổi về normalized frame ratios
  → raw occupancy và visible/clipped occupancy
  → timestamp-aware filter
  → framing band + hysteresis
```

- Không dùng generic min/max trên mọi Pose landmark vì một wrist nhiễu sẽ phá box.
- Outlier rejection không được loại hai shoulder/face chỉ vì người xoay nhẹ; rejection phải có reason
  như `insufficient-core-points`, `invalid-shoulder-span`, `core-geometry-outlier`.
- Margin ngang/dọc dựa trên shoulder span và mode, có giới hạn; không dùng số pixel cố định.
- `rawBox` được phép vượt biên để nhận ra crop/quá gần; `visibleBox` là phần giao với frame.
- `frameOccupancyPercent = clamp(rawBox.widthRatio × rawBox.heightRatio × 100, 0, 100)`.
- `visibleOccupancyPercent` và `clippedSides` chỉ là diagnostics để phân biệt người lớn trong frame với
  người đang bị crop. Chỉ `frameOccupancyPercent` thuộc chỉ số Phase 3H đã chốt.

**Contract output dự kiến:**

```ts
type FramingBand = 'unavailable' | 'too-far' | 'slightly-far' | 'good' | 'too-close'

interface FrameOccupancySnapshot {
  frameOccupancyPercent: number | null
  visibleOccupancyPercent: number | null
  mode: 'full-torso' | 'upper-body' | 'unavailable'
  rawBox: { left: number; top: number; right: number; bottom: number } | null
  visibleBox: { left: number; top: number; right: number; bottom: number } | null
  clippedSides: Array<'left' | 'right' | 'top' | 'bottom'>
  band: FramingBand
  reasons: string[]
  sampledAtMs: number | null
}
```

Snapshot local-only, không thêm vào `RawTrackingFrameV1` hoặc `AvatarPosePacketV1`.

**Freshness và temporal ownership:**

- Chỉ sample Pose mới có timestamp tăng mới update box/filter/band.
- `not-sampled` hoặc duplicate timestamp giữ output hiện tại trong freshness window nhưng không update
  filter, dwell hoặc hysteresis.
- Timestamp regression reset state; Pose lost/stale chuyển `unavailable` theo policy hữu hạn.
- Filter chạy trên box center/size hoặc occupancy trước classification, không average trực tiếp enum band.
- 3H-03 sở hữu smoothing/hysteresis riêng của framing. State machine ưu tiên cảnh báo toàn Phase thuộc
  3H-06 và không được triển khai sớm ở đây.

**Framing bands:**

- Thứ tự luôn là `too-far < slightly-far < good < too-close` theo occupancy.
- Mỗi ranh giới có ngưỡng enter/exit riêng; hysteresis tính theo điểm phần trăm occupancy.
- Ngưỡng số chưa khóa trong kế hoạch. Implementation bắt đầu bằng config có tên, sau đó dùng frozen
  scale fixtures và webcam ladder để tuning; chỉ ghi số thành accepted config sau manual evidence.
- `good` phải yêu cầu box mode hợp lệ và không crop nghiêm trọng. Occupancy nằm trong band tốt nhưng
  core body bị clip không được âm thầm báo “Khoảng cách tốt”.
- 3H-03 chỉ phát band framing; copy tiếng Việt thuộc 3H-07.

**Frozen fixtures cần bổ sung:**

| ID | Fixture | Kết quả bắt buộc |
|---|---|---|
| O01 | full-torso centered ở nhiều scale | Occupancy tăng đơn điệu theo scale |
| O02 | upper-body, hip missing | Mode/fallback xác định, finite |
| O03 | cùng torso, wrist dang/thu | Occupancy gần như không đổi |
| O04 | một wrist outlier rất xa | Box chính không đổi |
| O05 | crop trái/phải/trên/dưới | `clippedSides` đúng; raw ≥ visible |
| O06 | portrait/4:3/16:9 cùng pixel geometry | Kết quả tương đương trong tolerance |
| O07 | duplicate/not-sampled | Không update filter/band |
| O08 | stale/lost/timestamp regression | Reset/unavailable đúng policy |
| O09 | jitter quanh mỗi threshold | Band không flip-flop |
| O10 | scale đi xa→gần→xa | Thứ tự band đúng và recovery hữu hạn |

**File map dự kiến:**

| File | Trách nhiệm |
|---|---|
| `camera-readiness/frameOccupancy.ts` | Pure box solve, occupancy và reason codes |
| `camera-readiness/framingTemporal.ts` | Sample timestamp, filter, hysteresis và reset |
| `camera-readiness/frameOccupancy.test.ts` | Geometry/mode/aspect/outlier tests |
| `camera-readiness/framingTemporal.test.ts` | Duplicate/jitter/band/lifecycle tests |
| `camera-readiness/readinessTypes.ts` | Box/mode/band snapshot types |
| `camera-readiness/readinessFixtures.ts` | Scale/crop/aspect fixtures |
| `TrackingDevHarness.tsx` | Raw/filtered occupancy, mode, boxes, clipped sides và band DEV-only |

Không sửa MediaPipe runtime, tracking pipeline, motion processor, renderer, packet, SCR-09 production
hoặc dependency trong 3H-03. Nếu cần pixel/depth/camera calibration thì dừng vì vượt phạm vi.

**Thứ tự triển khai khi được duyệt:**

1. Mở rộng scale/crop/aspect fixtures và viết geometry tests trước.
2. Implement pure full-torso/upper-body box solver và diagnostics overlay.
3. Duyệt trực quan box trước khi thêm framing bands.
4. Thêm timestamp-aware filter và hysteresis tests.
5. Nối DEV diagnostics; chưa nối production UI.
6. Chạy targeted/full tests, TypeScript, lint, build và performance comparison.
7. Chạy manual webcam ladder, tuning config, trình evidence cho người dùng duyệt.

**Automated gate:** finite/clamp; scale→occupancy đơn điệu; wrist/Hand candidates không làm đổi core box;
aspect-ratio invariant trong tolerance; raw/visible/clipping đúng; full/upper/unavailable rõ; duplicate không
bơm temporal; regression/lost reset; hysteresis không flip-flop; không đổi body visibility, packet hoặc
motion output hiện có.

**Manual webcam gate:** giữ nguyên tư thế, tiến/lùi theo ít nhất bốn mốc tương đối; thử hip vào/ra frame;
dang/vẫy tay; crop từng cạnh; xoay người nhẹ; test 720p/480p và viewport desktop/mobile. Ghi raw/filtered
occupancy, mode, clipped sides, band và FPS. Không dùng thước hoặc tuyên bố số cm là ground truth.

**Điểm dừng:** sau 3H-03, trình box overlay, threshold config, automated evidence và manual ladder cho
người dùng duyệt. Không bắt đầu `trackingQualityPercent` 3H-04 trước khi framing semantics được chốt.

### 3H-04 — `trackingQualityPercent`

**Trạng thái:** PLANNED — bắt đầu sau khi framing semantics 3H-03 được duyệt.

`trackingQualityPercent` đo mức đáng tin cậy của landmark hiện tại để điều khiển avatar. Nó không đo
camera quality tổng quát, độ đẹp hình ảnh, FPS hay khoảng cách. Score thấp luôn phải đi kèm component và
reason code để biết nguyên nhân.

**Input boundary:** dùng `CameraReadinessEvidenceSnapshot`, raw sample state/timestamps và lịch sử ngắn của
normalized landmark geometry. Không dùng rendered avatar state, quaternion/bone output, framing band hoặc
light score làm input; như vậy không tạo vòng lặp giữa quality và các cảnh báo khác.

**Bốn component v1 đề xuất:**

| Component | Trọng số | Ý nghĩa |
|---|---:|---|
| `bodyCompleteness` | 35 | Các region cần thiết có observation hợp lệ, không đếm visibility amplitude lần hai |
| `landmarkConfidence` | 30 | Aggregate visibility/presence bảo thủ của region hợp lệ |
| `temporalStability` | 20 | Jitter/vận tốc bất thường sau khi chuẩn hóa theo shoulder span và `dt` |
| `sampleFreshness` | 15 | Age/cadence của Pose cùng bằng chứng Face/Hand nếu task đó được bật |
| **Tổng** | **100** | |

Cross-task agreement giữa Pose wrist và Hand wrist, hoặc Pose face và Face task, chỉ là **penalty có giới
hạn** và reason; không cộng thêm điểm để tránh một evidence được thưởng hai lần. Khi task Face/Hand bị tắt
có chủ đích, weight không được coi là lỗi và không làm quality thấp giả.

**Công thức dự kiến:**

```text
baseQuality = Σ(componentWeight × componentScore)
trackingQualityPercent = clamp(baseQuality - boundedDisagreementPenalty, 0, 100)
```

- Mỗi component nằm `[0,1]`, finite và có breakdown DEV-only.
- Completeness dùng region presence/validity và safe bounds; không tái dùng nguyên
  `bodyVisiblePercent` vì chỉ số đó đã trộn visibility + bounds.
- Confidence dùng median/trimmed mean, không dùng max. Một landmark confidence cao không che được nhiều
  region mất.
- Stability chỉ update trên Pose sample mới có timestamp tăng. Tọa độ chuyển động có chủ đích toàn thân
  được tách khỏi jitter bằng center/scale normalization; không phạt chỉ vì người dùng di chuyển nhanh hợp lệ.
- Freshness giảm liên tục theo age trước khi stale; `not-sampled` trong cadence hợp lệ không rơi điểm đột
  ngột. Lost/stale hữu hạn phải đưa quality về `null` hoặc 0 theo contract state đã duyệt, không giữ cao.
- Output `null` khi không đủ evidence nền để đánh giá; `0` khi có observation nhưng hoàn toàn không tin cậy.

**Contract output dự kiến:**

```ts
interface TrackingQualitySnapshot {
  trackingQualityPercent: number | null
  components: {
    bodyCompleteness: number | null
    landmarkConfidence: number | null
    temporalStability: number | null
    sampleFreshness: number | null
  }
  disagreementPenalty: number
  reasons: string[]
  sampledAtMs: number | null
  observation: 'new-sample' | 'duplicate' | 'not-sampled' | 'lost' | 'stale'
}
```

Snapshot local-only và không thêm vào avatar packet/network.

**Temporal/lifecycle:** scorer component là pure; một `TrackingQualityProcessor` nhỏ sở hữu previous
normalized geometry và timestamps. Duplicate/not-sampled không update stability history. Timestamp
regression, camera restart, tab resume sau discontinuity, tracking reset và dispose xóa history. Model/avatar
reload không reset vì quality thuộc camera tracking, không thuộc rig.

**Fixtures cần bổ sung:** full stable; visibility giảm từng mức; mất từng region; uniform translation/scale
hợp lệ; high-frequency jitter; sudden outlier; duplicate cadence; staggered Face/Hand; Face/Hand task disabled;
Pose–Hand wrist disagreement; lost/stale/reacquire; timestamp regression.

**File map dự kiến:**

| File | Trách nhiệm |
|---|---|
| `camera-readiness/trackingQuality.ts` | Component scorers, weight config và bounded penalty |
| `camera-readiness/trackingQualityProcessor.ts` | Stability history, timestamps và lifecycle |
| `camera-readiness/trackingQuality.test.ts` | Component/weight/null/penalty tests |
| `camera-readiness/trackingQualityProcessor.test.ts` | Duplicate/jitter/reset/recovery tests |
| `camera-readiness/readinessTypes.ts` | Quality snapshot và reason types |
| `camera-readiness/readinessFixtures.ts` | Confidence/jitter/cross-task fixtures |
| `TrackingDevHarness.tsx` | Total, components, penalty, reasons và sample state DEV-only |

Không sửa MediaPipe models, motion processor, renderer, packet, server metrics hoặc dependency.

**Thứ tự:** component tests → pure scorers → stability processor → cross-task penalty → DEV breakdown →
targeted/full tests, lint/build → webcam matrix → tuning/duyệt.

**Automated gate:** weights=100; mỗi component/output finite/clamped; confidence/completeness giảm đơn điệu;
uniform motion không bị coi là jitter; injected jitter làm stability giảm; duplicate không bơm history;
task disabled không bị phạt; disagreement penalty bounded; lost/regression/reset đúng; output avatar và hai chỉ
số 3H-02/03 không đổi.

**Manual webcam gate:** giữ yên; chuyển động chậm/nhanh có chủ đích; rung camera nhẹ; che từng region; đưa
tay sát biên; đổi full-rate/staggered; bật từng task mode; lost/reacquire. Ghi total/components/reasons và FPS.
Quality không được tụt mạnh chỉ vì biểu cảm hoặc động tác hợp lệ.

**Điểm dừng:** trình component weights, confusion cases, automated evidence và webcam breakdown cho người
dùng duyệt trước 3H-05.

### 3H-05 — Tay ngoài khung và ánh sáng chưa đủ

**Trạng thái:** PLANNED — bắt đầu sau khi quality contract 3H-04 được duyệt.

3H-05 tạo hai observation độc lập: trạng thái tay theo từng bên và điều kiện ánh sáng. Subtask này chưa
chọn primary UI state hoặc thứ tự ưu tiên; việc đó thuộc 3H-06.

#### 3H-05A — Hand frame observation

**Per-side states:**

```ts
type HandFrameState =
  | 'inside'
  | 'near-edge'
  | 'outside-frame'
  | 'occluded-or-low-confidence'
  | 'unavailable'
```

**Evidence policy:**

- Pose anatomical wrist/elbow và quỹ đạo gần nhất là nguồn chính xác định bên trái/phải.
- Hand Landmarker chỉ cross-check presence/palm khi sample mới và matching đủ tin cậy; handedness label
  đơn lẻ không được lật kết luận bên.
- `outside-frame` chỉ khi wrist quan sát được ngoài biên, hoặc wrist biến mất ngay sau chuỗi tiến tới
  `near-edge` cùng hướng và elbow geometry còn hỗ trợ.
- Wrist biến mất khi trước đó ở sâu trong frame phải là `occluded-or-low-confidence`, không khẳng định
  ngoài khung.
- Một bên mất không làm mất state bên còn lại. Elbow ngoài frame cùng wrist là evidence mạnh nhưng vẫn
  phải giữ reason riêng.
- 3H-05 chỉ giữ history tối thiểu để phân biệt trajectory/occlusion; dwell của thông báo chính thuộc 3H-06.

Output theo bên phải có `state`, confidence `[0,1]`, last observed point, edge/direction, Pose/Hand freshness
và reasons. Không gửi raw landmarks.

#### 3H-05B — Light observation

`RawTrackingFrameV1` không chứa pixel và tiếp tục không chứa pixel. Một adapter local-only nhận `<video>`
đã được cấp quyền, draw xuống sampling surface nhỏ và chỉ trả thống kê số.

**Sampling contract:**

- Dùng Canvas 2D/`OffscreenCanvas` khi khả dụng, fallback canvas in-memory; không thêm thư viện.
- Downscale mạnh (proposal tối đa 32×18) và sample theo interval thời gian thấp hơn camera FPS (proposal
  4–5 Hz), không `getImageData` full-resolution mỗi frame.
- ROI ưu tiên face + upper torso từ readiness box; khi ROI unavailable có center fallback nhưng reason
  `fallback-roi` và confidence thấp hơn.
- Tính luminance median, low/high percentile, contrast range, dark-pixel ratio và bright-clipping ratio.
- Dùng luminance/contrast cùng tracking quality suy giảm kéo dài; không suy ra thiếu sáng chỉ vì nền/áo tối.
- Backlight/overexposure/covered-camera có reason DEV riêng nếu evidence đủ; production copy vẫn bảo thủ.
- Pixel buffer bị ghi đè/thả ngay trong tick; không lưu frame, export ảnh, log pixel hoặc đưa vào React state.

**Light output:**

```ts
type LightState = 'sufficient' | 'insufficient' | 'backlit-or-low-contrast' | 'unavailable'

interface LightObservation {
  state: LightState
  confidence: number
  medianLuminance: number | null
  contrast: number | null
  darkRatio: number | null
  brightClipRatio: number | null
  roiMode: 'face-upper-body' | 'center-fallback' | 'unavailable'
  reasons: string[]
  sampledAtMs: number | null
}
```

Đây không phải lux. Không hiển thị “X lux” và không so trực tiếp với điều kiện test ≥200 lux trong SRS.

**Temporal/lifecycle:** Hand history và light sampler có timestamp độc lập. Duplicate Pose/Hand không tiến
trajectory; light chỉ update khi interval đến hạn. Stop/restart/dispose/tab resume xóa history và sampling
surface; camera permission denied không tạo light observation giả. 3H-05 có thể confirm evidence tối thiểu
để tránh một sample nhiễu, nhưng primary-state dwell/recovery vẫn chỉ nằm ở 3H-06.

**Fixtures/tests:** tay từng bên đi qua mỗi cạnh; tay biến mất giữa frame; elbow còn/mất; Hand detector
not-sampled vs sampled-zero; handedness sai; ánh sáng đều đủ; tối toàn ROI; nền/áo tối nhưng mặt sáng; ngược
sáng; overexposure; low contrast; covered camera; auto-exposure ramp; ROI unavailable; sampler cadence.

**File map dự kiến:**

| File | Trách nhiệm |
|---|---|
| `camera-readiness/handFrameObservation.ts` | Per-side evidence + trajectory classifier |
| `camera-readiness/handFrameObservation.test.ts` | Edge/occlusion/side/freshness regressions |
| `camera-readiness/lightSampler.ts` | Downscaled local-only pixel sampling adapter |
| `camera-readiness/lightAssessment.ts` | Pure numeric light classifier |
| `camera-readiness/lightSampler.test.ts` | Cadence/buffer/lifecycle tests với canvas mock |
| `camera-readiness/lightAssessment.test.ts` | Luminance/contrast/confusion fixtures |
| `camera-readiness/readinessTypes.ts` | Hand/light outputs và reasons |
| `TrackingDevHarness.tsx` | Per-side hand + numeric light diagnostics DEV-only |

Không thêm pixel vào raw frame/packet, không thay camera constraints và không thêm dependency.

**Performance gate riêng:** đo trước/sau trên 720p; sampler p95 và allocation phải được ghi; không tạo long
task; camera/pipeline FPS và tracking-to-render gate không giảm đáng kể. Nếu sampling surface hoặc
`getImageData` làm mất gate NFR-01/02 thì giảm resolution/cadence hoặc dừng để duyệt, không che bằng smoothing.

**Automated gate:** đúng bên/cạnh; occlusion không bị gọi outside; handedness sai không lật side; sampler
không chạy mỗi frame; buffers không vào snapshot/network; dark/backlight/low-contrast phân biệt theo fixtures;
dark background không tự tạo insufficient; lifecycle cleanup; outputs finite/clamped.

**Manual webcam gate:** đưa từng tay qua bốn cạnh rồi che trước thân; thử một/cả hai tay; đổi ánh sáng phòng,
ngược sáng, nền/áo tối, che camera; quan sát auto-exposure; chạy liên tục 60 giây và ghi FPS/latency/sampler
p95. Không dùng điện thoại đo lux làm ground truth sản phẩm.

**Điểm dừng:** trình confusion matrix tay/ánh sáng, performance evidence và manual video conditions cho
người dùng duyệt trước 3H-06.

### 3H-06 — Readiness state machine và lifecycle

**Trạng thái:** PLANNED — bắt đầu sau manual gate 3H-05.

3H-06 hợp nhất output 3H-02→05 thành một primary state ổn định và secondary reasons. Nó không tính lại
body visibility, occupancy, quality, hand hoặc light; mỗi tín hiệu chỉ có một owner.

**Input:** `BodyVisibilitySnapshot`, `FrameOccupancySnapshot`, `TrackingQualitySnapshot`, per-side
`HandFrameObservation`, `LightObservation` và camera/pipeline lifecycle events.

**Primary state contract:**

```ts
type CameraReadinessState =
  | 'unavailable'
  | 'insufficient-light'
  | 'too-close'
  | 'too-far'
  | 'slightly-far'
  | 'hands-out-of-frame'
  | 'good'
```

**Priority dự kiến:**

1. `unavailable`: camera/tracking evidence nền không có hoặc stale quá policy.
2. `insufficient-light`: light evidence đủ confidence và kéo dài.
3. `too-close`/`too-far`/`slightly-far`: framing band đã ổn định; severe crop không được báo good.
4. `hands-out-of-frame`: một/cả hai bên có outside evidence đủ confidence.
5. `good`: framing tốt, ánh sáng đủ, quality/body visibility qua gate và không có cảnh báo tay.

Occlusion/low-confidence không được đổi thành `hands-out-of-frame`; nó nằm trong secondary reasons hoặc
quality guidance. Khi nhiều lỗi cùng tồn tại, primary theo priority nhưng snapshot giữ toàn bộ secondary
reasons để DEV/UI tương lai giải thích được.

**State machine:**

- Mỗi candidate có `enterDwellMs`, `exitDwellMs` và minimum confidence bằng config có tên.
- Dùng elapsed time/sample timestamps, không đếm frame.
- Candidate mới phải ổn định qua dwell mới commit; trong lúc chờ giữ committed state hợp lệ gần nhất.
- Recovery về `good` có confirmation riêng, không chuyển ngay sau một frame đẹp.
- `unavailable` có short hold hữu hạn để chịu stagger/brief loss, sau đó bắt buộc commit; không giữ good
  hoặc warning vô hạn.
- Framing band hysteresis của 3H-03 được tôn trọng; 3H-06 chỉ dwell primary state, không smooth occupancy lần hai.
- Light/hand evidence confirmation của 3H-05 không bị filter lại bằng cùng thuật toán; 3H-06 chỉ xử lý
  chuyển trạng thái tổng và priority.

**Output dự kiến:**

```ts
interface CameraReadinessSnapshot {
  bodyVisiblePercent: number | null
  frameOccupancyPercent: number | null
  trackingQualityPercent: number | null
  state: CameraReadinessState
  pendingState: CameraReadinessState | null
  reasons: string[]
  affectedHands: Array<'left' | 'right'>
  confidence: number
  changedAtMs: number
  sampledAtMs: number
}
```

Snapshot local-only; production copy thuộc 3H-07.

**Lifecycle/epoch:** processor có readiness epoch riêng. Camera start/restart, explicit reset, timestamp
regression, stream ended, dispose và tab resume sau discontinuity mở epoch mới và xóa pending/committed
evidence. Short `not-sampled` không mở epoch. Avatar model reload không reset. Callback/timer từ epoch cũ
không được commit state sau restart.

**Transition fixtures:** good→jitter→good; good→too-close→good; far ladder; light flicker/auto-exposure;
one/both hands out; simultaneous dark+far+hand; brief/long lost; reacquire; timestamp regression; rapid
alternating candidates; restart while pending; stale callback from old epoch.

**File map dự kiến:**

| File | Trách nhiệm |
|---|---|
| `camera-readiness/readinessStateMachine.ts` | Priority, dwell, pending/commit/recovery |
| `camera-readiness/readinessStateMachine.test.ts` | Transition/priority/timing/epoch matrix |
| `camera-readiness/readinessProcessor.ts` | Orchestrate 3H-02→05 outputs, lifecycle và snapshot |
| `camera-readiness/readinessProcessor.test.ts` | Integration/privacy/regression tests |
| `camera-readiness/readinessTypes.ts` | Final local-only snapshot types |
| `TrackingDevHarness.tsx` | Committed/pending state, timers, reasons và affected hands DEV-only |

Không nối SCR-09 production trong 3H-06, không thêm network metrics và không dùng wall-clock timer độc lập
nếu sample timestamp đủ; tránh timer leak khi component unmount.

**Thứ tự:** transition tests → pure priority resolver → dwell machine → lifecycle epoch → integration
processor → DEV timeline → targeted/full tests/lint/build → manual matrix/performance.

**Automated gate:** priority đúng mọi tổ hợp; dwell tính theo ms và độc lập FPS; brief jitter không flip;
warning/recovery hữu hạn; duplicate không tiến pending; unavailable không giữ cũ vô hạn; reset/restart không
dùng state epoch cũ; one/both hand reasons đúng; snapshot không chứa raw arrays/pixels; 3H-02→05 unit gates
vẫn xanh.

**Manual webcam gate:** đi qua toàn chuỗi good, gần/xa, từng tay ngoài khung, tối/ngược sáng, đồng thời nhiều
lỗi, brief occlusion, stop/start và tab background/resume. Ghi timeline committed/pending, dwell, priority,
recovery, FPS và memory trong ít nhất 60 giây.

**Điểm dừng:** trình transition timeline, priority/confusion matrix, lifecycle/performance evidence và manual
acceptance cho người dùng duyệt. Chỉ sau đó mới tích hợp production SCR-09 ở 3H-07.

### 3H-07 — SCR-09 integration và acceptance

- Copy dự kiến: “Bạn đang quá gần”, “Vị trí phù hợp”, “Bạn đang hơi xa”, “Bạn đang quá xa”,
  “Đưa tay vào khung hình”, “Ánh sáng chưa đủ”.
- Không hiển thị đơn vị khoảng cách. Hướng dẫn 50–80 cm hiện tại sẽ đổi thành framing tương đối khi 3H
  được triển khai và nghiệm thu.
- UI không che avatar, có accessibility phù hợp và không đọc lặp liên tục.
- Ba phần trăm mặc định DEV-only; đưa lên production cần UI acceptance riêng vì dễ tạo cảm giác chính
  xác tuyệt đối.
- Chạy tests/build/lint và manual webcam matrix trước khi đánh dấu COMPLETE.

**Gate:** hướng dẫn đúng, ổn định trên desktop/mobile; permission denied vẫn theo NFR-30; readiness xấu
không chặn preview/avatar.

## 6. Tuning ngưỡng

Phase 3H chưa khóa ngưỡng phần trăm. Khi triển khai:

1. Đặt giá trị khởi tạo trong config, không rải magic number.
2. Thu evidence local ở nhiều framing/ánh sáng và ít nhất hai webcam hoặc cấu hình máy khi có thể.
3. Ghi confusion cases: che khuất/ngoài khung, nền tối/thiếu sáng, người nhỏ/Pose lost.
4. Điều chỉnh threshold, hysteresis, dwell bằng evidence rồi khóa bằng automated tests.
5. Ghi ngưỡng nghiệm thu và ngày manual evidence vào tài liệu này cùng tài liệu kiểm thử.

Không lưu hoặc gửi dữ liệu sinh trắc học để tuning.

## 7. Manual acceptance matrix

| ID | Kịch bản | Kết quả mong đợi |
|---|---|---|
| H1 | Mặt, vai, khuỷu, cổ tay và thân trên rõ | `good`, chỉ số ổn định |
| H2 | Tiến gần từ từ | occupancy tăng; vào `too-close` một lần |
| H3 | Lùi theo từng mức | `slightly-far` rồi `too-far` theo band đã duyệt |
| H4 | Đưa từng/cả hai tay ra frame | reason đúng bên; hướng dẫn đưa tay vào khung |
| H5 | Che tay trước thân | không khẳng định chắc chắn tay ngoài khung |
| H6 | Giảm ánh sáng từ từ | cảnh báo sau dwell; không flip-flop theo auto-exposure |
| H7 | Nền/áo tối nhưng mặt rõ | không cảnh báo thiếu sáng sai rõ rệt |
| H8 | Ngược sáng | reason phản ánh suy giảm; UI dùng thông báo bảo thủ |
| H9 | Tracking lost rồi phục hồi | `unavailable`, recovery hữu hạn, không dùng score cũ |
| H10 | Tab resume/restart camera | reset đúng, không leak timer/frame buffer |
| H11 | Camera bị từ chối | avatar tĩnh theo NFR-30, không readiness giả |
| H12 | Chạy 60 giây | không làm hỏng mục tiêu FPS/latency NFR-01/02 |

## 8. Automated gates

- Unit tests cho weighted visibility, robust bounds, occupancy, quality và finite/clamp.
- Temporal tests cho duplicate, timestamp regression, hysteresis, dwell, hold và recovery.
- Classification tests cho priority, per-side hand state và ambiguous evidence.
- Privacy regression: không frame/raw landmark/readiness diagnostics trong packet, API hoặc log.
- Lifecycle/resource tests: stop/restart/dispose không giữ timer, buffer hoặc state cũ.
- Benchmark trước/sau; không làm mất tracking-to-render gate hiện có.
- TypeScript, lint và production build PASS; automated PASS không thay manual webcam acceptance.

## 9. Tài liệu cập nhật khi triển khai

- `docs/02_SYSTEM_ARCHITECTURE.md`: pipeline và privacy boundary.
- `docs/05_UI_UX.md`: chốt component/status copy SCR-09.
- `docs/06_CODEBASE_GUIDE.md`: file/module thực tế.
- `docs/07_DEVELOPMENT_AND_TESTING.md`: test cases và evidence.
- `docs/09_ROADMAP_AND_TASKS.md`: trạng thái Phase 3H/P4-T10.

Không sửa API/database docs nếu implementation giữ đúng phạm vi.
