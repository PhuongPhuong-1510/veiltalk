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
| `frontend/` | Vite + React + TypeScript | project skeleton hoàn tất |
| `infra/` | init SQL, cấu hình hạ tầng | đã tạo thư mục, chưa có cấu hình |
| `docs/` | Tài liệu thiết kế, roadmap, checklist và runbook | đã có |

`infra/` hiện còn `.gitkeep` để Git theo dõi thư mục rỗng; các thư mục ứng dụng đã có
project skeleton tương ứng.

## File cấu hình ở thư mục gốc

| File | Nội dung hiện tại |
|---|---|
| `.env.example` | Template biến môi trường, không chứa secret thật |
| `.env` | Cấu hình môi trường cục bộ đã tạo; chứa secret, bị Git ignore và không được commit |
| `docker-compose.yml` | 7 service: backend, signaling, frontend, postgres, redis, minio, nginx; dùng mạng `internal-net` và volume persistent cho PostgreSQL/MinIO |
| `Makefile` | Shortcut `up`, `down`, `logs`, `migrate` |
| `.gitignore` | Quy tắc bỏ qua file môi trường, output build và file cục bộ |
| `.gitattributes` | Quy tắc thuộc tính file của repository |
| `AGENTS.md` | Quy tắc làm việc bắt buộc trong repository |
| `CLAUDE.md` | Chỉ dẫn cho công cụ tương thích |

## Hạ tầng cục bộ

P0-T07 đã xác minh ba service nền tảng:

| Service | Kết quả |
|---|---|
| PostgreSQL 16 | Container Up, `pg_isready` và truy vấn `psql` thành công |
| Redis 7 | Container Up, `redis-cli ping` trả `PONG` |
| MinIO | Container Up, health API và Console HTTP trả 200 |

Phase 0 không tạo bảng hoặc schema. Schema PostgreSQL bắt đầu từ P1-T01.

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

| Đường dẫn | Nội dung |
|---|---|
| `frontend/package.json` | Vite React/TypeScript project và scripts `dev`, `build`, `lint`, `preview` |
| `frontend/package-lock.json` | Khóa phiên bản dependency |
| `frontend/src/main.tsx` | Entry-point React |
| `frontend/src/App.tsx` | Component mẫu của Vite; chưa có màn hình VeilTalk |
| `frontend/tsconfig.app.json` | Cấu hình TypeScript và alias `@/*` → `src/*` |
| `frontend/vite.config.ts` | Vite React plugin và alias `@` → `src` |

Dependencies nền tảng theo P0-T05: `three`, `@mediapipe/tasks-vision`, `zustand`,
`react-router-dom`, `tailwindcss`. Các thư viện mới chỉ được cài đặt; tích hợp tracking,
rendering, state, routing và design system thuộc các task Phase 4.

P0-T05 đã được xác minh bằng `npm run build` và `npm run lint`.

### Vòng lặp tracking
### Bộ dựng hình nhân vật
### Lớp WebRTC
### Các màn hình

## Luồng dữ liệu chính

*(điền khi đã nối được đầu-cuối)*

## Chỗ dễ nhầm

- `docker-compose.yml` chỉ mount volume dữ liệu PostgreSQL, không tự động mount schema.
  File `infra/postgres/init.sql` được tạo và chạy chủ động bằng `psql` ở P1-T01.
