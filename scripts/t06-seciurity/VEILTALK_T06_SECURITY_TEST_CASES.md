# VEILTALK — T06: SECURITY TESTING — MASTER TEST CASE SPECIFICATION

> **Bản đặc tả kịch bản kiểm thử bảo mật, KHÔNG phải code và KHÔNG phải báo cáo PASS.** Tài liệu dành cho chủ dự án tự triển khai kiểm thử trên môi trường do mình kiểm soát. Không thay đổi source backend/signaling, không chạy thử nghiệm mạng và không động tới production trong quá trình soạn tài liệu.
>
> **Phiên bản:** 1.0 • **Ngày soạn:** 19/10/2026 • **Trạng thái:** PROPOSED / NOT RUN. **Nguồn:** ZIP Java VeilTalk (snapshot cũ), `backend.test.cjs` và báo cáo E2E 19/10/2026, khảo sát code Codex, T04/T05 hiện có. Tên endpoint và assertions liên quan Node signaling/Nginx cần đối chiếu với source runtime mới nhất trước khi khóa test.

## I. Tuyên bố phạm vi, chứng cứ và tư duy bảo mật

**Mục đích:** kiểm tra rằng một người dùng hoặc tác nhân thiếu quyền **không thể** (a) mạo danh chủ tài khoản, (b) truy cập/sửa dữ liệu người khác, (c) can thiệp signaling/WebSocket, (d) chiếm quyền upload hoặc webhook, (e) đánh cắp bí mật qua lỗi và log, (f) lợi dụng cấu hình hoặc giới hạn tài nguyên để vượt chính sách. **Security Test không chứng minh an toàn tuyệt đối**; nó cung cấp bằng chứng về các kiểm soát đã kiểm chứng trong phạm vi và phiên bản xác định.

**Khác với T04/T05:** T04 xác minh input/output theo hợp đồng từng API, T05 xác minh hành trình nghiệp vụ hợp lệ xuyên nhiều dịch vụ; **T06 cố ý đóng vai người không được phép**, kiểm tra chính sách truy cập và tác dụng phụ sau hành động bị từ chối, bao gồm những chỗ hợp đồng API không đề cập. Một case T06 có thể tái sử dụng fixture/helper hoặc test hiện có, nhưng bổ sung oracle an ninh: *không đổi DB, không gửi sự kiện, không lộ object/link và không cho phép quyền tồn tại sau thu hồi*. T07 kiểm tra lỗi hạ tầng/khả năng phục hồi và tranh chấp ở chiều sâu, T08 dành cho kiểm thử tải.

**Giới hạn bằng chứng:** gói source Java có dấu thời gian trước lần kiểm thử E2E 19/10; chưa có đầy đủ `signaling/src`, `scripts/e2e/run.cjs`, `docs/04_API.md`, `pom.xml`, `application.yml` runtime, migrations, Nginx/TLS và CI từ phiên bản mới nhất. Những kỳ vọng liên quan các phần này mang trạng thái **NEEDS_CONFIRMATION** đến khi có nguồn mới. Hai lỗi lịch sử đã báo cáo: **E09 mất CALL_OFFER khi B mở signaling sau notify**, **E10 signaling nhận access token đã logout**. E09 chủ yếu là lỗi nghiệp vụ với nguy cơ bảo mật nếu thiết kế pending offer sai; E10 là khoảng trống an ninh đã quan sát.

### I.1. Nguyên tắc thiết kế test

1. **Ưu tiên đúng hành vi hơn mã HTTP cố định.** Với thiếu/xác thực sai thường đòi từ chối 401; với đối tượng khác chủ có thể là 403 hoặc 404 tùy hợp đồng; với signaling có thể từ chối lúc HTTP Upgrade hoặc đóng WS sau handshake. Không FAIL chỉ vì cách từ chối khác nếu hợp đồng chấp nhận, nhưng phải chứng minh không có hành động trái phép.
2. **Kiểm tra tác dụng phụ âm tính.** Khi request bị từ chối, so sánh row counts, owner, status, quota, Redis key, MinIO part/object, WebSocket event trước/sau. 401/403 đi kèm side effect vẫn là lỗi bảo mật.
3. **Fixture riêng và kết nối thật.** A = owner, B = participant, C = outsider, D = deleted/disabled, S = service principal nội bộ. Tạo các tài khoản bằng API thật; dùng token riêng từng trường hợp; không chia sẻ token ra báo cáo.
4. **Đo đúng thứ tự và thời gian.** Dùng correlation id, timestamp phía server, polling có timeout, kiểm tra các cửa sổ âm tính có giới hạn. Không kết luận “không bao giờ xảy ra” chỉ vì không thấy event trong 1 giây.
5. **An toàn môi trường.** Chỉ chạy trên containers/bucket/test database cô lập, có snapshot, timeout, rate limit cho chính công cụ test. Không áp dụng tấn công làm cạn kiệt tài nguyên hoặc scan công khai khi chưa có phạm vi kiểm thử được phép.
6. **Không biến thiếu yêu cầu thành PASS.** Nếu rate-limit login, mã đóng socket, retention log, chính sách sở hữu avatar, quyền đọc video chưa chốt thì phân loại NEEDS_CONTRACT hoặc SECURITY_GAP, không suy diễn dữ liệu từ Java snapshot.
7. **Không sửa assertion để làm test xanh.** Nếu sản phẩm thay đổi yêu cầu thì ghi quyết định và rationale riêng; với lỗi đã biết, tạo regression test để giữ hành vi mong muốn.

### I.2. Hệ thống nguồn dùng để thiết kế

| Nguồn | Điều đã biết | Tình trạng |
|---|---|---|
| `SecurityConfig.java` | SecurityFilterChain stateless, CORS allowlist cấu hình, một số public path và filter đặc biệt cho internal | Xác minh trên Java snapshot |
| `JwtService.java`, `AuthService.java` | HS256, access/refresh, BCrypt, hash refresh token, JWT blacklist logout | Xác minh trên Java snapshot |
| `WebSocketAuthHandshakeInterceptor.java` | Messaging WS kiểm tra JWT/blacklist/user active; token truyền query | Xác minh trên Java snapshot |
| `MessageService.java`, `ConversationService.java` | Chủ sở hữu hội thoại/tin nhắn, gửi tin + afterCommit, cursor | Xác minh trên Java snapshot |
| `VideoService.java`, `VideoWebhookAuthenticationFilter.java` | Multipart/MinIO, Redis session, quota/lock, filter secret | Xác minh trên Java snapshot |
| E2E `backend.test.cjs` + kết quả 19/10 | 14 case, 12 PASS, E09/E10 FAIL | Kết quả lịch sử người dùng cung cấp; chưa tự rerun |
| Node signaling, TLS/Nginx, CI và deployment | Một phần được mô tả trong báo cáo, nhưng source phiên bản hiện hành chưa kiểm chứng trực tiếp | NEEDS_CONFIRMATION |

### I.3. Chuẩn tham chiếu

- [OWASP ASVS 5.0.0 — tiêu chuẩn xác minh an toàn ứng dụng](https://github.com/OWASP/ASVS/releases/tag/v5.0.0).
- [OWASP API Security Top 10 2023](https://api-security.owasp.org/editions/2023/en/0x00-header/).
- Các nhóm kiểm thử được lựa chọn theo bề mặt thực tế VeilTalk; **không tuyên bố đã đạt chuẩn ASVS** và không gắn số yêu cầu ASVS cụ thể khi chưa lập mapping chi tiết.

## II. Kiến trúc kiểm thử và quyền hạn

### II.1. Môi trường và fixture bắt buộc

| Mã | Fixture | Vai trò |
|---|---|---|
| A | Tài khoản active, password riêng, access/refresh token; user ID bất biến | Chủ dữ liệu và người gọi |
| B | Active, khác A, cùng hội thoại với A | Người nhận tin/được gọi |
| C | Active, không tham gia hội thoại A-B | Attacker/outsider có tài khoản hợp lệ |
| D | Tài khoản xóa mềm hoặc token hết hạn/thu hồi | Kiểm thử vòng đời quyền |
| S-notify | Internal secret riêng cho call notify | Dịch vụ signaling giả lập trong môi trường test |
| S-webhook | Internal secret riêng cho MinIO webhook | Dịch vụ storage thông báo hoàn tất |
| V-B | Video READY của B, video RECORDING của B, uploadId, object key nằm trong fixture riêng | Kiểm tra quyền và object storage |
| TAB-A1/A2, TAB-B1 | Nhiều WebSocket thật, có correlation id | Kiểm tra multi-session |
| Run-ID | Container labels, test bucket, DB/Redis namespace ngắn hạn | Dọn tài nguyên đúng phạm vi |

**Quy định secrets:** Không hardcode secret trong script hoặc tài liệu; cấp qua environment/secret store ở runtime, mask khỏi CLI/log/JUnit. Với các case JWT sai chữ ký, không cần secret. Với case JWT claims hợp lệ chữ ký nhưng sai kiểu/thiếu trường, chỉ dùng khóa của môi trường kiểm thử được phép, không lấy khóa production.

### II.2. Mức độ ưu tiên và trạng thái

| Mức | Ý nghĩa |
|---|---|
| P0 | Ranh giới bảo mật cốt lõi; nếu fail cần chặn nghiệm thu phát hành hoặc có chấp thuận rủi ro được tài liệu hóa |
| P1 | Rủi ro quan trọng; cần thực hiện trước báo cáo sẵn sàng triển khai và theo dõi trạng thái remediation |
| P2 | Nâng cao/phụ thuộc deployment hoặc threat model; vẫn phải giải thích nếu chưa thực hiện |

| Trạng thái | Định nghĩa |
|---|---|
| NOT_RUN | Chưa thực hiện |
| PASS | Điều kiện PASS, side effects và bằng chứng đều thỏa mãn |
| FAIL_PRODUCT | Chứng minh code/hạ tầng vi phạm chính sách đã chốt |
| FAIL_TEST | Fixture, assertion, timing hoặc test harness sai |
| FAIL_ENV | Docker/config/mạng/dịch vụ test lỗi ngoài phạm vi sản phẩm |
| BLOCKED | Phụ thuộc chưa hoàn tất, không chạy đến oracle |
| NEEDS_CONTRACT | Chưa chốt hành vi/policy cần bảo vệ |
| NEEDS_CONFIRMATION | Cần đối chiếu source/runtime mới nhất |
| SECURITY_GAP | Chính sách cần thiết chưa được triển khai hoặc có chấp nhận rủi ro đang chờ quyết định |

### II.3. Bộ bằng chứng bắt buộc mỗi case

Ghi `run_id`, commit, ngày giờ, service/version, fixture IDs đã ẩn, endpoint/event, request variant **không chứa bí mật**, response/status/close/event, trạng thái DB/Redis/MinIO trước/sau, tiêu chí oracle, log đã ẩn secret, kết luận và chủ sở hữu xử lý. Các case security âm tính cần chứng minh **không có tác dụng phụ**, không chỉ kiểm tra lỗi trả về.

### II.4. An toàn thực thi với test có nguy cơ

Test brute-force, resource exhaustion, origin/proxy, malformed payload lớn hoặc failover chỉ thực hiện trong môi trường cô lập với ngưỡng nhỏ, kế hoạch dừng và quota. Không gửi payload có mục tiêu phá hoại hay đối tượng không thuộc dự án. T07 phụ trách sâu về fault injection; T06 chỉ đánh giá hành vi fail-closed và quyền khi dependency mất sẵn sàng.

## III. Danh mục nhóm và ma trận ưu tiên

| Nhóm | Nội dung | P0 | P1 | P2 | Tổng |
|---|---|---:|---:|---:|---:|
| AUTH | Xác thực, mật khẩu và JWT | 13 | 11 | 0 | 24 |
| BOLA | Phân quyền theo đối tượng (BOLA/IDOR) | 11 | 7 | 0 | 18 |
| BFLA | Phân quyền theo chức năng và thuộc tính (BFLA/BOPLA) | 8 | 6 | 0 | 14 |
| WSM | Messaging WebSocket: handshake, sự kiện và cách ly phiên | 9 | 10 | 0 | 19 |
| SIG | Node signaling: quyền gọi, danh tính và vòng đời phiên | 9 | 12 | 0 | 21 |
| VID | An toàn video, MinIO và presigned URL | 12 | 14 | 0 | 26 |
| INPUT | Đầu vào bất thường, serialization và injection | 4 | 11 | 1 | 16 |
| ABUSE | Chống lạm dụng, rate limit và tiêu thụ tài nguyên | 1 | 10 | 1 | 12 |
| INT | Giao tiếp nội bộ, shared secret và webhook | 6 | 6 | 0 | 12 |
| CONFIG | Cấu hình bảo mật, CORS, TLS và bề mặt triển khai | 5 | 10 | 0 | 15 |
| LOG | Bảo vệ dữ liệu nhạy cảm, logging, lỗi và audit | 4 | 7 | 0 | 11 |
| SUPPLY | Dependency, artifact và quá trình build an toàn | 2 | 5 | 1 | 8 |
| CROSS | Chuỗi bảo mật xuyên module | 6 | 4 | 0 | 10 |
| **TỔNG** | **13 nhóm** | **90** | **113** | **3** | **206** |

**Lưu ý về số lượng:** Một `ID` là một *kịch bản*, có thể chứa nhiều subcase (ví dụ từng endpoint hoặc từng token sai); tổng số HTTP requests/assertions lúc triển khai sẽ lớn hơn tổng ID. Danh sách này là baseline coverage có cấu trúc, không phải tuyên bố đã đạt 100% security.

## IV. Chi tiết kịch bản T06

### AUTH — Xác thực, mật khẩu và JWT (24 kịch bản)

**Mục tiêu:** Chứng minh danh tính không thể bị giả mạo; token sai hoặc đã thu hồi không cấp quyền.
**Nguồn đối chiếu:** `auth/AuthController.java; AuthService.java; JwtService.java; JwtAuthenticationFilter.java; SecurityConfig.java; RegisterRequest.java`.
**Bằng chứng điển hình:** HTTP status+body đã lược bí mật; JWT claims chỉ ghi loại/thời điểm đã ẩn; PostgreSQL users/refresh_tokens; Redis blacklist.

#### AUTH-001 — Đăng ký tạo mật khẩu lưu an toàn [P0]

**Mục tiêu bảo vệ:** Chứng minh danh tính không thể bị giả mạo; token sai hoặc đã thu hồi không cấp quyền.
**Điều kiện/fixture:** DB sạch; tài khoản A mới.
**Thao tác kiểm thử:** Đăng ký A với mật khẩu thử riêng; truy vấn row users theo A.
**Điều kiện PASS bắt buộc:** Đăng ký thành công; password_hash là hash BCrypt hợp lệ, khác plaintext; response không trả password_hash.
**Bằng chứng phải lưu:** HTTP status+body đã lược bí mật; JWT claims chỉ ghi loại/thời điểm đã ẩn; PostgreSQL users/refresh_tokens; Redis blacklist; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### AUTH-002 — Đăng nhập đúng và sai không lộ bí mật [P0]

**Mục tiêu bảo vệ:** Chứng minh danh tính không thể bị giả mạo; token sai hoặc đã thu hồi không cấp quyền.
**Điều kiện/fixture:** A đã đăng ký.
**Thao tác kiểm thử:** Đăng nhập với mật khẩu đúng rồi sai; so sánh response lỗi với email không tồn tại.
**Điều kiện PASS bắt buộc:** Chỉ đúng được token; sai/không tồn tại không trả token hay thông tin nhạy cảm; thông tin lỗi không hỗ trợ suy đoán tài khoản ngoài chính sách.
**Bằng chứng phải lưu:** HTTP status+body đã lược bí mật; JWT claims chỉ ghi loại/thời điểm đã ẩn; PostgreSQL users/refresh_tokens; Redis blacklist; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### AUTH-003 — Không token gọi toàn bộ API bảo vệ [P0]

**Mục tiêu bảo vệ:** Chứng minh danh tính không thể bị giả mạo; token sai hoặc đã thu hồi không cấp quyền.
**Điều kiện/fixture:** Có inventory endpoint và A/B.
**Thao tác kiểm thử:** Lần lượt gọi từng endpoint bảo vệ không gửi Authorization.
**Điều kiện PASS bắt buộc:** Không được thực thi nghiệp vụ, không truy cập dữ liệu; xác định endpoint public thực sự từ contract.
**Bằng chứng phải lưu:** HTTP status+body đã lược bí mật; JWT claims chỉ ghi loại/thời điểm đã ẩn; PostgreSQL users/refresh_tokens; Redis blacklist; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### AUTH-004 — Chữ ký JWT bị sửa [P0]

**Mục tiêu bảo vệ:** Chứng minh danh tính không thể bị giả mạo; token sai hoặc đã thu hồi không cấp quyền.
**Điều kiện/fixture:** Access token hợp lệ của A.
**Thao tác kiểm thử:** Thay đổi một ký tự ở phần chữ ký; gọi /users/me và các API đại diện.
**Điều kiện PASS bắt buộc:** Từ chối xác thực; không thay đổi DB, Redis hoặc gửi sự kiện.
**Bằng chứng phải lưu:** HTTP status+body đã lược bí mật; JWT claims chỉ ghi loại/thời điểm đã ẩn; PostgreSQL users/refresh_tokens; Redis blacklist; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### AUTH-005 — Payload JWT bị sửa không ký lại [P0]

**Mục tiêu bảo vệ:** Chứng minh danh tính không thể bị giả mạo; token sai hoặc đã thu hồi không cấp quyền.
**Điều kiện/fixture:** Access token A.
**Thao tác kiểm thử:** Chỉnh sub hoặc role ở payload nhưng giữ signature; gọi endpoint A có quyền.
**Điều kiện PASS bắt buộc:** Từ chối; không có quyền của user/role bị mạo nhận.
**Bằng chứng phải lưu:** HTTP status+body đã lược bí mật; JWT claims chỉ ghi loại/thời điểm đã ẩn; PostgreSQL users/refresh_tokens; Redis blacklist; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### AUTH-006 — JWT alg none và thuật toán khác [P0]

**Mục tiêu bảo vệ:** Chứng minh danh tính không thể bị giả mạo; token sai hoặc đã thu hồi không cấp quyền.
**Điều kiện/fixture:** JWT test xây dựng với header không được phép; chỉ môi trường cô lập.
**Thao tác kiểm thử:** Trình token có alg none hoặc khác HS256; gọi endpoint bảo vệ.
**Điều kiện PASS bắt buộc:** Từ chối, không fallback sang phương thức yếu hoặc bỏ kiểm tra chữ ký.
**Bằng chứng phải lưu:** HTTP status+body đã lược bí mật; JWT claims chỉ ghi loại/thời điểm đã ẩn; PostgreSQL users/refresh_tokens; Redis blacklist; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### AUTH-007 — Refresh token dùng thay access [P0]

**Mục tiêu bảo vệ:** Chứng minh danh tính không thể bị giả mạo; token sai hoặc đã thu hồi không cấp quyền.
**Điều kiện/fixture:** Token refresh thật từ A.
**Thao tác kiểm thử:** Dùng refresh trong Bearer của GET /users/me và WebSocket.
**Điều kiện PASS bắt buộc:** Không được xác thực như access token.
**Bằng chứng phải lưu:** HTTP status+body đã lược bí mật; JWT claims chỉ ghi loại/thời điểm đã ẩn; PostgreSQL users/refresh_tokens; Redis blacklist; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### AUTH-008 — Access token dùng thay refresh [P0]

**Mục tiêu bảo vệ:** Chứng minh danh tính không thể bị giả mạo; token sai hoặc đã thu hồi không cấp quyền.
**Điều kiện/fixture:** A có access token thật.
**Thao tác kiểm thử:** Gửi access token vào POST /auth/refresh.
**Điều kiện PASS bắt buộc:** Từ chối; không phát access token mới.
**Bằng chứng phải lưu:** HTTP status+body đã lược bí mật; JWT claims chỉ ghi loại/thời điểm đã ẩn; PostgreSQL users/refresh_tokens; Redis blacklist; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### AUTH-009 — JWT đã hết hạn [P0]

**Mục tiêu bảo vệ:** Chứng minh danh tính không thể bị giả mạo; token sai hoặc đã thu hồi không cấp quyền.
**Điều kiện/fixture:** Tạo JWT hết hạn bằng clock fixture hợp lệ trong test env hoặc chờ TTL test.
**Thao tác kiểm thử:** Gọi HTTP endpoint và mở WebSocket sau thời điểm hết hạn.
**Điều kiện PASS bắt buộc:** Từ chối; không có request/sự kiện được phép; không phụ thuộc đồng hồ máy test bị lệch.
**Bằng chứng phải lưu:** HTTP status+body đã lược bí mật; JWT claims chỉ ghi loại/thời điểm đã ẩn; PostgreSQL users/refresh_tokens; Redis blacklist; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### AUTH-010 — Logout thu hồi access ở HTTP [P0]

**Mục tiêu bảo vệ:** Chứng minh danh tính không thể bị giả mạo; token sai hoặc đã thu hồi không cấp quyền.
**Điều kiện/fixture:** A login có access và refresh.
**Thao tác kiểm thử:** Logout qua API thật; gọi lại GET /users/me và POST /conversations.
**Điều kiện PASS bắt buộc:** Token cũ bị từ chối; không tạo dữ liệu; refresh liên quan xử lý đúng.
**Bằng chứng phải lưu:** HTTP status+body đã lược bí mật; JWT claims chỉ ghi loại/thời điểm đã ẩn; PostgreSQL users/refresh_tokens; Redis blacklist; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### AUTH-011 — Logout thu hồi access ở messaging WS [P0]

**Mục tiêu bảo vệ:** Chứng minh danh tính không thể bị giả mạo; token sai hoặc đã thu hồi không cấp quyền.
**Điều kiện/fixture:** A đã logout token; messaging đang chạy.
**Thao tác kiểm thử:** Dùng access cũ tạo kết nối /ws/messaging mới.
**Điều kiện PASS bắt buộc:** Handshake bị từ chối; không nhận thông điệp riêng tư.
**Bằng chứng phải lưu:** HTTP status+body đã lược bí mật; JWT claims chỉ ghi loại/thời điểm đã ẩn; PostgreSQL users/refresh_tokens; Redis blacklist; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### AUTH-012 — Logout thu hồi access ở signaling [P0]

**Mục tiêu bảo vệ:** Chứng minh danh tính không thể bị giả mạo; token sai hoặc đã thu hồi không cấp quyền.
**Điều kiện/fixture:** A đã logout; server signaling thực.
**Thao tác kiểm thử:** Dùng token cũ thiết lập /ws/signaling rồi thử thao tác đại diện.
**Điều kiện PASS bắt buộc:** Kết nối bị từ chối hoặc đóng trong thời hạn contract; không có khả năng gửi signal; BUG LỊCH SỬ E10.
**Bằng chứng phải lưu:** HTTP status+body đã lược bí mật; JWT claims chỉ ghi loại/thời điểm đã ẩn; PostgreSQL users/refresh_tokens; Redis blacklist; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### AUTH-013 — Logout không thu hồi nhầm người khác [P0]

**Mục tiêu bảo vệ:** Chứng minh danh tính không thể bị giả mạo; token sai hoặc đã thu hồi không cấp quyền.
**Điều kiện/fixture:** A và B đăng nhập, token riêng.
**Thao tác kiểm thử:** Logout A; dùng token B truy cập nội dung của B.
**Điều kiện PASS bắt buộc:** B còn hợp lệ; chỉ token/phạm vi yêu cầu của A bị thu hồi.
**Bằng chứng phải lưu:** HTTP status+body đã lược bí mật; JWT claims chỉ ghi loại/thời điểm đã ẩn; PostgreSQL users/refresh_tokens; Redis blacklist; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### AUTH-014 — Thu hồi access sau xóa tài khoản [P1]

**Mục tiêu bảo vệ:** Chứng minh danh tính không thể bị giả mạo; token sai hoặc đã thu hồi không cấp quyền.
**Điều kiện/fixture:** A có HTTP và WS; tiến hành xóa tài khoản.
**Thao tác kiểm thử:** Xóa A; thử access/refresh cũ ở HTTP, WS và signaling.
**Điều kiện PASS bắt buộc:** Mọi thao tác cần user active đều bị từ chối; không có event gửi tới tài khoản xóa.
**Bằng chứng phải lưu:** HTTP status+body đã lược bí mật; JWT claims chỉ ghi loại/thời điểm đã ẩn; PostgreSQL users/refresh_tokens; Redis blacklist; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### AUTH-015 — Thu hồi refresh token sau logout [P1]

**Mục tiêu bảo vệ:** Chứng minh danh tính không thể bị giả mạo; token sai hoặc đã thu hồi không cấp quyền.
**Điều kiện/fixture:** A có refresh token.
**Thao tác kiểm thử:** Logout; gửi refresh token cũ tới /auth/refresh.
**Điều kiện PASS bắt buộc:** Không tạo access token mới; row refresh được đánh dấu thu hồi.
**Bằng chứng phải lưu:** HTTP status+body đã lược bí mật; JWT claims chỉ ghi loại/thời điểm đã ẩn; PostgreSQL users/refresh_tokens; Redis blacklist; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### AUTH-016 — Refresh token giả không có bản ghi DB [P1]

**Mục tiêu bảo vệ:** Chứng minh danh tính không thể bị giả mạo; token sai hoặc đã thu hồi không cấp quyền.
**Điều kiện/fixture:** Một refresh token hợp lệ về chữ ký nhưng không có trong DB test.
**Thao tác kiểm thử:** Gọi /auth/refresh bằng token không có row.
**Điều kiện PASS bắt buộc:** Không có access mới; không tạo tài khoản hoặc row tự động.
**Bằng chứng phải lưu:** HTTP status+body đã lược bí mật; JWT claims chỉ ghi loại/thời điểm đã ẩn; PostgreSQL users/refresh_tokens; Redis blacklist; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### AUTH-017 — Refresh token của A không logout phiên B [P1]

**Mục tiêu bảo vệ:** Chứng minh danh tính không thể bị giả mạo; token sai hoặc đã thu hồi không cấp quyền.
**Điều kiện/fixture:** A, B cùng có access/refresh.
**Thao tác kiểm thử:** Bearer A kết hợp refresh của B trong /auth/logout.
**Điều kiện PASS bắt buộc:** Từ chối; session của B vẫn dùng được; không blacklist sai.
**Bằng chứng phải lưu:** HTTP status+body đã lược bí mật; JWT claims chỉ ghi loại/thời điểm đã ẩn; PostgreSQL users/refresh_tokens; Redis blacklist; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### AUTH-018 — Cấu trúc Bearer header bất thường [P1]

**Mục tiêu bảo vệ:** Chứng minh danh tính không thể bị giả mạo; token sai hoặc đã thu hồi không cấp quyền.
**Điều kiện/fixture:** A có access.
**Thao tác kiểm thử:** Gửi thiếu Bearer, Bearer rỗng, nhiều giá trị Authorization hoặc khoảng trắng bất thường.
**Điều kiện PASS bắt buộc:** Không xác thực ngoài những định dạng hợp lệ trong contract; không ném lỗi 500 chứa chi tiết.
**Bằng chứng phải lưu:** HTTP status+body đã lược bí mật; JWT claims chỉ ghi loại/thời điểm đã ẩn; PostgreSQL users/refresh_tokens; Redis blacklist; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### AUTH-019 — JWT thiếu claim bắt buộc [P1]

**Mục tiêu bảo vệ:** Chứng minh danh tính không thể bị giả mạo; token sai hoặc đã thu hồi không cấp quyền.
**Điều kiện/fixture:** Token thử ký với secret chỉ của env E2E; không dùng khóa production.
**Thao tác kiểm thử:** Lần lượt bỏ sub, exp, iat, jti, role, type.
**Điều kiện PASS bắt buộc:** Không được xác thực; không tự suy đoán claim thiếu.
**Bằng chứng phải lưu:** HTTP status+body đã lược bí mật; JWT claims chỉ ghi loại/thời điểm đã ẩn; PostgreSQL users/refresh_tokens; Redis blacklist; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### AUTH-020 — JWT iat tương lai, exp ngược [P1]

**Mục tiêu bảo vệ:** Chứng minh danh tính không thể bị giả mạo; token sai hoặc đã thu hồi không cấp quyền.
**Điều kiện/fixture:** Token thử hợp lệ chữ ký nhưng mốc thời gian sai.
**Thao tác kiểm thử:** Gọi endpoint bảo vệ với các claim thời gian bất hợp lý.
**Điều kiện PASS bắt buộc:** Bị từ chối theo policy thời gian; không mở phiên kéo dài trái mong muốn.
**Bằng chứng phải lưu:** HTTP status+body đã lược bí mật; JWT claims chỉ ghi loại/thời điểm đã ẩn; PostgreSQL users/refresh_tokens; Redis blacklist; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### AUTH-021 — Token kích thước bất thường [P1]

**Mục tiêu bảo vệ:** Chứng minh danh tính không thể bị giả mạo; token sai hoặc đã thu hồi không cấp quyền.
**Điều kiện/fixture:** Môi trường riêng và giới hạn request an toàn.
**Thao tác kiểm thử:** Gửi token dài hơn mức dùng thực tế và token JSON méo.
**Điều kiện PASS bắt buộc:** Phản hồi kiểm soát, không lỗi 500 hoặc lộ stacktrace; không làm hỏng các request sau.
**Bằng chứng phải lưu:** HTTP status+body đã lược bí mật; JWT claims chỉ ghi loại/thời điểm đã ẩn; PostgreSQL users/refresh_tokens; Redis blacklist; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### AUTH-022 — Mật khẩu reset/cập nhật không tồn tại [P1]

**Mục tiêu bảo vệ:** Chứng minh danh tính không thể bị giả mạo; token sai hoặc đã thu hồi không cấp quyền.
**Điều kiện/fixture:** Kiểm kê API thực tế.
**Thao tác kiểm thử:** Xác minh có hay không endpoint đặt lại mật khẩu; nếu có chạy flow token một lần.
**Điều kiện PASS bắt buộc:** Nếu không triển khai ghi N/A có bằng chứng; nếu có phải chống dùng lại/đánh cắp, không tự suy đoán endpoint.
**Bằng chứng phải lưu:** HTTP status+body đã lược bí mật; JWT claims chỉ ghi loại/thời điểm đã ẩn; PostgreSQL users/refresh_tokens; Redis blacklist; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### AUTH-023 — Không kéo dài access token bằng đổi client clock [P1]

**Mục tiêu bảo vệ:** Chứng minh danh tính không thể bị giả mạo; token sai hoặc đã thu hồi không cấp quyền.
**Điều kiện/fixture:** A có token và đồng hồ client được giả lập.
**Thao tác kiểm thử:** Sửa timestamp gửi từ client hoặc đồng hồ hệ phát request, dùng token đã hết hạn.
**Điều kiện PASS bắt buộc:** Server quyết định theo thời gian tin cậy của mình; không chấp nhận token hết hạn.
**Bằng chứng phải lưu:** HTTP status+body đã lược bí mật; JWT claims chỉ ghi loại/thời điểm đã ẩn; PostgreSQL users/refresh_tokens; Redis blacklist; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### AUTH-024 — Session cố định hoặc tái sử dụng token khi login [P1]

**Mục tiêu bảo vệ:** Chứng minh danh tính không thể bị giả mạo; token sai hoặc đã thu hồi không cấp quyền.
**Điều kiện/fixture:** A đăng nhập hai lượt độc lập.
**Thao tác kiểm thử:** So sánh access jti và refresh của hai lần; thử logout một cặp.
**Điều kiện PASS bắt buộc:** Refresh không bị tái sử dụng trái thiết kế; phạm vi logout tuân thủ policy đã xác nhận.
**Bằng chứng phải lưu:** HTTP status+body đã lược bí mật; JWT claims chỉ ghi loại/thời điểm đã ẩn; PostgreSQL users/refresh_tokens; Redis blacklist; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

### BOLA — Phân quyền theo đối tượng (BOLA/IDOR) (18 kịch bản)

**Mục tiêu:** Kiểm tra server xác minh user sở hữu hoặc tham gia từng đối tượng, không tin ID do client đưa lên.
**Nguồn đối chiếu:** `messaging/ConversationService.java; MessageService.java; video/VideoService.java; avatar/AvatarService.java; user/UserProfileService.java`.
**Bằng chứng điển hình:** Phản hồi A/B/C; SQL trước/sau trên conversations/messages/videos/users; WebSocket sự kiện và MinIO object.

#### BOLA-001 — C đọc chi tiết hội thoại A-B [P0]

**Mục tiêu bảo vệ:** Kiểm tra server xác minh user sở hữu hoặc tham gia từng đối tượng, không tin ID do client đưa lên.
**Điều kiện/fixture:** A/B có hội thoại riêng; C không là thành viên.
**Thao tác kiểm thử:** C GET /conversations/{idAB}.
**Điều kiện PASS bắt buộc:** Không trả dữ liệu riêng tư của A-B; DB không thay đổi.
**Bằng chứng phải lưu:** Phản hồi A/B/C; SQL trước/sau trên conversations/messages/videos/users; WebSocket sự kiện và MinIO object; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BOLA-002 — C đọc danh sách tin nhắn A-B [P0]

**Mục tiêu bảo vệ:** Kiểm tra server xác minh user sở hữu hoặc tham gia từng đối tượng, không tin ID do client đưa lên.
**Điều kiện/fixture:** A/B có tin bí mật trong cuộc trò chuyện.
**Thao tác kiểm thử:** C GET /conversations/{idAB}/messages.
**Điều kiện PASS bắt buộc:** Không có nội dung, metadata hoặc thông tin sender của tin A-B.
**Bằng chứng phải lưu:** Phản hồi A/B/C; SQL trước/sau trên conversations/messages/videos/users; WebSocket sự kiện và MinIO object; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BOLA-003 — C gửi tin vào hội thoại A-B [P0]

**Mục tiêu bảo vệ:** Kiểm tra server xác minh user sở hữu hoặc tham gia từng đối tượng, không tin ID do client đưa lên.
**Điều kiện/fixture:** A/B có hội thoại; C hợp lệ JWT.
**Thao tác kiểm thử:** C POST /conversations/{idAB}/messages với UUID mới.
**Điều kiện PASS bắt buộc:** Bị từ chối; messages count không tăng; A/B không nhận NEW_MESSAGE từ C.
**Bằng chứng phải lưu:** Phản hồi A/B/C; SQL trước/sau trên conversations/messages/videos/users; WebSocket sự kiện và MinIO object; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BOLA-004 — C cập nhật trạng thái tin A-B [P0]

**Mục tiêu bảo vệ:** Kiểm tra server xác minh user sở hữu hoặc tham gia từng đối tượng, không tin ID do client đưa lên.
**Điều kiện/fixture:** Một tin từ A đến B; C outsider.
**Thao tác kiểm thử:** C PUT status cho tin thuộc A-B.
**Điều kiện PASS bắt buộc:** Bị từ chối; trạng thái DB và sự kiện A/B không thay đổi.
**Bằng chứng phải lưu:** Phản hồi A/B/C; SQL trước/sau trên conversations/messages/videos/users; WebSocket sự kiện và MinIO object; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BOLA-005 — B thao tác tin trong hội thoại khác [P0]

**Mục tiêu bảo vệ:** Kiểm tra server xác minh user sở hữu hoặc tham gia từng đối tượng, không tin ID do client đưa lên.
**Điều kiện/fixture:** B thuộc A-B nhưng không thuộc A-C.
**Thao tác kiểm thử:** B dùng messageId của A-C với conversationId A-B.
**Điều kiện PASS bắt buộc:** Không thay đổi tin của A-C; không gửi sự kiện sai.
**Bằng chứng phải lưu:** Phản hồi A/B/C; SQL trước/sau trên conversations/messages/videos/users; WebSocket sự kiện và MinIO object; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BOLA-006 — A sửa upload video của B [P0]

**Mục tiêu bảo vệ:** Kiểm tra server xác minh user sở hữu hoặc tham gia từng đối tượng, không tin ID do client đưa lên.
**Điều kiện/fixture:** B đang có video recording.
**Thao tác kiểm thử:** A gọi /videos/{idB}/chunks bằng upload_id B.
**Điều kiện PASS bắt buộc:** Bị từ chối; Redis session B không đổi; không cấp URL mới.
**Bằng chứng phải lưu:** Phản hồi A/B/C; SQL trước/sau trên conversations/messages/videos/users; WebSocket sự kiện và MinIO object; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BOLA-007 — A finalize video B [P0]

**Mục tiêu bảo vệ:** Kiểm tra server xác minh user sở hữu hoặc tham gia từng đối tượng, không tin ID do client đưa lên.
**Điều kiện/fixture:** B có phiên recording hợp lệ.
**Thao tác kiểm thử:** A dùng /videos/{idB}/finalize với uploadId/parts B.
**Điều kiện PASS bắt buộc:** Không complete MinIO; trạng thái và quota B không đổi.
**Bằng chứng phải lưu:** Phản hồi A/B/C; SQL trước/sau trên conversations/messages/videos/users; WebSocket sự kiện và MinIO object; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BOLA-008 — A abort video B [P0]

**Mục tiêu bảo vệ:** Kiểm tra server xác minh user sở hữu hoặc tham gia từng đối tượng, không tin ID do client đưa lên.
**Điều kiện/fixture:** B có phiên upload recording.
**Thao tác kiểm thử:** A POST /videos/{idB}/abort với uploadId B.
**Điều kiện PASS bắt buộc:** Không hủy multipart của B; session Redis B còn nguyên.
**Bằng chứng phải lưu:** Phản hồi A/B/C; SQL trước/sau trên conversations/messages/videos/users; WebSocket sự kiện và MinIO object; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BOLA-009 — A xem video riêng B [P0]

**Mục tiêu bảo vệ:** Kiểm tra server xác minh user sở hữu hoặc tham gia từng đối tượng, không tin ID do client đưa lên.
**Điều kiện/fixture:** B có video READY.
**Thao tác kiểm thử:** A GET /videos/{idB}.
**Điều kiện PASS bắt buộc:** Không trả presigned URL hoặc metadata không được phép; không rò object key.
**Bằng chứng phải lưu:** Phản hồi A/B/C; SQL trước/sau trên conversations/messages/videos/users; WebSocket sự kiện và MinIO object; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BOLA-010 — A xóa video B [P0]

**Mục tiêu bảo vệ:** Kiểm tra server xác minh user sở hữu hoặc tham gia từng đối tượng, không tin ID do client đưa lên.
**Điều kiện/fixture:** B có video READY.
**Thao tác kiểm thử:** A DELETE /videos/{idB}.
**Điều kiện PASS bắt buộc:** Bị từ chối; object và metadata của B vẫn còn.
**Bằng chứng phải lưu:** Phản hồi A/B/C; SQL trước/sau trên conversations/messages/videos/users; WebSocket sự kiện và MinIO object; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BOLA-011 — A đổi tên video B [P0]

**Mục tiêu bảo vệ:** Kiểm tra server xác minh user sở hữu hoặc tham gia từng đối tượng, không tin ID do client đưa lên.
**Điều kiện/fixture:** B có video READY.
**Thao tác kiểm thử:** A PUT endpoint rename theo URL code thực tế với idB.
**Điều kiện PASS bắt buộc:** Bị từ chối; B đọc lại title không đổi.
**Bằng chứng phải lưu:** Phản hồi A/B/C; SQL trước/sau trên conversations/messages/videos/users; WebSocket sự kiện và MinIO object; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BOLA-012 — A thử điều khiển session upload của B bằng upload_id [P1]

**Mục tiêu bảo vệ:** Kiểm tra server xác minh user sở hữu hoặc tham gia từng đối tượng, không tin ID do client đưa lên.
**Điều kiện/fixture:** A/B đều có phiên đang mở.
**Thao tác kiểm thử:** A dùng video ID của A kết hợp uploadId của B trong chunks/finalize/abort.
**Điều kiện PASS bắt buộc:** Không vượt được kiểm tra tương quan user-video-session; không ảnh hưởng hai phiên.
**Bằng chứng phải lưu:** Phản hồi A/B/C; SQL trước/sau trên conversations/messages/videos/users; WebSocket sự kiện và MinIO object; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BOLA-013 — Lịch sử hội thoại cursor của người khác [P1]

**Mục tiêu bảo vệ:** Kiểm tra server xác minh user sở hữu hoặc tham gia từng đối tượng, không tin ID do client đưa lên.
**Điều kiện/fixture:** A và B/C có cursor riêng.
**Thao tác kiểm thử:** Dùng cursor của A trong truy vấn B và đối chiếu dữ liệu.
**Điều kiện PASS bắt buộc:** Không tạo truy cập xuyên user; nếu cursor là mốc chung hợp lệ cũng chỉ lấy dữ liệu được phép.
**Bằng chứng phải lưu:** Phản hồi A/B/C; SQL trước/sau trên conversations/messages/videos/users; WebSocket sự kiện và MinIO object; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BOLA-014 — Model avatar public không lộ trường private [P1]

**Mục tiêu bảo vệ:** Kiểm tra server xác minh user sở hữu hoặc tham gia từng đối tượng, không tin ID do client đưa lên.
**Điều kiện/fixture:** A có avatar và cấu hình tùy chỉnh.
**Thao tác kiểm thử:** B GET /avatars/{idA}; so với /avatars/me của A.
**Điều kiện PASS bắt buộc:** Chỉ trường được công khai theo schema; không lộ email hay dữ liệu riêng.
**Bằng chứng phải lưu:** Phản hồi A/B/C; SQL trước/sau trên conversations/messages/videos/users; WebSocket sự kiện và MinIO object; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BOLA-015 — Đối tượng bị xóa mềm không thể truy cập lại [P1]

**Mục tiêu bảo vệ:** Kiểm tra server xác minh user sở hữu hoặc tham gia từng đối tượng, không tin ID do client đưa lên.
**Điều kiện/fixture:** A xóa video hoặc tài khoản; token/ID cũ còn lưu.
**Thao tác kiểm thử:** GET/PUT/DELETE theo ID cũ từ A/B/C.
**Điều kiện PASS bắt buộc:** Không hồi sinh tài nguyên hoặc lộ link đã bị thu hồi theo policy.
**Bằng chứng phải lưu:** Phản hồi A/B/C; SQL trước/sau trên conversations/messages/videos/users; WebSocket sự kiện và MinIO object; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BOLA-016 — C không phát typing vào hội thoại A-B [P1]

**Mục tiêu bảo vệ:** Kiểm tra server xác minh user sở hữu hoặc tham gia từng đối tượng, không tin ID do client đưa lên.
**Điều kiện/fixture:** C có messaging socket và biết idAB.
**Thao tác kiểm thử:** C gửi TYPING/TYPING_STOP chứa conversation_id A-B.
**Điều kiện PASS bắt buộc:** C nhận lỗi hoặc sự kiện bị loại theo contract; A/B không nhận typing giả.
**Bằng chứng phải lưu:** Phản hồi A/B/C; SQL trước/sau trên conversations/messages/videos/users; WebSocket sự kiện và MinIO object; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BOLA-017 — ID ngẫu nhiên không cho phép liệt kê dữ liệu [P1]

**Mục tiêu bảo vệ:** Kiểm tra server xác minh user sở hữu hoặc tham gia từng đối tượng, không tin ID do client đưa lên.
**Điều kiện/fixture:** C có JWT, nhiều ID hợp lệ về cú pháp nhưng không thuộc C.
**Thao tác kiểm thử:** Gọi endpoint read/update/delete trên IDs không tồn tại và không sở hữu.
**Điều kiện PASS bắt buộc:** Không rò nội dung; mức khác biệt 403/404 tuân theo chính sách đã chốt; không có side effect.
**Bằng chứng phải lưu:** Phản hồi A/B/C; SQL trước/sau trên conversations/messages/videos/users; WebSocket sự kiện và MinIO object; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BOLA-018 — Không chiếm quyền dữ liệu qua JSON user_id [P1]

**Mục tiêu bảo vệ:** Kiểm tra server xác minh user sở hữu hoặc tham gia từng đối tượng, không tin ID do client đưa lên.
**Điều kiện/fixture:** A/B tạo fixture; payload thêm user_id= B.
**Thao tác kiểm thử:** A gọi các endpoint gửi tin, video, avatar thêm trường định danh giả.
**Điều kiện PASS bắt buộc:** Tài nguyên vẫn thuộc danh tính xác thực A hoặc request bị từ chối; B không bị tác động.
**Bằng chứng phải lưu:** Phản hồi A/B/C; SQL trước/sau trên conversations/messages/videos/users; WebSocket sự kiện và MinIO object; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

### BFLA — Phân quyền theo chức năng và thuộc tính (BFLA/BOPLA) (14 kịch bản)

**Mục tiêu:** Người dùng không được gọi chức năng vượt cấp quyền hoặc tự sửa các thuộc tính server kiểm soát.
**Nguồn đối chiếu:** `auth/SecurityConfig.java; user/UserProfileController.java; UserProfileUpdateRequest.java; avatar/AvatarUpsertRequest.java; video/VideoController.java; call/CallNotifyController.java`.
**Bằng chứng điển hình:** HTTP before/after; DB role/deleted_at/owner; không có sự kiện hoặc object được tạo trái phép.

#### BFLA-001 — Không gọi internal call notify bằng JWT thường [P0]

**Mục tiêu bảo vệ:** Người dùng không được gọi chức năng vượt cấp quyền hoặc tự sửa các thuộc tính server kiểm soát.
**Điều kiện/fixture:** A có access token; endpoint nội bộ hoạt động.
**Thao tác kiểm thử:** POST /internal/call/notify với Bearer access token A.
**Điều kiện PASS bắt buộc:** Bị từ chối; B không nhận CALL_INCOMING; không thể dùng JWT thay shared secret.
**Bằng chứng phải lưu:** HTTP before/after; DB role/deleted_at/owner; không có sự kiện hoặc object được tạo trái phép; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BFLA-002 — Không gọi internal webhook bằng JWT thường [P0]

**Mục tiêu bảo vệ:** Người dùng không được gọi chức năng vượt cấp quyền hoặc tự sửa các thuộc tính server kiểm soát.
**Điều kiện/fixture:** A có access; video recording/processing.
**Thao tác kiểm thử:** POST /internal/videos/webhook với JWT A.
**Điều kiện PASS bắt buộc:** Bị từ chối; video status và quota không thay đổi.
**Bằng chứng phải lưu:** HTTP before/after; DB role/deleted_at/owner; không có sự kiện hoặc object được tạo trái phép; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BFLA-003 — Không gọi internal bằng secret sai [P0]

**Mục tiêu bảo vệ:** Người dùng không được gọi chức năng vượt cấp quyền hoặc tự sửa các thuộc tính server kiểm soát.
**Điều kiện/fixture:** Hai endpoint nội bộ; secret test đúng có sẵn ngoài log.
**Thao tác kiểm thử:** Thử thiếu secret, secret sai, rỗng, khoảng trắng biến thể.
**Điều kiện PASS bắt buộc:** Tất cả bị từ chối không tạo side effect; thông báo không tiết lộ secret.
**Bằng chứng phải lưu:** HTTP before/after; DB role/deleted_at/owner; không có sự kiện hoặc object được tạo trái phép; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BFLA-004 — Phân biệt endpoint public và protected [P0]

**Mục tiêu bảo vệ:** Người dùng không được gọi chức năng vượt cấp quyền hoặc tự sửa các thuộc tính server kiểm soát.
**Điều kiện/fixture:** Endpoint inventory đã kiểm kê.
**Thao tác kiểm thử:** Không token thử GET /avatars/models và các API nội dung riêng.
**Điều kiện PASS bắt buộc:** Chỉ các endpoint public được phép; không lộ dữ liệu người dùng khi chưa xác thực.
**Bằng chứng phải lưu:** HTTP before/after; DB role/deleted_at/owner; không có sự kiện hoặc object được tạo trái phép; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BFLA-005 — Không tự nâng role bằng API hồ sơ [P0]

**Mục tiêu bảo vệ:** Người dùng không được gọi chức năng vượt cấp quyền hoặc tự sửa các thuộc tính server kiểm soát.
**Điều kiện/fixture:** A role thường.
**Thao tác kiểm thử:** A PUT /users/me với trường role hoặc is_admin bổ sung.
**Điều kiện PASS bắt buộc:** Role DB không đổi; request bị từ chối hoặc trường thừa bị bỏ đúng contract.
**Bằng chứng phải lưu:** HTTP before/after; DB role/deleted_at/owner; không có sự kiện hoặc object được tạo trái phép; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BFLA-006 — Không tự đổi user_id hoặc deleted_at [P0]

**Mục tiêu bảo vệ:** Người dùng không được gọi chức năng vượt cấp quyền hoặc tự sửa các thuộc tính server kiểm soát.
**Điều kiện/fixture:** A/B tồn tại.
**Thao tác kiểm thử:** A PUT /users/me kèm id=B, deleted_at=null hoặc created_at tự chọn.
**Điều kiện PASS bắt buộc:** Không đổi identity, owner, createdAt/deletedAt của A/B.
**Bằng chứng phải lưu:** HTTP before/after; DB role/deleted_at/owner; không có sự kiện hoặc object được tạo trái phép; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BFLA-007 — Không tự đặt sender_id trong tin nhắn [P0]

**Mục tiêu bảo vệ:** Người dùng không được gọi chức năng vượt cấp quyền hoặc tự sửa các thuộc tính server kiểm soát.
**Điều kiện/fixture:** A/B có hội thoại; A có token.
**Thao tác kiểm thử:** A POST tin nhắn kèm sender_id=B và trường system/internal.
**Điều kiện PASS bắt buộc:** DB sender_id phải là A hoặc reject; không phát event giả B.
**Bằng chứng phải lưu:** HTTP before/after; DB role/deleted_at/owner; không có sự kiện hoặc object được tạo trái phép; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BFLA-008 — Không tự đặt video owner/quota/status [P0]

**Mục tiêu bảo vệ:** Người dùng không được gọi chức năng vượt cấp quyền hoặc tự sửa các thuộc tính server kiểm soát.
**Điều kiện/fixture:** A đang tạo video.
**Thao tác kiểm thử:** A POST /videos kèm user_id=B, status=ready, storage_used_bytes=0.
**Điều kiện PASS bắt buộc:** Backend kiểm soát owner và lifecycle; không được tự cấp READY hoặc vượt quota.
**Bằng chứng phải lưu:** HTTP before/after; DB role/deleted_at/owner; không có sự kiện hoặc object được tạo trái phép; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BFLA-009 — Không dùng HTTP method khác để qua filter internal [P1]

**Mục tiêu bảo vệ:** Người dùng không được gọi chức năng vượt cấp quyền hoặc tự sửa các thuộc tính server kiểm soát.
**Điều kiện/fixture:** Hai endpoint internal đang có filter theo method POST.
**Thao tác kiểm thử:** Thử GET/PUT/PATCH/OPTIONS đến đường dẫn nội bộ có payload làm thay đổi trạng thái.
**Điều kiện PASS bắt buộc:** Không gọi nghiệp vụ nhạy cảm; kiểm tra 404/405/401 theo hợp đồng; không bypass bằng method override.
**Bằng chứng phải lưu:** HTTP before/after; DB role/deleted_at/owner; không có sự kiện hoặc object được tạo trái phép; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BFLA-010 — Không mạo danh admin bằng claim sai [P1]

**Mục tiêu bảo vệ:** Người dùng không được gọi chức năng vượt cấp quyền hoặc tự sửa các thuộc tính server kiểm soát.
**Điều kiện/fixture:** A token user; fixture role giả.
**Thao tác kiểm thử:** Thử JWT đã sửa role thành admin; gọi các endpoint được bảo vệ.
**Điều kiện PASS bắt buộc:** Không tạo quyền quản trị; endpoint chỉ cho phép đúng vai trò nếu có thiết kế role.
**Bằng chứng phải lưu:** HTTP before/after; DB role/deleted_at/owner; không có sự kiện hoặc object được tạo trái phép; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BFLA-011 — Không sửa trạng thái qua trường response-only [P1]

**Mục tiêu bảo vệ:** Người dùng không được gọi chức năng vượt cấp quyền hoặc tự sửa các thuộc tính server kiểm soát.
**Điều kiện/fixture:** A có video/tin nhắn.
**Thao tác kiểm thử:** Thêm id/status/created_at/etag vào payload update hợp lệ.
**Điều kiện PASS bắt buộc:** Các trường không có trong request DTO không làm thay đổi giá trị lưu trữ.
**Bằng chứng phải lưu:** HTTP before/after; DB role/deleted_at/owner; không có sự kiện hoặc object được tạo trái phép; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BFLA-012 — Phân quyền xóa tài khoản yêu cầu đúng mật khẩu [P1]

**Mục tiêu bảo vệ:** Người dùng không được gọi chức năng vượt cấp quyền hoặc tự sửa các thuộc tính server kiểm soát.
**Điều kiện/fixture:** A token hợp lệ nhưng sai password.
**Thao tác kiểm thử:** DELETE /users/me bằng mật khẩu khác hoặc rỗng.
**Điều kiện PASS bắt buộc:** Không xóa tài khoản, không thu hồi token, không bắt đầu dọn video.
**Bằng chứng phải lưu:** HTTP before/after; DB role/deleted_at/owner; không có sự kiện hoặc object được tạo trái phép; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BFLA-013 — Không truy cập endpoint chưa xuất bản [P1]

**Mục tiêu bảo vệ:** Người dùng không được gọi chức năng vượt cấp quyền hoặc tự sửa các thuộc tính server kiểm soát.
**Điều kiện/fixture:** Có danh mục route hiện hành và route nội bộ.
**Thao tác kiểm thử:** Thử các HTTP methods không khai báo và đường dẫn nội bộ thay đổi hoa/thường hoặc slash.
**Điều kiện PASS bắt buộc:** Không có đường tắt đi vào handler có đặc quyền; route mapping nhất quán.
**Bằng chứng phải lưu:** HTTP before/after; DB role/deleted_at/owner; không có sự kiện hoặc object được tạo trái phép; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### BFLA-014 — CORS preflight không cấp quyền backend [P1]

**Mục tiêu bảo vệ:** Người dùng không được gọi chức năng vượt cấp quyền hoặc tự sửa các thuộc tính server kiểm soát.
**Điều kiện/fixture:** Origin không được phép; A có token hợp lệ.
**Thao tác kiểm thử:** OPTIONS và actual request từ origin lạ.
**Điều kiện PASS bắt buộc:** Header không cho phép origin trái chính sách; hiểu rõ HTTP client không bị CORS bảo vệ thay cho authorization.
**Bằng chứng phải lưu:** HTTP before/after; DB role/deleted_at/owner; không có sự kiện hoặc object được tạo trái phép; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

### WSM — Messaging WebSocket: handshake, sự kiện và cách ly phiên (19 kịch bản)

**Mục tiêu:** Không để socket chưa xác thực, đã thu hồi hoặc không thuộc hội thoại gửi/nhận dữ liệu trái phép.
**Nguồn đối chiếu:** `messaging/MessagingWebSocketConfig.java; WebSocketAuthHandshakeInterceptor.java; MessagingWebSocketHandler.java; MessagingTypingService.java; WebSocketKeepAliveScheduler.java`.
**Bằng chứng điển hình:** Handshake status/close code; event được gắn user/conversation; Redis pub/sub; audit không rò token.

#### WSM-001 — Handshake thiếu token [P0]

**Mục tiêu bảo vệ:** Không để socket chưa xác thực, đã thu hồi hoặc không thuộc hội thoại gửi/nhận dữ liệu trái phép.
**Điều kiện/fixture:** WS messaging chạy.
**Thao tác kiểm thử:** Kết nối /ws/messaging không có query token.
**Điều kiện PASS bắt buộc:** Handshake bị từ chối; không registry session.
**Bằng chứng phải lưu:** Handshake status/close code; event được gắn user/conversation; Redis pub/sub; audit không rò token; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### WSM-002 — Handshake hai token hoặc token rỗng [P0]

**Mục tiêu bảo vệ:** Không để socket chưa xác thực, đã thu hồi hoặc không thuộc hội thoại gửi/nhận dữ liệu trái phép.
**Điều kiện/fixture:** A có token.
**Thao tác kiểm thử:** Thử ?token=, token trùng 2 lần và token không hợp lệ.
**Điều kiện PASS bắt buộc:** Không mở socket; không chọn token tùy tiện.
**Bằng chứng phải lưu:** Handshake status/close code; event được gắn user/conversation; Redis pub/sub; audit không rò token; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### WSM-003 — Handshake access token bị sửa [P0]

**Mục tiêu bảo vệ:** Không để socket chưa xác thực, đã thu hồi hoặc không thuộc hội thoại gửi/nhận dữ liệu trái phép.
**Điều kiện/fixture:** A có token thật; copy thử đã thay 1 ký tự.
**Thao tác kiểm thử:** Kết nối WebSocket với token sai chữ ký.
**Điều kiện PASS bắt buộc:** Không mở phiên xác thực.
**Bằng chứng phải lưu:** Handshake status/close code; event được gắn user/conversation; Redis pub/sub; audit không rò token; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### WSM-004 — Handshake token đã logout [P0]

**Mục tiêu bảo vệ:** Không để socket chưa xác thực, đã thu hồi hoặc không thuộc hội thoại gửi/nhận dữ liệu trái phép.
**Điều kiện/fixture:** A đã logout; token cũ.
**Thao tác kiểm thử:** Kết nối mới /ws/messaging.
**Điều kiện PASS bắt buộc:** Không mở; registry và pending task không rò.
**Bằng chứng phải lưu:** Handshake status/close code; event được gắn user/conversation; Redis pub/sub; audit không rò token; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### WSM-005 — Handshake tài khoản xóa mềm [P0]

**Mục tiêu bảo vệ:** Không để socket chưa xác thực, đã thu hồi hoặc không thuộc hội thoại gửi/nhận dữ liệu trái phép.
**Điều kiện/fixture:** A đã xóa tài khoản; access token cũ.
**Thao tác kiểm thử:** Thử mở messaging socket.
**Điều kiện PASS bắt buộc:** Không truy cập được bất kể chữ ký token còn hạn.
**Bằng chứng phải lưu:** Handshake status/close code; event được gắn user/conversation; Redis pub/sub; audit không rò token; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### WSM-006 — Handshake Origin lạ [P0]

**Mục tiêu bảo vệ:** Không để socket chưa xác thực, đã thu hồi hoặc không thuộc hội thoại gửi/nhận dữ liệu trái phép.
**Điều kiện/fixture:** Địa chỉ origin được phép và origin không được phép.
**Thao tác kiểm thử:** Thử mở bằng header Origin thuộc allowlist và không thuộc allowlist.
**Điều kiện PASS bắt buộc:** Chỉ origin hợp lệ được chấp nhận theo cấu hình triển khai; không tin CORS để thay thế xác thực.
**Bằng chứng phải lưu:** Handshake status/close code; event được gắn user/conversation; Redis pub/sub; audit không rò token; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### WSM-007 — Typing không thể giả user [P0]

**Mục tiêu bảo vệ:** Không để socket chưa xác thực, đã thu hồi hoặc không thuộc hội thoại gửi/nhận dữ liệu trái phép.
**Điều kiện/fixture:** A/B/C có hội thoại; C outsider.
**Thao tác kiểm thử:** C gửi TYPING với conversation_id A-B, thêm from_user_id=A.
**Điều kiện PASS bắt buộc:** Không chuyển tới A/B dưới danh tính A/C ngoài quyền; event sai bị reject.
**Bằng chứng phải lưu:** Handshake status/close code; event được gắn user/conversation; Redis pub/sub; audit không rò token; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### WSM-008 — Không nhận sự kiện của user khác [P0]

**Mục tiêu bảo vệ:** Không để socket chưa xác thực, đã thu hồi hoặc không thuộc hội thoại gửi/nhận dữ liệu trái phép.
**Điều kiện/fixture:** A/B/C đều giữ socket; A-B giao tiếp.
**Thao tác kiểm thử:** A gửi tin cho B; theo dõi socket C cùng thời gian.
**Điều kiện PASS bắt buộc:** B nhận event hợp lệ; C không nhận payload tin riêng tư.
**Bằng chứng phải lưu:** Handshake status/close code; event được gắn user/conversation; Redis pub/sub; audit không rò token; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### WSM-009 — Logout khi socket đã mở [P0]

**Mục tiêu bảo vệ:** Không để socket chưa xác thực, đã thu hồi hoặc không thuộc hội thoại gửi/nhận dữ liệu trái phép.
**Điều kiện/fixture:** A có socket active; logout HTTP.
**Thao tác kiểm thử:** Sau logout, chờ nhịp kiểm tra/cố gửi typing/nhận event.
**Điều kiện PASS bắt buộc:** Socket không còn được thực hiện thao tác được bảo vệ sau thời hạn revocation policy; không để lộ message mới.
**Bằng chứng phải lưu:** Handshake status/close code; event được gắn user/conversation; Redis pub/sub; audit không rò token; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### WSM-010 — Hết hạn token khi socket đang mở [P1]

**Mục tiêu bảo vệ:** Không để socket chưa xác thực, đã thu hồi hoặc không thuộc hội thoại gửi/nhận dữ liệu trái phép.
**Điều kiện/fixture:** Token có TTL ngắn trong env test; socket mở trước exp.
**Thao tác kiểm thử:** Chờ sau exp; gửi event và kiểm tra close.
**Điều kiện PASS bắt buộc:** Không tiếp tục quyền quá thời hạn cho phép; giải phóng registry/task.
**Bằng chứng phải lưu:** Handshake status/close code; event được gắn user/conversation; Redis pub/sub; audit không rò token; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### WSM-011 — Tin nhắn JSON bị lỗi [P1]

**Mục tiêu bảo vệ:** Không để socket chưa xác thực, đã thu hồi hoặc không thuộc hội thoại gửi/nhận dữ liệu trái phép.
**Điều kiện/fixture:** Socket A hợp lệ.
**Thao tác kiểm thử:** Gửi JSON sai cú pháp và message không có type.
**Điều kiện PASS bắt buộc:** Nhận lỗi giao thức hợp lệ; không có sự kiện DB/Redis trái phép; socket xử lý policy_violation như thiết kế.
**Bằng chứng phải lưu:** Handshake status/close code; event được gắn user/conversation; Redis pub/sub; audit không rò token; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### WSM-012 — Type ngoài allowlist [P1]

**Mục tiêu bảo vệ:** Không để socket chưa xác thực, đã thu hồi hoặc không thuộc hội thoại gửi/nhận dữ liệu trái phép.
**Điều kiện/fixture:** A có socket.
**Thao tác kiểm thử:** Gửi loại NEW_MESSAGE, CALL_INCOMING hoặc MESSAGE_STATUS_UPDATE từ client.
**Điều kiện PASS bắt buộc:** Không cho client giả mạo sự kiện server; B không nhận payload giả.
**Bằng chứng phải lưu:** Handshake status/close code; event được gắn user/conversation; Redis pub/sub; audit không rò token; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### WSM-013 — Payload quá lớn [P1]

**Mục tiêu bảo vệ:** Không để socket chưa xác thực, đã thu hồi hoặc không thuộc hội thoại gửi/nhận dữ liệu trái phép.
**Điều kiện/fixture:** A có socket; giới hạn text message cấu hình.
**Thao tác kiểm thử:** Gửi frame vượt mức cấu hình trong môi trường test có chặn tài nguyên.
**Điều kiện PASS bắt buộc:** Kết nối bị hạn chế/đóng theo policy, không crash backend hoặc ảnh hưởng user B.
**Bằng chứng phải lưu:** Handshake status/close code; event được gắn user/conversation; Redis pub/sub; audit không rò token; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### WSM-014 — Liên tiếp sai contract đến ngưỡng [P1]

**Mục tiêu bảo vệ:** Không để socket chưa xác thực, đã thu hồi hoặc không thuộc hội thoại gửi/nhận dữ liệu trái phép.
**Điều kiện/fixture:** A có socket mới.
**Thao tác kiểm thử:** Gửi các event sai cấu trúc đến ngưỡng vi phạm đã xác nhận từ code.
**Điều kiện PASS bắt buộc:** Có ERROR và close theo policy; không giữ socket xấu vô hạn.
**Bằng chứng phải lưu:** Handshake status/close code; event được gắn user/conversation; Redis pub/sub; audit không rò token; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### WSM-015 — PONG giả không làm nâng quyền [P1]

**Mục tiêu bảo vệ:** Không để socket chưa xác thực, đã thu hồi hoặc không thuộc hội thoại gửi/nhận dữ liệu trái phép.
**Điều kiện/fixture:** A socket hợp lệ, C không hợp lệ.
**Thao tác kiểm thử:** Gửi PONG chứa user_id khác hoặc fields lạ; C thử gửi PONG qua socket unauthorized.
**Điều kiện PASS bắt buộc:** Không thay danh tính; socket unauthorized không trở thành authenticated.
**Bằng chứng phải lưu:** Handshake status/close code; event được gắn user/conversation; Redis pub/sub; audit không rò token; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### WSM-016 — Nhiều tab cùng user nhưng cô lập xác thực [P1]

**Mục tiêu bảo vệ:** Không để socket chưa xác thực, đã thu hồi hoặc không thuộc hội thoại gửi/nhận dữ liệu trái phép.
**Điều kiện/fixture:** A có hai socket; một token logout hoặc revoked.
**Thao tác kiểm thử:** Duy trì hai socket với token cụ thể rồi thu hồi một phiên.
**Điều kiện PASS bắt buộc:** Cả hai tuân theo policy token/phiên đã xác nhận; không dùng trạng thái của socket khác để qua auth.
**Bằng chứng phải lưu:** Handshake status/close code; event được gắn user/conversation; Redis pub/sub; audit không rò token; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### WSM-017 — Không lộ JWT trong lỗi/log handshake [P1]

**Mục tiêu bảo vệ:** Không để socket chưa xác thực, đã thu hồi hoặc không thuộc hội thoại gửi/nhận dữ liệu trái phép.
**Điều kiện/fixture:** Test với token sentinel riêng.
**Thao tác kiểm thử:** Thử handshake sai, xem backend log/access log/report.
**Điều kiện PASS bắt buộc:** Không ghi toàn bộ query token, Authorization hay stacktrace chứa token vào artifact.
**Bằng chứng phải lưu:** Handshake status/close code; event được gắn user/conversation; Redis pub/sub; audit không rò token; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### WSM-018 — Heartbeat không bỏ qua kiểm tra quyền [P1]

**Mục tiêu bảo vệ:** Không để socket chưa xác thực, đã thu hồi hoặc không thuộc hội thoại gửi/nhận dữ liệu trái phép.
**Điều kiện/fixture:** A có socket, token bị thu hồi khi đang kết nối.
**Thao tác kiểm thử:** Chờ heartbeat; thử tiếp nhận TYPING/NEW_MESSAGE.
**Điều kiện PASS bắt buộc:** Thu hồi có hiệu lực theo policy; không cho nhận tin chỉ vì PONG vẫn được gửi.
**Bằng chứng phải lưu:** Handshake status/close code; event được gắn user/conversation; Redis pub/sub; audit không rò token; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### WSM-019 — Không giữ event trái quyền trong buffer [P1]

**Mục tiêu bảo vệ:** Không để socket chưa xác thực, đã thu hồi hoặc không thuộc hội thoại gửi/nhận dữ liệu trái phép.
**Điều kiện/fixture:** A/B/C và nhiều socket; tạo vài event chỉ của A-B.
**Thao tác kiểm thử:** C subscribe/mở socket rồi quan sát sau reconnect.
**Điều kiện PASS bắt buộc:** Không nhận event tồn đọng thuộc A-B hoặc event gắn sai session.
**Bằng chứng phải lưu:** Handshake status/close code; event được gắn user/conversation; Redis pub/sub; audit không rò token; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

### SIG — Node signaling: quyền gọi, danh tính và vòng đời phiên (21 kịch bản)

**Mục tiêu:** Bảo vệ kênh signaling khỏi token thu hồi, giả mạo người gọi, relay trái phép và thao túng trạng thái cuộc gọi.
**Nguồn đối chiếu:** `Nguồn dựa mô tả E2E E08–E10 và báo cáo Codex; chưa có signaling/src đầy đủ để xác minh code phiên bản 19/10`.
**Bằng chứng điển hình:** WS handshake/close/event; cuộc gọi A-B-C và messaging CALL_INCOMING; log signaling; state phiên; correlation id khi có.

#### SIG-001 — Token logout bị signaling từ chối [P0]

**Mục tiêu bảo vệ:** Bảo vệ kênh signaling khỏi token thu hồi, giả mạo người gọi, relay trái phép và thao túng trạng thái cuộc gọi.
**Điều kiện/fixture:** A có access từ backend rồi logout thật.
**Thao tác kiểm thử:** Mở /ws/signaling bằng access cũ.
**Điều kiện PASS bắt buộc:** Từ chối kết nối hoặc đóng trước hành động có quyền; không relay call; BUG LỊCH SỬ E10.
**Bằng chứng phải lưu:** WS handshake/close/event; cuộc gọi A-B-C và messaging CALL_INCOMING; log signaling; state phiên; correlation id khi có; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### SIG-002 — Token không hợp lệ bị từ chối [P0]

**Mục tiêu bảo vệ:** Bảo vệ kênh signaling khỏi token thu hồi, giả mạo người gọi, relay trái phép và thao túng trạng thái cuộc gọi.
**Điều kiện/fixture:** A có token thử sai chữ ký và malformed.
**Thao tác kiểm thử:** Thử mở signaling với từng token.
**Điều kiện PASS bắt buộc:** Không mở socket có quyền, không lộ secret hoặc claims.
**Bằng chứng phải lưu:** WS handshake/close/event; cuộc gọi A-B-C và messaging CALL_INCOMING; log signaling; state phiên; correlation id khi có; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### SIG-003 — Token refresh không trở thành access signaling [P0]

**Mục tiêu bảo vệ:** Bảo vệ kênh signaling khỏi token thu hồi, giả mạo người gọi, relay trái phép và thao túng trạng thái cuộc gọi.
**Điều kiện/fixture:** A có refresh token.
**Thao tác kiểm thử:** Dùng refresh để bắt tay /ws/signaling.
**Điều kiện PASS bắt buộc:** Không có kết nối signaling được xác thực.
**Bằng chứng phải lưu:** WS handshake/close/event; cuộc gọi A-B-C và messaging CALL_INCOMING; log signaling; state phiên; correlation id khi có; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### SIG-004 — Không giả from_user_id trong CALL_OFFER [P0]

**Mục tiêu bảo vệ:** Bảo vệ kênh signaling khỏi token thu hồi, giả mạo người gọi, relay trái phép và thao túng trạng thái cuộc gọi.
**Điều kiện/fixture:** A/B/C có socket.
**Thao tác kiểm thử:** C gửi CALL_OFFER cho B, kèm from_user_id=A.
**Điều kiện PASS bắt buộc:** B không thấy A là người gọi nếu A không thực hiện thao tác; danh tính do session quyết định.
**Bằng chứng phải lưu:** WS handshake/close/event; cuộc gọi A-B-C và messaging CALL_INCOMING; log signaling; state phiên; correlation id khi có; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### SIG-005 — Không giả người trả lời cuộc gọi [P0]

**Mục tiêu bảo vệ:** Bảo vệ kênh signaling khỏi token thu hồi, giả mạo người gọi, relay trái phép và thao túng trạng thái cuộc gọi.
**Điều kiện/fixture:** A gọi B; C có socket.
**Thao tác kiểm thử:** C gửi CALL_ANSWER hoặc ICE_CANDIDATE tới A khi không thuộc session.
**Điều kiện PASS bắt buộc:** A không nhận answer/ICE giả; state call không bị thay đổi.
**Bằng chứng phải lưu:** WS handshake/close/event; cuộc gọi A-B-C và messaging CALL_INCOMING; log signaling; state phiên; correlation id khi có; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### SIG-006 — Không kết thúc cuộc gọi người khác [P0]

**Mục tiêu bảo vệ:** Bảo vệ kênh signaling khỏi token thu hồi, giả mạo người gọi, relay trái phép và thao túng trạng thái cuộc gọi.
**Điều kiện/fixture:** A-B có call pending/active; C outsider.
**Thao tác kiểm thử:** C gửi CALL_END target A hoặc B.
**Điều kiện PASS bắt buộc:** Không kết thúc call A-B; C nhận lỗi/không tác động theo contract.
**Bằng chứng phải lưu:** WS handshake/close/event; cuộc gọi A-B-C và messaging CALL_INCOMING; log signaling; state phiên; correlation id khi có; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### SIG-007 — B kết nối signaling sau CALL_INCOMING [P0]

**Mục tiêu bảo vệ:** Bảo vệ kênh signaling khỏi token thu hồi, giả mạo người gọi, relay trái phép và thao túng trạng thái cuộc gọi.
**Điều kiện/fixture:** A mở signaling; B chỉ messaging.
**Thao tác kiểm thử:** A gọi B; B nhận CALL_INCOMING rồi mở signaling.
**Điều kiện PASS bắt buộc:** Offer đến B một cách xác thực trong cửa sổ cho phép; không chuyển cho user khác; BUG LỊCH SỬ E09.
**Bằng chứng phải lưu:** WS handshake/close/event; cuộc gọi A-B-C và messaging CALL_INCOMING; log signaling; state phiên; correlation id khi có; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### SIG-008 — Không chuyển offer bị lưu cho tài khoản khác [P0]

**Mục tiêu bảo vệ:** Bảo vệ kênh signaling khỏi token thu hồi, giả mạo người gọi, relay trái phép và thao túng trạng thái cuộc gọi.
**Điều kiện/fixture:** B có offer pending, C có socket; B kết nối muộn.
**Thao tác kiểm thử:** C thử nhận/replay thông tin call/session của B.
**Điều kiện PASS bắt buộc:** Chỉ B có quyền nhận offer; C không nhận SDP/ICE chứa thông tin mạng của B.
**Bằng chứng phải lưu:** WS handshake/close/event; cuộc gọi A-B-C và messaging CALL_INCOMING; log signaling; state phiên; correlation id khi có; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### SIG-009 — Không relay ICE tới target tùy ý [P0]

**Mục tiêu bảo vệ:** Bảo vệ kênh signaling khỏi token thu hồi, giả mạo người gọi, relay trái phép và thao túng trạng thái cuộc gọi.
**Điều kiện/fixture:** A-B đang gọi; C là người ngoài.
**Thao tác kiểm thử:** A/C gửi ICE_CANDIDATE với target khác member phiên.
**Điều kiện PASS bắt buộc:** Không relay tới user ngoài quan hệ call đang có.
**Bằng chứng phải lưu:** WS handshake/close/event; cuộc gọi A-B-C và messaging CALL_INCOMING; log signaling; state phiên; correlation id khi có; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### SIG-010 — Offer lại khi đang pending [P1]

**Mục tiêu bảo vệ:** Bảo vệ kênh signaling khỏi token thu hồi, giả mạo người gọi, relay trái phép và thao túng trạng thái cuộc gọi.
**Điều kiện/fixture:** A/B có pending call.
**Thao tác kiểm thử:** A gửi CALL_OFFER thứ hai trước khi B trả lời.
**Điều kiện PASS bắt buộc:** Hành vi trùng/cuộc gọi mới tuân thủ state machine đã chốt, không tạo nhầm session trái phép.
**Bằng chứng phải lưu:** WS handshake/close/event; cuộc gọi A-B-C và messaging CALL_INCOMING; log signaling; state phiên; correlation id khi có; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### SIG-011 — Answer trước offer [P1]

**Mục tiêu bảo vệ:** Bảo vệ kênh signaling khỏi token thu hồi, giả mạo người gọi, relay trái phép và thao túng trạng thái cuộc gọi.
**Điều kiện/fixture:** A/B có signaling, chưa có cuộc gọi.
**Thao tác kiểm thử:** B gửi CALL_ANSWER trước CALL_OFFER.
**Điều kiện PASS bắt buộc:** Không tạo active call không có offer; phản hồi kiểm soát.
**Bằng chứng phải lưu:** WS handshake/close/event; cuộc gọi A-B-C và messaging CALL_INCOMING; log signaling; state phiên; correlation id khi có; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### SIG-012 — ICE sau END hoặc REJECT [P1]

**Mục tiêu bảo vệ:** Bảo vệ kênh signaling khỏi token thu hồi, giả mạo người gọi, relay trái phép và thao túng trạng thái cuộc gọi.
**Điều kiện/fixture:** A/B đã kết thúc hoặc từ chối.
**Thao tác kiểm thử:** Gửi ICE_CANDIDATE và CALL_ANSWER thuộc phiên cũ.
**Điều kiện PASS bắt buộc:** Không hồi sinh phiên đã kết thúc; không relay thông điệp trái state.
**Bằng chứng phải lưu:** WS handshake/close/event; cuộc gọi A-B-C và messaging CALL_INCOMING; log signaling; state phiên; correlation id khi có; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### SIG-013 — Không giả call id hoặc session id [P1]

**Mục tiêu bảo vệ:** Bảo vệ kênh signaling khỏi token thu hồi, giả mạo người gọi, relay trái phép và thao túng trạng thái cuộc gọi.
**Điều kiện/fixture:** A/B có phiên, C outsider.
**Thao tác kiểm thử:** Thử gắn call/session ID đã biết vào message C.
**Điều kiện PASS bắt buộc:** Không giành quyền phiên A-B; state không thay đổi.
**Bằng chứng phải lưu:** WS handshake/close/event; cuộc gọi A-B-C và messaging CALL_INCOMING; log signaling; state phiên; correlation id khi có; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### SIG-014 — Tài khoản bị xóa đang có signaling [P1]

**Mục tiêu bảo vệ:** Bảo vệ kênh signaling khỏi token thu hồi, giả mạo người gọi, relay trái phép và thao túng trạng thái cuộc gọi.
**Điều kiện/fixture:** A đã có socket, sau đó xóa tài khoản.
**Thao tác kiểm thử:** A thử gửi offer/ICE và reconnect.
**Điều kiện PASS bắt buộc:** Bị ngăn theo policy thu hồi tài khoản; không tiếp tục relay hợp lệ.
**Bằng chứng phải lưu:** WS handshake/close/event; cuộc gọi A-B-C và messaging CALL_INCOMING; log signaling; state phiên; correlation id khi có; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### SIG-015 — Giới hạn kết nối theo IP/user [P1]

**Mục tiêu bảo vệ:** Bảo vệ kênh signaling khỏi token thu hồi, giả mạo người gọi, relay trái phép và thao túng trạng thái cuộc gọi.
**Điều kiện/fixture:** Môi trường riêng; policy được xác nhận từ code/config.
**Thao tác kiểm thử:** Tăng số kết nối thử đến sát giới hạn an toàn, không phát tải rộng.
**Điều kiện PASS bắt buộc:** Vượt ngưỡng bị giới hạn theo policy; A/B khác không bị ảnh hưởng ngoài thiết kế.
**Bằng chứng phải lưu:** WS handshake/close/event; cuộc gọi A-B-C và messaging CALL_INCOMING; log signaling; state phiên; correlation id khi có; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### SIG-016 — Token ký khác key/backend [P1]

**Mục tiêu bảo vệ:** Bảo vệ kênh signaling khỏi token thu hồi, giả mạo người gọi, relay trái phép và thao túng trạng thái cuộc gọi.
**Điều kiện/fixture:** Signaling và Spring có cấu hình secret test.
**Thao tác kiểm thử:** Dùng token signed bởi key không hợp lệ hoặc loại JWT khác.
**Điều kiện PASS bắt buộc:** Signaling từ chối; không chấp nhận token chỉ dựa vào payload.
**Bằng chứng phải lưu:** WS handshake/close/event; cuộc gọi A-B-C và messaging CALL_INCOMING; log signaling; state phiên; correlation id khi có; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### SIG-017 — Không đưa JWT qua log signaling [P1]

**Mục tiêu bảo vệ:** Bảo vệ kênh signaling khỏi token thu hồi, giả mạo người gọi, relay trái phép và thao túng trạng thái cuộc gọi.
**Điều kiện/fixture:** Token sentinel hợp lệ và token sai.
**Thao tác kiểm thử:** Mở/đóng socket và phát lỗi.
**Điều kiện PASS bắt buộc:** Log không chứa chuỗi JWT gốc, query string nhạy cảm, secret.
**Bằng chứng phải lưu:** WS handshake/close/event; cuộc gọi A-B-C và messaging CALL_INCOMING; log signaling; state phiên; correlation id khi có; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### SIG-018 — Không giữ pending offer vô hạn [P1]

**Mục tiêu bảo vệ:** Bảo vệ kênh signaling khỏi token thu hồi, giả mạo người gọi, relay trái phép và thao túng trạng thái cuộc gọi.
**Điều kiện/fixture:** A gửi offer, B không trả lời và không online.
**Thao tác kiểm thử:** Chờ đến timeout đã chốt, kiểm tra trạng thái.
**Điều kiện PASS bắt buộc:** Pending state hết hạn, không chuyển offer đã quá hạn cho B; tài nguyên được giải phóng.
**Bằng chứng phải lưu:** WS handshake/close/event; cuộc gọi A-B-C và messaging CALL_INCOMING; log signaling; state phiên; correlation id khi có; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### SIG-019 — Chống nhầm hai cuộc gọi đồng thời [P1]

**Mục tiêu bảo vệ:** Bảo vệ kênh signaling khỏi token thu hồi, giả mạo người gọi, relay trái phép và thao túng trạng thái cuộc gọi.
**Điều kiện/fixture:** A gọi B và C có hai cuộc gọi hợp lệ theo contract hoặc bị chặn.
**Thao tác kiểm thử:** Gửi Answer/ICE/End interleaved.
**Điều kiện PASS bắt buộc:** Không trộn SDP/ICE hoặc gán phiên chéo giữa các cặp.
**Bằng chứng phải lưu:** WS handshake/close/event; cuộc gọi A-B-C và messaging CALL_INCOMING; log signaling; state phiên; correlation id khi có; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### SIG-020 — Không tiết lộ nội dung signaling qua notify nội bộ [P1]

**Mục tiêu bảo vệ:** Bảo vệ kênh signaling khỏi token thu hồi, giả mạo người gọi, relay trái phép và thao túng trạng thái cuộc gọi.
**Điều kiện/fixture:** A/B/C hợp lệ; B nhận CALL_INCOMING.
**Thao tác kiểm thử:** So sánh payload notify cho B, C và sự kiện OFFER.
**Điều kiện PASS bắt buộc:** Chỉ truyền trường được phép; C không được thấy SDP, ICE, thông tin cuộc gọi riêng.
**Bằng chứng phải lưu:** WS handshake/close/event; cuộc gọi A-B-C và messaging CALL_INCOMING; log signaling; state phiên; correlation id khi có; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### SIG-021 — Kết nối đang mở sau logout [P1]

**Mục tiêu bảo vệ:** Bảo vệ kênh signaling khỏi token thu hồi, giả mạo người gọi, relay trái phép và thao túng trạng thái cuộc gọi.
**Điều kiện/fixture:** A có signaling đang mở trước logout.
**Thao tác kiểm thử:** A logout HTTP, rồi thử call event khi socket chưa đóng.
**Điều kiện PASS bắt buộc:** Không relay sau revocation theo chính sách đã chốt; test cả thời hạn kiểm tra định kỳ.
**Bằng chứng phải lưu:** WS handshake/close/event; cuộc gọi A-B-C và messaging CALL_INCOMING; log signaling; state phiên; correlation id khi có; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

### VID — An toàn video, MinIO và presigned URL (26 kịch bản)

**Mục tiêu:** Đảm bảo uploadId, chữ ký URL, ownership, quota và webhook không trở thành đường truy cập file trái phép.
**Nguồn đối chiếu:** `video/VideoController.java; VideoService.java; MinioMultipartStorage.java; RedisVideoUploadSessionStore.java; VideoWebhookService.java; VideoWebhookAuthenticationFilter.java`.
**Bằng chứng điển hình:** SQL videos + quota; Redis session; MinIO listParts/object; HTTP response; presigned query được che khỏi log.

#### VID-001 — Owner không thể đọc object video người khác [P0]

**Mục tiêu bảo vệ:** Đảm bảo uploadId, chữ ký URL, ownership, quota và webhook không trở thành đường truy cập file trái phép.
**Điều kiện/fixture:** B có video ready.
**Thao tác kiểm thử:** A GET /videos/{idB} rồi thử dùng thông tin không được cấp.
**Điều kiện PASS bắt buộc:** Không trả presigned download URL của B; object B chỉ đọc qua quyền được cấp.
**Bằng chứng phải lưu:** SQL videos + quota; Redis session; MinIO listParts/object; HTTP response; presigned query được che khỏi log; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### VID-002 — Không chiếm quyền upload bằng video ID B [P0]

**Mục tiêu bảo vệ:** Đảm bảo uploadId, chữ ký URL, ownership, quota và webhook không trở thành đường truy cập file trái phép.
**Điều kiện/fixture:** A/B có video recording.
**Thao tác kiểm thử:** A /videos/{idB}/chunks với idB và uploadId B.
**Điều kiện PASS bắt buộc:** Từ chối; MinIO part và Redis session B không đổi.
**Bằng chứng phải lưu:** SQL videos + quota; Redis session; MinIO listParts/object; HTTP response; presigned query được che khỏi log; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### VID-003 — Không chiếm quyền finalize bằng upload_id B [P0]

**Mục tiêu bảo vệ:** Đảm bảo uploadId, chữ ký URL, ownership, quota và webhook không trở thành đường truy cập file trái phép.
**Điều kiện/fixture:** A/B đang upload.
**Thao tác kiểm thử:** A gọi finalize cho video B với thông tin parts đúng.
**Điều kiện PASS bắt buộc:** Không thể finalize hoặc chuyển READY; quota không đổi.
**Bằng chứng phải lưu:** SQL videos + quota; Redis session; MinIO listParts/object; HTTP response; presigned query được che khỏi log; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### VID-004 — Không chiếm quyền abort bằng upload_id B [P0]

**Mục tiêu bảo vệ:** Đảm bảo uploadId, chữ ký URL, ownership, quota và webhook không trở thành đường truy cập file trái phép.
**Điều kiện/fixture:** A/B upload.
**Thao tác kiểm thử:** A abort video của B.
**Điều kiện PASS bắt buộc:** Không hủy phiên B; Redis session B vẫn tồn tại.
**Bằng chứng phải lưu:** SQL videos + quota; Redis session; MinIO listParts/object; HTTP response; presigned query được che khỏi log; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### VID-005 — Presigned URL bị thay đổi chữ ký [P0]

**Mục tiêu bảo vệ:** Đảm bảo uploadId, chữ ký URL, ownership, quota và webhook không trở thành đường truy cập file trái phép.
**Điều kiện/fixture:** A được cấp URL PUT hoặc GET.
**Thao tác kiểm thử:** Thay một trường chữ ký/path/part/expiry trong URL của fixture.
**Điều kiện PASS bắt buộc:** MinIO từ chối khi chữ ký không còn hợp lệ; không ghi/đọc ngoài object cho phép.
**Bằng chứng phải lưu:** SQL videos + quota; Redis session; MinIO listParts/object; HTTP response; presigned query được che khỏi log; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### VID-006 — Presigned URL hết hạn [P0]

**Mục tiêu bảo vệ:** Đảm bảo uploadId, chữ ký URL, ownership, quota và webhook không trở thành đường truy cập file trái phép.
**Điều kiện/fixture:** A có URL TTL ngắn trên env test.
**Thao tác kiểm thử:** Đợi thời điểm hết hạn chắc chắn rồi PUT/GET URL cũ.
**Điều kiện PASS bắt buộc:** Không còn dùng được sau expiry; không đổi DB/video status trái phép.
**Bằng chứng phải lưu:** SQL videos + quota; Redis session; MinIO listParts/object; HTTP response; presigned query được che khỏi log; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### VID-007 — Webhook giả không có secret [P0]

**Mục tiêu bảo vệ:** Đảm bảo uploadId, chữ ký URL, ownership, quota và webhook không trở thành đường truy cập file trái phép.
**Điều kiện/fixture:** Video PROCESSING, webhook endpoint.
**Thao tác kiểm thử:** POST hoàn tất bằng body hợp lệ nhưng không có shared secret.
**Điều kiện PASS bắt buộc:** Không đổi trạng thái sang READY; không đánh dấu session hoàn tất.
**Bằng chứng phải lưu:** SQL videos + quota; Redis session; MinIO listParts/object; HTTP response; presigned query được che khỏi log; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### VID-008 — Webhook secret sai hoặc access JWT [P0]

**Mục tiêu bảo vệ:** Đảm bảo uploadId, chữ ký URL, ownership, quota và webhook không trở thành đường truy cập file trái phép.
**Điều kiện/fixture:** Video PROCESSING; A có JWT.
**Thao tác kiểm thử:** Gửi webhook với secret sai hoặc token A.
**Điều kiện PASS bắt buộc:** Không đổi DB/quota; lỗi không tiết lộ webhook secret.
**Bằng chứng phải lưu:** SQL videos + quota; Redis session; MinIO listParts/object; HTTP response; presigned query được che khỏi log; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### VID-009 — Webhook đúng secret nhưng object không khớp [P0]

**Mục tiêu bảo vệ:** Đảm bảo uploadId, chữ ký URL, ownership, quota và webhook không trở thành đường truy cập file trái phép.
**Điều kiện/fixture:** Test webhook secret trong env cô lập; video processing A.
**Thao tác kiểm thử:** Gửi event trỏ sang objectKey/videoID khác hoặc object chưa hoàn thành.
**Điều kiện PASS bắt buộc:** Không READY sai video, không tăng quota hoặc cấp URL giả.
**Bằng chứng phải lưu:** SQL videos + quota; Redis session; MinIO listParts/object; HTTP response; presigned query được che khỏi log; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### VID-010 — Quota không vượt bằng giá trị ước tính nhỏ [P0]

**Mục tiêu bảo vệ:** Đảm bảo uploadId, chữ ký URL, ownership, quota và webhook không trở thành đường truy cập file trái phép.
**Điều kiện/fixture:** A gần hết quota; fixture part thực tế hợp lệ.
**Thao tác kiểm thử:** Khởi tạo estimated nhỏ, upload bytes thực tế lớn hơn đến mức chạm quota.
**Điều kiện PASS bắt buộc:** Finalize hoặc admission kiểm tra dung lượng thực, không READY vượt quota.
**Bằng chứng phải lưu:** SQL videos + quota; Redis session; MinIO listParts/object; HTTP response; presigned query được che khỏi log; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### VID-011 — Không hoàn tất upload với ETag giả [P0]

**Mục tiêu bảo vệ:** Đảm bảo uploadId, chữ ký URL, ownership, quota và webhook không trở thành đường truy cập file trái phép.
**Điều kiện/fixture:** A upload 2 parts thật.
**Thao tác kiểm thử:** Finalize với ETag một part không khớp MinIO.
**Điều kiện PASS bắt buộc:** Không READY sai dữ liệu; không mất phiên cho phép xử lý hợp lệ theo contract.
**Bằng chứng phải lưu:** SQL videos + quota; Redis session; MinIO listParts/object; HTTP response; presigned query được che khỏi log; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### VID-012 — Không hoàn tất với missing/duplicate part [P0]

**Mục tiêu bảo vệ:** Đảm bảo uploadId, chữ ký URL, ownership, quota và webhook không trở thành đường truy cập file trái phép.
**Điều kiện/fixture:** A có multipart thật.
**Thao tác kiểm thử:** Finalize thiếu part, lặp partNumber hoặc sai thứ tự theo quy định.
**Điều kiện PASS bắt buộc:** Không ghép đối tượng sai; status/quota đúng.
**Bằng chứng phải lưu:** SQL videos + quota; Redis session; MinIO listParts/object; HTTP response; presigned query được che khỏi log; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### VID-013 — URL GET không rò qua JSON người ngoài [P1]

**Mục tiêu bảo vệ:** Đảm bảo uploadId, chữ ký URL, ownership, quota và webhook không trở thành đường truy cập file trái phép.
**Điều kiện/fixture:** B có READY video.
**Thao tác kiểm thử:** A GET video B, list video, search/profile.
**Điều kiện PASS bắt buộc:** Không có view_url, storage_path hoặc upload_id của B trong response A.
**Bằng chứng phải lưu:** SQL videos + quota; Redis session; MinIO listParts/object; HTTP response; presigned query được che khỏi log; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### VID-014 — Đóng session upload rồi URL cũ không dùng tiếp [P1]

**Mục tiêu bảo vệ:** Đảm bảo uploadId, chữ ký URL, ownership, quota và webhook không trở thành đường truy cập file trái phép.
**Điều kiện/fixture:** A có upload, URL đã cấp.
**Thao tác kiểm thử:** Abort upload; sau đó dùng PUT presigned URL cũ.
**Điều kiện PASS bắt buộc:** Object upload không tiếp tục hợp lệ; không tạo video READY trái phép.
**Bằng chứng phải lưu:** SQL videos + quota; Redis session; MinIO listParts/object; HTTP response; presigned query được che khỏi log; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### VID-015 — Không dùng một URL cho part/object khác [P1]

**Mục tiêu bảo vệ:** Đảm bảo uploadId, chữ ký URL, ownership, quota và webhook không trở thành đường truy cập file trái phép.
**Điều kiện/fixture:** A có presigned PUT cho part 1.
**Thao tác kiểm thử:** Thử dùng URL cho key/part khác hoặc upload ID khác.
**Điều kiện PASS bắt buộc:** Chữ ký/ràng buộc request không cho ghi vào đối tượng ngoài phạm vi.
**Bằng chứng phải lưu:** SQL videos + quota; Redis session; MinIO listParts/object; HTTP response; presigned query được che khỏi log; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### VID-016 — Object key được cô lập [P1]

**Mục tiêu bảo vệ:** Đảm bảo uploadId, chữ ký URL, ownership, quota và webhook không trở thành đường truy cập file trái phép.
**Điều kiện/fixture:** A/B tạo nhiều phiên video mới.
**Thao tác kiểm thử:** Kiểm tra objectKey qua DB test; đối chiếu URL thuộc từng phiên.
**Điều kiện PASS bắt buộc:** Key không trùng; client không thể tự chỉ định object key để ghi đè file B.
**Bằng chứng phải lưu:** SQL videos + quota; Redis session; MinIO listParts/object; HTTP response; presigned query được che khỏi log; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### VID-017 — Multipart rác sau lỗi khởi tạo [P1]

**Mục tiêu bảo vệ:** Đảm bảo uploadId, chữ ký URL, ownership, quota và webhook không trở thành đường truy cập file trái phép.
**Điều kiện/fixture:** Dịch vụ MinIO/Redis test cô lập; cho phép fault injection riêng.
**Thao tác kiểm thử:** Mô phỏng DB hoặc Redis thất bại sau createMultipartUpload.
**Điều kiện PASS bắt buộc:** Có cơ chế dọn hoặc phát hiện session mồ côi đã được chốt; không tích lũy tài nguyên không thể truy vết.
**Bằng chứng phải lưu:** SQL videos + quota; Redis session; MinIO listParts/object; HTTP response; presigned query được che khỏi log; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### VID-018 — Webhook lặp nhiều lần [P1]

**Mục tiêu bảo vệ:** Đảm bảo uploadId, chữ ký URL, ownership, quota và webhook không trở thành đường truy cập file trái phép.
**Điều kiện/fixture:** Video PROCESSING rồi READY sau webhook thật.
**Thao tác kiểm thử:** Gửi lặp event completion cùng object bằng credential test.
**Điều kiện PASS bắt buộc:** Không cộng quota nhiều lần, không tạo side effect mới, dữ liệu cuối nhất quán.
**Bằng chứng phải lưu:** SQL videos + quota; Redis session; MinIO listParts/object; HTTP response; presigned query được che khỏi log; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### VID-019 — Webhook đến sau DELETE/ABORT [P1]

**Mục tiêu bảo vệ:** Đảm bảo uploadId, chữ ký URL, ownership, quota và webhook không trở thành đường truy cập file trái phép.
**Điều kiện/fixture:** A có upload đã hủy hoặc video bị xóa.
**Thao tác kiểm thử:** Gửi event completion cũ hợp lệ credential cho object/video cũ.
**Điều kiện PASS bắt buộc:** Không hồi sinh video hoặc làm tăng quota sai.
**Bằng chứng phải lưu:** SQL videos + quota; Redis session; MinIO listParts/object; HTTP response; presigned query được che khỏi log; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### VID-020 — Chống content-type hoặc extension giả [P1]

**Mục tiêu bảo vệ:** Đảm bảo uploadId, chữ ký URL, ownership, quota và webhook không trở thành đường truy cập file trái phép.
**Điều kiện/fixture:** Video multipart webm/mp4, fixture thật và bytes giả.
**Thao tác kiểm thử:** Upload bytes không đúng codec/format được khai báo; finalize.
**Điều kiện PASS bắt buộc:** Kết luận theo policy media validation: nếu chỉ lưu byte, ghi risk accepted; nếu yêu cầu playable thì phải kiểm định, không đánh dấu pass mù.
**Bằng chứng phải lưu:** SQL videos + quota; Redis session; MinIO listParts/object; HTTP response; presigned query được che khỏi log; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### VID-021 — Không lộ MinIO access key trong response [P1]

**Mục tiêu bảo vệ:** Đảm bảo uploadId, chữ ký URL, ownership, quota và webhook không trở thành đường truy cập file trái phép.
**Điều kiện/fixture:** A gọi toàn bộ video API và xử lý lỗi.
**Thao tác kiểm thử:** Kiểm tra JSON, header, log ở các tình huống thành công và sai.
**Điều kiện PASS bắt buộc:** Không hiện accessKey/secretKey/bucket credential hoặc stacktrace có credential.
**Bằng chứng phải lưu:** SQL videos + quota; Redis session; MinIO listParts/object; HTTP response; presigned query được che khỏi log; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### VID-022 — Chỉ được xóa object của owner [P1]

**Mục tiêu bảo vệ:** Đảm bảo uploadId, chữ ký URL, ownership, quota và webhook không trở thành đường truy cập file trái phép.
**Điều kiện/fixture:** B có READY và A thử DELETE idB.
**Thao tác kiểm thử:** A gọi xóa B, kiểm tra MinIO và metadata B.
**Điều kiện PASS bắt buộc:** Không xóa vật lý hoặc mềm nhầm video B.
**Bằng chứng phải lưu:** SQL videos + quota; Redis session; MinIO listParts/object; HTTP response; presigned query được che khỏi log; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### VID-023 — Không phát URL download khi video chưa READY [P1]

**Mục tiêu bảo vệ:** Đảm bảo uploadId, chữ ký URL, ownership, quota và webhook không trở thành đường truy cập file trái phép.
**Điều kiện/fixture:** A có RECORDING hoặc PROCESSING.
**Thao tác kiểm thử:** GET video detail khi chưa hoàn thành upload.
**Điều kiện PASS bắt buộc:** Không có link cho phép tải file chưa được phép hoặc chưa hoàn tất, theo contract.
**Bằng chứng phải lưu:** SQL videos + quota; Redis session; MinIO listParts/object; HTTP response; presigned query được che khỏi log; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### VID-024 — Client không tự sửa file_size_bytes/status [P1]

**Mục tiêu bảo vệ:** Đảm bảo uploadId, chữ ký URL, ownership, quota và webhook không trở thành đường truy cập file trái phép.
**Điều kiện/fixture:** A tạo/finalize và rename video.
**Thao tác kiểm thử:** Chèn trường JSON file_size_bytes=0, status=ready, storage_path giả.
**Điều kiện PASS bắt buộc:** Server chỉ tin giá trị xác minh bởi DB/MinIO; không ghi đè trường hệ thống.
**Bằng chứng phải lưu:** SQL videos + quota; Redis session; MinIO listParts/object; HTTP response; presigned query được che khỏi log; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### VID-025 — Đường webhook không truy cập bằng CORS/origin [P1]

**Mục tiêu bảo vệ:** Đảm bảo uploadId, chữ ký URL, ownership, quota và webhook không trở thành đường truy cập file trái phép.
**Điều kiện/fixture:** Origin lạ và không có secret; event giả.
**Thao tác kiểm thử:** POST /internal/videos/webhook với Origin giả được phép/cấm.
**Điều kiện PASS bắt buộc:** Origin không thay cho secret; không đổi trạng thái nếu thiếu xác thực nội bộ.
**Bằng chứng phải lưu:** SQL videos + quota; Redis session; MinIO listParts/object; HTTP response; presigned query được che khỏi log; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### VID-026 — Presigned URL không bị log toàn chuỗi [P1]

**Mục tiêu bảo vệ:** Đảm bảo uploadId, chữ ký URL, ownership, quota và webhook không trở thành đường truy cập file trái phép.
**Điều kiện/fixture:** Fixture URL PUT và GET chứa chữ ký.
**Thao tác kiểm thử:** Kiểm tra runner, proxy, backend, MinIO log và lỗi test.
**Điều kiện PASS bắt buộc:** Không lưu URL có query chữ ký toàn phần vào artifact không bảo vệ.
**Bằng chứng phải lưu:** SQL videos + quota; Redis session; MinIO listParts/object; HTTP response; presigned query được che khỏi log; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

### INPUT — Đầu vào bất thường, serialization và injection (16 kịch bản)

**Mục tiêu:** Đảm bảo dữ liệu do client cung cấp không thể thay đổi logic ngoài contract, phá vỡ parser hay làm lộ hệ thống.
**Nguồn đối chiếu:** `DTO dưới auth/user/avatar/messaging/video/metrics; auth/ApiExceptionHandler.java; các Repository/JPA`.
**Bằng chứng điển hình:** Response không 5xx không chủ ý; DB trước/sau; log sanitized; service sống sau request.

#### INPUT-001 — JSON syntax hỏng trên endpoint bảo vệ [P0]

**Mục tiêu bảo vệ:** Đảm bảo dữ liệu do client cung cấp không thể thay đổi logic ngoài contract, phá vỡ parser hay làm lộ hệ thống.
**Điều kiện/fixture:** A JWT hợp lệ; API có body JSON.
**Thao tác kiểm thử:** Gửi JSON không parse được, UTF-8 không hợp lệ theo môi trường có thể kiểm soát.
**Điều kiện PASS bắt buộc:** Lỗi client theo contract; không stacktrace hoặc tác dụng phụ.
**Bằng chứng phải lưu:** Response không 5xx không chủ ý; DB trước/sau; log sanitized; service sống sau request; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### INPUT-002 — Mass assignment user/role [P0]

**Mục tiêu bảo vệ:** Đảm bảo dữ liệu do client cung cấp không thể thay đổi logic ngoài contract, phá vỡ parser hay làm lộ hệ thống.
**Điều kiện/fixture:** A/B có dữ liệu thật.
**Thao tác kiểm thử:** Trong payload update/profile/avatar/video, thêm trường server-only id/role/owner/status.
**Điều kiện PASS bắt buộc:** Không sửa trường nhạy cảm; nếu strict DTO thì reject; nếu ignore thì chứng minh DB không đổi.
**Bằng chứng phải lưu:** Response không 5xx không chủ ý; DB trước/sau; log sanitized; service sống sau request; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### INPUT-003 — SQL injection qua search [P0]

**Mục tiêu bảo vệ:** Đảm bảo dữ liệu do client cung cấp không thể thay đổi logic ngoài contract, phá vỡ parser hay làm lộ hệ thống.
**Điều kiện/fixture:** A có quyền tìm kiếm.
**Thao tác kiểm thử:** Gửi chuỗi search chứa ký tự điều khiển câu SQL ở mức thử an toàn, không phá hủy dữ liệu.
**Điều kiện PASS bắt buộc:** Không truy xuất dữ liệu vượt quyền hoặc gây lỗi cú pháp DB lộ ra; dữ liệu hệ thống nguyên vẹn.
**Bằng chứng phải lưu:** Response không 5xx không chủ ý; DB trước/sau; log sanitized; service sống sau request; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### INPUT-004 — SQL injection qua cursor/ID [P0]

**Mục tiêu bảo vệ:** Đảm bảo dữ liệu do client cung cấp không thể thay đổi logic ngoài contract, phá vỡ parser hay làm lộ hệ thống.
**Điều kiện/fixture:** A có danh sách hội thoại và video.
**Thao tác kiểm thử:** Dùng cursor và tham số ID chứa ký tự không hợp lệ.
**Điều kiện PASS bắt buộc:** Không ghép SQL không an toàn, không đọc data ngoài phạm vi.
**Bằng chứng phải lưu:** Response không 5xx không chủ ý; DB trước/sau; log sanitized; service sống sau request; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### INPUT-005 — Trường JSON null/sai type [P1]

**Mục tiêu bảo vệ:** Đảm bảo dữ liệu do client cung cấp không thể thay đổi logic ngoài contract, phá vỡ parser hay làm lộ hệ thống.
**Điều kiện/fixture:** A JWT; mỗi DTO quan trọng.
**Thao tác kiểm thử:** Dùng null/object/array/number cho trường string, id, timestamp, status.
**Điều kiện PASS bắt buộc:** Reject theo validator hoặc deserializer; không ghi dữ liệu sai.
**Bằng chứng phải lưu:** Response không 5xx không chủ ý; DB trước/sau; log sanitized; service sống sau request; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### INPUT-006 — Giá trị quá dài và nested sâu có giới hạn [P1]

**Mục tiêu bảo vệ:** Đảm bảo dữ liệu do client cung cấp không thể thay đổi logic ngoài contract, phá vỡ parser hay làm lộ hệ thống.
**Điều kiện/fixture:** Môi trường độc lập, payload tăng có kiểm soát.
**Thao tác kiểm thử:** Gửi request quá giới hạn và JSON lồng sâu hơn mức bình thường.
**Điều kiện PASS bắt buộc:** Có giới hạn xử lý hợp lý; không OOM hoặc lộ lỗi nội bộ; không vượt tải lên shared environment.
**Bằng chứng phải lưu:** Response không 5xx không chủ ý; DB trước/sau; log sanitized; service sống sau request; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### INPUT-007 — Unicode và ký tự điều khiển trong display_name/content [P1]

**Mục tiêu bảo vệ:** Đảm bảo dữ liệu do client cung cấp không thể thay đổi logic ngoài contract, phá vỡ parser hay làm lộ hệ thống.
**Điều kiện/fixture:** A/B có dữ liệu; mã hóa UTF-8 hợp lệ.
**Thao tác kiểm thử:** Gửi chuỗi tiếng Việt, emoji, newline, U+0000 và control chars.
**Điều kiện PASS bắt buộc:** Giữ nguyên dữ liệu hợp lệ; ký tự cấm được xử lý đúng contract; không làm sai JSON/hệ thống.
**Bằng chứng phải lưu:** Response không 5xx không chủ ý; DB trước/sau; log sanitized; service sống sau request; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### INPUT-008 — Script trong display_name hoặc tin nhắn [P1]

**Mục tiêu bảo vệ:** Đảm bảo dữ liệu do client cung cấp không thể thay đổi logic ngoài contract, phá vỡ parser hay làm lộ hệ thống.
**Điều kiện/fixture:** A có hồ sơ/tin nhắn.
**Thao tác kiểm thử:** Lưu chuỗi HTML/script như dữ liệu văn bản; đọc lại qua API.
**Điều kiện PASS bắt buộc:** Không được server thực thi; JSON an toàn; frontend cần kiểm tra hiển thị/escaping riêng.
**Bằng chứng phải lưu:** Response không 5xx không chủ ý; DB trước/sau; log sanitized; service sống sau request; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### INPUT-009 — Format video có ký tự điều hướng đường dẫn [P1]

**Mục tiêu bảo vệ:** Đảm bảo dữ liệu do client cung cấp không thể thay đổi logic ngoài contract, phá vỡ parser hay làm lộ hệ thống.
**Điều kiện/fixture:** A có quota và upload fixture.
**Thao tác kiểm thử:** Gửi format chứa ../, dấu slash, hoặc ký tự URL đặc biệt.
**Điều kiện PASS bắt buộc:** Không thoát khỏi namespace objectKey; reject format không hợp lệ hoặc normalize an toàn theo policy.
**Bằng chứng phải lưu:** Response không 5xx không chủ ý; DB trước/sau; log sanitized; service sống sau request; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### INPUT-010 — Header injection ở các trường hiển thị [P1]

**Mục tiêu bảo vệ:** Đảm bảo dữ liệu do client cung cấp không thể thay đổi logic ngoài contract, phá vỡ parser hay làm lộ hệ thống.
**Điều kiện/fixture:** A có quyền sửa tên/title.
**Thao tác kiểm thử:** Gửi CR/LF hoặc ký tự không an toàn ở dữ liệu có thể xuất hiện trong header.
**Điều kiện PASS bắt buộc:** Không tạo header giả/đổi status; dữ liệu được xử lý an toàn.
**Bằng chứng phải lưu:** Response không 5xx không chủ ý; DB trước/sau; log sanitized; service sống sau request; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### INPUT-011 — Request content-type sai [P1]

**Mục tiêu bảo vệ:** Đảm bảo dữ liệu do client cung cấp không thể thay đổi logic ngoài contract, phá vỡ parser hay làm lộ hệ thống.
**Điều kiện/fixture:** A JWT và endpoint cần JSON.
**Thao tác kiểm thử:** Gửi body JSON với content-type bất thường, rỗng hoặc multipart trái API.
**Điều kiện PASS bắt buộc:** Trả lỗi đúng; không fallback parse gây side effect.
**Bằng chứng phải lưu:** Response không 5xx không chủ ý; DB trước/sau; log sanitized; service sống sau request; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### INPUT-012 — HTTP method override không vượt xác thực [P1]

**Mục tiêu bảo vệ:** Đảm bảo dữ liệu do client cung cấp không thể thay đổi logic ngoài contract, phá vỡ parser hay làm lộ hệ thống.
**Điều kiện/fixture:** Endpoint auth/internal có rule method.
**Thao tác kiểm thử:** Gửi header X-HTTP-Method-Override và method không được hỗ trợ.
**Điều kiện PASS bắt buộc:** Không vượt filter/route hoặc kích hoạt handler POST trái yêu cầu.
**Bằng chứng phải lưu:** Response không 5xx không chủ ý; DB trước/sau; log sanitized; service sống sau request; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### INPUT-013 — Duplicate JSON keys nhạy cảm [P1]

**Mục tiêu bảo vệ:** Đảm bảo dữ liệu do client cung cấp không thể thay đổi logic ngoài contract, phá vỡ parser hay làm lộ hệ thống.
**Điều kiện/fixture:** A có request payload hợp lệ.
**Thao tác kiểm thử:** Gửi JSON lặp user_id, model_id, upload_id, token/type với giá trị khác nhau.
**Điều kiện PASS bắt buộc:** Hành vi parser được xác nhận và không tạo bypass quyền; nếu không thể cam kết cần chốt policy.
**Bằng chứng phải lưu:** Response không 5xx không chủ ý; DB trước/sau; log sanitized; service sống sau request; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### INPUT-014 — Error handler không lộ stacktrace/SQL [P1]

**Mục tiêu bảo vệ:** Đảm bảo dữ liệu do client cung cấp không thể thay đổi logic ngoài contract, phá vỡ parser hay làm lộ hệ thống.
**Điều kiện/fixture:** A hoặc no-token.
**Thao tác kiểm thử:** Gây validation, not-found, conflict và storage error trong test env.
**Điều kiện PASS bắt buộc:** Response không chứa tên class, SQL, connection string, stacktrace, token; error schema ổn định.
**Bằng chứng phải lưu:** Response không 5xx không chủ ý; DB trước/sau; log sanitized; service sống sau request; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### INPUT-015 — Tham số phân trang không giới hạn dữ liệu [P1]

**Mục tiêu bảo vệ:** Đảm bảo dữ liệu do client cung cấp không thể thay đổi logic ngoài contract, phá vỡ parser hay làm lộ hệ thống.
**Điều kiện/fixture:** A có hàng trăm bản ghi.
**Thao tác kiểm thử:** Gửi limit âm, quá lớn, cursor lỗi, giá trị số rất lớn.
**Điều kiện PASS bắt buộc:** Không cho tải vô hạn hoặc tràn số; không đọc nhiều ngoài cap được quy định.
**Bằng chứng phải lưu:** Response không 5xx không chủ ý; DB trước/sau; log sanitized; service sống sau request; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### INPUT-016 — Content encoding không được hỗ trợ [P2]

**Mục tiêu bảo vệ:** Đảm bảo dữ liệu do client cung cấp không thể thay đổi logic ngoài contract, phá vỡ parser hay làm lộ hệ thống.
**Điều kiện/fixture:** A JWT.
**Thao tác kiểm thử:** Gửi request Content-Encoding lạ hoặc body nén không đúng.
**Điều kiện PASS bắt buộc:** Fail closed theo giao thức, không chạy nghiệp vụ bằng dữ liệu chưa kiểm tra.
**Bằng chứng phải lưu:** Response không 5xx không chủ ý; DB trước/sau; log sanitized; service sống sau request; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Độ bao phủ bổ sung, không suy ra bắt buộc cho mọi deployment. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

### ABUSE — Chống lạm dụng, rate limit và tiêu thụ tài nguyên (12 kịch bản)

**Mục tiêu:** Người dùng hợp lệ không thể lạm dụng các luồng nhạy cảm tới mức trái chính sách bảo vệ.
**Nguồn đối chiếu:** `user/UserSearchRateLimiter.java; metrics/MetricsRateLimiter.java; auth/AuthController.java; messaging/MessagingWebSocketHandler.java; video/VideoProperties.java`.
**Bằng chứng điển hình:** HTTP 429/Retry-After khi contract quy định; Redis key/TTL; CPU/memory chỉ quan sát trong giới hạn an toàn.

#### ABUSE-001 — Giới hạn tìm kiếm user theo tài khoản [P0]

**Mục tiêu bảo vệ:** Người dùng hợp lệ không thể lạm dụng các luồng nhạy cảm tới mức trái chính sách bảo vệ.
**Điều kiện/fixture:** A đã có JWT; A chưa dùng rate limit.
**Thao tác kiểm thử:** Thực hiện số lượt search tới ranh giới 10/phút/tài khoản.
**Điều kiện PASS bắt buộc:** Sau ngưỡng bị 429 và Retry-After nếu config đúng; không truy vấn DB quá chính sách.
**Bằng chứng phải lưu:** HTTP 429/Retry-After khi contract quy định; Redis key/TTL; CPU/memory chỉ quan sát trong giới hạn an toàn; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### ABUSE-002 — Rate limit search cách ly A và B [P1]

**Mục tiêu bảo vệ:** Người dùng hợp lệ không thể lạm dụng các luồng nhạy cảm tới mức trái chính sách bảo vệ.
**Điều kiện/fixture:** A/B độc lập.
**Thao tác kiểm thử:** A chạm ngưỡng, B gửi request hợp lệ.
**Điều kiện PASS bắt buộc:** B không bị khóa nhầm do A; key giới hạn theo đúng scope.
**Bằng chứng phải lưu:** HTTP 429/Retry-After khi contract quy định; Redis key/TTL; CPU/memory chỉ quan sát trong giới hạn an toàn; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### ABUSE-003 — Rate limit metrics mỗi 3 giây [P1]

**Mục tiêu bảo vệ:** Người dùng hợp lệ không thể lạm dụng các luồng nhạy cảm tới mức trái chính sách bảo vệ.
**Điều kiện/fixture:** A đăng nhập; telemetry hợp lệ.
**Thao tác kiểm thử:** Gửi lần thứ hai trong cửa sổ nhỏ hơn 3 giây.
**Điều kiện PASS bắt buộc:** Bị giới hạn theo contract; không ghi log dữ liệu client vô hạn.
**Bằng chứng phải lưu:** HTTP 429/Retry-After khi contract quy định; Redis key/TTL; CPU/memory chỉ quan sát trong giới hạn an toàn; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### ABUSE-004 — Không bypass rate limit qua header giả [P1]

**Mục tiêu bảo vệ:** Người dùng hợp lệ không thể lạm dụng các luồng nhạy cảm tới mức trái chính sách bảo vệ.
**Điều kiện/fixture:** A có JWT, giới hạn đang áp dụng.
**Thao tác kiểm thử:** Gửi search với X-Forwarded-For khác nhau từ cùng user.
**Điều kiện PASS bắt buộc:** Không bỏ qua bộ đếm per-user vì header client tự điền.
**Bằng chứng phải lưu:** HTTP 429/Retry-After khi contract quy định; Redis key/TTL; CPU/memory chỉ quan sát trong giới hạn an toàn; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### ABUSE-005 — Rate limit đổi key sau TTL đúng [P1]

**Mục tiêu bảo vệ:** Người dùng hợp lệ không thể lạm dụng các luồng nhạy cảm tới mức trái chính sách bảo vệ.
**Điều kiện/fixture:** A đã bị 429.
**Thao tác kiểm thử:** Chờ hết cửa sổ và gửi lại request hợp lệ.
**Điều kiện PASS bắt buộc:** Phục hồi quyền hợp lệ sau TTL; không cấm vĩnh viễn.
**Bằng chứng phải lưu:** HTTP 429/Retry-After khi contract quy định; Redis key/TTL; CPU/memory chỉ quan sát trong giới hạn an toàn; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### ABUSE-006 — Đăng nhập sai nhiều lần có biện pháp chống lạm dụng [P1]

**Mục tiêu bảo vệ:** Người dùng hợp lệ không thể lạm dụng các luồng nhạy cảm tới mức trái chính sách bảo vệ.
**Điều kiện/fixture:** A có tài khoản; nguồn traffic cô lập.
**Thao tác kiểm thử:** Thực hiện vài login sai tuần tự ở mức an toàn.
**Điều kiện PASS bắt buộc:** Kiểm tra chính sách chống brute force; nếu chưa có ghi risk gap, không tuyên bố PASS chỉ vì HTTP 401.
**Bằng chứng phải lưu:** HTTP 429/Retry-After khi contract quy định; Redis key/TTL; CPU/memory chỉ quan sát trong giới hạn an toàn; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### ABUSE-007 — Đăng ký hàng loạt tài khoản [P1]

**Mục tiêu bảo vệ:** Người dùng hợp lệ không thể lạm dụng các luồng nhạy cảm tới mức trái chính sách bảo vệ.
**Điều kiện/fixture:** Môi trường test với giới hạn thấp.
**Thao tác kiểm thử:** Tạo tài khoản thử ở nhịp kiểm soát và xác nhận chính sách anti-abuse.
**Điều kiện PASS bắt buộc:** Nếu không có throttle/captcha/chính sách nào, ghi gap; không dùng môi trường production.
**Bằng chứng phải lưu:** HTTP 429/Retry-After khi contract quy định; Redis key/TTL; CPU/memory chỉ quan sát trong giới hạn an toàn; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### ABUSE-008 — Kết nối WebSocket vượt giới hạn [P1]

**Mục tiêu bảo vệ:** Người dùng hợp lệ không thể lạm dụng các luồng nhạy cảm tới mức trái chính sách bảo vệ.
**Điều kiện/fixture:** A JWT và giới hạn được xác minh.
**Thao tác kiểm thử:** Mở dần ít socket hơn/qua ngưỡng an toàn trong test env.
**Điều kiện PASS bắt buộc:** Ngăn vượt ngưỡng theo policy, không gây tiêu hao tài nguyên mất kiểm soát.
**Bằng chứng phải lưu:** HTTP 429/Retry-After khi contract quy định; Redis key/TTL; CPU/memory chỉ quan sát trong giới hạn an toàn; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### ABUSE-009 — Gửi sự kiện WS sai liên tục [P1]

**Mục tiêu bảo vệ:** Người dùng hợp lệ không thể lạm dụng các luồng nhạy cảm tới mức trái chính sách bảo vệ.
**Điều kiện/fixture:** A socket hợp lệ.
**Thao tác kiểm thử:** Gửi event unsupported liên tiếp trong giới hạn test.
**Điều kiện PASS bắt buộc:** Đóng theo ngưỡng vi phạm; không spam Pub/Sub hoặc log không giới hạn.
**Bằng chứng phải lưu:** HTTP 429/Retry-After khi contract quy định; Redis key/TTL; CPU/memory chỉ quan sát trong giới hạn an toàn; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### ABUSE-010 — Video quota theo user [P1]

**Mục tiêu bảo vệ:** Người dùng hợp lệ không thể lạm dụng các luồng nhạy cảm tới mức trái chính sách bảo vệ.
**Điều kiện/fixture:** A gần quota với READY videos.
**Thao tác kiểm thử:** Tạo thêm video vượt quota ở nhiều cách tính estimated/actual.
**Điều kiện PASS bắt buộc:** Không cấp quyền lưu vượt policy; state/quota không mâu thuẫn.
**Bằng chứng phải lưu:** HTTP 429/Retry-After khi contract quy định; Redis key/TTL; CPU/memory chỉ quan sát trong giới hạn an toàn; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### ABUSE-011 — Không mở số lượng phiên multipart vô hạn [P1]

**Mục tiêu bảo vệ:** Người dùng hợp lệ không thể lạm dụng các luồng nhạy cảm tới mức trái chính sách bảo vệ.
**Điều kiện/fixture:** A có quota; giới hạn an toàn fixtures.
**Thao tác kiểm thử:** Liên tục initiate mà không hoàn tất trong env cô lập.
**Điều kiện PASS bắt buộc:** Đánh giá giới hạn active sessions/cleanup; nếu chưa có policy ghi rủi ro tài nguyên.
**Bằng chứng phải lưu:** HTTP 429/Retry-After khi contract quy định; Redis key/TTL; CPU/memory chỉ quan sát trong giới hạn an toàn; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### ABUSE-012 — Đối xử công bằng khi một client lỗi liên tiếp [P2]

**Mục tiêu bảo vệ:** Người dùng hợp lệ không thể lạm dụng các luồng nhạy cảm tới mức trái chính sách bảo vệ.
**Điều kiện/fixture:** A gửi payload invalid nhịp thấp; B sử dụng bình thường.
**Thao tác kiểm thử:** Quan sát request B trong khi A bị rate/contract violations.
**Điều kiện PASS bắt buộc:** B vẫn có quyền xử lý, lỗi A không làm hỏng trạng thái auth hoặc session B.
**Bằng chứng phải lưu:** HTTP 429/Retry-After khi contract quy định; Redis key/TTL; CPU/memory chỉ quan sát trong giới hạn an toàn; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Độ bao phủ bổ sung, không suy ra bắt buộc cho mọi deployment. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

### INT — Giao tiếp nội bộ, shared secret và webhook (12 kịch bản)

**Mục tiêu:** Hai API nội bộ không thể được gọi như API người dùng; secret chỉ chứng minh quyền dịch vụ phù hợp và không được lộ.
**Nguồn đối chiếu:** `call/CallNotifyAuthenticationFilter.java; CallNotifyController.java; video/VideoWebhookAuthenticationFilter.java; VideoWebhookController.java; auth/SecurityConfig.java`.
**Bằng chứng điển hình:** Response; Spring log; DB/video status; A/B/C messaging; request correlation; log không chứa internal secret.

#### INT-001 — Không secret tại notify [P0]

**Mục tiêu bảo vệ:** Hai API nội bộ không thể được gọi như API người dùng; secret chỉ chứng minh quyền dịch vụ phù hợp và không được lộ.
**Điều kiện/fixture:** B đang online messaging; URL nội bộ test.
**Thao tác kiểm thử:** POST /internal/call/notify với body đúng, bỏ Authorization.
**Điều kiện PASS bắt buộc:** Bị từ chối; B không nhận CALL_INCOMING.
**Bằng chứng phải lưu:** Response; Spring log; DB/video status; A/B/C messaging; request correlation; log không chứa internal secret; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### INT-002 — JWT người dùng không thay secret notify [P0]

**Mục tiêu bảo vệ:** Hai API nội bộ không thể được gọi như API người dùng; secret chỉ chứng minh quyền dịch vụ phù hợp và không được lộ.
**Điều kiện/fixture:** A token chuẩn; B có socket.
**Thao tác kiểm thử:** POST notify với Authorization Bearer JWT của A.
**Điều kiện PASS bắt buộc:** Không gửi sự kiện; không tự nâng user thành service.
**Bằng chứng phải lưu:** Response; Spring log; DB/video status; A/B/C messaging; request correlation; log không chứa internal secret; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### INT-003 — Notify secret sai không có tác dụng [P0]

**Mục tiêu bảo vệ:** Hai API nội bộ không thể được gọi như API người dùng; secret chỉ chứng minh quyền dịch vụ phù hợp và không được lộ.
**Điều kiện/fixture:** Một secret sai khác secret config; B online.
**Thao tác kiểm thử:** POST notify dùng secret sai.
**Điều kiện PASS bắt buộc:** Bị từ chối; B không có event mới.
**Bằng chứng phải lưu:** Response; Spring log; DB/video status; A/B/C messaging; request correlation; log không chứa internal secret; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### INT-004 — Không secret tại webhook [P0]

**Mục tiêu bảo vệ:** Hai API nội bộ không thể được gọi như API người dùng; secret chỉ chứng minh quyền dịch vụ phù hợp và không được lộ.
**Điều kiện/fixture:** Video processing; event body hợp lệ.
**Thao tác kiểm thử:** POST webhook không Authorization.
**Điều kiện PASS bắt buộc:** Trạng thái video và quota giữ nguyên.
**Bằng chứng phải lưu:** Response; Spring log; DB/video status; A/B/C messaging; request correlation; log không chứa internal secret; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### INT-005 — Webhook JWT không thay shared secret [P0]

**Mục tiêu bảo vệ:** Hai API nội bộ không thể được gọi như API người dùng; secret chỉ chứng minh quyền dịch vụ phù hợp và không được lộ.
**Điều kiện/fixture:** Video processing; A token hợp lệ.
**Thao tác kiểm thử:** POST webhook với Bearer JWT A.
**Điều kiện PASS bắt buộc:** Bị từ chối; không READY.
**Bằng chứng phải lưu:** Response; Spring log; DB/video status; A/B/C messaging; request correlation; log không chứa internal secret; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### INT-006 — Không thể dùng secret notify ở webhook [P0]

**Mục tiêu bảo vệ:** Hai API nội bộ không thể được gọi như API người dùng; secret chỉ chứng minh quyền dịch vụ phù hợp và không được lộ.
**Điều kiện/fixture:** Tách hai secret trong test env.
**Thao tác kiểm thử:** Gọi webhook với secret notify rồi gọi notify với secret webhook.
**Điều kiện PASS bắt buộc:** Cả hai bị từ chối; không chấp nhận secret chung ngoài thiết kế.
**Bằng chứng phải lưu:** Response; Spring log; DB/video status; A/B/C messaging; request correlation; log không chứa internal secret; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### INT-007 — Secret so sánh chính xác từng byte [P1]

**Mục tiêu bảo vệ:** Hai API nội bộ không thể được gọi như API người dùng; secret chỉ chứng minh quyền dịch vụ phù hợp và không được lộ.
**Điều kiện/fixture:** Test với secret chuẩn và biến thể gần giống.
**Thao tác kiểm thử:** Thử thêm ký tự, đổi hoa-thường, newline, khoảng trắng.
**Điều kiện PASS bắt buộc:** Chỉ giá trị hợp lệ qua; phản hồi không tiết lộ secret đúng.
**Bằng chứng phải lưu:** Response; Spring log; DB/video status; A/B/C messaging; request correlation; log không chứa internal secret; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### INT-008 — Notify body hợp lệ nhưng actor sai [P1]

**Mục tiêu bảo vệ:** Hai API nội bộ không thể được gọi như API người dùng; secret chỉ chứng minh quyền dịch vụ phù hợp và không được lộ.
**Điều kiện/fixture:** Có secret notify test; A/B/C.
**Thao tác kiểm thử:** POST notify với callerId/targetUserId không hợp lệ, user bị xóa hoặc giả mạo.
**Điều kiện PASS bắt buộc:** Ràng buộc danh tính và quyền của nguồn gọi được bảo vệ theo mô hình trust đã xác nhận; không gửi notify sai user.
**Bằng chứng phải lưu:** Response; Spring log; DB/video status; A/B/C messaging; request correlation; log không chứa internal secret; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### INT-009 — Webhook secret đúng nhưng event giả [P1]

**Mục tiêu bảo vệ:** Hai API nội bộ không thể được gọi như API người dùng; secret chỉ chứng minh quyền dịch vụ phù hợp và không được lộ.
**Điều kiện/fixture:** Có secret webhook test, objectKey không tồn tại.
**Thao tác kiểm thử:** POST event trạng thái hoàn tất giả.
**Điều kiện PASS bắt buộc:** Không chuyển READY chỉ dựa vào lời khai; xác minh trạng thái vật thể và video session theo thiết kế.
**Bằng chứng phải lưu:** Response; Spring log; DB/video status; A/B/C messaging; request correlation; log không chứa internal secret; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### INT-010 — Không lộ endpoint nội bộ qua response lỗi [P1]

**Mục tiêu bảo vệ:** Hai API nội bộ không thể được gọi như API người dùng; secret chỉ chứng minh quyền dịch vụ phù hợp và không được lộ.
**Điều kiện/fixture:** Không có secret.
**Thao tác kiểm thử:** Gửi body malformed và sai Authorization tới internal routes.
**Điều kiện PASS bắt buộc:** Không rò tên secret env, stacktrace, DB details; reject trước khi chạy nghiệp vụ.
**Bằng chứng phải lưu:** Response; Spring log; DB/video status; A/B/C messaging; request correlation; log không chứa internal secret; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### INT-011 — Giới hạn mạng của API nội bộ khi triển khai [P1]

**Mục tiêu bảo vệ:** Hai API nội bộ không thể được gọi như API người dùng; secret chỉ chứng minh quyền dịch vụ phù hợp và không được lộ.
**Điều kiện/fixture:** Môi trường proxy/container có cấu hình đọc được.
**Thao tác kiểm thử:** Kiểm tra truy cập internal routes từ network public giả lập và private service.
**Điều kiện PASS bắt buộc:** Nếu intended private, public không truy cập được ở tầng mạng; nếu phải public, secret và hạn chế khác bắt buộc, ghi policy.
**Bằng chứng phải lưu:** Response; Spring log; DB/video status; A/B/C messaging; request correlation; log không chứa internal secret; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### INT-012 — Webhook replay sau khi video đã xóa [P1]

**Mục tiêu bảo vệ:** Hai API nội bộ không thể được gọi như API người dùng; secret chỉ chứng minh quyền dịch vụ phù hợp và không được lộ.
**Điều kiện/fixture:** Video READY sau webhook thật rồi DELETE.
**Thao tác kiểm thử:** Dùng fixture event cũ gửi lại bằng secret test.
**Điều kiện PASS bắt buộc:** Không khôi phục READY hoặc tăng quota.
**Bằng chứng phải lưu:** Response; Spring log; DB/video status; A/B/C messaging; request correlation; log không chứa internal secret; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

### CONFIG — Cấu hình bảo mật, CORS, TLS và bề mặt triển khai (15 kịch bản)

**Mục tiêu:** Kiểm tra cấu hình thực tế, vì code Java đúng vẫn có thể bị cấu hình hệ thống làm mất an toàn.
**Nguồn đối chiếu:** `auth/SecurityConfig.java; messaging/MessagingWebSocketConfig.java; cấu hình Nginx/Compose/TLS chưa được cung cấp; application.yml chưa xác nhận trực tiếp`.
**Bằng chứng điển hình:** Response headers, TLS/proxy/cert, config redacted, port exposure, Docker inspection, runbook.

#### CONFIG-001 — CORS không cho origin trái phép [P0]

**Mục tiêu bảo vệ:** Kiểm tra cấu hình thực tế, vì code Java đúng vẫn có thể bị cấu hình hệ thống làm mất an toàn.
**Điều kiện/fixture:** Có allowlist origins và origin lạ.
**Thao tác kiểm thử:** Thực hiện preflight/actual GET từ browser origin không thuộc allowlist.
**Điều kiện PASS bắt buộc:** Không trả CORS allow-origin cho origin lạ; không mặc định wildcard với credentials; nhớ CORS không thay auth.
**Bằng chứng phải lưu:** Response headers, TLS/proxy/cert, config redacted, port exposure, Docker inspection, runbook; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### CONFIG-002 — Messaging WS kiểm tra Origin [P0]

**Mục tiêu bảo vệ:** Kiểm tra cấu hình thực tế, vì code Java đúng vẫn có thể bị cấu hình hệ thống làm mất an toàn.
**Điều kiện/fixture:** Allowlist actual của messaging; JWT hợp lệ.
**Thao tác kiểm thử:** Handshake với Origin ngoài danh sách.
**Điều kiện PASS bắt buộc:** Không kết nối trái origin policy.
**Bằng chứng phải lưu:** Response headers, TLS/proxy/cert, config redacted, port exposure, Docker inspection, runbook; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### CONFIG-003 — Không lộ PostgreSQL/Redis/MinIO ra Internet [P0]

**Mục tiêu bảo vệ:** Kiểm tra cấu hình thực tế, vì code Java đúng vẫn có thể bị cấu hình hệ thống làm mất an toàn.
**Điều kiện/fixture:** Deployment test tương ứng production topology.
**Thao tác kiểm thử:** Kiểm kê bind address, port publishing, firewall và service endpoints.
**Điều kiện PASS bắt buộc:** Chỉ cổng dự định public được mở; DB/Redis/MinIO admin không lộ Internet nếu không có thiết kế bảo vệ phù hợp.
**Bằng chứng phải lưu:** Response headers, TLS/proxy/cert, config redacted, port exposure, Docker inspection, runbook; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### CONFIG-004 — Secret không dùng giá trị mặc định hoặc quá ngắn [P0]

**Mục tiêu bảo vệ:** Kiểm tra cấu hình thực tế, vì code Java đúng vẫn có thể bị cấu hình hệ thống làm mất an toàn.
**Điều kiện/fixture:** Config env test/prod đã được redacted.
**Thao tác kiểm thử:** Kiểm tra validation khi jwt.secret, minio webhook secret và notify secret thiếu/yếu.
**Điều kiện PASS bắt buộc:** Ứng dụng fail closed khi secret bắt buộc thiếu; không dùng secret demo khi triển khai thật.
**Bằng chứng phải lưu:** Response headers, TLS/proxy/cert, config redacted, port exposure, Docker inspection, runbook; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### CONFIG-005 — HTTPS/WSS bắt buộc ở môi trường public [P0]

**Mục tiêu bảo vệ:** Kiểm tra cấu hình thực tế, vì code Java đúng vẫn có thể bị cấu hình hệ thống làm mất an toàn.
**Điều kiện/fixture:** Proxy TLS đã dựng riêng.
**Thao tác kiểm thử:** Thử HTTP và WS không mã hóa từ client không đáng tin.
**Điều kiện PASS bắt buộc:** Chuyển hướng hoặc chặn theo chính sách; không gửi token qua cleartext.
**Bằng chứng phải lưu:** Response headers, TLS/proxy/cert, config redacted, port exposure, Docker inspection, runbook; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### CONFIG-006 — Security headers được phát ở đường HTTP thật [P1]

**Mục tiêu bảo vệ:** Kiểm tra cấu hình thực tế, vì code Java đúng vẫn có thể bị cấu hình hệ thống làm mất an toàn.
**Điều kiện/fixture:** Reverse proxy và backend khởi động.
**Thao tác kiểm thử:** GET protected/public trong env HTTPS và xem headers.
**Điều kiện PASS bắt buộc:** X-Content-Type-Options, HSTS (chỉ HTTPS), frame policy phù hợp cấu hình; proxy không loại bỏ nhầm.
**Bằng chứng phải lưu:** Response headers, TLS/proxy/cert, config redacted, port exposure, Docker inspection, runbook; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### CONFIG-007 — Actuator chỉ mở endpoint được phép [P1]

**Mục tiêu bảo vệ:** Kiểm tra cấu hình thực tế, vì code Java đúng vẫn có thể bị cấu hình hệ thống làm mất an toàn.
**Điều kiện/fixture:** Có Spring Actuator; config deployment.
**Thao tác kiểm thử:** Thử /actuator, /actuator/env, /beans, /metrics, /heapdump từ client không có quyền.
**Điều kiện PASS bắt buộc:** Không lộ nội bộ; những endpoint có thật phải được bảo vệ, không chỉ dựa status /health.
**Bằng chứng phải lưu:** Response headers, TLS/proxy/cert, config redacted, port exposure, Docker inspection, runbook; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### CONFIG-008 — Lỗi 404/500 không hiện stacktrace [P1]

**Mục tiêu bảo vệ:** Kiểm tra cấu hình thực tế, vì code Java đúng vẫn có thể bị cấu hình hệ thống làm mất an toàn.
**Điều kiện/fixture:** Ứng dụng chạy profile deployment.
**Thao tác kiểm thử:** Gọi route sai và gây lỗi test có kiểm soát.
**Điều kiện PASS bắt buộc:** Không lộ stacktrace, đường dẫn file, hostname nội bộ hoặc JDBC URL.
**Bằng chứng phải lưu:** Response headers, TLS/proxy/cert, config redacted, port exposure, Docker inspection, runbook; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### CONFIG-009 — Bí mật không nằm trong image, env dump hoặc build artifact công khai [P1]

**Mục tiêu bảo vệ:** Kiểm tra cấu hình thực tế, vì code Java đúng vẫn có thể bị cấu hình hệ thống làm mất an toàn.
**Điều kiện/fixture:** Artifact test và config đã lược thông tin nhạy cảm.
**Thao tác kiểm thử:** Kiểm tra Docker image layers, repo tracked files, build logs.
**Điều kiện PASS bắt buộc:** Không hardcode/đóng gói secret thật; quyền truy cập secret tối thiểu.
**Bằng chứng phải lưu:** Response headers, TLS/proxy/cert, config redacted, port exposure, Docker inspection, runbook; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### CONFIG-010 — Docker không chạy quyền quá cao [P1]

**Mục tiêu bảo vệ:** Kiểm tra cấu hình thực tế, vì code Java đúng vẫn có thể bị cấu hình hệ thống làm mất an toàn.
**Điều kiện/fixture:** Container runtime test có quyền inspect.
**Thao tác kiểm thử:** Kiểm tra privileged, mount host, capability, user, container socket.
**Điều kiện PASS bắt buộc:** Không có đặc quyền hoặc mount nguy hiểm không cần thiết; có ngoại lệ phải được ghi/duyệt.
**Bằng chứng phải lưu:** Response headers, TLS/proxy/cert, config redacted, port exposure, Docker inspection, runbook; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### CONFIG-011 — Nginx route không vượt filter [P1]

**Mục tiêu bảo vệ:** Kiểm tra cấu hình thực tế, vì code Java đúng vẫn có thể bị cấu hình hệ thống làm mất an toàn.
**Điều kiện/fixture:** Có proxy cấu hình thực.
**Thao tác kiểm thử:** Thử URL encoded path, path trùng slash và các biến thể nội bộ từ client.
**Điều kiện PASS bắt buộc:** Không biến đường public thành truy cập internal bypass hoặc route lệch giữa proxy và backend.
**Bằng chứng phải lưu:** Response headers, TLS/proxy/cert, config redacted, port exposure, Docker inspection, runbook; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### CONFIG-012 — Proxy forwarding headers được tin đúng mức [P1]

**Mục tiêu bảo vệ:** Kiểm tra cấu hình thực tế, vì code Java đúng vẫn có thể bị cấu hình hệ thống làm mất an toàn.
**Điều kiện/fixture:** Proxy test; header X-Forwarded-* giả mạo.
**Thao tác kiểm thử:** Truy cập qua proxy và trực tiếp (nếu mở) với host/proto khác.
**Điều kiện PASS bắt buộc:** Không thay trust decision hoặc cấp link nhạy cảm theo header client không đáng tin.
**Bằng chứng phải lưu:** Response headers, TLS/proxy/cert, config redacted, port exposure, Docker inspection, runbook; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### CONFIG-013 — Không cache response nhạy cảm ở proxy [P1]

**Mục tiêu bảo vệ:** Kiểm tra cấu hình thực tế, vì code Java đúng vẫn có thể bị cấu hình hệ thống làm mất an toàn.
**Điều kiện/fixture:** Đã dựng proxy/browser HTTP test.
**Thao tác kiểm thử:** Kiểm tra cache headers của /auth/login, /users/me, /videos/{id} và presigned URL.
**Điều kiện PASS bắt buộc:** Dữ liệu người dùng và token không nằm trong shared cache trái policy.
**Bằng chứng phải lưu:** Response headers, TLS/proxy/cert, config redacted, port exposure, Docker inspection, runbook; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### CONFIG-014 — Kiểm tra Content Security Policy phía frontend nếu triển khai [P1]

**Mục tiêu bảo vệ:** Kiểm tra cấu hình thực tế, vì code Java đúng vẫn có thể bị cấu hình hệ thống làm mất an toàn.
**Điều kiện/fixture:** Frontend/proxy nằm ngoài ZIP Java.
**Thao tác kiểm thử:** Kiểm kê CSP, frame ancestors, cookie policies từ ứng dụng trình duyệt.
**Điều kiện PASS bắt buộc:** Nếu ngoài scope backend ghi cần bộ frontend deployment test; không kết luận N/A chỉ vì source Java không chứa.
**Bằng chứng phải lưu:** Response headers, TLS/proxy/cert, config redacted, port exposure, Docker inspection, runbook; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### CONFIG-015 — Time sync của server [P1]

**Mục tiêu bảo vệ:** Kiểm tra cấu hình thực tế, vì code Java đúng vẫn có thể bị cấu hình hệ thống làm mất an toàn.
**Điều kiện/fixture:** JVM, Node, database máy chủ test.
**Thao tác kiểm thử:** So sánh thời gian và độ lệch giữa thành phần.
**Điều kiện PASS bắt buộc:** Đồng hồ đủ nhất quán cho exp/iat, token revocation và signed URL; sai lệch vượt ngưỡng được xử lý.
**Bằng chứng phải lưu:** Response headers, TLS/proxy/cert, config redacted, port exposure, Docker inspection, runbook; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

### LOG — Bảo vệ dữ liệu nhạy cảm, logging, lỗi và audit (11 kịch bản)

**Mục tiêu:** Không để bí mật lọt vào logs, response, report hoặc telemetry; phát hiện sự kiện an ninh quan trọng.
**Nguồn đối chiếu:** `auth/ApiExceptionHandler.java; JwtAuthenticationFilter.java; messaging/WebSocketAuthHandshakeInterceptor.java; video/MinioMultipartStorage.java; metrics/MetricsService.java`.
**Bằng chứng điển hình:** Search redacted logs/artifacts theo sentinel, response schema, tracing correlation và chính sách retention.

#### LOG-001 — Access/refresh không xuất hiện trong log [P0]

**Mục tiêu bảo vệ:** Không để bí mật lọt vào logs, response, report hoặc telemetry; phát hiện sự kiện an ninh quan trọng.
**Điều kiện/fixture:** Tạo token riêng dạng sentinel; gọi login/logout/refresh.
**Thao tác kiểm thử:** Quét backend/signaling/proxy/test logs sau vòng đời token.
**Điều kiện PASS bắt buộc:** Không có token nguyên văn; chỉ có fingerprint/redacted khi cần.
**Bằng chứng phải lưu:** Search redacted logs/artifacts theo sentinel, response schema, tracing correlation và chính sách retention; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### LOG-002 — Mật khẩu không bị log hoặc trả lại [P0]

**Mục tiêu bảo vệ:** Không để bí mật lọt vào logs, response, report hoặc telemetry; phát hiện sự kiện an ninh quan trọng.
**Điều kiện/fixture:** A đăng ký/login bằng mật khẩu sentinel.
**Thao tác kiểm thử:** Quan sát mọi response và log.
**Điều kiện PASS bắt buộc:** Không có mật khẩu nguyên bản trong log/body/error; DB chỉ có hash.
**Bằng chứng phải lưu:** Search redacted logs/artifacts theo sentinel, response schema, tracing correlation và chính sách retention; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### LOG-003 — Presigned URL không lộ toàn chuỗi [P0]

**Mục tiêu bảo vệ:** Không để bí mật lọt vào logs, response, report hoặc telemetry; phát hiện sự kiện an ninh quan trọng.
**Điều kiện/fixture:** Có video upload và READY.
**Thao tác kiểm thử:** Gây validation/MinIO error test rồi xem logs/result artifact.
**Điều kiện PASS bắt buộc:** Không có query signature nguyên văn trong log hoặc report không được bảo vệ.
**Bằng chứng phải lưu:** Search redacted logs/artifacts theo sentinel, response schema, tracing correlation và chính sách retention; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### LOG-004 — Shared secret internal không xuất hiện trong log [P0]

**Mục tiêu bảo vệ:** Không để bí mật lọt vào logs, response, report hoặc telemetry; phát hiện sự kiện an ninh quan trọng.
**Điều kiện/fixture:** Secret notify/webhook riêng trong env test.
**Thao tác kiểm thử:** Gọi internal thành công/thất bại, quét backend/Node logs.
**Điều kiện PASS bắt buộc:** Không in secret, Authorization đầy đủ hay file env.
**Bằng chứng phải lưu:** Search redacted logs/artifacts theo sentinel, response schema, tracing correlation và chính sách retention; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### LOG-005 — Error response không lộ SQL và đường dẫn nội bộ [P1]

**Mục tiêu bảo vệ:** Không để bí mật lọt vào logs, response, report hoặc telemetry; phát hiện sự kiện an ninh quan trọng.
**Điều kiện/fixture:** Fixture request sai, DB duplicate, object lỗi.
**Thao tác kiểm thử:** So sánh response body với mẫu lỗi an toàn.
**Điều kiện PASS bắt buộc:** Không trả JDBC URL, class/package, SQL query, stacktrace; id correlation phù hợp.
**Bằng chứng phải lưu:** Search redacted logs/artifacts theo sentinel, response schema, tracing correlation và chính sách retention; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### LOG-006 — Telemetry không in token hoặc nội dung riêng [P1]

**Mục tiêu bảo vệ:** Không để bí mật lọt vào logs, response, report hoặc telemetry; phát hiện sự kiện an ninh quan trọng.
**Điều kiện/fixture:** A gửi /metrics/client và yêu cầu sai.
**Thao tác kiểm thử:** Quét logs sau request.
**Điều kiện PASS bắt buộc:** Chỉ ghi chỉ số cho phép; không tự thêm access token, email hoặc dữ liệu tin nhắn.
**Bằng chứng phải lưu:** Search redacted logs/artifacts theo sentinel, response schema, tracing correlation và chính sách retention; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### LOG-007 — Không lộ thông tin người khác qua errors [P1]

**Mục tiêu bảo vệ:** Không để bí mật lọt vào logs, response, report hoặc telemetry; phát hiện sự kiện an ninh quan trọng.
**Điều kiện/fixture:** A/B/C, ID của tài nguyên B.
**Thao tác kiểm thử:** A gọi tài nguyên không có quyền, so sánh với ID không tồn tại.
**Điều kiện PASS bắt buộc:** Message không lộ tên, email, tiêu đề video, nội dung hội thoại B.
**Bằng chứng phải lưu:** Search redacted logs/artifacts theo sentinel, response schema, tracing correlation và chính sách retention; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### LOG-008 — Audit các thao tác bảo mật quan trọng [P1]

**Mục tiêu bảo vệ:** Không để bí mật lọt vào logs, response, report hoặc telemetry; phát hiện sự kiện an ninh quan trọng.
**Điều kiện/fixture:** A đăng nhập sai, logout, xóa tài khoản; internal secret sai.
**Thao tác kiểm thử:** Kiểm tra audit event phù hợp, không chứa bí mật.
**Điều kiện PASS bắt buộc:** Có khả năng điều tra ai/lúc nào/hành động gì ở mức dữ liệu tối thiểu theo policy.
**Bằng chứng phải lưu:** Search redacted logs/artifacts theo sentinel, response schema, tracing correlation và chính sách retention; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### LOG-009 — Không lộ thông tin qua JUnit XML [P1]

**Mục tiêu bảo vệ:** Không để bí mật lọt vào logs, response, report hoặc telemetry; phát hiện sự kiện an ninh quan trọng.
**Điều kiện/fixture:** Runner E2E sử dụng tokens, signed URLs và exception.
**Thao tác kiểm thử:** Cố tình tạo lỗi test nội bộ rồi mở results.xml/run.json/build.log.
**Điều kiện PASS bắt buộc:** Artifact không chứa dữ liệu xác thực nguyên văn; lỗi vẫn đủ thông tin chẩn đoán.
**Bằng chứng phải lưu:** Search redacted logs/artifacts theo sentinel, response schema, tracing correlation và chính sách retention; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### LOG-010 — Giới hạn thông tin được lưu và xóa [P1]

**Mục tiêu bảo vệ:** Không để bí mật lọt vào logs, response, report hoặc telemetry; phát hiện sự kiện an ninh quan trọng.
**Điều kiện/fixture:** Chính sách lưu log/data retention đã xác định.
**Thao tác kiểm thử:** Đối chiếu logs, metrics, tokens với chính sách retention.
**Điều kiện PASS bắt buộc:** Không giữ dữ liệu nhạy cảm quá thời hạn/công dụng; nếu chưa có policy ghi gap.
**Bằng chứng phải lưu:** Search redacted logs/artifacts theo sentinel, response schema, tracing correlation và chính sách retention; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### LOG-011 — Không hiển thị secret trong health/metrics [P1]

**Mục tiêu bảo vệ:** Không để bí mật lọt vào logs, response, report hoặc telemetry; phát hiện sự kiện an ninh quan trọng.
**Điều kiện/fixture:** Actuator và endpoint client metrics.
**Thao tác kiểm thử:** GET /actuator/health cùng endpoint expose dự kiến.
**Điều kiện PASS bắt buộc:** Không leak auth details, environment, user data hoặc khóa; health đủ an toàn public.
**Bằng chứng phải lưu:** Search redacted logs/artifacts theo sentinel, response schema, tracing correlation và chính sách retention; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

### SUPPLY — Dependency, artifact và quá trình build an toàn (8 kịch bản)

**Mục tiêu:** Kiểm tra rủi ro supply chain có thể phá bảo mật ngay cả khi API code đúng.
**Nguồn đối chiếu:** `Cần pom.xml, package-lock.json, Dockerfiles, CI và dependency manifests hiện hành; không có trong ZIP Java đã tải`.
**Bằng chứng điển hình:** SCA result, SBOM, lockfile checksum, build provenance, remediation decisions.

#### SUPPLY-001 — Quét lỗ hổng dependency Java [P0]

**Mục tiêu bảo vệ:** Kiểm tra rủi ro supply chain có thể phá bảo mật ngay cả khi API code đúng.
**Điều kiện/fixture:** pom.xml và dependency tree commit build.
**Thao tác kiểm thử:** Chạy SCA được phê duyệt đối với toàn bộ dependency trực tiếp/transitive.
**Điều kiện PASS bắt buộc:** Không còn phát hiện Critical/High có thể khai thác chưa được xử lý hoặc chấp thuận rủi ro có bằng chứng.
**Bằng chứng phải lưu:** SCA result, SBOM, lockfile checksum, build provenance, remediation decisions; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### SUPPLY-002 — Quét lỗ hổng dependency signaling [P0]

**Mục tiêu bảo vệ:** Kiểm tra rủi ro supply chain có thể phá bảo mật ngay cả khi API code đúng.
**Điều kiện/fixture:** package.json và lockfile.
**Thao tác kiểm thử:** Chạy npm audit/SCA, đánh giá gói Node và ws/jsonwebtoken.
**Điều kiện PASS bắt buộc:** Không còn Critical/High có đường khai thác chưa kiểm soát; remediation được lưu.
**Bằng chứng phải lưu:** SCA result, SBOM, lockfile checksum, build provenance, remediation decisions; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### SUPPLY-003 — Dependency được khóa phiên bản và build tái lập [P1]

**Mục tiêu bảo vệ:** Kiểm tra rủi ro supply chain có thể phá bảo mật ngay cả khi API code đúng.
**Điều kiện/fixture:** pom.xml, Maven lock conventions, npm lock.
**Thao tác kiểm thử:** Build từ môi trường sạch 2 lần và so sánh dependency graph.
**Điều kiện PASS bắt buộc:** Dependency thay đổi có kiểm soát, không kéo phiên bản bất ngờ ngoài quy trình.
**Bằng chứng phải lưu:** SCA result, SBOM, lockfile checksum, build provenance, remediation decisions; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### SUPPLY-004 — Container images cập nhật và rõ nguồn [P1]

**Mục tiêu bảo vệ:** Kiểm tra rủi ro supply chain có thể phá bảo mật ngay cả khi API code đúng.
**Điều kiện/fixture:** Dockerfile/Compose từng dịch vụ.
**Thao tác kiểm thử:** Kiểm tra phiên bản base image, tags/digests, CVE của image.
**Điều kiện PASS bắt buộc:** Không dùng image không rõ nguồn hoặc bỏ sót fix nghiêm trọng mà không ghi nhận.
**Bằng chứng phải lưu:** SCA result, SBOM, lockfile checksum, build provenance, remediation decisions; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### SUPPLY-005 — Không commit secret hoặc private key [P1]

**Mục tiêu bảo vệ:** Kiểm tra rủi ro supply chain có thể phá bảo mật ngay cả khi API code đúng.
**Điều kiện/fixture:** Toàn repo với git history theo phạm vi được phép.
**Thao tác kiểm thử:** Chạy secret scanner offline trên repo và build artifact.
**Điều kiện PASS bắt buộc:** Không có secret thật trong git/history/artifact; nếu từng lộ có kế hoạch rotate chứ không chỉ xóa file.
**Bằng chứng phải lưu:** SCA result, SBOM, lockfile checksum, build provenance, remediation decisions; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### SUPPLY-006 — Không cấp CI credential dư quyền [P1]

**Mục tiêu bảo vệ:** Kiểm tra rủi ro supply chain có thể phá bảo mật ngay cả khi API code đúng.
**Điều kiện/fixture:** Workflow CI của repo nếu có.
**Thao tác kiểm thử:** Kiểm kê permission token, artifact, PR security boundary.
**Điều kiện PASS bắt buộc:** CI chỉ có quyền tối thiểu; không lộ credential cho code từ nguồn không tin cậy.
**Bằng chứng phải lưu:** SCA result, SBOM, lockfile checksum, build provenance, remediation decisions; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### SUPPLY-007 — Không tải script hoặc binary không kiểm soát khi build [P1]

**Mục tiêu bảo vệ:** Kiểm tra rủi ro supply chain có thể phá bảo mật ngay cả khi API code đúng.
**Điều kiện/fixture:** pom plugins, npm scripts, Dockerfile.
**Thao tác kiểm thử:** Đánh giá nguồn tải và các bước postinstall/CI.
**Điều kiện PASS bắt buộc:** Không tự động thực thi nguồn không tin cậy ngoài danh sách phê duyệt.
**Bằng chứng phải lưu:** SCA result, SBOM, lockfile checksum, build provenance, remediation decisions; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### SUPPLY-008 — SBOM và danh sách phiên bản phát hành [P2]

**Mục tiêu bảo vệ:** Kiểm tra rủi ro supply chain có thể phá bảo mật ngay cả khi API code đúng.
**Điều kiện/fixture:** Dependency manifests đã khóa.
**Thao tác kiểm thử:** Sinh Software Bill of Materials cho backend và signaling.
**Điều kiện PASS bắt buộc:** Có inventory dependency gắn commit; hỗ trợ tra cứu khi CVE mới xuất hiện.
**Bằng chứng phải lưu:** SCA result, SBOM, lockfile checksum, build provenance, remediation decisions; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Độ bao phủ bổ sung, không suy ra bắt buộc cho mọi deployment. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

### CROSS — Chuỗi bảo mật xuyên module (10 kịch bản)

**Mục tiêu:** Kiểm tra mối liên hệ giữa auth, database, socket, signaling và storage không phá vỡ một ranh giới bảo vệ.
**Nguồn đối chiếu:** `E2E E01–E14; Java snapshot; Node signaling hiện cần source mới để xác minh chính xác`.
**Bằng chứng điển hình:** Timeline từng bước, bảng đối tượng A/B/C, SQL/Redis/MinIO snapshot, HTTP/WS events với run_id.

#### CROSS-001 — Đăng xuất rồi dùng token cũ ở mọi kênh [P0]

**Mục tiêu bảo vệ:** Kiểm tra mối liên hệ giữa auth, database, socket, signaling và storage không phá vỡ một ranh giới bảo vệ.
**Điều kiện/fixture:** A đăng nhập, HTTP/messaging/signaling; B inbox.
**Thao tác kiểm thử:** A logout rồi lần lượt GET private, mở WS, gửi CALL_OFFER.
**Điều kiện PASS bắt buộc:** Tất cả kênh đồng nhất về thu hồi; không tác động B; kỳ vọng E10 phải đạt.
**Bằng chứng phải lưu:** Timeline từng bước, bảng đối tượng A/B/C, SQL/Redis/MinIO snapshot, HTTP/WS events với run_id; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### CROSS-002 — Người ngoài không thể tương tác hội thoại bằng nhiều kênh [P0]

**Mục tiêu bảo vệ:** Kiểm tra mối liên hệ giữa auth, database, socket, signaling và storage không phá vỡ một ranh giới bảo vệ.
**Điều kiện/fixture:** A-B có conversation; C outsider.
**Thao tác kiểm thử:** C GET/POST messages, PUT receipt, gửi WS TYPING vào idAB.
**Điều kiện PASS bắt buộc:** Không đọc/ghi/phát event xuyên quyền; DB A-B không thay đổi do C.
**Bằng chứng phải lưu:** Timeline từng bước, bảng đối tượng A/B/C, SQL/Redis/MinIO snapshot, HTTP/WS events với run_id; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### CROSS-003 — Không lạm dụng callback notify để mạo danh cuộc gọi [P0]

**Mục tiêu bảo vệ:** Kiểm tra mối liên hệ giữa auth, database, socket, signaling và storage không phá vỡ một ranh giới bảo vệ.
**Điều kiện/fixture:** A/B messaging, C có token user.
**Thao tác kiểm thử:** C POST internal call notify với JWT và gửi fake signaling.
**Điều kiện PASS bắt buộc:** B không nhận CALL_INCOMING trái phép; Node không nâng quyền C.
**Bằng chứng phải lưu:** Timeline từng bước, bảng đối tượng A/B/C, SQL/Redis/MinIO snapshot, HTTP/WS events với run_id; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### CROSS-004 — Video ownership xuyên metadata và presigned URL [P0]

**Mục tiêu bảo vệ:** Kiểm tra mối liên hệ giữa auth, database, socket, signaling và storage không phá vỡ một ranh giới bảo vệ.
**Điều kiện/fixture:** B có video ready và upload active; A outsider.
**Thao tác kiểm thử:** A đoán video ID, gọi detail/chunks/abort/delete, thử request lấy link.
**Điều kiện PASS bắt buộc:** Không có signed URL cho A, không thay đổi object/DB/Redis B.
**Bằng chứng phải lưu:** Timeline từng bước, bảng đối tượng A/B/C, SQL/Redis/MinIO snapshot, HTTP/WS events với run_id; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### CROSS-005 — Xóa tài khoản hủy quyền theo mọi kênh [P0]

**Mục tiêu bảo vệ:** Kiểm tra mối liên hệ giữa auth, database, socket, signaling và storage không phá vỡ một ranh giới bảo vệ.
**Điều kiện/fixture:** A có video, chat, access/refresh và WS.
**Thao tác kiểm thử:** A DELETE account, thử HTTP, WS, signaling, refresh.
**Điều kiện PASS bắt buộc:** Tài khoản disabled đúng; token/phiên bị kiểm soát; không có tài nguyên riêng bị dùng sai.
**Bằng chứng phải lưu:** Timeline từng bước, bảng đối tượng A/B/C, SQL/Redis/MinIO snapshot, HTTP/WS events với run_id; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### CROSS-006 — Thu hồi token và đổi phiên nhiều thiết bị [P0]

**Mục tiêu bảo vệ:** Kiểm tra mối liên hệ giữa auth, database, socket, signaling và storage không phá vỡ một ranh giới bảo vệ.
**Điều kiện/fixture:** A đăng nhập 2 phiên; B nhận tin.
**Thao tác kiểm thử:** Logout một phiên; thử HTTP/WS/signaling của hai phiên.
**Điều kiện PASS bắt buộc:** Kết quả đúng chính sách per-token/per-user; không cấp quyền cho session đã thu hồi; không chặn nhầm nếu không theo policy.
**Bằng chứng phải lưu:** Timeline từng bước, bảng đối tượng A/B/C, SQL/Redis/MinIO snapshot, HTTP/WS events với run_id; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Chặn nghiệm thu nếu chưa PASS hoặc chưa có xử lý rủi ro được phê duyệt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### CROSS-007 — Payload phản hồi không làm lộ secret thông qua E2E lỗi [P1]

**Mục tiêu bảo vệ:** Kiểm tra mối liên hệ giữa auth, database, socket, signaling và storage không phá vỡ một ranh giới bảo vệ.
**Điều kiện/fixture:** A upload và B nhắn tin, gây lỗi validation.
**Thao tác kiểm thử:** Thu thập response, WS ERROR, log, JUnit; quét sentinel.
**Điều kiện PASS bắt buộc:** Không lộ token, signed URL và nội dung riêng người khác; đủ correlation để điều tra.
**Bằng chứng phải lưu:** Timeline từng bước, bảng đối tượng A/B/C, SQL/Redis/MinIO snapshot, HTTP/WS events với run_id; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### CROSS-008 — CORS/browser và auth backend là lớp khác nhau [P1]

**Mục tiêu bảo vệ:** Kiểm tra mối liên hệ giữa auth, database, socket, signaling và storage không phá vỡ một ranh giới bảo vệ.
**Điều kiện/fixture:** Origin trái phép, token A hợp lệ.
**Thao tác kiểm thử:** Trình duyệt fetch và HTTP client trực tiếp; so sánh phản hồi.
**Điều kiện PASS bắt buộc:** Browser bị CORS policy chặn như yêu cầu, server vẫn kiểm tra auth/quyền cho tất cả client.
**Bằng chứng phải lưu:** Timeline từng bước, bảng đối tượng A/B/C, SQL/Redis/MinIO snapshot, HTTP/WS events với run_id; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### CROSS-009 — Thông báo cuộc gọi không biến thành quyền nhận Offer giả [P1]

**Mục tiêu bảo vệ:** Kiểm tra mối liên hệ giữa auth, database, socket, signaling và storage không phá vỡ một ranh giới bảo vệ.
**Điều kiện/fixture:** B chưa signaling, A caller, C outsider.
**Thao tác kiểm thử:** A gửi CALL_OFFER; B mở signaling sau CALL_INCOMING; C cũng online.
**Điều kiện PASS bắt buộc:** B nhận đúng offer; C không nhận; nguồn tín hiệu không mạo danh, sửa lỗi E09.
**Bằng chứng phải lưu:** Timeline từng bước, bảng đối tượng A/B/C, SQL/Redis/MinIO snapshot, HTTP/WS events với run_id; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

#### CROSS-010 — Xử lý lỗi internal service fail closed [P1]

**Mục tiêu bảo vệ:** Kiểm tra mối liên hệ giữa auth, database, socket, signaling và storage không phá vỡ một ranh giới bảo vệ.
**Điều kiện/fixture:** Redis hoặc auth lookup bị lỗi kiểm soát ở env biệt lập.
**Thao tác kiểm thử:** Thử HTTP protected, WS handshake và signaling khi trạng thái thu hồi không tra được.
**Điều kiện PASS bắt buộc:** Không tự cho qua xác thực khi dependency bảo mật không sẵn sàng; lỗi được kiểm soát, chính sách fail-closed đã chốt.
**Bằng chứng phải lưu:** Timeline từng bước, bảng đối tượng A/B/C, SQL/Redis/MinIO snapshot, HTTP/WS events với run_id; trạng thái trước/sau và `run_id` của riêng case. Không ghi token/secret hoặc presigned query đầy đủ.
**Phân loại/mức ưu tiên:** Cần thực hiện trước tuyên bố sẵn sàng triển khai; có thể theo dõi theo đợt. **Trạng thái ban đầu:** `NOT_RUN` (riêng E09/E10 có lịch sử FAIL ở lần E2E đã báo cáo, chưa có lần chạy T06).

## V. Ma trận quyền và mẫu áp dụng theo endpoint

### V.1. Bảng quyền cơ sở

| Tài nguyên/hành động | A chủ | B thành viên/người nhận | C ngoài phạm vi | D đã xóa |
|---|---|---|---|---|
| Hồ sơ `/users/me` | Chỉ hồ sơ A | Chỉ hồ sơ B | Chỉ hồ sơ C | Từ chối |
| Hội thoại A–B: đọc và lịch sử | Có | Có | Không | Không |
| Gửi tin vào A–B | Có | Có | Không | Không |
| Status tin nhắn A–B | Theo actor/rule cụ thể | Theo actor/rule cụ thể | Không | Không |
| TYPING A–B qua messaging WS | Có | Có | Không | Không |
| Video của A: xem/sửa/xóa/upload | Có theo status | Không nếu chưa được cấp quyền | Không | Không |
| Nội bộ `/internal/call/notify` | Không bằng JWT người dùng | Không | Không | Không |
| Nội bộ `/internal/videos/webhook` | Không bằng JWT người dùng | Không | Không | Không |
| Signaling call A–B | A/B trong phiên đã xác thực | A/B trong phiên đã xác thực | Không | Không |

**Không coi ô “Có” là không giới hạn:** Ví dụ, `status` tin nhắn còn phụ thuộc chủ thể và trạng thái; video READY khác RECORDING. Ma trận quyền này là phác thảo cho negative tests, phải chốt chi tiết theo service và API contract hiện hành.

### V.2. Checklist áp dụng cho từng endpoint bảo vệ

Không nhân bản vô hạn các ID nhưng khi triển khai phải lặp lại nhóm oracle sau cho từng route phù hợp: (1) no token; (2) expired/revoked/wrong-type access; (3) A vs C quyền đối tượng; (4) giả trường owner/id/role; (5) payload sai không side effect; (6) secret và lỗi không rò; (7) deleted user; (8) đúng API method/URL trên proxy. Ghi endpoint nào **N/A** có lý do. E2E dùng các test giả lập chuỗi với A/B/C để giữ kiểm chứng cross-service.

## VI. Ánh xạ với T04/T05 và 14 E2E cũ

| Bằng chứng cũ | T06 liên quan | Cần bổ sung so với E2E cơ bản |
|---|---|---|
| E01 PASS lịch sử: register/login/refresh/logout | AUTH-001..024, LOG-001..002 | JWT sai loại/claim/chữ ký, nhiều phiên, thu hồi xuyên WS/signaling, leak log |
| E04–E07 PASS lịch sử: chat/two sockets/typing/read/offline | BOLA-001..018, WSM-001..019 | outsider hành động bằng WS, token revoke while socket open, không có side effect |
| E08 PASS lịch sử: signaling khi hai đầu online | SIG-004..020 | anti-impersonation, target authorization, call-state, spoofed ICE/Answer/End |
| **E09 FAIL lịch sử** | SIG-007, SIG-008, CROSS-009 | Fix pending offer/race mà không tạo đường rò offer cho C |
| **E10 FAIL lịch sử** | AUTH-012, SIG-001, CROSS-001 | Revocation check khi handshake và hành động trên socket cũ |
| E11–E12 PASS lịch sử: multipart/webhook/abort | VID-001..026, INT-004..012 | owner BOLA, signed URL, webhook giả, cleanup orphan, secret/log leakage |
| E13 PASS lịch sử: account delete | AUTH-014, CROSS-005 | Các socket đã mở, access/refresh ở signaling, object/private data còn lại |
| E14 PASS lịch sử: telemetry | ABUSE-003, LOG-006 | limit thực tế, leak dữ liệu, validation tiêu thụ tài nguyên |

## VII. Quy trình triển khai T06 theo 6 đợt, có cổng nghiệm thu

| Đợt | Phạm vi | Đầu ra bắt buộc |
|---|---|---|
| S0 — Chốt ranh giới | Read code runtime, assets/config/contract, xác minh lỗi E10 và chính sách token/call, A/B/C fixture | Threat model sơ bộ và route inventory bảo vệ |
| S1 — Authentication | AUTH + BFLA rủi ro cao | Không mạo danh JWT, revoke hoạt động ở HTTP/WS/signaling |
| S2 — Object/Realtime authorization | BOLA, WSM, SIG | Không đọc/ghi/relay sai người, dù biết ID hoặc giữ socket |
| S3 — Storage/Internal APIs | VID, INT | Upload/link/webhook/secret bị khóa theo quyền và trạng thái |
| S4 — Input/Abuse/Deployment | INPUT, ABUSE, CONFIG, LOG, SUPPLY | Chống lộ bí mật và sai cấu hình, có kết quả audit |
| S5 — Cross-module và nghiệm thu | CROSS và chạy regression T04/T05 | Không có P0 chưa xử lý, kết quả lưu thành report |

### VII.1. Trình tự thực thi cho một case

1. Đọc source handler/service và yêu cầu tương ứng; chốt status/close/event tùy hợp đồng.
2. Tạo fixture A/B/C sạch trên runner.
3. Chụp trạng thái DB, Redis, MinIO và session/event trước thử nghiệm.
4. Gửi đúng biến thể hành động đã mô tả, đặt timeout và kiểm soát số lượt.
5. Kiểm tra response/WS + **không có tác dụng phụ trái phép** + tài nguyên khác vẫn an toàn.
6. Chụp log đã mask bí mật, lưu trace và đánh dấu trạng thái.
7. Nếu FAIL, tái hiện tối thiểu rồi phân loại lỗi product/test/env/contract trước khi sửa source; chạy regression.

### VII.2. Mẫu báo cáo lỗi

```text
Test ID: T06-SIG-001
Priority: P0
Source commit / run ID: ...
Threat / requirement: Logged-out JWT cannot act on signaling
Fixture: A token acquired through real API, logout complete
Steps: ...
Observed: HTTP 401, signaling accepted; event relay ...
Expected: no authenticated signaling capability after revocation
Side effects: events, DB/Redis state ...
Evidence: sanitized HTTP/WS trace, log paths, timestamps
Classification: FAIL_PRODUCT | FAIL_TEST | FAIL_ENV | NEEDS_CONTRACT
Root cause hypothesis: ... (chưa coi là kết luận)
Proposed fix & regression: ...
```

### VII.3. Điều kiện nghiệm thu T06

- 100% case **P0 áp dụng** được thực hiện và PASS; case `N/A` phải có lý do, người phê duyệt và bằng chứng. Lỗi E10 phải được xử lý, kiểm chứng lại.
- P1 thuộc ranh giới bảo mật trọng yếu được thực thi, không còn vấn đề **Critical/High** chưa xử lý hoặc chưa có quyết định chấp thuận rủi ro bằng văn bản.
- Mỗi kết luận PASS có oracle về **side effect không được phép**, không chỉ HTTP 401/403.
- Secret và token được lược trong toàn bộ logs, XML/report; test không làm bẩn dữ liệu ngoài run_id.
- Cấu hình quan trọng (TLS, CORS, actuator, internal network access, dependency scan) được kiểm tra trên môi trường tương đồng deployment hoặc ghi rõ chưa được bảo đảm.
- Không dùng “T06 PASS” để khẳng định ứng dụng an toàn tuyệt đối hay đã trải qua penetration test thực tế.

## VIII. Những chỗ phải xác minh trước khi viết assertion cố định

1. `signaling/src` phiên bản mới: handshake, token revocation, active session checks, trusted source of CALL_OFFER/ANSWER/ICE/END, pending offer, rate limit và event error/close.
2. `docs/04_API.md` bản mới: status 403/404 và privacy policy của video/hội thoại; cách từ chối WebSocket (HTTP handshake hay close code).
3. Runner `run.cjs`: labels, database test isolation, object bucket, webhook secret riêng, log redaction, cleanup khi fail.
4. `application.yml` và deployment: CORS origins, JWT expiry/secret, Redis policy, Actuator, MinIO presign TTL, Nginx/TLS/WSS/network policies.
5. Migrations: constraints/index/quota logic và các rule tài khoản xóa mềm; cần đối chiếu với source mới.
6. Build/CI/dep manifests: OWASP SCA/SBOM/secret scanning chưa thể xác minh từ ZIP Java.

## IX. Ghi chú về sự khác nhau giữa phát hiện và bằng chứng

**Đã xác minh từ Java snapshot:** Spring Security stateless; JWT HS256; Redis token blacklist; two internal request filters; messaging handshake có kiểm tra trạng thái user/token; MinIO multipart và presigned URL; business checks ở Service.

**Kết quả E2E được người dùng cung cấp:** 12/14 case PASS; E09 và E10 FAIL ở lần chạy 19/10/2026.

**Chưa thể khẳng định:** nguồn lỗi Node signaling sau khi sửa, độ an toàn của deployment/TLS/Actuator thực tế, chính sách rate limit login, config CI và dependency CVEs hiện tại. Không đánh dấu `PASS` hoặc `FAIL_PRODUCT` cho các kịch bản mới nếu chưa chạy.

---
**Thống kê tự kiểm tra tài liệu:** `13` nhóm, `206` test case ID duy nhất; P0 `90`, P1 `113`, P2 `3`. Toàn bộ trạng thái khởi tạo `NOT_RUN` (trừ ghi chú kết quả E2E lịch sử, không thay trạng thái T06).

## X. Phụ lục: 8 kịch bản mẫu trình bày ở mức có thể tự triển khai ngay

Các kịch bản ở Phần IV là **test specification**, không phải code. Phần này diễn giải thật chậm các test quan trọng để bạn biết phải dựng fixture, gửi request theo trình tự nào, và chứng minh điều gì. Số ID dưới đây **tham chiếu case có sẵn**, không cộng thêm vào tổng 206.

### X.1. AUTH-012 / SIG-001 / CROSS-001 — Logout phải thu hồi quyền ở mọi kênh

**Mục tiêu an ninh.** Một access token đã bị thu hồi không còn là bằng chứng xác thực hợp lệ, dù client giao tiếp qua HTTP, messaging WebSocket hay signaling. Không được xảy ra trường hợp cùng một JWT bị HTTP từ chối nhưng vẫn có thể thiết lập cuộc gọi.

**Chuẩn bị:**

1. Khởi động backend Java, Redis, PostgreSQL và Node signaling **thật** trên môi trường E2E riêng. Xác nhận đồng hồ của Java và Node gần nhau.
2. Đăng ký A qua API thật, giữ access/refresh trong bộ nhớ tiến trình test, tuyệt đối không in ra console.
3. Tạo B với JWT riêng, mở messaging socket B làm nơi quan sát tác dụng phụ của cuộc gọi.
4. Trước khi logout, kiểm tra A dùng access token gọi `/users/me` thành công và tạo được signaling socket hợp lệ. Đây là kiểm tra fixture, chưa phải kết quả an ninh.

**Thao tác và checkpoint:**

1. Đóng socket A đang dùng để kiểm thử điều kiện *kết nối mới*; gọi `/auth/logout` với access + refresh của A.
2. Xác nhận logout thành công và truy cập HTTP `/users/me` bằng access cũ bị từ chối.
3. Kiểm tra Redis blacklist/revocation bằng quyền test đã giới hạn, ghi lại *sự tồn tại* của trạng thái thu hồi (không log token).
4. Thử mở **messaging WebSocket mới** bằng access cũ. Ghi lại lỗi HTTP Upgrade hoặc close code.
5. Thử mở **signaling WebSocket mới** bằng access cũ; nếu bắt tay thành công tạm thời, gửi một event thử nghiệm để xác nhận không được relay.
6. Quan sát socket B, xác nhận B **không** nhận `CALL_INCOMING`/`CALL_OFFER` từ A vừa logout.
7. Chạy một case riêng cho **socket đã mở trước logout**. Tài liệu hóa thời hạn mà server cần để đóng hoặc chặn thao tác; đừng nhập nhằng với kiểm thử kết nối mới.

**PASS:** Token cũ không thể thực hiện hành động có yêu cầu xác thực trên cả ba kênh. Cách thể hiện từ chối có thể là reject khi handshake hoặc close ngay sau handshake, nếu policy cho phép. **FAIL_PRODUCT:** Signaling vẫn relay event cho B sau khi token thu hồi, hoặc backend khác nhau về chính sách revocation mà chưa được chấp nhận. **Bằng chứng:** cùng run ID, HTTP status, WS lifecycle, sự kiện B, Redis flag và log đã ẩn bí mật.

### X.2. BOLA-003 — Người ngoài không được tạo tin trong hội thoại A–B

**Mục tiêu:** Chứng minh code kiểm tra quyền theo **danh tính đã xác thực**, không tin conversation ID do client cung cấp.

**Chuẩn bị:** Tạo A, B, C; chỉ A–B có hội thoại AB; C có access token hợp lệ nhưng không phải thành viên. Mở messaging sockets A và B. Đếm số row messages của AB trước khi thử.

**Thao tác:** C gửi `POST /conversations/{idAB}/messages` với UUID mới và timestamp hợp lệ để không vướng các validation không liên quan. Theo dõi kết quả HTTP, hàng đợi sự kiện A/B và row count; sau đó C thử đọc history AB để xác minh không lộ thêm thông tin.

**PASS:** Server không cho C gửi tin; số tin AB không tăng, không có `NEW_MESSAGE` do C gây ra, dữ liệu tin của A/B không lộ trong response lỗi. Mã 403 hay 404 cần đối chiếu hợp đồng. Nếu chỉ assertion 403 nhưng DB có thêm row thì test phải **FAIL**.

### X.3. BOLA-006/007/008 — Video của B không bị A điều khiển

**Mục tiêu:** Chứng minh quyền **owner** gắn với cả video ID, upload ID và object key, không chỉ endpoint đọc metadata.

**Chuẩn bị:** B khởi tạo multipart hợp lệ, có `videoId_B`, `uploadId_B`, Redis session và part đã upload trên MinIO. A có access token và một video khác của riêng mình để thử phối hợp ID sai. Snapshot trạng thái `recording`, part list và quota B.

**Thao tác:** Lần lượt thử A gọi chunks, finalize và abort bằng ID/credential của B; thử kết hợp video ID A với upload ID B; cuối cùng B dùng token thật của B tiếp tục upload.

**PASS:** A không tạo thêm part, hoàn tất hoặc hủy phiên của B; không nhận presigned URL điều khiển B; Redis session và object B không bị thay đổi. B vẫn hoàn tất được việc của mình. Mỗi phép thử độc lập để không làm bẩn fixture sau một thất bại.

### X.4. WSM-007/008/012 — WebSocket không cho client giả sự kiện server

**Mục tiêu:** Một socket được xác thực vẫn chỉ được gửi những sự kiện client được cho phép, tới các đối tượng mà chủ socket có quyền tương tác.

**Chuẩn bị:** A–B có hội thoại và socket hợp lệ; C có socket nhưng không thuộc AB; thu thập số sự kiện trên A/B trước test.

**Thao tác:** C gửi `TYPING` chứa `conversation_id` của AB, kèm trường `from_user_id=A`; tiếp tục thử gửi một event loại `NEW_MESSAGE` hoặc `CALL_INCOMING` được giả dạng payload server. Theo dõi lỗi tại socket C, các socket A/B và số bản ghi DB.

**PASS:** Không có sự kiện typing/NEW_MESSAGE/CALL_INCOMING giả gửi đến A/B; C nhận lỗi đúng giao thức hoặc bị giới hạn; không có tin nhắn DB được tạo. Khi gửi payload sai lặp lại, đóng kết nối chỉ theo ngưỡng đã công bố.

### X.5. SIG-005/006/009 — Người ngoài không can thiệp call A–B

**Mục tiêu:** Bảo vệ **conversation/call session state**, không chỉ kiểm tra JWT cho từng socket.

**Chuẩn bị:** A và B tạo một phiên signaling hợp lệ, C có socket độc lập; ghi correlation/session ID nếu giao thức hỗ trợ. Xác nhận A/B đã vào trạng thái call hợp lệ trước khi tấn công thử.

**Thao tác:** C cố gửi `CALL_ANSWER`, `ICE_CANDIDATE`, `CALL_END` với target A/B và tham số phiên A–B. Gửi từng loại riêng, trước khi chuyển loại tiếp theo xác minh A/B còn ở trạng thái đúng.

**PASS:** Không một thông điệp nào của C được relay như thành viên gọi, cuộc gọi A–B không kết thúc sai và C không đọc được SDP/ICE của A/B. Nếu protocol chưa có session binding, ghi **SECURITY_GAP** để thiết kế lại, không giả định xác thực socket là đủ.

### X.6. VID-007/009 và INT-004/009 — Webhook không được tự ý đặt video READY

**Mục tiêu:** Bảo vệ đường `MinIO → Spring Boot`: request từ bên ngoài không được chuyển trạng thái video nếu thiếu quyền dịch vụ hoặc object chưa đúng.

**Chuẩn bị:** A có video `processing` đã upload theo luồng E2E; nhớ trạng thái và quota. Có hai fixture credential: **không secret/sai secret** và **secret đúng trong môi trường test**. Giới hạn thử nghiệm trong bucket riêng.

**Thao tác:** (a) Gửi notification giả thiếu header auth. (b) Gửi notification giả với JWT thường. (c) Gửi với secret đúng nhưng key/object ID không khớp; (d) gửi lặp event cũ sau delete nếu hợp đồng hỗ trợ.

**PASS:** Các request không xác thực không làm thay đổi DB; event đã xác thực nhưng không tương ứng với object/session không tạo READY sai. Kiểm tra quota và Redis session, không chỉ nhìn status HTTP. **Chú ý:** Shared secret xác minh nguồn được tin cậy ở một mức, nhưng không thay thế xác thực ý nghĩa nội dung event.

### X.7. CONFIG-001/002/005 — CORS, Origin và TLS là ba kiểm soát khác nhau

**Mục tiêu:** Chống nhầm lẫn giữa (i) browser CORS, (ii) WS Origin và (iii) mã hóa đường truyền.

**Chuẩn bị:** Có frontend origin hợp lệ, một origin không nằm allowlist, môi trường proxy HTTPS/WSS mô phỏng production.

**Thao tác:** Thử CORS preflight từ hai origin và quan sát response header; sau đó thử mở WebSocket với Origin khác nhau. Kiểm tra endpoint public từ HTTP client không giả định CORS sẽ chặn mọi request không qua trình duyệt. Cuối cùng kiểm tra kết nối HTTP/WS cleartext qua proxy public.

**PASS:** Header CORS chỉ chấp nhận origin hợp lệ; WebSocket handshake có Origin policy đúng; deployment bắt buộc TLS cho giao tiếp công khai. **Không tính CORS PASS là có authentication**; phía server vẫn phải từ chối request thiếu quyền dù là script HTTP client ngoài trình duyệt.

### X.8. LOG-001/003/009 — Test đúng nhưng không được làm rò bí mật qua log

**Mục tiêu:** Báo cáo test tự động không trở thành nơi lưu token, signed URL hay secret.

**Chuẩn bị:** Tạo token/URL giả thật nhưng có giá trị chỉ dùng trong lần chạy và độ dài dễ dò; đánh dấu chúng trong bộ nhớ tool test, không in ra console.

**Thao tác:** Thực hiện đăng nhập, logout, upload, cố tình tạo một lỗi có kiểm soát tại runner; sau đó dùng một bộ kiểm tra cục bộ so khớp các giá trị sentinel với log, JUnit XML, `run.json`, `backend.log`, `signaling.log` và các artifact khác.

**PASS:** Không tìm thấy giá trị nguyên văn trong artifact, nhưng log vẫn có đủ `test ID`, `run ID`, mã lỗi và mốc thời gian để chẩn đoán. Nếu đã lộ secret thật, phải lên kế hoạch thu hồi/rotate và kiểm tra nơi đã phát tán; chỉ xóa dòng log không đủ.

---

## XI. Danh sách 20 case khởi đầu được đề xuất (không phải 20 case mới)

Khi tiến hành T06 thực tế, nên có một *security smoke pack* nhỏ trước khi chạy toàn bộ 206 kịch bản. Bộ này ưu tiên các lỗi liên quan trực tiếp tới quyền truy cập và thất bại signaling lịch sử:

| Thứ tự | Case | Vì sao làm trước |
|---:|---|---|
| 1 | AUTH-003 | Xác minh protected API yêu cầu danh tính |
| 2 | AUTH-004 | Token sai chữ ký không qua xác thực |
| 3 | AUTH-007 | Refresh không đóng vai access |
| 4 | AUTH-010 | Logout được thực thi trên HTTP |
| 5 | AUTH-011 | Token logout không vào messaging WS |
| 6 | AUTH-012 | Token logout không vào signaling — E10 |
| 7 | BOLA-001 | Không đọc conversation của người khác |
| 8 | BOLA-002 | Không đọc message history của người khác |
| 9 | BOLA-003 | Không gửi tin vào conversation người khác |
| 10 | BOLA-006 | Không lấy chunk URL upload của B |
| 11 | BOLA-007 | Không finalize video B |
| 12 | WSM-007 | Không giả typing user khác |
| 13 | WSM-008 | Không nhận sự kiện user khác |
| 14 | WSM-012 | Không giả server-generated WS events |
| 15 | SIG-005 | Outsider không trả lời call A–B |
| 16 | SIG-006 | Outsider không END call A–B |
| 17 | SIG-007 | Không mất offer khi B mở signaling trễ — E09 |
| 18 | INT-001 | Không gọi call notify nếu thiếu shared secret |
| 19 | VID-007 | Không gọi webhook nếu thiếu shared secret |
| 20 | LOG-001 | Không lộ token trong logs |

**Không được coi 20 PASS là T06 hoàn thành**. Đây chỉ là bài kiểm tra nhanh những kiểm soát quan trọng nhất, để phát hiện vấn đề nền tảng trước khi viết toàn bộ test.
