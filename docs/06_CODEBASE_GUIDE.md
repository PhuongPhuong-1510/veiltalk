# 06 — Bản đồ Codebase

> **Trạng thái: đã hoàn thành P1-T05 — schema V1 đã có đầy đủ JPA entity và repository.**
> File này được cập nhật sau mỗi phase. Mục đích: phiên làm việc sau đọc file này
> là biết ngay code nằm ở đâu, không phải quét cả repo.
>
> Lệnh cập nhật: *"Cập nhật `docs/06_CODEBASE_GUIDE.md` với những gì vừa làm."*

## Tổng quan thư mục

| Thư mục | Nội dung | Trạng thái |
|---|---|---|
| `backend/` | Spring Boot 3.5.16 API (Java 21, Maven) | datasource và Flyway V1 đã cấu hình; smoke test thành công |
| `signaling/` | Node.js WebSocket relay | project skeleton hoàn tất |
| `frontend/` | Vite + React + TypeScript | project skeleton hoàn tất |
| `infra/` | cấu hình hạ tầng | đã tạo thư mục, không chứa Docker init script |
| `docs/` | Tài liệu thiết kế, roadmap, checklist và runbook | đã có |

`infra/` hiện còn `.gitkeep` để Git theo dõi thư mục rỗng; các thư mục ứng dụng đã có
project skeleton tương ứng.

## File cấu hình ở thư mục gốc

| File | Nội dung hiện tại |
|---|---|
| `.env.example` | Template biến môi trường, không chứa secret thật |
| `.env` | Cấu hình môi trường cục bộ đã tạo; chứa secret, bị Git ignore và không được commit |
| `docker-compose.yml` | 7 service; PostgreSQL publish cổng 5432 cho Backend chạy local, còn Backend trong Compose dùng hostname `postgres` |
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

P1-T01 đã tạo schema bằng Flyway V1 khi Backend khởi động. PostgreSQL có 6 bảng ứng
dụng và bảng lịch sử `flyway_schema_history`; không dùng Docker init script.

P1-T02 đã đối chiếu schema thực tế với DDD mục 3, 5 và 6: đủ 6 bảng/50 cột,
6 primary key, 7 foreign key, 5 CHECK constraint, 13 index khai báo, hàm
`update_updated_at()` và 5 trigger. Các kiểm tra riêng cho
`users.is_discoverable DEFAULT FALSE`, trạng thái video `recording` và unique partial
index `idx_users_email` đều đạt.

P1-T03 đã xác minh Flyway có tính lặp lại: chạy lại Backend trên database phát triển
không thực thi lại V1 và không thay đổi object. Migration V1 cũng tái tạo thành công
toàn bộ schema trên database kiểm thử sạch `veiltalk_p1_t03_test`; metadata khớp
P1-T02 và database kiểm thử đã được xóa sau khi kiểm tra.

## Backend

| Đường dẫn | Nội dung |
|---|---|
| `backend/pom.xml` | Maven project `com.veiltalk:backend`, Java 21, Spring Boot 3.5.16; có Flyway Core và Flyway PostgreSQL |
| `backend/mvnw`, `backend/mvnw.cmd` | Maven Wrapper scripts |
| `backend/.mvn/wrapper/maven-wrapper.properties` | Maven Wrapper 3.3.4, Maven 3.9.16 |
| `backend/src/main/java/com/veiltalk/BackendApplication.java` | Điểm khởi động Spring Boot |
| `backend/src/main/resources/application.yml` | Cấu hình datasource, Flyway và Hibernate `ddl-auto: validate` để kiểm tra entity mapping với schema |
| `backend/src/main/resources/db/migration/V1__initial_schema.sql` | Migration khởi tạo đúng theo DDD mục 6: 6 bảng, index, constraint và trigger |
| `backend/src/test/java/com/veiltalk/BackendApplicationTests.java` | Smoke test khởi tạo Spring context |

P1-T01 đã được xác minh bằng `mvn test`: Spring context khởi động, Flyway áp dụng đúng
V1 trên PostgreSQL 16 và smoke test `BackendApplicationTests` PASS. Migration tạo đúng
6 bảng ứng dụng và một bản ghi V1 thành công trong `flyway_schema_history`.

### Module xác thực

| Đường dẫn | Nội dung |
|---|---|
| `backend/src/main/java/com/veiltalk/auth/User.java` | Entity bảng `users` |
| `backend/src/main/java/com/veiltalk/auth/RefreshToken.java` | Entity bảng `refresh_tokens` |
| `backend/src/main/java/com/veiltalk/auth/UserRole.java` | Enum `USER`, `ADMIN` |
| `backend/src/main/java/com/veiltalk/auth/UserRoleConverter.java` | Chuyển enum role sang giá trị PostgreSQL chữ thường |
| `backend/src/main/java/com/veiltalk/auth/UserRepository.java` | Repository user; query email, discoverable và soft delete |
| `backend/src/main/java/com/veiltalk/auth/RefreshTokenRepository.java` | Repository refresh token |

### Module nhân vật ảo

| Đường dẫn | Nội dung |
|---|---|
| `backend/src/main/java/com/veiltalk/avatar/AvatarProfile.java` | Entity bảng `avatar_profiles`; `customizations` map JSONB |
| `backend/src/main/java/com/veiltalk/avatar/AvatarProfileRepository.java` | Repository hồ sơ nhân vật ảo |

### Module nhắn tin

| Đường dẫn | Nội dung |
|---|---|
| `backend/src/main/java/com/veiltalk/messaging/Conversation.java` | Entity bảng `conversations` |
| `backend/src/main/java/com/veiltalk/messaging/Message.java` | Entity bảng `messages` |
| `backend/src/main/java/com/veiltalk/messaging/MessageStatus.java` | Enum `SENT`, `DELIVERED`, `READ` |
| `backend/src/main/java/com/veiltalk/messaging/MessageStatusConverter.java` | Chuyển enum message sang giá trị PostgreSQL chữ thường |
| `backend/src/main/java/com/veiltalk/messaging/ConversationRepository.java` | Repository cuộc trò chuyện |
| `backend/src/main/java/com/veiltalk/messaging/MessageRepository.java` | Repository tin nhắn; trả lịch sử dạng `Slice` theo thời gian tăng dần và loại soft delete |

### Module video

| Đường dẫn | Nội dung |
|---|---|
| `backend/src/main/java/com/veiltalk/video/Video.java` | Entity bảng `videos`, gồm `updated_at` và mặc định `RECORDING` |
| `backend/src/main/java/com/veiltalk/video/VideoStatus.java` | Enum `RECORDING`, `PROCESSING`, `READY`, `FAILED` |
| `backend/src/main/java/com/veiltalk/video/VideoStatusConverter.java` | Chuyển enum video sang giá trị PostgreSQL chữ thường |
| `backend/src/main/java/com/veiltalk/video/VideoRepository.java` | Repository video |

P1-T04 dùng `@Convert` rõ ràng trên từng field enum, không dùng `@Enumerated`. Test
converter bao phủ hai chiều Java ↔ giá trị database, annotation mapping và persist/read
thực tế qua PostgreSQL trong transaction rollback. Toàn bộ 8 test PASS.

P1-T05 bổ sung 6 `JpaRepository` theo package tính năng. Integration test xác minh
query user tôn trọng `is_discoverable`/`deleted_at`, query message loại soft delete,
sắp xếp `client_timestamp ASC` và phân trang bằng `Slice`. Toàn bộ 11 test PASS và dữ
liệu test được rollback.

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
