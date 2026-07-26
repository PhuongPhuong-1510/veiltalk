# 06 — Bản đồ Codebase

> **Trạng thái: đang thực hiện Phase 2 — P2-T01 đến P2-T17 đã hoàn thành.**
> File này được cập nhật sau mỗi phase. Mục đích: phiên làm việc sau đọc file này
> là biết ngay code nằm ở đâu, không phải quét cả repo.
>
> Lệnh cập nhật: *"Cập nhật `docs/06_CODEBASE_GUIDE.md` với những gì vừa làm."*

## Tổng quan thư mục

| Thư mục | Nội dung | Trạng thái |
|---|---|---|
| `backend/` | Spring Boot 3.5.16 API (Java 21, Maven) | datasource và Flyway V1 đã cấu hình; smoke test thành công |
| `signaling/` | Node.js WebSocket relay | P3-T01 hoàn thành: WebSocket server + JWT auth (SIGNALING_JWT_SECRET) |
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
| `backend/src/main/resources/db/migration/V2__add_user_settings.sql` | Bổ sung `email_notifications`, `theme` và CHECK constraint theme vào `users`; không sửa V1 |
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
| `backend/src/main/java/com/veiltalk/auth/NotFoundException.java` | Lỗi nghiệp vụ HTTP 404 theo response chuẩn |
| `backend/src/main/java/com/veiltalk/auth/ValidationException.java` | Lỗi validation nghiệp vụ HTTP 400 theo response chuẩn |
| `backend/src/main/java/com/veiltalk/auth/UnauthorizedException.java` | Lỗi nghiệp vụ HTTP 401 với thông báo đăng nhập chung |
| `backend/src/main/java/com/veiltalk/auth/UserTokenRevocationService.java` | Lưu/kiểm tra mốc Redis `jwt:user-revoked-after:{userId}` theo thời hạn access token |
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
| `backend/src/main/java/com/veiltalk/user/Theme.java` | Enum `DARK`, `LIGHT`, `SYSTEM` cho theme tài khoản |
| `backend/src/main/java/com/veiltalk/user/ThemeConverter.java` | Lưu/đọc Theme dưới dạng `dark`, `light`, `system` trong PostgreSQL |
| `backend/src/main/java/com/veiltalk/user/UserSettingsRequest.java` | DTO partial update settings; validation theme, gồm xử lý rõ `theme: null` |
| `backend/src/main/java/com/veiltalk/user/UserSettingsResponse.java` | DTO response cho API settings mục 4.3–4.4 |
| `backend/src/test/java/com/veiltalk/user/UserSettingsIntegrationTests.java` | Integration test TC-20, defaults, partial update, theme validation và soft delete |
| `backend/src/main/java/com/veiltalk/user/UserProfileController.java` | REST controller cho profile, settings và `POST /users/search` với response 200/429 và Retry-After |
| `backend/src/main/java/com/veiltalk/user/UserSearchService.java` | Tìm email chính xác chỉ trong nhóm discoverable, trả response trung lập khi không tìm thấy |
| `backend/src/main/java/com/veiltalk/user/UserSearchRequest.java` | DTO email search với validation email |
| `backend/src/main/java/com/veiltalk/user/UserSearchResponse.java` | DTO `found` và user summary không chứa email |
| `backend/src/main/java/com/veiltalk/user/UserSearchRateLimiter.java` | Redis fixed-window limiter 10 request/phút/user |
| `backend/src/test/java/com/veiltalk/user/UserSearchIntegrationTests.java` | Integration test TC-16–TC-19 và invalid email |
| `backend/src/main/java/com/veiltalk/user/DeleteAccountRequest.java` | DTO xác nhận mật khẩu cho `DELETE /users/me` |
| `backend/src/main/java/com/veiltalk/user/UserAccountService.java` | Soft delete user, revoke refresh tokens và tạo global access-token revocation marker |
| `backend/src/test/java/com/veiltalk/user/UserAccountDeletionIntegrationTests.java` | Integration test password confirmation, soft delete, refresh revoke và global JWT revocation |

### Module nhân vật ảo

| Đường dẫn | Nội dung |
|---|---|
| `backend/src/main/java/com/veiltalk/avatar/AvatarProfile.java` | Entity bảng `avatar_profiles`; `customizations` map JSONB |
| `backend/src/main/java/com/veiltalk/avatar/AvatarProfileRepository.java` | Repository hồ sơ nhân vật ảo |
| `backend/src/main/java/com/veiltalk/avatar/AvatarModel.java` | DTO bất biến cho một model catalog, ánh xạ các field JSON snake_case |
| `backend/src/main/java/com/veiltalk/avatar/AvatarModelCatalogService.java` | Đọc và kiểm tra catalog model nội bộ từ classpath khi khởi động |
| `backend/src/main/java/com/veiltalk/avatar/AvatarController.java` | REST controller cho catalog, upsert và hai endpoint đọc avatar |
| `backend/src/main/java/com/veiltalk/avatar/AvatarUpsertRequest.java` | DTO request upsert; bắt buộc model_id và từ chối model_url do client gửi |
| `backend/src/main/java/com/veiltalk/avatar/AvatarService.java` | Upsert và đọc avatar; áp dụng active-user check và 404 anti-enumeration |
| `backend/src/main/java/com/veiltalk/avatar/AvatarProfileResponse.java` | DTO đầy đủ cho `GET /avatars/me`, gồm id và timestamps |
| `backend/src/main/java/com/veiltalk/avatar/AvatarPublicResponse.java` | DTO metadata công khai cho `GET /avatars/{userId}`, không có thông tin tài khoản |
| `backend/src/main/resources/avatar-models.json` | Catalog nội bộ gồm 6 model; không lưu database |
| `backend/src/test/java/com/veiltalk/avatar/AvatarModelCatalogIntegrationTests.java` | Integration test TC-10 cho endpoint public và contract catalog |
| `backend/src/test/java/com/veiltalk/avatar/AvatarUpsertIntegrationTests.java` | Integration test TC-11–TC-13, validation customization/outfit và chống client tự gán model_url |
| `backend/src/test/java/com/veiltalk/avatar/AvatarQueryIntegrationTests.java` | Integration test TC-14–TC-15, GET /me, authentication và soft-delete |

### Module nhắn tin

| Đường dẫn | Nội dung |
|---|---|
| `backend/src/main/java/com/veiltalk/messaging/Conversation.java` | Entity bảng `conversations` |
| `backend/src/main/java/com/veiltalk/messaging/Message.java` | Entity bảng `messages` |
| `backend/src/main/java/com/veiltalk/messaging/MessageStatus.java` | Enum `SENT`, `DELIVERED`, `READ` |
| `backend/src/main/java/com/veiltalk/messaging/MessageStatusConverter.java` | Chuyển enum message sang giá trị PostgreSQL chữ thường |
| `backend/src/main/java/com/veiltalk/messaging/ConversationController.java` | REST controller tạo/liệt kê/lấy chi tiết conversation và gửi message |
| `backend/src/main/java/com/veiltalk/messaging/ConversationService.java` | Tạo idempotent, cursor pagination, dựng metadata user còn lại và last message |
| `backend/src/main/java/com/veiltalk/messaging/CreateConversationRequest.java` | DTO request `POST /conversations` |
| `backend/src/main/java/com/veiltalk/messaging/ConversationResponse.java` | DTO conversation cùng metadata công khai của user còn lại |
| `backend/src/main/java/com/veiltalk/messaging/ConversationListResponse.java` | DTO danh sách conversation với next_cursor và has_more |
| `backend/src/main/java/com/veiltalk/messaging/ConversationSummaryResponse.java` | DTO một item trong danh sách conversation |
| `backend/src/main/java/com/veiltalk/messaging/ConversationDetailResponse.java` | DTO chi tiết conversation |
| `backend/src/main/java/com/veiltalk/messaging/ConversationLastMessageResponse.java` | DTO metadata tin nhắn mới nhất |
| `backend/src/main/java/com/veiltalk/messaging/ConversationCursorCodec.java` | Mã hóa/giải mã cursor Base64URL từ updated_at và conversation id |
| `backend/src/main/java/com/veiltalk/messaging/ConversationRepository.java` | Insert idempotent, cập nhật `updated_at` khi có message mới và truy vấn keyset pagination |
| `backend/src/main/java/com/veiltalk/messaging/MessageRepository.java` | Insert message idempotent, lịch sử dạng `Slice` và batch query last message không bị soft delete |
| `backend/src/main/java/com/veiltalk/messaging/CreateMessageRequest.java` | DTO request `POST /conversations/{id}/messages` |
| `backend/src/main/java/com/veiltalk/messaging/MessageResponse.java` | DTO response message và dữ liệu realtime `NEW_MESSAGE` |
| `backend/src/main/java/com/veiltalk/messaging/MessageService.java` | Validate, insert idempotent và đăng ký publish realtime sau transaction commit |
| `backend/src/main/java/com/veiltalk/messaging/MessageRealtimePublisher.java` | Publish best-effort message/status/typing đến Redis channel theo người nhận; ghi log/metric khi lỗi |
| `backend/src/main/java/com/veiltalk/messaging/MessagingWebSocketConfig.java` | Đăng ký raw WebSocket `/ws/messaging`, allowed origins và text frame limit 32 KiB |
| `backend/src/main/java/com/veiltalk/messaging/MessagingWebSocketLifecycleConfig.java` | Cấp scheduler riêng và UTC clock cho heartbeat/token expiry của Messaging WebSocket |
| `backend/src/main/java/com/veiltalk/messaging/WebSocketAuthHandshakeInterceptor.java` | Xác thực access JWT query token, blacklist/global revoke và user active trước khi upgrade |
| `backend/src/main/java/com/veiltalk/messaging/MessagingWebSocketHandler.java` | Quản lý vòng đời, PONG, typing, ERROR và policy close 1008 của connection |
| `backend/src/main/java/com/veiltalk/messaging/MessagingTypingService.java` | Kiểm conversation active/membership và relay typing tới user còn lại, không lưu DB |
| `backend/src/main/java/com/veiltalk/messaging/WebSocketSessionRegistry.java` | Registry thread-safe hỗ trợ nhiều session/user, concurrent send và dọn task/session độc lập |
| `backend/src/main/java/com/veiltalk/messaging/WebSocketKeepAliveScheduler.java` | Gửi PING, theo dõi PONG, đóng token hết hạn/thu hồi và recheck Redis best-effort |
| `backend/src/main/java/com/veiltalk/messaging/RedisMessagingListenerConfig.java` | Static PSUBSCRIBE `messaging:user:*` một lần trên mỗi Backend instance |
| `backend/src/main/java/com/veiltalk/messaging/MessagingRedisSubscriber.java` | Validate Redis envelope và fan-out nguyên văn tới mọi WebSocket session local của recipient |
| `backend/src/main/java/com/veiltalk/messaging/MessagingRedisSubscriberHealthIndicator.java` | Health component `UP`/`DEGRADED` cho Redis realtime subscriber |
| `backend/src/main/java/com/veiltalk/messaging/MessagingRedisConnectionMonitor.java` | Theo dõi Lettuce disconnect/reconnect để cập nhật subscriber metric và health |
| `backend/src/main/java/com/veiltalk/messaging/MessageCursorCodec.java` | Mã hóa/giải mã keyset cursor từ `client_timestamp` và message id |
| `backend/src/main/java/com/veiltalk/messaging/MessageHistoryResponse.java` | DTO một message trong response lịch sử |
| `backend/src/main/java/com/veiltalk/messaging/MessageListResponse.java` | DTO trang lịch sử với `prev_cursor` và `has_more` |
| `backend/src/main/java/com/veiltalk/messaging/UpdateMessageStatusRequest.java` | DTO request cập nhật status, chỉ nhận `delivered` hoặc `read` |
| `backend/src/main/java/com/veiltalk/messaging/MessageStatusResponse.java` | DTO response status message cùng `updated_at` |
| `backend/src/test/java/com/veiltalk/messaging/ConversationCreateIntegrationTests.java` | Integration test TC-21–TC-22, validation, authentication và soft-delete |
| `backend/src/test/java/com/veiltalk/messaging/ConversationQueryIntegrationTests.java` | Integration test TC-59–TC-60, cursor, membership và soft-delete |
| `backend/src/test/java/com/veiltalk/messaging/MessageCreateIntegrationTests.java` | Integration test TC-23–TC-25, idempotency, collision, validation, membership và publish sau commit |
| `backend/src/test/java/com/veiltalk/messaging/MessageRealtimePublisherTests.java` | Unit test channel/payload Redis và cơ chế best-effort khi publish lỗi |
| `backend/src/test/java/com/veiltalk/messaging/MessageHistoryIntegrationTests.java` | Integration test TC-26, keyset cursor, tie-breaker, soft-delete, limit và quyền truy cập |
| `backend/src/test/java/com/veiltalk/messaging/MessageStatusIntegrationTests.java` | Integration test TC-27–TC-28, transition, idempotency, quyền, 404 và publish sau commit |
| `backend/src/test/java/com/veiltalk/messaging/WebSocketAuthHandshakeInterceptorTests.java` | Unit test claims, query token, blacklist/revoke và active-user check của handshake |
| `backend/src/test/java/com/veiltalk/messaging/MessagingWebSocketConfigTests.java` | Unit test chuẩn hóa allowed origins và từ chối cấu hình rỗng/wildcard |
| `backend/src/test/java/com/veiltalk/auth/MessagingWebSocketHandshakeIntegrationTests.java` | WebSocket upgrade thật: access token hợp lệ nhận 101 và các biến thể TC-47 nhận 401 |
| `backend/src/test/java/com/veiltalk/messaging/WebSocketSessionRegistryTests.java` | Unit test nhiều session/user, concurrent decorator và cleanup chính xác |
| `backend/src/test/java/com/veiltalk/messaging/WebSocketKeepAliveSchedulerTests.java` | Unit test PING/PONG, close 4002/4003, hủy task và Redis recheck failure metric |
| `backend/src/test/java/com/veiltalk/messaging/MessagingWebSocketLifecycleIntegrationTests.java` | WebSocket thật cho TC-46, TC-61–TC-63: heartbeat, token expiry/revoke và nhiều tab |
| `backend/src/test/java/com/veiltalk/messaging/MessagingRedisSubscriberTests.java` | Unit test fan-out, malformed event, health/metric, `CALL_INCOMING` readiness và lỗi một session |
| `backend/src/test/java/com/veiltalk/messaging/MessagingWebSocketDeliveryIntegrationTests.java` | TC-64–TC-66 qua REST, DB commit, Redis và WebSocket thật |
| `backend/src/test/java/com/veiltalk/messaging/MessagingWebSocketTypingIntegrationTests.java` | TC-50, TC-67–TC-68: typing relay, anti-enumeration, ERROR và close 1008/1009 |
| `docs/runbooks/P2-T18-step3-multi-instance-verification.md` | Bằng chứng manual hai Backend instance và Redis restart của Bước 3 |
| `docs/runbooks/P2-T18-end-to-end-verification.md` | Bằng chứng regression cuối cho toàn bộ phạm vi P2-T18 |

### Module video

| Đường dẫn | Nội dung |
|---|---|
| `backend/src/main/java/com/veiltalk/video/Video.java` | Entity bảng `videos`, gồm `updated_at` và mặc định `RECORDING` |
| `backend/src/main/java/com/veiltalk/video/VideoStatus.java` | Enum `RECORDING`, `PROCESSING`, `READY`, `FAILED` |
| `backend/src/main/java/com/veiltalk/video/VideoStatusConverter.java` | Chuyển enum video sang giá trị PostgreSQL chữ thường |
| `backend/src/main/java/com/veiltalk/video/VideoRepository.java` | Repository video |
| `backend/src/main/java/com/veiltalk/video/MinioProperties.java` | Bind endpoint/credentials/bucket và `MINIO_WEBHOOK_SECRET` |
| `backend/src/main/java/com/veiltalk/video/VideoProperties.java` | Bind `video.storage-limit-bytes` — hạn mức quota mỗi tài khoản (NFR-19) |
| `backend/src/main/java/com/veiltalk/video/MinioConfig.java` | Khởi tạo `MinioClient` và `MinioAsyncClient` (multipart); không log credentials |
| `backend/src/main/java/com/veiltalk/video/VideoController.java` | `POST /videos`, `/videos/{id}/chunks`, `/finalize`, `/abort` (P2-T20–T22); `GET/PUT/DELETE /videos`, `GET /videos/{id}` (P2-T24) |
| `backend/src/main/java/com/veiltalk/video/VideoService.java` | Khởi tạo/cấp chunk và finalize/abort multipart; đối chiếu parts, quota thật, conditional state update và compensation; thư viện/đổi tên/xóa mềm/presigned view_url (P2-T24) |
| `backend/src/main/java/com/veiltalk/video/VideoCursor.java` | Mã hóa/giải mã cursor Base64URL `(created_at, id)` cho `GET /videos` (P2-T24) |
| `backend/src/main/java/com/veiltalk/video/VideoLibraryResponse.java` / `VideoSummary.java` / `VideoDetailResponse.java` / `RenameVideoRequest.java` | DTO cho GET/PUT/DELETE `/videos` (P2-T24, API mục 7.1, 7.7–7.9) |
| `backend/src/main/java/com/veiltalk/video/VideoAccountCleanupService.java` | Abort mọi video `recording` của user khi xóa tài khoản; per-video trong transaction `REQUIRES_NEW` riêng, tự nuốt lỗi MinIO và ghi cleanup job thay vì throw (P2-T24, TC-37) |
| `backend/src/main/java/com/veiltalk/video/VideoCleanupTransactionSupport.java` | Bean phụ REQUIRES_NEW cho `VideoAccountCleanupService` — tách bean để tránh self-invocation Spring proxy |
| `backend/src/main/java/com/veiltalk/video/VideoCleanupJob.java` / `VideoCleanupJobRepository.java` / `VideoCleanupOperation.java` / `VideoCleanupJobStatus.java` | Entity/repo bảng `video_cleanup_jobs` — retry bền vững dùng chung cho ABORT_MULTIPART (xóa tài khoản) và REMOVE_OBJECT (orphan object timeout, P2-T22) |
| `backend/src/main/java/com/veiltalk/video/VideoCleanupRetryJob.java` | `ScheduledExecutorService` poll `video_cleanup_jobs` đến hạn; backoff nhân đôi, `FAILED_PERMANENT` sau max attempts (P2-T24) |
| `backend/src/main/java/com/veiltalk/video/VideoWebhookAuthenticationFilter.java` | Chỉ bảo vệ `POST /internal/videos/webhook`; constant-time compare toàn `Authorization: Bearer <secret>` và fail-fast nếu thiếu secret |
| `backend/src/main/java/com/veiltalk/video/VideoWebhookController.java` / `VideoWebhookRequest.java` / `VideoWebhookService.java` | Nhận payload MinIO thật, validate toàn batch, decode key một lần và atomic `processing→ready` theo storage path + size |
| `backend/src/main/java/com/veiltalk/video/CreateVideoRequest.java` / `CreateVideoResponse.java` | DTO request/response cho `POST /videos` |
| `backend/src/main/java/com/veiltalk/video/ChunkUrlRequest.java` / `ChunkUrlResponse.java` | DTO request/response cho `POST /videos/{id}/chunks` (P2-T21) |
| `backend/src/main/java/com/veiltalk/video/FinalizeVideoRequest.java` / `FinalizeVideoResponse.java` / `AbortVideoRequest.java` | DTO finalize/abort (P2-T22) |
| `backend/src/main/java/com/veiltalk/video/VideoUploadSessionStore.java` | Interface state phiên multipart (createSession, reserveNextPart → enum ReserveResult) |
| `backend/src/main/java/com/veiltalk/video/RedisVideoUploadSessionStore.java` | Impl Redis: hash `video:upload:{videoId}`; reserveNextPart nguyên tử bằng Lua (thứ tự + idempotency + quota) |
| `backend/src/main/java/com/veiltalk/video/VideoMultipartStorage.java` | Interface MinIO: create/presign/list/complete/abort multipart và remove object |
| `backend/src/main/java/com/veiltalk/video/MinioMultipartStorage.java` | Impl `MinioAsyncClient`; ListParts phân trang, complete/abort và remove object |
| `backend/src/main/java/com/veiltalk/video/RedisDistributedLock.java` | Redis lock token UUID; SET NX PX, Lua renew/release; finalize khóa user rồi video |
| `backend/src/main/java/com/veiltalk/video/VideoTimeoutCleanupJob.java` | ScheduledExecutorService quét `processing` quá 10 phút, conditional failed; remove object lỗi ghi `video_cleanup_jobs` để retry thay vì chỉ log (P2-T24) |
| `backend/src/main/java/com/veiltalk/video/VideoProperties.java` | Bind `video.*`: storage-limit-bytes, upload-session-ttl-seconds, presigned-url-expiry-seconds |
| `backend/src/main/java/com/veiltalk/video/StorageQuotaExceededException.java` | Quota vượt → HTTP 507 `STORAGE_QUOTA_EXCEEDED` (xử lý ở `ApiExceptionHandler`) |
| `backend/src/main/java/com/veiltalk/video/VideoStorageException.java` | Lỗi hạ tầng MinIO (unchecked) — mặc định trả 500 |
| `backend/src/test/java/com/veiltalk/video/MinioClientIntegrationTests.java` | TC-69 với bucket random, presigned PUT/GET thật và cleanup |
| `backend/src/test/java/com/veiltalk/video/MinioSdkCompatibilityTests.java` | Spike bảo vệ public low-level multipart API cần cho P2-T20–P2-T22 |
| `backend/src/test/java/com/veiltalk/video/VideoCreateIntegrationTests.java` | TC-29, TC-33 + 400/401 (mock `VideoMultipartStorage` + `VideoUploadSessionStore`) |
| `backend/src/test/java/com/veiltalk/video/VideoChunkIntegrationTests.java` | TC-30 + 400/403/404/507/retry cho `/chunks`, Redis thật (Lua chạy thật) |
| `backend/src/test/java/com/veiltalk/video/VideoFinalizeAbortIntegrationTests.java` | TC-31/TC-32 + quota thật và đối chiếu ETag |
| `backend/src/test/java/com/veiltalk/video/VideoFinalizeAbortConcurrencyIntegrationTests.java` | Race finalize–abort qua Redis/PostgreSQL thật: chỉ một thao tác thắng |
| `backend/src/test/java/com/veiltalk/video/VideoFinalizeCompensationTests.java` / `VideoTimeoutCleanupJobTests.java` | Compensation remove object và timeout không abort multipart |
| `backend/src/test/java/com/veiltalk/video/VideoWebhookIntegrationTests.java` / `VideoWebhookAuthenticationFilterTests.java` | TC-31/TC-44, auth matrix, batch validation, URL decode, idempotency, terminal states và size mismatch P2-T23 |
| `backend/src/test/resources/application.properties` | Secret chỉ dùng cho test và Hikari pool nhỏ để nhiều Spring test context không làm cạn PostgreSQL connection |
| `backend/src/test/java/com/veiltalk/video/VideoMultipartPresignIntegrationTests.java` | Gate `MINIO_INTEGRATION_TEST`: PUT part 1 thật → nhận ETag, chứng minh presign part đúng |
| `backend/src/test/java/com/veiltalk/video/VideoMultipartChunkPresignIntegrationTests.java` | Gate `MINIO_INTEGRATION_TEST`: nối part 1 → PUT part 2 thật, hai ETag khác nhau (nền cho T22) |
| `backend/src/test/java/com/veiltalk/video/VideoManagementIntegrationTests.java` | TC-34–TC-36: đổi tên, xóa video ready giảm quota ngay, video failed view_url null, presigned view_url, 403/404 |
| `backend/src/test/java/com/veiltalk/video/VideoAccountCleanupServiceTests.java` | Unit test abort thành công/thất bại/upload_id không xác định (fallback Redis session, hoặc bỏ qua MinIO cho video tạo trước V3) |
| `backend/src/test/java/com/veiltalk/video/VideoCleanupRetryJobTests.java` | Unit test retry ABORT_MULTIPART/REMOVE_OBJECT: thành công xoá job, backoff nhân đôi, `FAILED_PERMANENT` sau max attempts |
| `backend/src/test/java/com/veiltalk/video/MinioMultipartStorageAbortTests.java` | NoSuchUpload coi là thành công (idempotent), lỗi MinIO khác vẫn propagate để retry |
| `backend/src/test/java/com/veiltalk/user/UserAccountDeletionVideoCleanupIntegrationTests.java` | TC-37: abort thành công/thất bại qua HTTP thật; KHÔNG dùng `@Transactional` vì `REQUIRES_NEW` cần thấy dữ liệu setUp đã commit — dọn dẹp thủ công ở `@AfterEach` |

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

P2-T07 triển khai `GET /users/me/settings` và `PUT /users/me/settings`. Migration V2
bổ sung `email_notifications BOOLEAN NOT NULL DEFAULT TRUE` và
`theme VARCHAR(20) NOT NULL DEFAULT 'system'` với CHECK constraint; migration V1 không
bị sửa. Entity `User` dùng `ThemeConverter` để lưu enum Java viết hoa thành
`dark`/`light`/`system`. PUT cập nhật từng phần, giữ nguyên field không gửi và từ chối
theme null/ngoài tập hợp hợp lệ. TC-20 cùng các ca defaults, partial update, validation
và soft delete đều PASS. Ba test auth cũ cũng được cô lập khỏi dữ liệu có sẵn bằng cách
lookup đúng token do test tạo. Toàn bộ 60 test Backend PASS.

P2-T08 triển khai phần core của `DELETE /users/me`: xác nhận mật khẩu, đánh dấu
`users.deleted_at`, revoke toàn bộ refresh token còn hoạt động và lưu mốc epoch-second
`jwt:user-revoked-after:{userId}` trong Redis với TTL bằng access-token lifetime tối đa.
`JwtAuthenticationFilter` từ chối access token có `iat` không mới hơn mốc revoke, vô hiệu
hóa tất cả phiên access token hiện có. MinIO `AbortMultipartUpload` và TC-37 được chuyển
sang P2-T24; P2-T08 không tạo upload session hoặc cleanup retry. Toàn bộ 65 test Backend
PASS.

P2-T09 triển khai `POST /users/search`. Query dùng repository method
`findByEmailAndIsDiscoverableTrueAndDeletedAtIsNull`, nên user chưa opt-in, đã soft delete
hoặc không tồn tại đều trả cùng `{\"found\":false}`. User tìm thấy chỉ trả `id` và
`display_name`, không lộ email. Redis fixed-window limiter giới hạn 10 request/phút/user;
request vượt ngưỡng trả `429` kèm `Retry-After`. TC-16–TC-19 cùng toàn bộ 70 test Backend
PASS.

P2-T10 triển khai public `GET /avatars/models`. Catalog gồm 6 model nằm trong
`avatar-models.json`, được đọc và kiểm tra cấu trúc khi ứng dụng khởi động, không lưu
database. Mỗi item trả `id`, `name`, `model_url`, `thumbnail_url`,
`supported_customizations`, `outfit_options`; không trả `model_id`. TC-10, hồi quy
SecurityConfig và toàn bộ 71 test Backend đều PASS.

P2-T11 triển khai protected `PUT /avatars/me` theo cơ chế upsert trên unique
`avatar_profiles.user_id`: lần đầu trả `201`, cập nhật trả `200`. Server chỉ nhận
`model_id`, tự tra `model_url` từ catalog và từ chối URL do client gửi. Customization key
phải được model hỗ trợ; outfit phải thuộc `outfit_options`. TC-11–TC-13, các ca validation
liên quan và toàn bộ 76 test Backend đều PASS.

P2-T12 triển khai protected `GET /avatars/me` và `GET /avatars/{userId}`. Endpoint `/me`
trả hồ sơ đầy đủ; endpoint theo user chỉ trả avatar metadata, không lộ email, role, id hồ
sơ hoặc timestamps. User không tồn tại, đã soft delete hoặc chưa có avatar cùng trả
`404 NOT_FOUND` với body `Avatar not found`. TC-14–TC-15, các ca `/me`, authentication,
soft-delete và toàn bộ 81 test Backend đều PASS.

P2-T13 triển khai protected `POST /conversations`. Service chuẩn hóa hai UUID để lưu
`user_a_id < user_b_id`, sau đó dùng `INSERT ... ON CONFLICT DO NOTHING` dựa trên
`idx_conv_pair`; lần tạo đầu trả `201`, các lần gọi lại từ bất kỳ phía nào trả `200` với
cùng conversation id. Response chỉ chứa metadata công khai của user còn lại. Endpoint
từ chối self-conversation, UUID sai định dạng, user không tồn tại/đã soft delete và phiên
đăng nhập không còn hợp lệ. TC-21–TC-22, các ca validation/authentication/soft-delete và
toàn bộ 87 test Backend đều PASS.

P2-T14 triển khai protected `GET /conversations` và `GET /conversations/{id}`. Danh sách
sắp xếp ổn định theo `(updated_at DESC, id DESC)`, phân trang bằng cursor Base64URL và
trả `last_message` mới nhất chưa soft delete theo batch query. `limit` mặc định 20, hợp
lệ từ 1 đến 50. Endpoint chi tiết kiểm tra membership, trả `403 FORBIDDEN` cho người
ngoài và `404 NOT_FOUND` cho conversation không tồn tại/đã soft delete. Do TC-26 đã
thuộc P2-T16, TC-59–TC-60 được nối sau ID lớn nhất để kiểm thử đúng P2-T14. Các ca
cursor/limit/session/soft-delete và toàn bộ 92 test Backend đều PASS.

P2-T15 triển khai protected `POST /conversations/{id}/messages`. UUID do client cấp là
idempotency key: cùng UUID, sender và conversation trả lại message gốc với `200`, không cập nhật
`conversation.updated_at` và không publish lại; UUID thuộc sender hoặc conversation khác trả
`409 CONFLICT`. Chỉ insert mới cập nhật `conversation.updated_at` và đăng ký publish
`NEW_MESSAGE` sau khi transaction database commit thành công. Realtime dùng Redis channel
`messaging:user:{recipientUserId}` với payload `{"type":"NEW_MESSAGE","data":{...}}`.
Redis Pub/Sub hiện là best-effort: lỗi publish được ghi log và metric
`messaging.redis.publish.failures`, không làm API thất bại hay rollback message; client đồng bộ
lại qua message history khi reconnect. Transactional outbox chưa thuộc phạm vi P2-T15. TC-23–TC-25,
2 unit test publisher và toàn bộ 99 test Backend đều PASS.

P2-T16 triển khai protected `GET /conversations/{id}/messages`, mặc định 30 và tối đa 100
message/trang. Trang đầu lấy nhóm mới nhất bằng truy vấn giảm dần, sau đó đảo về
`(client_timestamp ASC, id ASC)` trong response. `prev_cursor` dùng cặp
`(client_timestamp, message_id)` để tải trang cũ hơn ổn định, kể cả khi timestamp trùng nhau.
Truy vấn chỉ lấy message có `deleted_at IS NULL` và endpoint kiểm tra active session,
conversation tồn tại cùng membership. TC-26 và các ca cursor/limit/quyền/soft-delete đều PASS.
Toàn bộ 103 test Backend đều PASS.

P2-T17 triển khai protected `PUT /conversations/{id}/messages/{messageId}`. Chỉ recipient
được tăng status theo các bước `sent → delivered`, `sent → read`, `delivered → read`; sender
và user ngoài conversation nhận 403. Resource thiếu/soft-delete hoặc message không thuộc đúng
conversation nhận 404. Cùng status trả 200 nhưng không đổi `updated_at`/không publish; downgrade
trả 400 và giữ nguyên dữ liệu. Update thực sự dùng pessimistic lock, không chạm
`conversation.updated_at`, và chỉ sau DB commit mới publish `MESSAGE_STATUS_UPDATE` best-effort
tới channel của cả sender lẫn recipient. Lỗi Redis được ghi log/metric và không làm API thất bại.
TC-27–TC-28, các ca bổ sung trong phạm vi status và toàn bộ 112 test Backend đều PASS.

P2-T18 Bước 1 đăng ký `/ws/messaging` với raw Spring WebSocket. Security chain cho phép
request handshake đi tới interceptor riêng; interceptor chỉ chấp nhận access token hợp lệ,
chưa blacklist/global-revoke và thuộc user chưa soft-delete, sau đó lưu claims cần thiết vào
session attributes. Handshake lỗi trả HTTP 401 trước upgrade. Allowed origins lấy từ
`CORS_ALLOWED_ORIGINS`; text frame limit là 32 KiB để bao phủ envelope message tối đa.
Hai logger framework có thể in URI/session đầy đủ bị khóa ở INFO để không lộ JWT query token.

P2-T18 Bước 2 bổ sung registry in-memory theo `userId → nhiều session`, bọc từng session
bằng concurrent-send decorator và dọn đúng session/task khi đóng. Server gửi `PING` ngay khi
kết nối rồi mỗi 30 giây; hai lần liên tiếp không có `PONG` đóng code 4003. Timer hết hạn và
blacklist/global-revocation recheck đóng code 4002. Redis recheck lỗi không đóng socket:
backend ghi exception, tăng metric `messaging.websocket.auth.recheck.failures` và thử lại ở
heartbeat sau.

P2-T18 Bước 3 static-subscribe `messaging:user:*` trên từng Backend instance. Redis envelope
hợp lệ được fan-out nguyên văn tới mọi session local của user lấy từ channel; `NEW_MESSAGE`
giữ đủ các field của `MessageResponse`, còn `MESSAGE_STATUS_UPDATE` giữ `{id,status}`.
`CALL_INCOMING` đã sẵn đường pass-through, nhưng endpoint phát event vẫn thuộc P3-T04.
Redis/listener lỗi giữ nguyên WebSocket, tăng `messaging.redis.subscribe.failures` và chuyển
health `messagingRedisSubscriber` sang `DEGRADED`; Lettuce reconnect và event hợp lệ kế tiếp
đưa health về `UP`. Lỗi gửi một session tăng `messaging.websocket.delivery.failures`, đóng
riêng session đó bằng 1011 và không chặn các session còn lại.

P2-T18 Bước 4 xử lý inbound `PONG`, `TYPING` và `TYPING_STOP`. Typing yêu cầu
`data.conversation_id`, conversation active và sender là thành viên; chỉ recipient nhận event
qua Redis, sender không nhận echo và `conversation.updated_at` không đổi. Missing,
soft-delete và non-member dùng cùng `ERROR/FORBIDDEN`. JSON/schema sai trả
`VALIDATION_ERROR`, type lạ trả `UNSUPPORTED_EVENT`; lỗi lần thứ ba đóng riêng connection
bằng 1008. Container giới hạn text frame 32 KiB và đóng 1009 khi vượt ngưỡng.

P2-T18 có regression guard cho test isolation: bean cấu hình giới hạn text frame chỉ được
tạo khi `ServletContext` thật có Jakarta `ServerContainer`. MockMvc context không có
container sẽ bỏ qua riêng bean này; đăng ký handler và nghiệp vụ WebSocket không thay đổi.

P2-T19 dùng `io.minio:minio:8.5.17`, resolve OkHttp 4.12.0 và không override Kotlin do
Spring Boot quản lý. `MinioClient` bind cấu hình từ environment. TC-69 chỉ chạy khi đặt
`MINIO_INTEGRATION_TEST=true`; test tạo bucket random tách biệt `MINIO_BUCKET`, upload và
tải dữ liệu thật qua presigned URL rồi xóa object/bucket. Khi nghiệm thu P2-T19, TC-69 đã
chạy với MinIO thật, không skip; toàn bộ 155 test Backend PASS.

MinIO 8.5.17 công khai low-level multipart qua `MinioAsyncClient`:
`createMultipartUploadAsync`, `uploadPartAsync`, `completeMultipartUploadAsync` và
`abortMultipartUploadAsync`. P2-T19 không triển khai multipart. Trước P2-T20 phải spike
cách dùng các public async API này; không phụ thuộc tùy tiện vào protected/internal API
hoặc tạo adapter kế thừa `MinioClient`.

P2-T24 triển khai `GET/PUT/DELETE /videos` (cursor pagination `(created_at, id)`, đổi tên,
xóa mềm giảm quota ngay nếu `ready`, presigned view_url 1h khi `ready`) và hoàn thiện phần
abort recording khi xóa tài khoản đã hoãn từ P2-T08. Migration V3 thêm `videos.upload_id`
(bản bền vững của MinIO upload_id, vì Redis session có TTL) và bảng `video_cleanup_jobs`
dùng CHUNG cho hai nguồn lỗi: abort-multipart khi xóa tài khoản và orphan-object-removal
của `VideoTimeoutCleanupJob` (gánh luôn TODO cũ của P2-T22, không còn TODO mồ côi trong
code). `VideoAccountCleanupService` chạy sau khi soft-delete/revoke token của
`UserAccountService.deleteAccount` đã commit; mỗi video xử lý trong transaction
`REQUIRES_NEW` riêng (qua bean phụ `VideoCleanupTransactionSupport` để tránh
self-invocation) nên lỗi MinIO không rollback việc xóa tài khoản và ngược lại. `upload_id`
không xác định (video 'recording' tạo trước V3 và Redis session cũng hết hạn) thì soft-delete
mà bỏ qua abort MinIO — hành vi chấp nhận cho MVP, có thể để lại multipart mồ côi hiếm gặp
cần rà soát thủ công. `VideoCleanupRetryJob` poll job đến hạn mỗi phút (cấu hình
`video.cleanup-job-*`), backoff nhân đôi từ 60s, tối đa 10 lần rồi chuyển
`FAILED_PERMANENT`; `MinioMultipartStorage.abortMultipartUpload` coi MinIO `NoSuchUpload`
là thành công để tránh lặp vô hạn khi retry một job đã thực ra xong việc. TC-34–TC-37 và
toàn bộ 213 test Backend đều PASS.

### Module metrics

| Đường dẫn | Nội dung |
|---|---|
| `backend/src/main/java/com/veiltalk/metrics/MetricsController.java` | `POST /metrics/client`, lấy userId từ `Authentication` |
| `backend/src/main/java/com/veiltalk/metrics/MetricsService.java` | Parse timestamp ISO 8601 (400 nếu sai định dạng), kiểm rate limit rồi ghi log có cấu trúc — không lưu DB |
| `backend/src/main/java/com/veiltalk/metrics/MetricsRateLimiter.java` | Redis fixed-window 1 request/3 giây/user, cùng cơ chế `UserSearchRateLimiter` |
| `backend/src/main/java/com/veiltalk/metrics/MetricsClientRequest.java` | DTO request; `session_type` chỉ nhận `call`/`preview`, `webrtc_rtt_ms` optional kể cả khi `session_type=call` |
| `backend/src/test/java/com/veiltalk/metrics/MetricsClientIntegrationTests.java` | Integration test 204/400/401/429 theo mẫu `UserSearchIntegrationTests` |

P2-T25 triển khai `POST /metrics/client` (NFR-22). Log dùng prefix cố định `CLIENT_METRICS`
và field `key=value` (`user_id`, `session_type`, `tracking_latency_ms`, `fps`,
`webrtc_rtt_ms`, `client_timestamp`) để có thể grep lại và phát hiện vi phạm
NFR-01/02/03 trong môi trường thực; không dùng hệ metrics (Micrometer) riêng, chỉ log.
Rate limit dùng chung pattern Redis fixed-window với `UserSearchRateLimiter` nhưng
window 3 giây/max 1 request thay vì 1 phút/10 request. Toàn bộ 220 test Backend PASS.

## Signaling Server

| Đường dẫn | Nội dung |
|---|---|
| `signaling/package.json` | Node.js project và scripts `start`, `check`, `test` |
| `signaling/package-lock.json` | Khóa phiên bản dependency |
| `signaling/src/index.js` | Entry-point: đọc `PORT`/`SIGNALING_JWT_SECRET` từ env rồi gọi `createServer()` |
| `signaling/src/server.js` | `createServer({ port, jwtSecret, log })` — WebSocketServer tại `/ws/signaling`; validate JWT ở `connection` handler, reject bằng close code 4001 (khác Messaging WS dùng HTTP 401 trước upgrade — mục 10.2 API); map `userId → Set<WebSocket>` (`connectionsByUserId`) dùng cho relay ở P3-T02 |
| `signaling/src/auth.js` | `verifyAccessToken(token, secret)` (HS256, chỉ chấp nhận `type: "access"`), `extractToken(url)` đọc query param `token` duy nhất |
| `signaling/src/server.test.js` | `node:test` — TC-48/TC-49, cleanup connection map khi disconnect |
| `signaling/src/auth.test.js` | `node:test` — verify token thật ký bằng `SIGNALING_JWT_SECRET` đọc từ `.env`, đối chiếu `JWT_SECRET`/`SIGNALING_JWT_SECRET` phải giống nhau trong `.env` |
| `signaling/Dockerfile` | Image Node.js 24 Alpine, cài production dependencies và chạy entry-point |

Dependencies nền tảng: `ws` 8.21.1, `jsonwebtoken` 9.0.3 và `dotenv` 17.4.2 — không thêm thư viện test (dùng `node:test`/`node:assert` built-in theo AGENTS.md).
P0-T04 đã được xác minh bằng `npm run check` và `npm start`.
P3-T01 (WebSocket server với JWT auth) hoàn thành: `npm test` — 11/11 test PASS.

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

### API client (P4-T01)

| Đường dẫn | Nội dung |
|---|---|
| `frontend/src/lib/api/client.ts` | Core `request<T>()` dùng `fetch` gốc (không axios): gắn `Authorization` header, tự refresh access token khi 401 (khóa refresh bằng promise singleton chống gọi song song, chặn retry đệ quy vào `/auth/login`\|`/auth/register`\|`/auth/refresh`), map lỗi HTTP/network về `ApiError` |
| `frontend/src/lib/api/types.ts` | `ApiError`, `ErrorEnvelope`, type request/response theo từng nhóm endpoint trong API Design |
| `frontend/src/lib/api/endpoints/*.ts` | Hàm gọi API theo domain: `auth.ts`, `users.ts`, `avatars.ts`, `conversations.ts`, `videos.ts`, `metrics.ts` — màn hình import từ đây, không tự gọi `request()` trực tiếp |
| `frontend/src/lib/api/index.ts` | Barrel export cho toàn bộ `lib/api` |
| `frontend/src/lib/api/client.test.ts` | Test Vitest: gắn header, luồng refresh (thành công/thất bại/song song/chặn đệ quy), lỗi mạng, error envelope, 204 |
| `frontend/src/vite-env.d.ts` | Khai báo type `import.meta.env.VITE_API_BASE_URL` |

`client.ts` **không tự đọc token từ đâu cả** — nhận qua `configureAuthHooks({ getAccessToken,
getRefreshToken, onTokensRefreshed, onAuthFailure })`, một setter module-level. P4-T02 (authStore)
sẽ gọi hàm này lúc khởi tạo store để "cắm dây" vào state thật; nhờ vậy P4-T01 không phụ thuộc
P4-T02 và không có circular import. Refresh chỉ **reactive** (khi nhận 401), chưa làm proactive
refresh theo `expires_in` — nếu cần sau này thì mở rộng ở `client.ts`, không đổi interface
`configureAuthHooks`.

Base URL đọc từ `VITE_API_BASE_URL`, fallback `http://localhost:8080` khi chưa set biến môi
trường — **không có tiền tố `/api`**, khớp cách backend map route thật (xem sửa đổi
`docs/04_API.md` mục 1.2, phát hiện khi chạy smoke test P4-T01 với backend thật: doc gốc ghi
nhầm `/api` nhưng `AuthController`/`SecurityConfig` không có `context-path`).

P4-T01 đã được xác minh bằng `npm run build`, `npx tsc -b` và `npx vitest run` (9/9 test PASS).

### Auth store (P4-T02)

| Đường dẫn | Nội dung |
|---|---|
| `frontend/src/lib/store/authStore.ts` | Zustand store: `{ user, accessToken, status, isLoading, login, register, logout, restoreSession }`; đăng ký `configureAuthHooks` của `client.ts` ngay khi module load |
| `frontend/src/lib/store/authStore.test.ts` | Test Vitest: login/register thành công và lỗi, `restoreSession` có/không refresh token, refresh token hết hạn, logout best-effort, `onAuthFailure` qua `client.ts` thật |

`status` có 3 giá trị: `idle` (chưa xác định lúc khởi động, tránh router redirect
vội về `/login` trong khi `restoreSession` đang chạy), `authenticated`,
`unauthenticated`. Không có field `isAuthenticated` riêng — derive từ `status`.

Access token chỉ ở Zustand state (memory). Refresh token nằm ở biến module-level
`refreshTokenRef` **và** `sessionStorage` (key `veiltalk_refresh_token`) — quyết
định có ý thức, không phải mặc định:

- Phương án đã cân nhắc và loại bỏ: refresh token cũng chỉ ở memory (giống access
  token) — an toàn hơn trước XSS (không script nào đọc qua Storage API) nhưng mất
  session mỗi lần F5, bắt đăng nhập lại liên tục — không chấp nhận được cho app
  nhắn tin/gọi video dùng thường xuyên.
- Chọn `sessionStorage`: vẫn đọc được qua XSS như `localStorage`, nhưng tab-scoped
  và tự xóa khi đóng tab/trình duyệt — giảm cửa sổ tấn công so với `localStorage`
  (không tồn tại lâu dài trên đĩa). Không dùng `localStorage` trong mọi trường hợp.
- Giới hạn đa tab đã biết, chấp nhận cho MVP: `logout()` ở tab A không đồng bộ
  ngay sang tab B (mỗi tab có `sessionStorage` riêng) — tab B vẫn coi là đăng
  nhập tới khi access token hết hạn (tối đa 15 phút) rồi tự refresh thất bại.
  Backlog nếu cần đồng bộ tức thời: `BroadcastChannel` hoặc lắng nghe storage
  event — chưa làm, chưa cần cho MVP.

`restoreSession()` (gọi một lần lúc app khởi động, ví dụ từ Splash SCR-01 ở
P4-T06): đọc refresh token từ `sessionStorage` → gọi `/auth/refresh` lấy access
token mới → gọi `GET /users/me` lấy lại `user` (cũng mất sau F5) → `status:
"authenticated"`. Không có refresh token hoặc refresh thất bại → `status:
"unauthenticated"` ngay, không giữ `idle`.

Store **không tự điều hướng router** khi `onAuthFailure`/logout — chỉ set
`status: "unauthenticated"`; component/router tự lắng nghe và redirect về
`/login`, tránh coupling store vào một router cụ thể.

Test dùng `MemoryStorage` tự viết (implements `Storage`) thay vì cài `jsdom`,
vì môi trường test hiện chạy Node thuần (không cấu hình jsdom trong
`vite.config.ts`) và AGENTS.md yêu cầu hỏi trước khi thêm thư viện mới.

Toàn bộ 16 test Frontend (client.ts + authStore) và `npx tsc --noEmit` PASS.

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
