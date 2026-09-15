# F5 — Audio + webcam lip-sync fusion plan

Trạng thái: **DEFERRED BY OWNER 2026-09-14 — giữ qualification harness/evidence, không tích hợp audio model vào facial pipeline; chỉ mở lại nếu webcam telemetry chứng minh bỏ lỡ toàn bộ peak**  
Ngày lập: 2026-09-11  
Ngày chốt review: 2026-09-11  
Phạm vi nguồn chân lý: `docs/09_ROADMAP_AND_TASKS.md`, `docs/11_AVATAR_EVOLUTION_ROADMAP.md`,
`docs/01_PRODUCT_REQUIREMENTS.md`, `docs/02_SYSTEM_ARCHITECTURE.md`, `docs/07_DEVELOPMENT_AND_TESTING.md`,
`docs/10_PERFORMANCE.md`.

## 1. Kết quả cần đạt

F5 phải bổ sung bằng chứng âm thanh cho pipeline F3/F4 để:

1. miệng bắt đầu/dừng gần tiếng nói hơn;
2. m/b/p khép nhanh mà không kéo mắt hoặc preset toàn mặt;
3. giảm rung vowel khi người dùng im lặng;
4. giữ webcam là nguồn hình dáng miệng chính khi mặt còn đáng tin;
5. dùng audio làm bằng chứng phụ/fallback có giới hạn, không ghi đè hình học webcam;
6. giữ toàn bộ phân tích trong trình duyệt, không upload/ghi/log PCM;
7. không làm tracking→render vượt 100 ms hoặc FPS xuống dưới 24 trên máy tham chiếu.

F5 không sửa morph profile F4, không làm emotion từ giọng nói, không điều khiển má/mày/mắt và không thay
P4-T15/P4-T19 WebRTC transport. F6 sở hữu conversational emotion; P4-T19 sở hữu đồng bộ playout phía nhận.

## 2. Quyết định thư viện

### 2.1 Runtime đề xuất

Thêm đúng một runtime inference: **`onnxruntime-web`**, pin phiên bản chính xác khi bắt đầu code.

Lý do:

- chạy model ONNX hoàn toàn trong browser;
- có WASM fallback rộng và WebGPU khi thiết bị hỗ trợ;
- cho phép tự host model/runtime, không cần gửi audio ra dịch vụ;
- thấp tầng hơn ASR framework: F5 cần posterior phoneme/viseme theo frame, không cần sinh văn bản.

Không chọn Web Speech API vì không bảo đảm xử lý on-device. Không chọn full ASR/Whisper làm đường chính vì
text decoding tạo latency và chi phí lớn hơn nhu cầu viseme framewise.

### 2.2 Execution provider

- **WASM trong dedicated Worker là baseline bắt buộc**.
- WebGPU chỉ được bật sau benchmark, không mặc định: MediaPipe và Three.js đã dùng GPU nên ORT WebGPU có thể
  tranh tài nguyên và làm giảm FPS.
- Không chạy inference trên main thread hoặc AudioWorklet realtime thread.
- Nếu WebGPU/session/model fail, fallback WASM; nếu cả hai fail, fallback F5-VAD rồi giữ F3/F4 hoạt động.
- Với WASM, F5-0 phải benchmark `numThreads = 1`, `2` và `auto`; chỉ bật nhiều thread khi
  `crossOriginIsolated === true` và **FPS/tracking→render của toàn ứng dụng** tốt hơn, không chọn theo inference đơn lẻ.

### 2.3 Model chưa được phép chọn bằng cảm tính

Subtask đầu tiên F5-0 là model qualification. F5-0 được phép cài/pin `onnxruntime-web` để làm spike benchmark,
nhưng không được nối runtime/model vào facial pipeline production hoặc viết cả pipeline trước khi một candidate qua
đủ gate. Candidate phải công bố contract đầu vào qua descriptor, không hardcode 16 kHz/log-mel:

```ts
type AudioFeatureType = "pcm" | "mfcc" | "log-mel";

interface AudioVisemeProviderDescriptor {
  modelId: string;
  sampleRateHz: number;
  frameHopMs: number;
  contextMs: number;
  featureType: AudioFeatureType;
  labels: readonly string[];
}
```

Provider sở hữu toàn bộ preprocessing theo descriptor; phần fusion chỉ nhận semantic posterior đã chuẩn hóa.
Candidate phải:

- có sample rate, feature extraction, frame hop và context được công bố đầy đủ;
- xuất posterior framewise tối thiểu cho `silence/closed/aa/ih/ou/ee/oh`, hoặc phoneme đủ để map deterministically;
- hỗ trợ tiếng Việt hoặc chứng minh viseme-level không phụ thuộc từ vựng bằng fixture tiếng Việt;
- giấy phép cho phép redistribute trong đồ án;
- tự host dưới `/models/audio/`; runtime không tải model/CDN bên ngoài;
- model quantized mục tiêu ≤ 25 MB, inference stride 20 ms, p95 inference ≤ 25 ms trên máy tham chiếu;
- không cần gửi audio hoặc telemetry tới server.

Nếu không candidate nào đạt, F5 chỉ được đánh dấu **PARTIAL (VAD + timing)**; không dùng spectral heuristic
để giả vờ đã nhận diện được nguyên âm.

Shortlist sau review, **chưa model nào được chọn**:

- `KitsuMate/uni2005-onnx`: contract framewise rõ (`[batch,time,120]` MFCC → `[batch,time,230]` phone), có bản INT8,
  nhưng yêu cầu 8 kHz/MFCC riêng và mang GPL-3.0. Chỉ là ứng viên benchmark/nghiên cứu; chưa được phép đưa vào
  sản phẩm trước khi xác minh nghĩa vụ phân phối model, source tương ứng và tính tương thích giấy phép của VeilTalk.
- Hai model Vietnamese wav2vec2 đã khảo sát không vào shortlist chính: một artifact khoảng 378 MB và cả hai model
  được công bố theo CC BY-NC 4.0. Chúng quá nặng cho budget hiện tại và ràng buộc phi thương mại không phải lựa
  chọn an toàn để mặc định phân phối cùng sản phẩm.

F5-0 phải tạo bảng audit có nguồn cho từng candidate: owner, model card, license model và code tách riêng, checksum,
kích thước từng variant, input/output thật đọc từ ONNX, preprocessing, kết quả fixture tiếng Việt và benchmark browser.
Chỉ sau khi chủ dự án duyệt bảng này mới được pin model/checksum và sang F5-1.

## 3. Kiến trúc dữ liệu

### 3.1 Audio input ownership

Production không mở microphone lần hai. F5 nhận `MediaStreamTrack` audio do P4-T15/call media owner cấp.
DEV harness có controller microphone riêng để test trước khi P4-T15 hoàn tất. Stop/dispose phải disconnect graph,
stop track do DEV controller sở hữu và `close()` AudioContext; F5 không được stop track do call owner sở hữu.

### 3.2 Contract nội bộ

```ts
type VisemeName = "aa" | "ih" | "ou" | "ee" | "oh";

interface AudioFeatureFrameV1 {
  version: 1;
  epoch: number;
  sequence: number;
  sampledAtMs: number;       // performance timeline, tâm cửa sổ
  durationMs: number;
  rms: number;               // [0,1]
  noiseFloor: number;        // [0,1]
  speechProbability: number; // [0,1]
  onsetProbability: number;  // [0,1]
}

interface AudioVisemeFrameV1 extends AudioFeatureFrameV1 {
  modelId: string;
  speechMass: number;                  // posterior speech đã bỏ blank/silence
  closedMass: number;                  // tổng mass của m/b/p
  visemeMass: Record<VisemeName, number>;
  confidence: number;                  // qAudio semantic, không phải entropy thô
}
```

`AudioVisemeProvider` phải che giấu chi tiết CTC như blank token, spike và vocab riêng của model. Fusion không được
đọc logits/token ID trực tiếp. VAD là chủ sở hữu bằng chứng có tiếng (`speechProbability`); provider chỉ chịu trách
nhiệm shape/closure và chất lượng mapping.

PCM chỉ được sống trong AudioWorklet/inference Worker, không vào React state, diagnostics JSON,
`AvatarPosePacketV1`, localStorage, IndexedDB hoặc log. Main thread chỉ nhận hai contract số ở trên.

`AvatarPosePacketV1` chưa đổi schema trong F5. Packet chỉ chứa expression đã fusion. Nếu P4-T19 cần timestamp
playout riêng, thay đổi protocol phải là task transport có version mới, không lén thêm field trong F5.

## 4. Capture, luồng thread và timebase

AudioWorklet chỉ làm công việc realtime tối thiểu: nhận block, downmix mono, gắn sample clock, tích lũy/copy một
chunk cố định rồi gửi đi. Resample, feature extraction, VAD, rolling context và ORT đều chạy trong dedicated Worker.
Không giả định AudioContext luôn là 48 kHz; Worker resample về `descriptor.sampleRateHz` bằng hàm pure đã test.

Main thread tạo `MessageChannel`, chuyển một port cho AudioWorkletProcessor qua `AudioWorkletNode.port`, port còn
lại cho Worker. Sau handshake, PCM đi thẳng Worklet → Worker và không đi qua callback/main-thread state. Main thread
chỉ khởi tạo, cấu hình, nhận semantic diagnostics và đóng các port khi dispose. Nếu không thiết lập được direct port,
F5 chuyển về webcam-only/VAD-unavailable; không dùng đường PCM vòng qua React làm fallback.

Tại lúc tạo context:

```text
perfOriginMs = performance.now() - 1000 * audioContext.currentTime
sampledAtMs  = perfOriginMs + 1000 * centerFrame / sampleRate
```

Không dùng `Date.now()`. `currentFrame`/sample rate của AudioWorklet tạo sample clock đơn điệu. Khi context
suspend/resume, track đổi hoặc sample clock lùi, tăng `epoch`, xóa buffer và re-anchor timebase; frame epoch cũ
không được fusion với frame mới.

Timestamp dùng khi query audio:

```text
audioQueryMs = faceSampledAtMs + audioAlignmentOffsetMs
```

`audioAlignmentOffsetMs` là config tập trung, seed `0 ms`; chỉ thay đổi sau fixture clap/lip-close đo được offset có
dấu rõ ràng. Diagnostics phải hiện offset, audio timestamp được chọn và delta so với face timestamp.

## 5. VAD local-only

VAD DSP chạy trước model để bỏ inference khi im lặng và tạo silence gate ổn định. Bỏ inference không đồng nghĩa
dừng buffer: Worker vẫn cập nhật rolling PCM history trong silence để onset đầu câu luôn có đủ left context.

Với cửa sổ PCM `x[n]`, bỏ DC rồi tính:

```text
rms      = sqrt((1/N) * Σ x[n]^2 + ε)
levelDb  = 20 * log10(rms + ε)
snrDb    = levelDb - noiseFloorDb
```

Noise floor chỉ thích nghi khi đang non-speech:

```text
noiseFloorDb <- noiseFloorDb + αnoise * (levelDb - noiseFloorDb)
```

Speech probability dùng smoothstep trên SNR, kết hợp spectral flatness/zero-crossing nếu model yêu cầu.
State machine có hai ngưỡng `speechEnter > speechExit`, attack ngắn, release/hangover dài hơn. Không quyết định
bằng một frame. Onset dùng đạo hàm envelope đã giới hạn:

```text
onset = smoothstep(max(0, rmsFast - rmsSlow), onsetLow, onsetHigh)
```

Các threshold là config seed và phải tune bằng fixture silence/quạt/giọng nhỏ/giọng lớn, không hardcode rải rác.

## 6. Model inference và phoneme→viseme

Inference Worker giữ rolling context quá khứ, ví dụ 320 ms, chạy stride 20 ms. Không dùng future audio trong
model baseline để tránh latency ẩn. Output logits được sanitize hữu hạn rồi softmax ổn định:

```text
p_i = exp(z_i - max(z)) / Σ exp(z_j - max(z))
```

Nếu model xuất phoneme, mapping phoneme→năm viseme nằm trong data table versioned, không nằm trong if/else
renderer. Phoneme bilabial `/m,b,p/` map vào `closed`; silence map zero. Phoneme ngoài bảng phân phối vào
viseme gần nhất hoặc `unknown`, không tự map thành `aa`.

Với model CTC, blank cao hoặc posterior nhọn không được phép tự biến thành confidence cao. Provider tính:

```text
entropy  = -Σ p_i log(p_i + ε)
qModel   = clamp01(1 - entropy / log(K))
nonBlankMass    = clamp01(1 - pBlank - pSilence)
mappedPhoneMass = Σ p_i, với i thuộc bảng phone→closed/viseme hợp lệ
qShape          = qModel * nonBlankMass * mappedPhoneMass
qAudio          = speechProbability * qShape
```

`speechMass`, `closedMass` và `visemeMass` được tổng hợp từ posterior trước khi rời provider. Unknown/unmapped mass
làm giảm `mappedPhoneMass`, không bị dồn tùy tiện vào `aa`. Nếu model không phải CTC, provider phải định nghĩa đại
lượng tương đương và chứng minh cùng invariant trong test.

Nonfinite, tensor shape sai, inference quá hạn hoặc sequence đảo phải trả `unavailable`, không tái dùng vô hạn
posterior cũ.

## 7. Jitter buffer và coarticulation

`AudioEvidenceBuffer` là ring buffer timestamp-sorted, giữ tối đa 120 ms evidence gần nhất nhưng **không tạo
intentional lookahead trong F5 V1**. Buffer dùng để hấp thụ jitter scheduling và chọn frame causal gần timestamp,
không được trì hoãn webcam để chờ audio tương lai.

- duplicate `(epoch, sequence)` bị drop;
- frame reversed/stale bị drop;
- gap dài reset interpolation state;
- buffer đầy loại frame cũ nhất, không tăng latency vô hạn;
- lấy evidence tại timestamp face sample, không lấy “frame audio mới nhất” tùy scheduling.

Coarticulation V1 dùng kernel causal ngắn trên posterior, không winner-take-all:

```text
pCoart(t) = projectBudget(0.20*p(t-40ms) + 0.30*p(t-20ms) + 0.50*p(t))
```

Khi thiếu history đầu epoch, chỉ renormalize các trọng số causal đang có. Chuyển viseme dùng posterior liên tục,
không argmax cứng. Audio closure onset được phép attack nhanh hơn vowel nhưng vẫn đi qua F4 mixer. Lookahead
thật sự chỉ được xem xét ở P4-T19/receiver playout, nơi audio và avatar đều có thể bị delay có chủ đích và được đo.

## 8. Fusion webcam + audio

Pipeline thực thi:

```text
MediaPipe -> F1 neutral -> F2/F3 semantic webcam
AudioWorklet -> VAD -> ONNX Worker -> jitter/coarticulation
webcam semantic + audio evidence -> F5 fusion target -> F4 mixer/dynamics -> packet -> renderer
```

Đặt F5 trước F4 để F4 vẫn là temporal owner cuối cùng của expression.

Gọi `W_i` là webcam viseme, `A_i` là audio viseme, `qW` là độ tin cậy face/mouth và `qA` là audio confidence.
F5 V1 chỉ dùng bằng chứng webcam đo được, không bịa confidence từ cảm xúc:

```text
qState    = 1.00 nếu active; 0.45 nếu held; 0 nếu lost/idle
qFresh    = clamp01(1 - faceAgeMs / faceFreshnessWindowMs)
qCoverage = validRequiredMouthChannels / requiredMouthChannels
qW        = clamp01(qState * qFresh * qCoverage)

activeAudioCap = lerp(activeAudioCapLow, activeAudioCapHigh, 1 - qW)
heldAudioCap   = lerp(heldAudioCapLow, heldAudioCapHigh, 1 - qW)
audioCap       = active ? activeAudioCap : held ? heldAudioCap : 0
λ              = clamp01(audioCap * qA)
V_i            = projectBudget((1-λ)*W_i + λ*A_i)
```

Seed để benchmark, chưa phải hằng số cuối: active `[0.12, 0.32]`, held `[0.25, 0.45]` theo thứ tự
`[cap khi qW cao, cap khi qW thấp]`. `qW` tăng thì ảnh hưởng audio bắt buộc không tăng; `qA = 0` phải cho kết quả đúng bằng
webcam trước projection. `projectBudget` chỉ clamp/scale-down khi vượt ngân sách, **không bao giờ scale-up** vector
yếu; vì vậy im lặng hoặc confidence thấp không bị khuếch đại thành chuyển động miệng.

F5 V1 cố ý không cho audio-only tiếp tục hoạt họa miệng khi face đã lost hoàn toàn, vì F4 hiện có lifecycle
hold→return theo toàn khuôn mặt. Cho miệng audio chạy trong khi mắt/mày mất tracking cần region lifecycle riêng;
đó là thay đổi kiến trúc phải review riêng, không lén đưa vào F5.

Silence gate chỉ triệt speech noise yếu, không đóng một biểu cảm miệng rõ/yawn:

```text
qVisible = smoothstep(webcamMouthActivity, visibleLow, visibleHigh)
gSpeech  = max(speechProbability, qVisible)
V_i      = V_i * gSpeech
```

Closure m/b/p:

```text
C_audio = pClosed * qAudio
C_final = max(C_webcam, min(C_audio, closureAudioCapByFaceState))
```

`closureAudioCapByFaceState` là config riêng, không dùng chung `activeAudioCap*` của vowel. Closure cần attack
nhanh hơn nhưng cap active vẫn thấp hơn webcam để model sai không tự khóa môi. `jawOpen` vẫn do webcam sở hữu;
audio chỉ điều khiển viseme/closure. Smile/frown/eyes/brows tuyệt đối không đọc audio ở F5.

Sau fusion, F4 tiếp tục áp closure priority, regional budget, dynamics, loss/reacquire và model profile.

## 9. Module dự kiến

| File | Trách nhiệm |
|---|---|
| `audioLipSyncTypes.ts` | Contract descriptor/feature/viseme, epoch/sequence, validation |
| `audioFeatureMath.ts` | Resample, feature extraction theo provider, RMS, noise floor, VAD/onset pure math |
| `audio-capture.worklet.ts` | Downmix, sample clock, fixed chunk và direct Worker port; không DSP nặng/inference/log |
| `audioInference.worker.ts` | Resample/VAD/features/ORT, rolling history, timeout/fallback |
| `audioVisemeProvider.ts` | Descriptor + semantic provider output + ONNX implementation + unavailable state |
| `audioEvidenceBuffer.ts` | Ordered ring buffer, causal interpolation/coarticulation; zero intentional lookahead |
| `facialAudioFusion.ts` | Pure webcam-authoritative fusion và diagnostics |
| `microphoneController.ts` | DEV ownership/permission/lifecycle; production nhận borrowed track |
| `AvatarRendererDevHarness.tsx` | Toggle F5, provider/backend, VAD/model/buffer/latency panel |

Không đặt DSP, inference hoặc fusion math trong React component/renderer.

## 10. Trình tự triển khai

### F5-0 — Model qualification, chưa chạm pipeline

1. Lập model/license audit; không coi license code nguồn tự động là license của artifact ONNX.
2. Đọc graph/model metadata để chốt descriptor, input/output, size và checksum của từng variant.
3. Viết spike benchmark tách biệt, dùng fixture audio local; chưa nối microphone hay facial pipeline.
4. Benchmark WASM `numThreads=1/2/auto`, rồi WebGPU nếu hỗ trợ.
5. Đo cold load, warm inference avg/p95/max, RAM/VRAM, renderer FPS và tracking→render của toàn ứng dụng.
6. Chạy fixture tiếng Việt và audit mapping unknown/blank/closed/năm viseme.
7. Trình kết quả để chủ dự án duyệt một candidate; nếu không candidate nào đạt thì dừng ở F5 partial.

### F5-1 — Audio capture + privacy lifecycle

AudioWorklet tối thiểu, direct `MessageChannel` tới Worker, resample trong Worker, epoch/timebase,
borrowed/owned track semantics, permission/error/dispose.

### F5-2 — VAD + silence gate

Noise adaptive VAD, onset/hangover, diagnostics chỉ số; chưa bật phoneme fusion.

### F5-3 — ONNX provider

Worker inference, provider state machine `loading/ready/unavailable/error`, backend fallback, self-host asset.

### F5-4 — Jitter/coarticulation

Buffer theo performance timestamp + alignment offset, duplicate/reversed/gap handling, posterior kernel causal
và zero-lookahead latency gate.

### F5-5 — Fusion vào processor

Fusion target trước F4 dynamics, webcam authority, silence/closure cap, reset khi model/session/audio epoch đổi.
F5 không được dùng để che lỗi webcam-only của F4: mọi regression phải test với F5 OFF trước. F5-0…F5-4 có thể
tiến hành độc lập; trước manual acceptance cuối của F5 phải khóa lại baseline/manual issue còn mở của F4.

### F5-6 — DEV diagnostics + webcam gate

Panel hiển thị VAD, audio confidence, five viseme + closed posterior, selected timestamp, buffer depth,
inference p95, fusion λ và fallback reason. Không hiển thị/lưu waveform hoặc PCM.

## 11. Automated test gate

### Math/property tests

- resample giữ tần số và không sinh NaN ở silence/zero/clip;
- VAD hysteresis không chatter quanh threshold;
- noise floor không học giọng nói thành noise;
- posterior luôn hữu hạn, không âm, tổng bằng 1 trong sai số;
- CTC blank cao hoặc mapped-phone mass thấp không được tạo `qAudio` cao;
- fusion output trong `[0,1]`, tổng vowel không vượt budget;
- `projectBudget` không scale-up vector dưới budget;
- `qW` tăng thì audio influence không tăng; `qA=0` trả đúng webcam trước projection;
- vowel cap và closure cap độc lập, thay đổi closure không đổi vowel authority;
- silence triệt low-level vowel noise nhưng không triệt mouth pose mạnh;
- audio closure không tác động eye/brow/smile/frown;
- kết quả tương đương ở render 15/30/60 FPS với cùng audio sample timeline.

### Temporal/buffer tests

- out-of-order, duplicate, reversed timestamp, epoch reset, gap và overflow;
- coarticulation chỉ đọc `t`, `t-20`, `t-40`, không đọc/chờ future frame;
- rolling PCM history vẫn tiếp tục trong silence dù inference bị skip;
- `audioAlignmentOffsetMs` có dấu đúng và chọn frame theo `faceSampledAtMs + offset`;
- suspend/resume không trộn hai timebase;
- inference result cũ/timeout không được phát lại;
- audio unavailable trả pipeline đúng F3/F4, không snap.

### Lifecycle/privacy tests

- borrowed call track không bị F5 stop;
- DEV-owned track stop đúng một lần; AudioContext/Worker dispose idempotent;
- permission denied/track ended/model fail có error ổn định;
- PCM Worklet→Worker không đi qua main-thread handler/React state;
- `AvatarPosePacketV1`, diagnostics export, console hooks và storage không chứa PCM/waveform;
- production build không tải model từ domain ngoài.

### Regression

- toàn bộ F1–F4 tests tiếp tục xanh;
- cười mỉm/cười hở, m/b/p và blink model 2 không tái phát lỗi raw morph;
- Filter OFF/face loss/reacquire giữ contract F4.

## 12. Manual acceptance F5-A1…A14

| ID | Thao tác | Kết quả bắt buộc |
|---|---|---|
| A1 | Im lặng 15 giây, mặt neutral | Miệng không rung; VAD không chatter |
| A2 | Nói nhỏ rồi lớn | Mouth activity theo tiếng nhưng không nhảy bậc |
| A3 | “a–i–u–e–o” chậm | Viseme đổi đúng thứ tự, transition liên tục |
| A4 | “ba mẹ, bập bẹ, mập mờ” | Môi khép đúng m/b/p; mắt không nhắm nếu người dùng không chớp |
| A5 | Nói nhanh một câu tiếng Việt | Không trễ tích lũy, không bỏ miệng quá 120 ms |
| A6 | Cười mỉm im lặng | Audio silence không xóa smile |
| A7 | Vừa cười vừa nói | Webcam giữ shape cười; audio chỉ bổ sung speech timing/viseme |
| A8 | Quạt/tiếng gõ bàn, không nói | Không tạo chuỗi vowel giả kéo dài |
| A9 | Tắt/bật mic | Fallback F3/F4 không snap; state reset đúng epoch |
| A10 | Mic permission denied/model fail | App vẫn chạy webcam-only, báo lý do rõ |
| A11 | Mất face nhưng còn audio | F5 V1 tuân thủ face loss return, không mouth-only puppet |
| A12 | Chạy 60 giây với model mạnh nhất | ≥24 FPS; tracking→render avg <100 ms; inference p95 đạt budget |
| A13 | “tôi đang ở trường”, “một người”, “cửa sổ” | ă/â/ê/ô/ơ/ư map ổn định về 5 viseme gần nhất; unknown không tự rơi vào `aa` |
| A14 | Fixture clap và lip-close đã gắn timestamp | Đo được audio–face offset có dấu; chỉnh offset không tạo drift/tích lũy latency |

Mỗi case test model 2 và model 3 trước; F7 mới mở rộng đủ năm model.

## 13. Definition of Done

F5 chỉ DONE khi:

1. model/license/checksum và self-host path đã ghi tài liệu;
2. không có audio egress ngoài MediaStreamTrack WebRTC được sản phẩm cho phép;
3. test math/temporal/privacy/regression xanh;
4. A1–A14 được chủ dự án xác nhận;
5. benchmark đạt NFR-01/NFR-02;
6. docs 02/06/07/10/11 được cập nhật cùng phiên;
7. không commit trước khi chủ dự án xem.

## 14. Quyết định sau review và latency gate

Các required change của review được chấp nhận và khóa thành invariant:

1. fusion thật sự dùng `qW`, cap active/held biến thiên đơn điệu và có test `qA=0`;
2. F5 V1 causal, zero intentional lookahead; future-frame coarticulation chuyển sang P4-T19 nếu có;
3. provider che CTC blank/spike, xuất semantic mass và confidence có `nonBlankMass * mappedPhoneMass`;
4. AudioWorklet tối thiểu; main thread chỉ tạo/chuyển port, PCM đi trực tiếp Worklet→Worker;
5. preprocessing theo provider descriptor, không khóa sẵn 16 kHz/log-mel;
6. budget projection chỉ scale-down, rolling history không dừng khi silence, alignment offset có cấu hình;
7. F5 V1 giữ face-loss lifecycle hiện tại, không tự mở rộng audio-only mouth.

Phản biện duy nhất: **không chấp nhận chọn Uni2005 chỉ vì có ONNX và output framewise**. GPL-3.0, nguồn artifact,
nghĩa vụ redistribute và hiệu năng browser là gate cứng, nên model này chỉ là candidate của F5-0.

Budget steady-state để qualify, không phải phép cộng marketing:

```text
capture/chunk completion p95 <= 20 ms
Worker queue p95             <= 10 ms
model inference p95          <= 25 ms
fusion/F4 CPU p95            <=  3 ms
wait đến render kế tiếp      <= 42 ms tại ngưỡng 24 FPS
intentional lookahead        =   0 ms
------------------------------------------------------
audio evidence -> render     <= 100 ms p95
```

Đồng thời toàn ứng dụng phải giữ `tracking→render < 100 ms` và `>= 24 FPS`. Nếu một backend đạt inference nhanh
nhưng làm giảm hai metric toàn cục thì backend đó fail. Thay đổi seed cap, offset hoặc thread count chỉ được nhận
khi có benchmark trước/sau và không làm hỏng manual gate.

## 15. Nguồn kỹ thuật ngoài dự án

- ONNX Runtime Web browser tutorial: https://onnxruntime.ai/docs/tutorials/web/
- ONNX Runtime Web JavaScript setup/support: https://onnxruntime.ai/docs/get-started/with-javascript/web.html
- ONNX Runtime WebGPU guidance: https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html
- MDN `MediaStreamAudioSourceNode`: https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamAudioSourceNode
- MDN AudioWorklet sample clock: https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletGlobalScope/currentFrame
- MDN `AudioWorkletNode.port`: https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletNode/port
- MDN `MessagePort` transferable: https://developer.mozilla.org/en-US/docs/Web/API/MessagePort
- Uni2005 ONNX model contract/license: https://huggingface.co/KitsuMate/uni2005-onnx
- Allosaurus source license: https://github.com/xinjli/allosaurus/blob/master/LICENSE
- Vietnamese wav2vec2 160h artifact: https://huggingface.co/khanhld/wav2vec2-base-vietnamese-160h/tree/main
- Vietnamese wav2vec2 250h model card/license: https://huggingface.co/nguyenvulebinh/wav2vec2-base-vietnamese-250h
