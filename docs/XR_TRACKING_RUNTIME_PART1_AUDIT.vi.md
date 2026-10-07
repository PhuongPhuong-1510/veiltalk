# Đối chiếu XR phần 1: tracking runtime, dòng 1–500

Ngày đối chiếu: **07/10/2026**. Phạm vi: bản tổng hợp 22 mục người dùng gửi, tracking hình ảnh và các tầng filter liên quan trong VeilTalk.

## Nguồn và mức xác nhận

- Đã đọc toàn bộ bản tổng hợp được gửi trong `Pasted text.txt`.
- Đối chiếu source có sẵn tại `C:/project/SystemAnimatorOnline/js/mocap_lib_module.js`, chủ yếu dòng 1–500 và đoạn tạo worker ngay sau đó. XR HEAD: `53c20eb91517d2807d142c122a868ca9157c3016`; file này không có thay đổi trong working tree khi kiểm tra. Đây là bản `.js` trong repo, chưa xác nhận byte-for-byte với file mang tên `mocap_lib_module(1).js` được nhắc trong bản tổng hợp.
- VeilTalk HEAD: `1ed78e8799585b853014f90665033a2280ce6590`. Đối chiếu cả working tree: hai trang avatar đã bật hand conditioning trong các thay đổi chưa commit của người dùng.
- Đây là báo cáo đối chiếu và danh sách bổ sung. Chưa triển khai worker, Pose Z filter hoặc adaptive scheduling trong lượt này; chưa có benchmark webcam để kết luận cải thiện FPS hay chất lượng chuyển động.

## Bảng quyết định

“Đã có” dưới đây xác nhận cơ chế hiện diện và caller đã nối trong code; không thay thế nghiệm thu webcam. Số dòng tham chiếu là tại thời điểm đối chiếu.

| Ý tưởng trong bản tổng hợp | Trạng thái VeilTalk | Bằng chứng và quyết định |
|---|---|---|
| Tách quản lý model, lấy frame và xử lý chuyển động (mục 1–4, 20) | **Đã có nền** | `tracking/mediaPipeRuntime.ts:54`, `tracking/trackingPipeline.ts:37`, `avatar-motion/avatarMotionProcessor.ts` và `avatar-renderer/avatarRenderer.ts` có trách nhiệm riêng. Giữ nền hiện tại. |
| Tracking core chạy được qua main thread hoặc worker (mục 2–3, 22) | **Chưa có đường worker hình ảnh** | `trackingPipeline.ts:160` gọi `detectForVideo` trực tiếp trên video. Worker hiện tìm thấy trong `audio-lipsync/audioQualificationController.ts` chỉ phục vụ kiểm chứng audio, không chạy Face/Hand/Pose. Bổ sung execution adapter và worker tracking. |
| Worker riêng cho Hand/Pose, chế độ song song (mục 7, 19, 22) | **Chưa có** | Face → Hands → Pose vẫn được gọi tuần tự ở `trackingPipeline.ts:159`. Chế độ staggered chỉ đổi lịch lấy mẫu. Xếp thử nghiệm Hand worker sau khi đo phương án một worker tracking. |
| Face/Hand/Pose là nguồn đo riêng (mục 5, 11) | **Đã có** | `mediaPipeRuntime.ts:112` tạo ba task riêng; `rawTrackingTypes.ts:19` trở đi giữ sample và timestamp từng nguồn; processor có ghép Hand–Pose và xử lý facial riêng. Bỏ qua việc xây lại sự phân tách này. |
| Trộn thư viện/backend Human/TFJS/MediaPipe (mục 4–5, 9, 16) | **Chưa có; chưa cần bổ sung** | Runtime chỉ tạo MediaPipe Tasks. Dependency injection phục vụ kiểm thử chưa phải registry backend. Chỉ thêm adapter backend khi có nhu cầu và so sánh chất lượng cụ thể. |
| GPU, VIDEO, một người; hai tay (mục 10) | **Đã có** | `mediaPipeRuntime.ts:120` trở đi: GPU theo delegate, VIDEO, `numFaces:1`, `numHands:2`, `numPoses:1`. Giữ cấu hình. |
| GPU → CPU dự phòng | **Có điều kiện** | `mediaPipeRuntime.ts:92` thử CPU khi delegate là `AUTO` và GPU khởi tạo lỗi. `AvatarRendererDevHarness.tsx:169` và `AvatarMotionPreview.tsx:31` truyền `GPU` tường minh nên không dùng nhánh này. Không ghi “avatar tự fallback CPU” ở trạng thái hiện tại. |
| Chuẩn hóa output (mục 14–15) | **Đã có** | `rawTrackingMapper.ts` tạo `RawTrackingFrameV1`, tách image/world, candidates, lost/not-sampled và sample time. Giữ adapter. Backend mới vẫn phải bảo đảm hệ tọa độ, đơn vị, landmark topology và clock tương thích. |
| Trái/phải không phụ thuộc hoàn toàn detector label (mục 15) | **Đã có** | `handPoseMatching.ts:109`, `:167`, `:217`, `:313`: label là penalty mềm, assignment một–một, continuity và chống đổi danh tính khi giao tay. `avatarMotionProcessor.ts:1265` thực sự gọi matcher. Bỏ qua việc thêm một phép đảo nhãn cố định. |
| One Euro Filter (mục 6, 12) | **Đã có** | `oneEuroFilter.ts` có scalar/vector; processor dùng cho direction/pole, continuous finger solver dùng cho góc. Không cần viết lại One Euro. |
| Tách lọc measurement khỏi lọc motion (mục 6, 22) | **Đã có một phần** | `handLandmarkConditioning.ts:17` lọc hình dạng landmark tương đối wrist, chuẩn hóa theo palm width, giữ raw bất biến; được gọi trước palm basis ở `avatarMotionProcessor.ts:1306`. Filter góc/hướng và renderer là các tầng khác. Còn thiếu conditioning riêng cho Pose Z. |
| Lọc chỉ Z của Pose image và world, giữ X/Y (mục 12–13, 22) | **Chưa có** | Mapper hiện chép x/y/z. Direction/pole filter trong processor lọc vector hướng, hand conditioner lọc shape bàn tay; cả hai không tương đương lọc Z từng Pose landmark. Bổ sung thử nghiệm riêng có công tắc, bảo toàn raw và kiểm chứng độ trễ. |
| Chạy detector theo tần suất riêng (mục 9) | **Đã có lịch cố định** | `trackingPipeline.ts:8`, `:167`: `full-rate` hoặc `staggered`; Hand/Pose có interval độc lập, mặc định 66.7 ms. `TrackingDevHarness.tsx` cho chọn profile; hai trang avatar dùng `full-rate`. Giữ cơ chế, không viết lại. |
| Tự điều chỉnh tải theo FPS/latency (mục 9, 18) | **Chưa có** | Chưa có controller đổi interval/model theo tải. Có nền đo ở `trackingMetrics.ts`; bổ sung policy với hysteresis, thời gian ổn định và tuổi mẫu tối đa sau khi có baseline. |
| Chọn chất lượng Pose (mục 18) | **Có một phần** | `mediaPipeRuntime.ts:21` hỗ trợ lite/full, mặc định full; đủ hai asset. `AvatarRendererDevHarness.tsx:477` cho chọn, dừng tracking và đổi options; `useTracking.ts:8` dispose rồi tạo pipeline mới. Chưa hot-swap, chưa heavy, chưa adaptive quality. |
| Legacy Holistic, PoseNet, MoveNet, Human hoặc Holistic mới (mục 8, 11, 16–17) | **Chưa tích hợp; bỏ qua ở đợt này** | Chưa có bằng chứng cần thay ba task hiện tại. Hỗ trợ nhiều backend tự nó không chứng minh hiệu năng/chất lượng tốt hơn. |
| Crop/ROI Hand của ứng dụng và bù mẫu cũ (kết luận phần 1) | **Chưa có lớp tương đương trong tracking** | Pipeline đưa video vào HandLandmarker; chưa có crop transform do ứng dụng quản lý hay worker result compensation. Đây là phần cần đọc tiếp source. Không suy ra từ đây rằng detector không có ROI/tracking nội bộ. |

## Những nhận định cần diễn đạt chính xác hơn

1. **Vòng render riêng đã có, thread riêng chưa có.** Renderer dùng `AnimationFrameLoop`; tracking dùng video-frame callback với fallback animation-frame callback. Inference đồng bộ vẫn chiếm main thread. Chuyển tracking sang worker nhằm giảm việc chặn thread này; không tự bảo đảm tổng inference nhanh hơn.
2. **Staggered không đồng nghĩa chạy song song hoặc adaptive.** Với interval mặc định, Hand/Pose chỉ có cơ hội chạy khi đã qua 66.7 ms; FPS thực tế phụ thuộc camera và thời gian inference. Face chạy trên mỗi frame pipeline xử lý được, không được bảo đảm 30 FPS. Hai interval bằng nhau còn có thể khiến Hand/Pose cùng đến hạn trên một frame.
3. **Lọc landmark gần solver đã hiện diện.** Hand conditioner giữ wrist hiện tại, lọc shape trước palm/ngón và có reset qua mất mẫu dài/đổi continuity. Trong working tree, preview và avatar harness bật nó; constructor processor vẫn mặc định tắt. Không cần chuyển filter vào worker chỉ để đạt sự phân tách measurement/motion.
4. **Chỉ Z là hành vi của nhánh Pose Tasks/Holistic đang đọc.** XR `:352` tạo filter cho image/world; `:401` chỉ ghi lại `v.z`. Chưa chứng minh mọi backend và toàn bộ pipeline XR đều giữ nguyên X/Y. Lý do “giữ responsiveness” vẫn là suy luận, chưa phải giải thích hoặc benchmark từ tác giả.
5. **`skipFrames:5` chưa đủ mô tả lịch toàn bộ Hand pipeline.** Cần implementation/version Human để biết bỏ qua palm detection, landmark inference hay tái dùng kết quả theo điều kiện nào. Không quy đổi thành “VeilTalk cứ bỏ năm frame tay”.
6. **Các nhánh backend là chọn theo cấu hình.** Dòng 419–468 không thể hiện chuỗi tự động thử BlazePose rồi MoveNet/PoseNet khi lỗi. Gọi là backend alternatives chính xác hơn tự động fallback. VeilTalk có fallback GPU/CPU riêng và chỉ áp dụng trong AUTO.
7. **Bảng Performance/Balanced/Quality mới là đề xuất.** Repo chỉ có một asset Face, một asset Hand và hai asset Pose lite/full. Không coi “Face Lite/Full, Hand Lite/Full” là tùy chọn đã có. XR gọi `setOptions` ở `:482`, nhưng đoạn này chưa chứng minh việc đổi model không khựng hoặc đã được đồng bộ với frame đang chạy.
8. **Adapter và continuity tốt không đủ kết luận VeilTalk hơn XR.** Có thể xác nhận trách nhiệm và cơ chế cụ thể; muốn so chất lượng cần cùng video, cấu hình, rig và số đo. Worker cũng không tự khắc phục tay nhỏ/xa camera, sai depth hoặc mất quan sát.

## Các phần cần bổ sung và thứ tự đề xuất

### RT-01 — Đường tracking worker, giữ ba detector cùng frame trước

Trạng thái: **chưa triển khai**. Tận dụng `MediaPipeRuntime`, mapper và pipeline lifecycle hiện tại; tách nguồn frame/lịch gọi khỏi nơi thực thi inference. Bước đầu dùng một worker chạy Face/Hands/Pose theo cùng lịch hiện có, so với main-thread baseline. Giữ đường main-thread để đối chiếu và xử lý trường hợp worker không khởi tạo được.

Hợp đồng cần có:

- Mỗi frame mang session/generation, sequence và thời điểm lấy mẫu trong clock chung. Kết quả từ phiên đã stop/dispose hoặc frame cũ không được cập nhật pose mới.
- Phân biệt `frameTimestampMs` đang theo video media time với `sampledAtMs` dùng để tính tuổi mẫu. Truyền clock của nguồn hoặc đổi time origin rõ ràng; không trừ trực tiếp các clock khác gốc.
- Giới hạn số frame đang xử lý/chờ, giữ frame mới nhất khi quá tải; không để hàng đợi tăng tuổi mẫu vô hạn.
- Quyền sở hữu/đóng tài nguyên frame và cleanup model, lỗi khởi tạo, stop/start/dispose được kiểm thử. Chi phí capture/transfer và model warmup được đo.
- Worker chỉ là nơi thực thi; chất lượng loss/reacquire, danh tính hai tay và contract raw phải được giữ.

Gate: test lifecycle, timestamp, kết quả đảo thứ tự, bounded queue và lỗi worker; kiểm tra browser thật với WASM/GPU; so main-thread blocked time, render frame gap, inference p95 và sample age. Test mock không chứng minh MediaPipe GPU chạy được trong worker trên máy mục tiêu.

### RT-02 — Pose Z conditioning có thể bật/tắt

Trạng thái: **chưa triển khai**. Tái sử dụng One Euro scalar; tạo bản đo đã conditioning riêng, không ghi đè `RawTrackingFrameV1` dùng cho trace/replay.

- Giữ nguyên X/Y và metadata; filter Z của image/world có state, đơn vị và cấu hình riêng.
- Chỉ nhận observation mới hợp lệ; không tiến filter qua duplicate/not-sampled hoặc dùng visibility thấp làm measurement mới. Reset theo session, model, discontinuity và mất quan sát.
- Chọn rõ consumer dùng raw hay conditioned. Solver, calibration chiều dài, matching và depth fusion không được vô tình trộn hai phiên bản measurement.
- Đo rung và độ trễ trên tay đứng yên, chuyển động nhanh, tiến/lùi, hướng camera, che rồi xuất hiện lại. Filter Z có thể làm chậm chuyển động chiều sâu hoặc thay đổi chiều dài đo được; không giải quyết ambiguity và occlusion bằng chính nó.

Gate: raw bất biến, XY giữ nguyên, duplicate/reset đúng, A/B final FK và độ trễ; chỉ bật mặc định khi có bằng chứng có lợi. Thử Z tách khỏi thay worker để biết thay đổi nào tạo kết quả.

### RT-03 — Điều chỉnh tải dựa trên số đo

Trạng thái: **có fixed scheduling và metrics; thiếu controller**. Bắt đầu từ thay interval hiện có; chỉ đổi model khi có lý do từ số đo và lifecycle đổi model đã an toàn.

- Dựa trên p95 inference, sample age và render frame gap; không chỉ một giá trị FPS tức thời.
- Hysteresis, cooldown, giới hạn interval và hành vi khi mất/tìm lại tay để không đổi chất lượng liên tục hoặc bỏ lỡ reacquire.
- Các phép đo `cameraFps` hiện lấy tick lúc pipeline xử lý frame; không coi đây là bộ đếm độc lập mọi frame camera thực sự tạo ra.
- Khi chuyển sang worker, phải sửa nghĩa của metric fallback: `trackingMetrics.ts:115` hiện tính pipeline dài ≥50 ms như main-thread long task khi không có observer. Thời gian chạy trong worker không được cộng vào main-thread blocked time theo cách này.

### RT-04 — Hand worker song song và crop/ROI

Trạng thái: **chưa triển khai; cần đọc tiếp scheduler/crop XR**. Chỉ thêm sau baseline RT-01 nếu chi phí Hand và ngân sách độ trễ cho thấy lợi ích.

Cần quyết định ghép theo frame nào, giới hạn độ lệch tuổi Hand–Pose, discard kết quả cũ, crop→full-image transform và xử lý duplicate/not-sampled. Không đổi timestamp của tay cũ thành mẫu mới. Translation compensation không thay thế rotation/deformation. Đo GPU contention, transfer và memory: hai worker không mặc nhiên nhanh hơn một worker trên cùng GPU.

## Kiểm chứng đợt đối chiếu

Chạy các test hiện có, không thêm test chỉ để phản chiếu bảng đánh giá:

```text
npm.cmd test -- src/lib/tracking src/lib/avatar-motion/oneEuroFilter.test.ts src/lib/avatar-motion/handLandmarkConditioning.test.ts src/lib/avatar-motion/handPoseMatching.test.ts
```

Kết quả: **8 file test đạt, 60 test đạt**. Bao gồm camera/runtime/pipeline/mapper/metrics, One Euro, hand conditioning và matching. Đây là kiểm chứng tự động với fixture/mock; chưa đo webcam, worker, GPU thực hoặc so chất lượng với XR.

Các cơ chế đã có được giữ để tránh triển khai trùng. RT-01→RT-04 là danh sách việc còn thiếu, chưa đánh dấu hoàn thành. Liên quan: [ma trận kỹ thuật XR](XR_TECHNIQUE_MATRIX.vi.md), đặc biệt hàng worker/crop/stale-hand và hand conditioning.
