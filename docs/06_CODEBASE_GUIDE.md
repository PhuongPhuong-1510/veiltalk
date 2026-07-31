# 06 — Bản đồ Codebase

> **Trạng thái: đang thực hiện Phase 4 — P4-T01 đến P4-T09 đã hoàn thành; P4-T10 Phase 3A đã implement, Phase 3B Hand forearm twist đang làm và chưa qua webcam acceptance.**
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
| `frontend/src/App.tsx` | Router Phase 4: Splash/Welcome/Login/Register/Onboarding/Avatar Setup; nối auth lifecycle và Messaging WS; lazy-load route DEV `/dev/tracking` và `/dev/avatar-renderer` chỉ khi `import.meta.env.DEV` |
| `frontend/src/App.css` | Layout responsive và interaction states cho Splash/Welcome/Login; hình học và breakpoint bám nguyên prototype Kokoro đã duyệt |
| `frontend/src/lib/tracking/` | P4-T09: camera lifecycle, MediaPipe runtime dùng chung fileset, raw tracking contract local-only, mapper, cadence, metrics và test |
| `frontend/src/components/dev/TrackingDevHarness.tsx` | Harness webcam thật tại `/dev/tracking`; overlay landmark local-only, chọn 720p/480p, CPU/GPU, từng task/cả ba, state ratio/loss counter; lazy-load chỉ DEV, không capture/upload |
| `frontend/public/mediapipe/` | WASM 0.10.35 và ba model Face/Hand/Pose self-host cùng origin; provenance/checksum ở Deployment Guide mục 5.5 |
| `frontend/src/lib/avatar-motion/avatarPoseTypes.ts` | P4-T10: contract `AvatarPosePacketV1`; `jointRotations` là quaternion delta normalized-humanoid parent-local, rest-relative, không chứa raw landmark |
| `frontend/src/lib/avatar-motion/normalizedRigProfile.ts` | P4-T10 Phase 3A: profile plain-data có torso rest reference và anatomical rest basis local/world (primary, secondary, binormal); validate và deep-freeze |
| `frontend/src/lib/avatar-motion/jointSolver.ts` | P4-T10 Phase 2: solver parent-local/rest-relative theo thứ tự upper arm → lower arm mỗi bên; child dùng target world của parent trong cùng pose, không đọc animated renderer state |
| `frontend/src/lib/avatar-motion/avatarMotionProcessor.ts` | P4-T10 orchestration: Pose filter/solve/constraint/temporal, Hand matching/palm/twist, tracking epoch theo side và packet output; Hand chỉ được sửa lowerArm khi feature flag bật và observation hợp lệ. Phase 3E: upper/lower nghiệm thu độc lập (`chainGeometryValid` chỉ còn hỏi upper, `lowerGeometryValid` riêng) nên mất cổ tay không giết cánh tay trên; hand twist gate theo lower |
| `frontend/src/lib/avatar-motion/torsoBasis.ts` / `armFrameSolver.ts` | Phase 3A: per-segment direction validity tách khỏi pole/twist confidence; parallel-transport secondary; two-bone inferred elbow từ Pose shoulder/wrist với calibrated human lengths, reachability/confidence/timeout gate. Phase 3E: `inferElbow()` khóa phía gập bằng mỏ neo `previousElbowDirection`, ràng buộc giải phẫu theo `torso.right` (khuỷu luôn lệch ra ngoài thân, thắng mỏ neo lịch sử), prior pole có hạn tuổi và miễn timeout khi nghiệm tươi hoàn toàn |
| `frontend/src/lib/avatar-motion/armTemporalState.ts` | Phase 3A: temporal state riêng upper/lower trong shared arm state, phát rotation parent-local cho hold → return-to-identity → recovery. Phase 3E: giữ `previousElbowDirection` qua các frame làm mỏ neo phía gập |
| `frontend/src/lib/avatar-motion/swingTwist.ts` / `motionMath.ts` | Phase 3A foundation: basis/quaternion math và swing–twist round-trip; production clamp để Phase 3C |
| `frontend/src/lib/avatar-motion/avatarMotionDiagnostics.ts` | Diagnostic snapshot internal/DEV-only, tách khỏi `AvatarPosePacketV1`; chứa arm geometry/stability và toàn bộ chuỗi Hand twist theo side |
| `frontend/src/lib/avatar-motion/coordinateAdapter.ts` | P4-T10: production conversion giữ nguyên `(x,y,z) → (x,-y,-z)`, normalize vector/quaternion và chống zero/NaN |
| `frontend/src/lib/avatar-motion/oneEuroFilter.ts` / `jointConstraints.ts` / `trackingLoss.ts` | Lọc direction và safety radial clamp; semantic anatomical calibration để Phase 3C |
| `frontend/src/lib/avatar-motion/handPoseMatching.ts` / `handPalmBasis.ts` / `handMotionDiagnostics.ts` | Phase 3B input: ghép Hand candidate với wrist Pose, dựng image/world palm basis và xuất diagnostic không tham gia motion |
| `frontend/src/lib/avatar-motion/handForearmTwist.ts` / `handTwistConfidence.ts` | Phase 3B geometry/trust: đo signed axial twist quanh forearm và quyết định trusted/influence từ quality, projection, age và handedness |
| `frontend/src/lib/avatar-motion/handTwistStabilization.ts` / `handTwistTemporal.ts` | Phase 3B state riêng từng side: unwrap, neutral, dead zone, filter, clamp, acquire/hold/fade/reset |
| `frontend/src/lib/avatar-motion/handTwistRig.ts` | Phase 3B coordinate/rig boundary: đổi toàn bộ world palm basis sang motion frame trước solver và ghép `poseLowerDelta × handTwistDelta` quanh primaryLocal |
| `frontend/src/lib/avatar-motion/handCalibrationAnalysis.ts` / `handTwistRootCauseValidation.test.ts` | Phase 3B calibration snapshot, synthetic geometry và rig-only regression cho dấu, ±π, primary direction, wrist inheritance |
| `frontend/src/lib/avatar-renderer/modelLoader.ts` | P4-T10 Phase 2: load GLTF/VRM, `rotateVRM0`, lấy normalized humanoid nodes, capture rig profile theo từng model generation, chống stale load và dispose tài nguyên |
| `frontend/src/lib/avatar-renderer/avatarRenderer.ts` | P4-T10 Phase 2: tái tạo absolute local target bằng `restLocal × deltaLocal`, slerp absolute local nếu bật smoothing, gán normalized bone quaternion; giữ nguyên position/scale |
| `frontend/src/lib/avatar-renderer/animationFrameLoop.ts` / `rendererMetrics.ts` / `renderSmoothing.ts` | P4-T10: một rAF loop có duplicate guard, metrics FPS/p95/resource và smoothing frame-rate-independent |
| `frontend/src/lib/avatar-renderer/avatarDiagnostics.ts` | P4-T10 Phase 1/2 DEV-only: rest-basis, angular error, helpers, nine frozen presets và phép đo world direction từ rig profile |
| `frontend/src/components/avatar/AvatarCanvas.tsx` | React adapter sở hữu canvas, `ResizeObserver` và renderer lifecycle; không chứa IK math |
| `frontend/src/components/dev/AvatarRendererDevHarness.tsx` | Harness local-only tại `/dev/avatar-renderer`; freeze webcam, axes/vector helpers và toggle filter/constraint/hand-twist/smoothing; coordinate diagnostic cố định theo convention production, không còn preset/replay/manual-neutral/Hand Calibration hoặc bảng H1/H3/H6 legacy; route bị loại khỏi production build |
| `docs/P4_T10_PHASE1_DIAGNOSTICS_REPORT.md` | Báo cáo nghiệm thu forensic Phase 1: model/rest basis, bằng chứng H1–H3, calibration webcam H6, deterministic replay, privacy và đề xuất Phase 2 chưa triển khai |
| `docs/P4_T10_PHASE2_ACCEPTANCE_REPORT.md` | Báo cáo review/nghiệm thu Phase 2: H1 fixed, H2 còn mở, deterministic real-model evidence, automated/browser/privacy/lifecycle evidence và điều kiện chuyển phase |
| `docs/P4_T10_PHASE3A_ACCEPTANCE_REPORT.md` | Phase 3A arm-frame evidence; automated gate và trạng thái manual browser pending |
| `docs/P4_T10_PHASE3B_HAND_TWIST_STATUS_AND_PLAN.md` | Nguồn trạng thái/kế hoạch Phase 3B: phạm vi Hand forearm twist, file map, lỗi chiều xoay webcam còn mở và acceptance gate đa avatar |
| `docs/P4_T10_PHASE3E_PARTIAL_ARM_ACCEPTANCE_REPORT.md` | Phase 3E partial arm tracking: root cause đo được cho mất cổ tay / mất khuỷu, ràng buộc giải phẫu chống xuyên thân, config mới và manual webcam gate |
| `frontend/src/index.css` | Kokoro design system: Tailwind v4 theme, semantic CSS variables light/dark, typography, radius, shadow và reduced-motion baseline |
| `frontend/tsconfig.app.json` | Cấu hình TypeScript và alias `@/*` → `src/*` |
| `frontend/vite.config.ts` | Vite React plugin và alias `@` → `src` |

Dependencies nền tảng theo P0-T05: `three`, `@mediapipe/tasks-vision`, `zustand`,
`react-router-dom`, `tailwindcss`. Các thư viện mới chỉ được cài đặt; tích hợp tracking,
rendering, state, routing và design system thuộc các task Phase 4.

### Trạng thái triển khai Phase 4

| Task | Trạng thái | Code chính |
|---|---|---|
| P4-T01 | Hoàn thành | `frontend/src/lib/api/` — API client, endpoint modules, refresh dedupe và error mapping |
| P4-T02 | Hoàn thành | `frontend/src/lib/store/authStore.ts` — auth/session state và token lifecycle |
| P4-T03 | Hoàn thành | `frontend/src/lib/ws/messagingWS.ts` — Messaging WebSocket singleton, reconnect và handler registry |
| P4-T04 | Hoàn thành | `frontend/src/index.css`, `vite.config.ts` — Tailwind/design tokens/icon integration |
| P4-T05 | Hoàn thành | `frontend/src/lib/theme/` — light/dark/system provider |
| P4-T06 | Hoàn thành | `frontend/src/App.tsx`, `App.css` — Splash/Welcome/Login |
| P4-T07 | Hoàn thành | `frontend/src/App.tsx`, auth helpers — Onboarding/Register |
| P4-T08 | Hoàn thành | `frontend/src/lib/avatar/avatarSetup.ts`, Avatar Setup UI |
| P4-T09 | Hoàn thành | `frontend/src/lib/tracking/`, `TrackingDevHarness.tsx` |
| P4-T10 | IN PROGRESS | Phase 3A anatomical arm-frame đã implement. Phase 3B Hand forearm twist hoàn thành và được bật mặc định sau nghiệm thu webcam ngày 2026-08-01; Phase 3C chưa bắt đầu |

### Design system (P4-T04)

Tailwind v4 được nối vào Vite qua `@tailwindcss/vite`. `frontend/src/index.css` là nguồn
token phía code: primitive palette Kokoro, semantic utilities (`bg-bg-base`,
`text-text-primary`, `border-border-subtle`, `text-accent-primary`, ...), type utilities
`type-display-*`/`type-text-*`, radius và shadow. `:root` chứa light theme; `.dark` override
semantic variables cho dark theme. P4-T05 chịu trách nhiệm chọn theme và gắn class `.dark`.
Component phải dùng semantic token; primitive color chỉ dùng khi khai báo design system.

Tên `accent-secondary` trong code tương ứng `accent-2` trong `docs/05_UI_UX.md` mục 2.1 —
cùng một token, giữ tên `accent-secondary` vì đã dùng nhất quán trong `index.css`; tài liệu
đã ghi chú alias, không tạo token thứ hai.

Radius (`--radius-sm` → `--radius-2xl`, cộng `--radius-full: 9999px`) khai báo trong `@theme`
vì là thuộc tính hình học, không đổi theo theme (đúng `docs/05_UI_UX.md` mục 2.4). Bốn token
shadow (`--shadow-sm`, `--shadow-md`, `--shadow-glow`, `--shadow-avatar`) khai báo trong
`@theme inline`, trỏ tới biến trung gian `--shadow-token-*` định nghĩa riêng ở `:root` (light)
và `.dark` — giống cách các semantic color khác đã làm — để giá trị đổi thật theo theme thay vì
cố định một bộ dùng chung cho cả hai như trước P4-T04 follow-up. Giá trị khớp đúng bảng 2.4;
build production đã xác nhận `--shadow-token-*` sinh ra hai giá trị khác nhau tại `:root` và
`.dark` trong CSS output.

Font display là Manrope, font body là Inter. `lucide-react` được duyệt làm bộ icon cho các
màn hình Phase 4. P4-T04 được xác minh bằng `npm run build`, `npm run lint` và `npm test`
(34/34 test PASS).

### Theme provider (P4-T05)

| Đường dẫn | Nội dung |
|---|---|
| `frontend/src/lib/theme/ThemeProvider.tsx` | Provider đồng bộ auth/settings, theo dõi system theme, áp `.dark` lên `<html>` và lưu thay đổi qua API |
| `frontend/src/lib/theme/ThemeContext.ts` | Context cùng hook `useTheme()`; trả `theme`, `resolvedTheme`, `setTheme()` |
| `frontend/src/lib/theme/theme.ts` | Type và hàm thuần resolve/apply theme, tách khỏi React để test không cần DOM |
| `frontend/src/lib/theme/ThemeProvider.test.ts` | Unit test explicit/system resolution và thao tác class/color-scheme |

`ThemeProvider` mặc định dùng `system`, lắng nghe thay đổi từ
`matchMedia('(prefers-color-scheme: dark)')` và không lưu preference trong browser storage.
Khi auth store chuyển sang `authenticated`, provider gọi `GET /users/me/settings`; `setTheme()`
áp dụng lạc quan rồi gọi `PUT /users/me/settings`, rollback nếu API lỗi. Logout đưa theme về
`system`. `frontend/src/main.tsx` bọc toàn ứng dụng bằng provider. P4-T05 được xác minh bằng
build, lint và 38/38 test Frontend PASS.

### Splash, Welcome và Login (P4-T06)

`frontend/src/App.tsx` dùng React Router với `/` (Splash), `/welcome`, `/login`,
`/register` và `/home`. Hai route cuối là placeholder Kokoro có ghi rõ task P4-T07/P4-T12,
không còn nội dung starter Vite. Splash gọi `authStore.restoreSession()`, giữ animation tối
thiểu 2 giây theo UI/UX rồi điều hướng session hợp lệ tới Home, còn session thiếu/hết hạn tới
Welcome. Welcome là bổ sung được chủ dự án duyệt từ prototype Kokoro.

Không tự “chuẩn hóa lại” tỷ lệ màn hình khi chuyển prototype: các giá trị width/height,
grid ratio, padding, transform, object-position và breakpoint của Welcome/Login trong
`App.css` được giữ theo file giao diện chủ dự án cung cấp. Chỉ auth state, router, API,
error/loading và accessibility được nối vào markup.

Login gọi `authStore.login()`, hỗ trợ password manager autocomplete, show/hide password,
loading/disabled state và luôn dùng một error banner chung cho mọi lỗi để chống dò tài khoản.
Logic route/error thuần nằm tại `frontend/src/lib/auth/authFlow.ts` và được unit test không cần
DOM. P4-T06 được xác minh bằng build, lint, HTTP smoke `/` + `/welcome` và 41/41 test PASS.

### Onboarding và Register (P4-T07)

`/onboarding` gồm ba slide theo UI/UX: CTA tiếp theo, Bỏ qua, dots navigation và swipe ngang
trên touch device. Visual dùng asset Kokoro hiện có; slide privacy nhấn mạnh ảnh khuôn mặt
không rời thiết bị. Welcome và link đăng ký từ Login đều đi qua Onboarding; slide cuối hoặc
Bỏ qua chuyển tới `/register`.

Register tái dùng auth frame Kokoro, chỉ gửi ba field API hỗ trợ: `email`, `password`,
`display_name`. Không có username phía client vì backend/database không có field tương ứng.
Form dùng `authStore.register()` → `POST /auth/register`; thành công chuyển tới
`/avatar/setup` placeholder P4-T08. Password strength có 4 segment; submit chỉ bật khi email,
mật khẩu (>= 8, chữ hoa, số) và display name hợp lệ. HTTP 409 hiển thị lỗi inline dưới email;
lỗi khác dùng banner form. Helper validation/error mapping nằm tại
`frontend/src/lib/auth/authFlow.ts`. P4-T07 được xác minh bằng build, lint và 44/44 test PASS.

### Chọn model avatar (P4-T08)

`/avatar/setup` gọi public `GET /avatars/models` qua `avatarsApi.getModels()`, có loading,
error và retry. Grid giữ layout prototype Kokoro: 3 cột desktop, 2 cột tablet/mobile;
selected state có border, glow, checkmark và CTA chỉ bật sau khi chọn. Model ID được encode
vào `/avatar/customize?model=...`; P4-T08 chưa gọi PUT và chưa lưu avatar.

Catalog backend hiện đọc `backend/src/main/resources/avatar-models.json`, không phải database.
Các `thumbnail_url`/`model_url` dùng domain `cdn.veiltalk.example.com` placeholder. Trong giai
đoạn này, `frontend/src/lib/avatar/avatarSetup.ts` nhận diện domain `.example.com` và dùng sáu
asset local đã duyệt làm thumbnail fallback; ID, tên và customization metadata vẫn luôn lấy từ
API. Khi URL CDN thật được cấu hình, helper tự giữ URL backend mà không cần đổi UI. P4-T08 được
xác minh bằng build, lint và 47/47 test PASS.

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

### WebSocket service — Messaging (P4-T03)

| Đường dẫn | Nội dung |
|---|---|
| `frontend/src/lib/ws/messagingWS.ts` | Module-level singleton: `connectMessagingWS()`, `disconnectMessagingWS(reason?)`, `sendTyping(conversationId)`, `sendTypingStop(conversationId)`, `onMessage(type, handler)`, `onStatusChange(handler)` |
| `frontend/src/lib/ws/messagingWS.test.ts` | Test Vitest: mock `WebSocket` global tối thiểu + `vi.useFakeTimers()`, mock `refreshAccessToken` qua `vi.mock("../api")`, dùng `authStore` thật (set state trực tiếp) |

Dùng WebSocket API gốc của trình duyệt, không thêm thư viện (theo AGENTS.md). Chỉ một
socket dùng chung toàn app — component không tự connect/disconnect, chỉ đăng ký/hủy đăng
ký handler qua `onMessage()` (trả về hàm unsubscribe). Vòng đời connect/disconnect nằm ở
App root, kích hoạt theo `authStore.status` (xem dưới), tách khỏi vòng đời component.

**Auth:** đọc `useAuthStore.getState().accessToken` ngay trước mỗi lần mở `new WebSocket()`
— không cache token trong closure. Backend từ chối handshake bằng HTTP 401 **trước khi
upgrade** khi token thiếu/sai/hết hạn (TC-47, API mục 10.1); giới hạn của WebSocket API là
browser không lộ status code thật cho `close` event xảy ra ở giai đoạn đó. Heuristic dùng:
nếu `close` xảy ra trong <1s sau khi mở và chưa từng nhận message nào → nghi auth fail →
gọi `refreshAccessToken()` (export mới từ `client.ts`, xem dưới) một lần rồi mới vào chuỗi
reconnect bình thường. Nếu refresh cũng fail, `onAuthFailure` (hook đã có từ P4-T01/T02) tự
chuyển `authStore.status` sang `unauthenticated`, việc reconnect tự dừng.

**Reconnect:** exponential backoff + jitter — `delay = min(1000 * 2^attempt, 30000) *
(0.8~1.2)`, tối đa 10 lần thử rồi phát `onStatusChange('closed')` cho UI tự hiện banner/nút
thử lại thủ công. Mỗi lần thử đọc lại token mới nhất từ `authStore` (không dùng token cache
cũ). Subscribe `useAuthStore.subscribe(...)`: khi `status` chuyển `unauthenticated` (logout
hoặc `onAuthFailure`) thì hủy timer đang chờ và đóng socket ngay, không đợi tới lượt kiểm
tra tiếp theo — tránh race giữa timer treo và logout.

Nhóm close code coi là "cần reconnect": `1006` (mất mạng), `1011`/`1001` (lỗi/tắt server),
`4002` (token hết hạn giữa chừng), `4003` (**xác nhận từ API mục 10.1: chỉ là timeout
heartbeat — không nhận PONG cho 2 lần PING liên tiếp, KHÔNG phải lỗi cố ý về quyền/token
như 4002** — thường do tab bị browser throttle ở background). Chỉ `1000` (client tự đóng,
gồm cả trường hợp logout) là không reconnect.

**Nhận message:** `JSON.parse` trong `try/catch`; parse lỗi hoặc `type` không nằm trong tập
đã biết (`NEW_MESSAGE`, `MESSAGE_STATUS_UPDATE`, `CALL_INCOMING`, `PING`, `ERROR`) → log
cảnh báo, bỏ qua, không throw. `PING` tự trả `PONG` nội bộ, không emit ra ngoài. Mỗi handler
đăng ký qua `onMessage` được gọi trong `try/catch` riêng — một handler lỗi không chặn các
handler khác hay crash service.

`refreshAccessToken` được export thêm từ `client.ts`/`api/index.ts` (trước đó chỉ dùng nội
bộ cho luồng 401-retry của `request()`) để `messagingWS.ts` tái dùng đúng cơ chế refresh
(và `refreshPromise` dedupe sẵn có) thay vì tự viết lại hoặc gọi một API bất kỳ chỉ để kích
side-effect refresh.

Toàn bộ 13 test `messagingWS.ts` + 30 test Frontend và `npx tsc --noEmit` PASS.

### Vòng lặp tracking

P4-T09 phát `RawTrackingFrameV1` theo camera cadence. P4-T10 không xếp FIFO: motion
processor tạo target packet mới nhất, còn renderer dùng đúng một `requestAnimationFrame`
loop độc lập và tiếp tục vẽ khi chưa có target mới. `not-sampled` giữ sample còn fresh,
khác với `lost`; One Euro Filter không update bằng cached sample.

### Bộ dựng hình nhân vật

P4-T10 dùng `GLTFLoader + VRMLoaderPlugin`; VRM dùng humanoid/expression API chuẩn, còn
GLB/glTF thường chỉ nhận mapping từ `AvatarModelRigProfile` đã kiểm chứng, không suy đoán
node name. Thư mục local `frontend/public/models/avatars/` hiện có ba model thử nghiệm:
`reference-avatar.vrm`, `reference-avatar-1.vrm` và `reference-avatar-2.vrm`. Loader capture
normalized humanoid rig profile mới theo mỗi model generation; motion state cũ không được dùng
lại sau reload. Có file không đồng nghĩa model đã qua acceptance: từng model phải có humanoid
upper/lower arm hợp lệ, rest basis finite và chạy cùng deterministic/webcam matrix. Các binary
local này chưa được coi là asset production và không được commit/redistribute khi chưa xác minh
license/metadata riêng cho từng file.

Các thư mục avatar/tracking quan trọng:

| Thư mục | Vai trò và ranh giới |
|---|---|
| `frontend/src/lib/tracking/` | Sở hữu camera, MediaPipe runtime, cadence, raw local-only landmarks và tracking metrics; không render VRM |
| `frontend/src/lib/avatar-motion/` | Chuyển raw tracking thành `AvatarPosePacketV1`; sở hữu coordinate convention, rig-independent math, Pose/Hand temporal state và diagnostics |
| `frontend/src/lib/avatar-renderer/` | Load/dispose VRM, capture rig profile và áp packet lên normalized humanoid; không đọc webcam/raw landmarks |
| `frontend/src/components/avatar/` | React lifecycle adapter cho canvas/renderer; không chứa solver math |
| `frontend/src/components/dev/` | Harness DEV-only cho tracking/renderer, freeze và diagnostics; không được dùng như production UI |
| `frontend/public/mediapipe/` | WASM và Face/Hand/Pose task self-host cùng origin; raw frame không rời trình duyệt |
| `frontend/public/models/avatars/` | Model VRM local phục vụ kiểm thử nhiều rig; không mặc nhiên là asset được phép phân phối |

P4-T10 được chia thành các phase con để không trộn forensic diagnosis với sửa production:

1. **Phase 1 — Forensic diagnostics: HOÀN TẤT.** H1 world-like quaternion gán vào local và
   H2 one-vector twist ambiguity được xác nhận; H3 rest-axis và H6 coordinate conversion bị
   bác bỏ. Báo cáo: `docs/P4_T10_PHASE1_DIAGNOSTICS_REPORT.md`.
2. **Phase 2 — Parent-local, rest-relative retargeting: HOÀN TẤT CÓ ĐIỀU KIỆN.** Normalized
   rig profile được capture theo model generation. Solver tính `targetWorld`, chuyển bằng
   `inverse(parentTargetWorld)`, phát `deltaLocal`; renderer áp `restLocal × deltaLocal`.
   Sáu preset bắt buộc cùng `bothForward`, `twistReferenceA/B` đạt sai số `0.00°` trên model
   tham chiếu với filter/constraint/smoothing tắt. Full suite 106/106, targeted 30/30,
   lint và build PASS. Báo cáo: `docs/P4_T10_PHASE2_ACCEPTANCE_REPORT.md`.
3. **Phase 3A — Anatomical arm-frame: IMPLEMENTED, MANUAL GATE PENDING.** Production solver
   dựng target frame từ primary bone direction và elbow-offset pole; image-space bounds và
   visibility reject landmark ngoài khung theo từng tay. Near-straight/depth-degenerate dùng
   normalized offset, projected previous/rest pole, pole filter và time-based hysteresis. Torso basis chỉ làm semantic reference, không animate
   chest. Processor phát rotation thật qua hold/return/recovery và idle identity; state tách
   trái/phải. Diagnostics không đi vào packet. `headRotation` giữ legacy/unverified và bị
   loại khỏi arm acceptance.

4. **Phase 3B — Hand forearm twist: HOÀN THÀNH, BẬT MẶC ĐỊNH.**
   Matching, world palm basis, motion-frame conversion, confidence, stabilization, temporal và
   lowerArm quaternion composition đã có production wiring cùng automated regression. Tuy nhiên
   Người thực hiện đã xác nhận nghiệm thu webcam ngày 2026-08-01 và duyệt convention hiện tại để
   bật mặc định trong production/DEV harness. Setter vẫn được giữ để regression test Pose-only.
   Chi tiết và phạm vi Phase 3B nằm tại
   `docs/P4_T10_PHASE3B_HAND_TWIST_STATUS_AND_PLAN.md`.

5. **Phase 3C — Rig calibration/constraint extension: NOT STARTED.** Không dùng Phase 3C để che
   lỗi dấu/convention còn mở của Phase 3B; hand-bone orientation và finger bones vẫn ngoài phạm vi.

   **Sửa lỗi ổn định pole (trong phạm vi 3A, không lấn 3B/3C).** Ba lỗi gây xoắn/rung tay đã
   được sửa trong `armFrameSolver.ts`, mỗi lỗi có regression test được kiểm chứng bằng cách
   hoàn nguyên bản sửa để xác nhận test thật sự bắt được lỗi:
   - Outlier pole chỉ bị loại khi `flags.length > 0`, nên pole nhiễu lọt qua đúng lúc tracking
     sạch (không near-edge/depth-degenerate/weak-offset). Nay luôn loại theo ngưỡng vận tốc góc.
   - `poleFilter` chỉ chạy trên candidate tươi, khiến One Euro đóng băng suốt lúc pole bị loại
     rồi nhả một cú nhảy khi pole quay lại. Nay lọc cả pole `previous`; pole `rest` vẫn không
     đưa vào filter vì là hằng số suy từ rig, không phải quan sát.
   - `lowerSecondary` luôn ưu tiên parallel transport kể cả khi lịch sử đã quá
     `poleFallbackTimeoutMs`, làm cẳng tay xoắn độc lập với cánh tay trên sau đợt mất theo dõi
     dài. Nay transport chỉ dùng khi còn trong thời hạn đó.

   Hysteresis `elbowOffsetEnterMagnitude`/`ExitMagnitude` có tên đọc ngược với vai trò thực tế
   (Enter dùng cho trạng thái "đang trong", Exit cho "đang ngoài"); chiều hoạt động hiện đúng,
   đã ghi comment cảnh báo, đổi tên để dành cho Phase 3C.

4. **Các phase tiếp theo: CHƯA TRIỂN KHAI.** Palm orientation/recovery, twist distribution,
   semantic anatomical constraints, calibration và full lifecycle/performance acceptance
   phải được duyệt riêng; không được coi là hoàn thành nhờ Phase 3A.

Browser real-model evidence đã có cho deterministic presets và webcam ổn định khi nhìn đủ
vai–khuỷu–cổ tay ở Phase 2. Phase 3A manual gate chưa chạy lại vì browser-control unavailable;
hand/palm loss vẫn chưa xử lý. Reload 10 lần và
background/resume chưa có runtime evidence đủ để tuyên bố không leak. Vì vậy P4-T10 vẫn
`IN PROGRESS`.

**Phân biệt hai nguồn lỗi: hướng xương và twist.** Preset `bothForward` cho `depthAlignment = 1.0`
và `elbowOffset = 0` — tệ nhất theo mọi tiêu chí của solver — nhưng vẫn render đúng. Lý do:
hướng xương dựng trực tiếp từ `elbow − shoulder` và `wrist − elbow` trong world landmark, không
cần pole; pole chỉ quyết định twist, mà tay duỗi thẳng thì twist gần như không nhìn thấy. Preset
nạp thẳng world landmark lý tưởng nên bỏ qua hoàn toàn khâu MediaPipe suy ra `z`.

Vì vậy hiện tượng "tay xoắn/rung trên webcam nhưng preset vẫn đẹp" **không phải** lỗi twist/pole
mà là **hướng xương lệch do `z` nhiễu**. Rig, solver và retargeting đã đúng — preset chứng minh.

**Model pose: `full` thay cho `lite`.** `pose_landmarker_lite` có sai số `z` lớn hơn `full` rõ rệt,
là nghi phạm chính của nhiễu hướng xương. `MediaPipeRuntime` nhận tham số `PoseModelVariant`
(`DEFAULT_POSE_MODEL = "full"`), truyền qua `TrackingPipelineOptions.poseModel` để so sánh trực
tiếp `lite` vs `full` trên dev harness. Ba ngưỡng `minPoseDetectionConfidence`/
`minPosePresenceConfidence`/`minTrackingConfidence` nâng từ mặc định 0.5 lên 0.6: giữ landmark
tin cậy thấp khiến solver dựng hướng từ toạ độ đoán mò, thà để arm-frame reject và giữ tư thế
theo FR-09. Cái giá hiệu năng đo bằng `inferenceTimeMs.pose` và `pipelineFps` sẵn có trong
`TrackingMetricsCollector` — **phải xác nhận còn đạt 24fps trên máy tầm trung trước khi chốt**.

**Tư thế nghỉ là buông tay, không phải T-pose.** `idleArmPose.ts` dựng delta hạ cánh tay
trên 90° và cẳng tay 0° (thẳng hàng) so với rest T-pose — khớp chính xác preset `armsDown`
trong bảng Frozen presets của dev harness, đo trực tiếp từ world landmark của preset đó thay
vì ước lượng. Áp cho `IDENTITY_QUATERNION` ở nhánh `idle`
và đích của nhánh `returning` trong `armTemporalState`. Rest pose humanoid là T-pose nên
identity cho ra hai tay dang ngang — dáng không ai giữ khi ngồi trước webcam, và chính nó làm
mọi lần mất theo dõi trông như nhân vật giật về tư thế lạ. Trạng thái khởi tạo cũng đặt sẵn ở
tư thế này để lúc chưa có sample đầu tiên avatar không đứng T-pose. Góc lấy từ
`IDLE_ARM_ANGLES`; test kiểm bằng hướng thế giới sau khi áp delta, không so quaternion thô.

**Giới hạn còn lại.** Twist quanh trục xương khi tay chĩa dọc trục quang học vẫn không quan sát
được từ ảnh đơn — cờ `depth-degenerate` là chỗ hệ thống thừa nhận và chuyển sang pole fallback.
Điều này ảnh hưởng hướng lòng bàn tay, không ảnh hưởng hướng xương, nên tác động thị giác nhỏ
hơn nhiều so với nhiễu `z`. Hướng khắc phục là lấy thêm tín hiệu từ Hand landmarks ở Phase 3B.
Che khuất hoàn toàn đã được FR-09 quy định là giữ tư thế hợp lệ gần nhất, không phải đoán lại.

**Đã sửa: tay giật/nhảy loạn xạ khi tracking một phần (P0, theo tư vấn chuyên gia bên ngoài).**
Nguyên nhân gốc: pipeline biến tín hiệu `visibility` liên tục thành quyết định nhị phân. Ba sửa:

1. **Bone-length prior không đợi calibration** (`boneLengthPrior()` trong `armFrameSolver.ts`).
   Trước đây `elbow-inference` chỉ chạy được sau khi đã "hiệu chuẩn" độ dài xương từ quan sát
   — mà hiệu chuẩn lại chỉ cập nhật khi khuỷu quan sát được, nên đúng lúc khuỷu bị che (cần
   suy luận nhất, chưa từng hiệu chuẩn trước đó) thì bị reject `elbow-inference-uncalibrated`.
   Nay dùng tỉ lệ giải phẫu cố định (`upper:lower ≈ 1:1`, `upperArm ≈ 0.65 × shoulderWidth`)
   scale theo bề rộng vai đo được ngay frame đó, chạy được từ frame đầu tiên.
2. **Hysteresis cho quyết định "quan sát được"** (`visibleWithHysteresis()`, config
   `visibilityEnter=0.6`/`visibilityExit=0.3`). Trước đây `visibility=0.50` chạy bình thường
   còn `0.49` vứt bỏ toàn bộ đoạn xương — chênh 0.01 nhưng nhị phân hoàn toàn, và dao động
   quanh 0.5 (rất phổ biến khi tay bị che một phần) làm cẳng tay bật/tắt mỗi frame. Nay đang
   tracked thì cần tụt dưới exit mới rớt, đang lost thì cần vượt enter mới tính lại. State lưu
   theo landmark (`elbowWasVisible`/`wristWasVisible`) trong `ArmGeometryHistory` và
   `ArmTemporalState`, đưa ra ngoài qua `AnatomicalArmSolveResult.visibilityStates`.
3. **Bảo toàn độ dài xương sau inference** — không cần sửa, đã đúng sẵn: `inferElbow()` chính
   là công thức 2-bone IK hình học (Pythagore), nên khuỷu suy luận luôn cách vai đúng
   `upperLength` và cách cổ tay đúng `lowerLength` tuyệt đối. Đã thêm assertion khoá invariant
   này vào test, không phải thêm code.

Chưa làm (P1/P2 theo đề xuất chuyên gia, để dành nếu occlusion vẫn còn khó chịu sau khi thử
P0 trên webcam thật): One Euro riêng cho landmark position, reacquire blend 100–250ms khi
tracking quay lại, quaternion hemisphere continuity, constant-velocity Kalman cho dropout
ngắn. Không nên làm tiếp nếu P0 đã đủ — đo lại trên webcam thật trước khi quyết định.

**Đã sửa: twist "chỉ biết phía trước" khi tay chĩa gần thẳng vào camera (Phase A / Mức 1,
theo tư vấn chuyên gia bên ngoài lần 2).** Trước đó tài liệu này (và giải thích cho người dùng)
từng gọi hiện tượng này là "giới hạn vật lý" — **không chính xác**: chỉ trường hợp cực đoan
(tay thẳng camera VÀ bàn tay cũng biến mất) mới thật sự vô phương; phần lớn thời gian dữ liệu
vẫn còn (bàn tay thường vẫn thấy được) nhưng code cũ bỏ phí, fallback thẳng về pole "rest"
(hằng số từ rig, không phải quan sát thật) ngay khi `depthDegenerate` bật — một công tắc nhị
phân dốc như vách đá. Năm sửa (A1–A5), đặt trong `armFrameSolver.ts`/`motionConfig.ts`:

- **A1 — Diagnostic liên tục.** Thêm `depthQuality`, `bendPlaneQuality`, `elbowBendDegrees` vào
  `ArmFrameDiagnostic`, tách rõ pole yếu vì hướng camera hay vì tay duỗi thẳng hay vì landmark
  kém — chỉ đo, không đổi hành vi solver ở bước này.
- **A2 — Bỏ công tắc nhị phân `depthDegenerate` cho quyết định CHẤP NHẬN pole** (biến
  `depthDegenerate` gốc vẫn giữ nguyên vai trò cũ cho nhãn chẩn đoán và hysteresis alignment
  theo thời gian). Thay bằng `observedPoleWeight = depthQuality × bendPlaneQuality` so với
  ngưỡng liên tục. Quan trọng: `depthQuality` phải dùng khoảng smoothstep RỘNG
  (`depthQualityFullTrustAlignment=0.75` → `depthQualityNoTrustAlignment=0.95`, đúng số chuyên
  gia đề xuất) — tái dùng cặp enter/exit hẹp cũ (0.82–0.90) khiến weight vẫn dốc như vách đá cũ
  dù công thức đã đổi, đo được bằng probe trước khi phát hiện ra.
- **A3+A5 — Pole từ hướng bàn tay** (`handPalmPole()`), dùng index/pinky (landmark 19/17,
  17-22 nói chung — có sẵn trong MediaPipe Pose 33 điểm, KHÔNG cần Hand Landmarker riêng) làm
  nguồn thay thế khi elbow-offset pole không dùng được. Chèn vào chuỗi fallback ngay sau
  `fresh`, trước `previous`: `fresh → hand → previous → rest`. `PoleSource` thêm giá trị
  `"hand"`. Twist cue yếu hơn elbow-offset (đúng nhận định chuyên gia) nên KHÔNG được lưu làm
  `history.previousPole` (`acceptedFreshPole` vẫn chỉ true khi `poleSource === "fresh"`) —
  tránh một frame hand-pole nhiễu làm hỏng lịch sử dùng cho các frame sau.
- **A4 — Hysteresis cho ngưỡng weight** (`minimumObservedPoleWeightEnter=0.08`/
  `Exit=0.03`, tái dùng state `previousPoleWasFresh` đã có sẵn từ trước). Không có bước này,
  đo được: khi khoảng cách giữa các frame vượt `poleFallbackTimeoutMs` (pole "previous" không
  kịp cứu), cùng một mức weight dao động nhẹ quanh MỘT ngưỡng duy nhất làm `poleSource` nhảy
  liên tục `fresh↔rest` mỗi frame.

27 test trong `armFrameSolver.test.ts`, mỗi cái cho A1–A5 được kiểm chứng bằng cách tạm hoàn
nguyên bản sửa và xác nhận test đỏ đúng chỗ trước khi khôi phục — cùng phương pháp xuyên suốt.

**MỨC 1: KHOÁ LẠI — kết quả audit cuối cùng (không cố chỉnh threshold Pose fingers để cứu
riêng một ảnh chụp).** Đối chiếu gate:

| Gate | Trạng thái | Bằng chứng |
|---|---|---|
| Dao động quanh ngưỡng không snap | Đạt | Test A4, xác nhận lại bằng dữ liệu thật (xem dưới) |
| Tay duỗi không làm pole flip | Đạt | `bendPlaneQuality` tách riêng, test A1 |
| Tay hướng camera không lập tức về rest | Đạt CÓ ĐIỀU KIỆN | Phụ thuộc trạng thái trước đó — xem phân tích dưới |
| Mất elbow nhưng shoulder/wrist còn thì arm cập nhật | Đạt | Từ P0 |
| Không NaN/quaternion flip | Đạt | Test cũ (Phase 2 acceptance) vẫn xanh |
| `bothForward` có joint rotation thật | Đạt | Test A3+A5 |
| Reacquire không nhảy (quaternion continuity, angularDelta log) | **Đạt — làm ở Mức 1B** | Xem chi tiết bên dưới |
| Chạy ổn định ≥24fps + latency <100ms | **Cần đo trên webcam thật** | Không đo được bằng unit test — Việc 6 của Mức 1B |

**MỨC 1B — hoàn thành 5/6 việc (theo tư vấn chuyên gia, lần audit thứ hai).** Chuyên gia chỉ
đúng: Mức 1A (A1-A5) mới khoá phần *chấp nhận pole quan sát*, chưa xử lý *tính liên tục của
output* qua các frame — đây là khoảng trống thật, không phải việc thừa.

1. **Quaternion hemisphere continuity** (`sameHemisphere()` trong `armTemporalState.ts`).
   `q` và `-q` biểu diễn cùng một rotation; khi solver trả về dấu khác nhau giữa hai frame liên
   tiếp cho cùng một góc thật, `updateSegmentTemporalOutput` giờ đảo dấu `solved` về cùng phía
   với `currentOutputDelta` trước khi gán/slerp — áp dụng cả nhánh gán thẳng (`progress=1`,
   không qua slerp nào, nơi renderer tắt smoothing sẽ lộ cú lật ngay lập tức) lẫn nhánh
   recovering. 2 test, kiểm chứng bằng hoàn nguyên.

2. **Reacquire blend khi đổi NGUỒN dữ liệu, không chỉ khi mất/còn tracking** — phát hiện quan
   trọng nhất của Mức 1B. Cơ chế cũ (có sẵn từ P0, dòng theo dõi `elbowSource`) chỉ trigger
   `recovering` khi *elbow* đổi nguồn quan sát/suy luận. Nhưng khi *pole* đổi nguồn (`rest→fresh`)
   mà elbow không đổi, không có blend nào — đo được qua chính `AvatarMotionProcessor` (không
   phải solver cô lập): **57.94° nhảy thẳng, không qua bất kỳ blend nào**. Sửa bằng
   `poleSourceStrength()` xếp hạng độ tin cậy (`fresh=3 > hand=2 > previous=1 > rest=0`), phát
   hiện "nâng cấp" nguồn, ép `recovering` qua tham số mới `forceReacquireBlend` trong
   `updateSegmentTemporalOutput`. Sau sửa: `progress=0, jump=0.00°`. 1 test tích hợp, kiểm
   chứng bằng hoàn nguyên.

3. **5 diagnostic mới** trong `ArmFrameDiagnostic`: `upperArmAngularDeltaDeg`,
   `lowerArmAngularDeltaDeg`, `poleAngularDeltaDeg`, `poleSourceChanged`, `trackingReacquired`.
   Đo trên OUTPUT thực tế (đã qua Việc 1+2), không phải `deltas` thô của solver — phản ánh đúng
   những gì renderer thực sự nhận mỗi frame. Hàm mới `angularDeltaDegrees()`/
   `vectorAngularDeltaDegrees()` trong `motionMath.ts`. `GeometryDiagnostic` (kiểu solver dùng)
   loại trừ 5 field này vì chúng cần "frame trước" mà solver không giữ state — chỉ
   `AvatarMotionProcessor` tính được. 2 test, kiểm chứng bằng hoàn nguyên.

4. **Test ép đúng chuỗi fallback fresh-reject → hand-reject → previous/rest**, xác nhận qua
   `handPoleRejectionReason` rằng A5 THỰC SỰ được thử và bị reject (không chỉ "không thử") —
   phân biệt với bug tiềm ẩn "A5 thành công nhưng vẫn chọn previous". 2 test, kiểm chứng bằng
   hoàn nguyên (tạm tắt nhánh gọi A5).

5. **Sequence test 4 pha** qua `AvatarMotionProcessor` thật: fresh → degraded (elbow bị che,
   rơi về previous qua elbow-inference, `lossState=recovering`) → previous ổn định → reacquired
   fresh. Xác nhận không pole flip, `upperArmAngularDeltaDeg < 1°` ở frame reacquire. Kiểm
   chứng bằng hoàn nguyên: tắt cả elbowSourceChanged detection, sequence test bắt được ngay ở
   pha 2 (`segmentLossState` không đúng `"recovering"`).

163/163 test, build, lint sạch.

**Còn lại: Việc 6 — browser performance gate (FPS ≥24, end-to-end latency <100ms) trên webcam
thật.** Không đo được bằng unit test — cần chạy dev harness thật, đọc `TrackingMetricsCollector`
(`pipelineFps`, `inferenceTimeMs`) và `RendererMetricsCollector`
(`processorInputToDrawMs`) đã có sẵn trong harness.

**Phân tích chuỗi fallback pole khi A5 reject (`low-index-visibility`) — đo bằng chính dữ liệu
thật, không phải unit test tự dựng.** Ba kịch bản khác nhau tuỳ trạng thái trước đó:
1. `previousPoleWasFresh=true` (tay vừa ở tư thế rõ ràng ngay trước đó): A4 hysteresis hạ
   ngưỡng xuống `Exit=0.03`; `weight=0.0517` đã đủ vượt → **không cần rơi tới A5**, candidatePole
   (elbow-offset) được chấp nhận thẳng, `poleSource=fresh`.
2. `previousPoleWasFresh=false` nhưng có `previousPole` còn hạn (trong `poleFallbackTimeoutMs`):
   weight không đủ vượt `Enter=0.08` → thử A5 → A5 reject → rơi xuống `previous`.
3. Frame đầu tiên / không có lịch sử: A5 reject → không có gì để rơi xuống → `rest`.

Panel người dùng chụp (đưa tay lên áp má) rất có thể rơi vào kịch bản 2 hoặc 3 (mở harness/tư
thế mới), không đại diện cho hành vi liên tục khi camera đã chạy ổn định một lúc — **hành vi
A1-A4 đúng theo thiết kế, không phải bug**, chỉ có A5 là điểm còn hạn chế thật sự.

**Known limitation của A5 (Mức 1), chốt lại — không sửa thêm ở Mức 1.** `depthQuality=0.0549`
thấp (armAxis lệch 22.8° khỏi trục camera) trong khi `bendPlaneQuality=0.9424` rất cao (khuỷu
gập 109.5°, hoàn toàn không duỗi thẳng) — chứng minh tay quan sát được tốt ở mức hình học. A5
được thiết kế đúng để cứu đúng trường hợp này nhưng **không chạy được vì thiếu landmark
index/pinky (17/19) trong chính MediaPipe Pose** — bản chất là dữ liệu Pose-fingers yếu, không
phải lỗi logic A1-A4 và không phải giới hạn vật lý của twist. Đã thêm
`handPoleRejectionReason` vào `ArmFrameDiagnostic` để chẩn đoán chính xác lý do thay vì chỉ
thấy `poleSource: "rest"` mà không biết tại sao. **Không tiếp tục chỉnh ngưỡng visibility của
Pose index/pinky để cứu riêng trường hợp này** — dữ liệu nguồn (Pose 33-điểm) vốn không đủ
chính xác ở ngón tay, hạ ngưỡng chỉ che giấu vấn đề bằng dữ liệu nhiễu, không giải quyết gốc rễ.

**Kế hoạch Mức 2 — spike bằng image landmarks trước khi đụng tới world frame.** Đã cân nhắc
nối thẳng Hand Landmarker world landmarks vào A5 và dừng lại: theo tài liệu MediaPipe,
`HandLandmarker.worldLandmarks` có gốc toạ độ riêng của bàn tay đó (hand-centric), khác gốc
với `PoseLandmarker.worldLandmarks` (gốc tại hông) — không thể trừ trực tiếp hai world position
từ hai nguồn này. Nhưng vector tương đối **bên trong** hệ Hand (ví dụ `indexMcp - pinkyMcp`,
cùng một frame, cùng gốc) vẫn hợp lệ. Thứ tự làm Mức 2:
1. **Spike đầu tiên: dùng image landmarks (2D, không phải world).** Cả Pose và Hand đều có
   `landmarks` (normalized image space, 0-1) cùng hệ quy chiếu camera — không có vấn đề gốc
   toạ độ khác nhau như world landmarks. Ghép `palmAcross`/`palmForward` từ Hand image
   landmarks, chiếu lên mặt phẳng vuông góc `armAxis` (tính từ Pose world) để làm pole — cách
   này vòng qua rủi ro hệ quy chiếu mà vẫn tận dụng độ chính xác cao hơn của Hand Landmarker.
2. **Sau khi spike 2D chứng minh được cải thiện thật**, mới nghiên cứu kỹ tài liệu MediaPipe về
   phép chuyển Hand world frame sang Pose world frame (cần điểm neo chung, ví dụ dùng
   `handedness` + vị trí wrist tương ứng bên Pose để ước lượng phép biến đổi rigid) — chỉ làm
   nếu spike 2D chưa đủ tốt.
3. Chưa đụng tới Mức 3 (ML suy twist từ appearance) — theo đúng khuyến nghị chuyên gia, chỉ xét
   sau khi Mức 2 đã thử và biết rõ giới hạn.

2. **Self-collision: cẳng tay xuyên qua thân khi áp tay vào ngực/mặt.** Không có collision
   detection nào trong `jointConstraints.ts` — file đó chỉ giới hạn góc xoay tối đa so với
   rest pose, không biết hình dạng chiếm không gian của thân người. Đã thử một hướng và thất
   bại có kiểm soát: nghiêng hướng xương ra ngoài khi khuỷu/cổ tay lấn gần **trục** dọc thân
   (khoảng cách ngang) — thất bại vì tay buông tự nhiên và tay áp ngực đều có khoảng cách
   ngang gần bằng 0, đo được lệch hướng xương tới 31° ở preset `armsDown` (tư thế đúng bị phá
   để sửa tư thế sai). Đã hoàn nguyên toàn bộ, không còn dấu vết trong code.

   Tư vấn từ chuyên gia bên ngoài (không phải quyết định, cần duyệt riêng trước khi code):
   dùng khoảng cách có dấu tới **bề mặt** (signed distance tới rounded-box torso-local), không
   phải khoảng cách tới trục — đây là điểm khác biệt cốt lõi giải thích tại sao cách đã thử
   thất bại. Kiến trúc đề xuất: `raw pose → soft target → torso/arm SDF constraint → PBD
   projection (2-4 vòng) → 2-bone IK → quaternion + twist`, không cần physics engine
   (Cannon.js/Rapier). Đề xuất giai đoạn hoá: Giai đoạn 1 chỉ forearm-vs-torso (3 sample, 2
   vòng lặp, ưu tiên correction theo chiều sâu camera thay vì đẩy đều XYZ để tránh lặp lại lỗi
   lệch 31° cũ); Giai đoạn 2 thêm contact hysteresis + head sphere + rest corridor cho tay
   buông tự nhiên; Giai đoạn 3 mới thêm arm-arm collision. Chi phí ước tính nhỏ so với ngân
   sách 41.7ms/frame ở 24fps. **Đây là gợi ý cần đánh giá kỹ trước khi triển khai, không phải
   kế hoạch đã chốt** — quy mô kiến trúc (hệ trục torso-local mới, SDF, PBD, state machine
   contact) lớn hơn một bản vá, cần coi là task con riêng khi bắt đầu Phase 3B/3C.
### Lớp WebRTC

### Mức 2B-5 — áp Hand twist lên rig

- `frontend/src/lib/avatar-motion/handTwistRig.ts` là coordinate boundary tập trung, convention v1
  và phép ghép quaternion. Hand world basis đổi đồng bộ `across/forward/normal` từ raw frame sang
  motion frame bằng `(x,y,z)→(x,-y,-z)` trước chirality. Sau đó
  `palmDirectionAxis="normal"`; bên phải giữ normal đã đổi frame, bên trái negate đúng một lần và
  truyền `positiveSign=+1` cho cả hai bên.
- Code hiện có tách `rigApplicationSign` khỏi measurement sign để thử nghiệm tại boundary tạo
  lowerArm quaternion. Tuy nhiên webcam gate mới nhất cho thấy tay phải **vẫn xoay ngược** sau khi
  đặt right `-1`; vì vậy giá trị này chưa phải convention đã được nghiệm thu và không được dùng làm
  bằng chứng Phase 3B PASS. Raw/corrected diagnostic, chirality policy và application sign phải được
  đối chiếu đồng thời với world orientation sau renderer trước lần sửa production tiếp theo.
- `AvatarMotionProcessor` có feature flag runtime `handTwistEnabled` (mặc định `true`) và setter
  `setHandTwistEnabled()`. Dev harness có checkbox **Hand twist (2B-5)** để so sánh trực tiếp với
  Pose-only.
- Pose vẫn tạo toàn bộ swing và temporal output Mức 1. Pipeline Hand twist riêng mỗi side là:
  raw wrapped twist → unwrap → correction tương đối với neutral → dead zone liên tục 3° → target
  filter 80 ms → clamp correction ±75° → temporal velocity/influence → lower arm. Chỉ
  `handTwistStabilization.ts` được unwrap; `handTwistTemporal.ts` nhận correction liên tục và
  không unwrap lần hai.
- Observation Hand và temporal/render tick được tách riêng. Frame unsampled hoặc duplicate không
  chạy lại matching/palm/twist/confidence, không đổi wrist continuity/neutral và không tạo missing observation; temporal vẫn tiến
  theo `dt` về target hợp lệ cuối cùng. Sampled no-hand/unmatched mới đặt `missingSinceMs`; hold 200
  ms rồi fade theo `nowMs-missingSinceMs`, không theo số frame detector.
- 2B-6 quản lý `trackingEpochId` độc lập từng side thay cho suy đoán identity từ source index.
  Observation trusted đầu tiên của epoch mới anchor neutral đúng một lần. Short loss/reacquire và
  source-index reorder giữ nguyên epoch/neutral. Reset/dispose, đổi rig/model, discontinuity theo
  side, long-loss reset, hoặc recovery sau lower-arm geometry loss đã được xác nhận đồng bộ temporal
  + stabilization + matching rồi mở epoch mới; quaternion từ epoch cũ không được tái sử dụng. Một
  geometry observation invalid chỉ fallback Pose-only và bắt đầu pending interval; nó không đổi
  epoch/neutral. Chỉ observation invalid tiếp theo vượt `armFrame.invalidGraceMs` mới xác nhận loss.
- 2B-6 là integration/regression state-management. Automated gate xanh và người thực hiện đã xác
  nhận manual webcam acceptance ngày 2026-08-01; Phase 3B hoàn thành và Hand Twist bật mặc định.
- Processor chỉ ghép `outputDelta = poseLowerDelta * handTwistDelta`; trục twist là
  `rigProfile.joints[lowerArm].anatomicalRestBasis.primaryLocal`.
- Không xoay `hand` bone và không phân phối lowerArm/hand. Hand bone hiện chỉ là child nên thừa
  hưởng rotation của lower arm. Phân phối twist cần rig profile có hand rest basis và thuộc phase
  riêng.
- Nếu flag tắt, chưa từng có target hợp lệ, influence đã về 0, output non-finite hoặc thiếu
  geometry/profile, processor trả lại chính quaternion Pose hiện có, không clone/normalize/đổi
  dấu. Short missing vẫn áp held twist cho tới khi temporal fade về 0. Diagnostics từng tầng nằm
  tại `AvatarMotionDiagnosticSnapshot.handTwist.{left,right}`, gồm wrapped/unwrapped target,
  neutral, influence, trust, temporal state, rejection reason và applied twist. Diagnostic 2B-6
  bổ sung sample classification, matching continuity, epoch/reset reason, epoch đã anchor và
  `lastAppliedTwistRadians` (derive từ temporal angle × influence, không phải control state thứ hai).

### 2B-5C — Pronation/Supination Root-Cause Validation (WEBCAM GATE PENDING)

- Investigation chỉ thêm test/diagnostic evidence, chưa sửa production. File mới
  `frontend/src/lib/avatar-motion/handTwistRootCauseValidation.test.ts` kiểm tra rig-only
  inheritance, lowerArm primary invariance, wrist position, ±45°, A-B-A drift, left/right,
  renderer không ghi đè hand local rotation, synthetic palm normal, unwrap ±π và scalar pipeline.
- Root cause offline đã sửa tối thiểu tại `handTwistRig.ts`: đổi toàn bộ Hand world basis sang
  motion frame trước chirality và trước `computeHandForearmTwist()`. RED contract test đã GREEN;
  synthetic physical ±45° cho đúng ±45° ở cả hai side, basis giữ length/orthogonality/cross và
  không double-negate trái. Processor chỉ dùng `worldBasis`, không fallback image basis vào Pose
  world axis.
- Chưa kết luận 2B-5 PASS cho tới khi webcam neutral/palm-up/palm-down xác nhận chuỗi diagnostic
  cùng dấu, đúng biên độ, không bị tầng temporal/renderer triệt tiêu.

### 2B-5D — Arm Stability Root-Cause Audit (PRODUCTION FIX PENDING)

- `AvatarMotionDiagnosticSnapshot.armStability.{left,right}` tách delta quaternion target/applied
  của Pose khỏi delta scalar raw/applied của Hand twist; đồng thời chụp elbow/pole source và cờ đổi
  nhánh, pole quality, Pose confidence/tracking, trust/influence/neutral/observation mode, `frameDtMs`
  và tuổi sample Pose/Hand. Đây chỉ là instrumentation; dev harness đọc snapshot theo chu kỳ 400 ms,
  không `console.log` mỗi frame và không tham gia quyết định motion.
- Audit deterministic 8 sequence cho thấy input Pose giống hệt không tự sinh chuyển động, kể cả khi
  `dt` lần lượt thay đổi 16/50/33/100 ms. Khi tiêm nhiễu landmark nhỏ ở tư thế khuỷu 90°, jitter xuất
  hiện đầu tiên tại Pose solver target (`upper=0.0096615 rad`, `lower=0.0026063 rad`) rồi đi 1:1 tới
  Pose applied khi filter tắt; elbow/pole source vẫn không đổi.
- Ở Hand steady-state, nhiễu raw twist `0.0062892 rad` còn `0.0007082 rad` tại applied twist; target và
  temporal influence cùng ổn định ở `0.9830449`. Vì vậy Hand temporal đang giảm nhiễu ổn định, không
  phải tầng khuếch đại trong sequence này. Pure twist vẫn giữ lowerArm primary và wrist position theo
  rig-only contract.
- Vùng tay gần duỗi thẳng có thể đổi nhánh pole `fresh → previous → fresh`; đây là nguồn target
  discontinuity có điều kiện ở solver. Elbow visibility hysteresis chỉ đổi nguồn tại exit 0.29 và
  enter 0.61, không flap tại 0.50/0.59. Short Hand miss/unsampled/reacquire giữ neutral, không re-anchor.
- Chưa sửa production solver/filter/temporal từ kết quả audit này. Cần snapshot webcam A/B cùng một
  tư thế để định lượng tỷ lệ thời gian Pose-target jitter, pole/elbow branch change và Hand-only jitter
  trước khi duyệt kế hoạch fix riêng.

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
