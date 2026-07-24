# 00 — Bối cảnh Dự án

## VeilTalk là gì

Ứng dụng web cho phép người dùng nhắn tin, gọi video và quay video thông qua một
nhân vật ảo 3D thay vì để lộ khuôn mặt thật. Camera bắt chuyển động khuôn mặt,
tay và tư thế của người dùng ngay trên trình duyệt; dữ liệu chuyển động được ánh
xạ lên nhân vật ảo và hiển thị theo thời gian thực.

## Làm cho ai

Người muốn giao tiếp qua video nhưng không thoải mái để lộ ngoại hình thật — vì
ngại vóc dáng, vì môi trường xung quanh, hoặc vì muốn giữ một hình ảnh riêng.
Gần với cộng đồng VTuber về mặt thẩm mỹ, nhưng mục đích là giao tiếp cá nhân chứ
không phải phát sóng.

## Vấn đề cốt lõi

Các ứng dụng gọi video hiện có buộc người dùng chọn: hoặc bật camera và lộ hết,
hoặc tắt camera và mất hoàn toàn tín hiệu phi ngôn ngữ. VeilTalk tạo lựa chọn thứ
ba: giữ được biểu cảm và cử chỉ, nhưng qua một lớp nhân vật ảo.

## Nguyên tắc thiết kế

**Riêng tư từ gốc.** Toàn bộ việc theo dõi và dựng hình chạy trên trình duyệt.
Khuôn mặt thật không bao giờ rời khỏi thiết bị. Chỉ dữ liệu khung xương và âm
thanh được truyền đi.

**Máy khách gánh nặng, máy chủ nhẹ.** Server chỉ lo xác thực, lưu trữ và trung
chuyển tín hiệu. Không xử lý ảnh, không dựng hình.

**Phạm vi MVP có giới hạn rõ.** Gọi video 1-1, một bộ nhân vật dựng sẵn với tùy
chỉnh cơ bản. Các tính năng vượt quy mô được ghi rõ là nằm ngoài phạm vi.

## Thuật ngữ

| Thuật ngữ | Nghĩa trong dự án này |
|---|---|
| Avatar / Nhân vật ảo | Mô hình 3D chuẩn VRM đại diện cho người dùng |
| Tracking | Việc nhận diện khuôn mặt/tay/tư thế từ webcam bằng MediaPipe |
| Skeleton data | Dữ liệu góc khớp và hệ số biểu cảm, thứ duy nhất được truyền đi thay cho video |
| Blendshape | Tham số điều khiển biểu cảm khuôn mặt của mô hình 3D |
| Signaling | Quá trình hai bên trao đổi thông tin để thiết lập kết nối WebRTC |
| VRM | Chuẩn mô hình nhân vật 3D, xây trên nền glTF, dùng shader MToon |
| MToon | Shader tạo hiệu ứng anime (cel-shading) cho mô hình VRM |
| SCR-xx | Mã màn hình giao diện, xem `05_UI_UX.md` |
| FR-xx / NFR-xx | Mã yêu cầu chức năng / phi chức năng, xem `01_PRODUCT_REQUIREMENTS.md` |
| TC-xx | Mã ca kiểm thử, xem `07_DEVELOPMENT_AND_TESTING.md` |
| Pn-Txx | Mã công việc, xem `09_ROADMAP_AND_TASKS.md` |

## Bản đồ tài liệu

| File | Nội dung |
|---|---|
| `00_PROJECT_CONTEXT.md` | File này — bối cảnh, thuật ngữ |
| `01_PRODUCT_REQUIREMENTS.md` | Yêu cầu chức năng, phi chức năng, use case |
| `02_SYSTEM_ARCHITECTURE.md` | Kiến trúc, luồng xử lý, quyết định thiết kế |
| `03_DATABASE.md` | Schema, index, migration |
| `04_API.md` | Đặc tả REST và WebSocket |
| `05_UI_UX.md` | Design system, 21 màn hình |
| `06_CODEBASE_GUIDE.md` | Bản đồ code (điền dần khi có code) |
| `07_DEVELOPMENT_AND_TESTING.md` | Chiến lược kiểm thử, 58 ca kiểm thử |
| `08_DEPLOYMENT_AND_OPERATIONS.md` | Triển khai, vận hành, xử lý sự cố |
| `09_ROADMAP_AND_TASKS.md` | 83 công việc, phụ thuộc, ước tính |
| `10_PERFORMANCE.md` | Phương pháp đo và kết quả hiệu năng |
