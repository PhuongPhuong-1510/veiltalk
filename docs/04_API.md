TRƯỜNG ĐẠI HỌC CÔNG NGHỆ — ĐHQGHN

Khoa Công nghệ Thông tin

**TÀI LIỆU THIẾT KẾ API**

*(API Design Document — ADD)*

**VEILTALK**

Đặc tả REST API cho hệ thống giao tiếp qua nhân vật ảo

Phiên bản tài liệu: 1.0

Trạng thái: Bản nháp (Draft)

Ngày cập nhật: 21/06/2026

Người soạn thảo: Lê Thị Tú Phương — MSSV 23020695

Lớp: K68 — Khoa Công nghệ Thông tin

Mục lục

## 1. Giới thiệu

### 1.1. Mục đích tài liệu

Tài liệu này đặc tả chi tiết toàn bộ REST API của hệ thống VeilTalk, bao gồm: danh sách endpoint, định dạng request/response, mã trạng thái HTTP, quy tắc xác thực, và giới hạn truy cập. Tài liệu này là tài liệu bổ trợ cho SAD v1.0 (mục 4.3 — Backend API tham chiếu tài liệu này) và được soạn nhất quán với SRS v1.0 (yêu cầu chức năng), DDD v1.0 (schema database), và các quyết định kiến trúc đã được thiết lập.

### 1.2. Quy ước chung

- Base URL: https://veiltalk.example.com/api — tất cả endpoint đều có tiền tố này.

- Định dạng dữ liệu: JSON cho tất cả request body và response body (Content-Type: application/json).

- Xác thực: Bearer JWT trong header Authorization: Bearer \<access_token\>. Các endpoint không yêu cầu xác thực được đánh dấu rõ trong bảng tổng quan.

- Thời hạn token: access token 15 phút, refresh token 7 ngày (nhất quán với SAD mục 4.3).

- Múi giờ: tất cả timestamp trả về theo định dạng ISO 8601 UTC (ví dụ: 2026-06-21T10:30:00Z).

- Phân trang: endpoint trả về danh sách dùng cursor-based pagination với tham số cursor và limit (mặc định 20).

- Soft delete: dữ liệu đã xóa (deleted_at IS NOT NULL) không bao giờ được trả về trong response thông thường.

- CORS: chỉ cho phép origin của client domain — nhất quán với NFR-32 và SAD mục 9.1.

### 1.3. Tài liệu liên quan

- SRS v1.0 — yêu cầu chức năng FR-01 đến FR-22.

- SAD v1.0 — mục 4.3 Backend API, mục 9 Bảo mật.

- DDD v1.0 — schema bảng database tương ứng với từng entity trong API.

## 2. Tổng quan Endpoint

### 2.1. Nhóm Authentication

| **Method** | **Endpoint**   | **Mô tả**                                      | **Auth** |
|------------|----------------|------------------------------------------------|----------|
| **POST**   | /auth/register | Đăng ký tài khoản mới (FR-01)                  | Không    |
| **POST**   | /auth/login    | Đăng nhập, nhận access + refresh token (FR-02) | Không    |
| **POST**   | /auth/refresh  | Làm mới access token bằng refresh token        | Không    |
| **POST**   | /auth/logout   | Thu hồi refresh token, đăng xuất               | Có       |

### 2.2. Nhóm User & Profile

| **Method** | **Endpoint**       | **Mô tả**                                                 | **Auth** |
|------------|--------------------|-----------------------------------------------------------|----------|
| **GET**    | /users/me          | Lấy thông tin hồ sơ của bản thân (FR-03)                  | Có       |
| **PUT**    | /users/me          | Cập nhật tên hiển thị, ảnh đại diện (FR-03)               | Có       |
| **GET**    | /users/me/settings | Lấy cài đặt tài khoản (discoverable, thông báo...)        | Có       |
| **PUT**    | /users/me/settings | Cập nhật cài đặt tài khoản (FR-22 — bật/tắt discoverable) | Có       |
| **DELETE** | /users/me          | Yêu cầu xóa tài khoản, soft delete (NFR-27)               | Có       |
| **POST**   | /users/search      | Tìm kiếm người dùng theo email opt-in (FR-22)             | Có       |

### 2.3. Nhóm Avatar

| **Method** | **Endpoint**      | **Mô tả**                                                    | **Auth** |
|------------|-------------------|--------------------------------------------------------------|----------|
| **GET**    | /avatars/me       | Lấy hồ sơ nhân vật ảo của bản thân (FR-04)                   | Có       |
| **PUT**    | /avatars/me       | Tạo hoặc cập nhật nhân vật ảo (FR-04)                        | Có       |
| **GET**    | /avatars/{userId} | Lấy metadata nhân vật ảo của user khác (FR-04, call session) | Có       |

### 2.4. Nhóm Conversations & Messages

| **Method** | **Endpoint**                         | **Mô tả**                                           | **Auth** |
|------------|--------------------------------------|-----------------------------------------------------|----------|
| **POST**   | /conversations                       | Tạo hoặc lấy conversation 1-1 với user khác (FR-22) | Có       |
| **GET**    | /conversations                       | Danh sách cuộc trò chuyện gần nhất của user         | Có       |
| **GET**    | /conversations/{id}                  | Chi tiết một cuộc trò chuyện                        | Có       |
| **GET**    | /conversations/{id}/messages         | Lịch sử tin nhắn theo cursor (FR-12)                | Có       |
| **POST**   | /conversations/{id}/messages         | Gửi tin nhắn mới (FR-11)                            | Có       |
| **PUT**    | /conversations/{id}/messages/{msgId} | Cập nhật trạng thái tin nhắn (delivered/read)       | Có       |

### 2.5. Nhóm Videos

*Flow quay và lưu video dùng MinIO multipart upload: client upload từng chunk trực tiếp lên MinIO qua presigned URL, MinIO gửi webhook về Backend khi upload hoàn tất. Client không có quyền tự khai báo trạng thái video.*

| **Method** | **Endpoint**             | **Mô tả**                                                                | **Auth** |
|------------|--------------------------|--------------------------------------------------------------------------|----------|
| **GET**    | /videos                  | Danh sách video trong thư viện cá nhân (FR-17)                           | Có       |
| **POST**   | /videos                  | Khởi tạo multipart upload, nhận presigned URL cho chunk đầu tiên (FR-16) | Có       |
| **GET**    | /videos/{id}             | Chi tiết một video, kèm presigned URL để phát                            | Có       |
| **PUT**    | /videos/{id}             | Đổi tên video (FR-17)                                                    | Có       |
| **DELETE** | /videos/{id}             | Xóa video, soft delete (FR-17)                                           | Có       |
| **POST**   | /videos/{id}/chunks      | Lấy presigned URL cho chunk tiếp theo trong phiên quay                   | Có       |
| **POST**   | /videos/{id}/finalize    | Hoàn tất phiên quay, trigger MinIO complete multipart upload             | Có       |
| **POST**   | /videos/{id}/abort       | Hủy phiên quay đang dở, dọn dẹp chunks trên MinIO                        | Có       |
| **POST**   | /internal/videos/webhook | MinIO webhook callback — chỉ nhận từ MinIO (signed), không phải client   | Internal |

### 2.6. Nhóm Metrics (Observability)

| **Method** | **Endpoint**    | **Mô tả**                                                 | **Auth** |
|------------|-----------------|-----------------------------------------------------------|----------|
| **POST**   | /metrics/client | Gửi số liệu hiệu năng từ client (NFR-22: latency, fps...) | Có       |

## 3. Nhóm Authentication

*Tất cả endpoint trong nhóm này không yêu cầu Authorization header. JWT được trả về sau đăng nhập thành công và dùng cho mọi endpoint có Auth = Có.*

### 3.1. POST /auth/register

Đăng ký tài khoản mới. Tương ứng FR-01 (SRS mục 3.1).

Request Body

| **Field**        | **Kiểu** | **Bắt buộc** | **Mô tả**                                               |
|------------------|----------|--------------|---------------------------------------------------------|
| **email**        | string   | Có           | Địa chỉ email — phải là email hợp lệ, chưa được đăng ký |
| **password**     | string   | Có           | Mật khẩu — tối thiểu 8 ký tự, ít nhất 1 chữ hoa và 1 số |
| **display_name** | string   | Có           | Tên hiển thị — 1-100 ký tự                              |

Response 201 Created

{ "user": { "id": "uuid", "email": "user@example.com", "display_name": "Nguyễn Văn A", "role": "user", "created_at": "2026-06-21T10:00:00Z" }, "tokens": { "access_token": "eyJhbGc...", "refresh_token": "eyJhbGc...", "expires_in": 900 } }

HTTP Status Codes

| **HTTP Status** | **Ý nghĩa** | **Trường hợp cụ thể**                                                                                                  |
|-----------------|-------------|------------------------------------------------------------------------------------------------------------------------|
| **201**         | Created     | Đăng ký thành công, tài khoản được tạo                                                                                 |
| **400**         | Bad Request | Email không hợp lệ, mật khẩu không đủ mạnh, display_name trống                                                         |
| **409**         | Conflict    | Email đang thuộc một tài khoản chưa bị xóa (`deleted_at IS NULL`)                                                     |

Email của tài khoản đã soft delete không chặn đăng ký mới. Lần đăng ký sau tạo một user độc lập
với UUID mới; không khôi phục hoặc liên kết dữ liệu của tài khoản cũ. Hành vi này đồng bộ với
unique partial index `idx_users_email` trong DDD, chỉ áp dụng khi `deleted_at IS NULL`.

Refresh token trả về chỉ xuất hiện ở dạng nguyên gốc trong response cho client. Backend lưu
SHA-256 hash cùng `user_id`, `expires_at` và `revoked_at = NULL` trong bảng `refresh_tokens`.

### 3.2. POST /auth/login

Đăng nhập bằng email và mật khẩu. Tương ứng FR-02 (SRS mục 3.1). Thông báo lỗi không phân biệt email sai hay mật khẩu sai — tránh user enumeration.

Request Body

| **Field**    | **Kiểu** | **Bắt buộc** | **Mô tả**                |
|--------------|----------|--------------|--------------------------|
| **email**    | string   | Có           | Địa chỉ email đã đăng ký |
| **password** | string   | Có           | Mật khẩu                 |

Response 200 OK

{ "user": { "id": "uuid", "email": "user@example.com", "display_name": "Nguyễn Văn A", "role": "user", "has_avatar": true }, "tokens": { "access_token": "eyJhbGc...", "refresh_token": "eyJhbGc...", "expires_in": 900 } }

Refresh token được phát hành và lưu hash theo cùng quy trình với đăng ký; token nguyên gốc
không được lưu trong database.

HTTP Status Codes

| **HTTP Status** | **Ý nghĩa**  | **Trường hợp cụ thể**                                                                |
|-----------------|--------------|--------------------------------------------------------------------------------------|
| **200**         | OK           | Đăng nhập thành công                                                                 |
| **401**         | Unauthorized | Email hoặc mật khẩu không đúng — cùng một response body, không tiết lộ field nào sai |

### 3.3. POST /auth/refresh

Dùng refresh token còn hạn để lấy access token mới mà không cần đăng nhập lại.

Backend chỉ chấp nhận token có JWT hợp lệ và `type = refresh`, SHA-256 hash tồn tại trong
`refresh_tokens`, `revoked_at IS NULL`, `expires_at` còn hạn và user sở hữu token chưa bị
soft delete.

Request Body

| **Field**         | **Kiểu** | **Bắt buộc** | **Mô tả**                                    |
|-------------------|----------|--------------|----------------------------------------------|
| **refresh_token** | string   | Có           | Refresh token còn hạn (7 ngày kể từ lúc cấp) |

Response 200 OK

{ "access_token": "eyJhbGc...", "expires_in": 900 }

HTTP Status Codes

| **HTTP Status** | **Ý nghĩa**  | **Trường hợp cụ thể**                                                               |
|-----------------|--------------|-------------------------------------------------------------------------------------|
| **200**         | OK           | Access token mới được cấp                                                           |
| **401**         | Unauthorized | Refresh token hết hạn, đã bị thu hồi, hoặc không hợp lệ — client phải đăng nhập lại |

### 3.4. POST /auth/logout

Thu hồi refresh token hiện tại và làm access token đang dùng mất hiệu lực ngay. Backend đặt
`revoked_at` cho refresh token, sau đó lưu `jti` của access token vào Redis theo key
`jwt:blacklist:{jti}`. TTL của key bằng chính thời gian còn lại đến claim `exp`, không cố
định 15 phút. Mọi request sau đó dùng access token này bị filter từ chối.

Refresh token trong request phải còn hợp lệ và thuộc cùng user với claim `sub` của access
token trong header `Authorization`.

Request Body

| **Field**         | **Kiểu** | **Bắt buộc** | **Mô tả**                 |
|-------------------|----------|--------------|---------------------------|
| **refresh_token** | string   | Có           | Refresh token cần thu hồi |

HTTP Status Codes

| **HTTP Status** | **Ý nghĩa**  | **Trường hợp cụ thể**                             |
|-----------------|--------------|---------------------------------------------------|
| **204**         | No Content   | Đăng xuất thành công, refresh token đã bị thu hồi |
| **401**         | Unauthorized | Access token không hợp lệ/hết hạn, refresh token không hợp lệ, hoặc hai token không thuộc cùng user |

## 4. Nhóm User & Profile

### 4.1. GET /users/me

Lấy thông tin hồ sơ của chính user đang đăng nhập. Tương ứng FR-03.

Response 200 OK

{ "id": "uuid", "email": "user@example.com", "display_name": "Nguyễn Văn A", "avatar_url": "https://cdn.example.com/avatars/user.jpg", "role": "user", "has_avatar": true, "created_at": "2026-06-21T10:00:00Z" }

### 4.2. PUT /users/me

Cập nhật tên hiển thị hoặc ảnh đại diện ứng dụng. Tương ứng FR-03. Tất cả field đều tùy chọn — chỉ gửi field cần thay đổi.

Request Body

| **Field**        | **Kiểu**     | **Bắt buộc** | **Mô tả**                                          |
|------------------|--------------|--------------|----------------------------------------------------|
| **display_name** | string       | Không        | Tên hiển thị mới — 1-100 ký tự                     |
| **avatar_url**   | string\|null | Không        | URL ảnh đại diện mới; gửi null để xóa ảnh đại diện |

HTTP Status Codes

| **HTTP Status** | **Ý nghĩa**  | **Trường hợp cụ thể**                 |
|-----------------|--------------|---------------------------------------|
| **200**         | OK           | Hồ sơ được cập nhật, trả về hồ sơ mới |
| **400**         | Bad Request  | display_name rỗng hoặc vượt 100 ký tự |
| **401**         | Unauthorized | Token không hợp lệ                    |

### 4.3. GET /users/me/settings

Lấy cài đặt tài khoản, bao gồm trạng thái tùy chọn discoverable phục vụ FR-22.

Response 200 OK

{ "discoverable": false, "email_notifications": true, "theme": "system" // theme: "dark" \| "light" \| "system" (mặc định "system") // Lưu server-side để đồng bộ cross-device (không dùng localStorage) }

### 4.4. PUT /users/me/settings

Cập nhật cài đặt tài khoản. Quan trọng nhất là discoverable — khi tắt (false, mặc định), user không thể bị tìm thấy qua POST /users/search (FR-22).

Request Body

| **Field**               | **Kiểu** | **Bắt buộc** | **Mô tả**                                                                                                                                        |
|-------------------------|----------|--------------|--------------------------------------------------------------------------------------------------------------------------------------------------|
| **discoverable**        | boolean  | Không        | true = cho phép người khác tìm thấy qua email; false = ẩn (mặc định)                                                                             |
| **email_notifications** | boolean  | Không        | Bật/tắt thông báo email                                                                                                                          |
| **theme**               | string   | Không        | 'dark' \| 'light' \| 'system' — preference lưu server-side để đồng bộ cross-device, không dùng localStorage (nhất quán với UI/UX Design mục 7.3) |

HTTP Status Codes

| **HTTP Status** | **Ý nghĩa**  | **Trường hợp cụ thể**                     |
|-----------------|--------------|-------------------------------------------|
| **200**         | OK           | Cài đặt được cập nhật, trả về cài đặt mới |
| **401**         | Unauthorized | Token không hợp lệ                        |

### 4.5. DELETE /users/me

Yêu cầu xóa tài khoản — soft delete ngay lập tức (NFR-27). Backend xác nhận mật khẩu,
đặt `users.deleted_at`, revoke toàn bộ refresh token còn hoạt động và ghi mốc epoch-second
vào Redis theo key `jwt:user-revoked-after:{userId}`. TTL của key bằng thời hạn access
token tối đa. `JwtAuthenticationFilter` từ chối mọi access token của user có claim `iat`
không mới hơn mốc revoke, vì vậy tất cả phiên đăng nhập hiện có mất hiệu lực ngay.

Background job dọn dẹp dữ liệu thật sau 30 ngày. `VideoAccountCleanupService` (P2-T24) abort
mọi video `recording` của user trên MinIO NGAY sau khi soft-delete/revoke token đã commit —
chạy trong transaction `REQUIRES_NEW` riêng nên một lỗi ở bước này không rollback việc xóa
tài khoản, và ngược lại. Nếu MinIO abort thất bại, video giữ nguyên `recording` (như
`POST /videos/{id}/abort` lúc lỗi) và một dòng `video_cleanup_jobs` được ghi để
`VideoCleanupRetryJob` retry có backoff (không chỉ ghi log) — xem `docs/03_DATABASE.md` mục
3.5a.

Request Body

| **Field**    | **Kiểu** | **Bắt buộc** | **Mô tả**                                                                    |
|--------------|----------|--------------|------------------------------------------------------------------------------|
| **password** | string   | Có           | Mật khẩu hiện tại để xác nhận — tránh xóa nhầm do truy cập token bị đánh cắp |

HTTP Status Codes

| **HTTP Status** | **Ý nghĩa**  | **Trường hợp cụ thể**                                                                     |
|-----------------|--------------|-------------------------------------------------------------------------------------------|
| **204**         | No Content   | Tài khoản đã được soft delete; toàn bộ refresh/access token cũ bị thu hồi ngay lập tức |
| **401**         | Unauthorized | Token không hợp lệ hoặc mật khẩu xác nhận sai                                             |

### 4.6. POST /users/search

Tìm kiếm người dùng theo email chính xác. Chỉ trả về kết quả khi user đích đã bật discoverable. Tương ứng FR-22. Rate limit: 10 request/phút/tài khoản (NFR-32) — vượt ngưỡng trả về 429.

Request Body

| **Field** | **Kiểu** | **Bắt buộc** | **Mô tả**                                    |
|-----------|----------|--------------|----------------------------------------------|
| **email** | string   | Có           | Địa chỉ email cần tìm — phải là email hợp lệ |

Response 200 OK — Tìm thấy

{ "found": true, "user": { "id": "uuid", "display_name": "Nguyễn Văn B" } }

Response 200 OK — Không tìm thấy (hoặc user chưa bật discoverable)

{ "found": false }

*Lưu ý: cả hai trường hợp (email không tồn tại / tồn tại nhưng discoverable = false) đều trả về 200 với found: false — tránh user enumeration, nhất quán với chống tấn công STRIDE-I trong SAD mục 9.4.*

HTTP Status Codes

| **HTTP Status** | **Ý nghĩa**       | **Trường hợp cụ thể**                                                                        |
|-----------------|-------------------|----------------------------------------------------------------------------------------------|
| **200**         | OK                | Trả về kết quả tìm kiếm (found: true hoặc false) — không dùng 404 để tránh tiết lộ thông tin |
| **400**         | Bad Request       | Email không đúng định dạng                                                                   |
| **401**         | Unauthorized      | Token không hợp lệ                                                                           |
| **429**         | Too Many Requests | Vượt rate limit 10 req/phút; header Retry-After ghi số giây cần chờ                          |

## 5. Nhóm Avatar

*Endpoint avatar phục vụ FR-04 — lưu và lấy thông tin nhân vật ảo. Nhất quán với bảng avatar_profiles trong DDD và cơ chế tải GLB phía nhận được mô tả trong SAD mục 4.1.2 và flow 5.1 bước 3b.*

### 5.1. GET /avatars/models

Lấy danh sách model nhân vật ảo dựng sẵn của hệ thống. Client gọi endpoint này ở màn hình SCR-07 (Chọn model). Đây là endpoint public — không cần xác thực để cho phép xem trước trước khi đăng ký.

Response 200 OK

{ "models": \[ { "id": "avatar_model_01", "name": "Sakura — Anime", "thumbnail_url": "https://cdn.example.com/models/thumbs/avatar_model_01.png", "model_url": "https://cdn.example.com/models/avatar_model_01.glb", "supported_customizations": \["hair_color", "eye_color", "outfit"\], "outfit_options": \["casual_01", "casual_02", "formal_01"\] } \] }

*model_url trong response này là URL được server kiểm soát — client dùng để tải preview. Khi lưu avatar, client chỉ gửi model_id, server tự tra model_url từ catalog nội bộ (mục 5.2).*

### 5.2. GET /avatars/me

Lấy hồ sơ nhân vật ảo của chính user.

Response 200 OK

{ "id": "uuid", "user_id": "uuid", "model_id": "avatar_model_01", "model_url": "https://cdn.example.com/models/avatar_model_01.glb", "customizations": { "hair_color": "#8B4513", "outfit": "casual_01", "eye_color": "#4169E1" }, "created_at": "2026-06-21T10:00:00Z", "updated_at": "2026-06-21T10:00:00Z" }

HTTP Status Codes

| **HTTP Status** | **Ý nghĩa**  | **Trường hợp cụ thể**                                 |
|-----------------|--------------|-------------------------------------------------------|
| **200**         | OK           | Hồ sơ nhân vật ảo tồn tại                             |
| **404**         | Not Found    | User chưa thiết lập nhân vật ảo (chưa hoàn tất UC-03) |
| **401**         | Unauthorized | Token không hợp lệ                                    |

### 5.3. PUT /avatars/me

Tạo hoặc cập nhật nhân vật ảo. Upsert. Tương ứng FR-04 và UC-03. Client chỉ gửi model_id — server tự tra model_url từ catalog nội bộ dựa trên model_id. Client không được phép gửi model_url để tránh lỗ hổng: client gửi model_id hợp lệ kèm model_url tùy ý trỏ về file GLB bên ngoài hệ thống.

Request Body

| **Field**          | **Kiểu** | **Bắt buộc** | **Mô tả**                                                                                                         |
|--------------------|----------|--------------|-------------------------------------------------------------------------------------------------------------------|
| **model_id**       | string   | Có           | ID của model dựng sẵn (lấy từ GET /avatars/models) — server validate và tra model_url tương ứng từ catalog nội bộ |
| **customizations** | object   | Không        | Các tùy chỉnh dạng JSON (màu tóc, trang phục...); key phải nằm trong supported_customizations và giá trị outfit phải thuộc outfit_options của model đó |

HTTP Status Codes

| **HTTP Status** | **Ý nghĩa**  | **Trường hợp cụ thể**                                                                       |
|-----------------|--------------|---------------------------------------------------------------------------------------------|
| **200**         | OK           | Nhân vật ảo đã được cập nhật                                                                |
| **201**         | Created      | Nhân vật ảo đã được tạo mới (lần đầu thiết lập)                                             |
| **400**         | Bad Request  | model_id không hợp lệ; customizations có key không được hỗ trợ hoặc outfit không thuộc outfit_options; client gửi model_url |
| **401**         | Unauthorized | Token không hợp lệ                                                                          |

### 5.4. GET /avatars/{userId}

Lấy metadata nhân vật ảo của một user cụ thể. Client B gọi endpoint này ở bước 3b của flow thiết lập cuộc gọi (SAD mục 5.1) để tải đúng model GLB của người gọi.

*Lưu ý authorization: endpoint này KHÔNG bị ảnh hưởng bởi tùy chọn discoverable. Lý do: chỉ được gọi trong ngữ cảnh cuộc gọi đang thiết lập — B đã chấp nhận cuộc gọi từ A, tức là B đã đồng ý giao tiếp với A. Discoverable chỉ kiểm soát khả năng bị tìm thấy qua /users/search.*

*Lưu ý anti-enumeration: cả hai trường hợp (userId không tồn tại VÀ userId tồn tại nhưng chưa có avatar) đều trả về 404 với cùng một response body — tránh kẻ tấn công dùng endpoint này để kiểm tra UUID nào là user hợp lệ.*

Response 200 OK

{ "user_id": "uuid", "model_id": "avatar_model_02", "model_url": "https://cdn.example.com/models/avatar_model_02.glb", "customizations": { "hair_color": "#000000", "outfit": "formal_01" } }

HTTP Status Codes

| **HTTP Status** | **Ý nghĩa**  | **Trường hợp cụ thể**                                                                                                                                             |
|-----------------|--------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **200**         | OK           | Avatar metadata trả về thành công                                                                                                                                 |
| **404**         | Not Found    | User không tồn tại HOẶC chưa thiết lập avatar — response body giống hệt nhau cho cả hai trường hợp để tránh enumeration; client dùng avatar mặc định của hệ thống |
| **401**         | Unauthorized | Token không hợp lệ                                                                                                                                                |

## 6. Nhóm Conversations & Messages

### 6.1. POST /conversations

Tạo hoặc lấy conversation 1-1 với một user khác. Idempotent: nếu conversation giữa hai user đã tồn tại thì trả về conversation đó thay vì tạo mới — nhất quán với logic idx_conv_pair (LEAST/GREATEST) trong DDD. Endpoint này được gọi sau bước 4 của UC-05/FR-22 (SRS): user tìm thấy người dùng khác và bấm 'Nhắn tin'.

Request Body

| **Field**         | **Kiểu** | **Bắt buộc** | **Mô tả**                                                     |
|-------------------|----------|--------------|---------------------------------------------------------------|
| **other_user_id** | UUID     | Có           | ID của user muốn bắt đầu trò chuyện — không thể là chính mình |

Response 201 Created (conversation mới) hoặc 200 OK (đã tồn tại)

{ "id": "uuid", "other_user": { "id": "uuid", "display_name": "Nguyễn Văn B", "avatar_url": null }, "created_at": "2026-06-21T10:00:00Z", "updated_at": "2026-06-21T10:00:00Z" }

HTTP Status Codes

| **HTTP Status** | **Ý nghĩa**  | **Trường hợp cụ thể**                                |
|-----------------|--------------|------------------------------------------------------|
| **201**         | Created      | Conversation mới được tạo                            |
| **200**         | OK           | Conversation đã tồn tại, trả về conversation hiện có |
| **400**         | Bad Request  | other_user_id là chính mình, hoặc UUID không hợp lệ  |
| **404**         | Not Found    | User đích không tồn tại                              |
| **401**         | Unauthorized | Token không hợp lệ                                   |

### 6.2. GET /conversations

Danh sách cuộc trò chuyện gần nhất của user, sắp xếp theo updated_at giảm dần (tin nhắn mới nhất lên đầu). Dùng cursor-based pagination.

Query Parameters

| **Tham số** | **Kiểu** | **Bắt buộc** | **Mô tả**                                          |
|-------------|----------|--------------|----------------------------------------------------|
| **cursor**  | string   | Không        | Cursor của trang tiếp theo (lấy từ response trước) |
| **limit**   | integer  | Không        | Số conversation mỗi trang, mặc định 20, tối đa 50  |

Response 200 OK

{ "data": \[ { "id": "uuid", "other_user": { "id": "uuid", "display_name": "Nguyễn Văn B", "avatar_url": null }, "last_message": { "content": "Xin chào!", "sender_id": "uuid", "client_timestamp": "2026-06-21T10:30:00Z", "status": "delivered" }, "updated_at": "2026-06-21T10:30:00Z" } \], "next_cursor": "eyJpZCI6InV1aWQiLCJ0IjoiMTcyMCJ9", "has_more": true }

### 6.3. GET /conversations/{id}

Lấy chi tiết một cuộc trò chuyện. Hữu ích khi client cần reload thông tin conversation sau khi nhận notification.

Response 200 OK

{ "id": "uuid", "other_user": { "id": "uuid", "display_name": "Nguyễn Văn B", "avatar_url": null }, "last_message": { "content": "Xin chào!", "sender_id": "uuid", "client_timestamp": "2026-06-21T10:30:00Z", "status": "read" }, "created_at": "2026-06-21T09:00:00Z", "updated_at": "2026-06-21T10:30:00Z" }

HTTP Status Codes

| **HTTP Status** | **Ý nghĩa** | **Trường hợp cụ thể**                           |
|-----------------|-------------|-------------------------------------------------|
| **200**         | OK          | Chi tiết conversation                           |
| **403**         | Forbidden   | User không phải thành viên của conversation này |
| **404**         | Not Found   | Conversation không tồn tại                      |

### 6.4. GET /conversations/{id}/messages

Lịch sử tin nhắn của một conversation. Trang đầu lấy các tin nhắn mới nhất; mỗi trang response sắp xếp theo `(client_timestamp ASC, id ASC)` để hiển thị theo thời gian. Cursor chứa cặp `(client_timestamp, id)` của biên cũ nhất và dùng để load các tin nhắn cũ hơn (infinite scroll ngược lên), tránh trùng/thiếu khi nhiều tin nhắn có cùng timestamp. Tương ứng FR-12.

*Lý do response có hai timestamp (client_timestamp và created_at): client_timestamp là thứ tự gửi theo ý người dùng — dùng để hiển thị và sắp xếp tin nhắn; created_at là thứ tự server nhận — dùng để index DB và audit. Khi mạng không ổn định, hai giá trị này có thể lệch nhau. Client hiển thị theo client_timestamp, server index theo created_at. Đây là thiết kế có chủ đích, không phải dữ liệu trùng lặp.*

Path Parameter

| **Tham số** | **Kiểu** | **Bắt buộc** | **Mô tả**                                                          |
|-------------|----------|--------------|--------------------------------------------------------------------|
| **id**      | UUID     | Có           | ID của conversation — user phải là thành viên của conversation này |

Query Parameters

| **Tham số** | **Kiểu** | **Bắt buộc** | **Mô tả**                                              |
|-------------|----------|--------------|--------------------------------------------------------|
| **cursor**  | string   | Không        | `prev_cursor` để load tin nhắn cũ hơn (lấy từ response trước) |
| **limit**   | integer  | Không        | Số tin nhắn mỗi trang, mặc định 30, tối đa 100         |

Response 200 OK

{ "data": \[ { "id": "uuid", "sender_id": "uuid", "content": "Xin chào!", "status": "read", "client_timestamp": "2026-06-21T10:30:00Z", "created_at": "2026-06-21T10:30:01Z" } \], "prev_cursor": "eyJpZCI6InV1aWQiLCJ0IjoiMTcxMCJ9", "has_more": false }

HTTP Status Codes

| **HTTP Status** | **Ý nghĩa** | **Trường hợp cụ thể**                           |
|-----------------|-------------|-------------------------------------------------|
| **200**         | OK          | Danh sách tin nhắn trả về thành công            |
| **403**         | Forbidden   | User không phải thành viên của conversation này |
| **404**         | Not Found   | Conversation không tồn tại                      |

### 6.5. POST /conversations/{id}/messages

Gửi tin nhắn mới vào conversation. Tương ứng FR-11. Message ID do client sinh (UUID v4) và gửi kèm để đảm bảo idempotency (NFR-24): nếu mạng đứt client gửi lại, server dùng ON CONFLICT DO NOTHING theo message ID.

Request Body

| **Field**            | **Kiểu** | **Bắt buộc** | **Mô tả**                                                                                                   |
|----------------------|----------|--------------|-------------------------------------------------------------------------------------------------------------|
| **id**               | UUID     | Có           | UUID do client sinh trước khi gửi — idempotency key (NFR-24, DDD bảng messages)                             |
| **content**          | string   | Có           | Nội dung tin nhắn — không rỗng, tối đa 4000 ký tự                                                           |
| **client_timestamp** | string   | Có           | Timestamp ISO 8601 thời điểm gửi theo đồng hồ client — phải trong khoảng ±5 phút so với server time (DD-04) |

Response 201 Created (tin nhắn mới) hoặc 200 OK (tin nhắn trùng — idempotent)

{ "id": "uuid", "conversation_id": "uuid", "sender_id": "uuid", "content": "Xin chào!", "status": "sent", "client_timestamp": "2026-06-21T10:30:00Z", "created_at": "2026-06-21T10:30:01Z" }

HTTP Status Codes

| **HTTP Status** | **Ý nghĩa** | **Trường hợp cụ thể**                                                               |
|-----------------|-------------|-------------------------------------------------------------------------------------|
| **201**         | Created     | Tin nhắn mới được tạo thành công                                                    |
| **200**         | OK          | Tin nhắn với ID này đã tồn tại (gửi trùng) — trả về tin nhắn gốc, không tạo bản sao |
| **400**         | Bad Request | content rỗng hoặc quá dài; client_timestamp lệch quá ±5 phút                        |
| **403**         | Forbidden   | User không phải thành viên của conversation                                         |

### 6.6. PUT /conversations/{id}/messages/{msgId}

Cập nhật trạng thái tin nhắn. Chỉ recipient được phép gọi; sender và user ngoài conversation nhận 403. Message phải thuộc đúng conversation trên path và cả hai resource phải chưa soft-delete, nếu không trả 404.

Request Body

| **Field**  | **Kiểu** | **Bắt buộc** | **Mô tả**                                                                     |
|------------|----------|--------------|-------------------------------------------------------------------------------|
| **status** | string   | Có           | Trạng thái mới: 'delivered' hoặc 'read' — không thể quay lại trạng thái trước |

Các bước tăng hợp lệ: `sent → delivered`, `sent → read`, `delivered → read`. Gửi lại cùng trạng thái là idempotent: trả 200 nhưng không đổi `updated_at` và không publish lại. Trạng thái giảm trả `400 VALIDATION_ERROR`, không thay đổi dữ liệu.

Response 200 OK

{ "id": "uuid", "status": "read", "updated_at": "2026-06-21T10:31:00Z" }

Khi trạng thái thực sự tăng, Backend chỉ publish sau khi transaction database commit thành công. Event `MESSAGE_STATUS_UPDATE` được gửi best-effort tới cả `messaging:user:{senderUserId}` và `messaging:user:{recipientUserId}` để đồng bộ nhiều phiên/thiết bị; client xử lý event idempotent. Lỗi Redis được ghi log/metric nhưng không rollback dữ liệu hoặc làm REST API thất bại. Việc đổi status không cập nhật `conversation.updated_at`.

HTTP Status Codes

| **HTTP Status** | **Ý nghĩa** | **Trường hợp cụ thể**                                           |
|-----------------|-------------|-----------------------------------------------------------------|
| **200**         | OK          | Trạng thái đã cập nhật                                          |
| **400**         | Bad Request | status không hợp lệ hoặc cố giảm trạng thái (ví dụ read → sent) |
| **403**         | Forbidden   | User không phải người nhận của tin nhắn này                     |
| **404**         | Not Found   | Conversation/message không tồn tại, đã soft-delete hoặc message không thuộc conversation |

## 7. Nhóm Videos

*Kiến trúc lưu trữ video: MinIO (self-hosted S3-compatible, chạy Docker container riêng) làm Media Storage. Video được upload theo cơ chế multipart: client chia video thành các chunk, upload từng chunk trực tiếp lên MinIO qua presigned URL — Backend không làm trung gian cho dữ liệu video, chỉ điều phối metadata và URL. Khi upload hoàn tất, MinIO gửi webhook về Backend để cập nhật trạng thái — client không tự khai báo trạng thái. Cơ chế này hỗ trợ NFR-26: nếu browser crash giữa chừng, các chunk đã upload vẫn còn trên MinIO; user có thể tiếp tục khi quay lại.*

### 7.1. GET /videos

Danh sách video trong thư viện cá nhân. Tương ứng FR-17. storage_used_bytes chỉ tính video có status = ready. Video ở trạng thái recording (đang quay) CÓ xuất hiện trong danh sách — client dùng để hiển thị 'đang quay' và cho phép resume nếu bị gián đoạn.

Query Parameters

| **Tham số** | **Kiểu** | **Bắt buộc** | **Mô tả**                                                                      |
|-------------|----------|--------------|--------------------------------------------------------------------------------|
| **cursor**  | string   | Không        | Cursor pagination                                                              |
| **limit**   | integer  | Không        | Mặc định 20, tối đa 50                                                         |
| **status**  | string   | Không        | Lọc theo trạng thái: recording/processing/ready/failed (bốn trạng thái hợp lệ) |

Response 200 OK

{ "data": \[ { "id": "uuid", "title": "Demo avatar 21/06", "status": "ready", "duration_secs": 120, "file_size_bytes": 15728640, "format": "mp4", "created_at": "2026-06-21T10:00:00Z" } \], "storage_used_bytes": 52428800, "storage_limit_bytes": 2147483648, "next_cursor": null, "has_more": false }

*storage_used_bytes tính tổng file_size_bytes của các video có status = ready — video đang processing hoặc failed không tính vào quota. Khi video failed, không cần giải phóng quota vì chưa từng tính.*

### 7.2. POST /videos

Khởi tạo phiên quay video: tạo bản ghi metadata + khởi tạo MinIO multipart upload. Trả về upload_id và presigned URL cho chunk đầu tiên. Tương ứng FR-16. Server chỉ kiểm tra quota ước tính ở bước này, không tính vào quota thật cho đến khi finalize thành công.

Request Body

| **Field**                | **Kiểu** | **Bắt buộc** | **Mô tả**                                                                                       |
|--------------------------|----------|--------------|-------------------------------------------------------------------------------------------------|
| **title**                | string   | Có           | Tên video — mặc định từ client là timestamp, có thể đổi sau                                     |
| **estimated_size_bytes** | integer  | Có           | Kích thước ước tính (bytes) — server kiểm tra còn đủ dung lượng ước tính không (NFR-19)         |
| **chunk_size_bytes**     | integer  | Có           | Kích thước mỗi chunk (bytes) — tối thiểu 5MB theo MinIO multipart requirement, khuyến nghị 10MB |
| **format**               | string   | Không        | Định dạng file, mặc định 'mp4' (NFR-18)                                                         |

Response 201 Created

{ "id": "uuid", "title": "Demo avatar 21/06", "status": "recording", "upload_id": "minio-multipart-upload-id", "first_chunk_url": "https://minio.internal/veiltalk/videos/uuid/part1?X-Amz-Signature=...", "part_number": 1, "created_at": "2026-06-21T10:00:00Z" }

HTTP Status Codes

| **HTTP Status** | **Ý nghĩa**          | **Trường hợp cụ thể**                                             |
|-----------------|----------------------|-------------------------------------------------------------------|
| **201**         | Created              | Phiên quay khởi tạo thành công, first_chunk_url sẵn sàng          |
| **400**         | Bad Request          | estimated_size_bytes hoặc chunk_size_bytes không hợp lệ           |
| **507**         | Insufficient Storage | Dung lượng tài khoản không đủ để chứa ước tính video này (NFR-19) |
| **401**         | Unauthorized         | Token không hợp lệ                                                |

### 7.3. POST /videos/{id}/chunks

Lấy presigned URL cho chunk tiếp theo trong phiên quay đang diễn ra. Client gọi endpoint này sau khi PUT thành công chunk trước lên MinIO.

Request Body

| **Field**         | **Kiểu** | **Bắt buộc** | **Mô tả**                                                                                                                                                                                                                                                         |
|-------------------|----------|--------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **upload_id**     | string   | Có           | MinIO multipart upload ID (nhận từ POST /videos)                                                                                                                                                                                                                  |
| **part_number**   | integer  | Có           | Số thứ tự chunk tiếp theo (bắt đầu từ 2)                                                                                                                                                                                                                          |
| **etag_previous** | string   | Có           | ETag MinIO trả về khi PUT chunk trước. Backend lưu danh sách ETag theo thứ tự part_number để dùng lại ở bước finalize — MinIO CompleteMultipartUpload yêu cầu đủ ETag của tất cả part theo đúng thứ tự. Backend không gọi lại MinIO để verify từng ETag riêng lẻ. |

Response 200 OK

{ "chunk_url": "https://minio.internal/veiltalk/videos/uuid/part2?X-Amz-Signature=...", "part_number": 2, "expires_in": 3600 }

HTTP Status Codes

| **HTTP Status** | **Ý nghĩa**          | **Trường hợp cụ thể**                                                                                                     |
|-----------------|----------------------|---------------------------------------------------------------------------------------------------------------------------|
| **200**         | OK                   | Presigned URL cho chunk tiếp theo                                                                                         |
| **400**         | Bad Request          | upload_id không hợp lệ, part_number không đúng thứ tự, hoặc etag_previous không khớp                                      |
| **403**         | Forbidden            | Video không thuộc về user này                                                                                             |
| **404**         | Not Found            | Video không tồn tại hoặc phiên upload đã hết hạn                                                                          |
| **507**         | Insufficient Storage | Ước lượng bảo thủ (readyBytes + part_number × chunk_size_bytes) đã vượt 2GB khi cấp chunk mới — server từ chối cấp URL tiếp theo; client nên gọi POST /videos/{id}/abort. Dung lượng thực chỉ được chốt ở webhook (mục 7.6). |

*Backend lưu state phiên trong Redis (`video:upload:{videoId}`, TTL refresh mỗi thao tác): upload_id, chunk_size_bytes, con trỏ next_part_number tường minh và các ETag theo part. Việc kiểm tra thứ tự + idempotency + quota + cập nhật con trỏ chạy nguyên tử bằng một Lua script (tránh race giữa các request đồng thời). ETag của một request part_number = K thuộc về part K-1 (part vừa PUT xong). Idempotency: gọi lại đúng part cũ với đúng ETag → cấp lại URL, không nhân đôi ETag; đúng part cũ nhưng ETag khác → 400; part_number nhảy cóc → 400.*

### 7.4. POST /videos/{id}/finalize

Hoàn tất phiên quay: Backend xác thực parts/quota, commit nguyên tử `recording → processing` cùng kích thước và thời lượng thực trước khi gọi MinIO CompleteMultipartUpload. MinIO gộp các part thành file hoàn chỉnh, sau đó gửi webhook tới Backend để cập nhật `processing → ready`.

Request Body

| **Field**         | **Kiểu** | **Bắt buộc** | **Mô tả**                                                                                     |
|-------------------|----------|--------------|-----------------------------------------------------------------------------------------------|
| **upload_id**     | string   | Có           | MinIO multipart upload ID                                                                     |
| **parts**         | array    | Có           | Danh sách {part_number, etag} của tất cả chunk đã upload — dùng để MinIO verify tính toàn vẹn |
| **duration_secs** | integer  | Có           | Thời lượng video thực tế đo được phía client                                                  |

Response 202 Accepted

{ "id": "uuid", "status": "processing", "message": "Upload hoàn tất, đang xử lý. Trạng thái sẽ cập nhật qua MinIO webhook." }

*Trước khi complete, Backend gọi ListParts có phân trang, đối chiếu part number/ETag giữa request, Redis và MinIO, rồi cộng kích thước part thực. Quota finalize tính tổng video `ready` + `processing` chưa xóa mềm dưới Redis lock theo user. Backend commit nguyên tử `recording → processing` trước lời gọi CompleteMultipartUpload để webhook đến tức thời không bị bỏ qua. Nếu Complete trả lỗi không xác định, Backend HEAD object: object đúng kích thước được reconcile thành `ready`; nếu object chưa tồn tại và multipart vẫn còn nguyên thì conditional quay lại `recording`; nếu MinIO không xác định được thì giữ `processing` để job timeout kiểm tra lại. Không phụ thuộc MinIO retry webhook.*

*Fallback nếu MinIO webhook không bao giờ đến: Backend có background job chạy mỗi 5 phút và lấy cùng distributed operation lock của video. Với video `processing` quá 10 phút, job HEAD object trước: object đúng kích thước được conditional chuyển `processing → ready`; MinIO tạm thời không truy cập được thì giữ `processing` để thử lại; chỉ khi không có object hoặc object sai kích thước mới conditional chuyển `processing → failed`. Object sai kích thước được xóa best-effort. Mọi transition đều conditional nên không ghi đè `ready`.*

HTTP Status Codes

| **HTTP Status** | **Ý nghĩa**          | **Trường hợp cụ thể**                                                                  |
|-----------------|----------------------|----------------------------------------------------------------------------------------|
| **202**         | Accepted             | Finalize request được nhận, đang xử lý bất đồng bộ                                     |
| **400**         | Bad Request          | parts không đầy đủ hoặc etag không khớp với những gì MinIO ghi nhận                    |
| **403**         | Forbidden            | Video không thuộc về user này                                                          |
| **409**         | Conflict             | Video đã ở trạng thái ready hoặc đã được finalize trước đó                             |
| **507**         | Insufficient Storage | Dung lượng thực tế làm tổng `ready + processing` vượt 2GB — multipart bị abort, video chuyển `failed` và xóa mềm |

### 7.5. POST /videos/{id}/abort

Hủy phiên quay đang dở. Backend gọi MinIO AbortMultipartUpload để dọn sạch các chunk đã upload. Sau khi MinIO thành công, Backend đổi nguyên tử `recording → failed`, đặt `deleted_at` và xóa Redis session. Nếu MinIO lỗi, DB/session được giữ nguyên. Các API thông thường không nhìn thấy record đã xóa mềm.

Request Body

| **Field**     | **Kiểu** | **Bắt buộc** | **Mô tả**                         |
|---------------|----------|--------------|-----------------------------------|
| **upload_id** | string   | Có           | MinIO multipart upload ID cần hủy |

HTTP Status Codes

| **HTTP Status** | **Ý nghĩa** | **Trường hợp cụ thể**                           |
|-----------------|-------------|-------------------------------------------------|
| **204**         | No Content  | Phiên upload đã được hủy, chunks đã dọn sạch    |
| **403**         | Forbidden   | Video không thuộc về user này                   |
| **404**         | Not Found   | Video không tồn tại hoặc upload_id không hợp lệ |

### 7.6. POST /internal/videos/webhook

Webhook endpoint — chỉ nhận request từ MinIO, không phải từ client. MinIO gửi notification này sau khi CompleteMultipartUpload hoàn tất. Backend xác thực shared secret trong toàn bộ header `Authorization` trước khi xử lý; đây không phải HMAC và Backend không diễn giải secret như JWT.

*Endpoint này được đặt ở `/internal/` và không có trong CORS policy. CORS không phải lớp xác thực; shared-secret header mới là lớp bảo vệ bắt buộc ở mức MVP. JWT filter chủ động bỏ qua đúng endpoint này để filter webhook riêng xử lý.*

Request Header

```http
Authorization: Bearer <MINIO_WEBHOOK_SECRET>
```

Backend so sánh constant-time toàn bộ giá trị `Bearer <configured-secret>`. Header thiếu, sai scheme, sai secret, JWT Bearer hợp lệ hoặc có ký tự thừa đều trả cùng `401 UNAUTHORIZED`; header và secret không được ghi log hay đưa vào response. `MINIO_WEBHOOK_SECRET` bắt buộc có giá trị, nếu thiếu/rỗng thì Backend fail-fast khi khởi động. Shared secret tĩnh không chống replay về mặt mật mã; conditional state transition idempotent giới hạn tác hại replay. HMAC body kèm timestamp/nonce hoặc mTLS là hardening ngoài MVP.

Request từ MinIO (tự động; cấu trúc đã đối chiếu với MinIO `RELEASE.2025-09-07T16-13-09Z`)

{ "EventName": "s3:ObjectCreated:CompleteMultipartUpload", "Records": \[{ "eventName": "s3:ObjectCreated:CompleteMultipartUpload", "s3": { "bucket": { "name": "veiltalk" }, "object": { "key": "videos%2Fuuid%2Fsource.mp4", "size": 15728640, "eTag": "abc123" } } }\] }

Backend validate cấu trúc toàn bộ `Records` trước khi update, URL-decode object key đúng một lần, kiểm event chính xác `s3:ObjectCreated:CompleteMultipartUpload` và bucket khớp cấu hình. Sau đó tìm video bằng exact `storage_path` và update nguyên tử `processing → ready` chỉ khi `deleted_at IS NULL` và `file_size_bytes = object.size` (T22 đã lưu kích thước thật).

- JSON/record sai cấu trúc → `400 VALIDATION_ERROR`, không partial update.
- Thiếu/sai Authorization → `401 UNAUTHORIZED` với cùng response trung lập.
- Update thành công → `204 No Content`.
- Webhook lặp, video ready/failed/soft-delete, object không tồn tại hoặc event/bucket không áp dụng → no-op `204`.
- Video processing nhưng size không khớp → giữ processing, log cảnh báo integrity và trả `204`; timeout job T22 sẽ chuyển failed.
- Lỗi database tạm thời → `500`; MinIO phiên bản đang chạy đã được spike xác nhận không retry webhook non-2xx, nên tính đúng đắn không phụ thuộc vào lần gửi lại này. Finalize commit `processing` trước Complete và timeout HEAD reconciliation là hai lớp chống mất event.

### 7.7. GET /videos/{id}

Lấy chi tiết một video kèm presigned URL để phát. URL này có thời hạn 1 giờ.

Response 200 OK — video ready

{ "id": "uuid", "title": "Demo avatar 21/06", "status": "ready", "duration_secs": 120, "file_size_bytes": 15728640, "format": "mp4", "view_url": "https://minio.internal/veiltalk/videos/uuid/demo.mp4?X-Amz-Expires=3600&...", "created_at": "2026-06-21T10:00:00Z", "updated_at": "2026-06-21T10:05:00Z" }

Response 200 OK — video failed (upload lỗi)

{ "id": "uuid", "title": "Demo avatar 21/06", "status": "failed", "duration_secs": null, "file_size_bytes": 0, "format": "mp4", "view_url": null, "created_at": "2026-06-21T10:00:00Z", "updated_at": "2026-06-21T10:02:00Z" }

*Khi status = failed: view_url luôn là null, client không nên cố phát. Video failed không tính vào storage_used_bytes. User có thể xóa video failed để dọn dẹp thư viện.*

### 7.8. PUT /videos/{id}

Đổi tên video. Tương ứng FR-17.

Request Body

| **Field** | **Kiểu** | **Bắt buộc** | **Mô tả**             |
|-----------|----------|--------------|-----------------------|
| **title** | string   | Có           | Tên mới — 1-255 ký tự |

HTTP Status Codes

| **HTTP Status** | **Ý nghĩa** | **Trường hợp cụ thể**                          |
|-----------------|-------------|------------------------------------------------|
| **200**         | OK          | Tên đã được cập nhật, trả về video với tên mới |
| **400**         | Bad Request | title rỗng hoặc quá dài                        |
| **403**         | Forbidden   | Video không thuộc về user này                  |
| **404**         | Not Found   | Video không tồn tại                            |

### 7.9. DELETE /videos/{id}

Xóa video, soft delete (deleted_at = NOW()). Tương ứng FR-17. Nếu video có status = ready, storage_used_bytes của user giảm ngay lập tức. Background job dọn dẹp file MinIO sau.

HTTP Status Codes

| **HTTP Status** | **Ý nghĩa** | **Trường hợp cụ thể**         |
|-----------------|-------------|-------------------------------|
| **204**         | No Content  | Video đã được đánh dấu xóa    |
| **403**         | Forbidden   | Video không thuộc về user này |
| **404**         | Not Found   | Video không tồn tại           |

## 8. Nhóm Metrics

### 8.1. POST /metrics/client

Nhận số liệu hiệu năng từ client để hệ thống theo dõi việc tuân thủ NFR-01, NFR-02, NFR-03 trong môi trường thực (NFR-22). Client gửi định kỳ mỗi 5 giây khi đang trong cuộc gọi. Rate limit: tối đa 1 request/3 giây/user — client gửi quá nhanh do lỗi sẽ nhận 429 và dừng gửi trong khoảng thời gian Retry-After.

Request Body

| **Field**               | **Kiểu** | **Bắt buộc** | **Mô tả**                                                               |
|-------------------------|----------|--------------|-------------------------------------------------------------------------|
| **session_type**        | string   | Có           | 'call' hoặc 'preview' (xem trước avatar)                                |
| **tracking_latency_ms** | integer  | Không        | Độ trễ tracking-to-render trung bình trong cửa sổ vừa rồi (ms) — NFR-01 |
| **fps**                 | number   | Không        | Frame rate trung bình (fps) — NFR-02                                    |
| **webrtc_rtt_ms**       | integer  | Không        | Round-trip time WebRTC (ms) — NFR-03, chỉ khi session_type = call       |
| **timestamp**           | string   | Có           | Thời điểm đo ISO 8601                                                   |

HTTP Status Codes

| **HTTP Status** | **Ý nghĩa**       | **Trường hợp cụ thể**                                                |
|-----------------|-------------------|----------------------------------------------------------------------|
| **204**         | No Content        | Metrics được nhận và lưu thành công                                  |
| **400**         | Bad Request       | Thiếu trường bắt buộc hoặc giá trị không hợp lệ                      |
| **401**         | Unauthorized      | Token không hợp lệ                                                   |
| **429**         | Too Many Requests | Vượt rate limit 1 req/3 giây; header Retry-After ghi số giây cần chờ |

## 9. Xử lý Lỗi Chung

### 9.1. Định dạng response lỗi

Tất cả response lỗi (4xx, 5xx) đều trả về JSON theo định dạng nhất quán sau:

{ "error": { "code": "VALIDATION_ERROR", "message": "display_name không được để trống", "details": { "field": "display_name", "constraint": "required" } } }

*Lưu ý: message được thiết kế để đọc được bởi developer, không phải hiển thị trực tiếp cho end user — client có trách nhiệm dịch sang thông báo thân thiện hơn khi cần.*

### 9.2. Mã lỗi (error.code)

| **Mã lỗi**                 | **HTTP Status** | **Ý nghĩa**                                                                                                                                     |
|----------------------------|-----------------|-------------------------------------------------------------------------------------------------------------------------------------------------|
| **VALIDATION_ERROR**       | 400             | Input không hợp lệ (format, range, required)                                                                                                    |
| **UNAUTHORIZED**           | 401             | Token thiếu, hết hạn, hoặc không hợp lệ                                                                                                         |
| **FORBIDDEN**              | 403             | Đã xác thực nhưng không có quyền thực hiện hành động                                                                                            |
| **NOT_FOUND**              | 404             | Resource không tồn tại hoặc đã bị xóa                                                                                                           |
| **CONFLICT**               | 409             | Vi phạm unique constraint (email đã tồn tại, ID trùng...)                                                                                       |
| **RATE_LIMITED**           | 429             | Vượt giới hạn tần suất request; xem header Retry-After                                                                                          |
| **STORAGE_QUOTA_EXCEEDED** | 507             | Không đủ dung lượng lưu trữ (NFR-19) — 507 Insufficient Storage theo RFC 4918, chính xác hơn 409 Conflict vì đây không phải xung đột tài nguyên |
| **INTERNAL_ERROR**         | 500             | Lỗi nội bộ server không mong đợi — đã được ghi log (NFR-21)                                                                                     |

### 9.3. Header bảo mật

Tất cả response đều có các header sau (nhất quán với NFR-32 và SAD mục 9.1):

| **Header**                      | **Giá trị**                         | **Mục đích**                          |
|---------------------------------|-------------------------------------|---------------------------------------|
| **Strict-Transport-Security**   | max-age=31536000; includeSubDomains | HSTS — buộc trình duyệt dùng HTTPS    |
| **Access-Control-Allow-Origin** | https://app.veiltalk.example.com    | CORS — chỉ cho phép origin của client |
| **X-Content-Type-Options**      | nosniff                             | Ngăn MIME type sniffing               |
| **X-Frame-Options**             | DENY                                | Ngăn clickjacking                     |

## 10. WebSocket API

Ngoài REST API, hệ thống có hai kênh WebSocket độc lập. Phần này đặc tả ngắn gọn để đủ làm căn cứ cài đặt — hai kênh này không phải REST nhưng thuộc về Backend API nên được đưa vào tài liệu này (nhất quán với SAD mục 4.1.4 ghi rõ 'hai WebSocket song song').

### 10.1. Kênh Messaging WebSocket

URL: wss://veiltalk.example.com/ws/messaging

Mục đích: đẩy tin nhắn thời gian thực tới client (FR-11, NFR-14). Client kết nối sau khi đăng nhập và giữ kết nối trong suốt phiên làm việc.

Xác thực

- Gửi JWT trong query parameter khi kết nối: wss://...?token=\<access_token\>

- Chỉ chấp nhận access token. Server từ chối handshake bằng HTTP 401, không upgrade
  WebSocket, nếu token thiếu, sai chữ ký, hết hạn, là refresh token, đã bị blacklist,
  bị thu hồi toàn bộ theo user, hoặc user không còn hoạt động/đã soft-delete.

- Origin của client phải nằm trong `CORS_ALLOWED_ORIGINS`; không chấp nhận wildcard.

- Access token trong query là dữ liệu nhạy cảm. Backend và reverse proxy không được ghi
  nguyên query URI vào log. Production bắt buộc dùng `wss://`.

Giới hạn và đóng kết nối

- Text frame tối đa 32 KiB. Mức này lớn hơn envelope `NEW_MESSAGE` chứa content tối đa
  4000 ký tự, kể cả trường hợp JSON phải escape toàn bộ. Frame lớn hơn giới hạn bị đóng
  bằng code 1009.

| **Code** | **Ý nghĩa** |
|----------|-------------|
| **1000** | Client đóng kết nối bình thường |
| **1001** | Backend graceful shutdown/restart |
| **1008** | Client vi phạm contract lần thứ 3 trong cùng connection |
| **1009** | Text frame vượt giới hạn 32 KiB |
| **1011** | Lỗi I/O session hoặc lỗi server không thể phục hồi |
| **4002** | Access token hết hạn hoặc bị thu hồi trong khi socket đang mở |
| **4003** | Không nhận PONG cho hai lần PING liên tiếp |

Message từ server → client

{ "type": "NEW_MESSAGE", "data": { "id": "uuid", "conversation_id": "uuid", "sender_id": "uuid", "content": "Xin chào!", "status": "sent", "client_timestamp": "2026-06-21T10:30:00Z", "created_at": "2026-06-21T10:30:01Z" } }

{ "type": "MESSAGE_STATUS_UPDATE", "data": { "id": "uuid", "status": "delivered" } }

{ "type": "CALL_INCOMING", "data": { "caller_id": "uuid", "caller_display_name": "Nguyễn Văn A", "call_session_id": "uuid" } // B nhận message này qua Messaging WS → hiện SCR-15 (incoming call screen) // → B kết nối Signaling WS → gửi CALL_ANSWER hoặc CALL_REJECT }

*Lưu ý về CALL_INCOMING: đây là cơ chế giải quyết vấn đề 'B biết có cuộc gọi đến bằng cách nào'. B luôn duy trì kết nối Messaging WebSocket (thường trực) → khi A gọi, Signaling Server relay CALL_OFFER đến A và đồng thời Backend gửi CALL_INCOMING qua Messaging WS đến B → B kết nối Signaling WS để xử lý cuộc gọi. Điều này giải thích tại sao hai WebSocket phải tồn tại song song (SAD mục 4.1.4).*

{ "type": "PING" } // Server gửi ngay sau khi kết nối và sau đó mỗi 30 giây, client phải trả PONG

{ "type": "ERROR", "data": { "code": "VALIDATION_ERROR", "message": "Invalid WebSocket event payload" } }

Message từ client → server

{ "type": "TYPING", "data": { "conversation_id": "uuid" } // Client gửi khi bắt đầu gõ, gửi lại mỗi 2 giây nếu vẫn đang gõ }

{ "type": "TYPING_STOP", "data": { "conversation_id": "uuid" } // Client gửi khi dừng gõ (sau 3 giây không gõ thêm, hoặc gửi tin nhắn) // Server relay tới người nhận để ẩn "Đang soạn tin..." indicator }

{ "type": "PONG" } // Client phải trả PONG khi nhận PING

`TYPING`/`TYPING_STOP` chỉ hợp lệ khi sender là thành viên của conversation active.
Conversation không tồn tại, đã soft-delete hoặc sender không phải thành viên đều nhận cùng
`ERROR` code `FORBIDDEN`, không tiết lộ tài nguyên có tồn tại hay không. Event được publish
tới user còn lại, không gửi lại chính sender, không lưu database và không replay khi reconnect.

JSON hỏng, thiếu/sai kiểu `data.conversation_id` trả `ERROR` code `VALIDATION_ERROR`; type
không hỗ trợ trả `UNSUPPORTED_EVENT`. Hai vi phạm đầu giữ connection. Vi phạm lần thứ ba
vẫn nhận `ERROR` rồi connection đóng code 1008. Bộ đếm thuộc từng connection và không ảnh
hưởng tab/thiết bị khác.

Mỗi `PONG` hợp lệ đặt lại bộ đếm heartbeat. Nếu không nhận `PONG` cho hai lần `PING`
liên tiếp, server đóng connection bằng code 4003 (xấp xỉ 60 giây với chu kỳ mặc định).
Mỗi chu kỳ server đồng thời kiểm tra blacklist/global revocation; token hết hạn hoặc bị
thu hồi làm connection đóng bằng code 4002. Nếu Redis lỗi trong lúc kiểm tra lại, server
giữ connection, ghi log lỗi và tăng metric
`messaging.websocket.auth.recheck.failures`, rồi thử lại ở chu kỳ kế tiếp.

Một user có thể có nhiều connection đồng thời (nhiều tab/thiết bị). Đóng một connection
chỉ dọn đúng connection đó, không làm gián đoạn các connection còn lại của cùng user.

Mỗi Backend instance static-subscribe Redis pattern `messaging:user:*`. Subscriber chỉ chấp
nhận envelope `NEW_MESSAGE`, `MESSAGE_STATUS_UPDATE`, `CALL_INCOMING`, `TYPING` hoặc
`TYPING_STOP`, tách recipient `userId` từ channel và chuyển nguyên envelope tới mọi
connection local của user. Lỗi
subscriber/Redis không đóng WebSocket; backend tăng metric
`messaging.redis.subscribe.failures`, đặt health component `messagingRedisSubscriber` thành
`DEGRADED` và tự phục hồi subscription khi Redis kết nối lại. Lỗi gửi riêng một connection
tăng `messaging.websocket.delivery.failures` và đóng connection đó bằng code 1011, không
chặn fan-out tới connection khác. Event Pub/Sub bị lỡ không được replay; client đồng bộ lại
bằng message history khi reconnect.

### 10.2. Kênh Signaling WebSocket

URL: wss://veiltalk.example.com/ws/signaling

Mục đích: trao đổi SDP offer/answer và ICE candidate để thiết lập kết nối WebRTC P2P (SAD mục 4.2). Kênh này tách biệt hoàn toàn với Messaging WebSocket về mục đích và vòng đời.

*Vòng đời kết nối: client kết nối Signaling WebSocket chỉ khi bắt đầu quá trình gọi (bấm nút gọi hoặc nhận thông báo có cuộc gọi đến). Sau khi RTCPeerConnection chuyển trạng thái ICE 'connected' (hoặc thất bại), client ngắt kết nối Signaling WebSocket — không duy trì thường trực. Signaling Server dọn dẹp phiên sau 30 giây không có activity (SAD mục 4.2).*

Xác thực

- JWT bắt buộc trong WebSocket handshake — Signaling Server validate chữ ký trước khi relay (SAD mục 4.2, bổ sung từ lần review SAD).
- Token không hợp lệ/thiếu: Signaling Server **accept handshake rồi đóng ngay bằng WebSocket close code 4001** (TC-49), khác với Messaging WebSocket — nơi handshake bị từ chối bằng **HTTP 401 trước khi upgrade** (mục 10.1, TC-47). Khác biệt này có chủ đích: Messaging WS dùng Spring `HandshakeInterceptor` (chạy trước khi nâng cấp giao thức, có thể set HTTP status), còn Signaling WS validate trong callback `connection` của thư viện `ws` (sau khi giao thức đã nâng cấp lên WebSocket, không còn set được HTTP status) — phản ánh đúng vòng đời khác nhau của hai kênh (P3-T01).

Message types

| **Type**          | **Hướng**          | **Payload chính**   | **Mô tả**                            |
|-------------------|--------------------|---------------------|--------------------------------------|
| **CALL_OFFER**    | A → Server → B     | sdp, target_user_id | A gửi SDP offer, Server relay tới B  |
| **CALL_ANSWER**   | B → Server → A     | sdp                 | B gửi SDP answer, Server relay tới A |
| **ICE_CANDIDATE** | A/B → Server → B/A | candidate, sdp_mid  | Trao đổi ICE candidate hai chiều     |
| **CALL_REJECT**   | B → Server → A     | reason              | B từ chối cuộc gọi                   |
| **CALL_END**      | A/B → Server → B/A | \-                  | Kết thúc cuộc gọi, giải phóng phiên  |

Relay: Server gắn thêm `from_user_id` (userId của người gửi, lấy từ JWT đã xác thực ở handshake) vào message trước khi relay, để phía nhận biết message đến từ ai. Message có `type` không thuộc bảng trên hoặc thiếu `target_user_id` bị Server bỏ qua (không phản hồi lỗi).

Lỗi target offline: nếu `target_user_id` không có kết nối Signaling WebSocket nào đang mở, Server gửi lại cho sender:

```json
{ "type": "ERROR", "data": { "code": "TARGET_OFFLINE", "message": "Target user is not connected to the signaling server", "target_user_id": "uuid" } }
```

Từ P3-T04: khi nhận `CALL_OFFER`, Signaling Server gọi Backend trước (`POST /internal/call/notify`, xem mục 10.3) để đẩy `CALL_INCOMING` cho B qua Messaging WebSocket — B thường **chưa** có kết nối Signaling WebSocket ở thời điểm này (chỉ mở sau khi thấy `CALL_INCOMING`). Nếu lệnh notify đó thất bại (callee không tồn tại/đã xoá mềm, backend lỗi, hoặc quá timeout `CALL_NOTIFY_TIMEOUT_MS`), Signaling Server trả về **cùng lỗi `TARGET_OFFLINE`** ở trên cho A — không phân biệt lý do thất bại, kể cả khi B tình cờ đang có một kết nối Signaling WebSocket khác mở sẵn. Đây là nguyên tắc chống dò tài khoản (AGENTS.md) áp dụng ở ranh giới signaling↔client: A không được biết B không tồn tại khác với B chỉ đang offline.

Rate limiting: tối đa 20 kết nối WebSocket mới/địa chỉ IP/phút (SAD mục 4.2, 9.4 — chống DoS). Vượt ngưỡng: Server **accept handshake rồi đóng ngay bằng close code 4029** (cùng cơ chế với 4001 ở trên — thư viện `ws` không set được HTTP status sau khi giao thức đã nâng cấp). Địa chỉ IP dùng để rate-limit lấy theo cấu hình `TRUSTED_PROXY_IPS` (xem `docs/08_DEPLOYMENT_AND_OPERATIONS.md`) — P3-T02.

### 10.3. Nội bộ: POST /internal/call/notify (P3-T04)

Cầu nối Signaling Server → Backend để đẩy `CALL_INCOMING` (mục 10.1) qua Messaging WebSocket của callee. Chỉ Signaling Server gọi endpoint này, không phải client.

Xác thực: header `Authorization: Bearer <INTERNAL_CALL_NOTIFY_SECRET>` (cùng cơ chế shared-secret constant-time-compare như `/internal/videos/webhook` — mục MinIO webhook). Sai/thiếu secret trả `401 UNAUTHORIZED`.

Request body:

```json
{ "caller_id": "uuid", "callee_id": "uuid" }
```

Response:

- `204 No Content` — callee hợp lệ (tồn tại, chưa xoá mềm). Backend đã publish `CALL_INCOMING` (kèm `caller_display_name` tra từ `caller_id`, và `call_session_id` sinh xác định — xem dưới) tới `messaging:user:{callee_id}` qua Redis; mọi Backend instance subscribe kênh này sẽ đẩy tiếp qua Messaging WebSocket cho mọi tab/thiết bị của callee đang mở.
- `404 Not Found` — callee (hoặc caller) không tồn tại/đã xoá mềm. Backend không publish gì. Vì signaling là caller nội bộ tin cậy (không phải client), 404 ở đây **không** vi phạm nguyên tắc chống dò tài khoản — nguyên tắc đó chỉ áp khi signaling trả lời lại cho client A (mục 10.2, `TARGET_OFFLINE`).

`call_session_id`: sinh **xác định** (deterministic) từ cặp `(caller_id, callee_id)` đã chuẩn hoá thứ tự (giống cách `conversation_id` chuẩn hoá cặp user trong `ConversationService`, nhưng khác ở chỗ `call_session_id` **không** lưu DB hay giữ Map riêng — tính lại mỗi lần cần). Cùng một cặp user luôn ra cùng `call_session_id`, bất kể ai gọi ai trước.

*— Hết tài liệu —*
