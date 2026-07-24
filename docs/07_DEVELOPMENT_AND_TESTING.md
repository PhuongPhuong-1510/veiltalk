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
| **TC-10** | **Lấy danh sách model**         | Server đang chạy             | GET /avatars/models                                               | HTTP 200, mảng models có ≥ 1 phần tử, mỗi model có model_id, model_url, thumbnail_url               | FR-04            |
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
| **TC-28** | **Không cho giảm status**           | TC-27 đã chạy (status=read)   | PUT .../messages/{msgId} {status:'sent'}                                               | HTTP 400 — không được quay về trạng thái trước                               | ADD 6.6           |

### 2.5. Module Video (FR-16, FR-17)

| **TC-ID** | **Tiêu đề**                       | **Điều kiện tiên quyết**                         | **Bước thực hiện**                                                            | **Kết quả mong đợi**                                                                              | **Ref**         |
|-----------|-----------------------------------|--------------------------------------------------|-------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|-----------------|
| **TC-29** | **Khởi tạo upload video**         | Đã đăng nhập, quota \< 2GB                       | POST /videos {title, estimated_size_bytes:10485760, chunk_size_bytes:5242880} | HTTP 201, status='recording', upload_id có giá trị, first_chunk_url là URL MinIO hợp lệ           | FR-16           |
| **TC-30** | **Lấy chunk URL tiếp theo**       | TC-29 đã chạy, đã PUT chunk 1 lên MinIO, có etag | POST /videos/{id}/chunks {upload_id, part_number:2, etag_previous}            | HTTP 200, chunk_url cho part 2                                                                    | FR-16, ADD 7.3  |
| **TC-31** | **Finalize upload**               | TC-30 đã chạy, có danh sách parts + etags        | POST /videos/{id}/finalize {upload_id, parts, duration_secs}                  | HTTP 202, status='processing'. Sau webhook MinIO: GET /videos/{id} → status='ready'               | FR-16, ADD 7.4  |
| **TC-32** | **Abort upload**                  | TC-29 đã chạy                                    | POST /videos/{id}/abort {upload_id}                                           | HTTP 204; GET /videos/{id} trả về 404                                                             | FR-16, ADD 7.5  |
| **TC-33** | **Quota vượt mức**                | User đã có 1.99GB video                          | POST /videos với estimated_size_bytes = 50MB                                  | HTTP 507, STORAGE_QUOTA_EXCEEDED                                                                  | NFR-19, ADD 7.2 |
| **TC-34** | **Đổi tên video**                 | Video status=ready                               | PUT /videos/{id} {title:'Tên mới'}                                            | HTTP 200, title cập nhật                                                                          | FR-17           |
| **TC-35** | **Xóa video**                     | Video status=ready                               | DELETE /videos/{id}                                                           | HTTP 204; GET /videos/{id} → 404; storage_used_bytes giảm                                         | FR-17           |
| **TC-36** | **Video failed — view_url null**  | Video status=failed                              | GET /videos/{id}                                                              | HTTP 200, view_url=null, status='failed'                                                          | ADD 7.7         |
| **TC-37** | **Xóa tài khoản abort recording — thực hiện tại P2-T24** | P2-T19–P2-T22 hoàn thành; user đang có video status=recording | DELETE /users/me với password đúng | HTTP 204 và token bị revoke ngay; video recording được abort trên MinIO. Nếu abort lỗi, cleanup job bền vững retry mà không rollback soft delete | ADD 4.5, ADD 7.5 |

## 3. Ca Kiểm thử Bảo mật

| **TC-ID** | **Tiêu đề**                         | **Điều kiện tiên quyết**             | **Bước thực hiện**                                                           | **Kết quả mong đợi**                                                                    | **Ref** |
|-----------|-------------------------------------|--------------------------------------|------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------|---------|
| **TC-38** | **Truy cập API không có token**     | Server đang chạy                     | GET /users/me không có Authorization header                                  | HTTP 401, UNAUTHORIZED                                                                  | NFR-08  |
| **TC-39** | **Token hết hạn**                   | Có access token đã hết hạn (15 phút) | GET /users/me với token hết hạn                                              | HTTP 401, UNAUTHORIZED                                                                  | NFR-08  |
| **TC-40** | **Truy cập resource của user khác** | User A và B đã đăng nhập             | User A gọi PUT /videos/{idVideoOfB} (video của B)                            | HTTP 403, FORBIDDEN                                                                     | NFR-29  |
| **TC-41** | **JWT secret sai**                  | Server đang chạy                     | Gửi request với JWT ký bằng secret khác                                      | HTTP 401, UNAUTHORIZED                                                                  | NFR-08  |
| **TC-42** | **SQL Injection via email field**   | Server đang chạy                     | POST /auth/login {email: "' OR '1'='1"}                                      | HTTP 401 hoặc 400 — KHÔNG crash server, KHÔNG trả về data                               | NFR-09  |
| **TC-43** | **Anti-enumeration đăng nhập**      | Biết email A tồn tại                 | So sánh response body của: (1) sai password email A, (2) email không tồn tại | Response body PHẢI giống hệt nhau — không tiết lộ email có tồn tại không                | FR-02   |
| **TC-44** | **Webhook không có signature**      | Server đang chạy                     | POST /internal/videos/webhook không có header X-MinIO-Signature              | HTTP 401 hoặc 403                                                                       | ADD 7.6 |
| **TC-45** | **CORS origin không được phép**     | Server đang chạy                     | Gửi request với Origin: https://evil.example.com                             | Response không có Access-Control-Allow-Origin header hoặc giá trị khác với allowed list | NFR-32  |

## 4. Ca Kiểm thử Phi chức năng (NFR)

### 4.1. WebSocket — Kết nối và Authentication

| **TC-ID** | **Tiêu đề**                           | **Điều kiện tiên quyết**         | **Bước thực hiện**                                                         | **Kết quả mong đợi**                                    | **Ref**   |
|-----------|---------------------------------------|----------------------------------|----------------------------------------------------------------------------|---------------------------------------------------------|-----------|
| **TC-46** | **Messaging WS kết nối hợp lệ**       | Đã đăng nhập                     | Kết nối wss://.../ws/messaging?token=\<valid_jwt\>                         | Kết nối thành công, nhận PING trong vòng 30 giây        | SAD 4.1.4 |
| **TC-47** | **Messaging WS token không hợp lệ**   | Server đang chạy                 | Kết nối wss://.../ws/messaging?token=invalid                               | Server đóng kết nối ngay, HTTP 401 hoặc close code 4001 | SAD 4.1.4 |
| **TC-48** | **Signaling WS kết nối hợp lệ**       | Đã đăng nhập                     | Kết nối wss://.../ws/signaling?token=\<valid_jwt\>                         | Kết nối thành công                                      | SAD 4.2   |
| **TC-49** | **Signaling WS từ chối không có JWT** | Server đang chạy                 | Kết nối wss://.../ws/signaling không có token                              | Server đóng kết nối — SAD mục 4.2 bảo mật               | SAD 4.2   |
| **TC-50** | **TYPING indicator**                  | Hai user trong cùng conversation | User A gõ → gửi {type:TYPING, conversation_id} → User B nhận {type:TYPING} | User B nhận message type TYPING trong \< 500ms          | ADD 10.1  |

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
| **FR-11 — Gửi tin nhắn**               | TC-23, TC-24, TC-25                                        |
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

*— Hết tài liệu —*
