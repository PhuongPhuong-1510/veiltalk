# VeilTalk

Ứng dụng web gọi video / nhắn tin qua nhân vật ảo 3D, không lộ khuôn mặt thật.
Đồ án tốt nghiệp, một người làm. Tài liệu thiết kế đã hoàn chỉnh trước khi code.

---

## Nguyên tắc bắt buộc

- **Tài liệu là nguồn chân lý.** Trước khi làm task nào, đọc tài liệu tương ứng theo bảng chỉ đường bên dưới. Nếu code mâu thuẫn tài liệu, tài liệu đúng — trừ khi tôi nói ngược lại.
- **Thiếu hoặc mâu thuẫn thì DỪNG và hỏi tôi.** Không tự suy diễn rồi làm tiếp.
- **Không tự mở rộng phạm vi.** Chỉ làm đúng task được giao. Phát hiện việc cần làm thêm thì ghi ra cho tôi quyết định.
- **Giải thích trước khi viết.** Task từ 2 giờ trở lên: dùng plan mode. Tôi cần hiểu code để bảo vệ trước hội đồng.
- **Không thêm thư viện mới** khi chưa hỏi tôi.
- **Không commit** khi tôi chưa xem.

---

## Bảng chỉ đường — cần gì đọc file nào

| Đang làm gì | Đọc file |
|---|---|
| Bất kỳ task nào (bắt đầu ở đây) | `docs/09_ROADMAP_AND_TASKS.md` |
| Dự án là gì, thuật ngữ | `docs/00_PROJECT_CONTEXT.md` |
| Yêu cầu FR-xx / NFR-xx, use case | `docs/01_PRODUCT_REQUIREMENTS.md` |
| Kiến trúc, luồng xử lý, ADR | `docs/02_SYSTEM_ARCHITECTURE.md` |
| Bảng, cột, index, migration | `docs/03_DATABASE.md` |
| Endpoint, request/response, WebSocket | `docs/04_API.md` |
| Màn hình SCR-xx, màu, component | `docs/05_UI_UX.md` |
| Code hiện có nằm ở đâu | `docs/06_CODEBASE_GUIDE.md` |
| Viết test, test case TC-xx | `docs/07_DEVELOPMENT_AND_TESTING.md` |
| Docker, biến môi trường, triển khai | `docs/08_DEPLOYMENT_AND_OPERATIONS.md` |
| Đo hiệu năng | `docs/10_PERFORMANCE.md` |
| Soát code, review pull request | `docs/REVIEW_CHECKLIST.md` |

**KHÔNG đọc hết tất cả.** Chỉ đọc file liên quan tới task đang làm. Mỗi task trong `09_ROADMAP_AND_TASKS.md` có cột "Tài liệu tham chiếu" — dùng nó.

Cần bức tranh lớn (đầu phase, quyết định kiến trúc, rà soát nhất quán) thì tôi sẽ nói rõ đọc rộng hơn.

---

## Ngăn xếp công nghệ

| Tầng | Công nghệ |
|---|---|
| Backend | Java 21, Spring Boot 3.x, modular monolith |
| Database | PostgreSQL 16, Flyway migration |
| Cache / Pub-Sub | Redis |
| Lưu trữ media | MinIO (S3-compatible) |
| Signaling | Node.js, ws |
| Frontend | Vite + React + TypeScript, Three.js, @pixiv/three-vrm, MediaPipe Tasks, Zustand, Tailwind |
| Triển khai | Docker Compose (7 service) |

## Cấu trúc thư mục

```
backend/     Spring Boot
signaling/   Node.js WebSocket relay
frontend/    React + Three.js
infra/       init SQL, cấu hình
docs/        tài liệu thiết kế
```

## Lệnh thường dùng

```bash
docker compose up -d              # toàn hệ thống
docker compose logs -f backend

cd backend && ./mvnw spring-boot:run
cd backend && ./mvnw test

cd frontend && npm run dev
cd frontend && npm run build
```

---

## Ràng buộc không được vi phạm

- **Không truyền video hay ảnh khuôn mặt thật ra khỏi trình duyệt.** Chỉ truyền skeleton data + audio. Đây là NFR-06 và là lý do tồn tại của sản phẩm.
- **Tracking và render chạy hoàn toàn phía client.** Server không xử lý ảnh.
- **Chống dò tài khoản:** đăng nhập sai và tìm kiếm không thấy phải trả cùng một thông báo chung, không tiết lộ email nào tồn tại.
- **Xóa mềm:** không DELETE thật, dùng cột `deleted_at`.
- **Mặc định không cho tìm kiếm:** `is_discoverable` mặc định FALSE.
- Mục tiêu hiệu năng: tracking→render dưới 100ms, tối thiểu 24fps trên máy tầm trung.

---

## Quy ước code

- Backend: package theo tính năng (`auth`, `avatar`, `messaging`, `video`), không theo tầng
- Controller mỏng, logic ở service
- Mọi lỗi trả về theo định dạng chuẩn trong `docs/04_API.md`
- Frontend: component theo màn hình, khớp mã SCR-xx trong `docs/05_UI_UX.md`
- Tên biến tiếng Anh, comment tiếng Việt khi giải thích logic nghiệp vụ
- Migration: file SQL đánh số tăng dần, **không sửa file migration đã chạy**

---

## Sau khi sửa code

Cập nhật tài liệu liên quan **trong cùng phiên**, không để sang phiên sau:

- Đổi endpoint → `docs/04_API.md`
- Đổi bảng/cột → `docs/03_DATABASE.md`
- Đổi màn hình → `docs/05_UI_UX.md`
- Thêm file/thư mục mới → `docs/06_CODEBASE_GUIDE.md`
- Xong task → đánh dấu trong `docs/09_ROADMAP_AND_TASKS.md`

Không rõ tài liệu nào bị ảnh hưởng thì hỏi tôi.

---

## Cách tôi giao việc

Tôi giao theo mã task, ví dụ "làm P2-T14". Khi đó:

1. Đọc mô tả task trong `docs/09_ROADMAP_AND_TASKS.md`
2. Đọc tài liệu mà task đó tham chiếu
3. Đọc code của các task phụ thuộc nếu đã có
4. Trình bày kế hoạch, chờ tôi duyệt
5. Làm, viết test theo `docs/07_DEVELOPMENT_AND_TESTING.md`
6. Chạy test, sửa đến khi xanh
7. Cập nhật tài liệu, tóm tắt những chỗ tôi cần đọc kỹ

---

## Ghi chú

- Tổng 83 task, chia 8 phase (P0–P7). Ước tính ~280–320 giờ.
- Bản gốc .docx nằm ở `docs/_source/` — dùng để đối chiếu và nộp hội đồng, **không sửa**.
- `docs/06_CODEBASE_GUIDE.md` hiện còn rỗng, sẽ điền dần khi có code.
