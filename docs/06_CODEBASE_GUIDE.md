# 06 — Bản đồ Codebase

> **Trạng thái: đã khởi tạo cấu trúc repository, chưa có code ứng dụng.**
> File này được cập nhật sau mỗi phase. Mục đích: phiên làm việc sau đọc file này
> là biết ngay code nằm ở đâu, không phải quét cả repo.
>
> Lệnh cập nhật: *"Cập nhật `docs/06_CODEBASE_GUIDE.md` với những gì vừa làm."*

## Tổng quan thư mục

| Thư mục | Nội dung | Trạng thái |
|---|---|---|
| `backend/` | Spring Boot 3.5.16 API (Java 21, Maven) | project skeleton hoàn tất; `clean package -DskipTests` thành công |
| `signaling/` | Node.js WebSocket relay | project skeleton hoàn tất |
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

| Đường dẫn | Nội dung |
|---|---|
| `backend/pom.xml` | Maven project `com.veiltalk:backend`, Java 21, Spring Boot 3.5.16 và các starter nền tảng |
| `backend/mvnw`, `backend/mvnw.cmd` | Maven Wrapper scripts |
| `backend/.mvn/wrapper/maven-wrapper.properties` | Maven Wrapper 3.3.4, Maven 3.9.16 |
| `backend/src/main/java/com/veiltalk/BackendApplication.java` | Điểm khởi động Spring Boot |
| `backend/src/main/resources/application.yml` | Cấu hình tên ứng dụng; chưa có datasource/Redis |
| `backend/src/test/java/com/veiltalk/BackendApplicationTests.java` | Smoke test khởi tạo Spring context |

P0-T03 đã được xác minh bằng `mvnw.cmd clean package -DskipTests`. Smoke test
`BackendApplicationTests` chưa chạy thành công vì Data JPA chưa có URL datasource ở
giai đoạn này (`Failed to determine a suitable driver class`). Không có cấu hình tạm,
H2 hoặc Testcontainers; cấu hình database sẽ được bổ sung ở task đúng phạm vi.

### Module xác thực
### Module nhân vật ảo
### Module nhắn tin
### Module video

## Signaling Server

| Đường dẫn | Nội dung |
|---|---|
| `signaling/package.json` | Node.js project và scripts `start`, `check` |
| `signaling/package-lock.json` | Khóa phiên bản dependency |
| `signaling/src/index.js` | Entry-point skeleton; chưa triển khai WebSocket/JWT relay |
| `signaling/Dockerfile` | Image Node.js 24 Alpine, cài production dependencies và chạy entry-point |

Dependencies nền tảng: `ws` 8.21.1, `jsonwebtoken` 9.0.3 và `dotenv` 17.4.2.
P0-T04 đã được xác minh bằng `npm run check` và `npm start`.

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
