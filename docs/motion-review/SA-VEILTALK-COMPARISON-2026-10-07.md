# Đối chiếu VeilTalk với System Animator — 2026-10-07

## Phạm vi và mức bằng chứng

Đối chiếu source đang có trong workspace với `C:/project/SystemAnimatorOnline/js/SA_system_emulation.readable.js` và tài liệu `VeilTalk_Tong_hop_System_Animator_FULL_ALGORITHMS.docx`. Đây là audit đọc code, chạy frontend tests và build; không phải benchmark webcam hoặc thử nghiệm A/B giữa hai sản phẩm.

- `[VEILTALK-PROVEN]`: cơ chế đã thấy trong source, bao gồm caller và configuration liên quan.
- `[SA-PROVEN]`: cơ chế đã thấy trực tiếp trong file SA được cung cấp.
- `[DOC-ONLY]`: đề xuất/diễn giải trong tài liệu, chưa coi là implementation SA.
- `[INFERENCE]`: hệ quả kỹ thuật cần kiểm chứng bằng replay hoặc webcam.
- `[UNKNOWN]`: chưa có số đo hoặc chưa trace đủ dependency.

Các từ “tốt hơn” dưới đây chỉ dùng cho đặc tính cụ thể của implementation đã đọc. Không suy ra VeilTalk mượt hơn, chính xác hơn hoặc nhanh hơn SA trên webcam. Chưa audit mọi subsystem của SA.

## Kết luận

VeilTalk đã có phần lớn cơ chế cốt lõi trong tài liệu: camera frame gate, backpressure không backlog, timestamp từng nguồn, visibility hysteresis, geometry checks, semantic filters, shoulder calibration/clamps, Pose–Hand arbitration, elbow solution circle/candidates, depth fusion, reach projection, contact anchors/FSM, twist unwrap và temporal ownership.

Không nên thay solver hiện tại bằng SA. Giá trị tiếp theo nằm ở đo profile tích hợp, bổ sung policy còn thiếu, và phối hợp các lớp correction đã có.

## Profile thực sự đang được bật

`frontend/src/lib/avatar-motion/integratedMotionProfile.ts` bật depth fusion, rig-aware endpoint, elbow branch switching, Pose/Hand conditioning, Hand worker/ROI/adaptive confidence, temporal cấp arm, contact correction và face contact research. `frontend/src/components/avatar/AvatarMotionPreview.tsx` áp dụng profile qua setters, dùng webcam 720p/full-rate/GPU. Route `/avatar/motion` được khai báo trong `App.tsx`.

Constructor `AvatarMotionProcessor` tự thân mặc định tắt nhiều tính năng này. Vì vậy không được dùng default constructor trong tests/replay để kết luận về profile webcam tích hợp. Chưa xác minh pipeline avatar đã được nối vào mọi luồng cuộc gọi hoặc truyền mạng.

## Coverage matrix

| Cơ chế | SA tham khảo | VeilTalk hiện tại | Đánh giá và hành động |
|---|---|---|---|
| Frame readiness/identity | Video-ready guard; duplicate gate có điều kiện, frame ID định lượng 30 Hz | `requestVideoFrameCallback`, media timestamp; RAF fallback loại timestamp trùng | `ALREADY_GOOD`: frame identity hiện đại; chưa chứng minh latency tốt hơn |
| Latest frame/backpressure | Busy thì bỏ lượt | Chỉ schedule callback kế tiếp sau xử lý; một frame in flight | `DIFFERENT_BUT_EQUIVALENT`: không backlog; Hand chậm có thể kéo chậm nhịp toàn pipeline |
| Tracker parallelism | Có worker lifecycle và enable/exclusion logic | Hand worker chạy cùng Face/Pose, immutable snapshot, timeout/fallback, loại stale result | `ALREADY_GOOD`: có tests; Face/Pose vẫn đồng bộ trên main thread |
| Pixel budget | Resize theo diện tích, giữ aspect; crop/mirror/portrait | Capture 720p/480p; Hand ROI riêng; Face/Pose nhận video hoặc snapshot nguồn | `PARTIAL`: chưa có budget preprocessing chung tương đương SA cho Face/Pose |
| Camera transform metadata | Nhiều flip/portrait flags trong camera layer | Có kích thước nguồn, Hand ROI mapping; raw frame chưa có cropRect/mirror/rotation context chung | `PARTIAL`: desktop hiện tại có thể đủ; mobile/rotation cần thiết kế thêm khi có nhu cầu |
| Timestamp/freshness | Pose/Hand timing riêng | Sample time từng nguồn, phân biệt tracked/lost/not-sampled, duplicate và epoch reset | `ALREADY_GOOD`: giữ |
| Detected vs stable | Có `data_detected_stable` | Joint hysteresis, recovery confirmation, matching confirmation, calibration và source transitions | `DIFFERENT_BUT_EQUIVALENT` một phần: nhiều gate theo nhiệm vụ, không cùng global gate SA; startup cần đo |
| Effective confidence | Model score adjustment và state-dependent behavior | Visibility, bounds, geometry, age, matching, disagreement, depth quality | `ALREADY_GOOD` về cấu trúc; `NEEDS_MEASUREMENT` về calibration xác suất |
| Shoulder/torso | Derived shoulder tilt, semantic filter, clamp; adaptive spine/body bend | Neutral calibration, torso basis, shoulder rotation/translation, ear/nose/torso-length cues, lean suppression, temporal/clamps | `ALREADY_GOOD`: chi tiết phù hợp VRM hơn; chưa chứng minh jitter ít hơn |
| Axis-specific trust | Giảm contribution Z trong shoulder width/body bend | Pose Z conditioning riêng, depth ambiguity và geometry gates | `ALREADY_GOOD`; latency tích lũy cần đo |
| Pose–Hand wrist fusion | Correction theo Hand history/decay/hysteresis | Source arbitration theo disagreement, confirmation, freshness; 2D→3D reconstruction và reacquire blend | `DIFFERENT_BUT_EQUIVALENT`: không cần ép thành cùng công thức linear fusion |
| Arm retarget | Extension ratio map theo avatar arm length | `retargetArmEndpoint`: normalized reach, chiều dài từng đoạn rig, two-bone reach projection | `ALREADY_GOOD`: đã có; giữ safeguards gần duỗi thẳng |
| Elbow candidates | Đã thấy elbow/body geometry; chưa chứng minh SA có catalog scorer đúng như đề xuất tài liệu | Scan 24 góc, thêm continuation/refinement, history/Hand/anatomy/face/head/torso penalties | `ALREADY_GOOD`: không thiếu candidate generator; không gọi đây là SA-proven algorithm được copy |
| Quyền đổi elbow branch | SA có điều chỉnh arm theo body/contact | Tracking solver chỉ đổi khi Hand mới đủ phân biệt, score margin và 3 sample xác nhận | `PARTIAL`: bảo vệ chống flip tốt, nhưng collision đơn độc không đổi branch; cần đo ca bị kẹt |
| Partial-arm fallback | Có 3D/2D/history/fallback nhiều nhánh | Upper/lower valid độc lập, infer elbow từ S/W, reconstruct wrist, history timeout | `ALREADY_GOOD` cho các ca đã trace; chưa chứng minh complete Pose-2D-only fallback tương đương SA |
| Reject không poison filter | Có reuse/hold filter state | Reject geometry trước direction/pole filters; depth/hand quality gates; duplicate không advance | `ALREADY_GOOD` cho các gate đã kiểm tra; Pose Z prefilter chưa biết các rejection downstream, nên không bảo đảm mọi outlier đều bị chặn trước mọi filter |
| Palm/shoulder depth | Apparent size normalized; depth/value weight riêng | Palm ratio, projection compensation, 8 stable calibration samples, bounded cue weight, contradiction checks | `ALREADY_GOOD`: có safeguards cụ thể hơn nhánh SA đã đọc |
| Depth freshness | Fade sau khoảng 0.2 s đến 1 s | Cue age/decay; không gia hạn cue bằng sample edge-on; clock reset | `ALREADY_GOOD`: đã có và test |
| Depth lúc elbow/wrist yếu | SA dùng depth trong nhiều state-dependent nhánh | `depthObjective` suspend khi thiếu observed S/E/W hoặc source wrist reconstructed | `PARTIAL`: conservative; chưa tận dụng palm-depth trong ca elbow occlusion, cần thiết kế theo uncertainty |
| Reach constraint | Clamp Z/length sau fusion/transform | Length-preserving contact IK; endpoint projection; diagnostic reach quality | `ALREADY_GOOD`: có cả min/max reach |
| Offscreen vs lost | `off_screen_allowed` ảnh hưởng return/default ownership | Có rejection reason bounds và observability mask; temporal vẫn active/held/returning/recovering/idle | `PARTIAL`: có phân biệt diagnostic nhưng thiếu policy offscreen riêng tương đương SA |
| Whole-arm lifecycle | Nhiều channel cùng blend về default motion | Segment temporal độc lập, twist geometry gate, wrist source reacquire, contact ownership | `PARTIAL`: phối hợp nhiều nơi; chưa phải một policy duy nhất cho toàn bộ shoulder/arm/wrist/twist/fingers |
| Contact weight/hysteresis | Continuous magnet falloff và validation memory | Detector-clock FSM approach/near/touch/hold/slide/release; visual influence riêng | `ALREADY_GOOD`: state và evidence clock rõ, không acquire từ sample trùng |
| Contact anchor/geometry | Point/line/plane/bone/object; fingertip compensation | Body regions/local anchors, palm/radial/ulnar/index probes, posed rig, face skin binding/refinement | `ALREADY_GOOD` cho body/face; generic prop/line/compound contacts ngoài phạm vi hiện tại |
| Contact→elbow | Filter transformed-minus-original rồi bias upper arm | Contact re-solves chain bằng two-bone IK và 20 pole candidates chấm collision/continuity | `DIFFERENT_BUT_EQUIVALENT` về tác động cả chuỗi; `PARTIAL` về feedback chung: chưa truyền ΔWrist/surfaceNormal vào tracking elbow scorer |
| Wrist rotation disagreement | Relative quaternion angle giảm Pose weight | Wrist swing rejects excessive axis disagreement; twist confidence và stabilization riêng | `DIFFERENT_BUT_EQUIVALENT` một phần: không thấy fusion đầy đủ hai wrist quaternions theo công thức SA trong nhánh đã trace |
| Twist decomposition/continuity | Twist bone + residual wrist; scalar history freshness ~250 ms | Forearm twist owner riêng, wrist swing riêng, rig calibration, scalar unwrap, epoch reset giữ neutral | `ALREADY_GOOD`: abstraction phù hợp VRM; timeout không giống SA, gap trung bình cần replay |
| PRE/IK/POST ownership | `after_IK`/priority, contact transforms trước MMD IK, wrist sau | Tracking arm solve → twist/swing → contact re-solve → renderer collision/fingertip → final face refinement | `PARTIAL` về phối hợp; không tự reorder: contact là IK solve thứ hai, final skin refinement có lý do |
| Duplicate smoothing | Nhiều semantic/interpolation layers | Ownership bypass renderer smoothing cho processor-owned arm, upper body, face/gaze | `ALREADY_GOOD` về tránh lọc trùng renderer; nhiều layer upstream vẫn cần latency audit |
| Diagnostics/tests | Global-state integration trong file đã đọc | Typed source/provenance/observability, scores, rejection, correction quality, rendered gaps, replay/ablations | Có lợi thế về inspectability/testability trong phạm vi source được cung cấp; không kết luận SA toàn repo thiếu tests |

## Bằng chứng source chính

- Camera/scheduler: `frontend/src/lib/tracking/trackingPipeline.ts:168`, `:186`, `:273`; `cameraController.ts`; `parallelHandPipeline.test.ts`. SA khoảng 2769–3000 và 17300–17355.
- Configuration đang bật: `frontend/src/lib/avatar-motion/integratedMotionProfile.ts:4`; `frontend/src/components/avatar/AvatarMotionPreview.tsx:24`.
- Elbow scan và gate: `armFrameSolver.ts:604`, `:675`, `:787`, `:805`; config count 24 và confirm 3 tại `motionConfig.ts:1480`; tests fresh/discriminating Hand và shadow mode trong `armFrameSolver.test.ts`.
- Depth: `armDepthFusion.ts`, `armDepthFusion.test.ts`; caller `avatarMotionProcessor.ts:1533`. SA khoảng 6910–6970 và 7500–7555.
- Contact chain: `contactPoseCorrection.ts:102`, `:131`, `:245`; `contactArmIk.ts`; `contactWristTarget.ts`; `contactTemporal.ts`. SA generic contact khoảng 7930–8732, correction→upper-arm khoảng 9089–9145.
- Final ordering/ownership: `avatarMotionProcessor.ts:872`, `:1217`, `:1233`; `avatarRenderer.ts:469`, `:556`; `motionOwnership.ts`.
- Twist: `handTwistStabilization.ts`, `handTwistTemporal.ts`; `avatarMotionProcessor.ts:1722`; SA `It` khoảng 8733–8953.
- Confidence/shoulder: `shoulderMotionSolver.ts`, `torsoLeanSolver.ts`, `upperBodyTemporal.ts`, `poseDepthConditioning.ts`, `wristEvidence.ts`.

## Điểm nên làm tiếp, theo thứ tự

1. **Đo profile tích hợp đang bật.** Thu replay static, fast arm, S/W rõ–E bị che, contact enter/slide/release, offscreen/reacquire, gần/far camera. Đo raw tracking, packet và rendered FK/skin; FPS, sample age, processor/renderer p95 và latency đầu–cuối. A/B tắt từng cải tiến; không dùng ít chuyển động làm thước đo chính xác.
2. **Đồng bộ benchmark với profile.** `compareMotionRecording` hiện là feature ablations và cố ý tắt contact; `compareFaceContactRecording` không bật đầy đủ flags của integrated profile. Thêm một variant explicit integrated có config snapshot; vẫn giữ baseline riêng để so sánh.
3. **Định nghĩa policy offscreen và partial evidence.** Dựa trên bounds/observability có sẵn; giữ upper tốt khi lower mất, nhưng cần quy tắc chung cho twist/wrist/fingers. Không mặc định tăng hold mọi trường hợp.
4. **Đánh giá elbow/contact bị kẹt.** Tracking scorer có collision penalties nhưng branch switch cần Hand. Contact solver đã có collider-driven candidates riêng. Chỉ thêm feedback semantic/constraint nếu replay cho thấy các solver đang xung đột; không nới branch switching thành chọn score thấp nhất tùy ý.
5. **Thử depth trong elbow occlusion có kiểm soát.** Tách calibrated human length khỏi current observed elbow; dùng S/W, cached palm cue, uncertainty, freshness và reach. Không biến inferred joint thành observation.
6. **Tối ưu scheduler/preprocess khi số đo chứng minh cần.** Common budget cho Face/Pose; xem xét publish Face/Pose không chờ Hand, vẫn giữ timestamp đồng bộ và association gates. Hiện worker age gate 150 ms không đảm bảo mục tiêu latency <100 ms.

Không nên copy MMD bone hacks, generic priority, exact SA constants hoặc thêm smoothing đại trà. Không cần mang generic object/line magnets vào sản phẩm nếu chưa có nhu cầu prop contact.

## Câu hỏi cần trả lời bằng evidence

- S/W rõ nhưng E mất: hình học mới thật sự phân biệt được elbow branch hay chỉ scorer thích một pose nhìn hợp lý?
- Collision/contact correction ở processor và renderer có kéo chain về hai nghiệm khác nhau không? Candidate margin, penetration và final rendered gap thay đổi thế nào?
- Palm-depth suspend trong partial observation là bảo vệ hữu ích hay làm mất evidence đúng lúc cần nhất?
- Khi Hand worker mất 80–150 ms, Face/Pose age và FPS cuối ra sao? Có cần decouple publication không?
- Mỗi filter đang loại noise nào; phase lag riêng của Pose Z, direction/pole, temporal arm, twist và contact là bao nhiêu?
- Dữ liệu replay đang chạy cùng flags với preview không? Có benchmark cuối renderer trên nhiều avatar/người/phiên không?

## Validation lần audit này

- `npm.cmd test -- --reporter=dot`: **132/132 test files; 1060/1060 tests pass**.
- `npm.cmd run build`: **pass**, gồm `tsc -b` và Vite production build. Vite có cảnh báo chunk lớn; không phải build failure hoặc số đo runtime latency.
- Có tests cho timing/duplicate/worker fallback, expired depth, calibration invariance, inferred elbow branch confirmation, stale pole, geometry rejection, contact IK, twist ±π và một số hành vi ở 15/30/60 FPS. Không suy ra toàn bộ ma trận tình huống webcam đã được nghiệm thu.
- Không sửa source ứng dụng. `AvatarMotionPreview.tsx` đã có thay đổi trong working tree trước audit; đọc trạng thái hiện tại và giữ nguyên.
