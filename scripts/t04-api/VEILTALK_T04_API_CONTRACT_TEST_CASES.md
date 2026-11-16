# VEILTALK — T04: API & CONTRACT TESTING — TEST CASE SPECIFICATION

**Tài liệu kiểm thử kịch bản, không phải mã nguồn hoặc kết quả chạy test.** Tổng cộng **195 kịch bản đề xuất** trong 10 nhóm. Ngày biên soạn: 19/10/2026.

## 1. Phạm vi và nguồn đối chiếu

- Nền tảng: gói `veiltalk.zip` chứa 137 file Java (snapshot có timestamp 16/09/2026), bản review source, báo cáo kiến trúc trước đó và `backend.test.cjs` (14 E2E đã chạy 19/10/2026).
- **Khác phiên bản:** ZIP tháng 9 có thể không phản ánh code đang chạy tháng 10. Mỗi case phải được rà soát lại với `docs/04_API.md` và source hiện tại trước khi khóa tiêu chí PASS; đặc biệt là signaling, filter nội bộ, code response/error và cấu hình.
- Đây là T04: tập trung **hợp đồng API** (URL, method, schema, validation, status, header, phân trang, lỗi, quyền truy cập thể hiện ở API). Các case đòi hỏi DB/WebSocket/MinIO thật có thể được thực thi chung với T03/T05/T06 để tiết kiệm nhưng giữ ID T04 để kiểm tra contract.
- Không bao gồm benchmark k6, stress/load, kiểm thử xâm nhập tổng thể hoặc phục hồi sự cố hạ tầng có phá hoại (T06–T08 xử lý sâu).
- Các case có lời ghi **"theo hợp đồng / cần chốt"** là ý tưởng kiểm thử cần xác minh, không được tự đánh dấu FAIL chỉ vì một mã HTTP do người viết test phỏng đoán.

## 2. Hướng dẫn chuẩn bị môi trường và quy tắc đánh giá

**Fixture tối thiểu:** A/B là người dùng active; C là người ngoài hội thoại; D có discoverable=false; X là người dùng đã soft-delete; tạo đủ hội thoại và tin nhắn để phân trang, các video ở trạng thái recording/ready/failed; token còn hạn và token lỗi; MinIO test riêng với cơ chế dọn phiên. Không gửi token thật/secret thật vào báo cáo.

**Các dữ liệu biên** nên thực thi bằng nhiều sub-case độc lập, không đặt tất cả input sai vào cùng một request: null, omitted, empty, whitespace-only, wrong type, malformed JSON, giá trị min, min-1, max, max+1, Unicode/emoji; malformed/unknown/existing UUID.

**Chỉ tính PASS khi đủ:** (1) HTTP status hoặc WebSocket event đúng, (2) response schema/field value đúng, (3) error code/details đúng khi áp dụng, (4) state/side effect đúng với test thay đổi dữ liệu, (5) không rò rỉ dữ liệu trái quyền. Dùng `BLOCKED` cho thiếu fixture/contract và `NEEDS_CONTRACT` cho điểm chưa có định nghĩa thống nhất. Không sửa assertion chỉ để PASS nếu hợp đồng mong muốn chưa đổi.

**Ưu tiên:** P0 = chức năng chính, mất dữ liệu, vượt quyền hoặc lỗi phiên quan trọng; P1 = validate/biên/nhánh lỗi quan trọng; P2 = mở rộng chuẩn hóa và trường hợp hiếm. Tất cả case đều ở trạng thái **NOT RUN** cho đến khi bạn viết và chạy; E2E trước đó chỉ dùng làm chứng cứ tham khảo.

## 3. Tổng quan số lượng

| Phần | Số test case |
|---|---:|
| A. Quy tắc hợp đồng HTTP áp dụng cho mọi endpoint | 15 |
| B. Authentication: đăng ký, đăng nhập, refresh, logout | 22 |
| C. User profile, settings, tìm kiếm, xóa tài khoản | 20 |
| D. Avatar model và hồ sơ avatar | 14 |
| E. Conversation API: khởi tạo, truy vấn, phân trang | 17 |
| F. Message API: tạo mới, idempotency, lịch sử, trạng thái | 29 |
| G. Video APIs và hợp đồng multipart | 40 |
| H. Endpoint nội bộ: thông báo cuộc gọi và webhook MinIO | 11 |
| I. Client metrics/telemetry | 9 |
| J. WebSocket messaging và Node signaling — hợp đồng giao thức bổ trợ T04 | 18 |
| **Tổng cộng** | **195** |

## 4. Ma trận endpoint được phát hiện trong ZIP

- Auth (4): `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`.
- User (6): `GET /users/me`, `PUT /users/me`, `GET /users/me/settings`, `PUT /users/me/settings`, `DELETE /users/me`, `POST /users/search`.
- Avatar (4): `GET /avatars/models`, `PUT /avatars/me`, `GET /avatars/me`, `GET /avatars/{userId}`.
- Conversations/messages (6): `POST /conversations`, `GET /conversations`, `GET /conversations/{id}`, `POST /conversations/{id}/messages`, `GET /conversations/{id}/messages`, `PUT /conversations/{id}/messages/{messageId}`.
- Video (8): `GET /videos`, `GET /videos/{id}`, `PUT /videos/{id}`, `DELETE /videos/{id}`, `POST /videos`, `POST /videos/{id}/chunks`, `POST /videos/{id}/finalize`, `POST /videos/{id}/abort`.
- Internal (2): `POST /internal/call/notify`, `POST /internal/videos/webhook`.
- Metrics (1): `POST /metrics/client`.
- WebSocket (2): Spring `/ws/messaging` và Node `/ws/signaling` (Node không có trong ZIP).
- Ngoài phạm vi CRUD nghiệp vụ: `/actuator/health` (đối chiếu config), Spring Security OPTIONS/CORS (cần hợp đồng deployment).

**Ghi chú tính số:** 31 HTTP endpoint nghiệp vụ/nội bộ được nhận diện từ các Controller trong ZIP; WebSocket, OPTIONS và Actuator không tính vào 31.

## 5. Test cases chi tiết

### A. Quy tắc hợp đồng HTTP áp dụng cho mọi endpoint

**Căn cứ:** `SecurityConfig.java; ApiExceptionHandler.java; toàn bộ Controller và DTO`.

| ID | Ưu tiên | Endpoint | Chuẩn bị / các bước thực hiện | Kết quả mong đợi / tiêu chí PASS |
|---|---|---|---|---|
| **COM-001** | P0 | `Tất cả API private` | Không gửi Authorization; lần lượt gọi mọi endpoint riêng tư bằng dữ liệu hợp lệ. | Không trả dữ liệu được bảo vệ; mã 401 và error body theo cơ chế Security. Lập bảng endpoint áp dụng, không gộp thành một request. |
| **COM-002** | P0 | `Tất cả API private` | Thay Bearer token bằng chuỗi ngẫu nhiên, token sai chữ ký, token sai loại; thử trên từng họ endpoint. | Không được coi là người dùng hợp lệ; không có dữ liệu nhạy cảm hay thay đổi DB. Kiểm tra mã 401 theo chính sách. |
| **COM-003** | P1 | `Tất cả endpoint JSON` | Gửi Content-Type application/json và payload hợp lệ; so sánh response với DTO/hợp đồng. | Mã HTTP, tên field snake_case, kiểu dữ liệu, giá trị null, UUID và ISO timestamp đúng; không thiếu trường bắt buộc. |
| **COM-004** | P1 | `Tất cả endpoint cần body` | Gửi body trống, JSON bị cắt, JSON sai cú pháp; chạy riêng cho mỗi endpoint nhận JSON. | Lỗi client được xử lý nhất quán, không ghi DB; trường hợp lỗi JSON hỗ trợ 400 VALIDATION_ERROR theo handler. |
| **COM-005** | P1 | `Tất cả endpoint có input UUID` | Dùng UUID không hợp lệ, UUID hợp lệ nhưng không tồn tại, và UUID thuộc người khác. | Phân biệt lỗi format, không tìm thấy, không có quyền; không xuất hiện 500 ngoài dự kiến. |
| **COM-006** | P1 | `Tất cả endpoint lỗi` | Kiểm tra một case validation, unauthorized, forbidden, not found, conflict trên endpoint tương ứng. | Cấu trúc `error.code`, `error.message`, `error.details` nhất quán với ApiExceptionHandler; không lộ stack trace/secret. |
| **COM-007** | P1 | `Tất cả endpoint tạo/sửa/xóa` | Gửi payload bị từ chối do validation; chụp trạng thái dữ liệu trước/sau. | Không có thay đổi ngoài ý muốn lên PostgreSQL, Redis hay MinIO; khẳng định bằng GET/DB, không chỉ status. |
| **COM-008** | P1 | `Tất cả endpoint đọc` | Gửi request hợp lệ nhiều lần với dữ liệu test bất biến. | Phản hồi đúng schema và dữ liệu; không phát sinh thay đổi nghiệp vụ ngoài hợp đồng. |
| **COM-009** | P1 | `Tất cả endpoint` | Thử phương thức HTTP không được khai báo trên từng URL (ví dụ PATCH thay cho PUT). | Không vô tình thực hiện thao tác; mã 404/405 tùy cấu hình thực thi, cần khớp hợp đồng thống nhất. |
| **COM-010** | P1 | `Tất cả endpoint JSON` | Thử Content-Type không phù hợp (text/plain, multipart/form-data) với endpoint nhận JSON. | Từ chối hoặc xử lý đúng chính sách content negotiation; không chấp nhận im lặng payload không hiểu. |
| **COM-011** | P2 | `Tất cả endpoint JSON` | Thêm field lạ/nhạy cảm vào payload, như role, user_id, is_admin; thử từng DTO. | Không xảy ra mass assignment hoặc thay đổi trường không được phép; việc từ chối hay bỏ qua field lạ phải chốt hợp đồng. |
| **COM-012** | P2 | `Tất cả endpoint có response` | Kiểm tra Content-Type, encoding Unicode, chữ tiếng Việt/emoji và ký tự đặc biệt qua các API hỗ trợ text. | Chuỗi không hỏng encoding; JSON hợp lệ và consistent headers; status 204 không có response body nghiệp vụ. |
| **COM-013** | P2 | `Tất cả endpoint có dữ liệu private` | Gọi với token người A; quan sát response header/body và response lỗi. | Không lộ password hash, refresh token không thuộc quyền, secret nội bộ, storage path nội bộ hoặc stack trace. |
| **COM-014** | P2 | `Public endpoints` | Không gửi token hoặc gửi token bị lỗi khi gọi các endpoint được cấu hình public. | Endpoint public vận hành theo chính sách; sự khác nhau giữa public và private được ghi nhận rõ. |
| **COM-015** | P2 | `Tất cả endpoint được rate-limit` | Vượt giới hạn theo tài khoản; quan sát 429, Retry-After và dữ liệu còn nguyên. | Đúng số lượt/cửa sổ theo chính sách; Retry-After có giá trị hợp lý; không nhầm 429 với lỗi server. |

### B. Authentication: đăng ký, đăng nhập, refresh, logout

**Căn cứ:** `auth/AuthController.java:21-46; RegisterRequest.java; LoginRequest.java; RefreshTokenRequest.java; AuthService.java`.

| ID | Ưu tiên | Endpoint | Chuẩn bị / các bước thực hiện | Kết quả mong đợi / tiêu chí PASS |
|---|---|---|---|---|
| **AUTH-001** | P0 | `POST /auth/register` | Email mới; mật khẩu đạt 8 ký tự, có hoa và số; display_name hợp lệ. | 201; `user.id`, email, display_name, role, created_at và `tokens.access_token`, `refresh_token`, `expires_in` đúng kiểu; GET /users/me dùng access token thành công. |
| **AUTH-002** | P0 | `POST /auth/register` | Đăng ký lần hai cùng email đang hoạt động. | 409 CONFLICT; không tạo thêm tài khoản hay refresh token ngoài dự kiến. |
| **AUTH-003** | P1 | `POST /auth/register` | Lần lượt thiếu email, email rỗng, email sai định dạng. | 400 VALIDATION_ERROR; chỉ rõ field liên quan; không tạo user. |
| **AUTH-004** | P1 | `POST /auth/register` | Mật khẩu thiếu, rỗng, 7 ký tự, không có chữ hoa, không có số. | 400 VALIDATION_ERROR từng trường hợp; DB không tạo user. |
| **AUTH-005** | P1 | `POST /auth/register` | Mật khẩu ở đúng biên tối thiểu 8 ký tự có hoa và số. | Đăng ký thành công; xác minh không từ chối nhầm dữ liệu đạt ranh giới quy tắc. |
| **AUTH-006** | P1 | `POST /auth/register` | display_name thiếu, rỗng, 100 ký tự, 101 ký tự; chạy từng biến thể. | Thiếu/rỗng/quá 100 bị 400; đúng 100 được nhận; tên tiếng Việt/emoji round-trip nguyên vẹn khi hợp lệ. |
| **AUTH-007** | P1 | `POST /auth/register` | Email với kiểu chữ hoa/thường và khoảng trắng; so với email tài khoản hiện có. | Hành vi chuẩn hóa/phân biệt email phải phù hợp hợp đồng; chưa ấn định 409 vì cần xác nhận chính sách normalization. |
| **AUTH-008** | P0 | `POST /auth/login` | Đăng nhập với tài khoản có sẵn và mật khẩu đúng. | 200; user.id đúng, token hợp lệ; has_avatar phản ánh avatar hiện tại; không lộ hash mật khẩu. |
| **AUTH-009** | P0 | `POST /auth/login` | Đăng nhập bằng mật khẩu sai và email chưa tồn tại. | 401 UNAUTHORIZED; không cấp token; lỗi không làm lộ tài khoản có tồn tại hay không theo chính sách. |
| **AUTH-010** | P1 | `POST /auth/login` | Thiếu email, email sai format, thiếu mật khẩu hoặc mật khẩu rỗng. | 400 VALIDATION_ERROR; không phát hành token. |
| **AUTH-011** | P1 | `POST /auth/login` | Tài khoản đã soft-delete thử đăng nhập lại. | 401; không phát hành token mới. |
| **AUTH-012** | P0 | `POST /auth/refresh` | Dùng refresh token còn hiệu lực của A. | 200; có access_token mới và expires_in hợp lệ; truy cập API private thành công. |
| **AUTH-013** | P0 | `POST /auth/refresh` | Dùng refresh token ngẫu nhiên, sai, bị thu hồi hoặc của tài khoản đã xóa. | 401 theo chính sách; không cấp access token. |
| **AUTH-014** | P1 | `POST /auth/refresh` | Thiếu refresh_token, null, chuỗi rỗng hoặc số JSON. | Thiếu/null/rỗng trả 400; số bị từ chối như token không hợp lệ (401); không có token mới. |
| **AUTH-015** | P1 | `POST /auth/refresh` | Refresh token đã hết hạn theo fixture/clock được kiểm soát. | 401; không tạo access token. Cần chuẩn bị fixture để test nhanh, không đợi thời gian thực dài. |
| **AUTH-016** | P0 | `POST /auth/logout` | A có access token và refresh token cùng phiên; logout đúng dữ liệu. | 204 không body; access token cũ bị từ chối trên HTTP và refresh token không dùng lại được. |
| **AUTH-017** | P0 | `POST /auth/logout` | Thiếu access token, dùng token vô hiệu hoặc refresh token không khớp tài khoản. | Từ chối, không thu hồi nhầm token của người khác; kiểm tra 401 theo đường xác thực. |
| **AUTH-018** | P1 | `POST /auth/logout` | A dùng access token A nhưng refresh token của B. | 401; A không thể thu hồi phiên B; cả hai trạng thái phiên tuân theo chính sách. |
| **AUTH-019** | P1 | `POST /auth/logout` | Gửi refresh token đã được logout lần trước, thử logout lặp. | Không tạo phiên mới; response lỗi/không lỗi theo hợp đồng xác thực đã chốt; không còn token hợp lệ trở lại. |
| **AUTH-020** | P1 | `/auth/*` | Gửi field JSON thừa như role=admin/is_admin=true lúc register/login. | Không nâng quyền hoặc xuất trường nhạy cảm; chốt cách xử lý field thừa (ignore/reject) theo Jackson config thực tế. |
| **AUTH-021** | P2 | `/auth/*` | Gửi email/tên với Unicode, dấu cách, dấu nháy đơn; thử dữ liệu an toàn và đầu vào cần từ chối. | Không lỗi 500 hoặc phá JSON; validation/normalization phù hợp hợp đồng. |
| **AUTH-022** | P1 | `POST /auth/login` | Trước và sau khi tạo avatar cho user, đăng nhập lại. | `user.has_avatar` đổi chính xác theo trạng thái profile avatar. |

### C. User profile, settings, tìm kiếm, xóa tài khoản

**Căn cứ:** `user/UserProfileController.java:32-81; DTO và UserProfileService.java/UserSearchService.java`.

| ID | Ưu tiên | Endpoint | Chuẩn bị / các bước thực hiện | Kết quả mong đợi / tiêu chí PASS |
|---|---|---|---|---|
| **USR-001** | P0 | `GET /users/me` | Đăng nhập A và gọi API. | 200; id/email/display_name/role/has_avatar/created_at thuộc A, không lộ password_hash/refresh token. |
| **USR-002** | P0 | `PUT /users/me` | A cập nhật display_name hợp lệ rồi GET /users/me. | 200; trả field mới, GET đọc lại đúng; không sửa email/role. |
| **USR-003** | P1 | `PUT /users/me` | Chỉ gửi avatar_url; chỉ gửi display_name; so sánh trường còn lại trước/sau. | Chỉ trường có mặt trong request thay đổi, các field không gửi giữ nguyên. |
| **USR-004** | P1 | `PUT /users/me` | display_name rỗng, null, 101 ký tự; và đúng 100 ký tự. | Dữ liệu không hợp lệ bị 400; biên 100 được chấp nhận; lưu/đọc nguyên vẹn. |
| **USR-005** | P1 | `PUT /users/me` | avatar_url=null để yêu cầu xóa; một lần không gửi avatar_url. | Phân biệt rõ lệnh xóa có chủ đích với bỏ qua cập nhật; GET phản ánh đúng. |
| **USR-006** | P2 | `PUT /users/me` | Gửi field role, password_hash, email trái quyền, hoặc JSON chưa hỗ trợ. | Không thay đổi trường bảo vệ; xác nhận behavior reject/ignore theo hợp đồng. |
| **USR-007** | P0 | `GET /users/me/settings` | A có settings mặc định; gọi GET. | 200; trả discoverable, email_notifications, theme với kiểu boolean/enum đúng. |
| **USR-008** | P0 | `PUT /users/me/settings` | A cập nhật discoverable=false, email_notifications=false, theme=dark rồi GET. | 200; ba giá trị được lưu và đọc lại đúng. |
| **USR-009** | P1 | `PUT /users/me/settings` | Chỉ cập nhật discoverable; kiểm tra theme và email_notifications không bị reset. | Chỉ cập nhật trường yêu cầu; các giá trị khác giữ nguyên. |
| **USR-010** | P1 | `PUT /users/me/settings` | Thử theme=dark, light, system, chuỗi khác, null và field thiếu. | Ba giá trị hợp lệ thành công; theme ngoài tập/explicit null bị validation; thiếu theme không thay đổi. |
| **USR-011** | P1 | `PUT /users/me/settings` | Thử discoverable/email_notifications dạng string hoặc number thay vì boolean. | Phản hồi theo quy tắc deserialization đã chốt; không vô tình làm thay đổi giá trị sai. |
| **USR-012** | P0 | `POST /users/search` | A tìm B có discoverable=true bằng email đúng. | 200; found=true; user.id/display_name đúng B; không lộ email/password/private settings nếu không được phép. |
| **USR-013** | P0 | `POST /users/search` | Tìm email không tồn tại hoặc tài khoản discoverable=false. | 200; found=false và user=null theo DTO; không tiết lộ tài khoản ẩn. |
| **USR-014** | P1 | `POST /users/search` | Gửi email rỗng, thiếu, sai định dạng. | 400 VALIDATION_ERROR; không trả user. |
| **USR-015** | P1 | `POST /users/search` | Tìm tài khoản đã xóa. | Không trả thông tin tài khoản đã xóa. |
| **USR-016** | P1 | `POST /users/search` | Gửi 11 request liên tiếp bằng cùng tài khoản trong cửa sổ 60 giây. | Theo chính sách 10 lần/phút: lượt vượt ngưỡng trả 429 và Retry-After; kiểm tra reset sau cửa sổ. |
| **USR-017** | P2 | `POST /users/search` | A vượt rate-limit, B tìm kiếm bình thường. | Rate limit tách theo tài khoản; B không bị giới hạn do A. |
| **USR-018** | P0 | `DELETE /users/me` | A cung cấp mật khẩu đúng, sau đó thử GET /users/me và login. | 204; GET/token cũ không còn quyền truy cập; login bằng tài khoản đã xóa bị từ chối. |
| **USR-019** | P1 | `DELETE /users/me` | Thiếu password, rỗng hoặc mật khẩu sai. | Bị từ chối 400/401 theo trường hợp; tài khoản không bị xóa; vẫn đăng nhập được. |
| **USR-020** | P1 | `DELETE /users/me` | A xóa tài khoản, sau đó GET settings/avatar hay search tài khoản A từ B. | Các endpoint xử lý theo chính sách tài khoản đã xóa; không tiết lộ dữ liệu lẽ ra bị ẩn. |

### D. Avatar model và hồ sơ avatar

**Căn cứ:** `avatar/AvatarController.java:30-52; AvatarUpsertRequest.java; AvatarService.java`.

| ID | Ưu tiên | Endpoint | Chuẩn bị / các bước thực hiện | Kết quả mong đợi / tiêu chí PASS |
|---|---|---|---|---|
| **AVA-001** | P0 | `GET /avatars/models` | Gọi không có token. | 200; `models` là danh sách có phần tử; mỗi model có id và metadata phù hợp schema. |
| **AVA-002** | P1 | `GET /avatars/models` | Gọi liên tiếp trước/sau các thao tác avatar của A. | Catalog không bị biến đổi do thao tác user; schema và dữ liệu bất biến theo bản phát hành. |
| **AVA-003** | P0 | `GET /avatars/me` | A vừa đăng ký, chưa lưu avatar. | 404 NOT_FOUND theo AvatarService; không trả profile giả định. |
| **AVA-004** | P0 | `PUT /avatars/me` | A chọn model_id thực sự có trong catalog, customizations hợp lệ. | 201 khi tạo mới; GET /avatars/me đúng model, model_url được backend quản lý, customizations khớp. |
| **AVA-005** | P0 | `PUT /avatars/me` | A đã có avatar, thay sang model hợp lệ khác và GET. | 200 khi cập nhật; cùng profile người dùng, dữ liệu mới được lưu. |
| **AVA-006** | P1 | `PUT /avatars/me` | Thiếu model_id, chuỗi rỗng, model_id không tồn tại. | 400; dữ liệu avatar cũ không thay đổi. |
| **AVA-007** | P1 | `PUT /avatars/me` | Gửi field model_url khác null do client tự đặt. | 400 vì model_url phải null/không gửi; không thể điều khiển URL model từ client. |
| **AVA-008** | P1 | `PUT /avatars/me` | Bỏ customizations hoặc đặt null khi model hợp lệ. | Tạo/cập nhật thành công với customization rỗng theo Service. |
| **AVA-009** | P1 | `PUT /avatars/me` | Customizations có key không được model hỗ trợ. | 400; profile không thay đổi. |
| **AVA-010** | P1 | `PUT /avatars/me` | Chọn outfit không nằm trong tập outfitOptions hoặc gửi outfit sai kiểu. | 400; không lưu outfit trái danh mục. |
| **AVA-011** | P1 | `PUT /avatars/me` | Customizations outfit hợp lệ theo model catalog. | 201/200; GET phản ánh đúng customization. |
| **AVA-012** | P0 | `GET /avatars/{userId}` | A/B có avatar; A lấy avatar công khai của B bằng userId. | 200; chỉ user_id, model_id, model_url, customizations như AvatarPublicResponse, không lộ dữ liệu riêng. |
| **AVA-013** | P1 | `GET /avatars/{userId}` | UUID người dùng không tồn tại hoặc user có thật nhưng chưa tạo avatar. | 404; không tạo avatar mới. |
| **AVA-014** | P1 | `GET /avatars/{userId}` | B đã soft-delete; A yêu cầu avatar cũ của B. | 404 theo Service; không lộ avatar profile của user đã xóa. |

### E. Conversation API: khởi tạo, truy vấn, phân trang

**Căn cứ:** `messaging/ConversationController.java:31-61; ConversationService.java`.

| ID | Ưu tiên | Endpoint | Chuẩn bị / các bước thực hiện | Kết quả mong đợi / tiêu chí PASS |
|---|---|---|---|---|
| **CON-001** | P0 | `POST /conversations` | A và B đều active; A gửi other_user_id của B. | 201; id UUID, other_user.id là B; GET detail bằng A và B đúng hội thoại. |
| **CON-002** | P0 | `POST /conversations` | A tạo lại hội thoại với B đã tồn tại. | 200; ID hội thoại giữ nguyên; không tạo thêm bản ghi trùng. |
| **CON-003** | P1 | `POST /conversations` | B tạo lại hội thoại với A theo chiều ngược. | Trả cùng ID hội thoại, không tạo hội thoại thứ hai. |
| **CON-004** | P1 | `POST /conversations` | A đặt other_user_id bằng chính A. | 400 VALIDATION_ERROR; không tạo hội thoại với bản thân. |
| **CON-005** | P1 | `POST /conversations` | Thiếu other_user_id, null, UUID sai cú pháp. | 400; không tạo dữ liệu. |
| **CON-006** | P1 | `POST /conversations` | Dùng UUID người dùng không tồn tại hoặc đã xóa. | 404; không tạo hội thoại mới. |
| **CON-007** | P0 | `GET /conversations` | A chưa có hội thoại. | 200; data=[], has_more=false, next_cursor=null. |
| **CON-008** | P0 | `GET /conversations` | A có nhiều hội thoại, một vài hội thoại có tin nhắn cuối. | 200; chỉ hội thoại của A, other_user/last_message/updated_at đúng, schema hợp lệ. |
| **CON-009** | P1 | `GET /conversations` | Đặt limit=1 và có >1 hội thoại, dùng next_cursor để lấy trang tiếp. | Mỗi trang đúng số phần tử, không trùng/thiếu ID, kết thúc với has_more=false. |
| **CON-010** | P1 | `GET /conversations` | Đặt limit=1, limit=50 và không truyền limit. | Đúng giới hạn/số trang; mặc định limit=20; biên 1/50 được chấp nhận. |
| **CON-011** | P1 | `GET /conversations` | Đặt limit=0, -1, 51, abc, 1.5 hoặc chuỗi rỗng. | Giá trị sai trả 400 VALIDATION_ERROR; limit rỗng dùng mặc định 20 như khi bỏ tham số. |
| **CON-012** | P1 | `GET /conversations` | Dùng cursor ngẫu nhiên/sai format/bị sửa đổi. | 400 nếu codec quy định lỗi validation; xác nhận trực tiếp quy tắc mã và error body trên phiên bản chạy. |
| **CON-013** | P2 | `GET /conversations` | Nhiều hội thoại có updated_at trùng nhau. | Phân trang thứ tự ổn định theo khóa phụ UUID; không rơi/trùng hội thoại. |
| **CON-014** | P0 | `GET /conversations/{id}` | A/B là thành viên hội thoại hợp lệ. | 200; id, other_user, last_message, created_at/updated_at đúng. |
| **CON-015** | P0 | `GET /conversations/{id}` | C không phải thành viên, dùng id hội thoại A-B. | 403 FORBIDDEN; không trả bất kỳ nội dung hội thoại. |
| **CON-016** | P1 | `GET /conversations/{id}` | Dùng ID hội thoại không tồn tại hoặc UUID sai cú pháp. | 404 cho ID hợp lệ không tồn tại; yêu cầu sai format lỗi client theo Spring. |
| **CON-017** | P1 | `GET /conversations` | Có hai user A/B với tập hội thoại khác nhau; lấy danh sách đồng thời. | A chỉ thấy hội thoại có A; B chỉ thấy hội thoại có B; không rò chéo dữ liệu. |

### F. Message API: tạo mới, idempotency, lịch sử, trạng thái

**Căn cứ:** `messaging/ConversationController.java:63-101; CreateMessageRequest.java; MessageService.java`.

| ID | Ưu tiên | Endpoint | Chuẩn bị / các bước thực hiện | Kết quả mong đợi / tiêu chí PASS |
|---|---|---|---|---|
| **MSG-001** | P0 | `POST /conversations/{id}/messages` | A/B có hội thoại; A gửi UUID mới, content và timestamp hiện tại. | 201; response có id, conversation_id, sender_id, content, status, timestamps hợp lệ; lịch sử ghi đúng một bản ghi. |
| **MSG-002** | P0 | `POST /conversations/{id}/messages` | Gửi lại chính body với ID đã được A tạo trong đúng hội thoại. | 200; response đại diện cùng tin nhắn; lịch sử vẫn một bản ghi; không xem như tin nhắn mới. |
| **MSG-003** | P0 | `POST /conversations/{id}/messages` | B hoặc user khác dùng cùng message ID đã được A tạo; gửi vào hội thoại liên quan. | 409 CONFLICT nếu ID thuộc sender khác; không tạo hoặc sửa bản ghi của A. |
| **MSG-004** | P0 | `POST /conversations/{id}/messages` | A dùng message ID đã nằm ở hội thoại khác. | 409 CONFLICT nếu phạm vi hội thoại không khớp; bản ghi cũ không bị ghi đè. |
| **MSG-005** | P1 | `POST /conversations/{id}/messages` | Thiếu id, id=null, id không phải UUID. | 400; không ghi tin. |
| **MSG-006** | P1 | `POST /conversations/{id}/messages` | content thiếu, null, rỗng, toàn khoảng trắng. | 400 VALIDATION_ERROR; không ghi tin. |
| **MSG-007** | P1 | `POST /conversations/{id}/messages` | content đúng 4000 ký tự và 4001 ký tự. | 4000 được nhận, 4001 bị 400; đảm bảo kiểm tra cả ký tự Unicode và quy tắc đếm ký tự Java. |
| **MSG-008** | P1 | `POST /conversations/{id}/messages` | content tiếng Việt, emoji, dấu nháy, xuống dòng ở độ dài hợp lệ. | 201; response và lịch sử giữ nguyên nội dung UTF-8/Unicode. |
| **MSG-009** | P1 | `POST /conversations/{id}/messages` | Thiếu client_timestamp, timestamp sai định dạng. | 400; không tạo tin mới. |
| **MSG-010** | P1 | `POST /conversations/{id}/messages` | Timestamp hiện tại, -4m59s, +4m59s, -6m, +6m. | Trong cửa sổ ±5 phút được chấp nhận; ngoài cửa sổ 400; tránh assertion sát đúng 5 phút vì clock skew. |
| **MSG-011** | P0 | `POST /conversations/{id}/messages` | C không thuộc hội thoại A-B, thử gửi tin. | 403; DB không thêm tin. |
| **MSG-012** | P1 | `POST /conversations/{id}/messages` | ID hội thoại không tồn tại hoặc UUID sai định dạng. | 404 khi không tồn tại; lỗi client cho ID sai cú pháp; không thêm tin. |
| **MSG-013** | P1 | `POST /conversations/{id}/messages` | Cùng UUID hợp lệ nhưng nội dung khác, cùng A và cùng hội thoại. | Theo scope-idempotency hiện tại trả 200 với bản gốc, không ghi đè; ghi nhận rõ nội dung yêu cầu mới không được lưu. |
| **MSG-014** | P0 | `GET /conversations/{id}/messages` | A/B có 0 tin nhắn. | 200, data=[], prev_cursor=null, has_more=false. |
| **MSG-015** | P0 | `GET /conversations/{id}/messages` | Hội thoại có >30 tin với timestamp được kiểm soát; không gửi limit. | 200; mặc định limit 30, lấy trang gần nhất; data đúng schema. |
| **MSG-016** | P1 | `GET /conversations/{id}/messages` | Có >100 tin; thử limit=1, 100 rồi duyệt prev_cursor đến hết. | Đúng giới hạn/trang, không trùng/lọt tin; mỗi trang sắp xếp thứ tự client_timestamp theo quy tắc API. |
| **MSG-017** | P1 | `GET /conversations/{id}/messages` | limit=0, -1, 101, abc, số thập phân. | 400 VALIDATION_ERROR. |
| **MSG-018** | P1 | `GET /conversations/{id}/messages` | Cursor sai định dạng hoặc bị chỉnh một byte. | Bị từ chối bằng lỗi client đúng hợp đồng, không gây 500; mã cụ thể đối chiếu codec/contract. |
| **MSG-019** | P1 | `GET /conversations/{id}/messages` | Nhiều tin có cùng client_timestamp, phân trang với limit nhỏ. | Không lặp hoặc bỏ sót tin; UUID làm khóa phân biệt thứ tự. |
| **MSG-020** | P0 | `GET /conversations/{id}/messages` | C không thuộc hội thoại, dùng ID thật của A-B. | 403; không tiết lộ message content, người gửi hay timestamps. |
| **MSG-021** | P0 | `PUT /conversations/{id}/messages/{messageId}` | B là người nhận tin chưa đọc; cập nhật status=delivered. | 200; response có id/status/updated_at; GET lịch sử và DB thể hiện delivered. |
| **MSG-022** | P0 | `PUT /conversations/{id}/messages/{messageId}` | B nâng trạng thái delivered→read. | 200; response/read history phản ánh read. |
| **MSG-023** | P1 | `PUT /conversations/{id}/messages/{messageId}` | B cập nhật lại cùng status đã có. | 200; trạng thái không thay đổi và không có tác động phụ bất thường. |
| **MSG-024** | P1 | `PUT /conversations/{id}/messages/{messageId}` | B cố giảm read→delivered. | 400 VALIDATION_ERROR; DB vẫn read. |
| **MSG-025** | P1 | `PUT /conversations/{id}/messages/{messageId}` | status thiếu, null, delivered/read và một giá trị khác. | delivered/read được hỗ trợ; thiếu/sai trạng thái bị 400. |
| **MSG-026** | P0 | `PUT /conversations/{id}/messages/{messageId}` | Chính A (người gửi) cố đổi trạng thái tin của mình. | 403; không sửa trạng thái. |
| **MSG-027** | P1 | `PUT /conversations/{id}/messages/{messageId}` | C không thuộc hội thoại cố thay đổi trạng thái. | 403; trạng thái gốc giữ nguyên. |
| **MSG-028** | P1 | `PUT /conversations/{id}/messages/{messageId}` | Dùng messageId hợp lệ nhưng thuộc hội thoại khác. | 404 hoặc 403 theo thứ tự kiểm tra quyền; không sửa bản ghi khác; chốt mã theo source hiện hành. |
| **MSG-029** | P1 | `PUT /conversations/{id}/messages/{messageId}` | Message ID không tồn tại, conversation ID hợp lệ. | 404 NOT_FOUND; không sửa tin khác. |

### G. Video APIs và hợp đồng multipart

**Căn cứ:** `video/VideoController.java:28-101; CreateVideoRequest.java; FinalizeVideoRequest.java; VideoService.java`.

| ID | Ưu tiên | Endpoint | Chuẩn bị / các bước thực hiện | Kết quả mong đợi / tiêu chí PASS |
|---|---|---|---|---|
| **VID-001** | P0 | `GET /videos` | A chưa có video. | 200; data=[], storage_used_bytes và storage_limit_bytes hợp lệ, has_more=false, next_cursor=null. |
| **VID-002** | P0 | `GET /videos` | A có video recording/processing/ready; B có video khác. | 200; chỉ video của A, mỗi summary đúng schema; storage_used_bytes tính theo video ready chưa xóa. |
| **VID-003** | P1 | `GET /videos` | Dùng status hợp lệ theo VideoStatus, rồi status không hợp lệ. | Filter đúng tập trạng thái; giá trị sai được từ chối theo hợp đồng, không xảy ra 500. |
| **VID-004** | P1 | `GET /videos` | limit=1,20,50,0,-1,51; tạo >50 video test. | Đúng phân trang; source hiện clamp limit vào 1..50 thay vì 400 cho 0/51 — test theo chính sách đã chốt, không tự gán 400. |
| **VID-005** | P1 | `GET /videos` | Cursor trả về từ trang trước, duyệt hết video. | Không trùng/bỏ sót; next_cursor null ở trang cuối; has_more chính xác. |
| **VID-006** | P1 | `GET /videos` | Cursor sai cấu trúc, UUID/timestamp không hợp lệ trong cursor. | Lỗi client đúng hợp đồng; không trả trang khác hoặc 500. |
| **VID-007** | P0 | `GET /videos/{id}` | A lấy video của chính A đang recording. | 200; metadata đúng, view_url=null khi chưa ready. |
| **VID-008** | P0 | `GET /videos/{id}` | A lấy video của chính A đã ready. | 200; view_url là presigned URL hợp lệ, tải đúng object tương ứng. |
| **VID-009** | P0 | `GET /videos/{id}` | B truy cập video thuộc A. | 403 FORBIDDEN như hợp đồng E2E đã kiểm chứng; không tiết lộ view_url. |
| **VID-010** | P1 | `GET /videos/{id}` | A gọi video đã soft-delete hoặc video ID không tồn tại. | 404 NOT_FOUND. |
| **VID-011** | P0 | `PUT /videos/{id}` | A đổi tên video của mình đang ready hoặc recording. | 200; title đúng response và GET đọc lại; status/file không đổi. |
| **VID-012** | P1 | `PUT /videos/{id}` | Thiếu title, title rỗng, dài 255 ký tự, dài 256 ký tự. | Sai/rỗng/>255 bị 400; đúng 255 hợp lệ. |
| **VID-013** | P1 | `PUT /videos/{id}` | B cố đổi tên video của A. | 403; title cũ không bị thay đổi. |
| **VID-014** | P1 | `PUT /videos/{id}` | Đổi tên video đã xóa / UUID không tồn tại. | 404; không tạo mới video. |
| **VID-015** | P0 | `DELETE /videos/{id}` | A xóa video ready của A. | 204; GET video 404; GET danh sách không còn video; storage_used_bytes giảm đúng. |
| **VID-016** | P1 | `DELETE /videos/{id}` | B cố xóa video của A. | 403; video A vẫn tồn tại và truy cập được. |
| **VID-017** | P1 | `DELETE /videos/{id}` | Xóa lại cùng ID hoặc ID không tồn tại. | 404 theo requireOwnedVisible trong source; không ảnh hưởng video khác. |
| **VID-018** | P0 | `POST /videos` | A đủ quota, title/estimated_size_bytes/chunk_size_bytes hợp lệ. | 201; id, title, status=recording, upload_id, first_chunk_url, part_number=1 đúng kiểu; phiên test tồn tại và cần cleanup. |
| **VID-019** | P1 | `POST /videos` | title thiếu/rỗng hoặc 256 ký tự; 255 ký tự. | Sai bị 400, 255 ký tự hợp lệ; không tạo phiên mồ côi cho input bị từ chối tại DTO. |
| **VID-020** | P1 | `POST /videos` | estimated_size_bytes thiếu, null, 0, số âm, 1. | Giá trị thiếu/<=0 bị 400, 1 hợp lệ ở mức validation (còn phụ thuộc quota). |
| **VID-021** | P1 | `POST /videos` | chunk_size_bytes thiếu, nhỏ hơn 5.242.880, bằng đúng 5.242.880. | Thiếu/nhỏ bị 400; đúng biên được chấp nhận. |
| **VID-022** | P1 | `POST /videos` | format null/trống, dài 10, dài 11 ký tự. | Trống/null được thay mặc định mp4 theo Service; dài >10 bị 400. Kiểm tra rủi ro format có dấu chấm/gạch chéo theo hợp đồng an toàn còn thiếu. |
| **VID-023** | P0 | `POST /videos` | A có storage_used gần limit, yêu cầu estimated_size_bytes làm vượt quota. | 507 STORAGE_QUOTA_EXCEEDED; không tạo upload có thể sử dụng. |
| **VID-024** | P0 | `POST /videos/{id}/chunks` | A đã PUT part 1 thành công, có đúng ETag; xin part_number=2. | 200; chunk_url, part_number=2, expires_in hợp lệ; URL dùng được với MinIO. |
| **VID-025** | P1 | `POST /videos/{id}/chunks` | Thiếu upload_id/part_number/etag_previous; part_number=1. | 400; không cấp URL cho part sai. |
| **VID-026** | P1 | `POST /videos/{id}/chunks` | Dùng upload_id ngẫu nhiên; xin lại cùng part với ETag khác ETag đã ghi nhận; xin nhảy part từ 1 lên 3. | Bị từ chối theo nhánh 400/404 hiện có; ETag lần đầu được đối chiếu MinIO tại finalize, không phải lúc cấp URL tiếp theo. |
| **VID-027** | P1 | `POST /videos/{id}/chunks` | A yêu cầu cấp lại URL cho part hiện đang được phép (retry). | Kết quả theo quy tắc idempotency của Redis session; không làm mất thông tin ETag/part khác. |
| **VID-028** | P1 | `POST /videos/{id}/chunks` | B dùng token B để xin chunk của video A. | 403; không cấp presigned URL. |
| **VID-029** | P0 | `POST /videos/{id}/finalize` | A upload hai part thật, gửi upload_id, duration_secs và mảng parts/ETag đúng. | 202; status=processing; webhook sau đó có thể đổi sang ready. Phần 202 thuộc T04, luồng webhook thuộc T05. |
| **VID-030** | P1 | `POST /videos/{id}/finalize` | parts rỗng, thiếu, có null, >10.000 phần; duration_secs=0. | 400 theo Bean Validation; không chuyển sang processing. |
| **VID-031** | P1 | `POST /videos/{id}/finalize` | parts trùng part_number, sai thứ tự, nhảy số part. | 400 VALIDATION_ERROR; dữ liệu phiên không bị hỏng. |
| **VID-032** | P1 | `POST /videos/{id}/finalize` | ETag thiếu/trống, không khớp Redis hoặc MinIO. | 400; không đánh dấu ready sai. |
| **VID-033** | P1 | `POST /videos/{id}/finalize` | upload_id sai hoặc phiên hết hạn. | Bị từ chối theo trạng thái (404/409 tùy nhánh); không complete nhầm multipart. |
| **VID-034** | P0 | `POST /videos/{id}/finalize` | B dùng token B finalize video A. | 403; không điều khiển multipart của A. |
| **VID-035** | P1 | `POST /videos/{id}/finalize` | Finalize lại khi video đã processing/ready. | Không complete lần hai trái hợp đồng; phản hồi lỗi/giữ nguyên theo state machine đã chốt. |
| **VID-036** | P0 | `POST /videos/{id}/abort` | A có video recording và upload_id đúng. | 204; phiên không còn hợp lệ, GET không trả video chưa hoàn tất, URL cũ không được tiếp tục PUT vào multipart đã abort. |
| **VID-037** | P1 | `POST /videos/{id}/abort` | Thiếu upload_id, upload_id sai, phiên không tồn tại/hết hạn. | 400/404 theo trường hợp; không abort video khác. |
| **VID-038** | P0 | `POST /videos/{id}/abort` | B dùng token B abort video của A. | 403; session của A vẫn còn hợp lệ. |
| **VID-039** | P1 | `POST /videos/{id}/abort` | Abort lại hoặc abort video đã processing/ready. | Trả lỗi trạng thái phù hợp 404/409 theo source; không xóa file ready. |
| **VID-040** | P1 | `GET /videos/{id}` | Chuẩn bị video status=failed bằng fixture hợp lệ. | 200; file_size_bytes=0, view_url=null theo VideoService; title/status/format hợp lệ. |

### H. Endpoint nội bộ: thông báo cuộc gọi và webhook MinIO

**Căn cứ:** `call/CallNotifyController.java; CallNotifyAuthenticationFilter.java; video/VideoWebhookController.java; VideoWebhookAuthenticationFilter.java; VideoWebhookService.java`.

| ID | Ưu tiên | Endpoint | Chuẩn bị / các bước thực hiện | Kết quả mong đợi / tiêu chí PASS |
|---|---|---|---|---|
| **INT-001** | P0 | `POST /internal/call/notify` | Không gửi Bearer secret nội bộ. | 401; không publish CALL_INCOMING. |
| **INT-002** | P0 | `POST /internal/call/notify` | Gửi secret sai hoặc Bearer token JWT của người dùng thường. | 401; không publish. |
| **INT-003** | P0 | `POST /internal/call/notify` | Có secret nội bộ đúng; caller_id và callee_id là hai user active; call_id UUID của lần gọi. | 204; CALL_INCOMING mang cùng call_id. |
| **INT-004** | P1 | `POST /internal/call/notify` | caller/callee UUID hợp lệ nhưng không tồn tại/đã xóa. | 404; không phát thông báo sai. |
| **INT-005** | P1 | `POST /internal/call/notify` | Thiếu caller_id, callee_id hoặc call_id; null, sai kiểu. | Lỗi client rõ, không 500/NPE hoặc side-effect sai. |
| **INT-006** | P0 | `POST /internal/videos/webhook` | Không có secret hoặc secret sai. | 401; video không đổi trạng thái. |
| **INT-007** | P0 | `POST /internal/videos/webhook` | Có secret đúng và payload sự kiện MinIO hợp lệ ứng với upload thực. | 204; webhook được tiếp nhận; trạng thái video cập nhật theo quy tắc xử lý. |
| **INT-008** | P1 | `POST /internal/videos/webhook` | Records rỗng/null, object key sai định dạng, thiếu dữ liệu thiết yếu. | 400 VALIDATION_ERROR theo VideoWebhookService; không cập nhật dữ liệu. |
| **INT-009** | P1 | `POST /internal/videos/webhook` | Secret đúng nhưng eventName hoặc bucket không được hỗ trợ. | Được bỏ qua an toàn theo Service; không thay đổi video sai; response cụ thể theo controller. |
| **INT-010** | P1 | `POST /internal/videos/webhook` | Gửi một webhook hợp lệ hai lần. | Idempotency: không tạo trạng thái sai, không tính quota hai lần; đây là kiểm tra contract tích hợp. |
| **INT-011** | P1 | `/internal/**` | Gọi các endpoint nội bộ từ client thường dù SecurityConfig có permitAll cho path. | Filter riêng vẫn ngăn truy cập không có secret; không được hiểu permitAll là miễn xác thực. |

### I. Client metrics/telemetry

**Căn cứ:** `metrics/MetricsController.java:24-35; MetricsClientRequest.java; MetricsService.java`.

| ID | Ưu tiên | Endpoint | Chuẩn bị / các bước thực hiện | Kết quả mong đợi / tiêu chí PASS |
|---|---|---|---|---|
| **MET-001** | P0 | `POST /metrics/client` | JWT hợp lệ; session_type=preview, fps=30, tracking_latency_ms=12, timestamp ISO 8601. | 204 không body; dữ liệu được chấp nhận. |
| **MET-002** | P1 | `POST /metrics/client` | session_type=call, thêm webrtc_rtt_ms hợp lệ. | 204; endpoint chấp nhận nhóm session call. |
| **MET-003** | P1 | `POST /metrics/client` | session_type thiếu/rỗng/khác preview hoặc call. | 400 VALIDATION_ERROR. |
| **MET-004** | P1 | `POST /metrics/client` | timestamp thiếu, rỗng, không parse ISO 8601. | 400; endpoint không ghi log metric hợp lệ. |
| **MET-005** | P1 | `POST /metrics/client` | Gửi lần hai trong 3 giây bằng cùng tài khoản. | 429 và Retry-After; không bị ghi nhận như metrics được chấp nhận. |
| **MET-006** | P1 | `POST /metrics/client` | Sau cửa sổ giới hạn, gửi lại payload hợp lệ. | 204; rate limiter phục hồi theo thời gian. |
| **MET-007** | P2 | `POST /metrics/client` | A bị giới hạn, B gửi một yêu cầu riêng. | B không bị rate-limit bởi A. |
| **MET-008** | P2 | `POST /metrics/client` | Dùng các kiểu không tương thích với Integer/Double cho metrics. | Không làm server crash; có phản hồi lỗi client hoặc quy tắc ép kiểu được ghi rõ. |
| **MET-009** | P2 | `POST /metrics/client` | Gửi giá trị âm, cực lớn, NaN/Infinity dưới dạng không hợp lệ nếu JSON không hỗ trợ. | Đối chiếu hợp đồng: DTO chưa có ngưỡng cho fps/latency; xác định có cần chặn giá trị vô lý, không tự giả định 400. |

### J. WebSocket messaging và Node signaling — hợp đồng giao thức bổ trợ T04

**Căn cứ:** `messaging/MessagingWebSocketConfig.java; MessagingWebSocketHandler.java; báo cáo E2E 2026-10-19; source signaling chưa có trong ZIP`.

| ID | Ưu tiên | Endpoint | Chuẩn bị / các bước thực hiện | Kết quả mong đợi / tiêu chí PASS |
|---|---|---|---|---|
| **WSC-001** | P0 | `WS /ws/messaging` | Kết nối bằng JWT user active đúng định dạng query token. | Handshake thành công; socket được gắn đúng user, không nhận sự kiện của user khác. |
| **WSC-002** | P0 | `WS /ws/messaging` | Thiếu token, token sai chữ ký, token đã thu hồi. | Không tạo phiên messaging hợp lệ; mã handshake/close tùy định nghĩa protocol hiện hành. |
| **WSC-003** | P1 | `WS /ws/messaging` | Gửi frame JSON PONG đáp lại PING từ backend. | Socket duy trì kết nối theo quy tắc heartbeat. |
| **WSC-004** | P1 | `WS /ws/messaging` | Gửi TYPING đúng conversation_id của hội thoại A-B. | Backend phản ánh sự kiện hợp lệ đến người nhận theo contract messaging. |
| **WSC-005** | P1 | `WS /ws/messaging` | Gửi TYPING_STOP đúng conversation_id. | Người nhận nhận sự kiện dừng gõ đúng định dạng. |
| **WSC-006** | P1 | `WS /ws/messaging` | Gửi event type lạ, thiếu type, data sai kiểu hoặc JSON lỗi. | Server xử lý an toàn theo contract, không crash hay phát sang người lạ; mã lỗi/close cần chốt. |
| **WSC-007** | P1 | `WS /ws/messaging` | A/B mở nhiều tab; kiểm tra NEW_MESSAGE và MESSAGE_STATUS_UPDATE JSON schema. | Tên type, data, trường id/status/timestamps đúng; cùng user nhận đúng mọi socket theo quy tắc. |
| **WSC-008** | P1 | `WS /ws/messaging` | C ngoài hội thoại gửi TYPING theo conversation_id của A-B. | Không được phát sự kiện gõ trái quyền cho A/B. |
| **WSC-009** | P2 | `WS /ws/messaging` | Gửi frame có kích thước vượt cấu hình tối đa. | Bị từ chối/đóng theo quy tắc message-size; không treo server. |
| **SIG-001** | P0 | `WS /ws/signaling` | A/B có token hợp lệ, mở signaling. | Handshake/ack hoặc open đúng protocol; trạng thái phiên gắn đúng user. |
| **SIG-002** | P0 | `WS /ws/signaling` | Không có JWT, JWT sai, JWT đã logout. | Không thiết lập phiên signaling có quyền; cần quyết định phản hồi handshake hay close 4001 theo protocol. |
| **SIG-003** | P0 | `WS /ws/signaling` | A gửi CALL_OFFER khi B đã mở signaling. | B nhận CALL_OFFER có sender/target/data hợp lệ; A/B không nhận payload sai user. |
| **SIG-004** | P0 | `WS /ws/signaling` | B chỉ mở messaging, nhận CALL_INCOMING rồi mới mở signaling. | Offer vẫn được chuyển hoặc luồng tiếp nhận khác theo hợp đồng; hiện E09 FAIL, cần điều chỉnh sản phẩm/hợp đồng. |
| **SIG-005** | P1 | `WS /ws/signaling` | B gửi CALL_ANSWER, A gửi ICE_CANDIDATE, CALL_END theo trạng thái hợp lệ. | Mọi event có type, from_user_id, target_user_id và data đúng schema; đến đúng bên. |
| **SIG-006** | P1 | `WS /ws/signaling` | Gửi type sai, thiếu target_user_id, payload sai định dạng. | Không phá vỡ state machine; error frame và close behavior theo hợp đồng. |
| **SIG-007** | P1 | `WS /ws/signaling` | Gửi CALL_ANSWER/ICE/END khi không có phiên cuộc gọi hợp lệ. | Không relay trái phiên; lỗi giao thức có mã rõ. |
| **SIG-008** | P1 | `WS /ws/signaling` | Gửi CALL_REJECT cho offer chờ. | A nhận sự kiện từ chối; trạng thái được cập nhật đúng contract. |
| **SIG-009** | P1 | `WS /ws/signaling` | Chờ quá timeout phản hồi offer. | Phiên chờ bị hết hạn; sự kiện timeout/error theo contract. |

## 6. Ma trận áp dụng tham số hóa bắt buộc (không cộng vào số ID)

1. **Authorization matrix:** Với mọi endpoint private trong danh mục, kiểm tra thiếu token, token sai chữ ký, sai loại, đã bị thu hồi, token người khác khi liên quan object-level authorization. Không gộp kết quả nhiều endpoint vào một trường hợp PASS.
2. **Malformed-body matrix:** Mỗi endpoint nhận JSON chạy tối thiểu 3 lỗi JSON không hợp lệ, Content-Type không hợp lệ, thiếu field bắt buộc; cùng một lỗi DTO cần có field-assertion cụ thể.
3. **Boundary matrix:** Với mọi `@NotBlank`, `@Size`, `@Min`, `@Positive`, `@Pattern` đã xác định, kiểm tra biên dưới, đúng biên và trên biên; phân biệt nullable field và omitted field.
4. **Pagination matrix:** Danh sách conversations, messages, videos đều kiểm tra trang rỗng, một trang, hai trang, cursor cuối, limit biên, timestamp đồng hạng, nội dung được thêm giữa các lần lấy trang (hành vi động cần chốt).
5. **State matrix:** Video recording→processing→ready/failed/abort; message sent→delivered→read; conversation create→get; avatar create→update. Chạy hành động hợp lệ và không hợp lệ theo trạng thái.
6. **Data-isolation matrix:** Với object có owner hoặc thành viên (conversation, message, video, avatar private), chạy A/B/C đúng và sai quyền. Không đánh đồng 403 với 404 khi hợp đồng đã phân biệt hai mã.

## 7. Các điểm cần chốt từ source bản mới/`docs/04_API.md`

- Cơ chế chuẩn hóa email (trim, lowercase, uniqueness) và quy tắc unknown JSON fields.
- Mã lỗi cho cursor lỗi và UUID path sai định dạng từ Spring MVC.
- Các value có thể dùng cho `VideoStatus`, trạng thái sau finalize thất bại, chính sách retry/abort.
- Policy video format: MIME, extension, chống path traversal, có validate codec hay không.
- HTTP 401/403/404 khi token đã thu hồi hoặc tài khoản đã xóa trên mọi endpoint.
- Quy định chính xác WebSocket handshake, close code, schema event và error event của Node signaling phiên bản 19/10.
- Signaling E09/E10 vẫn FAIL ở báo cáo 19/10: tuyệt đối không đổi kỳ vọng để hợp thức hóa hành vi sai.
- Spring config cho CORS, parser/unknown-field, Hikari, rate limiter; cách trả lỗi cho JSON sai kiểu.
- Tính sẵn sàng của `GET /actuator/health` ở runtime không đủ suy ra trạng thái sẵn sàng của toàn bộ dịch vụ.

## 8. Quy tắc triển khai chung cho người tự viết test

**Thứ tự khuyến nghị:** COM → AUTH → USR → AVA → CON → MSG → MET → VID → INT → WSC/SIG. Bắt đầu bằng case P0 của một nhóm, hoàn thành P1, rồi P2. Giữ từng test độc lập và tạo mới dữ liệu để tránh phụ thuộc thứ tự chạy. Dọn mọi phiên upload test. Mỗi case log: ID, timestamp, build commit, request method/path, kết quả status/schema, trạng thái database khi cần, PASS/FAIL/BLOCKED; không log token, secret hoặc signed URL đầy đủ.

**Không nên coi bao phủ xong T04 nếu:** còn endpoint không được liệt kê, response schema chưa được kiểm tra, có FAIL P0 chưa xử lý, bài test phụ thuộc dữ liệu production, hoặc bộ test chưa đối chiếu với phiên bản code mới nhất.
