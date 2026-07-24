# 06 — Bản đồ Codebase

> **Trạng thái: đang thực hiện Phase 2 — P2-T01 đến P2-T06 đã hoàn thành.**
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
| `docker-compose.yml` | 7 service; PostgreSQL/Redis publish cổng 5432/6379 cho Backend local, còn Backend trong Compose dùng hostname nội bộ |
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
| `backend/src/main/java/com/veiltalk/auth/RefreshTokenRepository.java` | Repository refresh token; lookup bằng SHA-256 token hash |
| `backend/src/main/java/com/veiltalk/auth/JwtService.java` | Sinh, xác thực và đọc access/refresh JWT ký HS256 |
| `backend/src/main/java/com/veiltalk/auth/JwtClaims.java` | Kiểu dữ liệu bất biến cho claims JWT đã xác thực |
| `backend/src/main/java/com/veiltalk/auth/JwtAuthenticationFilter.java` | Đọc Bearer access token, từ chối JTI bị blacklist và thiết lập danh tính/role vào `SecurityContext` |
| `backend/src/main/java/com/veiltalk/auth/JwtBlacklistService.java` | Quản lý key Redis `jwt:blacklist:{jti}` với TTL còn lại của access token |
| `backend/src/main/java/com/veiltalk/auth/SecurityConfig.java` | Security chain stateless, phân quyền public/protected, CORS, security headers và response 401 chuẩn |
| `backend/src/main/java/com/veiltalk/auth/AuthController.java` | REST controller cho `POST /auth/register` |
| `backend/src/main/java/com/veiltalk/auth/AuthService.java` | Nghiệp vụ đăng ký, BCrypt password, lưu user và cấp JWT |
| `backend/src/main/java/com/veiltalk/auth/RegisterRequest.java` | DTO request và validation email/password/display name |
| `backend/src/main/java/com/veiltalk/auth/RegisterResponse.java` | DTO response user và access/refresh token theo API mục 3.1 |
| `backend/src/main/java/com/veiltalk/auth/LoginRequest.java` | DTO request đăng nhập và validation email/password |
| `backend/src/main/java/com/veiltalk/auth/LoginResponse.java` | DTO response user, trạng thái avatar và tokens theo API mục 3.2 |
| `backend/src/main/java/com/veiltalk/auth/RefreshTokenRequest.java` | DTO dùng chung cho request refresh/logout |
| `backend/src/main/java/com/veiltalk/auth/RefreshResponse.java` | DTO access token mới theo API mục 3.3 |
| `backend/src/main/java/com/veiltalk/auth/ApiExceptionHandler.java` | Chuẩn hóa lỗi validation và conflict theo định dạng API |
| `backend/src/main/java/com/veiltalk/auth/ConflictException.java` | Lỗi nghiệp vụ HTTP 409 |
| `backend/src/main/java/com/veiltalk/auth/UnauthorizedException.java` | Lỗi nghiệp vụ HTTP 401 với thông báo đăng nhập chung |
| `backend/src/test/java/com/veiltalk/auth/JwtServiceTests.java` | Unit test thời hạn, claims, chữ ký, loại token và cấu hình JWT |
| `backend/src/test/java/com/veiltalk/auth/JwtAuthenticationFilterTests.java` | Unit test Bearer header, access/refresh token và token không hợp lệ |
| `backend/src/test/java/com/veiltalk/auth/SecurityConfigTests.java` | MVC slice test quy tắc truy cập, response 401, CORS và security headers |
| `backend/src/test/java/com/veiltalk/auth/AuthRegistrationIntegrationTests.java` | Integration test TC-01, TC-02, TC-03 và đăng ký lại email sau soft delete |
| `backend/src/test/java/com/veiltalk/auth/AuthLoginIntegrationTests.java` | Integration test TC-04, TC-05, TC-06 và lưu SHA-256 hash của refresh token |
| `backend/src/test/java/com/veiltalk/auth/AuthRefreshLogoutIntegrationTests.java` | Integration test TC-07, TC-08, TC-09, ownership, soft delete và Redis blacklist TTL |

### Module người dùng

| Đường dẫn | Nội dung |
|---|---|
| `backend/src/main/java/com/veiltalk/user/UserProfileController.java` | REST controller mỏng cho `GET/PUT /users/me` |
| `backend/src/main/java/com/veiltalk/user/UserProfileService.java` | Lấy/cập nhật hồ sơ user đang hoạt động; trả cùng lỗi 401 khi user thiếu hoặc đã soft delete |
| `backend/src/main/java/com/veiltalk/user/UserProfileUpdateRequest.java` | DTO cập nhật từng phần; validate display name và phân biệt field avatar URL không gửi với giá trị null |
| `backend/src/main/java/com/veiltalk/user/UserProfileResponse.java` | DTO hồ sơ theo API mục 4.1–4.2, gồm trạng thái đã có nhân vật ảo |
| `backend/src/test/java/com/veiltalk/user/UserProfileIntegrationTests.java` | Integration test GET/PUT, partial update, xóa avatar URL, validation, authentication và soft delete |

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

P1-T06 cấu hình Spring Data Redis qua `REDIS_HOST`/`REDIS_PORT`. Redis container
publish `localhost:6379` cho Backend chạy local; Backend trong full Compose dùng
hostname nội bộ `redis`. Integration test xác minh `StringRedisTemplate` ghi/đọc key
`jwt:blacklist:{jti}` với TTL và luôn xóa key sau kiểm tra. Toàn bộ 12 test PASS.

P2-T01 bổ sung `JwtService` không cần thư viện JWT mới: dùng Java Cryptography API để ký
HMAC-SHA256 và Jackson để xử lý JSON. Access token chứa `sub`, `role`, `type`, `jti`,
`iat`, `exp` và hết hạn sau 15 phút; refresh token chứa `type`, `jti`, `iat`, `exp` và
hết hạn sau 7 ngày. Secret và thời hạn lấy từ `JWT_SECRET`, `JWT_ACCESS_EXPIRY`,
`JWT_REFRESH_EXPIRY`. Validation khóa thuật toán HS256, kiểm tra chữ ký constant-time,
thời hạn, cấu trúc claims và phân biệt access/refresh token. Toàn bộ 8 unit test JWT PASS.

P2-T02 bổ sung Spring Security stateless. `JwtAuthenticationFilter` chỉ chấp nhận Bearer
access token hợp lệ, đưa UUID người dùng và role vào `SecurityContext`; refresh token và
token lỗi không tạo authentication. `/auth/**`, `/actuator/health` và `/internal/**` là
public; các đường dẫn còn lại yêu cầu xác thực và trả lỗi `UNAUTHORIZED` theo định dạng API.
Security chain đồng thời cấu hình CORS cho origin frontend, HSTS, `nosniff` và chống
clickjacking. Toàn bộ 9 test riêng P2-T02 và 29 test Backend đều PASS.

P2-T03 triển khai `POST /auth/register` qua controller mỏng và `AuthService`. Request được
validate theo API mục 3.1; mật khẩu được băm bằng BCrypt trước khi lưu; response `201` chứa
user, access token 15 phút và refresh token 7 ngày. Service dùng
`findByEmailAndDeletedAtIsNull` nên chỉ email của tài khoản đang hoạt động trả `409`.
Email của tài khoản soft delete được phép tạo user độc lập với UUID mới, không khôi phục
hoặc liên kết dữ liệu cũ, phù hợp partial unique index `idx_users_email`. TC-01, TC-02,
TC-03, test đăng ký lại sau soft delete và toàn bộ 33 test Backend đều PASS.

P2-T04 triển khai `POST /auth/login`. `AuthService` chỉ tìm user chưa soft delete, xác minh
mật khẩu bằng BCrypt và trả cùng một lỗi `401 UNAUTHORIZED` cho email không tồn tại hoặc
mật khẩu sai để chống dò tài khoản. Đăng nhập thành công trả thông tin user, `has_avatar`
và access/refresh token; refresh token được băm SHA-256 trước khi lưu vào
`refresh_tokens`, cùng `user_id` và thời điểm hết hạn lấy từ JWT claims. TC-04, TC-05,
TC-06 và toàn bộ 36 test Backend đều PASS.

P2-T05 triển khai `POST /auth/refresh` và `POST /auth/logout`. Register và login dùng chung
quy trình phát hành refresh token: chỉ trả token gốc cho client, lưu SHA-256 hash cùng
user/thời hạn trong database. Refresh kiểm tra đồng thời JWT type, hash, `revoked_at`,
`expires_at` và trạng thái soft delete của user. Logout chỉ chấp nhận cặp access/refresh
token cùng user, đặt `revoked_at`, rồi blacklist access-token `jti` trong Redis với TTL
bằng thời gian token còn lại. `JwtAuthenticationFilter` từ chối ngay JTI đã blacklist.
TC-07, TC-08, TC-09, các ca ownership/soft delete và toàn bộ 43 test Backend đều PASS.

P2-T06 triển khai `GET /users/me` và `PUT /users/me` trong package tính năng `user`.
Controller lấy UUID từ `Authentication`; service chỉ truy vấn bằng
`findByIdAndDeletedAtIsNull`. Access token còn hạn nhưng user không tồn tại hoặc đã soft
delete đều trả cùng `401 UNAUTHORIZED` với thông báo `Invalid session`, không tiết lộ trạng
thái tài khoản. PUT cập nhật từng phần, validate `display_name` 1–100 ký tự và phân biệt
`avatar_url` không được gửi với `avatar_url: null` để xóa ảnh. Toàn bộ 8 integration test
riêng P2-T06 PASS.

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
  Schema ứng dụng chỉ được tạo và quản lý bằng Flyway từ
  `backend/src/main/resources/db/migration/`; không có hoặc chạy
  `infra/postgres/init.sql`.
- Hostname `postgres` và `redis` chỉ phân giải được bên trong Docker Compose. Khi chạy
  Backend test bằng Maven/IDE trên Windows, nạp secret từ `.env` nhưng override
  `DB_HOST=localhost` và `REDIS_HOST=localhost`; xem
  `docs/07_DEVELOPMENT_AND_TESTING.md` mục 1.4.1.
- Trên môi trường Windows hiện tại, `backend/mvnw.cmd` có thể báo
  `Cannot index into a null array` / `Cannot start maven from wrapper`. Đây là known issue
  của script khởi động wrapper, không phải test failure. Có thể chạy Maven 3.9.16 đã tải
  trong `%USERPROFILE%\.m2\wrapper\dists\`; chỉ kết luận test PASS khi có
  `BUILD SUCCESS`.
