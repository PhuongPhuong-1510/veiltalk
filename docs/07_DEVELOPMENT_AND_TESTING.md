TRƯỜNG ĐẠI HỌC CÔNG NGHỆ — ĐHQGHN

Khoa Công nghệ Thông tin

**KẾ HOẠCH KIỂM THỬ & CA KIỂM THỬ**

*(Test Plan & Test Cases)*

**VEILTALK**

Tài liệu kiểm thử hệ thống giao tiếp qua nhân vật ảo

Phiên bản: 1.0 \| Ngày: 21/06/2026

Người soạn: Lê Thị Tú Phương — MSSV 23020695

## 1. Kế hoạch Kiểm thử (Test Plan)

### 1.1. Mục tiêu

Xác minh hệ thống VeilTalk đáp ứng toàn bộ yêu cầu chức năng (FR-01 đến FR-22) và yêu cầu phi chức năng quan trọng (NFR-01, NFR-02, NFR-03, NFR-04, NFR-06, NFR-07, NFR-08, NFR-19) đã định nghĩa trong SRS v1.0. Đặc biệt chú trọng vào tính chính xác tracking nhân vật ảo, bảo mật xác thực, và chất lượng cuộc gọi video.

### 1.2. Phạm vi

- Trong phạm vi: REST API endpoints (API Design v1.0), WebSocket messaging và signaling, luồng upload video MinIO multipart, bảo mật JWT và anti-enumeration, hiệu năng tracking (NFR-01/02).

- Ngoài phạm vi: kiểm thử giao diện tự động (UI test), kiểm thử tải cao (load testing \> 50 users đồng thời), kiểm thử trên thiết bị di động.

### 1.3. Chiến lược Kiểm thử

| **Loại kiểm thử**       | **Công cụ — Phạm vi**                                                                               |
|-------------------------|-----------------------------------------------------------------------------------------------------|
| **Unit Test (Backend)** | JUnit 5 + Mockito — Service layer, validation logic, JWT generation/verification                    |
| **Integration Test**    | Spring Boot Test (@SpringBootTest) + Testcontainers (PostgreSQL, Redis) — Controller → Service → DB |
| **API Test**            | Postman Collection / REST Assured — toàn bộ endpoint trong API Design v1.0                          |
| **WebSocket Test**      | wscat / jest-websocket-mock — kết nối, authentication, message types                                |
| **E2E Manual Test**     | Trình duyệt Chrome mới nhất — luồng người dùng đầy đủ từ đăng ký đến gọi video                      |
| **Security Test**       | OWASP ZAP scan (cơ bản) + manual test anti-enumeration, JWT validation                              |
| **Performance Test**    | Tài liệu riêng (Performance Test Report v1.0) — NFR-01/02/03/04                                     |

### 1.4. Môi trường Kiểm thử

| **Thành phần**                | **Cấu hình**                                                            |
|-------------------------------|-------------------------------------------------------------------------|
| **Server**                    | Docker Compose local (toàn bộ 7 container theo Deployment Guide)        |
| **Thiết bị tham chiếu (NFR)** | Intel Core i5 thế hệ 10+, 8GB RAM, webcam 720p 30fps — theo SRS mục 4.1 |
| **Trình duyệt**               | Chrome phiên bản mới nhất (2 trong 2 phiên bản gần nhất theo NFR-16)    |
| **Ánh sáng (NFR-01/02)**      | ≥ 200 lux, phòng có đèn trần bình thường — theo SRS mục 4.1             |
| **Khoảng cách camera**        | 50–80cm từ người dùng đến camera — theo SRS mục 4.1                     |
| **Database**                  | PostgreSQL 16 (fresh schema từ V1\_\_initial_schema.sql trong DDD)      |

#### 1.4.1. Chạy Backend test local trên Windows

Khi Maven chạy trực tiếp trên Windows còn PostgreSQL và Redis chạy bằng Docker Compose,
phải dùng `localhost` thay cho hostname nội bộ Compose `postgres` và `redis`. Spring Boot
không tự đọc file `.env`; cần nạp các biến từ file này vào process PowerShell trước khi
chạy test. Không sửa hoặc commit `.env` chỉ để đổi hostname.

```powershell
Set-Location backend

Get-Content ..\.env | ForEach-Object {
    $envLine = $_.Trim()
    if ($envLine -and -not $envLine.StartsWith("#")) {
        $envPair = $envLine -split "=", 2
        if ($envPair.Count -eq 2) {
            [Environment]::SetEnvironmentVariable(
                $envPair[0].Trim(),
                $envPair[1].Trim().Trim('"'),
                "Process"
            )
        }
    }
}

$env:DB_HOST = "localhost"
$env:REDIS_HOST = "localhost"
.\mvnw.cmd test
```

Nếu chạy bằng IDE, có thể dùng chức năng nạp env file của IDE rồi override hai biến
`DB_HOST` và `REDIS_HOST` thành `localhost`.

Known issue trên môi trường Windows hiện tại: `mvnw.cmd` đôi khi dừng với thông báo
`Cannot index into a null array` / `Cannot start maven from wrapper`. Đây là lỗi khởi động
Maven Wrapper, không phải kết quả test. Khi gặp lỗi này, dùng Maven 3.9.16 mà wrapper đã
tải trong `%USERPROFILE%\.m2\wrapper\dists\`:

```powershell
$maven = Get-ChildItem `
    "$env:USERPROFILE\.m2\wrapper\dists\apache-maven-3.9.16" `
    -Recurse -Filter mvn.cmd |
    Select-Object -First 1

if (-not $maven) {
    throw "Không tìm thấy Maven 3.9.16 trong wrapper cache"
}

& $maven.FullName test
```

Phân biệt lỗi môi trường thường gặp:

- `password authentication failed`: process chưa nhận đúng `DB_PASSWORD`/`DB_USER`
  từ `.env`.
- `UnknownHostException: postgres` hoặc `redis`: Maven đang chạy local nhưng vẫn dùng
  hostname nội bộ Docker; override host thành `localhost`.
- Chỉ ghi nhận test PASS khi Maven kết thúc bằng `BUILD SUCCESS`.

### 1.5. Tiêu chí Chấp nhận

- Tất cả TC đánh dấu Priority = Cao phải PASS trước khi nộp sản phẩm.

- ≥ 90% TC Priority = Trung bình phải PASS.

- TC Priority = Thấp: ghi nhận bug nhưng không chặn nộp.

- Không có bug severity = Critical (crash, data loss, bảo mật) còn mở.

## 2. Ca Kiểm thử Chức năng (Functional Test Cases)

### 2.1. Module Xác thực (FR-01, FR-02)

| **TC-ID** | **Tiêu đề**                       | **Điều kiện tiên quyết**             | **Bước thực hiện**                                                                     | **Kết quả mong đợi**                                                                       | **Ref**    |
|-----------|-----------------------------------|--------------------------------------|----------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------|------------|
| **TC-01** | **Đăng ký tài khoản hợp lệ**      | Server đang chạy, email chưa tồn tại | POST /auth/register với email hợp lệ, password ≥ 8 ký tự có chữ hoa + số, display_name | HTTP 201, response có user.id, tokens.access_token, tokens.refresh_token, expires_in = 900 | FR-01      |
| **TC-02** | **Đăng ký email đã tồn tại**      | TC-01 đã chạy                        | POST /auth/register với cùng email                                                     | HTTP 409, error.code = CONFLICT                                                            | FR-01      |
| **TC-03** | **Đăng ký mật khẩu yếu**          | Server đang chạy                     | POST /auth/register với password = '12345'                                             | HTTP 400, error.code = VALIDATION_ERROR                                                    | FR-01      |
| **TC-04** | **Đăng nhập đúng thông tin**      | TC-01 đã chạy                        | POST /auth/login với email/password đúng                                               | HTTP 200, tokens trả về, has_avatar = false                                                | FR-02      |
| **TC-05** | **Đăng nhập sai mật khẩu**        | TC-01 đã chạy                        | POST /auth/login với mật khẩu sai                                                      | HTTP 401, message không tiết lộ field nào sai (anti-enumeration)                           | FR-02      |
| **TC-06** | **Đăng nhập email không tồn tại** | Server đang chạy                     | POST /auth/login với email không có                                                    | HTTP 401, CÙNG message với TC-05 (không phân biệt)                                         | FR-02      |
| **TC-07** | **Refresh token hợp lệ**          | TC-04 đã chạy                        | POST /auth/refresh với refresh_token hợp lệ                                            | HTTP 200, access_token mới, expires_in = 900                                               | SRS NFR-08 |
| **TC-08** | **Refresh token hết hạn**         | Có refresh token đã hết hạn          | POST /auth/refresh với token hết hạn                                                   | HTTP 401, UNAUTHORIZED                                                                     | SRS NFR-08 |
| **TC-09** | **Đăng xuất**                     | Đang đăng nhập                       | POST /auth/logout với refresh_token                                                    | HTTP 204; dùng lại refresh_token đó → phải trả 401                                         | SRS NFR-07 |

### 2.2. Module Nhân vật ảo (FR-04)

| **TC-ID** | **Tiêu đề**                     | **Điều kiện tiên quyết**     | **Bước thực hiện**                                                | **Kết quả mong đợi**                                                                                | **Ref**          |
|-----------|---------------------------------|------------------------------|-------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|------------------|
| **TC-10** | **Lấy danh sách model**         | Server đang chạy             | GET /avatars/models                                               | HTTP 200; models có ≥ 6 phần tử; mỗi model có id, name, model_url, thumbnail_url, supported_customizations và outfit_options | FR-04            |
| **TC-11** | **Tạo avatar lần đầu**          | Đã đăng nhập, chưa có avatar | PUT /avatars/me với model_id hợp lệ, customizations = {}          | HTTP 201, avatar record tạo thành công, model_url được server tra từ catalog (không nhận từ client) | FR-04            |
| **TC-12** | **Cập nhật avatar**             | TC-11 đã chạy                | PUT /avatars/me với model_id khác + customizations có hair_color  | HTTP 200, customizations phản ánh đúng                                                              | FR-04            |
| **TC-13** | **model_id không hợp lệ**       | Đã đăng nhập                 | PUT /avatars/me với model_id = 'fake_model_999'                   | HTTP 400, VALIDATION_ERROR                                                                          | FR-04            |
| **TC-14** | **Lấy avatar của user khác**    | Hai user đã setup avatar     | GET /avatars/{userId} với userId của user B                       | HTTP 200, trả về model_id, model_url, customizations của B — không có email/role                    | FR-04, SAD 4.1.2 |
| **TC-15** | **Anti-enumeration GET avatar** | User B chưa có avatar        | GET /avatars/{idUserChưaCóAvatar} và GET /avatars/{idKhôngTồnTại} | Cả hai phải trả HTTP 404 với CÙNG response body                                                     | API Design 5.4   |

### 2.3. Module Tìm kiếm Người dùng (FR-22)

| **TC-ID** | **Tiêu đề**                        | **Điều kiện tiên quyết**                                 | **Bước thực hiện**                                                          | **Kết quả mong đợi**                                               | **Ref**       |
|-----------|------------------------------------|----------------------------------------------------------|-----------------------------------------------------------------------------|--------------------------------------------------------------------|---------------|
| **TC-16** | **Tìm user đã bật discoverable**   | User B đã bật PUT /users/me/settings {discoverable:true} | POST /users/search {email: emailB}                                          | HTTP 200, found:true, user.display_name trả về, KHÔNG có email     | FR-22         |
| **TC-17** | **Tìm user chưa bật discoverable** | User B discoverable=false (mặc định)                     | POST /users/search {email: emailB}                                          | HTTP 200, found:false — cùng response với user không tồn tại       | FR-22         |
| **TC-18** | **Tìm email không tồn tại**        | Server đang chạy                                         | POST /users/search {email: 'notexist@x.com'}                                | HTTP 200, found:false — CÙNG response với TC-17 (anti-enumeration) | FR-22         |
| **TC-19** | **Rate limit tìm kiếm**            | Đã đăng nhập                                             | Gửi 11 POST /users/search trong 1 phút                                      | Request thứ 11 trả về HTTP 429, header Retry-After có giá trị      | FR-22, NFR-32 |
| **TC-20** | **Bật/tắt discoverable**           | Đã đăng nhập                                             | PUT /users/me/settings {discoverable:true}, sau đó PUT {discoverable:false} | GET /users/me/settings trả về đúng trạng thái sau mỗi lần thay đổi | FR-22         |

### 2.4. Module Trò chuyện & Tin nhắn (FR-11, FR-12)

| **TC-ID** | **Tiêu đề**                         | **Điều kiện tiên quyết**      | **Bước thực hiện**                                                                     | **Kết quả mong đợi**                                                         | **Ref**           |
|-----------|-------------------------------------|-------------------------------|----------------------------------------------------------------------------------------|------------------------------------------------------------------------------|-------------------|
| **TC-21** | **Tạo conversation mới**            | User A và B đã đăng nhập      | POST /conversations {other_user_id: idB}                                               | HTTP 201, trả về conversation với id, other_user.display_name                | FR-22, ADD 6.1    |
| **TC-22** | **Idempotent tạo conversation**     | TC-21 đã chạy                 | POST /conversations {other_user_id: idB} lần 2                                         | HTTP 200, trả về CÙNG conversation.id với TC-21                              | DDD idx_conv_pair |
| **TC-23** | **Gửi tin nhắn**                    | TC-21 đã chạy                 | POST /conversations/{id}/messages với id (UUID client sinh), content, client_timestamp | HTTP 201, message.id = UUID đã gửi, status = 'sent'                          | FR-11             |
| **TC-24** | **Idempotency tin nhắn**            | TC-23 đã chạy                 | POST /conversations/{id}/messages với CÙNG message.id                                  | HTTP 200, trả về message gốc, KHÔNG tạo bản mới                              | NFR-24            |
| **TC-25** | **client_timestamp lệch \> 5 phút** | Server đang chạy              | POST /messages với client_timestamp lệch 10 phút so với server                         | HTTP 400, VALIDATION_ERROR — nhất quán DD-04 trong DDD                       | DDD DD-04         |
| **TC-26** | **Load lịch sử tin nhắn**           | Conversation có ≥ 50 tin nhắn | GET /conversations/{id}/messages?limit=20                                              | HTTP 200, trả về 20 tin nhắn mới nhất, has_more=true, prev_cursor có giá trị | FR-12             |
| **TC-27** | **Cập nhật status tin nhắn**        | TC-23 đã chạy                 | PUT /conversations/{id}/messages/{msgId} {status:'read'}                               | HTTP 200, status = 'read'                                                    | FR-11             |
| **TC-28** | **Không cho giảm status**           | TC-27 đã chạy, message hiện có status=`read` | PUT .../messages/{msgId} {status:'delivered'}                                          | HTTP 400 VALIDATION_ERROR; status và updated_at không đổi; không publish event | ADD 6.6           |
| **TC-59** | **Danh sách conversation phân trang** | User A có ≥ 3 conversation với updated_at khác nhau | GET /conversations?limit=2, sau đó gọi trang tiếp theo bằng next_cursor | Trang đầu có 2 conversation sắp xếp updated_at DESC, has_more=true; trang sau không trùng/thiếu và has_more=false | ADD 6.2 |
| **TC-60** | **Chi tiết conversation và quyền thành viên** | Conversation giữa user A và B; user C không phải thành viên | A và C lần lượt gọi GET /conversations/{id}; A gọi thêm với ID không tồn tại | A nhận HTTP 200 cùng other_user/last_message; C nhận 403 FORBIDDEN; ID không tồn tại nhận 404 NOT_FOUND | ADD 6.3 |

### 2.5. Module Video (FR-16, FR-17)

| **TC-ID** | **Tiêu đề**                       | **Điều kiện tiên quyết**                         | **Bước thực hiện**                                                            | **Kết quả mong đợi**                                                                              | **Ref**         |
|-----------|-----------------------------------|--------------------------------------------------|-------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|-----------------|
| **TC-29** | **Khởi tạo upload video**         | Đã đăng nhập, quota \< 2GB                       | POST /videos {title, estimated_size_bytes:10485760, chunk_size_bytes:5242880} | HTTP 201, status='recording', upload_id có giá trị, first_chunk_url là URL MinIO hợp lệ           | FR-16           |
| **TC-30** | **Lấy chunk URL tiếp theo**       | TC-29 đã chạy, đã PUT chunk 1 lên MinIO, có etag | POST /videos/{id}/chunks {upload_id, part_number:2, etag_previous}            | HTTP 200, chunk_url cho part 2                                                                    | FR-16, ADD 7.3  |
| **TC-31** | **Finalize upload**               | TC-30 đã chạy, có danh sách parts + etags        | POST /videos/{id}/finalize {upload_id, parts, duration_secs}; webhook có thể đến ngay trong CompleteMultipartUpload | Backend commit `recording→processing` trước Complete; HTTP 202. Webhook tức thời hoặc HEAD reconciliation chuyển conditional `processing→ready`, không mất event và không ghi đè terminal state | FR-16, ADD 7.4  |
| **TC-32** | **Abort upload**                  | TC-29 đã chạy                                    | POST /videos/{id}/abort {upload_id}                                           | HTTP 204; GET /videos/{id} trả về 404                                                             | FR-16, ADD 7.5  |
| **TC-33** | **Quota vượt mức**                | User đã có 1.99GB video                          | POST /videos với estimated_size_bytes = 50MB                                  | HTTP 507, STORAGE_QUOTA_EXCEEDED                                                                  | NFR-19, ADD 7.2 |
| **TC-34** | **Đổi tên video**                 | Video status=ready                               | PUT /videos/{id} {title:'Tên mới'}                                            | HTTP 200, title cập nhật                                                                          | FR-17           |
| **TC-35** | **Xóa video**                     | Video status=ready                               | DELETE /videos/{id}                                                           | HTTP 204; GET /videos/{id} → 404; storage_used_bytes giảm                                         | FR-17           |
| **TC-36** | **Video failed — view_url null**  | Video status=failed                              | GET /videos/{id}                                                              | HTTP 200, view_url=null, status='failed'                                                          | ADD 7.7         |
| **TC-37** | **Xóa tài khoản abort recording — thực hiện tại P2-T24** | P2-T19–P2-T22 hoàn thành; user đang có video status=recording | DELETE /users/me với password đúng | HTTP 204 và token bị revoke ngay; video recording được abort trên MinIO. Nếu abort lỗi, cleanup job bền vững retry mà không rollback soft delete | ADD 4.5, ADD 7.5 |
| **TC-69** | **MinIO client và presigned URL end-to-end** | MinIO thật đang chạy; đặt đủ `MINIO_ENDPOINT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET` và `MINIO_INTEGRATION_TEST=true` | Khởi tạo `MinioClient`; tạo bucket test tên random khác bucket chính; sinh presigned PUT để upload dữ liệu mẫu; xác minh object; sinh presigned GET và tải lại; xóa object rồi bucket | Bind đúng bốn biến; bean khởi tạo; PUT/GET trả dữ liệu nguyên vẹn; cleanup thành công; access key/secret không xuất hiện trong log. Nếu không bật integration test thì test được skip rõ ràng, nhưng skipped không được tính là PASS khi nghiệm thu P2-T19 | P2-T19 |

## 3. Ca Kiểm thử Bảo mật

| **TC-ID** | **Tiêu đề**                         | **Điều kiện tiên quyết**             | **Bước thực hiện**                                                           | **Kết quả mong đợi**                                                                    | **Ref** |
|-----------|-------------------------------------|--------------------------------------|------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------|---------|
| **TC-38** | **Truy cập API không có token**     | Server đang chạy                     | GET /users/me không có Authorization header                                  | HTTP 401, UNAUTHORIZED                                                                  | NFR-08  |
| **TC-39** | **Token hết hạn**                   | Có access token đã hết hạn (15 phút) | GET /users/me với token hết hạn                                              | HTTP 401, UNAUTHORIZED                                                                  | NFR-08  |
| **TC-40** | **Truy cập resource của user khác** | User A và B đã đăng nhập             | User A gọi PUT /videos/{idVideoOfB} (video của B)                            | HTTP 403, FORBIDDEN                                                                     | NFR-29  |
| **TC-41** | **JWT secret sai**                  | Server đang chạy                     | Gửi request với JWT ký bằng secret khác                                      | HTTP 401, UNAUTHORIZED                                                                  | NFR-08  |
| **TC-42** | **SQL Injection via email field**   | Server đang chạy                     | POST /auth/login {email: "' OR '1'='1"}                                      | HTTP 401 hoặc 400 — KHÔNG crash server, KHÔNG trả về data                               | NFR-09  |
| **TC-43** | **Anti-enumeration đăng nhập**      | Biết email A tồn tại                 | So sánh response body của: (1) sai password email A, (2) email không tồn tại | Response body PHẢI giống hệt nhau — không tiết lộ email có tồn tại không                | FR-02   |
| **TC-44** | **Webhook không có shared secret**  | Server đang chạy                     | POST /internal/videos/webhook thiếu hoặc sai `Authorization: Bearer <MINIO_WEBHOOK_SECRET>` | HTTP 401 với cùng response; không log/trả lại secret                                    | ADD 7.6 |
| **TC-45** | **CORS origin không được phép**     | Server đang chạy                     | Gửi request với Origin: https://evil.example.com                             | Response không có Access-Control-Allow-Origin header hoặc giá trị khác với allowed list | NFR-32  |

## 4. Ca Kiểm thử Phi chức năng (NFR)

### 4.1. WebSocket — Kết nối và Authentication

| **TC-ID** | **Tiêu đề**                           | **Điều kiện tiên quyết**         | **Bước thực hiện**                                                         | **Kết quả mong đợi**                                    | **Ref**   |
|-----------|---------------------------------------|----------------------------------|----------------------------------------------------------------------------|---------------------------------------------------------|-----------|
| **TC-46** | **Messaging WS kết nối hợp lệ**       | Đã đăng nhập                     | Kết nối wss://.../ws/messaging?token=\<valid_jwt\>                         | Kết nối thành công, nhận PING trong vòng 30 giây        | SAD 4.1.4 |
| **TC-47** | **Messaging WS từ chối xác thực không hợp lệ** | Server đang chạy | Lần lượt kết nối wss://.../ws/messaging khi thiếu token, token sai/hết hạn, refresh token, access token đã blacklist/global-revoke và token của user soft-delete | Mỗi handshake bị từ chối bằng HTTP 401 trước khi upgrade; không dùng close code 4001 | SAD 4.1.4 |
| **TC-48** | **Signaling WS kết nối hợp lệ**       | Đã đăng nhập                     | Kết nối wss://.../ws/signaling?token=\<valid_jwt\>                         | Kết nối thành công                                      | SAD 4.2   |
| **TC-49** | **Signaling WS từ chối không có JWT** | Server đang chạy                 | Kết nối wss://.../ws/signaling không có token                              | Server đóng kết nối — SAD mục 4.2 bảo mật               | SAD 4.2   |
| **TC-50** | **TYPING indicator**                  | Hai user trong cùng conversation active | A gửi `{type:TYPING,data:{conversation_id}}`, sau đó `TYPING_STOP` | B nhận đúng hai event trong \< 500ms; A không nhận echo; không đổi `conversation.updated_at` | ADD 10.1  |
| **TC-61** | **Messaging WS heartbeat timeout** | Có access token hợp lệ, socket đã kết nối | Không gửi PONG cho hai PING liên tiếp | Server đóng đúng connection bằng code 4003 và dọn registry/task; connection khác không bị ảnh hưởng | API 10.1 |
| **TC-62** | **Messaging WS token hết hạn hoặc bị thu hồi giữa phiên** | Socket kết nối bằng access token hợp lệ | Lần lượt chờ token hết hạn, blacklist JTI và global-revoke user trong khi socket đang mở | Server đóng connection bằng code 4002 tại expiry timer hoặc heartbeat kế tiếp | API 10.1 |
| **TC-63** | **Messaging WS nhiều tab cùng user** | Một user có hai socket hợp lệ | Mở hai connection, đóng connection thứ nhất rồi tiếp tục PING/PONG trên connection thứ hai | Registry giữ hai session độc lập; connection thứ hai vẫn hoạt động sau khi connection thứ nhất đóng | SAD 4.1.4 |
| **TC-64** | **NEW_MESSAGE qua Redis tới nhiều tab recipient** | Hai user có conversation; recipient mở hai socket | Sender POST message trên một Backend instance | Cả hai socket recipient nhận cùng `NEW_MESSAGE`; `data` khớp đầy đủ response REST và sender không nhận event này | FR-11 |
| **TC-65** | **MESSAGE_STATUS_UPDATE qua Redis tới hai phía** | Message `sent`; sender và recipient đang mở socket | Recipient PUT status thành `read` | Mọi socket local của sender và recipient nhận `{type:MESSAGE_STATUS_UPDATE,data:{id,status:read}}` | FR-11 |
| **TC-66** | **Redis subscriber lỗi và tự phục hồi** | WebSocket đang mở; Redis subscriber hoạt động | Làm Redis gián đoạn rồi khởi động lại và publish event hợp lệ | Socket không bị đóng; health subscriber `UP→DEGRADED→UP`; realtime tiếp tục sau reconnect, event bị lỡ phục hồi qua history | NFR-14 |
| **TC-67** | **Messaging WS ERROR và policy violation** | Socket hợp lệ đang mở | Lần lượt gửi JSON hỏng, type không hỗ trợ và `conversation_id` không phải UUID | Mỗi frame nhận `ERROR` đúng code; sau ERROR thứ ba server đóng đúng connection bằng 1008 | API 10.1 |
| **TC-68** | **Messaging WS frame vượt giới hạn** | Socket hợp lệ đang mở | Gửi một text frame lớn hơn 32 KiB | Server đóng đúng connection bằng code 1009; không xử lý hoặc relay payload | API 10.1 |

### 4.2. Hiệu năng Avatar Tracking (NFR-01, NFR-02)

Các TC này được đo chi tiết trong Performance Test Report. Dưới đây là định nghĩa pass/fail để so sánh.

| **TC-ID** | **Tiêu đề**                     | **Điều kiện tiên quyết**                         | **Bước thực hiện**                                                                               | **Kết quả mong đợi**                                           | **Ref** |
|-----------|---------------------------------|--------------------------------------------------|--------------------------------------------------------------------------------------------------|----------------------------------------------------------------|---------|
| **TC-51** | **Tracking latency \< 100ms**   | Thiết bị tham chiếu, ánh sáng ≥ 200 lux, 50-80cm | Mở SCR-09 avatar preview với webcam, đo tracking-to-render latency qua console performance.now() | Trung bình \< 100ms; p95 \< 150ms trong 60 giây đo liên tục    | NFR-01  |
| **TC-52** | **Frame rate ≥ 24fps**          | Thiết bị tham chiếu, điều kiện như TC-51         | Đo FPS trong Avatar Renderer qua requestAnimationFrame counter                                   | FPS trung bình ≥ 24 trong 60 giây — tối thiểu không dưới 20fps | NFR-02  |
| **TC-53** | **E2E call latency \< 400ms**   | Hai thiết bị tham chiếu cùng mạng LAN            | Đo RTT qua RTCPeerConnection.getStats() trong cuộc gọi đang diễn ra                              | RTT trung bình \< 400ms — đo qua 30 giây gọi liên tục          | NFR-03  |
| **TC-54** | **WebRTC setup time \< 5 giây** | Hai thiết bị cùng mạng, có STUN/TURN             | Đo thời gian từ gửi CALL_OFFER đến ICE connected                                                 | \< 5 giây trong 90% lần thử (10 lần đo)                        | NFR-04  |

### 4.3. Độ tin cậy và Khôi phục

| **TC-ID** | **Tiêu đề**                         | **Điều kiện tiên quyết**               | **Bước thực hiện**                                                  | **Kết quả mong đợi**                                                | **Ref**        |
|-----------|-------------------------------------|----------------------------------------|---------------------------------------------------------------------|---------------------------------------------------------------------|----------------|
| **TC-55** | **Offline messaging**               | User B offline, User A gửi tin         | A gửi tin nhắn cho B offline → B đăng nhập lại                      | B nhận tin nhắn theo đúng thứ tự client_timestamp                   | NFR-14, NFR-25 |
| **TC-56** | **ICE restart — mất mạng ngắn**     | Đang gọi video                         | Tắt WiFi 3 giây rồi bật lại trong khi gọi                           | Cuộc gọi tự phục hồi trong \< 5 giây, không cần người dùng thao tác | NFR-14         |
| **TC-57** | **Video quota 2GB**                 | User có storage_used_bytes sắp đạt 2GB | POST /videos với estimated_size_bytes vượt quá phần còn lại         | HTTP 507; FAB record trong GET /videos bị disabled                  | NFR-19         |
| **TC-58** | **Background job fallback webhook** | Video ở processing \> 10 phút          | Chờ 10+ phút không có MinIO webhook (giả lập bằng cách tắt webhook) | Video chuyển sang status=failed tự động (background job)            | ADD 7.4        |

## 5. Ma trận Bao phủ FR

| **FR — Yêu cầu**                       | **TC bao phủ**                                             |
|----------------------------------------|------------------------------------------------------------|
| **FR-01 — Đăng ký**                    | TC-01, TC-02, TC-03                                        |
| **FR-02 — Đăng nhập**                  | TC-04, TC-05, TC-06, TC-43                                 |
| **FR-03 — Hồ sơ cá nhân**              | TC-20 (settings), TC-38 (auth)                             |
| **FR-04 — Nhân vật ảo**                | TC-10 đến TC-15                                            |
| **FR-05/06 — Bảo mật danh tính**       | TC-14 (không lộ email), TC-44 (webhook auth), TC-45 (CORS) |
| **FR-09 — Xử lý tracking lost**        | TC-51 (kiểm tra avatar freeze)                             |
| **FR-11 — Gửi tin nhắn**               | TC-23, TC-24, TC-25, TC-59, TC-60, TC-64, TC-65            |
| **FR-12 — Lịch sử tin nhắn**           | TC-26, TC-27, TC-28                                        |
| **FR-13/14 — Gọi video, WebRTC**       | TC-48, TC-49, TC-53, TC-54, TC-56                          |
| **FR-16 — Quay video**                 | TC-29, TC-30, TC-31, TC-32, TC-33                          |
| **FR-17 — Quản lý video**              | TC-34, TC-35, TC-36, TC-37                                 |
| **FR-18 — Thông báo lỗi gọi**          | TC-54 (timeout), TC-56 (reconnect)                         |
| **FR-19/20 — Lỗi camera/mạng**         | TC-56 (mạng), NFR test                                     |
| **FR-22 — Tìm kiếm user**              | TC-16, TC-17, TC-18, TC-19, TC-20                          |
| **NFR-01/02 — Hiệu năng avatar**       | TC-51, TC-52, Performance Report                           |
| **NFR-03/04 — Chất lượng cuộc gọi**    | TC-53, TC-54, Performance Report                           |
| **NFR-07/08/09 — Bảo mật JWT**         | TC-38, TC-39, TC-40, TC-41, TC-42                          |
| **NFR-14 — Độ tin cậy**                | TC-55, TC-56                                               |
| **NFR-19 — Storage quota**             | TC-33, TC-57                                               |
| **NFR-24/25 — Idempotency / Ordering** | TC-24, TC-25, TC-55                                        |
| **NFR-32 — CORS/HSTS**                 | TC-45                                                      |

## 6. P4-T10 — Quy trình kiểm thử Avatar Retargeting

Trạng thái Phase 3B và acceptance gate chi tiết nằm tại
`docs/P4_T10_PHASE3B_HAND_TWIST_STATUS_AND_PLAN.md`. Automated PASS không thay thế webcam
acceptance; tính đến 2026-07-29, Phase 3B vẫn **IN PROGRESS** vì chiều pronation/supination tay
phải còn sai trên webcam.

### 6.1. Automated gates

Chạy từ `frontend/`:

```powershell
npm.cmd test -- --run
npm.cmd test -- --run src/lib/avatar-motion/jointSolver.test.ts src/lib/avatar-motion/avatarMotionProcessor.test.ts src/lib/avatar-renderer/avatarRendererMath.test.ts src/lib/avatar-renderer/avatarDiagnostics.test.ts src/lib/avatar-renderer/modelLoader.test.ts
npm.cmd test -- --run src/lib/avatar-motion/handPoseMatching.test.ts src/lib/avatar-motion/handPalmBasis.test.ts src/lib/avatar-motion/handForearmTwist.test.ts src/lib/avatar-motion/handTwistConfidence.test.ts src/lib/avatar-motion/handTwistStabilization.test.ts src/lib/avatar-motion/handTwistTemporal.test.ts src/lib/avatar-motion/handTwistRig.test.ts src/lib/avatar-motion/handTwistRootCauseValidation.test.ts src/lib/avatar-motion/avatarMotionProcessor.test.ts
npm.cmd run lint
npm.cmd run build
```

Test Phase 2 phải bao phủ rest pose, parent/grandparent rotation, elbow bend trái/phải,
left/right symmetry, A-B-A determinism, zero/missing direction, finite/normalized quaternion,
profile model generation và renderer `restLocal × deltaLocal`. Không dùng unit fixture để
tuyên bố model thật PASS; phải có deterministic browser evidence riêng.

### 6.2. Deterministic real-model acceptance

Mở `http://localhost:5173/dev/avatar-renderer` trong development build, load normalized VRM
model và đặt:

```text
Filtered = OFF
Constraints = OFF
Render smoothing = OFF
```

Chạy lần lượt: `tPose`, `armsDown`, `leftArmUp`, `rightArmUp`, `leftElbow90`,
`rightElbow90`, `bothForward`, `twistReferenceA`, `twistReferenceB`.

Với bốn khớp upper/lower arm, ghi tracked direction, applied world direction, packet
`deltaLocal`, target local, applied local và angular error. Tiêu chí Phase 2:

- mỗi controlled segment error `≤2°`;
- packet/target/applied quaternion finite và normalized;
- cùng frozen input không drift;
- twist A/B giữ upper-arm output giống nhau nhưng đổi lower-arm direction — đây là bằng
  chứng H2 còn mở, không phải H2 PASS;
- `Processor→draw`/pose age của frozen packet tăng theo thời gian không được ghi thành
  tracking latency failure.

### 6.3. Webcam manual acceptance

Bật lại Filtered, Constraints và Render smoothing. Đảm bảo camera thấy vai, khuỷu và cổ tay;
thực hiện dang tay, hạ tay, nâng từng tay, gập từng khuỷu, đưa tay ra trước và giữ yên 5 giây.

Ghi riêng ba trường hợp:

1. đủ landmark: đúng bên, không lật 180°, không trôi/giật đáng kể;
2. cổ tay rời khung: hold/snap/return behavior;
3. tracking trở lại: có nhảy hay phục hồi mềm.

Phase 2 chỉ nghiệm thu H1 retargeting khi input ổn định. Snap do loss transition phải ghi
open issue cho phase tracking-loss; không được che bằng kết luận chung “webcam kém”.

### 6.4. Lifecycle và resource acceptance

Thực hiện start/stop/start, reload model ít nhất 10 lần, unmount/remount route và
background/resume. Ghi trước/sau: số rAF loop, WebGL context, geometries, textures và programs.
Unit test `dispose()` không đủ để tuyên bố không leak. Nếu chưa đo browser thật, kết quả phải
là `UNVERIFIED`.

### 6.5. 2B-5C pronation/supination root-cause validation

Tại `/dev/avatar-renderer`, bật Hand twist, mở bàn tay, gập khuỷu khoảng 90°, giữ cẳng tay không
chĩa thẳng vào camera. Bắt đầu ở handshake/neutral, xoay palm-up 45–60°, trở lại neutral, rồi
xoay palm-down 45–60°. Freeze và ghi snapshot riêng cho neutral, palm-up và palm-down.

Với từng side, đối chiếu đủ chuỗi: `rawWrappedTwistRadians`, `rawUnwrappedTwistRadians`,
`neutralTwistRadians`, `correctedTwistRadians`, `deadZoneOutputRadians`,
`filteredTargetTwistRadians`, `clampedTwistRadians`, `targetInfluenceWeight`,
`temporalInfluenceWeight`, `appliedTwistRadians`, `trusted`, `rejectionReason`, `clampApplied`,
`observationMode`. Không kết luận từ riêng raw wrapped vì có biên ±π.

Acceptance gate trước khi đánh dấu 2B-5 PASS:

- palm-up/palm-down tạo correction trái dấu, biên độ phù hợp và shortest-path qua ±π;
- trusted/influence không triệt tiêu observation hợp lệ;
- lowerArm primary và wrist position không đổi đáng kể chỉ vì axial twist;
- hand child kế thừa rotation, renderer không ghi hand local nếu packet không có hand joint;
- cả left/right cùng convention giải phẫu, không double-negate;
- nắm đấm, wrist flexion/extension, radial-ulnar deviation và finger bones nằm ngoài task.

### 6.6. 2B-5D arm stability root-cause audit

Tại `/dev/avatar-renderer`, giữ nguyên camera, ánh sáng và tư thế rồi chạy hai lượt: trước hết tắt
**Hand twist (2B-5)**, sau đó bật lại mà không đổi Pose. Snapshot `motionDiagnostics.armStability`
được UI cập nhật mỗi 400 ms; không dùng log mỗi frame.

Chụp cho từng side ở tám tình huống: Pose-only giữ yên; twist-on giữ yên; tay gần duỗi; khuỷu 90°;
palm nhìn cạnh; Hand miss ngắn rồi quay lại; elbow confidence dao động quanh ngưỡng; FPS/dt thay đổi.
Đối chiếu theo thứ tự:

1. Pose target delta có xuất hiện trước Pose applied delta không;
2. `elbowSourceChanged` hoặc `poleBranchChanged` có trùng spike không;
3. khi Pose target đứng yên, `handRawTwistDeltaRadians` có xuất hiện trước
   `handAppliedTwistDeltaRadians` không;
4. influence/neutral/observation mode có đổi cùng spike không;
5. spike có tương quan với `frameDtMs`, tuổi sample hoặc tracking state không.

Automated audit dùng exact hold, nhiễu tổng hợp nhỏ, pole degeneracy, edge-on palm, loss/reacquire,
visibility hysteresis và dt 16/50/33/100 ms. Automated result không thay thế webcam snapshot và chưa
cho phép tune smoothing/clamp hoặc đánh dấu 2B-5 hoàn thành.

### 6.7. 2B-6 — Hand Twist Integration and Regression

Processor phải phân loại Hand sample trước matching/palm: `unsampled`, `duplicate`, `new-sample`.
Duplicate không được chạy matching, dựng palm, cập nhật wrist continuity hay tạo observation mới;
temporal vẫn tiến theo `dt` về target cuối hoặc tiếp tục hold/fade đã bắt đầu.

Mỗi side có tracking epoch riêng. Trusted observation đầu tiên của epoch mới anchor neutral đúng một
lần. Short loss/reacquired và source-index reorder không đổi epoch. Reset/dispose, rig/model change,
tracking discontinuity, recovery sau confirmed lower-arm geometry loss và long-loss reset phải xóa
matching cùng state twist tương ứng; long loss chỉ reset sau khi temporal đạt điều kiện reset, không
reset lúc vừa missing.
Lower-arm geometry invalid một frame phải fallback Pose-only nhưng giữ epoch/neutral. Loss chỉ được
xác nhận bởi observation invalid tiếp theo sau `invalidGraceMs`; recovery sau confirmed loss mở đúng
một epoch, còn chuỗi invalid/valid từng frame không được pumping epoch hoặc re-anchor neutral.

Automated regression bắt buộc chứng minh: flag-off/Pose fallback tuyệt đối; duplicate gating trước
matching/palm nhưng vẫn temporal tick; right-only/both-hands độc lập; chỉ lowerArm đổi; upperArm/elbow
output và lowerArm primary không đổi do pure twist; short reacquire giữ neutral; long loss/rig/reset/
dispose mở epoch mới và không rò quaternion; malformed profile fail-fast; runtime geometry invalid
fallback Pose-only; chuỗi neutral → +twist → neutral → -twist đổi dấu đúng và không tăng epoch.
Right-hand webcam regression phải ghi đồng thời `configuredPositiveSign`, `rigApplicationSign`,
`filteredTargetTwistRadians`, `appliedTwistRadians` và world orientation thật sau renderer. Không
được kết luận chiều đúng chỉ vì scalar diagnostic đổi dấu. Thử nghiệm `rigApplicationSign=-1` hiện
vẫn cho chuyển động ngược trên webcam, nên gate này đang **FAIL** và convention chưa được khóa.

### 6.8. Phase 3B — Manual acceptance matrix

Chạy cùng một matrix trên `reference-avatar.vrm`, `reference-avatar-1.vrm` và
`reference-avatar-2.vrm`. Trước mỗi model/side: reload model, giữ bàn tay ngoài khung cho tới khi
state ổn định, sau đó đưa tay vào tư thế handshake neutral. Bật Filter, Constraints, Render
smoothing và Hand twist; ghi rõ mọi khác biệt nếu phải thay cấu hình.

| Case | Động tác | Evidence bắt buộc | Kết quả đạt |
|---|---|---|---|
| B1 | Right neutral | Snapshot palm basis → applied quaternion | correction gần 0, không re-anchor lặp |
| B2 | Right palm-up 45–60° | Snapshot toàn chuỗi scalar + avatar | avatar xoay đúng chiều giải phẫu |
| B3 | Right palm-down 45–60° | Như B2 | trái dấu B2, không flip 180° |
| B4 | Left neutral/up/down | Như B1–B3 | cùng convention giải phẫu, không double-negate |
| B5 | Giữ từng tư thế 5 giây | rolling stability snapshot | không drift, influence pumping hoặc twist spike |
| B6 | Short miss/reacquire | epoch/neutral/matching diagnostics | giữ neutral/epoch, phục hồi không snap |
| B7 | Flag off | packet/quaternion A/B | giống Pose-only tuyệt đối |
| B8 | Pure twist | lowerArm primary, elbow, wrist | primary/elbow/wrist position gần như không đổi |

Nếu một model thiếu humanoid bone/profile hợp lệ, kết quả phải là rejection có lý do; không được
hard-code tên node, tên model hoặc một dấu/tỉ lệ riêng mà chưa đưa thành rig-profile data có test.
Wrist flexion/extension, finger pose và nắm đấm không phải failure của matrix Phase 3B.

Known issue ngoài matrix: khi bàn tay che mặt, Face tracking có thể làm đầu/mặt quay hoặc biến dạng.
Lỗi này xảy ra cả khi Hand twist tắt và phải được theo dõi như task Face-occlusion riêng.

*— Hết tài liệu —*
