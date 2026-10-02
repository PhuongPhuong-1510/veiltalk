# Đợt 1: nền tảng depth, mục tiêu cổ tay và constraints

Ngày 02/10/2026. Đợt này bổ sung nền tảng vào VeilTalk; chưa phải nghiệm thu toàn bộ kế hoạch A–Z hay xác nhận chất lượng ngang XR bằng webcam.

## Những thay đổi đã triển khai

| Phần | Thay đổi | Điều kiện bảo vệ |
|---|---|---|
| Lịch sử đo người | Tách hướng tay đo từ Pose khỏi hướng tay đã retarget/filter cho avatar. Khôi phục cổ tay dùng lịch sử đo người. | Chỉ ghi hướng dưới khi cổ tay là Pose-world thật; không dùng cổ tay dựng lại để hiệu chuẩn độ dài. |
| Depth tương đối | Cue hình học từ độ ngắn hình chiếu cẳng tay có thể hoạt động khi cue kích thước lòng bàn tay đã hết hạn hoặc bàn tay nghiêng cạnh. | Cần Hand mới, khớp đúng bên, cùng thời điểm Pose, độ dài đã hiệu chuẩn và dấu depth đủ tin cậy. Hand cũ không kéo dài tuổi cue. Đây không phải độ sâu mét hoặc camera calibration. |
| Mục tiêu hình ảnh cổ tay | Adapter weak-perspective lấy cổ tay tương đối vai; ưu tiên Pose và chỉ trộn Hand khi mới, match chắc và hai vị trí ảnh gần nhau. | Vai còn đủ hình chiếu; chỉ chỉnh XY, giới hạn 8% chiều dài tay người và không sửa Z. Không can thiệp input/calibration. |
| Endpoint theo rig | IK dùng chiều dài thật của tay avatar, giữ phía gập quan sát; giảm trọng số khi mục tiêu vượt miền với tới. | Tay thẳng hoặc thiếu mặt phẳng gập tin cậy tiếp tục baseline; không tạo mặt phẳng gập từ cue ảnh. Không dùng mục tiêu ảnh mới cho partial-arm. |
| Giới hạn khuỷu | Giới hạn góc giữa hai đoạn tay ở mục tiêu hình học, giữ mặt phẳng gập đang quan sát. | Khi hai đoạn đối nhau và không xác định được trục gập, không đoán trục mới. Các giới hạn swing/twist theo rig vẫn độc lập. |
| Chẩn đoán endpoint | Ghi chất lượng/reach, sai số XY trước IK, sau IK và sau constraints, sai số đích sau constraints. | FK ở đây là chuỗi rig chuẩn hóa trong solver, trước temporal, renderer, collision và skin. Chỉ số ảnh là proxy weak-perspective, không phải pixel reprojection qua camera thật. |

Các ngưỡng 8%, trọng số ảnh 0.35, giới hạn gập 150° là lựa chọn thử nghiệm của VeilTalk, không được gán là tham số XR. Giới hạn gập trước joint constraints chưa bảo đảm góc cuối trên mesh sau mọi xử lý. Chưa triển khai khớp bản lề giải phẫu với trục cố định được hiệu chuẩn hoặc shoulder cone bất đối xứng.

## Phần VeilTalk được giữ lại

- Partial-arm, phân biệt quan sát thật/dựng lại, hysteresis và reacquire hiện có.
- Neutral calibration, hand twist, wrist swing, chuyển động ngón tay và xử lý contact hiện có.
- Các lựa chọn thử nghiệm mặc định tắt; người dùng bật để so sánh A/B. Không thay đổi remote protocol hay production defaults.

Test tích hợp dùng hai processor với cùng raw frame, rig có tỉ lệ tay trên/tay dưới khác người. Bật endpoint vẫn giữ raw nguyên vẹn, độ dài hiệu chuẩn và hình học khôi phục cổ tay khi Pose mất wrist. Đây là regression test trên fixture, không phải bằng chứng VeilTalk vượt XR.

## Đối chiếu nguồn XR

Đã đọc lại các đoạn liên quan của nguồn gốc trong `C:/project/SystemAnimatorOnline`, không sửa nguồn XR:

- `js/SA_system_emulation.readable.js:6130–6165`: cue hình chiếu/foreshortening, liên hệ độ dài.
- `js/SA_system_emulation.readable.js:8960–9058`: chuyển hệ quy chiếu đích IK, biến đổi theo parent, xử lý/filter đích.
- `js/SA_system_emulation.readable.js:9741–9785` và `images/XR Animator/animate.js:2076–2103`: `elbow_lock` có cấu hình theo motion/side và giá trị y. Không đủ cơ sở gọi đây là khớp bản lề giải phẫu luôn bật.
- Các đoạn đã đối chiếu ở đợt trước về palm/depth, blend và body-local collision được lưu trong `MOTION_DEPTH_CONTINUATION.vi.md` và `XR_TECHNIQUE_MATRIX.vi.md`.

Không cần sao chép mọi thuật toán từ cả bảy file vào đợt này. Phần không liên quan trực tiếp được giữ trong nghiên cứu nguồn, chưa dùng để suy diễn tính năng.

## Kiểm tra đã chạy

- Toàn bộ frontend: **967 test, 116 file, đều pass**.
- TypeScript + Vite build: exit 0; còn cảnh báo bundle lớn hiện có.
- Lint: exit 0; còn cảnh báo whitespace hiện có.
- Audit ba VRM: đủ rig tay, 30 joint ngón tay/model; sáu cảnh synthetic/model, năm biến thể/cảnh, không có rotation không hữu hạn.
- Audit dựng raw rest graph từ VRM và chạy processor; không thay thế nghiệm thu VRM normalized humanoid/mesh, browser, FPS thực hay webcam. Chưa chạy đo XR đối chứng.

Log nằm trong `docs/motion-review/round1-*.log`; dữ liệu audit và manifest nằm cùng thư mục.

## Cách test webcam đợt 1

Server của đợt này: `http://127.0.0.1:5175/dev/avatar-renderer` (các nhãn A/B dưới đây), hoặc `http://127.0.0.1:5175/avatar/motion` (giao diện gọn, nhãn tiếng Việt). Đã kiểm tra HTTP và module processor mới được phục vụ; chưa kiểm tra hình ảnh trong browser.

Reload trang để tạo processor mới. Bật tracking, Constraints, Hand twist, Continuous fingers và Bone smoothing theo cấu hình đang dùng. Chụp/ghi baseline trước, rồi bật lần lượt:

1. `Relative arm depth fusion (A/B)`.
2. `Rig-aware wrist reach (A/B)`.
3. `Rig-local swing/twist limits (A/B)` cùng Constraints.

Giữ các thử nghiệm contact khác ở cùng trạng thái giữa hai lần so sánh. Dùng đủ ba avatar. Mỗi cảnh lặp 3 lần: đứng yên, vươn về webcam, thu tay, nghiêng cạnh bàn tay, đưa lên đầu/sau đầu, che wrist trong khi khuỷu vẫn rõ rồi đưa wrist trở lại, che khuỷu và trở lại, đổi bên trái/phải. So sánh vị trí cổ tay, phía gập khuỷu, giật lúc mất/khôi phục và twist. Ghi replay từ cùng nguồn, tránh so hai động tác người khác nhau rồi kết luận thuật toán tốt hơn.

## Các bước còn lại sau đợt này

Nghiệm thu webcam và FK cuối renderer; chỉnh ngưỡng bằng dữ liệu thật; hiệu chuẩn camera nếu cần pixel/depth định lượng; shoulder cone và anatomical hinge có hiệu chuẩn. Những việc này chưa hoàn thành trong đợt 1. Các đợt contact/fingertip, remote, profiling/defaults và nghiệm thu toàn A–Z tiếp tục theo kế hoạch trước.
