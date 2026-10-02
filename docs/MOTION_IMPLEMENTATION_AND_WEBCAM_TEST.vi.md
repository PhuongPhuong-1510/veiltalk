# Bản triển khai chuyển động tay và lượt test webcam đầu tiên

> Có đợt triển khai tiếp: [depth fusion, body-local barrier và rig-local DOF](MOTION_DEPTH_CONTINUATION.vi.md). Bảng dưới giữ trạng thái đợt đầu; J/L/S/V và bộ test đã được bổ sung tiếp, vẫn chưa nghiệm thu A–Z.

Ngày 02/10/2026. Nền trước thay đổi: VeilTalk `5df5ee8ec6a8f62581844a17af0d886608527004`. Thay đổi hiện nằm trong working tree; không sửa XR. Kế hoạch gốc: [A–Z](XR_VEILTALK_MOTION_REVIEW.vi.md), [ma trận kỹ thuật](XR_TECHNIQUE_MATRIX.vi.md).

## Mở bản chạy thử

- Trang có đủ công tắc, diagnostics, ba model trở lên và replay: **http://127.0.0.1:5173/dev/avatar-renderer**.
- Trang webcam đơn giản, cũng có trong production build: **http://127.0.0.1:5173/avatar/motion**.
- Bản production build đang được phục vụ local tại **http://127.0.0.1:5174/avatar/motion**. Khởi động lại bằng `npm.cmd run preview -- --host 127.0.0.1 --port 5174 --strictPort` nếu cần.
- Vite đang chạy local. Nếu dừng phiên server, chạy `npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort` trong `C:/project/veiltalk/frontend`.

Không cần backend để test hai trang này. Production preview mới là local camera → processor → renderer; chưa phải hệ thống gọi video/remote hoàn chỉnh. Chưa deploy ra ngoài máy.

## Code đã thay đổi

1. **Partial-arm và chiều dài quan sát:** giữ `armFrameSolver` là đường hình học chính thức. Dùng chiều dài tạm từ các mẫu quan sát thật khi chưa đủ tám mẫu calibration; không giả vờ đã calibrated hoặc cho inferred wrist chạy vô hạn. Upper arm được đo riêng khi shoulder/elbow thật còn hợp lệ; lower length không lấy từ reconstructed wrist. Các mask SEW, SE-, S-W, -EW, S--, -E-, --W, --- được phân loại theo evidence thật, độc lập việc geometry có giải được hay không.
2. **Provenance/depth:** có hemisphere history theo anchor elbow/shoulder, timestamp và confidence; history suy dựng không tự gia hạn niềm tin mãi. Reset khi camera/clock/model mất hiệu lực. Diagnostics thêm depth sign/ambiguity, eligibility và số mẫu calibration. Bend anchor đã có không bị nghiệm dựng wrist ghi lại như quan sát thật.
3. **Twist/contact wiring:** dùng matcher quality, assigned-side handedness compatibility và projection quality từ absolute-rig solver. World landmarks bàn tay và side sau matching được truyền vào contact orientation. Unknown handedness không bị coi như label trái ngược đáng tin.
4. **Giới hạn quaternion:** `q` và `-q` cho cùng rotation khi clamp. Trong vùng gần 180°, arm solver truyền target cũ để giữ nhánh giới hạn qua nhiễu nhẹ. Đây vẫn là giới hạn tổng góc; chưa biến thành elbow hinge/shoulder cone theo mọi DOF.
5. **Lọc wrist-relative thử nghiệm:** `HandLandmarkConditioner` lọc shape trong đơn vị palm width, giữ wrist hiện tại và dữ liệu raw bất biến. Tách image/world filters, reset khi identity/gap/aspect mất hiệu lực. Chưa bật mặc định trước webcam A/B.
6. **Endpoint theo rig thử nghiệm:** chuẩn hóa reach người → tổng chiều dài rig, giải IK bảo toàn L1/L2 và bend hemisphere. Chỉ chạy ở nhánh đủ observed joints; partial-arm, calibration và raw landmarks không bị thay bằng nghiệm retarget. Chưa có camera reprojection objective đầy đủ hoặc nghiệm thu endpoint trên skin thật.
7. **Quyền correction:** packet có ownership policy tùy chọn. Contact chỉ sở hữu chain khi enabled correction thực sự thay pose; renderer không sửa clearance/inter-arm lại chain đó. Có A/B bỏ renderer damping trên arm. Khi clearance đổi hướng upper/lower, renderer giữ hướng world của palm thay vì vô tình quay palm theo correction.
8. **Hai tay:** thêm bounded palm convergence cho mode `palmsTogether` đã xác nhận, confidence/freshness đủ, cả hai arm observed và không đang body contact. Dùng probe từ rig, budget theo dt, exact lengths, reject unreachable hoặc làm body collision nặng hơn. Chỉ loại trừ cặp hand↔hand có intentional contact; các cặp forearm/upper vẫn được xét. Không thay fingers bằng preset. **Chưa có fingertip IK hoặc interlace collision mesh hoàn chỉnh.**
9. **Replay/đo:** thu raw input thực sự vào solver, packet, arm/contact/finger/bimanual diagnostics, tracking metrics và FK normalized/raw skin với sequence riêng. Nạp/export JSON, playback giữ offset/age giữa các detector, bounded catch-up, giới hạn file. Offline A/B baseline sau sửa nền, conditioning và rig endpoint. Step RMS chỉ dùng như jitter khi scene thực sự static; không là accuracy hoặc latency đầu–cuối.
10. **Lifecycle/sản phẩm:** camera restart giữ neutral còn hợp lệ của cùng người/rig; model change vẫn reset rig-dependent state. Processor trong harness được tạo một lần, và toggle simulated loss không tạo lại camera pipeline vì callback đổi identity. Local webcam preview đã nối ngoài DEV, lazy-load riêng khỏi màn hình đăng nhập.

File chính mới: `handLandmarkConditioning.ts`, `wristDepthMemory.ts`, `rigAwareArmEndpoint.ts`, `motionOwnership.ts`, `bimanualPalmAssist.ts`, `motionReplay.ts`, `motionBenchmark.ts`, `syntheticMotionRecording.ts`; `MotionReplayPanel.tsx`, `AvatarMotionPreview.tsx`, `scripts/audit-motion-rigs.mjs`. Processor, solver, renderer và harness hiện hữu đã được nối với các module đó.

## Kiểm chứng

- Baseline trước sửa: 906/914 test đạt, tám lỗi. Sáu lỗi processor gồm ba case reconstruct dùng prior sai lúc chưa đủ calibration, fixture yaw khác convention, fixture calibration chỉ có ba mẫu thay vì tám và assertion đòi palm candidate branch không chạy. Hai fixture bimanual thiếu `valid`.
- Sau thay đổi: **942 test đạt trên 113 file**; build TypeScript + Vite đạt. Log: [test](motion-review/implementation-tests.log), [build](motion-review/implementation-build.log).
- Các regression mới kiểm observation/reconstruction calibration riêng, tám availability masks, neutral camera restart, quaternion equivalence/antipodal continuity, shape translation/duplicate/gap, depth lifetime, contact ownership, inter-arm exclusions, palm budget/length/body clearance và replay input/clock validation.
- `npm.cmd run motion:audit`: ba file VRM thật, mỗi model đủ 30 finger joints; sáu scene tổng hợp/model, ba biến thể/scene không tạo quaternion không hữu hạn. [Kết quả](motion-review/rig-audit-and-synthetic-benchmark.json). Audit đọc **raw rest graph**, không load normalized skin/WebGL; không gọi kết quả này là nghiệm thu webcam ba VRM.
- HTTP đã kiểm route, transform các module UI, model VRM, ba task models và JS/WASM đều 200: [log](motion-review/http-smoke.json). Đây không phải kiểm chứng UI bằng trình duyệt. Browser của môi trường không có instance khả dụng; chưa chụp screenshot, chưa thao tác camera hoặc xem mesh rendered.
- Sau restart, cả hai route DEV và route production/lazy bundle trả 200, COEP/COOP đúng cấu hình: [HTTP cuối](motion-review/final-http-smoke.json). [Manifest triển khai](motion-review/implementation-manifest.json) lưu SHA-256 của 38 file frontend thay đổi, HEAD nền và giới hạn kiểm chứng.
- Lint không có error ở lượt kiểm đã chạy; repository còn warnings có từ trước, chủ yếu irregular whitespace ở source cũ. Build có cảnh báo chunk lazy của tracking/VRM lớn; chưa đo startup trên máy yếu.

Các ngưỡng jitter/contact/latency trong kế hoạch vẫn là đề xuất. Chưa có dữ liệu để nói XR hoặc VeilTalk tốt hơn bao nhiêu. Trong công cụ A/B, “baseline” là **VeilTalk sau các sửa nền của đợt này**, không là code nguyên trạng ở HEAD cũ.

## Test webcam theo thứ tự

1. Mở trang DEV, chờ avatar tải, bấm **Start tracking**. Tắt Freeze current và Simulate loss khi thu cảnh bình thường. Giữ cả vai/khuỷu/cổ tay trong khung; căn chỉnh neutral khi cần.
2. Thu `static`: bấm **Bắt đầu thu**, căn chỉnh neutral lại nếu cần rồi giữ pose khoảng 10 giây; **Dừng thu**, **Xuất replay JSON**. Bắt đầu thu reset processor để có trạng thái đầu xác định. Thu từng scene riêng; recorder tự dừng trước giới hạn dung lượng file.
3. Bấm **So A/B tracking tay** để so processor trên cùng observation. Phát lại với từng công tắc để kiểm hình ảnh: giữ Dynamics/filter, constraints, twist và continuous fingers như baseline; bật riêng **Wrist-relative hand filter (A/B)**, sau đó thử riêng **Rig-aware wrist reach (A/B)**. Đánh giá cả độ trễ và fidelity; bộ lọc làm tay đứng yên sai pose không được coi là tốt hơn.
4. Thử riêng **Arm temporal at processor (A/B)** để đánh giá damping kép. Khi contact sửa chain, ownership đã buộc renderer tôn trọng chain đó dù công tắc này tắt.
5. Thu `overhead`, `depth`, `partial-arm`, `fingers`, `crossing`; thử mất riêng wrist, mất riêng elbow, palm edge-on, thumb, pinch, point, peace, tay duỗi gần camera. Đổi ít nhất ba VRM và ghi model đi cùng replay.
6. Khi baseline wrist/open hand ổn, thử **Apply AR9 correction** ở forehead/headTop/chest rồi sau đầu/gáy. Đối chiếu cảnh `near-face-no-contact` riêng để phát hiện hút tay sai. Giữ contact opt-in; không dùng nó để che endpoint baseline còn sai.
7. Thử riêng **Palms-together assist (A/B)** khi chắp tay. Continuous fingers phải bật. Clasp/interlace/heart vẫn dùng continuous preservation hiện hữu; palm assist mới chỉ áp mode palmsTogether. Body contact ưu tiên hơn palm assist.
8. Xuất replay cảnh tốt và lỗi, kèm A/B JSON khi có. File đã chứa config/model/source hash và diagnostics. Source hash thuộc server-start/build; restart Vite sau khi sửa code trước khi thu benchmark chính thức để tránh gán hash cũ cho HMR mới.

Khi phát lại live trong harness, chọn cùng model và các công tắc muốn thử; imported metadata không tự đổi avatar hoặc bật contact. FK thu ở input tick có thể thuộc draw trước đó; luôn đối chiếu `finalPose.sequence` với packet sequence, không gán nhầm thành FK của packet vừa phát.

## Trạng thái A–Z và phần chưa được nghiệm thu

| Bước | Đã làm | Còn lại/điều kiện |
|---|---|---|
| A | HEAD nền, source hash, config/model trong recording, audit SHA model, log test trước sửa | Khóa runtime XR thật và recording cùng điều kiện |
| B | Phân loại/sửa tám test lỗi, thêm regression; suite đạt | Theo dõi failure webcam có thể vượt phạm vi fixture |
| C | Recorder/import/playback, scene labels, fixture geometry | Người dùng thu scene webcam thật, duplicate/stale/FPS trên máy mục tiêu |
| D | Arm/contact/finger/bimanual/clock metrics, normalized và skin FK theo sequence | Camera reprojection/alignment và metric contact sau final skin FK |
| D2 | Đã có công cụ và source references để đối chiếu | **Chưa benchmark XR đầu–cuối cùng video**; không đánh dấu M0 hoàn tất |
| E | Clock rebase, input validation, camera reset, depth history lifetime, existing coordinate tests | Camera mirror/aspect/restart thực tế |
| F | Audit raw skeleton ba VRM thật; rig/profile từ runtime lưu trong replay | Normalized/skin FK, collider fit và acceptance ba model trong browser |
| G | World/side/quality wiring, provenance calibration, hemisphere state | A/B source switches và depth ambiguity thật |
| H | Canonical solver giữ nguyên; classifier tám mask nối caller thật; tests partial/loss | Scene -EW/--- dài trên webcam vẫn conservative hold/return, không thêm geometry solver thứ hai |
| I | Conditioning module + wiring + toggle + tests + offline A/B | Webcam jitter/pinch/edge-on/latency gate trước default |
| J | Depth hemisphere hữu hạn, observed/provisional length semantics | Adaptive shoulder/palm scale và fusion cue cần số đo; chưa thêm cue giả hoặc metric-depth claim |
| K | Rig reach objective opt-in, exact lengths, singularity fallback | Full endpoint objective với camera projection, đa rig/skin acceptance |
| L | Sửa quaternion hemisphere/antipodal instability | **Chưa triển khai đủ anatomical DOF hinge/cone**; cần xác nhận axes và baseline raised-palm trước thay constraints |
| M | Giữ twist/swing, nối projection/side quality, neutral restart regression | Webcam pronation/±π và wrist flexion trên ba model |
| N | Conditioning trước palm/angles; giữ continuous solver, diagnostics, raw-preserving tests | Ground truth finger angles/FK, consensus/assist false curl trên webcam |
| N2 | Offline A/B và raw-rig synthetic reports | **Chưa đạt baseline webcam gate trước contact default** |
| O | Ownership contract caller→packet→renderer, protected chain, damping A/B, palm world preservation | Final contact normal/anchor sau skin transfer và release không snap |
| P | Rig-scaled colliders hiện hữu, dimensions trong rig/audit/diagnostics | Fit head/tóc/áo/chibi bằng visual overlay/mesh clearance; chưa tự tune theo mesh |
| Q | Contact world orientation đã được nối | Occlusion/scale depth cues phải được đo độc lập; mixed detector-z scale còn cần xác thực |
| R | Contact code hiện hữu được nối metadata/ownership; opt-in thử được | Webcam contact vùng trước, precision/false attraction, final normal/error |
| S | Posterior surfaces hiện hữu + depth memory/partial continuation, scene replay | Webcam sau đầu; giới hạn prediction khi tay bị che hoàn toàn |
| T | Matching giữ nguyên, raw candidates/side quality, mask/exclusion/contact-owned regressions | Crossing identity/depth ordering thật, không tự coi candidate index là identity |
| U | Bounded palmsTogether IK assist + body clearance + hand-pair exclusion; continuous fingers giữ nguyên | **Chưa có fingertip IK/physical interlace**; phải đo fidelity/gap trên model thật |
| V | Filter ablation, processor vs renderer temporal switch, static step metrics | Static-vs-moving jitter/latency acceptance; scale adaptation/stickiness chưa bật thiếu evidence |
| W | Có inference/long-task/stale-age metrics hiện hữu và recording; không thêm worker vô căn cứ | Profile webcam; chỉ triển khai worker/crop/compensation nếu đáp ứng trigger của kế hoạch |
| X | Local preview ngoài DEV đã build; packet ownership tùy chọn tương thích packet cũ | Call/remote transport và retarget/contact semantic phía nhận chưa được nối |
| Y | Raw model audit + synthetic suites + reports | Cùng XR/webcam, ba model rendered, hai nhóm hardware, remote/performance acceptance |
| Z | Feature toggles/rollback từng thử nghiệm, source hash, test/build/audit logs, hướng dẫn test | Chỉ đổi defaults sau webcam gate; chưa đánh dấu DONE A–Z |

Đây là bản triển khai trước lượt webcam đầu tiên. Không suy ra “A–Z hoàn tất” từ test xanh, raw-rig audit hoặc việc các công tắc đã tồn tại. L, full J/K, fingertip U, worker W, remote X và benchmark D2/N2/Y vẫn có công việc kỹ thuật sau số đo; không phải chỉ còn thao tác xác nhận của người dùng.

## Chạy lại kiểm chứng

Trong `C:/project/veiltalk/frontend`:

```powershell
npm.cmd test -- --reporter=dot
npm.cmd run build
npm.cmd run lint
npm.cmd run motion:audit
```

Các thử nghiệm mới mặc định tắt: conditioning, rig endpoint, processor-only arm temporal, body-contact correction, palms-together assist. Core fixes về provenance, quality wiring, observability và quaternion continuity đã áp dụng. Constructor continuous-fingers vẫn giữ default cũ; hai trang thử chủ động bật continuous-fingers từ đầu.
