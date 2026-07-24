# 06 — Bản đồ Codebase

> **Trạng thái: đã khởi tạo cấu trúc repository, chưa có code ứng dụng.**
> File này được cập nhật sau mỗi phase. Mục đích: phiên làm việc sau đọc file này
> là biết ngay code nằm ở đâu, không phải quét cả repo.
>
> Lệnh cập nhật: *"Cập nhật `docs/06_CODEBASE_GUIDE.md` với những gì vừa làm."*

## Tổng quan thư mục

| Thư mục | Nội dung | Trạng thái |
|---|---|---|
| `backend/` | Spring Boot API | đã tạo thư mục, chưa có code |
| `signaling/` | Node.js WebSocket relay | đã tạo thư mục, chưa có code |
| `frontend/` | React + Three.js | đã tạo thư mục, chưa có code |
| `infra/` | init SQL, cấu hình hạ tầng | đã tạo thư mục, chưa có cấu hình |
| `docs/` | Tài liệu thiết kế, roadmap, checklist và runbook | đã có |

Các thư mục ứng dụng và hạ tầng hiện chứa `.gitkeep` để Git theo dõi cấu trúc rỗng.

## File cấu hình ở thư mục gốc

| File | Nội dung hiện tại |
|---|---|
| `.env.example` | Template biến môi trường, không chứa secret thật |
| `docker-compose.yml` | 7 service: backend, signaling, frontend, postgres, redis, minio, nginx; dùng mạng `internal-net` và volume persistent cho PostgreSQL/MinIO |
| `Makefile` | Shortcut `up`, `down`, `logs`, `migrate` |
| `.gitignore` | Quy tắc bỏ qua file môi trường, output build và file cục bộ |
| `.gitattributes` | Quy tắc thuộc tính file của repository |
| `AGENTS.md` | Quy tắc làm việc bắt buộc trong repository |
| `CLAUDE.md` | Chỉ dẫn cho công cụ tương thích |

## Backend

*(điền sau Phase 1–2)*

### Module xác thực
### Module nhân vật ảo
### Module nhắn tin
### Module video

## Signaling Server

*(điền sau Phase 3)*

## Frontend

*(điền sau Phase 4)*

### Vòng lặp tracking
### Bộ dựng hình nhân vật
### Lớp WebRTC
### Các màn hình

## Luồng dữ liệu chính

*(điền khi đã nối được đầu-cuối)*

## Chỗ dễ nhầm

*(ghi lại khi gặp — thứ mà đọc code không thấy ngay)*
