TRƯỜNG ĐẠI HỌC CÔNG NGHỆ — ĐHQGHN

Khoa Công nghệ Thông tin

**TÀI LIỆU THIẾT KẾ CƠ SỞ DỮ LIỆU**

*(Database Design Document — DDD)*

**VEILTALK**

Hệ thống giao tiếp qua nhân vật ảo

Phiên bản tài liệu: 1.0

Trạng thái: Bản nháp (Draft)

Ngày cập nhật: 21/06/2026

Người soạn thảo: Lê Thị Tú Phương — MSSV 23020695

Lớp: K68 — Khoa Công nghệ Thông tin

Mục lục

## 1. Giới thiệu

### 1.1. Mục đích tài liệu

Tài liệu này đặc tả chi tiết thiết kế cơ sở dữ liệu của hệ thống VeilTalk, bao gồm: sơ đồ quan hệ thực thể (ERD), định nghĩa từng bảng, kiểu dữ liệu, ràng buộc toàn vẹn, chiến lược đánh index, và các quyết định thiết kế quan trọng. Tài liệu này là tài liệu bổ trợ cho SAD v1.0 (mục 4.4 — Database) và được tham chiếu từ SAD với cam kết 'schema chi tiết được trình bày trong Database Design Document riêng'.

### 1.2. Phạm vi

Bao phủ toàn bộ schema PostgreSQL của hệ thống VeilTalk MVP, bao gồm các bảng lưu trữ: tài khoản người dùng, hồ sơ nhân vật ảo, cuộc trò chuyện và tin nhắn, metadata video đã quay, và các cấu trúc hỗ trợ. Schema dữ liệu Redis (cache/pub-sub) được mô tả ở mức tổng quan, không có schema cứng.

### 1.3. Tài liệu liên quan

- SRS v1.0 — VeilTalk Software Requirements Specification.

- SAD v1.0 — VeilTalk Software Architecture Document (mục 4.4 tham chiếu tài liệu này).

- API Design Document (tham chiếu schema khi mô tả request/response body).

## 2. Tổng quan Schema

### 2.1. Công nghệ lựa chọn

| **Hạng mục**              | **Chi tiết**                                                                                                                                                                                              |
|---------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **RDBMS**                 | PostgreSQL 16                                                                                                                                                                                             |
| **Lý do chọn PostgreSQL** | Dữ liệu có quan hệ rõ ràng (user—message—conversation), cần ràng buộc toàn vẹn tham chiếu (FK), hỗ trợ native cho kiểu JSONB linh hoạt cho metadata, và người phát triển đã có kinh nghiệm với stack này. |
| **Encoding**              | UTF-8 (hỗ trợ đầy đủ tiếng Việt và Unicode)                                                                                                                                                               |
| **Timezone**              | UTC cho tất cả timestamp — client tự chuyển đổi múi giờ khi hiển thị                                                                                                                                      |
| **Collation**             | C.UTF-8 (collation mặc định PostgreSQL, phù hợp với so sánh text đơn giản)                                                                                                                                |

### 2.2. Danh sách bảng tổng quan

| **Bảng**            | **Mô tả ngắn**                                                  |
|---------------------|-----------------------------------------------------------------|
| **users**           | Tài khoản người dùng — thông tin xác thực và hồ sơ cơ bản       |
| **avatar_profiles** | Hồ sơ nhân vật ảo — model đã chọn và tùy chỉnh của từng user    |
| **conversations**   | Cuộc trò chuyện 1-1 — định danh duy nhất cho mỗi cặp người dùng |
| **messages**        | Tin nhắn văn bản — nội dung, trạng thái gửi nhận                |
| **videos**          | Metadata video đã quay — thông tin file, trạng thái lưu trữ     |
| **refresh_tokens**  | Token làm mới JWT — quản lý phiên đăng nhập                     |

### 2.3. Nguyên tắc thiết kế

- Tất cả bảng dùng UUID (kiểu uuid) làm khóa chính — tránh lộ thứ tự tuần tự, phù hợp với idempotency key sinh phía client (NFR-24).

- Tất cả bảng có cột created_at và updated_at (TIMESTAMPTZ, NOT NULL, default NOW()) để theo dõi lịch sử thay đổi.

- Soft delete: cột deleted_at (TIMESTAMPTZ, nullable) thay vì xóa cứng — cho phép khôi phục dữ liệu và đảm bảo tính toàn vẹn tham chiếu khi xóa user (NFR-27: toàn bộ dữ liệu bị 'xóa mềm' trước, dọn dẹp thật trong background job sau 30 ngày).

- Không có logic nghiệp vụ trong database (không dùng stored procedure/trigger phức tạp) — mọi business logic nằm ở tầng Service của Spring Boot.

## 3. Định nghĩa Chi tiết từng Bảng

### 3.1. Bảng users

Lưu trữ thông tin tài khoản người dùng. Đây là bảng trung tâm mà hầu hết bảng khác tham chiếu tới qua khóa ngoại.

| **Cột**             | **Kiểu dữ liệu** | **NULL?** | **Ràng buộc** | **Default**       | **Mô tả**                                                                                                                                                                                  |
|---------------------|------------------|-----------|---------------|-------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **id**              | UUID             | NO        | PK            | gen_random_uuid() | Khóa chính — UUID v4 sinh ngẫu nhiên                                                                                                                                                       |
| **email**           | VARCHAR(255)     | NO        | UK            |                   | Địa chỉ email — dùng để đăng nhập, unique trên toàn hệ thống                                                                                                                               |
| **password_hash**   | VARCHAR(255)     | NO        |               |                   | Mật khẩu đã băm bằng bcrypt/argon2 — không bao giờ lưu plaintext (NFR-07)                                                                                                                  |
| **display_name**    | VARCHAR(100)     | NO        |               |                   | Tên hiển thị trong giao diện — có thể trùng nhau giữa các user                                                                                                                             |
| **avatar_url**      | VARCHAR(500)     | YES       |               | NULL              | URL ảnh đại diện ứng dụng (khác với nhân vật ảo 3D) — nullable nếu chưa đặt                                                                                                                |
| **role**            | VARCHAR(20)      | NO        |               | 'user'            | Vai trò phân quyền: 'user' hoặc 'admin' — dùng trong JWT claim (NFR-29)                                                                                                                    |
| **is_discoverable** | BOOLEAN          | NO        |               | FALSE             | Opt-in cho phép tìm kiếm qua email (FR-22) — mặc định FALSE. Lưu trong users thay vì bảng settings riêng vì đây là thuộc tính cốt lõi ảnh hưởng đến query tìm kiếm (có thể index partial). |
| **email_notifications** | BOOLEAN      | NO        |               | TRUE              | Bật/tắt thông báo email của tài khoản; mặc định bật. Được bổ sung bởi migration V2.                                                                                                      |
| **theme**           | VARCHAR(20)      | NO        | CHECK         | 'system'          | Theme đồng bộ server-side: `dark`, `light` hoặc `system`. Được bổ sung bởi migration V2.                                                                                                |
| **created_at**      | TIMESTAMPTZ      | NO        |               | NOW()             | Thời điểm tạo tài khoản (UTC)                                                                                                                                                              |
| **updated_at**      | TIMESTAMPTZ      | NO        |               | NOW()             | Thời điểm cập nhật gần nhất (UTC) — cập nhật tự động qua trigger đơn giản                                                                                                                  |
| **deleted_at**      | TIMESTAMPTZ      | YES       |               | NULL              | Soft delete — NULL nếu còn hoạt động; có giá trị khi user yêu cầu xóa tài khoản (NFR-27)                                                                                                   |

**Index:**

- CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE deleted_at IS NULL; — tìm kiếm theo email khi đăng nhập, unique chỉ trên user chưa xóa

- CREATE INDEX idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NOT NULL; — background job dọn dẹp user đã xóa sau 30 ngày

### 3.2. Bảng avatar_profiles

Lưu thông tin nhân vật ảo 3D của mỗi người dùng — model đã chọn và các tùy chỉnh cơ bản. Quan hệ 1-1 với bảng users.

| **Cột**            | **Kiểu dữ liệu** | **NULL?** | **Ràng buộc** | **Default**       | **Mô tả**                                                                                                                     |
|--------------------|------------------|-----------|---------------|-------------------|-------------------------------------------------------------------------------------------------------------------------------|
| **id**             | UUID             | NO        | PK            | gen_random_uuid() | Khóa chính                                                                                                                    |
| **user_id**        | UUID             | NO        | FK, UK        |                   | Tham chiếu users.id — unique: mỗi user có đúng một hồ sơ nhân vật ảo (FR-04)                                                  |
| **model_id**       | VARCHAR(100)     | NO        |               |                   | Định danh model GLB/GLTF đã chọn (ví dụ: 'avatar_model_01') — tham chiếu tới kho model dựng sẵn                               |
| **model_url**      | VARCHAR(500)     | NO        |               |                   | URL đầy đủ tới file model GLB — phía nhận dùng URL này để tải model khi thiết lập cuộc gọi (SAD mục 4.1.2)                    |
| **customizations** | JSONB            | NO        |               | '{}'              | Các tùy chỉnh cơ bản dạng JSON: màu tóc, màu mắt, trang phục... Dùng JSONB để linh hoạt mở rộng mà không cần migration schema |
| **created_at**     | TIMESTAMPTZ      | NO        |               | NOW()             | Thời điểm tạo hồ sơ (lần đầu thiết lập nhân vật ảo — UC-03)                                                                   |
| **updated_at**     | TIMESTAMPTZ      | NO        |               | NOW()             | Thời điểm cập nhật tùy chỉnh gần nhất                                                                                         |

**Index:**

- CREATE UNIQUE INDEX idx_avatar_user_id ON avatar_profiles(user_id); — lookup nhanh nhân vật ảo của một user khi thiết lập cuộc gọi; đây là index duy nhất cần thiết cho avatar_profiles vì mọi truy vấn đều đi qua user_id

### 3.3. Bảng conversations

Định danh duy nhất cho mỗi cặp người dùng trong cuộc trò chuyện 1-1. conversation_id được tính từ cặp (user_a_id, user_b_id) đã chuẩn hóa (user_a_id \< user_b_id theo UUID string comparison) để đảm bảo (A,B) và (B,A) cho cùng một ID. Định nghĩa này nhất quán với glossary SRS mục 1.3.

| **Cột**        | **Kiểu dữ liệu** | **NULL?** | **Ràng buộc** | **Default**       | **Mô tả**                                                                                                                                                                                                                                                                                                                                                         |
|----------------|------------------|-----------|---------------|-------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **id**         | UUID             | NO        | PK            | gen_random_uuid() | Khóa chính — conversation_id trong toàn hệ thống                                                                                                                                                                                                                                                                                                                  |
| **user_a_id**  | UUID             | NO        | FK            |                   | User có UUID nhỏ hơn trong cặp (đã chuẩn hóa theo thứ tự)                                                                                                                                                                                                                                                                                                         |
| **user_b_id**  | UUID             | NO        | FK            |                   | User có UUID lớn hơn trong cặp (đã chuẩn hóa theo thứ tự)                                                                                                                                                                                                                                                                                                         |
| **created_at** | TIMESTAMPTZ      | NO        |               | NOW()             | Thời điểm tin nhắn đầu tiên được gửi (conversation tạo lazy — chỉ tạo khi có tin nhắn đầu tiên)                                                                                                                                                                                                                                                                   |
| **updated_at** | TIMESTAMPTZ      | NO        |               | NOW()             | Thời điểm tin nhắn gần nhất — dùng để sắp xếp danh sách trò chuyện                                                                                                                                                                                                                                                                                                |
| **deleted_at** | TIMESTAMPTZ      | YES       |               | NULL              | Soft delete phục vụ toàn vẹn tham chiếu — set sau khi background job đã dọn sạch toàn bộ messages liên quan (ON DELETE RESTRICT từ messages.conversation_id). Khác với soft delete ở bảng khác: đây không phải để khôi phục conversation (cả hai user đã xóa tài khoản rồi), mà để background job có thể xóa theo đúng thứ tự: messages trước → conversation sau. |

**Index:**

- CREATE UNIQUE INDEX idx_conv_pair ON conversations(LEAST(user_a_id::text, user_b_id::text), GREATEST(user_a_id::text, user_b_id::text)); — đảm bảo mỗi cặp (A,B) chỉ có một conversation, LEAST/GREATEST thay thế cho constraint kiểm tra thứ tự

- CREATE INDEX idx_conv_user_a ON conversations(user_a_id, updated_at DESC); — lấy danh sách trò chuyện gần nhất của user

- CREATE INDEX idx_conv_user_b ON conversations(user_b_id, updated_at DESC); — tương tự cho phía B

### 3.4. Bảng messages

Lưu trữ tin nhắn văn bản. Đây là bảng có khối lượng dữ liệu tăng trưởng nhanh nhất — index phải được thiết kế cẩn thận cho truy vấn theo conversation và thời gian.

| **Cột**              | **Kiểu dữ liệu** | **NULL?** | **Ràng buộc** | **Default** | **Mô tả**                                                                                                                             |
|----------------------|------------------|-----------|---------------|-------------|---------------------------------------------------------------------------------------------------------------------------------------|
| **id**               | UUID             | NO        | PK            |             | Khóa chính — đồng thời là idempotency key sinh phía client (NFR-24): client tạo UUID trước khi gửi, backend dùng để loại bỏ bản trùng |
| **conversation_id**  | UUID             | NO        | FK            |             | Tham chiếu conversations.id — tin nhắn thuộc cuộc trò chuyện nào                                                                      |
| **sender_id**        | UUID             | NO        | FK            |             | Tham chiếu users.id — ai gửi tin nhắn này                                                                                             |
| **content**          | TEXT             | NO        |               |             | Nội dung tin nhắn văn bản thuần — không lưu HTML/Markdown để tránh XSS                                                                |
| **status**           | VARCHAR(20)      | NO        |               | 'sent'      | Trạng thái: 'sent' (đã lưu server), 'delivered' (đã đẩy tới client nhận), 'read' (đã đọc)                                             |
| **client_timestamp** | TIMESTAMPTZ      | NO        |               |             | Timestamp phía client gửi — dùng để sắp xếp đúng thứ tự khi network reorder (NFR-25)                                                  |
| **created_at**       | TIMESTAMPTZ      | NO        |               | NOW()       | Timestamp phía server khi lưu — có thể khác client_timestamp nếu tin nhắn offline                                                     |
| **updated_at**       | TIMESTAMPTZ      | NO        |               | NOW()       | Cập nhật tự động khi status thay đổi (sent → delivered → read) — cần thiết để trigger hoạt động đúng                                  |
| **deleted_at**       | TIMESTAMPTZ      | YES       |               | NULL        | Soft delete — nullable; có giá trị khi user xóa tài khoản (NFR-27)                                                                    |

**Index:**

- CREATE INDEX idx_messages_conv_time ON messages(conversation_id, client_timestamp ASC) WHERE deleted_at IS NULL; — truy vấn lịch sử chat theo thứ tự thời gian (FR-12), partial index loại trừ tin nhắn đã xóa

- CREATE INDEX idx_messages_sender ON messages(sender_id, created_at DESC); — tìm tin nhắn của một user cụ thể (dùng cho feature xóa tài khoản)

*Lưu ý partial index (WHERE deleted_at IS NULL): phần lớn truy vấn runtime chỉ cần tin nhắn chưa xóa, partial index nhỏ hơn và nhanh hơn full index.*

### 3.5. Bảng videos

Lưu metadata của video đã quay — không lưu file binary trong database (file thực tế nằm ở Media Storage). Bảng này chỉ giữ thông tin để hiển thị thư viện và quản lý dung lượng (NFR-19).

| **Cột**             | **Kiểu dữ liệu** | **NULL?** | **Ràng buộc** | **Default**       | **Mô tả**                                                                                                               |
|---------------------|------------------|-----------|---------------|-------------------|-------------------------------------------------------------------------------------------------------------------------|
| **id**              | UUID             | NO        | PK            | gen_random_uuid() | Khóa chính                                                                                                              |
| **user_id**         | UUID             | NO        | FK            |                   | Tham chiếu users.id — video thuộc về ai                                                                                 |
| **title**           | VARCHAR(255)     | NO        |               |                   | Tên video — mặc định là timestamp khi quay, user có thể đổi tên (FR-17)                                                 |
| **storage_path**    | VARCHAR(500)     | NO        |               |                   | Đường dẫn file trên Media Storage (relative path hoặc object key) — backend dùng để tạo presigned URL khi user muốn xem |
| **file_size_bytes** | BIGINT           | NO        |               |                   | Kích thước file tính bằng byte — dùng để kiểm tra tổng dung lượng user còn dưới 2GB (NFR-19)                            |
| **duration_secs**   | INTEGER          | YES       |               | NULL              | Thời lượng video (giây) — nullable vì chỉ có sau khi xử lý xong                                                         |
| **status**          | VARCHAR(20)      | NO        |               | 'recording'       | Trạng thái: 'recording' (phiên quay đang diễn ra), 'processing' (đã finalize, chờ xử lý), 'ready' (xem được), 'failed' (lỗi upload hoặc xử lý) |
| **format**          | VARCHAR(10)      | NO        |               | 'mp4'             | Định dạng file xuất ra — mặc định mp4 (NFR-18), để ngỏ cho tương lai                                                    |
| **created_at**      | TIMESTAMPTZ      | NO        |               | NOW()             | Thời điểm bắt đầu quay                                                                                                  |
| **updated_at**      | TIMESTAMPTZ      | NO        |               | NOW()             | Thời điểm cập nhật gần nhất — được cập nhật tự động bởi trigger `trg_videos_updated_at`                                |
| **deleted_at**      | TIMESTAMPTZ      | YES       |               | NULL              | Soft delete — nullable; có giá trị khi user xóa video (FR-17) hoặc xóa tài khoản (NFR-27)                               |

**Index:**

- CREATE INDEX idx_videos_user_created ON videos(user_id, created_at DESC) WHERE deleted_at IS NULL; — lấy thư viện video của user theo thứ tự mới nhất (FR-17)

- CREATE INDEX idx_videos_user_size ON videos(user_id, file_size_bytes) WHERE deleted_at IS NULL; — tính tổng dung lượng đã dùng của user (NFR-19): SELECT SUM(file_size_bytes) FROM videos WHERE user_id = \$1 AND deleted_at IS NULL

### 3.6. Bảng refresh_tokens

Quản lý refresh token JWT — lưu token hash (không lưu token gốc) để phía server có thể revoke khi đăng xuất mà không cần đợi access token hết hạn tự nhiên.

| **Cột**        | **Kiểu dữ liệu** | **NULL?** | **Ràng buộc** | **Default**       | **Mô tả**                                                                                          |
|----------------|------------------|-----------|---------------|-------------------|----------------------------------------------------------------------------------------------------|
| **id**         | UUID             | NO        | PK            | gen_random_uuid() | Khóa chính                                                                                         |
| **user_id**    | UUID             | NO        | FK            |                   | Tham chiếu users.id — token thuộc về ai                                                            |
| **token_hash** | VARCHAR(255)     | NO        | UK            |                   | SHA-256 hash của refresh token — không lưu token gốc để giảm thiệt hại nếu DB bị lộ                |
| **expires_at** | TIMESTAMPTZ      | NO        |               |                   | Thời điểm token hết hạn — backend reject token quá hạn kể cả khi chưa revoke                       |
| **revoked_at** | TIMESTAMPTZ      | YES       |               | NULL              | Thời điểm bị thu hồi (đăng xuất) — NULL nếu còn hợp lệ; có giá trị ngay lập tức khi user đăng xuất |
| **created_at** | TIMESTAMPTZ      | NO        |               | NOW()             | Thời điểm cấp token (đăng nhập thành công)                                                         |
| **user_agent** | VARCHAR(500)     | YES       |               | NULL              | User-agent string của thiết bị khi đăng nhập — để user thấy danh sách thiết bị đang đăng nhập      |

**Index:**

- CREATE UNIQUE INDEX idx_refresh_token_hash ON refresh_tokens(token_hash); — lookup nhanh khi validate refresh token

- CREATE INDEX idx_refresh_user ON refresh_tokens(user_id, revoked_at) WHERE revoked_at IS NULL AND expires_at \> NOW(); — lấy danh sách phiên đang hoạt động của user

## 4. Sơ đồ Quan hệ Thực thể (ERD)

Do giới hạn trình bày trong tài liệu Word, sơ đồ ERD được mô tả theo ký hiệu quan hệ dạng văn bản dưới đây. Sơ đồ hình ảnh đầy đủ được xuất từ công cụ dbdiagram.io và đính kèm dưới dạng file riêng (VeilTalk_ERD.png).

### 4.1. Danh sách quan hệ

| **Từ bảng**       | **Quan hệ** | **Tới bảng**         | **Qua cột**                                 | **Ghi chú**                                                      |
|-------------------|-------------|----------------------|---------------------------------------------|------------------------------------------------------------------|
| **users**         | 1 — 0..1    | avatar_profiles      | avatar_profiles.user_id → users.id          | Một user có tối đa một hồ sơ nhân vật ảo; tạo khi hoàn tất UC-03 |
| **users**         | 1 — 0..\*   | conversations (as A) | conversations.user_a_id → users.id          | Một user có thể là phía A trong nhiều cuộc trò chuyện            |
| **users**         | 1 — 0..\*   | conversations (as B) | conversations.user_b_id → users.id          | Một user có thể là phía B trong nhiều cuộc trò chuyện            |
| **conversations** | 1 — 0..\*   | messages             | messages.conversation_id → conversations.id | Một cuộc trò chuyện có nhiều tin nhắn                            |
| **users**         | 1 — 0..\*   | messages             | messages.sender_id → users.id               | Một user gửi nhiều tin nhắn                                      |
| **users**         | 1 — 0..\*   | videos               | videos.user_id → users.id                   | Một user quay nhiều video                                        |
| **users**         | 1 — 0..\*   | refresh_tokens       | refresh_tokens.user_id → users.id           | Một user có thể có nhiều phiên đăng nhập đồng thời               |

### 4.2. Tóm tắt ràng buộc toàn vẹn tham chiếu

- Tất cả khóa ngoại (FK) dùng ON DELETE RESTRICT mặc định — không cho phép xóa cứng user khi còn dữ liệu liên quan. Việc 'xóa tài khoản' thực chất là soft delete (set deleted_at), background job mới dọn dẹp thật sau 30 ngày khi mọi FK đã được xử lý.

- users.id là UUID NOT NULL cho tất cả FK — không có orphan record.

- conversations đảm bảo unique pair qua partial unique index (LEAST/GREATEST trick) vì PostgreSQL không hỗ trợ CHECK constraint với 2 cột theo thứ tự động.

## 5. Chiến lược Indexing Tổng quan

### 5.1. Nguyên tắc chung

- Chỉ thêm index khi có truy vấn thực tế cần thiết — không thêm index phòng ngừa vì mỗi index làm chậm INSERT/UPDATE/DELETE.

- Ưu tiên partial index (WHERE clause) cho các cột có phần lớn giá trị là NULL hoặc đã soft-deleted — index nhỏ hơn, hiệu quả hơn.

- Index composite: thứ tự cột quan trọng — đặt cột có độ chọn lọc cao và được dùng trong equality condition trước, range condition sau.

- Dùng CREATE INDEX CONCURRENTLY khi thêm index lên bảng đang có dữ liệu trong môi trường production — tránh lock table (SAD mục 5, Giai đoạn 5 roadmap).

### 5.2. Bảng tổng hợp index theo truy vấn thường gặp

| **Truy vấn**                                                                | **Index sử dụng**                            | **Bảng**                                                                                                                                                                                                                  |
|-----------------------------------------------------------------------------|----------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Đăng nhập: WHERE email = \$1 AND deleted_at IS NULL**                     | idx_users_email (partial unique)             | users                                                                                                                                                                                                                     |
| **Thiết lập cuộc gọi: lấy model_url của người gọi**                         | idx_avatar_user_id (unique)                  | avatar_profiles                                                                                                                                                                                                           |
| **Tìm người dùng theo email (FR-22)**                                       | idx_users_email (partial unique)             | users — Lưu ý: chỉ trả kết quả khi user đích đã bật discoverable; cả hai trường hợp (không tồn tại / chưa bật) trả về cùng một response để tránh user enumeration — đánh đổi có chủ đích, nhất quán với SRS mục 3.1 FR-22 |
| **Lịch sử chat: WHERE conversation_id = \$1 ORDER BY client_timestamp ASC** | idx_messages_conv_time (composite)           | messages                                                                                                                                                                                                                  |
| **Danh sách trò chuyện gần nhất của user A**                                | idx_conv_user_a (composite)                  | conversations                                                                                                                                                                                                             |
| **Danh sách trò chuyện gần nhất của user B**                                | idx_conv_user_b (composite)                  | conversations                                                                                                                                                                                                             |
| **Kiểm tra dung lượng đã dùng: SUM(file_size_bytes) WHERE user_id = \$1**   | idx_videos_user_size (partial)               | videos                                                                                                                                                                                                                    |
| **Thư viện video: WHERE user_id = \$1 ORDER BY created_at DESC**            | idx_videos_user_created (composite, partial) | videos                                                                                                                                                                                                                    |
| **Validate refresh token: WHERE token_hash = \$1**                          | idx_refresh_token_hash (unique)              | refresh_tokens                                                                                                                                                                                                            |

## 6. Schema SQL Đầy đủ (Migration Khởi tạo)

Script SQL dưới đây là migration khởi tạo đầy đủ có thể chạy trực tiếp trên PostgreSQL 16 hoặc qua Flyway (V1\_\_initial_schema.sql). Thiết kế theo thứ tự tạo bảng tôn trọng ràng buộc FK.

```sql
-- ============================================================
-- VeilTalk Database Schema v1.0
-- Migration: V1__initial_schema.sql
-- ============================================================

-- Bật extension uuid-ossp nếu chưa có
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---- USERS ----
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    avatar_url VARCHAR(500),
    role VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    is_discoverable BOOLEAN NOT NULL DEFAULT FALSE,
    -- is_discoverable = TRUE cho phép tìm thấy qua POST /users/search (FR-22)
    -- Mặc định FALSE — user phải chủ động bật trong Settings
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_discoverable_email ON users(email) WHERE deleted_at IS NULL AND is_discoverable = TRUE;
-- Index riêng cho tìm kiếm FR-22: chỉ index user đã bật discoverable
-- Khi tìm kiếm: WHERE email = $1 AND is_discoverable = TRUE AND deleted_at IS NULL
CREATE INDEX idx_users_deleted_at ON users(deleted_at) WHERE deleted_at IS NOT NULL;

-- ---- AVATAR PROFILES ----
CREATE TABLE avatar_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    model_id VARCHAR(100) NOT NULL,
    model_url VARCHAR(500) NOT NULL,
    customizations JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_avatar_user_id ON avatar_profiles(user_id);
-- idx_avatar_model_url dđã bị xóa: truy vấn avatar luôn dùng
-- WHERE user_id = $1, không phải WHERE model_url = $1

-- ---- CONVERSATIONS ----
CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_a_id UUID NOT NULL REFERENCES users(id),
    user_b_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT chk_conv_diff_users CHECK (user_a_id <> user_b_id)
);

-- Đảm bảo mỗi cặp (A,B) chỉ có đúng một conversation
-- LEAST/GREATEST chuẩn hóa thứ tự UUID để (A,B) = (B,A)
CREATE UNIQUE INDEX idx_conv_pair ON conversations(
    LEAST(user_a_id::text, user_b_id::text),
    GREATEST(user_a_id::text, user_b_id::text)
);
CREATE INDEX idx_conv_user_a ON conversations(user_a_id, updated_at DESC);
CREATE INDEX idx_conv_user_b ON conversations(user_b_id, updated_at DESC);

-- ---- MESSAGES ----
CREATE TABLE messages (
    id UUID PRIMARY KEY,
    -- id = idempotency key sinh phía client (NFR-24)
    -- backend INSERT ... ON CONFLICT (id) DO NOTHING để dedup
    conversation_id UUID NOT NULL REFERENCES conversations(id),
    sender_id UUID NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','delivered','read')),
    client_timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_messages_conv_time ON messages(conversation_id, client_timestamp ASC) WHERE deleted_at IS NULL;
CREATE INDEX idx_messages_sender ON messages(sender_id, created_at DESC);

-- ---- VIDEOS ----
CREATE TABLE videos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    title VARCHAR(255) NOT NULL,
    storage_path VARCHAR(500) NOT NULL,
    file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
    duration_secs INTEGER,
    status VARCHAR(20) NOT NULL DEFAULT 'recording' CHECK (status IN ('recording','processing','ready','failed')),
    -- recording: phiên quay đang diễn ra (chunked upload)
    -- processing: finalize đã gọi, chờ MinIO webhook
    -- ready: MinIO webhook nhận, video phát được
    -- failed: lỗi upload hoặc webhook timeout
    format VARCHAR(10) NOT NULL DEFAULT 'mp4',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_videos_user_created ON videos(user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_videos_user_size ON videos(user_id, file_size_bytes) WHERE deleted_at IS NULL;

-- ---- REFRESH TOKENS ----
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id),
    token_hash VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_agent VARCHAR(500)
);

CREATE UNIQUE INDEX idx_refresh_token_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_user ON refresh_tokens(user_id, revoked_at) WHERE revoked_at IS NULL;
-- Lưu ý: không dùng expires_at > NOW() trong predicate vì NOW() là
-- non-immutable function, PostgreSQL không cho phép trong partial index.
-- Lọc expires_at thực hiện trong query: WHERE ... AND expires_at > NOW()

-- ---- AUTO-UPDATE updated_at TRIGGER ----
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_avatar_updated_at BEFORE UPDATE ON avatar_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_conversations_updated_at BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_messages_updated_at BEFORE UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_videos_updated_at BEFORE UPDATE ON videos FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### 6.1. Migration V2 — User settings

Không sửa migration V1 đã chạy. P2-T07 bổ sung hai cột settings còn thiếu vào bảng
`users`; các bản ghi hiện có nhận giá trị mặc định ngay khi migration chạy.

```sql
-- Migration: V2__add_user_settings.sql
ALTER TABLE users
    ADD COLUMN email_notifications BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN theme VARCHAR(20) NOT NULL DEFAULT 'system',
    ADD CONSTRAINT chk_users_theme CHECK (theme IN ('dark', 'light', 'system'));
```

Schema hiện hành sau V2 có các giá trị settings mặc định:
`is_discoverable = FALSE`, `email_notifications = TRUE`, `theme = 'system'`.

## 7. Redis — Cấu trúc Key-Value

Redis không có schema cứng như PostgreSQL. Phần này định nghĩa quy ước đặt tên key và cấu trúc value để đảm bảo nhất quán trong toàn bộ codebase.

| **Key pattern**           | **Kiểu Value**       | **TTL**                               | **Mục đích**                                                                                                                                                                                                                                         |
|---------------------------|----------------------|---------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **jwt:blacklist:{jti}**   | String ("1")         | Đến khi access token hết hạn tự nhiên | JWT blacklist khi đăng xuất — jti là JWT ID claim (mục 4.5 SAD)                                                                                                                                                                                      |
| **jwt:user-revoked-after:{user_id}** | Epoch second dạng String | Bằng thời hạn access token tối đa | Mốc thu hồi toàn cục khi xóa tài khoản. Filter từ chối mọi access token của user có claim `iat` không mới hơn mốc này; key tự hết hạn khi không còn token cũ nào có thể hợp lệ. |
| **conv:online:{user_id}** | String (instance_id) | 30 giây (heartbeat)                   | Xác định user đang kết nối WebSocket tới Backend instance nào — dùng cho Pub/Sub routing tin nhắn                                                                                                                                                    |
| **pubsub:msg:{user_id}**  | Pub/Sub channel      | N/A (ephemeral)                       | Kênh Pub/Sub để Backend instances đẩy tin nhắn tới đúng instance giữ kết nối WebSocket của user (SAD mục 4.5)                                                                                                                                        |
| **rate:ws:{ip}**          | Integer (count)      | 60 giây (fixed window)                | Đếm số kết nối WebSocket mới từ một IP trong cửa sổ 60 giây. Fixed window: counter reset hoàn toàn sau mỗi 60 giây — đơn giản hơn sliding window thật và đủ hiệu quả cho mục đích rate limiting Signaling Server ở quy mô MVP (SAD mục 9.3 STRIDE-D) |

## 8. Các Quyết định Thiết kế Quan trọng

DD-01 — UUID thay vì SERIAL cho khóa chính

Quyết định: dùng UUID (gen_random_uuid()) cho tất cả khóa chính thay vì SERIAL/BIGSERIAL tự tăng.

Lý do: (1) Client có thể sinh UUID trước khi gửi lên server — cần thiết cho idempotency key tin nhắn (NFR-24); (2) Không lộ tổng số bản ghi qua ID tuần tự; (3) Dễ merge dữ liệu từ nhiều instance hơn.

Đánh đổi: UUID (16 byte) lớn hơn BIGINT (8 byte), index sẽ tốn thêm bộ nhớ. Chấp nhận được ở quy mô MVP.

DD-02 — JSONB cho avatar customizations

Quyết định: lưu tùy chỉnh nhân vật ảo dưới dạng JSONB thay vì tạo các cột riêng (hair_color, eye_color...).

Lý do: các tùy chỉnh có thể thay đổi theo từng model nhân vật khác nhau; JSONB linh hoạt mở rộng mà không cần migration schema mỗi khi thêm loại tùy chỉnh mới.

Đánh đổi: không có type-safety ở tầng DB; validation phải thực hiện ở tầng application. Chấp nhận được vì dữ liệu này chỉ được đọc/ghi bởi backend, không có truy vấn SQL phức tạp trên từng field bên trong.

DD-03 — Soft delete thay vì hard delete

Quyết định: dùng cột deleted_at nullable (TIMESTAMPTZ) thay vì xóa bản ghi vật lý ngay lập tức.

Lý do: (1) Đảm bảo toàn vẹn tham chiếu (không thể hard delete user khi còn messages/videos có FK); (2) Cho phép khôi phục dữ liệu nếu user xóa nhầm; (3) Dọn dẹp thật bằng background job sau 30 ngày đúng cam kết NFR-27.

Đánh đổi: mọi query cần thêm WHERE deleted_at IS NULL — đã được xử lý bằng partial index nên không ảnh hưởng hiệu năng.

DD-04 — client_timestamp riêng cho messages

Quyết định: lưu hai timestamp trong bảng messages — client_timestamp (do client gửi kèm) và created_at (do server gán khi lưu).

Lý do: khi mạng không ổn định, các tin nhắn có thể đến server không theo thứ tự gửi. client_timestamp là thứ tự đúng về logic nghiệp vụ (NFR-25); created_at là thứ tự vật lý trên server.

Đánh đổi: client có thể gửi timestamp giả mạo. Chấp nhận được trong phạm vi MVP — không có yêu cầu bảo mật cao với thứ tự tin nhắn. Validation cụ thể: backend reject tin nhắn có client_timestamp lệch quá ±5 phút so với server time (NOW()) — đủ rộng để bù clock skew thông thường giữa thiết bị, đủ hẹp để ngăn gian lận thứ tự rõ ràng. Con số này có thể điều chỉnh dựa trên quan sát thực tế sau khi deploy.

*— Hết tài liệu —*
