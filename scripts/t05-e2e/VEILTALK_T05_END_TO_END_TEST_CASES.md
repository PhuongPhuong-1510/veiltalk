# VEILTALK — T05: END-TO-END BACKEND TESTING — TEST CASE SPECIFICATION

> **Tài liệu thiết kế kịch bản kiểm thử, không phải source code, chưa có kết quả chạy mới.** Dành để bạn **tự viết test** bằng framework bạn chọn. Không có script test, cấu hình hay thay đổi sản phẩm được tạo trong tài liệu này.
>
> **Phiên bản:** 1.0 • **Ngày:** 19/10/2026 • **Trạng thái:** PROPOSED / CHƯA NGHIỆM THU.

## 1. Mục tiêu và ranh giới của T05

**Mục tiêu:** Chứng minh những **hành trình nghiệp vụ hoàn chỉnh ở cấp backend** hoạt động chính xác qua API HTTP, Spring Boot, PostgreSQL, Redis, MinIO, Messaging WebSocket và Node signaling. Mỗi case không chỉ kiểm tra `200/201`, mà phải đối chiếu kết quả **trước → trong → sau** thao tác, trạng thái lưu trữ, realtime và các tác dụng phụ.

**T05 khác T04:** T04 hỏi “một endpoint nhận dữ liệu và trả response đúng contract không?”. T05 hỏi “cả hành trình gồm nhiều endpoint/dịch vụ có tạo ra kết quả cuối đúng, không thiếu bước và không mâu thuẫn không?”. Vì thế có một số điểm giao nhau nhưng không lặp lại ma trận validation của từng tham số. T06 dành cho kiểm thử bảo mật chuyên sâu; T07 dành cho fault injection, race condition và phục hồi; T08 dành cho throughput/latency/load. Những nhánh có liên quan T06/T07 xuất hiện trong T05 ở mức hành trình cơ bản và có thể dùng chung implementation test.

**Không thuộc kết luận của T05 backend:** giao diện React/Three.js, điều khiển avatar qua camera, WebRTC PeerConnection thật, audio/video/codec, NAT/TURN, reverse-proxy/TLS khi chưa dựng môi trường tương ứng. `CALL_OFFER`, `CALL_ANSWER`, `ICE_CANDIDATE` có payload giả chỉ chứng minh signaling relay, **không chứng minh media call**. File MinIO giả bytes chỉ chứng minh toàn vẹn lưu trữ, **không chứng minh khả năng phát video**.

### 1.1. Nguồn và độ chắc chắn

1. **Source Java:** gói `veiltalk.zip` đã được giải nén: 137 file Java, snapshot có dấu thời gian tháng 9/2026; các package `auth`, `user`, `avatar`, `messaging`, `video`, `call`, `metrics`. Đây là bằng chứng trực tiếp cho hành vi Java tại snapshot đó.
2. **Bộ test E2E 14 case:** file `backend.test.cjs` bạn đã đưa, có `node:test`, `ws`, PostgreSQL/Redis queries và kết quả chạy ngày 19/10/2026: **E01–E08, E11–E14 PASS; E09, E10 FAIL**. Các con số chỉ áp dụng cho lần chạy đã báo cáo, không có lần chạy mới trong tài liệu này.
3. **Khảo sát Codex và mô tả run.cjs:** tham khảo cho Node signaling và cách runner thiết lập environment; source `signaling/src`, `scripts/e2e/run.cjs`, `docs/04_API.md`, config runtime, Flyway migrations **chưa nằm trong source ZIP Java** mà mình có thể kiểm tra trực tiếp. Không coi mã lỗi cụ thể hoặc policy Node chưa đối chiếu là đã được xác thực.
4. **T04:** `VEILTALK_T04_API_CONTRACT_TEST_CASES.md` gồm 195 case. Dùng làm nguồn đối chiếu request field, validation, status code; nếu conflict với source mới, **hợp đồng đã chốt và source chạy hiện hành** phải được xác minh trước khi khóa assertion.

### 1.2. Quy tắc viết và chấm PASS

- **Mỗi case có ID ổn định**, mức ưu tiên, tiền điều kiện, các bước thao tác, điều kiện PASS, bằng chứng phải thu và ghi chú. Trạng thái ban đầu của toàn bộ case trong tài liệu là `NOT_RUN`, trừ bản đồ tham chiếu 14 E2E cũ có trạng thái lịch sử.
- **PASS** khi cả response/event và các bất biến nghiệp vụ, database, Redis/MinIO (nếu liên quan) đều đúng. Một API trả 200 nhưng dữ liệu đã lưu sai, socket phát nhầm người, hoặc quota tính trùng thì **FAIL**.
- **FAIL_PRODUCT** = triển khai vi phạm hợp đồng được xác minh; **FAIL_TEST** = lỗi fixture, assertion, thời gian chờ không hợp lý; **FAIL_ENV** = build/Docker/dịch vụ lỗi; **BLOCKED** = không thể thực hiện vì một bước phụ thuộc chưa đạt; **NEEDS_CONTRACT** = chưa có yêu cầu thống nhất (không được tự ý gán FAIL hay sửa assert cho PASS).
- Kiểm tra các **ID tương quan**: user_id, conversation_id, message.id, call session/correlation ID (nếu có), video.id, upload_id, ETag, object key. Không được chỉ dựa trên loại event hoặc status code khi có nhiều hoạt động cùng lúc.
- Với **sự kiện không được phép xuất hiện** (ví dụ gửi trùng NEW_MESSAGE), dùng cửa sổ quan sát có giới hạn phù hợp và xác minh DB/state; một khoảng 1–3 giây im lặng không chứng minh không bao giờ có event trễ. Nếu yêu cầu có time bound, phải ghi SLAs/timeout trong contract.
- Không so sánh tuyệt đối hai timestamp được lấy từ các máy khác nhau nếu chưa đồng bộ đồng hồ. Đối với dữ liệu nhận từ response, dùng timestamp và ID do server cung cấp để tương quan; dùng polling có hạn thay cho `sleep()` cố định khi chờ webhook/async.
- Không chạy suite trên production. Dùng user/test bucket/Redis namespace và containers cô lập. Không ghi password, token, presigned signature hoặc secret đầy đủ ra log/report.
- **Không sửa assertion để hợp thức hóa E09/E10** khi hành vi mong muốn chưa đổi hợp pháp qua tài liệu yêu cầu. Có thể chấp nhận nhiều hình thức từ chối kết nối hợp lệ nếu chính sách chỉ yêu cầu từ chối, nhưng phải phân biệt thay đổi yêu cầu với sửa bug.

## 2. Môi trường, dữ liệu mồi và cách chạy để test lặp lại

### 2.1. Hệ thống thật tối thiểu

- Backend Spring Boot JAR build từ commit xác định; Node.js signaling build/run từ chính commit đó; PostgreSQL, Redis và MinIO **thật** trong môi trường E2E dùng riêng; bucket đã cấu hình event → `/internal/videos/webhook` thật.
- Token được lấy qua `POST /auth/register`/`login` thật, không tự tạo JWT bằng secret test. Không mock Controller, Service, Database, Redis Pub/Sub hay MinIO cho những case cần kiểm chứng tích hợp thật.
- Kiểm tra đường kết nối giữa các tiến trình và readiness trước khi chạy; capture `run_id`, commit, Java/Node version, DB/migration version và các cổng thực tế.
- Nếu test cần quan sát Redis/SQL/MinIO trực tiếp, các helper chỉ đọc/truy vấn tài nguyên thuộc **run-id E2E**. Đối với thí nghiệm cố ý làm hỏng hệ thống, đưa vào T07 suite tách biệt.

### 2.2. Bộ fixture chuẩn

| Fixture | Định nghĩa | Mục đích |
|---|---|---|
| A | User active, email ngẫu nhiên, biết password, discoverable=true, token còn hạn | Người gửi/chủ dữ liệu |
| B | User active khác A; token riêng; có thể mở nhiều WS | Người nhận/bạn trò chuyện |
| C | User active, không nằm trong hội thoại A–B | Kiểm tra cô lập dữ liệu/sự kiện |
| D1..Dn | 55+ user phụ nếu cần nhiều hội thoại | Cursor pagination cho conversation |
| M1..Mn | 110+ tin nhắn có ID UUID riêng và timestamp hợp lệ | Cursor history, last message, status |
| V1 | Video `recording` đang upload multipart | Abort/chunk/finalize |
| V2 | Video `ready` đã hoàn tất qua MinIO webhook | Library/download/quota/delete |
| Video fixture | Hai part: part 1 tối thiểu 5 MiB, part cuối nhỏ; byte cố định và SHA-256 | Kiểm tra đối chiếu storage thật |
| Old/revoked token | Chỉ lấy bằng login/logout/thời gian test hợp pháp | Kiểm tra phiên |

Đối với bài test nhiều trang, **đóng băng việc ghi dữ liệu** trong lúc duyệt cursor, trừ khi chính case muốn kiểm tra thay đổi dữ liệu khi đang phân trang. Với rate limiter, dùng user mới hoặc chờ hết cửa sổ thay vì làm các case phụ thuộc thứ tự ngẫu nhiên. Tất cả `id`, email và object key do fixture tạo riêng cho từng case, trừ khi case chủ động kiểm tra retry cùng ID.

### 2.3. Template code test do bạn sẽ tự viết sau này

Mỗi case khi triển khai nên ghi thông tin dưới dạng:

```text
ID: T05-MSG-001
Requirement / flow: A gửi tin → B nhận realtime → A/B đọc history
Given: A/B có hội thoại, B đã mở messaging WS, token sống
When: A POST message mới rồi B chờ NEW_MESSAGE tương quan message.id
Then: HTTP + WebSocket + SQL + GET history khớp nhau; DB đúng một row
Evidence: trace request, event, SQL count, run_id
Cleanup: Tài khoản/test DB tự hủy theo run_id
```

**Lưu ý:** Đây là mẫu cách mô tả test case, không phải JavaScript test code.

## 3. Phân nhóm, ưu tiên và tiêu chí nghiệm thu

- **P0 — Bắt buộc để nghiệm thu backend core:** Đăng ký/login/logout; hội thoại và tin nhắn DB+WS; thiết lập cuộc gọi theo journey đã hứa (bao gồm B kết nối signaling muộn); từ chối token logout trên signaling; video multipart/ready/download/delete; xóa tài khoản; các luồng xuyên module quan trọng.
- **P1 — Hành vi nghiệp vụ, cạnh, nhiều phiên/thiết bị:** Pagination xuyên nhiều request, trạng thái, retry, search/discoverability, heartbeat, từ chối cuộc gọi, quota, cleanup và các luồng độc lập.
- **P2 — Độ bao phủ bổ sung:** Telemetry và các biến thể ít ảnh hưởng nghiệp vụ cốt lõi.

**Exit criteria T05:** (1) Không còn case P0 `FAIL_PRODUCT`/`BLOCKED`/`NEEDS_CONTRACT` chưa xử lý; (2) case P1 bắt buộc theo đặc tả dự án được chạy và xử lý; (3) runner có thể tái lập, có artifact và cleanup an toàn; (4) các case liên quan dữ liệu đối chiếu được DB/Redis/MinIO; (5) ghi rõ phần chưa được bảo đảm (WebRTC media, trình duyệt, bảo mật sâu T06, resilience T07, load T08). Không kết luận “backend an toàn tuyệt đối” hoặc “đã phủ 100%” chỉ vì PASS bộ case này.

## 4. Tổng quan test cases

| Nhóm | Mục đích | P0 | P1 | P2 | Tổng |
|---|---|---:|---:|---:|---:|
| ENV | Khởi động và tính độc lập của môi trường E2E | 3 | 3 | 0 | 6 |
| ACC | Hành trình đăng ký, đăng nhập và vòng đời phiên | 5 | 7 | 0 | 12 |
| USR | Hồ sơ, settings và tìm người dùng như một hành trình | 3 | 5 | 0 | 8 |
| AVA | Hành trình tạo, thay đổi và công khai avatar | 2 | 4 | 0 | 6 |
| CON | Vòng đời hội thoại và danh sách nhiều trang | 5 | 5 | 0 | 10 |
| MSG | Gửi, nhận, đọc và cập nhật trạng thái tin nhắn | 6 | 10 | 0 | 16 |
| WS | Vòng đời Messaging WebSocket cùng hành vi HTTP | 1 | 10 | 0 | 11 |
| CALL | Cuộc gọi qua Node signaling và thông báo trong Spring messaging | 3 | 10 | 0 | 13 |
| VID | Vòng đời video: upload nhiều phần → webhook → library → delete | 7 | 11 | 0 | 18 |
| DEL | Xóa tài khoản và dọn dữ liệu liên quan | 2 | 6 | 0 | 8 |
| MET | Telemetry như một bước phụ trong hành trình người dùng | 0 | 3 | 1 | 4 |
| CROSS | Những hành trình xuyên suốt nhiều module | 5 | 3 | 0 | 8 |
| **TỔNG** | | **42** | **77** | **1** | **120** |

**Lưu ý đếm:** Mỗi dòng ID là một *kịch bản E2E*. Một kịch bản có nhiều checkpoint/assertion; số lượng này không đồng nghĩa số lượng lần gọi API hoặc phần trăm code coverage.

## 5. Đặc tả chi tiết từng kịch bản T05

### 5.1. ENV — Khởi động và tính độc lập của môi trường E2E (6 case)

**Phạm vi:** Kiểm tra hành trình thực thi ngoài tiến trình test, dữ liệu độc lập và khả năng lặp lại (không tính là load test).

**Nguồn tham khảo:** `scripts/e2e/run.cjs (chưa được đính kèm); mô tả runner của người dùng; scripts/e2e/backend.test.cjs`.

**Fixture áp dụng:** Docker, JDK 21, Maven, Node.js và dependencies signaling. Ghi run-id và commit SHA.

#### T05-ENV-001 — Khởi động stack sạch bằng một lệnh [P0]

- **Tiền điều kiện (Given):** Không có backend/signaling đang chạy thủ công; Docker Engine sẵn sàng.
- **Các bước thực hiện (When):**
  1. Chạy `node scripts/t05-e2e/run.cjs` tại root
  2. Quan sát quá trình build JAR, dựng PostgreSQL/Redis/MinIO, start Spring Boot và signaling
  3. Chờ readiness và chạy smoke API/WS.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Runner chỉ bắt đầu test khi mọi dịch vụ thực sự sẵn sàng
  2. Không phụ thuộc process khởi động trước
  3. Thao tác ứng dụng diễn ra qua HTTP/WS thật.
- **Bằng chứng cần lưu:** build.log, backend.log, signaling.log, run.json; container labels; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Cần kiểm tra source run.cjs để khóa tiêu chí readiness cụ thể.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-ENV-002 — Cô lập dữ liệu với môi trường đang có [P0]

- **Tiền điều kiện (Given):** Có stack dev riêng chứa tài khoản và dữ liệu mồi; có quyền đọc để kiểm tra, không sửa.
- **Các bước thực hiện (When):**
  1. Chụp định danh môi trường dev và một số bản ghi mẫu
  2. Chạy E2E trên môi trường test cô lập
  3. Đối chiếu dữ liệu dev sau khi runner dừng.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Không thay đổi DB, bucket, Redis và container của môi trường dev
  2. Chỉ tài nguyên mang nhãn/run-id E2E được tạo/xóa.
- **Bằng chứng cần lưu:** Docker labels, DB snapshot hoặc checksum trước/sau; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Không dùng tài khoản người dùng thật trong fixture.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-ENV-003 — Hai lần chạy độc lập không rò dữ liệu [P1]

- **Tiền điều kiện (Given):** Bộ test có dữ liệu tạo tự động mỗi lần.
- **Các bước thực hiện (When):**
  1. Chạy suite lần 1, lưu artifact theo run-id
  2. Chạy lần 2 với tài khoản/UUID mới
  3. So sánh kết quả và kiểm tra dữ liệu mồi.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Lần hai không đọc được tài nguyên chỉ tồn tại ở DB lần một
  2. Kết quả không phụ thuộc thứ tự chạy hoặc dữ liệu còn sót
  3. Hai lần có run-id khác nhau.
- **Bằng chứng cần lưu:** run.json mỗi lần, DB queries, IDs; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Không lấy tỷ lệ PASS của hai lần thay cho đánh giá độ ổn định dài hạn.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-ENV-004 — Thu dọn chính xác tài nguyên sau test [P0]

- **Tiền điều kiện (Given):** Có thể dựng môi trường cô lập; runner dùng nhãn nhận diện.
- **Các bước thực hiện (When):**
  1. Chạy suite đến kết thúc bình thường
  2. Liệt kê Docker containers/network tương ứng run-id
  3. Kiểm tra backend/signaling process còn sống hay không.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Không còn process hoặc container được runner sở hữu
  2. Không xóa container không thuộc run-id.
- **Bằng chứng cần lưu:** docker ps -a --filter label=veiltalk.e2e; process listing; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Case dọn cleanup khi runner bị kill -9 thuộc T07, không khẳng định finally luôn chạy.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-ENV-005 — Lỗi một case không bị báo thành suite PASS [P1]

- **Tiền điều kiện (Given):** Có một bản chạy kiểm chứng runner, không thay đổi production.
- **Các bước thực hiện (When):**
  1. Tạo thất bại kiểm soát trong một assertion test giả của môi trường test
  2. Chạy runner
  3. Đọc exit code và JUnit.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Exit code khác 0; case FAIL hiện đúng trong XML/log
  2. Không in raw access token/secret vào artifact
  3. Cleanup vẫn được thực hiện.
- **Bằng chứng cần lưu:** results.xml, run.json, exit code, logs; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Chỉ làm trên nhánh hoặc bản sao test; khôi phục assertion trước khi nghiệm thu.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-ENV-006 — Log và artifact không chứa thông tin nhạy cảm [P1]

- **Tiền điều kiện (Given):** Suite thực hiện login, refresh, presigned URL.
- **Các bước thực hiện (When):**
  1. Chạy một lượt toàn suite
  2. Quét file output log và XML cho access/refresh token, password, presigned query signature
  3. Kiểm tra mỗi case có trạng thái, thời gian và lỗi có thể truy nguyên.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Không ghi token/password/signature dạng nguyên văn
  2. Có đủ run-id, phiên bản code, case-ID và thông tin lỗi không nhạy cảm.
- **Bằng chứng cần lưu:** grep/search local; JUnit XML; logs; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Vấn đề log security chuyên sâu thuộc T06; đây là điều kiện vệ sinh E2E.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

### 5.2. ACC — Hành trình đăng ký, đăng nhập và vòng đời phiên (12 case)

**Phạm vi:** Tái hiện luồng người dùng thật từ tài khoản chưa tồn tại đến đăng nhập, refresh, logout và sử dụng API liên quan.

**Nguồn tham khảo:** `auth/AuthController.java; auth/AuthService.java; JwtAuthenticationFilter.java; scripts/e2e/backend.test.cjs E01`.

**Fixture áp dụng:** A mới, B mới; email ngẫu nhiên; mật khẩu mạnh; lưu token chỉ trong bộ nhớ test.

#### T05-ACC-001 — Đăng ký → đọc hồ sơ → đăng nhập lại [P0]

- **Tiền điều kiện (Given):** Email A chưa tồn tại.
- **Các bước thực hiện (When):**
  1. POST /auth/register bằng email duy nhất
  2. Lấy access token đăng ký, GET /users/me
  3. POST /auth/login cùng email/password
  4. GET /users/me bằng access token đăng nhập.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Response đăng ký và login đại diện cùng user_id
  2. Thông tin user đọc lại đúng, không tạo bản ghi users trùng
  3. Token do server thật cấp được endpoint private chấp nhận.
- **Bằng chứng cần lưu:** HTTP + SELECT users theo user_id, refresh_tokens; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Nền từ E01, mở rộng kiểm tra nhất quán giữa 3 bước.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-ACC-002 — Đăng ký trùng email không làm hỏng tài khoản gốc [P0]

- **Tiền điều kiện (Given):** Đã đăng ký A thành công.
- **Các bước thực hiện (When):**
  1. Thử đăng ký lại email A
  2. Đăng nhập bằng mật khẩu gốc
  3. GET /users/me
  4. Đếm bản ghi cùng email trong DB.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Lần đăng ký lại bị từ chối theo contract
  2. Tài khoản gốc, password và quyền truy cập vẫn còn nguyên
  3. Không có user mới trùng email.
- **Bằng chứng cần lưu:** HTTP + users count/hash baseline; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-ACC-003 — Sai mật khẩu rồi đúng mật khẩu [P0]

- **Tiền điều kiện (Given):** Có A active.
- **Các bước thực hiện (When):**
  1. Login bằng mật khẩu sai
  2. Ghi nhận kết quả
  3. Login lại bằng mật khẩu đúng
  4. Đọc dữ liệu private.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Login sai không cấp token và không làm thay đổi khả năng login hợp lệ
  2. Login đúng hoạt động
  3. Không tạo refresh token khi login sai.
- **Bằng chứng cần lưu:** HTTP + refresh_tokens trước/sau; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-ACC-004 — Đăng ký → refresh → tiếp tục phiên [P0]

- **Tiền điều kiện (Given):** A vừa đăng ký có access và refresh token.
- **Các bước thực hiện (When):**
  1. POST /auth/refresh bằng refresh token
  2. Dùng access token mới GET /users/me
  3. So khớp định danh với A.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Access token mới sử dụng được
  2. Không đổi người sở hữu phiên
  3. Không sinh thêm user record.
- **Bằng chứng cần lưu:** HTTP + users/refresh_tokens; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Không mặc định refresh token rotation: AuthService snapshot chỉ cấp access token mới.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-ACC-005 — Login → logout → vô hiệu hóa phiên theo phạm vi logout [P0]

- **Tiền điều kiện (Given):** A có cặp access/refresh từ login.
- **Các bước thực hiện (When):**
  1. POST /auth/logout dùng đúng cặp token
  2. GET /users/me với access cũ
  3. POST /auth/refresh với refresh cũ.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Logout thành công theo contract
  2. Access và refresh cũ không thể tiếp tục phiên HTTP
  3. Trạng thái thu hồi được ghi nhận thực tế.
- **Bằng chứng cần lưu:** HTTP + Redis blacklist + refresh_tokens revoked_at; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Đồng bộ signaling được test tại CALL-011, thuộc E10 đang FAIL.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-ACC-006 — Nhiều lần đăng nhập và logout một phiên [P1]

- **Tiền điều kiện (Given):** A đăng nhập ở thiết bị giả lập X và Y; mỗi lần lấy cặp token riêng.
- **Các bước thực hiện (When):**
  1. Đọc dữ liệu bằng token X, Y
  2. Logout X với cặp token X
  3. Kiểm tra lại X và Y
  4. Đối chiếu refresh tokens.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. X không tiếp tục truy cập; Y vẫn hợp lệ nếu hợp đồng là logout theo phiên
  2. DB chỉ thu hồi refresh token X.
- **Bằng chứng cần lưu:** HTTP + refresh_tokens; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Nếu tài liệu hiện hành quy định logout mọi thiết bị thì NEEDS_CONTRACT; không mặc định chính sách.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-ACC-007 — Logout phải dùng refresh token thuộc đúng user [P1]

- **Tiền điều kiện (Given):** Tạo tài khoản A và B cùng có access/refresh.
- **Các bước thực hiện (When):**
  1. A gọi logout nhưng gửi refresh token của B
  2. Kiểm tra token A/B sau yêu cầu.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Không thu hồi nhầm phiên của B
  2. A/B vẫn có trạng thái theo hợp đồng
  3. DB/Redis không có tác dụng phụ trái quyền.
- **Bằng chứng cần lưu:** HTTP + refresh_tokens + Redis; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Là hành trình bảo mật cơ bản; tấn công token chuyên sâu sang T06.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-ACC-008 — Hồ sơ thay đổi trong một phiên đang hoạt động [P1]

- **Tiền điều kiện (Given):** A đã login.
- **Các bước thực hiện (When):**
  1. PUT /users/me thay display_name
  2. GET /users/me với token đang có
  3. Refresh rồi GET /users/me lần nữa.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Định danh không đổi
  2. Display_name mới tồn tại qua refresh và request mới
  3. Không phải đăng ký lại hoặc đổi token chỉ để đọc hồ sơ.
- **Bằng chứng cần lưu:** HTTP + SELECT users; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-ACC-009 — Đăng nhập phản ánh trạng thái đã có avatar [P1]

- **Tiền điều kiện (Given):** A đăng ký chưa có avatar; catalog có model hợp lệ.
- **Các bước thực hiện (When):**
  1. Login lấy cờ trạng thái avatar
  2. PUT /avatars/me hợp lệ
  3. Login lại, đọc flag avatar
  4. GET /avatars/me.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Cờ avatar ở lần login sau phản ánh tình trạng đã tạo avatar
  2. Profile được lưu và thuộc đúng A.
- **Bằng chứng cần lưu:** HTTP + avatar_profiles; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Tên field flag phải lấy từ LoginResponse thực tế hiện hành.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-ACC-010 — Refresh token sau khi xóa tài khoản [P1]

- **Tiền điều kiện (Given):** A đã login, giữ refresh token; mật khẩu được biết.
- **Các bước thực hiện (When):**
  1. DELETE /users/me bằng mật khẩu đúng
  2. Thử refresh cũ
  3. Thử đăng nhập lại
  4. Kiểm tra users.deleted_at.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Không tái kích hoạt tài khoản đã xóa
  2. Refresh/login bị từ chối
  3. Soft-delete đã được ghi DB.
- **Bằng chứng cần lưu:** HTTP + users.deleted_at + refresh_tokens; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Không đo cleanup video ở đây; xem DEL.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-ACC-011 — Một tài khoản hoạt động qua nhiều request độc lập [P1]

- **Tiền điều kiện (Given):** A login, có token còn hạn.
- **Các bước thực hiện (When):**
  1. Gọi nối tiếp GET /users/me, GET settings, GET avatar/models, GET conversations, GET videos
  2. Kiểm tra thông tin nhận dạng và quyền người dùng xuyên các response.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Các endpoint private đồng nhất người dùng A; không lẫn B
  2. Không có thay đổi DB ngoài những thao tác yêu cầu rõ ràng.
- **Bằng chứng cần lưu:** HTTP + DB basic checks; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** T04 kiểm tra schema từng endpoint; T05 kiểm tra cả chuỗi.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-ACC-012 — Refresh và logout liên tục theo thứ tự hợp lệ [P1]

- **Tiền điều kiện (Given):** A có refresh token R và access A1.
- **Các bước thực hiện (When):**
  1. Refresh R để lấy A2
  2. Logout bằng A2 và R
  3. Thử A1, A2 và R theo chính sách thu hồi
  4. So sánh trạng thái.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. A2 không dùng được sau logout; R không còn hiệu lực
  2. A1 còn hiệu lực theo hợp đồng hiện tại (chỉ blacklist access token dùng để logout); phiên đăng nhập độc lập B1 vẫn hợp lệ.
- **Bằng chứng cần lưu:** HTTP + Redis/DB; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Chính sách đã chốt cho T05 là giữ hợp đồng API hiện tại: chỉ access token dùng để logout bị thu hồi, cùng với refresh token của phiên đó.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

### 5.3. USR — Hồ sơ, settings và tìm người dùng như một hành trình (8 case)

**Phạm vi:** Kiểm tra các thay đổi được duy trì qua các request và ảnh hưởng đúng tới chức năng tìm người/hội thoại.

**Nguồn tham khảo:** `user/UserProfileController.java; UserProfileService.java; UserSearchService.java; UserAccountService.java`.

**Fixture áp dụng:** A, B, C active; B có thể điều chỉnh discoverable; tài khoản test mới để không vướng rate limit tìm kiếm.

#### T05-USR-001 — Cập nhật hồ sơ → đọc lại → đăng nhập lại [P0]

- **Tiền điều kiện (Given):** A mới đăng ký.
- **Các bước thực hiện (When):**
  1. PUT /users/me đổi display_name
  2. GET /users/me
  3. Login lại
  4. GET /users/me bằng token mới.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Tên mới nhất quán qua nhiều phiên
  2. users.display_name đúng
  3. Không thay đổi user_id.
- **Bằng chứng cần lưu:** HTTP + PostgreSQL users; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Tái sử dụng E02, mở rộng vòng phiên.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-USR-002 — Đổi settings → đọc lại sau request độc lập [P0]

- **Tiền điều kiện (Given):** A đã đăng nhập.
- **Các bước thực hiện (When):**
  1. GET /users/me/settings lấy baseline
  2. PUT /users/me/settings đổi theme, discoverable, email_notifications
  3. GET lại và query users.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Giá trị lưu khớp request theo hợp đồng
  2. Các trường không đổi vẫn giữ nguyên nếu API thiết kế partial update.
- **Bằng chứng cần lưu:** HTTP + PostgreSQL users; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Kiểm tra merge/replace theo DTO/service hiện hành.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-USR-003 — Ẩn discoverable → người khác không tìm thấy → bật lại [P0]

- **Tiền điều kiện (Given):** A và B active; A biết email B; rate limit sạch.
- **Các bước thực hiện (When):**
  1. A search B khi B discoverable=true
  2. B PUT settings discoverable=false
  3. A search lại B
  4. B bật true
  5. A search lại.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Chỉ xuất hiện khi B cho phép tìm kiếm
  2. Không lộ dữ liệu người dùng ẩn qua response
  3. Người B vẫn tự đọc được hồ sơ.
- **Bằng chứng cần lưu:** HTTP + users.is_discoverable; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Không dùng quá 10 lượt search/phút/tài khoản.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-USR-004 — Tìm người dùng → tạo hội thoại → hiển thị tên [P1]

- **Tiền điều kiện (Given):** A và B có thể tìm nhau.
- **Các bước thực hiện (When):**
  1. A tìm B qua email
  2. Lấy id B từ kết quả
  3. POST /conversations với B
  4. GET /conversations/{id}
  5. B thay display_name rồi A GET lại.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. ID tìm được dẫn đến đúng B
  2. Hội thoại gắn đúng đôi A/B
  3. Thông tin hiển thị được lấy theo quy tắc mới nhất của backend.
- **Bằng chứng cần lưu:** HTTP + conversations + users; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-USR-005 — Hai tài khoản cài đặt độc lập [P1]

- **Tiền điều kiện (Given):** A và B active.
- **Các bước thực hiện (When):**
  1. A đổi theme và discoverable; B đổi thành bộ giá trị khác
  2. A và B GET settings ở request mới
  3. Đối chiếu DB.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Không ghi nhầm settings giữa hai user
  2. Các giá trị của A/B độc lập.
- **Bằng chứng cần lưu:** HTTP + users; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-USR-006 — Dữ liệu hồ sơ unicode đi qua toàn hành trình [P1]

- **Tiền điều kiện (Given):** A active.
- **Các bước thực hiện (When):**
  1. PUT display_name tiếng Việt, emoji, ký tự kết hợp hợp lệ
  2. GET profile
  3. Tạo hội thoại với B
  4. B GET chi tiết hội thoại.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Tên được lưu/đọc nguyên vẹn và hiển thị nhất quán theo DTO
  2. Không hỏng mã hóa UTF-8.
- **Bằng chứng cần lưu:** HTTP + users + conversations; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Giới hạn độ dài và ký tự vẫn theo T04.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-USR-007 — Tìm người đã xóa sau thay đổi trạng thái [P1]

- **Tiền điều kiện (Given):** B active, ban đầu discoverable, A có thể tìm thấy B.
- **Các bước thực hiện (When):**
  1. A search thấy B
  2. B DELETE account
  3. A search lại B
  4. A GET thông tin liên quan theo API công khai thích hợp.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Tài khoản đã xóa không còn hiển thị qua search
  2. Không lộ dữ liệu riêng hoặc khôi phục nhầm B.
- **Bằng chứng cần lưu:** HTTP + users.deleted_at; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Luồng read avatar sau delete cũng được test trong DEL.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-USR-008 — Rate limit search không ảnh hưởng API khác [P1]

- **Tiền điều kiện (Given):** A active, B active; cửa sổ tìm kiếm riêng.
- **Các bước thực hiện (When):**
  1. A tìm B đến giới hạn hợp lệ rồi vượt ngưỡng
  2. Dùng A GET /users/me và GET /conversations
  3. Thử B search riêng.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Search của A được giới hạn theo contract
  2. Các API không liên quan tiếp tục hoạt động
  3. B không bị giới hạn bởi A.
- **Bằng chứng cần lưu:** HTTP + Redis TTL/counter; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Rate-limit contract chi tiết thuộc T04; T05 kiểm tra tác động chuỗi.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

### 5.4. AVA — Hành trình tạo, thay đổi và công khai avatar (6 case)

**Phạm vi:** Kết hợp catalog in-memory, hồ sơ avatar trong DB và trạng thái hiển thị cho người khác.

**Nguồn tham khảo:** `avatar/AvatarController.java; AvatarService.java; AvatarModelCatalogService.java; auth/AuthService.java`.

**Fixture áp dụng:** Hai user active, danh mục có ít nhất một model; các customizations tuân theo metadata model.

#### T05-AVA-001 — Onboarding: tài khoản chưa avatar → chọn model → login lại [P0]

- **Tiền điều kiện (Given):** A đăng ký mới, chưa tạo avatar.
- **Các bước thực hiện (When):**
  1. Login lấy cờ avatar
  2. GET /avatars/models
  3. PUT /avatars/me model hợp lệ
  4. GET /avatars/me
  5. Login lần nữa.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Cờ avatar đổi đúng theo vòng đời
  2. Model/profile được lưu DB
  3. Cấu hình nhận lại đúng.
- **Bằng chứng cần lưu:** HTTP + avatar_profiles; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-AVA-002 — Avatar công khai cho bạn trò chuyện [P0]

- **Tiền điều kiện (Given):** A, B có account; B đã tạo avatar.
- **Các bước thực hiện (When):**
  1. A POST /conversations với B
  2. A GET /avatars/{B}
  3. B cập nhật avatar model/customizations
  4. A GET lại.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Profile công khai thuộc đúng B, phản ánh thay đổi đã lưu
  2. Không trộn avatar A/B.
- **Bằng chứng cần lưu:** HTTP + avatar_profiles + conversations; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-AVA-003 — Update avatar liên tiếp không tạo hồ sơ trùng [P1]

- **Tiền điều kiện (Given):** A có avatar.
- **Các bước thực hiện (When):**
  1. PUT avatar lần 1
  2. PUT avatar lần 2 hợp lệ
  3. GET own và public
  4. Đếm avatar_profiles của A.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Chỉ một profile logic cho A
  2. Dữ liệu lần cập nhật cuối được phản ánh nhất quán.
- **Bằng chứng cần lưu:** HTTP + SELECT avatar_profiles; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-AVA-004 — Từ chối cập nhật model sai nhưng giữ model cũ [P1]

- **Tiền điều kiện (Given):** A đã có avatar hợp lệ.
- **Các bước thực hiện (When):**
  1. GET và lưu bản gốc
  2. PUT model_id không tồn tại hoặc cấu hình không được hỗ trợ
  3. GET lại
  4. B GET avatar công khai.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Yêu cầu sai bị từ chối theo contract
  2. Dữ liệu đã lưu không bị thay đổi
  3. Public/own nhất quán.
- **Bằng chứng cần lưu:** HTTP + avatar_profiles; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Các biến thể input thuần validation thuộc T04.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-AVA-005 — Avatar và danh mục không làm thay đổi trạng thái nhau [P1]

- **Tiền điều kiện (Given):** A/B có avatar.
- **Các bước thực hiện (When):**
  1. Lấy catalog snapshot
  2. A/B thay customizations trong phạm vi hợp lệ
  3. Lấy catalog snapshot lần nữa
  4. So sánh.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Catalog server quản lý không bị thay đổi theo tùy biến người dùng
  2. Avatar A/B độc lập.
- **Bằng chứng cần lưu:** HTTP + catalog response + avatar_profiles; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-AVA-006 — Xóa user → avatar công khai không còn truy cập như trước [P1]

- **Tiền điều kiện (Given):** B đã có avatar, A đã xem avatar B.
- **Các bước thực hiện (When):**
  1. B DELETE account
  2. A GET /avatars/{B} và tìm B qua search
  3. Đối chiếu deleted_at/avatar profile.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. API công khai tuân theo chính sách soft delete; không tiếp tục lộ avatar của user đã xóa
  2. DB state không bị phục hồi.
- **Bằng chứng cần lưu:** HTTP + users + avatar_profiles; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Không mặc định avatar row vật lý bị xóa; có thể chỉ ẩn theo user state.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

### 5.5. CON — Vòng đời hội thoại và danh sách nhiều trang (10 case)

**Phạm vi:** Kiểm chứng tạo-or-get, hiển thị dữ liệu người còn lại, last_message, cursor pagination qua nhiều HTTP request.

**Nguồn tham khảo:** `messaging/ConversationController.java; ConversationService.java; ConversationRepository.java`.

**Fixture áp dụng:** A có quan hệ hội thoại với nhiều user test B1..Bn; đóng băng nguồn tạo dữ liệu trong lúc duyệt cursor nếu cần.

#### T05-CON-001 — A tạo hội thoại với B → cả hai đọc được [P0]

- **Tiền điều kiện (Given):** A/B active, chưa có hội thoại chung.
- **Các bước thực hiện (When):**
  1. A POST /conversations B
  2. A GET detail
  3. B GET detail
  4. Query conversations.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Hai chiều trả cùng một conversation ID và đúng người còn lại
  2. Chỉ một bản ghi cặp A/B.
- **Bằng chứng cần lưu:** HTTP + conversations; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-CON-002 — Tạo-or-get từ hai chiều không nhân đôi [P0]

- **Tiền điều kiện (Given):** Có A/B, đã tạo hội thoại A-B.
- **Các bước thực hiện (When):**
  1. A POST tạo lại B
  2. B POST tạo lại A
  3. GET list hai bên
  4. Query count cặp user.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Cùng ID, không sinh bản ghi mới; thông tin conversation nhất quán trong cả list/detail.
- **Bằng chứng cần lưu:** HTTP + conversations unique pair; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-CON-003 — Danh sách của hai user được cô lập [P0]

- **Tiền điều kiện (Given):** A-B và B-C có hội thoại; A không liên quan B-C.
- **Các bước thực hiện (When):**
  1. GET /conversations của A/B/C
  2. GET detail các ID liên quan đúng quyền
  3. Đối chiếu tập ID.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Mỗi user thấy đúng những hội thoại mình tham gia
  2. Không xuất hiện ID hội thoại người ngoài.
- **Bằng chứng cần lưu:** HTTP + conversations; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-CON-004 — Hội thoại chưa có tin: list và detail thống nhất [P1]

- **Tiền điều kiện (Given):** A/B mới tạo hội thoại trống.
- **Các bước thực hiện (When):**
  1. GET list của A, B
  2. GET detail từ A, B
  3. Đối chiếu last_message và timestamp.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Conversation ID và other_user đúng ở cả hai phía
  2. Trường last_message rỗng/null theo DTO khi chưa có tin.
- **Bằng chứng cần lưu:** HTTP + conversations; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-CON-005 — Gửi tin → last_message xuất hiện ở cả list và detail [P0]

- **Tiền điều kiện (Given):** A/B có hội thoại trống.
- **Các bước thực hiện (When):**
  1. A gửi message mới
  2. GET list của A và B
  3. GET detail hai bên
  4. GET history.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Last message trong list/detail khớp nội dung, sender_id, client_timestamp và status của tin; DTO last_message hiện không có `id`, nên dùng history và SQL để đối chiếu ID tin nhắn
  2. Không tạo thêm conversation.
- **Bằng chứng cần lưu:** HTTP + messages + conversations; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-CON-006 — Hoạt động mới thay đổi thứ tự danh sách hội thoại [P1]

- **Tiền điều kiện (Given):** A có ít nhất 3 hội thoại và hoạt động ở thời điểm phân biệt.
- **Các bước thực hiện (When):**
  1. Ghi danh sách thứ tự trước
  2. A gửi tin mới ở hội thoại ít hoạt động nhất
  3. GET list mới và detail.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Updated_at/order phản ánh hoạt động theo quy tắc cursor và sorting hiện hành
  2. Các hội thoại khác không mất.
- **Bằng chứng cần lưu:** HTTP + conversations.updated_at; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Nếu timestamp đồng độ phân giải, dùng tie-break UUID, không so sánh theo sleep may rủi.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-CON-007 — Cursor phân trang hội thoại từ đầu đến hết [P0]

- **Tiền điều kiện (Given):** A có trên 50 hội thoại với định danh cố định và trật tự xác định.
- **Các bước thực hiện (When):**
  1. Gọi GET /conversations?limit=7
  2. Dùng next_cursor liên tiếp đến has_more=false
  3. Tập hợp ID mọi trang
  4. Đối chiếu DB.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Không lặp/thiếu ID khi dữ liệu ổn định; đúng chủ sở hữu, đúng total và thứ tự theo contract
  2. Trang cuối kết thúc hợp lệ.
- **Bằng chứng cần lưu:** HTTP pages + SQL ordered ids; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Không phát sinh dữ liệu mới trong lúc kiểm thử bộ cursor cơ bản.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-CON-008 — Cursor khi nhiều hội thoại cùng thời điểm [P1]

- **Tiền điều kiện (Given):** Tạo fixture có updated_at bằng nhau bằng setup có kiểm soát, không sửa schema production.
- **Các bước thực hiện (When):**
  1. GET list limit=1/2 liên tiếp
  2. Duyệt toàn bộ
  3. So tập ID.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Tie-break ổn định, không trùng/bỏ sót ID, không lặp vô hạn.
- **Bằng chứng cần lưu:** HTTP + SQL timestamps/IDs; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-CON-009 — Nhiều tin nhắn trong một hội thoại không nhân bản list [P1]

- **Tiền điều kiện (Given):** A/B có hội thoại; tạo nhiều tin từ A và B.
- **Các bước thực hiện (When):**
  1. Gửi chuỗi message
  2. GET list A/B
  3. GET detail
  4. Đếm hội thoại cùng cặp trong DB.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Danh sách vẫn chỉ có một hội thoại A-B; last_message là message cuối theo quy tắc; không trộn người gửi.
- **Bằng chứng cần lưu:** HTTP + DB conversation/messages; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-CON-010 — Profile user khác thay đổi nhưng quan hệ hội thoại không đổi [P1]

- **Tiền điều kiện (Given):** A/B có hội thoại và B thay tên.
- **Các bước thực hiện (When):**
  1. A GET detail trước
  2. B PUT /users/me đổi tên
  3. A GET detail sau
  4. GET list A.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. ID cặp user giữ nguyên; tên hiển thị phản ánh dữ liệu hiện hành; không làm thay đổi dữ liệu message.
- **Bằng chứng cần lưu:** HTTP + DB users/conversations; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

### 5.6. MSG — Gửi, nhận, đọc và cập nhật trạng thái tin nhắn (16 case)

**Phạm vi:** Tập trung đường HTTP → PostgreSQL → Redis Pub/Sub → WebSocket và kiểm tra trạng thái persisted.

**Nguồn tham khảo:** `messaging/MessageService.java; MessageRepository.java; MessageRealtimePublisher.java; MessagingRedisSubscriber.java; scripts/e2e/backend.test.cjs E04–E07`.

**Fixture áp dụng:** A/B là hai thành viên, C là outsider; các HTTP request tạo tin nhắn dùng UUID riêng + client_timestamp ISO hiện tại (±5 phút).

#### T05-MSG-001 — A gửi tin → B nhận NEW_MESSAGE → hai bên xem lịch sử [P0]

- **Tiền điều kiện (Given):** A/B có hội thoại; B đã mở messaging socket.
- **Các bước thực hiện (When):**
  1. A POST tin mới với ID X
  2. Chờ B nhận NEW_MESSAGE X
  3. A và B GET history
  4. Query messages X.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. POST tạo mới; sự kiện chứa đúng X, conversation và người gửi
  2. DB đúng một bản ghi
  3. Lịch sử A/B chứa cùng nội dung và ID.
- **Bằng chứng cần lưu:** HTTP + WS envelope + SQL messages; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-MSG-002 — B gửi trả lời → A nhận → lịch sử hai chiều [P0]

- **Tiền điều kiện (Given):** A và B đều đã mở messaging WS; có conversation.
- **Các bước thực hiện (When):**
  1. A gửi X, B nhận
  2. B gửi Y, A nhận
  3. GET history từ cả hai, so thứ tự X/Y và user IDs.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Hai chiều nhận đúng thông điệp, không gửi nhầm sender
  2. Hai bên đọc cùng lịch sử, DB đúng 2 tin.
- **Bằng chứng cần lưu:** HTTP + 2 WS + DB; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-MSG-003 — Một người dùng mở hai tab cùng nhận tin [P0]

- **Tiền điều kiện (Given):** B mở WS1 và WS2 riêng, A ở hội thoại.
- **Các bước thực hiện (When):**
  1. A gửi X
  2. Chờ NEW_MESSAGE X ở WS1 và WS2
  3. Đối chiếu body sự kiện với POST response và DB.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Cả hai socket đang mở nhận đúng một sự kiện X
  2. Tin trong DB chỉ có một bản ghi.
- **Bằng chứng cần lưu:** 2 WS + HTTP + SQL; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Kế thừa E04.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-MSG-004 — Gửi lại UUID cũ không nhân đôi tin và notification [P0]

- **Tiền điều kiện (Given):** A/B có hội thoại; B WS đang mở.
- **Các bước thực hiện (When):**
  1. A gửi X mới và B nhận NEW_MESSAGE X
  2. A POST lại X với body như cũ
  3. Quan sát WS trong cửa sổ bounded và GET history.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Lần retry trả cùng record theo idempotency
  2. DB không tăng thêm hàng
  3. Không có NEW_MESSAGE thứ hai cho cùng X vì retry không tạo mới.
- **Bằng chứng cần lưu:** HTTP status + WS event correlation + SQL; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Không dùng global count WS; chỉ đếm event có ID X.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-MSG-005 — Nhiều request đồng thời cùng ID → một tin thực [P0]

- **Tiền điều kiện (Given):** A/B có conversation; dùng chính xác một UUID X.
- **Các bước thực hiện (When):**
  1. B mở WS
  2. Gửi đồng thời 4 request giống nhau với X
  3. Thu statuses và response IDs
  4. Kiểm tra WS, history, SQL.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Theo contract hiện tại một lượt tạo mới, các lượt còn lại là retry hợp lệ
  2. Một row X
  3. Chỉ một NEW_MESSAGE X.
- **Bằng chứng cần lưu:** HTTP + WS + SQL; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Mở rộng E05 có thêm xác nhận không duplicate realtime.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-MSG-006 — Cùng ID gửi vào cuộc hội thoại khác không làm thay đổi tin gốc [P1]

- **Tiền điều kiện (Given):** A tham gia A-B và A-C; B WS đã mở.
- **Các bước thực hiện (When):**
  1. A gửi ID X trong A-B
  2. A thử gửi X trong A-C
  3. GET histories cả hai
  4. Query row X.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Yêu cầu thứ hai bị từ chối theo contract
  2. X vẫn chỉ thuộc hội thoại A-B; không phát message mới vào A-C.
- **Bằng chứng cần lưu:** HTTP + 2 histories + SQL; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-MSG-007 — Cùng ID từ người gửi khác không chiếm quyền tin [P1]

- **Tiền điều kiện (Given):** A/B có hội thoại; A tạo tin X.
- **Các bước thực hiện (When):**
  1. B dùng X để tạo tin trong cùng hội thoại
  2. Kiểm tra lỗi
  3. A/B lấy history và DB.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Không đổi sender/content của X
  2. Không tạo tin B nhờ việc tái sử dụng X.
- **Bằng chứng cần lưu:** HTTP + SQL + history; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** T04 kiểm tra status, T05 kiểm tra nguyên vẹn dữ liệu.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-MSG-008 — Message status: sent → delivered → read [P1]

- **Tiền điều kiện (Given):** A gửi X; B là recipient; A WS mở.
- **Các bước thực hiện (When):**
  1. B GET history xác nhận X
  2. B PUT status=delivered cho X
  3. Chờ STATUS_UPDATE ở socket A/B theo contract
  4. B PUT status=read
  5. GET history/query SQL.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. DB cuối có read; không downgrade
  2. Mỗi chuyển trạng thái thực sự phát event phù hợp sau commit
  3. Phản hồi đúng message ID.
- **Bằng chứng cần lưu:** HTTP + WS + SQL; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Status khởi tạo phụ thuộc DTO hiện hành; verify trước.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-MSG-009 — Đánh dấu read lặp lại không gây chuyển trạng thái ảo [P1]

- **Tiền điều kiện (Given):** Tin X đã read; A/B WS mở.
- **Các bước thực hiện (When):**
  1. B PUT read một lần xác nhận
  2. Ghi số sự kiện STATUS_UPDATE liên quan X
  3. B PUT read lần hai
  4. GET DB.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Status vẫn read
  2. Không có chuyển trạng thái mới; số event lặp cần theo hợp đồng/implementation, snapshot MessageService không publish nếu unchanged.
- **Bằng chứng cần lưu:** HTTP + WS + SQL; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-MSG-010 — Khi bị từ chối cập nhật status, dữ liệu và realtime giữ nguyên [P1]

- **Tiền điều kiện (Given):** A là người gửi X; B nhận; C không thuộc hội thoại.
- **Các bước thực hiện (When):**
  1. A thử PUT status X; C thử PUT status X
  2. GET X bằng B, query DB
  3. Kiểm tra không có event cập nhật giả.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Không có thay đổi trái quyền
  2. DB giữ nguyên trạng thái trước thử nghiệm
  3. Không publish status update sai.
- **Bằng chứng cần lưu:** HTTP + DB + WS; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Security deep enumeration chuyển T06.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-MSG-011 — Đọc lịch sử nhiều trang và đối chiếu DB [P0]

- **Tiền điều kiện (Given):** A/B có hơn 100 tin kèm timestamp/UUID đã kiểm soát.
- **Các bước thực hiện (When):**
  1. GET history limit=17
  2. Theo prev_cursor lấy các trang cũ
  3. Ghép tất cả ID
  4. So với dữ liệu DB của hội thoại.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Không thiếu/trùng ID trong snapshot ổn định
  2. Mỗi trang đúng thứ tự/thời hạn, cuối có has_more=false.
- **Bằng chứng cần lưu:** HTTP pages + SQL expected ordered IDs; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-MSG-012 — Đọc lịch sử qua reconnect sau khi offline [P1]

- **Tiền điều kiện (Given):** B mở WS rồi đóng, A/B đã có conversation.
- **Các bước thực hiện (When):**
  1. A POST tin X khi B offline
  2. B mở WS mới
  3. B GET history tìm X
  4. A gửi Y
  5. B nhận NEW_MESSAGE Y.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. X không mất khỏi DB/history
  2. Reconnect tiếp tục nhận realtime mới
  3. Không phải gửi lại X để có dữ liệu.
- **Bằng chứng cần lưu:** HTTP + WS + SQL; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Kế thừa E07. Không giả định server tự phát lại X qua WS.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-MSG-013 — Tin Unicode/newline nhất quán giữa DB, HTTP và WS [P1]

- **Tiền điều kiện (Given):** A/B có WS + hội thoại; payload chứa tiếng Việt, emoji, xuống dòng hợp lệ.
- **Các bước thực hiện (When):**
  1. A POST X
  2. B nhận NEW_MESSAGE
  3. GET history A/B
  4. Đọc content từ DB.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Giữ nguyên Unicode và line break ở ba đường
  2. Không double-escape hoặc cắt nội dung.
- **Bằng chứng cần lưu:** HTTP + WS + DB; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-MSG-014 — Gửi chuỗi nhiều tin không đổi thứ tự danh sách sai [P1]

- **Tiền điều kiện (Given):** A/B conversation, tạo 8–15 tin theo timestamp/UUID hợp lệ có thứ tự kiểm soát.
- **Các bước thực hiện (When):**
  1. Lần lượt gửi, lưu server response
  2. GET history và GET list hội thoại
  3. Đối chiếu expected order, latest message.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Mọi ID tồn tại chính xác một lần
  2. Thứ tự history và last_message theo quy tắc API; không dựa mù quáng vào thứ tự socket.
- **Bằng chứng cần lưu:** HTTP + SQL + WS correlation; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Nếu tie cùng millisecond thì dùng khoá phụ UUID theo query thực tế.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-MSG-015 — Ba người: sự kiện tin nhắn chỉ đến người nhận đúng [P1]

- **Tiền điều kiện (Given):** A-B và A-C là hai hội thoại; B/C mở WS.
- **Các bước thực hiện (When):**
  1. A gửi X vào A-B
  2. Xác minh B nhận
  3. Trong cửa sổ bounded xác minh C không nhận X
  4. A gửi Y vào A-C và đối chiếu chiều ngược.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Mỗi socket chỉ nhận các event theo user và hội thoại tương ứng
  2. Không lộ payload chéo.
- **Bằng chứng cần lưu:** HTTP + WS B/C + SQL; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Test của tính cô lập, kiểm thử tấn công có chủ đích chuyển T06.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-MSG-016 — Khi tin được tạo, cả dữ liệu lẫn updated_at hội thoại đều đổi [P1]

- **Tiền điều kiện (Given):** A/B có hội thoại cũ và DB timestamp baseline.
- **Các bước thực hiện (When):**
  1. GET detail/list trước
  2. POST X mới
  3. GET detail/list sau
  4. Query conversation + message X.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Last message trỏ X, updated_at tiến theo quy tắc
  2. Không mất conversation metadata và không ghi trùng message.
- **Bằng chứng cần lưu:** HTTP + conversations + messages; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

### 5.7. WS — Vòng đời Messaging WebSocket cùng hành vi HTTP (11 case)

**Phạm vi:** Kiểm tra WebSocket thật, message fanout, typing, reconnect, lifecycle và tính nhất quán với API.

**Nguồn tham khảo:** `MessagingWebSocketConfig.java; WebSocketAuthHandshakeInterceptor.java; MessagingWebSocketHandler.java; WebSocketKeepAliveScheduler.java; scripts/e2e/backend.test.cjs`.

**Fixture áp dụng:** A/B/C có JWT active; có conversation A-B; client hỗ trợ PING→PONG, event await theo predicate với timeout hữu hạn.

#### T05-WS-001 — Login → mở WS → nhận sự kiện từ HTTP [P0]

- **Tiền điều kiện (Given):** A/B đăng nhập; đã tạo conversation; B mở WS bằng token thật.
- **Các bước thực hiện (When):**
  1. B thực hiện handshake WS
  2. A POST message X
  3. B chờ NEW_MESSAGE X
  4. GET history.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Handshake hợp lệ, data user B đúng
  2. Event X tương ứng DB/history và HTTP.
- **Bằng chứng cần lưu:** WS + HTTP + SQL; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-WS-002 — Một user hai WS: đóng một còn một [P1]

- **Tiền điều kiện (Given):** B có socket B1/B2, A chuẩn bị tin X.
- **Các bước thực hiện (When):**
  1. Đóng B1 xác nhận close
  2. Gửi X từ A
  3. Chờ B2 nhận X
  4. Kiểm tra B1 không thể nhận tiếp.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. B2 hoạt động độc lập
  2. Không làm mất registry/session của B2 khi B1 đóng.
- **Bằng chứng cần lưu:** WS close/events + HTTP; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-WS-003 — Hai người typing đúng chiều và đúng hội thoại [P1]

- **Tiền điều kiện (Given):** A/B WS mở, conversation A-B tồn tại.
- **Các bước thực hiện (When):**
  1. A gửi TYPING với conversation_id
  2. B nhận TYPING
  3. A gửi TYPING_STOP
  4. B nhận TYPING_STOP.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Đúng conversation_id và chiều gửi/nhận; không tạo DB message; sự kiện hợp đồng hợp lệ.
- **Bằng chứng cần lưu:** WS A/B + SQL messages count; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-WS-004 — Typing sai quyền không lộ sự kiện sang người khác [P1]

- **Tiền điều kiện (Given):** A-B conversation, C ở ngoài có WS.
- **Các bước thực hiện (When):**
  1. C gửi TYPING cho conversation A-B
  2. Ghi ERROR/close theo hợp đồng
  3. Chờ kiểm tra A/B không thấy typing của C.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Không có sự kiện trái quyền đến A/B
  2. Socket C được xử lý theo chính sách vi phạm.
- **Bằng chứng cần lưu:** 3 WS + event history; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Danh sách cụ thể các lỗi và giới hạn vi phạm ở T04/T06.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-WS-005 — Tự trả PONG và tiếp tục nhận tin sau heartbeat [P1]

- **Tiền điều kiện (Given):** A/B WS; có thể điều chỉnh clock/heartbeat test bằng cấu hình riêng.
- **Các bước thực hiện (When):**
  1. Đợi server PING
  2. B trả PONG đúng
  3. Sau chu kỳ kế tiếp, A gửi X
  4. B nhận X.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. B không bị ngắt vì thiếu heartbeat khi đã trả PONG; dữ liệu sau đó vẫn tới.
- **Bằng chứng cần lưu:** WS PING/PONG/close + HTTP; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Tránh kéo dài test cố định 30s nếu có cấu hình kiểm thử hợp lệ.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-WS-006 — Đóng WS sạch → kết nối lại cùng user [P1]

- **Tiền điều kiện (Given):** B đang có WS, A/B có conversation.
- **Các bước thực hiện (When):**
  1. B đóng WS bằng close bình thường
  2. Mở B2 bằng token hợp lệ
  3. A gửi X
  4. B2 nhận.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. B2 đăng ký session thành công
  2. Không có trạng thái cũ ngăn reconnect
  3. History X có trong DB.
- **Bằng chứng cần lưu:** WS + HTTP + SQL; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-WS-007 — Socket chỉ phục vụ sự kiện hỗ trợ, không ghi tin qua WS [P1]

- **Tiền điều kiện (Given):** A/B có WS.
- **Các bước thực hiện (When):**
  1. A gửi payload kiểu NEW_MESSAGE trực tiếp lên messaging WS (không dùng HTTP POST)
  2. Ghi phản hồi/chính sách vi phạm
  3. GET history và query DB.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Socket không tự tạo tin mới từ event không được hỗ trợ
  2. Không có row/tin phát tới B.
- **Bằng chứng cần lưu:** WS + HTTP history + SQL; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Trong snapshot chỉ client PONG/TYPING/TYPING_STOP được nhận.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-WS-008 — Sự kiện status đồng bộ giữa nhiều thiết bị người gửi [P1]

- **Tiền điều kiện (Given):** A mở WS1 và WS2; B là recipient của X.
- **Các bước thực hiện (When):**
  1. A gửi X
  2. B cập nhật status thành read
  3. A1/A2 chờ STATUS_UPDATE của X
  4. Query DB.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Hai WS của A nhận trạng thái hợp lệ
  2. DB read
  3. Không mất thông tin khi một tab không thực hiện cập nhật.
- **Bằng chứng cần lưu:** WS A1/A2 + HTTP + SQL; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-WS-009 — User không có socket vẫn lưu tin và đọc lại được [P1]

- **Tiền điều kiện (Given):** B không kết nối messaging WS; A có conversation.
- **Các bước thực hiện (When):**
  1. A gửi X
  2. Kiểm tra DB và GET history cho B
  3. B kết nối WS và A gửi Y.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. X tồn tại dù không có receiver online
  2. Y đến qua realtime khi B online.
- **Bằng chứng cần lưu:** HTTP + DB + WS; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Pub/Sub không phải hàng đợi tự phát lại X.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-WS-010 — Phiên WS mới với access token đã logout bị từ chối [P1]

- **Tiền điều kiện (Given):** B logout bằng token dùng để handshake; WS chưa mở.
- **Các bước thực hiện (When):**
  1. B logout HTTP thành công
  2. Thử mở WS messaging bằng token đã blacklist
  3. Kiểm tra status handshake/close và API HTTP.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Không có kết nối messaging được xác thực bằng access đã thu hồi
  2. Không nhận thông điệp private.
- **Bằng chứng cần lưu:** HTTP + WS auth response + Redis; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Chính sách mã close cụ thể theo runtime/contract, không hardcode một phương thức từ chối duy nhất.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-WS-011 — Sau logout một socket đang mở không tiếp tục hoạt động vô hạn [P1]

- **Tiền điều kiện (Given):** B có WS mở từ trước; A/B conversation.
- **Các bước thực hiện (When):**
  1. B logout bằng access token hiện tại
  2. Quan sát heartbeat/đợt kiểm tra thu hồi
  3. A gửi X sau ngưỡng thời gian kiểm tra dự kiến
  4. Kiểm tra trạng thái WS B.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Kết nối bị đóng theo chính sách thu hồi đã công bố; không nhận dữ liệu riêng tư lâu hơn thời gian cho phép
  2. HTTP token cũ không dùng được.
- **Bằng chứng cần lưu:** WS close, HTTP, Redis, logs; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Giới hạn thời gian còn phải xác minh ở cấu hình runtime; đánh NEEDS_CONTRACT nếu chưa quy định.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

### 5.8. CALL — Cuộc gọi qua Node signaling và thông báo trong Spring messaging (13 case)

**Phạm vi:** Kiểm tra chuỗi thiết lập và kết thúc báo hiệu của cuộc gọi; không đánh đồng với WebRTC media thật.

**Nguồn tham khảo:** `Kết quả E08–E10; mô tả signaling/src/server.js, auth.js trong báo cáo Codex (không có source Node trong ZIP Java).`.

**Fixture áp dụng:** A/B có access token thật; B có messaging WS. SDP/ICE fixture chỉ là chuỗi giao thức giả lập, không phải SDP/ICE thật.

#### T05-CALL-001 — Hai bên kết nối signaling sẵn → full lifecycle [P0]

- **Tiền điều kiện (Given):** A/B có signaling WS mở, B mở messaging WS.
- **Các bước thực hiện (When):**
  1. A tạo UUID `call_id` mới và gửi CALL_OFFER cho B
  2. B nhận CALL_INCOMING qua messaging + CALL_OFFER qua signaling
  3. B gửi CALL_ANSWER
  4. A nhận ANSWER
  5. A gửi ICE_CANDIDATE và B nhận
  6. B gửi CALL_END và A nhận.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. `CALL_INCOMING`, offer, answer, ICE và end có đúng `call_id`, from_user_id và target
  2. Không chuyển nhầm người
  3. Server không báo TARGET_OFFLINE trong điều kiện online.
- **Bằng chứng cần lưu:** Node WS A/B + Spring WS + internal notify logs; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Kế thừa E08; không chứng minh media call.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-CALL-002 — B vào signaling sau thông báo cuộc gọi vẫn nhận offer [P0]

- **Tiền điều kiện (Given):** A mở signaling; B chỉ mở messaging WS lúc bắt đầu.
- **Các bước thực hiện (When):**
  1. A gửi CALL_OFFER với `call_id` mới
  2. B chờ CALL_INCOMING
  3. B mới mở signaling bằng token thật
  4. Chờ offer trong cửa sổ timeout hợp lệ
  5. B ANSWER.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. B nhận đúng offer và `call_id` cuộc gọi đầu, không yêu cầu A gọi lại
  2. A nhận ANSWER
  3. Không trả TARGET_OFFLINE sai khi B vào trong cửa sổ chờ.
- **Bằng chứng cần lưu:** Node signaling A/B + messaging + logs; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Known failure E09. Nếu hợp đồng chưa chốt cửa sổ, NEEDS_CONTRACT về timeout; không sửa assertion để PASS.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-CALL-003 — Người nhận từ chối cuộc gọi [P1]

- **Tiền điều kiện (Given):** A/B signaling online, B có messaging.
- **Các bước thực hiện (When):**
  1. A OFFER
  2. B nhận
  3. B gửi CALL_REJECT
  4. A nhận REJECT
  5. A thử cuộc gọi mới theo chính sách.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. A được thông báo từ chối, phiên cũ không cản trở phiên tiếp theo; không tự thiết lập thành active.
- **Bằng chứng cần lưu:** Node WS messages + signaling logs; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Trạng thái server/map cần kiểm tra runtime hoặc hook test an toàn.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-CALL-004 — Kết thúc cuộc gọi từ người gọi [P1]

- **Tiền điều kiện (Given):** A/B đã OFFER và ANSWER hợp lệ.
- **Các bước thực hiện (When):**
  1. A gửi CALL_END
  2. B nhận CALL_END
  3. Sau đó gửi các sự kiện liên quan phiên cũ hoặc tạo phiên mới theo contract.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. B được thông báo kết thúc; không giữ phiên cũ sai; cuộc gọi mới không bị kẹt.
- **Bằng chứng cần lưu:** Node WS events + session state/logs; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Error code khi gửi ICE sau END cần đối chiếu Node source.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-CALL-005 — Kết thúc cuộc gọi từ người nhận [P1]

- **Tiền điều kiện (Given):** A/B ở phiên active.
- **Các bước thực hiện (When):**
  1. B gửi CALL_END
  2. A nhận
  3. A/B tiếp tục có socket và có thể thiết lập cuộc gọi mới.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Cả hai phía nhất quán kết thúc theo luồng báo hiệu; không ngắt tất cả socket vô lý.
- **Bằng chứng cần lưu:** Node WS + logs; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-CALL-006 — Callee online signaling nhưng không mở messaging [P1]

- **Tiền điều kiện (Given):** A/B mở signaling, B không mở messaging.
- **Các bước thực hiện (When):**
  1. A gửi OFFER
  2. B nhận offer qua signaling
  3. B gửi ANSWER
  4. A nhận ANSWER.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Có thể hoàn thành signaling nếu contract không bắt buộc messaging hiện diện; không phụ thuộc giả định một socket messaging là điều kiện signaling.
- **Bằng chứng cần lưu:** Node WS + backend logs; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** NEEDS_CONTRACT nếu backend notify bắt buộc messaging và thất bại làm abort offer.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-CALL-007 — Callee offline cả messaging và signaling [P1]

- **Tiền điều kiện (Given):** A online signaling, B offline.
- **Các bước thực hiện (When):**
  1. A gửi OFFER
  2. Quan sát event/error ở A
  3. B mở messaging/signaling sau khi quá cửa sổ chờ
  4. Thử cuộc gọi mới.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Trả trạng thái offline/timeout rõ ràng; không để phiên chờ vĩnh viễn; cuộc gọi mới hoạt động.
- **Bằng chứng cần lưu:** Node WS + logs; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Phải đối chiếu thời hạn và chính sách lưu offer với CALL-002.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-CALL-008 — Timeout chưa trả lời phải dọn phiên chờ [P1]

- **Tiền điều kiện (Given):** A/B signaling online, B không ANSWER/REJECT.
- **Các bước thực hiện (When):**
  1. A gửi OFFER
  2. B nhận
  3. Chờ timeout được cấu hình bằng test config
  4. A/B thử cuộc gọi mới.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Nhận timeout/cleanup theo giao thức; cuộc gọi tiếp theo không bị treo bởi phiên cũ.
- **Bằng chứng cần lưu:** Node WS + signaling logs; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Snapshot báo cáo nêu pending timeout 30s scan mỗi 5s; xác minh phiên bản mới.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-CALL-009 — Cuộc gọi chồng chéo cùng người dùng [P1]

- **Tiền điều kiện (Given):** A đang có phiên chờ/active với B; thêm C.
- **Các bước thực hiện (When):**
  1. A gửi OFFER đến B
  2. Khi đang chờ, A hoặc C gửi OFFER khác vào cùng user
  3. Thu các response
  4. Kết thúc các phiên còn tồn tại.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. User ở phiên `pending` hoặc `active` đều bận; offer thứ hai nhận `ERROR/TARGET_BUSY`, không phát `CALL_INCOMING` cho lời mời bị từ chối.
  2. Phiên và `call_id` thứ nhất không bị ghi đè; sau khi kết thúc, lời mời mới được nhận.
- **Bằng chứng cần lưu:** Node WS + logs; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Kiểm tra cả khi caller bận và callee bận. Với offer gần đồng thời, chỉ một lời mời được nhận.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-CALL-010 — Mất kết nối signaling giữa cuộc gọi [P1]

- **Tiền điều kiện (Given):** A/B đã OFFER/ANSWER, ghi session reference.
- **Các bước thực hiện (When):**
  1. Đóng bất thường socket B (không tắt server)
  2. Quan sát event A
  3. B reconnect
  4. Thử khởi tạo phiên mới.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Kết quả theo chính sách hiện hành: dọn hoặc duy trì có giới hạn, không để A bị kẹt vô hạn; phiên mới phải có trạng thái đúng.
- **Bằng chứng cần lưu:** WS close, logs; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Chi tiết phục hồi có thể đẩy T07; T05 kiểm tra hành trình cơ bản.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-CALL-011 — Token đã logout không thể mở signaling mới [P0]

- **Tiền điều kiện (Given):** A có access+refresh thật; chưa mở signaling với token đó.
- **Các bước thực hiện (When):**
  1. Logout trên Spring HTTP
  2. GET /users/me bằng access cũ trả từ chối
  3. Thử mở signaling với cùng access
  4. Quan sát handshake/close và thử event.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Không được duy trì signaling authenticated bằng token đã thu hồi; không relay sự kiện cuộc gọi tới B.
- **Bằng chứng cần lưu:** HTTP + Node WS + logs; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** E10 là lỗi lịch sử cần chạy lại; contract hiện hành yêu cầu upgrade rồi đóng với code `4001`.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-CALL-012 — Logout khi đang có signaling socket [P1]

- **Tiền điều kiện (Given):** A/B signaling online, có phiên chờ hoặc active; A đang login.
- **Các bước thực hiện (When):**
  1. A logout HTTP
  2. Quan sát socket A trong khoảng revocation SLA
  3. A thử gửi ICE/CALL_OFFER
  4. Kiểm tra B không nhận sự kiện trái quyền.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Sự kiện signaling gửi sau HTTP logout thành công không được relay đến B.
  2. Socket cũ đóng bằng code `4001` trong tối đa 10 giây.
- **Bằng chứng cần lưu:** HTTP + WS + logs; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Kiểm tra quyền relay độc lập với thời hạn đóng socket; đóng signaling không chứng minh media P2P đã dừng.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-CALL-013 — CALL_INCOMING chứa danh tính người gọi và session tương quan [P1]

- **Tiền điều kiện (Given):** A/B mới có token; B messaging, A signaling.
- **Các bước thực hiện (When):**
  1. A gửi OFFER
  2. B nhận CALL_INCOMING qua Spring → Redis → messaging
  3. B mở signaling và nhận OFFER
  4. Đối chiếu caller_id, display_name, call_session_id và `call_id` giữa incoming/offer/answer.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Thông báo có danh tính caller đúng DB; không lộ token/secret; event có thể tương quan tới phiên đúng; B không nhận cuộc gọi nhầm.
- **Bằng chứng cần lưu:** HTTP users + Spring WS + Node WS + SQL users; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** `call_session_id` cố định theo cặp user; `call_id` UUID riêng cho từng lần gọi và bắt buộc trên mọi sự kiện signaling của phiên.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

### 5.9. VID — Vòng đời video: upload nhiều phần → webhook → library → delete (18 case)

**Phạm vi:** E2E đầy đủ giữa HTTP Spring Boot, Redis upload session/lock, PostgreSQL metadata và MinIO upload/download bytes thật.

**Nguồn tham khảo:** `video/VideoController.java; VideoService.java; MinioMultipartStorage.java; VideoWebhookService.java; scripts/e2e/backend.test.cjs E11–E12`.

**Fixture áp dụng:** Bucket riêng và thông báo webhook thực, A/B active; file hai part: part đầu ≥5 MiB, part cuối có thể nhỏ; checksum SHA-256; tránh fixtures production.

#### T05-VID-001 — Tạo phiên → PUT part 1 → cấp URL part 2 → PUT part 2 [P0]

- **Tiền điều kiện (Given):** A chưa vượt quota; fixture bytes gồm 5 MiB + part cuối.
- **Các bước thực hiện (When):**
  1. POST /videos tạo recording và lấy upload_id/URL1
  2. PUT bytes part1 trực tiếp presigned MinIO, lấy ETag1
  3. POST /videos/{id}/chunks với part_number=2, etag_previous=ETag1
  4. PUT part2 lấy ETag2.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Có video metadata recording của A
  2. Redis có phiên đúng upload_id
  3. ETag thực lấy từ MinIO; part 1/2 khớp uploadId và storage path, không đi qua Spring HTTP body.
- **Bằng chứng cần lưu:** HTTP + MinIO listParts + Redis + SQL; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Là tiền đề chuẩn cho VID-002.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-VID-002 — Hai part → finalize → webhook thật → ready → GET byte chính xác [P0]

- **Tiền điều kiện (Given):** Đã hoàn tất hai part hợp lệ theo VID-001, MinIO event notification tới Spring hoạt động.
- **Các bước thực hiện (When):**
  1. POST /videos/{id}/finalize với upload_id, duration_secs, parts/ETags đúng
  2. Poll GET /videos/{id} tới ready trong timeout hợp lý
  3. GET view_url tải object
  4. So SHA-256 với bytes nguồn.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Finalize phản hồi theo contract; webhook thật chuyển trạng thái ready
  2. Kích thước, nội dung byte chính xác
  3. Redis upload session được dọn
  4. DB final state đúng.
- **Bằng chứng cần lưu:** HTTP + SQL + Redis + SHA-256 + webhook/backend logs; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Kế thừa E11. Fixture kiểm tra storage bytes, không chứng minh codec/player.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-VID-003 — Video ready xuất hiện trong thư viện và tổng quota [P0]

- **Tiền điều kiện (Given):** A có một video ready thật, đã biết actual size.
- **Các bước thực hiện (When):**
  1. GET /videos?status=ready hoặc GET /videos theo contract
  2. GET detail
  3. So library item, file_size_bytes, storage_used_bytes với DB và object.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Library và detail cùng nhận một video ID, status ready, dung lượng bằng byte thực
  2. Tổng quota phản ánh các video ready theo chính sách.
- **Bằng chứng cần lưu:** HTTP + SQL videos + MinIO stat; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-VID-004 — Đổi tên video ready → đọc lại ở list/detail [P0]

- **Tiền điều kiện (Given):** A có video ready X.
- **Các bước thực hiện (When):**
  1. PUT /videos/{id} title mới
  2. GET detail
  3. GET library tại trang chứa X
  4. Query title PostgreSQL.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Title cập nhật nhất quán qua các lần đọc và DB
  2. Không đổi object key, byte nội dung hoặc owner.
- **Bằng chứng cần lưu:** HTTP + SQL + MinIO metadata; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Title validation chi tiết thuộc T04.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-VID-005 — Xóa video ready → không truy xuất qua API → quota giảm [P0]

- **Tiền điều kiện (Given):** A có video ready X, biết dung lượng S.
- **Các bước thực hiện (When):**
  1. Ghi used_bytes trước
  2. DELETE /videos/{id}
  3. GET detail/list, đối chiếu DB soft delete và quota sau
  4. Kiểm tra đường cleanup object theo hợp đồng.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Video không còn hiện với A theo contract
  2. Quota used giảm tương ứng S
  3. Tài nguyên object được dọn hoặc lên cleanup job theo thiết kế, không coi chỉ 204 là đủ.
- **Bằng chứng cần lưu:** HTTP + SQL videos/cleanup_jobs + MinIO object probe; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Không đòi object mất ngay nếu thiết kế là async cleanup; chốt SLA trước.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-VID-006 — Hủy phiên upload giữa chừng [P0]

- **Tiền điều kiện (Given):** A có video recording, có URL1/ID; chưa finalize.
- **Các bước thực hiện (When):**
  1. POST /videos/{id}/abort với upload_id đúng
  2. Kiểm tra Redis không còn phiên
  3. Thử PUT qua presigned URL cũ
  4. GET detail/list.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Phiên không thể tiếp tục upload sau abort
  2. Không chuyển ready, không tính quota ready
  3. DB/Redis/MinIO ở trạng thái theo hợp đồng.
- **Bằng chứng cần lưu:** HTTP + Redis + MinIO + SQL; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Kế thừa E12; phân biệt object part cũ và metadata trong DB.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-VID-007 — Upload nhiều part hơn hai → finalize và verify byte [P1]

- **Tiền điều kiện (Given):** A có quota; fixture gồm 3–5 part với part cuối nhỏ.
- **Các bước thực hiện (When):**
  1. Init upload
  2. Lặp PUT part K và xin URL part K+1 với ETag trước đúng
  3. Finalize với toàn bộ ETag
  4. Poll ready
  5. Download và hash.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Thứ tự ETag/part đúng; video ready có dung lượng chuẩn; checksum toàn file đúng; session được dọn.
- **Bằng chứng cần lưu:** HTTP + Redis + MinIO part list + SHA-256; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Tránh chọn một fixture 6 MiB chia thành nhiều part nhỏ hơn giới hạn S3.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-VID-008 — Cấp lại URL part trong cùng phiên không tạo part logic trùng [P1]

- **Tiền điều kiện (Given):** A đã PUT part1, có ETag1 và upload_id.
- **Các bước thực hiện (When):**
  1. Gọi /chunks part_number=2, etag_previous=ETag1
  2. Gọi lại cùng dữ liệu để lấy URL retry
  3. PUT part2 một lần rồi finalize
  4. Kiểm tra object và DB.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Retry không làm tăng part_number logic/ETag record sai
  2. Finalize đúng object byte, không dư part gây mismatch.
- **Bằng chứng cần lưu:** HTTP + Redis upload state + MinIO object; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Theo VideoService có ReserveResult.RETRY.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-VID-009 — Finalize đang xử lý không bị lặp tạo object [P1]

- **Tiền điều kiện (Given):** A có multipart hoàn chỉnh và ETag hợp lệ.
- **Các bước thực hiện (When):**
  1. Gọi finalize lần đầu
  2. Khi processing/ready, gửi finalize lần nữa theo hợp đồng
  3. Poll state và kiểm tra count metadata/object
  4. Download/checksum.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Một phiên upload tạo tối đa một video ready đúng bytes; request lặp bị xử lý an toàn theo state; không nhân quota hoặc object.
- **Bằng chứng cần lưu:** HTTP + SQL + MinIO + Redis; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Tranh chấp finalize đồng thời thuộc T07, ở đây là retry tuần tự.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-VID-010 — Thư viện hỗn hợp trạng thái và lọc theo trạng thái [P1]

- **Tiền điều kiện (Given):** A có video ready và recording; có thể có failed từ fixture hợp lệ.
- **Các bước thực hiện (When):**
  1. GET /videos không filter
  2. GET với filter trạng thái được hỗ trợ
  3. GET detail từng video
  4. Đối chiếu DB.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Filter chỉ trả trạng thái yêu cầu; video của user khác không xuất hiện; quota chỉ tính đúng trạng thái theo chính sách.
- **Bằng chứng cần lưu:** HTTP + SQL + MinIO state; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Không tạo failed bằng cách cố ý phá MinIO trong T05; đưa fault injection T07.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-VID-011 — Pagination thư viện video từ nhiều trang [P1]

- **Tiền điều kiện (Given):** A có nhiều video metadata hợp lệ đủ quá một trang; trạng thái đã kiểm soát.
- **Các bước thực hiện (When):**
  1. GET /videos limit nhỏ
  2. Lần theo cursor các trang
  3. Tập hợp ID
  4. So với tập video A trong DB và sắp xếp.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Không thiếu/trùng ID khi dữ liệu ổn định; filter trạng thái và cursor tương thích
  2. Không lộ video của B.
- **Bằng chứng cần lưu:** HTTP + SQL expected rows; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-VID-012 — Tài khoản A không xem/xóa được video B trong một hành trình [P0]

- **Tiền điều kiện (Given):** A/B active, B có video ready X.
- **Các bước thực hiện (When):**
  1. A thử GET detail X và DELETE X
  2. B GET detail và GET view_url X
  3. Đối chiếu DB/MinIO.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. A không nhận được nội dung riêng và không xóa được X
  2. B vẫn đọc/tải đúng file
  3. DB owner/quota không thay đổi.
- **Bằng chứng cần lưu:** HTTP + SQL + MinIO + SHA-256; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** T06 sẽ mở rộng biến thể IDOR và presigned URL threat model.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-VID-013 — Presigned download link của video ready vẫn tải đúng file [P1]

- **Tiền điều kiện (Given):** A có video ready X.
- **Các bước thực hiện (When):**
  1. GET /videos/{id} lấy view_url
  2. GET URL trước expiry
  3. Tính SHA-256 và Content-Length nếu có
  4. GET detail lần sau kiểm tra trạng thái.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Byte đúng như file gốc, không bị biến đổi bởi metadata operation; URL thuộc object X và giới hạn thời gian đúng theo contract.
- **Bằng chứng cần lưu:** HTTP + SHA-256 + MinIO stat; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Expiry boundary riêng ở T04/T06.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-VID-014 — Tăng quota từ nhiều video ready và giảm sau từng lần xóa [P1]

- **Tiền điều kiện (Given):** A có ít nhất hai video ready dung lượng S1 và S2.
- **Các bước thực hiện (When):**
  1. GET library usedBytes
  2. DELETE video thứ nhất
  3. GET quota
  4. DELETE video thứ hai
  5. GET quota và SQL.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Quota thay đổi đúng theo tổng các video ready còn active, không bị tính trùng hoặc âm
  2. Không sai khi thay đổi thứ tự xóa.
- **Bằng chứng cần lưu:** HTTP + SQL sum + object status; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-VID-015 — Webhook được gửi lặp lại sau khi ready [P1]

- **Tiền điều kiện (Given):** A đã finalize, video đã ready, có bản webhook hợp lệ cùng object key từ môi trường test.
- **Các bước thực hiện (When):**
  1. Chờ webhook thật lần đầu và trạng thái ready
  2. Gửi lại webhook hợp lệ qua đường nội bộ bằng secret test theo đúng contract
  3. GET detail và SQL.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Lần webhook lặp không nhân size/quota, không đổi owner, không tạo thêm video
  2. Response xử lý theo hợp đồng.
- **Bằng chứng cần lưu:** HTTP internal + SQL + MinIO stat; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** API nội bộ có secret phải dùng fixture runner test; không in secret ra logs.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-VID-016 — Một phiên hủy không ảnh hưởng video ready khác của cùng A [P1]

- **Tiền điều kiện (Given):** A có video ready R và recording U.
- **Các bước thực hiện (When):**
  1. Abort U
  2. GET R detail/download
  3. GET U/Redis state
  4. GET library usedBytes.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. R còn nguyên checksum và metadata
  2. Chỉ U bị hủy
  3. Quota vẫn tính đúng R.
- **Bằng chứng cần lưu:** HTTP + Redis + MinIO + SQL; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-VID-017 — Finalize byte sai hoặc ETag sai không làm READY giả [P1]

- **Tiền điều kiện (Given):** A có multipart 2 part, biết ETag thực.
- **Các bước thực hiện (When):**
  1. Gửi finalize với ETag bị thay đổi hoặc thiếu part theo biến thể đã chốt
  2. GET status/Redis state sau lỗi
  3. Thực hiện lại với ETag đúng nếu phiên còn hợp lệ.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Không có video READY với byte chưa xác minh; các bước được từ chối không tạo metadata giả
  2. Cách retry/abort theo contract, không giả định phiên luôn còn hiệu lực.
- **Bằng chứng cần lưu:** HTTP + SQL + Redis + MinIO; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** T04 kiểm tra validation; T05 kiểm tra ảnh hưởng vòng đời dữ liệu.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-VID-018 — Upload session của B không cản A thao tác video A [P1]

- **Tiền điều kiện (Given):** A/B đồng thời có phiên upload riêng.
- **Các bước thực hiện (When):**
  1. Init A và B
  2. PUT part của từng phiên
  3. Finalize A, abort B
  4. GET library/Redis/MinIO của mỗi người.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. A ready đúng, B bị hủy đúng; không trộn upload_id, Redis state, object key hoặc quota giữa 2 user.
- **Bằng chứng cần lưu:** HTTP + SQL + Redis + MinIO; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Gửi đồng thời/tranh khóa trong T07, đây là workflow xen kẽ có kiểm soát.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

### 5.10. DEL — Xóa tài khoản và dọn dữ liệu liên quan (8 case)

**Phạm vi:** Kiểm tra soft-delete, thu hồi phiên, thay đổi khả năng tìm kiếm và ảnh hưởng tới video/messaging/avatars.

**Nguồn tham khảo:** `user/UserAccountService.java; VideoAccountCleanupService.java; AuthService.java; scripts/e2e/backend.test.cjs E13`.

**Fixture áp dụng:** A sở hữu avatar, conversations, video recording/ready và token; B còn active; dữ liệu thuộc môi trường disposable.

#### T05-DEL-001 — Xóa tài khoản trống → token/login/refresh đều ngừng hoạt động [P0]

- **Tiền điều kiện (Given):** A active, có token và mật khẩu; chưa sở hữu video.
- **Các bước thực hiện (When):**
  1. DELETE /users/me mật khẩu đúng
  2. GET /users/me bằng token cũ
  3. Login lại
  4. Refresh bằng token trước xóa
  5. Query users/refresh_tokens.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. deleted_at được ghi
  2. Các cách khôi phục truy cập thông thường bị từ chối
  3. Không xóa nhầm người khác.
- **Bằng chứng cần lưu:** HTTP + SQL + Redis; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Kế thừa E13, mở rộng refresh.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-DEL-002 — Xóa A khi có video recording chưa hoàn tất [P0]

- **Tiền điều kiện (Given):** A có một hoặc nhiều upload recording hợp lệ, B độc lập.
- **Các bước thực hiện (When):**
  1. A init multipart + PUT ít nhất part1
  2. A DELETE account
  3. Poll/đối chiếu Redis session, MinIO multipart, DB trạng thái video/cleanup jobs
  4. B vẫn hoạt động.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Tài khoản A bị thu hồi
  2. Phiên upload dở được hủy hoặc ghi nhận cleanup bền vững theo policy
  3. Không làm hỏng video của B.
- **Bằng chứng cần lưu:** HTTP + SQL + Redis + MinIO; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Có nguy cơ orphan multipart trong static review; không giả định ngay 100% sạch nếu có retry job.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-DEL-003 — Xóa A khi có video ready [P1]

- **Tiền điều kiện (Given):** A có video ready X; B có ready Y.
- **Các bước thực hiện (When):**
  1. A DELETE account
  2. GET library bằng token cũ bị từ chối
  3. Dùng quyền kiểm tra test DB/MinIO để xem X và cleanup state
  4. B GET/download Y.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Dữ liệu A không còn truy cập trái phép; xử lý X theo chính sách retention/deletion đã chốt
  2. Y vẫn nguyên vẹn.
- **Bằng chứng cần lưu:** HTTP + SQL + MinIO + cleanup_jobs; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** NEEDS_CONTRACT: xóa tài khoản có xóa file ready hay chỉ ngừng quyền truy cập?
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-DEL-004 — Xóa B trong khi A còn hội thoại cũ với B [P1]

- **Tiền điều kiện (Given):** A/B đã có hội thoại và tin nhắn hai chiều; kiểm tra trong giai đoạn trước mốc 30 ngày sau khi B xóa tài khoản.
- **Các bước thực hiện (When):**
  1. A GET lịch sử, danh sách và chi tiết hội thoại trước khi B xóa tài khoản.
  2. B DELETE account; thử dùng lại access/refresh token và đăng nhập của B.
  3. A GET lịch sử, danh sách, chi tiết hội thoại và tìm kiếm B.
  4. A thử gửi tin nhắn mới cho B.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. A vẫn đọc được các tin nhắn cũ, hội thoại không bị xóa; ID và nội dung tin nhắn giữ nguyên.
  2. Tên và avatar B được ẩn trong danh sách/chi tiết hội thoại; tìm kiếm B không trả profile.
  3. Token và đăng nhập B bị từ chối; A không tạo được tin nhắn mới cho B; số bản ghi tin nhắn không tăng.
- **Bằng chứng cần lưu:** HTTP + SQL users/conversations/messages; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Chỉ nghiệm thu hành vi trước 30 ngày. Việc dọn/ẩn danh dữ liệu sau 30 ngày chưa được triển khai và chưa nghiệm thu theo quyết định của người dùng.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-DEL-005 — Xóa B khi có avatar public và người khác đang xem [P1]

- **Tiền điều kiện (Given):** B có avatar, A đã GET public profile.
- **Các bước thực hiện (When):**
  1. B DELETE account
  2. A GET /avatars/{B}
  3. A search email B
  4. B thử login/refresh.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Avatar công khai không bị lộ trái chính sách; B không login; users.deleted_at đúng.
- **Bằng chứng cần lưu:** HTTP + SQL users/avatar_profiles; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Không bắt buộc xóa vật lý avatar nếu soft-delete.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-DEL-006 — Xóa account sai mật khẩu không thay đổi trạng thái các dịch vụ [P1]

- **Tiền điều kiện (Given):** A có avatar, hội thoại, video recording và token; cung cấp password sai.
- **Các bước thực hiện (When):**
  1. A DELETE /users/me với password sai
  2. GET /users/me, avatar, conversation, video session
  3. Kiểm tra DB/Redis/MinIO.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Tài khoản vẫn active
  2. Không thu hồi token/refresh, không abort upload hoặc cleanup video
  3. Dữ liệu nghiệp vụ không bị ảnh hưởng.
- **Bằng chứng cần lưu:** HTTP + SQL + Redis + MinIO; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-DEL-007 — Xóa user không thu hồi/tác động token user khác [P1]

- **Tiền điều kiện (Given):** A/B active, đều login; A có các liên kết với B.
- **Các bước thực hiện (When):**
  1. A DELETE account
  2. B GET /users/me, GET conversations, mở WS mới
  3. Kiểm tra Redis/DB revocation B.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Token và WS B vẫn hoạt động; chỉ A bị thu hồi
  2. Không ghi đè trạng thái B.
- **Bằng chứng cần lưu:** HTTP + WS + Redis + SQL; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-DEL-008 — Xóa tài khoản đã có kết nối realtime [P1]

- **Tiền điều kiện (Given):** A/B messaging WS đang mở, A logout/xóa account theo kịch bản chọn một.
- **Các bước thực hiện (When):**
  1. Ghi trạng thái WS A trước
  2. A DELETE account
  3. A thử thao tác HTTP và WS tiếp theo
  4. B vẫn gửi/nhận các cuộc trò chuyện hợp lệ khác.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. A không duy trì quyền trái chính sách; B độc lập
  2. Session đóng hoặc bị loại theo thời gian thu hồi đã định.
- **Bằng chứng cần lưu:** WS + HTTP + Redis + SQL; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** NEEDS_CONTRACT cho SLA thu hồi WS đang mở; có thể kết hợp với WS-011 và CALL-012.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

### 5.11. MET — Telemetry như một bước phụ trong hành trình người dùng (4 case)

**Phạm vi:** Kiểm tra API metrics hoạt động trong phiên, không làm đổi dữ liệu nghiệp vụ và không ảnh hưởng endpoint khác.

**Nguồn tham khảo:** `metrics/MetricsController.java; MetricsService.java; MetricsRateLimiter.java; scripts/e2e/backend.test.cjs E14`.

**Fixture áp dụng:** A active với token, tạo dữ liệu telemetry hợp lệ theo DTO, timestamp ISO hiện tại.

#### T05-MET-001 — Đăng nhập → gửi telemetry → tiếp tục sử dụng backend [P1]

- **Tiền điều kiện (Given):** A vừa login.
- **Các bước thực hiện (When):**
  1. A gửi POST /metrics/client session_type được hỗ trợ
  2. A GET /users/me và GET /conversations
  3. Kiểm tra response metrics và log.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Telemetry được tiếp nhận theo contract
  2. Không đổi dữ liệu nghiệp vụ/token A
  3. Các API chính vẫn hoạt động.
- **Bằng chứng cần lưu:** HTTP + backend log + SQL basic; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-MET-002 — Rate limit telemetry không giới hạn API nghiệp vụ [P1]

- **Tiền điều kiện (Given):** A login, một khoảng rate-limit đang sạch.
- **Các bước thực hiện (When):**
  1. A gửi telemetry hợp lệ
  2. Gửi lần nữa trong 3 giây
  3. Gọi GET conversations và avatar models
  4. Chờ hết cửa sổ, gửi telemetry lại.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Request thứ hai được xử lý theo rate-limit policy
  2. API khác không bị khóa
  3. Telemetry hoạt động trở lại sau cửa sổ.
- **Bằng chứng cần lưu:** HTTP + Redis counter/TTL + logs; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-MET-003 — Hai user gửi telemetry độc lập [P1]

- **Tiền điều kiện (Given):** A/B active và mỗi người gửi dữ liệu hợp lệ.
- **Các bước thực hiện (When):**
  1. A gửi telemetry
  2. B gửi telemetry ngay sau đó
  3. A thử lại trong cửa sổ
  4. B đọc profile.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Giới hạn theo user và đúng thứ tự
  2. Không làm lẫn định danh người dùng trong log và không ghi sai DB.
- **Bằng chứng cần lưu:** HTTP + Redis keys + backend logs; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-MET-004 — Telemetry input sai không phá phiên tiếp theo [P2]

- **Tiền điều kiện (Given):** A có token.
- **Các bước thực hiện (When):**
  1. Gửi session_type không hợp lệ
  2. Gửi telemetry hợp lệ sau khoảng phù hợp
  3. GET profile.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Sai input bị từ chối đúng contract
  2. Không làm hỏng state của phiên hoặc request hợp lệ kế tiếp.
- **Bằng chứng cần lưu:** HTTP + backend logs; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** E14 đã có biến thể cơ bản.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

### 5.12. CROSS — Những hành trình xuyên suốt nhiều module (8 case)

**Phạm vi:** Chứng minh các chức năng phối hợp thành quy trình thực tế; không chỉ là tổng nhiều API PASS riêng lẻ.

**Nguồn tham khảo:** `Ghép các Controller Java, scripts/e2e/backend.test.cjs, đặc biệt đường auth→messaging→signaling/video.`.

**Fixture áp dụng:** Ít nhất ba user A/B/C; catalog hợp lệ; đủ quota; DB/Redis/MinIO cô lập; không yêu cầu frontend/WebRTC thật.

#### T05-CROSS-001 — Onboarding đầy đủ rồi nhắn tin lần đầu [P0]

- **Tiền điều kiện (Given):** A/B hoàn toàn mới.
- **Các bước thực hiện (When):**
  1. A/B register/login
  2. Mỗi bên chọn avatar
  3. A tìm B (discoverable=true)
  4. A tạo conversation
  5. A gửi X
  6. B WS nhận X
  7. B GET history và cập nhật read
  8. A WS nhận status.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Các tài khoản, avatar, conversation, message và status tương quan đúng ID
  2. DB ghi bền đúng
  3. Không có sự kiện chéo.
- **Bằng chứng cần lưu:** HTTP + 2 WS + SQL users/avatars/conversations/messages + Redis; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-CROSS-002 — Hành trình nhắn tin ở nhiều thiết bị và reconnect [P0]

- **Tiền điều kiện (Given):** A/B login, B có hai messaging WS.
- **Các bước thực hiện (When):**
  1. A tạo/sử dụng hội thoại
  2. Gửi X, cả B1/B2 nhận
  3. Đóng B1
  4. A gửi Y, B2 nhận
  5. Mở B3, đọc history X/Y
  6. B đánh dấu read.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Mỗi tab online nhận đúng sự kiện, lịch sử bền, trạng thái cập nhật; không trùng tin và không mất quyền.
- **Bằng chứng cần lưu:** HTTP + 3 WS + SQL; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-CROSS-003 — Gửi tin → bấm gọi → từ chối/kết thúc → quay lại nhắn tin [P0]

- **Tiền điều kiện (Given):** A/B có conversation và messaging WS, signaling theo flow thực tế.
- **Các bước thực hiện (When):**
  1. A gửi X, B nhận
  2. A tạo cuộc gọi đến B
  3. B nhận CALL_INCOMING và kết nối signaling theo hợp đồng
  4. B reject hoặc answer/end
  5. A gửi Y và B nhận.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Đường gọi và chat không làm kẹt nhau; message X/Y tồn tại và đúng user
  2. Phân phối signaling chính xác.
- **Bằng chứng cần lưu:** HTTP + Spring WS + Node WS + DB; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Phụ thuộc xử lý E09; nếu chưa fix đánh BLOCKED cho nhánh callee join late.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-CROSS-004 — Người dùng quay video, hoàn tất, đổi tên, tải và xóa [P0]

- **Tiền điều kiện (Given):** A hoàn thành onboarding; bucket/webhook thật sẵn.
- **Các bước thực hiện (When):**
  1. POST create video
  2. PUT multipart đủ part
  3. finalize → await ready
  4. PUT rename
  5. GET library
  6. GET view_url và xác minh SHA-256
  7. DELETE video
  8. GET quota.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Tất cả trạng thái thống nhất trên HTTP/DB/Redis/MinIO; không để bản ghi ready ảo
  2. Quota cập nhật đúng sau xóa.
- **Bằng chứng cần lưu:** HTTP + Redis + SQL + MinIO SHA-256; ghi ID/trace correlation và run-id.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-CROSS-005 — Dùng tổng hợp nhiều tính năng rồi logout [P0]

- **Tiền điều kiện (Given):** A/B có tài khoản, avatar, conversation, message, video ready của A.
- **Các bước thực hiện (When):**
  1. A đọc profile, messages, videos và avatar
  2. A logout
  3. Dùng access token A gọi lại các private API và mở WS mới
  4. B truy cập phần riêng của B.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. A bị từ chối theo chính sách sau logout; dữ liệu đã commit vẫn tồn tại theo policy; B hoạt động bình thường.
- **Bằng chứng cần lưu:** HTTP + messaging WS + Node WS (nếu scope) + SQL + Redis; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Signaling từ token logout phụ thuộc E10.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-CROSS-006 — Đổi hồ sơ hiển thị đồng thời ở hội thoại/call incoming [P1]

- **Tiền điều kiện (Given):** A/B đã có conversation; A đổi tên, B messaging WS.
- **Các bước thực hiện (When):**
  1. A PUT display_name mới
  2. B GET conversation detail
  3. A gửi CALL_OFFER tới B
  4. B nhận CALL_INCOMING
  5. Đối chiếu caller_display_name.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Tên hiển thị mới được phản ánh đúng ở hai luồng theo chính sách, không dùng stale identity/nhầm user.
- **Bằng chứng cần lưu:** HTTP + Spring WS + Node WS + SQL users; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Nếu frontend cache là khác backend, không kết luận về UI.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-CROSS-007 — Bị giới hạn search/metrics nhưng chat/video vẫn hoạt động [P1]

- **Tiền điều kiện (Given):** A/B active có conversation, A có đủ quota.
- **Các bước thực hiện (When):**
  1. A vượt rate limit search và metrics ở các cửa sổ tương ứng
  2. A gửi tin mới
  3. A GET conversations, videos
  4. B nhận tin.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Rate-limit chuyên biệt không vô tình khóa các API khác hoặc làm sai dữ liệu
  2. HTTP/WS chat vẫn đúng.
- **Bằng chứng cần lưu:** HTTP + Redis + WS + SQL; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Chạy độc lập nếu cần tránh thời gian chờ rate limiter ảnh hưởng toàn suite.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

#### T05-CROSS-008 — Xóa một tài khoản không phá trải nghiệm tài khoản còn lại [P1]

- **Tiền điều kiện (Given):** A/B active, mỗi người có video/WS, có hội thoại chung.
- **Các bước thực hiện (When):**
  1. Tạo dữ liệu dùng riêng và dùng chung
  2. A DELETE account
  3. B GET profile, xem video B, đọc dữ liệu chat theo chính sách
  4. B gửi tin đến C và nhận event.
- **Kết quả mong đợi (Then) — phải xác minh toàn bộ:**
  1. Không có xóa dây chuyền tài nguyên B; A không tái đăng nhập; nghiệp vụ của B với user khác vẫn hoạt động.
- **Bằng chứng cần lưu:** HTTP + WS + SQL + Redis + MinIO; ghi ID/trace correlation và run-id.
- **Lưu ý đặc biệt:** Vấn đề retention chat với A đã xóa cần chốt ở DEL-004.
- **Trạng thái khi lập kế hoạch:** `NOT_RUN` (không thừa kế PASS từ suite cũ).

## 6. Ánh xạ 14 E2E hiện tại → T05

| Suite cũ | Kết quả đã báo cáo 19/10 | Case T05 tương ứng hoặc mở rộng | Ghi chú |
|---|---|---|---|
| E01 | PASS | ACC-001/002/003/004/005/010; ENV-006 | Giữ test auth, bổ sung kiểm tra DB và vòng đời phiên |
| E02 | PASS | USR-001/002/005 | Profile/settings giữ qua request mới |
| E03 | PASS | AVA-001/002 | Catalog, save, own/public avatar |
| E04 | PASS | MSG-001/003; WS-001 | HTTP→Redis→WS hai tab + DB |
| E05 | PASS | MSG-004/005 | Cùng ID được chống trùng, mở rộng absence duplicate WS |
| E06 | PASS | MSG-008/010; WS-003/004 | Typing, status, outsider, bất biến DB |
| E07 | PASS | MSG-012; WS-006/009 | Offline history và nhận message mới sau reconnect |
| E08 | PASS | CALL-001/013 | Signaling payload relay, không chứng minh WebRTC media |
| E09 | **FAIL** | **CALL-002; CROSS-003** | Người nhận mở signaling sau CALL_INCOMING bị mất offer; giữ tiêu chí mong muốn |
| E10 | **FAIL** | **CALL-011/012; CROSS-005** | Token logout vẫn được signaling chấp nhận; giữ tiêu chí từ chối |
| E11 | PASS | VID-001/002/003/005/013; CROSS-004 | Multipart, webhook, checksum, quota/delete |
| E12 | PASS | VID-006/016 | Abort thật, invalidates upload |
| E13 | PASS | DEL-001; ACC-010 | Soft-delete và token/login bị từ chối, bổ sung refresh/upload |
| E14 | PASS | MET-001/004 | Telemetry, input invalid |

**Không biến E09/E10 thành PASS bằng cách hạ tiêu chí.** Nếu có sửa giao thức/hợp đồng vì thay đổi thiết kế được thông qua, ghi rõ requirement mới, lý do, backward compatibility và cập nhật test một cách có kiểm soát.

## 7. Ranh giới trùng với T04, T06, T07, T08

| Nội dung | Đặt chính ở đâu? | Cách dùng trong T05 |
|---|---|---|
| Kiểm tra một JSON field null/sai kiểu/giới hạn; mã HTTP của riêng endpoint | **T04** | T05 dùng payload đã được T04 xác nhận, kiểm tra tác động sang những bước sau |
| Kiểm thử chuyên sâu JWT giả chữ ký, BOLA/IDOR, CSRF/CORS, lộ secrets, fuzzing, privilege escalation | **T06** | T05 chỉ giữ các nhánh quyền trọng yếu nằm ngay trong user journey |
| Gián đoạn Redis/MinIO/DB, restart giữa commit, race cùng lúc, leak lâu dài | **T07** | T05 chủ yếu chạy tuyến đường ổn định; chỉ có retry/negative workflow ít phá hoại |
| Latency, p95/p99, số kết nối tối đa, load/stress/spike/soak, băng thông | **T08** | Không lấy tổng thời gian suite E2E làm benchmark |
| WebRTC P2P/TURN, codec/camera, frontend UI | **System E2E/browser** | Có thể xây dựng riêng sau T05 backend |

## 8. Cách thực hiện từng đợt để không quá tải khi tự viết test

| Đợt | Nhóm | Thứ tự ưu tiên | Điều kiện chuyển đợt |
|---|---|---|---|
| 0 — Nền test | ENV | ENV-001/002/004/005 rồi còn lại | Runner thật, dữ liệu cô lập, dọn đúng, artifact đủ |
| 1 — Hành trình tài khoản | ACC, USR, AVA | P0 trước, rồi P1 | Người dùng mới đi từ register→login→settings→avatar đúng |
| 2 — Chat bền vững và realtime | CON, MSG, WS | P0; retry/status/pagination sau | Đối chiếu được DB ↔ HTTP ↔ WS, không còn P0 lỗi |
| 3 — Cuộc gọi | CALL | CALL-001/002/011 trước | **E09/E10 được xử lý**, không có hành trình cuộc gọi cốt lõi BLOCKED |
| 4 — Video | VID | VID-001/002/003/005/006, các case khác | Byte-accurate, webhook thật, Redis/DB/quota và cleanup đúng |
| 5 — Xóa tài khoản, telemetry, liên thông | DEL, MET, CROSS | DEL-001/002; CROSS-001/003/004/005 trước | Các hành trình đầy đủ PASS và được lưu kết quả |

**Trước khi viết code cho từng case:** (a) đọc lại controller/service/DTO ở commit đang test; (b) đối chiếu API spec hiện hành; (c) chốt expected code/status/event và policy bị ghi NEEDS_CONTRACT; (d) thiết lập fixture độc lập; (e) kiểm tra PASS/FAIL cả side effect, không chỉ response.

## 9. Mẫu nhật ký và bảng nghiệm thu nên đi kèm kết quả chạy

| Run ID | Commit | Case ID | Trạng thái | Thời điểm | Evidence | Bug/Decision | Người thực hiện |
|---|---|---|---|---|---|---|---|
| `<run-id>` | `<git-sha>` | `T05-MSG-001` | `NOT_RUN` | — | — | — | — |

**Trạng thái cho phép:** `NOT_RUN`, `PASS`, `FAIL_PRODUCT`, `FAIL_TEST`, `FAIL_ENV`, `BLOCKED`, `NEEDS_CONTRACT`, `SKIPPED_WITH_REASON`. Khi sửa bug phải rerun case tái hiện và suite regression liên quan; không xóa test FAIL để đạt 100%.

### Bằng chứng tối thiểu nên có theo loại hành trình

- **HTTP:** method/path, status, request/response đã che secret, user ID, trace/correlation ID.
- **PostgreSQL:** các row/COUNT/unique constraint/status/timestamp cần kiểm chứng; khi cần có snapshot trước/sau.
- **Redis:** hiện diện/hết hạn key, trạng thái session/lock, sự kiện Pub/Sub theo user; không chụp secret.
- **Messaging WebSocket:** session ID, thời điểm connect/close, event type, data ID, recipient, thời gian chờ hữu hạn.
- **Node signaling:** from/target, offer-answer-ICE-end, timeout/close/error; không ghi SDP chứa dữ liệu nhạy cảm trong môi trường dùng thật.
- **MinIO:** object key (đã giảm thông tin nhạy cảm nếu cần), multipart upload ID đã che nếu report chia sẻ, ETag, file size, SHA-256, sự kiện webhook, cleanup job.
- **Môi trường:** SHA commit, run-id, image versions, service startup/readiness, exit code, `results.xml`, `run.json`, các log tương ứng.

## 10. Các điểm phải xác nhận thêm trước khi chốt toàn bộ expected results

1. **Node signaling và contract cuộc gọi mới nhất:** source Node chưa có trong ZIP Java; phải đối chiếu chờ offer, timeout, busy-state, chính sách token logout và session cleanup. E09/E10 hiện biết là FAIL theo báo cáo đã chạy.
2. **Chính sách khi xóa tài khoản:** retention chat/video ready, cleanup media, revoke WS đã mở, tình trạng tìm kiếm/hiển thị tài khoản đã xóa. Chỗ chưa chốt giữ `NEEDS_CONTRACT` (không coi ngầm là defect).
3. **Cấu hình runtime:** ports/context-path, WS ping/expiry, quota, presigned URL TTL, bucket notification, rate-limit window, database Flyway index; bổ sung thông tin để fixture và thời gian chờ hợp lý.
4. **API spec mới nhất:** mã lỗi chính xác ở một số nhánh chưa có `docs/04_API.md` trong gói Java; dùng kết quả thực và spec đã được đồng ý để chốt, không tự đoán.
5. **Điều kiện cleanup:** video deletion và orphan multipart có thể cần background retry; test cần phân biệt trạng thái cuối ngay và trạng thái sau timeout/job chạy xong, dựa trên thiết kế công bố.
6. **Khả năng test song song:** mỗi case nên dùng account/conversation/video riêng. Các case sửa shared rate-limiter hoặc cùng user/session phải cô lập, hoặc chạy tuần tự theo dữ liệu có kiểm soát.

## 11. Định nghĩa thành công của giai đoạn T05

Một phiên bản T05 có thể được nghiệm thu khi danh sách case **được chốt theo đúng hợp đồng hiện hành**, P0 được chạy đầy đủ và PASS, P1 quan trọng được kiểm chứng hoặc có lý do hoãn rõ ràng, không còn lỗi sản phẩm nghiêm trọng chưa xử lý, và có thể tái chạy từ môi trường sạch mà không đụng dữ liệu dev. Trường hợp chưa xác định trong T05/T06/T07 phải được liệt kê như **giới hạn bằng chứng**, không được im lặng suy ra backend đã đủ an toàn hoặc sẵn sàng production.

Sau khi hoàn thành T05, ta chuyển sang T06 (Security Testing) và T07 (Reliability & Concurrency), rồi mới đưa các hành trình đã được xác minh lên T08 k6. T05 giúp xác nhận *đúng chức năng*; nó không thay thế *đảm bảo an toàn* hoặc *khả năng chịu tải*.
