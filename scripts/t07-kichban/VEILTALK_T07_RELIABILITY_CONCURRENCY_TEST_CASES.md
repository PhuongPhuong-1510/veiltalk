# VEILTALK — T07: RELIABILITY, CONCURRENCY & FAILURE RECOVERY TESTING
## MASTER TEST CASE SPECIFICATION — KỊCH BẢN, KHÔNG PHẢI MÃ NGUỒN

> **Phạm vi yêu cầu:** Chỉ đặc tả kịch bản kiểm thử để chủ dự án tự triển khai. **Không chứa mã test, không thay đổi sản phẩm, không tạo/kích hoạt hạ tầng fault injection và chưa có kết quả chạy.**
>
> **Phiên bản:** 1.0 — 19/10/2026. **Trạng thái của toàn bộ T07:** `PROPOSED / NOT_RUN`, ngoại trừ liên kết với kết quả E2E lịch sử được ghi riêng. **Tất cả hiện chưa thể coi PASS.**

---
## 1. Mục tiêu, cách hiểu và ranh giới

### 1.1. T07 giải quyết điều gì?

**Reliability** là khả năng hệ thống duy trì hành vi đúng hoặc thất bại có kiểm soát khi gặp lỗi. **Concurrency** là nhiều thao tác diễn ra chồng lấn thời gian và có thể cạnh tranh cùng dữ liệu/tài nguyên. **Recovery** là đưa dịch vụ/trạng thái về điều kiện vận hành được sau lỗi. **Idempotency** là khi thực hiện lại cùng yêu cầu theo cùng phạm vi, trạng thái/side effect vẫn được kiểm soát theo hợp đồng. **Fault injection** là tạo ra lỗi một cách có chủ đích trong môi trường test để kiểm tra phản ứng của hệ thống.

Bài T07 không chỉ hỏi “API có trả 200?” mà hỏi: Khi *hai request cùng sửa một đối tượng*, kết quả cuối có tương thích không? Khi *transaction đã commit nhưng sự kiện Redis bị mất*, nguồn dữ liệu có đúng không? Khi *MinIO complete xong nhưng webhook đến chậm*, trạng thái có phục hồi không? Khi *backend chết giữa thao tác*, tài nguyên và giao dịch có còn nguyên vẹn không?

### 1.2. Phân biệt T04, T05, T06, T07, T08

| Nhóm | Câu hỏi chính | Ví dụ |
|---|---|---|
| T04 — API Contract | Một request/response có đúng đặc tả không? | `POST /messages` nhận UUID mới và trả 201 |
| T05 — End-to-End | Một hành trình hợp lệ xuyên các dịch vụ có hoàn chỉnh không? | A gửi tin, B nhận event và đọc history |
| T06 — Security | Người không có quyền có can thiệp/truy cập không? | Token đã logout không dùng được trên signaling |
| **T07 — Reliability & Concurrency** | Khi request đua nhau hoặc dịch vụ hỏng, hệ thống còn đúng/phục hồi được không? | Hai finalize cùng upload; MinIO rớt sau complete |
| T08 — Performance | Hệ thống phục vụ nhanh/tối đa bao nhiêu trong tải đo được? | 5→50 VU, RPS/p95/p99, khả năng phục vụ |

Một test có thể nằm ở giao điểm nhiều nhóm; hãy tái sử dụng helper, fixture và trace. **Không** bắn hàng nghìn request chỉ để gọi đó là T07; T07 ưu tiên *kiểm soát thứ tự và lỗi ở điểm chính xác*. Các bài stress/soak/throughput thuộc T08.

### 1.3. Nguồn thực tế, điểm đã biết và giới hạn

- **Đã đọc trực tiếp:** snapshot 137 Java files từ `veiltalk.zip` ở các package `auth`, `user`, `avatar`, `messaging`, `video`, `call`, `metrics`; đây không nhất thiết là commit hiện hành tháng 10. Các tên class/file và cơ chế trong case lấy từ snapshot này; line number có thể đổi ở bản hiện tại.
- **Bộ E2E đã có:** `backend.test.cjs`, người dùng báo cáo lần chạy 19/10/2026 **E01–E08, E11–E14 PASS; E09 và E10 FAIL**; đây là kết quả lịch sử chứ không phải lần chạy T07 mới.
- **Node.js signaling:** báo cáo Codex mô tả trạng thái kết nối và cuộc gọi lưu trong `Map` theo process, CALL_OFFER phụ thuộc người nhận online, pending timeout khoảng 30 giây. **Chưa đọc source `signaling/src` phiên bản mới**, nên các policy về collision/glare/reconnect, thứ tự sự kiện và retry phải đối chiếu lại trước khi khóa expected.
- **Chưa có source runtime đầy đủ:** `application.yml`, `pom.xml`, migrations/index, Compose, Nginx, MinIO event config, `scripts/e2e/run.cjs`, `docs/04_API.md`. Không tự điền timeout/pool size/backoff/quota chính xác từ trí nhớ. Trạng thái kỳ vọng có phụ thuộc hợp đồng được gắn `NEEDS_CONTRACT` nếu chưa được quyết định.
- **Không kết luận gì về WebRTC audio/video thật:** Signaling JSON test không chứng minh truyền media, NAT/TURN/codec. Phần đó cần suite tích hợp trình duyệt riêng.

### 1.4. Những điểm trong Java snapshot cần được thử vì có đường thực thi cụ thể

| Nơi trong source | Điều kiểm chứng được | T07 cần quan sát |
|---|---|---|
| `messaging/MessageService.java:65–105` và `MessageRepository.java:20–35` | `INSERT ... ON CONFLICT DO NOTHING`, kiểm tra phạm vi idempotency | POST trùng UUID, khác user/conversation, retry khi response bị mất |
| `MessageService.java:146–232` | Status có row lock; `afterCommit` mới publish | Concurrent read/delivered, rollback, lỗi publish sau commit |
| `ConversationService.java:46–108` | Chuẩn hóa pair, create-or-get, cursor | Tạo cặp đồng thời, các trang thay đổi trong khi đang đọc |
| `MessagingRedisSubscriber.java:61–126` | Nhận Pub/Sub rồi chuyển đến socket local | Bị mất kết nối subscriber, fanout, socket chậm/lỗi |
| `WebSocketKeepAliveScheduler.java:68–160` | Per-session heartbeat và kiểm tra thu hồi | Session leak, scheduler starvation, Redis timeout |
| `VideoService.java:52–106` | MinIO multipart trước DB/Redis session; code comment thừa nhận abort không xảy ra tại lỗi Redis | Multipart mồ côi, rollback sai biên, dọn bù |
| `VideoService.java:164–216,313–390` | Quota/video locks quanh finalize, abort/delete | Finalize tranh nhau và thay đổi state, quota overcommit |
| `RedisDistributedLock.java:46–103` | SETNX với TTL, renew định kỳ, release qua Lua so token | Lease expiry, renewal failure, owner cũ release trễ |
| `RedisVideoUploadSessionStore.java` | Script Lua cập nhật ETag/next_part nguyên tử | Chunk-next cạnh tranh và thứ tự part |
| `VideoTimeoutCleanupJob.java`, `VideoCleanupRetryJob.java` | Background cleanup/retry | Restart giữa job, retry/backoff, poison job |
| `UserAccountService.java:42–60` | Account delete transaction gọi cleanup video | Transaction/MinIO/Redis lỗi trong account delete |

**Lưu ý quan trọng:** “có đường code đáng thử” khác với “đã đo được lỗi”. Không tự đánh dấu FAIL vì rủi ro dự đoán; phải có trace/dữ liệu cuối và policy xác nhận.

---
## 2. Chuẩn an toàn và mô hình thực thi

### 2.1. Môi trường tối thiểu

1. Chạy trên **môi trường cô lập**, dùng đúng PostgreSQL/Redis/MinIO test, port test, MinIO bucket test, `run_id` và nhãn container. Không sử dụng dữ liệu thật; không chạy fault injection trên production/staging dùng chung.
2. Mỗi lần test ghi commit Java/Node, migration version, image digest, JVM flags, thời gian/chế độ clock, pool config **sau khi mask secret**, expected thresholds có nguồn. Runner phải có teardown kể cả khi FAIL; nếu runner bị kill cứng phải có quy trình dọn theo nhãn.
3. Có khả năng chặn hoặc làm chậm **đúng** một thao tác: ví dụ sau INSERT trước commit, sau commit trước publish, khi MinIO trả CompleteMultipart, khi Redis renew lock, khi WebSocket send. Có thể cần **test-only hooks**, proxy/network fault simulator hoặc wrapper test ở môi trường riêng; không mặc định source hiện có đã có chúng.
4. Bất kỳ fault nào có thể làm mất dữ liệu phải chỉ chạy trong bucket/container riêng. Đặt thời gian tối đa cho việc ngắt dịch vụ, giới hạn requests, watchdog tự phục hồi và lệnh kiểm tra tác động. Không dùng `docker system prune`, không xóa volume không thuộc `run_id`.
5. Các thao tác tranh chấp nên dùng **barrier** (điểm đồng bộ cho các worker cùng xuất phát), không dùng `sleep(100)` và kỳ vọng nó luôn tạo race. Mỗi case cần chạy cả ít nhất một lần tuần tự làm đối chứng và nhiều lần race có seed.

### 2.2. Fixture chuẩn

| Ký hiệu | Chuẩn bị |
|---|---|
| A, B | Hai người dùng active, mật khẩu và token riêng, có conversation A–B; B có thể giữ 2–3 WS |
| C, D | Người dùng độc lập, không có quyền ở conversation A–B; dùng khi kiểm tra cô lập cạnh tranh |
| M-X | Một message ID UUID cụ thể, đúng sender/conversation và timestamp hợp lệ; biết tình trạng row ban đầu |
| M-list | ≥110 messages, đa dạng timestamp và UUID; test cursor cần dữ liệu ổn định trừ khi chủ ý thêm tin |
| V-rec | Video RECORDING, uploadId, part và ETag thật trên MinIO test |
| V-proc, V-ready | Video PROCESSING và READY, có object/storage path/size/quota xác định |
| J-cleanup | Cleanup job đủ điều kiện chạy (hoặc sẽ đủ hạn bằng controlled clock) |
| Redis key namespace | Chỉ keys của test run; TTL và trạng thái revocation được quan sát an toàn |
| Call-1 | Hai signaling sockets và trạng thái pending/active (theo protocol đã kiểm tra) |
| Time control | Đồng hồ có thể giả lập hoặc điều chỉnh cấu hình TTL trên test, **không** sửa giờ hệ điều hành dùng chung |

### 2.3. Oracle: những bất biến phải giữ

| Mã bất biến | Điều không được bị vi phạm |
|---|---|
| I-01 | Một `message.id` không trở thành nhiều message rows khác scope; retry cùng ID không âm thầm tạo thêm tin |
| I-02 | Không publish `NEW_MESSAGE` hoặc status update cho transaction đã rollback |
| I-03 | Message/status đã commit trong DB không được “mất” chỉ vì Redis Pub/Sub mất event; GET history còn là nguồn dữ liệu |
| I-04 | Trạng thái tin nhắn không downgrade `read → delivered`; một lần cập nhật không sửa tin của người gửi ngoài quyền |
| I-05 | Một pair active A–B không có nhiều conversation trùng do race nếu uniqueness contract là create-or-get |
| I-06 | Một video không có hai terminal outcomes mâu thuẫn như READY và ABORTED/DELETED đồng thời |
| I-07 | Tổng dung lượng các video READY không vượt quota nếu đó là quy tắc nghiệp vụ được cam kết |
| I-08 | Một Redis lock có lease owner hợp lệ không bị chủ cũ release/renew nhầm; mọi thao tác stale phải có chính sách chống ghi sai |
| I-09 | Việc fail/retry/cleanup không tự làm mất object hợp lệ của người khác hoặc tạo tài nguyên mồ côi vô thời hạn |
| I-10 | Phiên bị thu hồi/xóa không tiếp tục thực hiện thao tác mới trái policy; signal/WS không mạo danh do race |
| I-11 | Restart không làm dữ liệu đã commit biến mất và không khôi phục state in-memory sai hợp đồng |
| I-12 | Một lỗi socket/subscriber/job không làm hỏng toàn bộ những kết nối/công việc độc lập |

**Các mô hình đảm bảo cần phân biệt:** (a) exactly-once side-effect ở tầng DB thông qua idempotency là khả thi trong phạm vi xác định; (b) Redis Pub/Sub không phải durable queue, **không được hứa phát event exactly-once hoặc replay sau outage**; (c) PostgreSQL + Redis + MinIO không có transaction phân tán mặc định, nên phải kiểm chứng cơ chế *bù trừ/reconciliation/cleanup*, không kỳ vọng rollback nguyên tử xuyên cả ba dịch vụ.

### 2.4. Mức ưu tiên và trạng thái báo cáo

| Mức | Ý nghĩa |
|---|---|
| **P0** | Có thể mất dữ liệu, sai tài khoản/phiên, vi phạm quota, dữ liệu nửa vời, call path trọng yếu hoặc lỗi được biết đến; chặn nghiệm thu chức năng liên quan |
| **P1** | Race/recovery quan trọng có thể gây hỏng trạng thái hoặc suy giảm trải nghiệm; cần xử lý trước vận hành thật nếu thuộc phạm vi sản phẩm |
| **P2** | Mở rộng hoặc tình huống hiếm/phụ thuộc cấu hình, không mặc định chặn báo cáo một instance |

Trạng thái: `NOT_RUN` (chưa chạy), `PASS` (đã có đầy đủ oracle + evidence), `FAIL_PRODUCT` (chứng minh sai hợp đồng), `FAIL_TEST` (fixture/hook/assertion không hợp lệ), `FAIL_ENV` (lab lỗi không đại diện), `BLOCKED` (chưa thực hiện được), `NEEDS_CONTRACT` (chưa chốt behavior), `NEEDS_SOURCE` (cần đối chiếu source mới nhất), `KNOWN_GAP` (thiếu khả năng được chấp nhận/đang chờ quyết định). Nếu bất kỳ điều kiện quan trọng nào chưa có bằng chứng, **không** ghi PASS.

### 2.5. Cách tránh các kết luận sai trong kiểm thử race

- Phân biệt **thứ tự khởi tạo request**, **thứ tự server nhận**, **thứ tự DB commit**, **thứ tự response về client**, **thứ tự event WS đến**. Chúng không mặc nhiên giống nhau.
- `Promise.all()` chỉ làm yêu cầu được khởi tạo gần nhau, **không đảm bảo** chúng gặp đúng critical section. Dùng barrier/fault gate để chủ động chặn tại điểm quan tâm; log xác nhận cửa sổ race đã xảy ra.
- Một lần PASS không đủ chứng minh không có race. Với case quan trọng hãy chạy N vòng có kiểm soát (ví dụ 10–30), lưu seed và thứ tự interleaving; tăng số vòng nếu có dao động, nhưng không coi đây là load benchmark.
- Một khoảng 1–3 giây không thấy WS event chỉ chứng minh *không thấy trong cửa sổ đó*. Nếu hợp đồng không có delivery deadline, phải đối chiếu DB, log và recovery path trước khi kết luận.
- Trường hợp CompleteMultipart/DB commit có kết quả không rõ do client timeout: **không được tự động retry với giả định lần đầu thất bại**. Trước hết quan sát trạng thái cuối từ hệ thống đích.
- Không được đồng nhất “Redis trả ACK publish” với “B đã nhận và xử lý WebSocket event”. Phải có oracle cả hai chiều.

---
## 3. Tổng quan bộ test case T07

| Nhóm | Trọng tâm | P0 | P1 | P2 | Tổng |
|---|---|---:|---:|---:|---:|
| ENV | An toàn môi trường và tính tái lập | 4 | 5 | 1 | 10 |
| AUTH | Đồng thời xác thực, phiên và thu hồi token | 5 | 6 | 1 | 12 |
| CONV | Cạnh tranh tạo hội thoại và phân trang | 2 | 5 | 2 | 9 |
| MSG | Gửi tin, idempotency và trạng thái dưới race | 8 | 7 | 1 | 16 |
| TX | Transaction, commit và tính nguyên tử | 4 | 7 | 1 | 12 |
| PUB | Redis Pub/Sub, phát lại và nhất quán eventual | 3 | 6 | 3 | 12 |
| WS | Vòng đời WebSocket, heartbeat và slow consumer | 4 | 8 | 4 | 16 |
| CALL | Signaling, trạng thái cuộc gọi và mất kết nối | 5 | 8 | 1 | 14 |
| VID | Multipart video, webhook và trạng thái lưu trữ | 11 | 9 | 2 | 22 |
| LOCK | Distributed lock, lease, contention và retry | 4 | 7 | 1 | 12 |
| FAIL | Mất phụ thuộc: PostgreSQL, Redis, MinIO và mạng | 6 | 6 | 1 | 13 |
| REC | Khởi động lại, cleanup, retry và phục hồi | 5 | 6 | 1 | 12 |
| MULTI | Mở rộng nhiều instance — nghiên cứu tùy chọn | 0 | 5 | 3 | 8 |
| OBS | Bằng chứng, tính lặp lại và ngưỡng vào T08 | 3 | 6 | 1 | 10 |
| **Tổng** | **14 nhóm** | **64** | **91** | **23** | **178** |

**Quy tắc đếm:** Mỗi ID là một *kịch bản thiết kế*, có thể gồm 2–4 interleavings và nhiều assertions. Không nên dùng tổng số kịch bản làm % coverage; cần ánh xạ yêu cầu→rủi ro→case→kết quả.

## 4. Các kịch bản chi tiết

### 4.1. ENV — An toàn môi trường và tính tái lập

**Mục tiêu:** Bảo đảm fault injection chỉ chạm môi trường riêng, quan sát đúng thời điểm và luôn phục hồi được.
**Cơ sở thiết kế:** `scripts/e2e/run.cjs` (chưa có source để đối chiếu); mô tả runner E2E 19/10; Docker Compose chưa được kiểm chứng tại runtime.
**Fixture nền:** Container PostgreSQL/Redis/MinIO riêng; test bucket; A/B/C; run_id; commit SHA và cấu hình đã che secret.

#### T07-ENV-001 — Chỉ thao tác lên container của run hiện tại [P0]

- **Tiền điều kiện / dữ liệu mồi:** Tạo một run riêng có nhãn định danh; trên máy có container không thuộc suite.
- **Cách tạo cạnh tranh hoặc sự cố:** Liệt kê target trước fault; cố ý request một thao tác fault hợp lệ nhắm nhãn run_id rồi kiểm tra container khác.
- **Điều kiện PASS — oracle:** Không tác động bất kỳ container/volume/bucket ngoài run_id; có allowlist target; báo FAIL_TEST/ENV nếu không cô lập.
- **Bằng chứng phải thu:** Docker inspect labels, trước/sau danh sách container, run.json.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-ENV-002 — Dọn dịch vụ sau PASS [P0]

- **Tiền điều kiện / dữ liệu mồi:** Khởi động suite bằng runner riêng, lưu tên dịch vụ test.
- **Cách tạo cạnh tranh hoặc sự cố:** Chạy case nhỏ thành công; đợi runner kết thúc có kiểm soát; kiểm tra tiến trình Java/Node và container.
- **Điều kiện PASS — oracle:** Không còn tiến trình/container test thuộc run_id; dữ liệu ngoài test không đổi.
- **Bằng chứng phải thu:** Exit code, docker ps, process list, container label audit.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-ENV-003 — Dọn sau FAIL assertion [P0]

- **Tiền điều kiện / dữ liệu mồi:** Tạo case test cố ý FAIL do assertion giả trong môi trường thử.
- **Cách tạo cạnh tranh hoặc sự cố:** Chạy runner; nhận exit code nonzero; sau đó liệt kê container và port.
- **Điều kiện PASS — oracle:** Fail test không chặn teardown; log/artifact vẫn đủ; không xóa nhầm service khác.
- **Bằng chứng phải thu:** JUnit fail, cleanup log, docker inspect.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-ENV-004 — Trường hợp runner bị kill cứng [P0]

- **Tiền điều kiện / dữ liệu mồi:** Có test host dành riêng, biết nhãn các container test.
- **Cách tạo cạnh tranh hoặc sự cố:** Mô phỏng kết thúc runner đột ngột trong môi trường lab; chạy công cụ liệt kê orphan theo nhãn; dọn có xác nhận.
- **Điều kiện PASS — oracle:** Cung cấp quy trình recovery thủ công chính xác run_id, không dùng docker system prune.
- **Bằng chứng phải thu:** Container labels/run_id; log trước/sau cleanup.
- **Phục hồi / dọn dữ liệu:** Chỉ kill runner trên máy test; không kill Docker Engine.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-ENV-005 — Khôi phục snapshot sau tiêm lỗi [P1]

- **Tiền điều kiện / dữ liệu mồi:** Có DB/Redis/bucket test có dữ liệu mồi cố định.
- **Cách tạo cạnh tranh hoặc sự cố:** Chạy thao tác được phép thay đổi trạng thái; reset; đọc lại số bản ghi, Redis keys và object MinIO.
- **Điều kiện PASS — oracle:** Mỗi lần chạy mới có baseline tương đương hoặc fixture mới độc lập hoàn toàn.
- **Bằng chứng phải thu:** Fingerprint fixture, SQL counts, Redis scan scoped, object listings.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-ENV-006 — Không nhầm lỗi hạ tầng với lỗi sản phẩm [P1]

- **Tiền điều kiện / dữ liệu mồi:** Một lần cố ý tắt Docker/service trước khi suite readiness xong.
- **Cách tạo cạnh tranh hoặc sự cố:** Khởi động runner; kiểm tra thời điểm runner dừng, trạng thái phân loại và nội dung log.
- **Điều kiện PASS — oracle:** FAIL_ENV rõ ràng; không tự gán FAIL_PRODUCT cho nghiệp vụ chưa chạy.
- **Bằng chứng phải thu:** Readiness log, runner stage, results.json.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-ENV-007 — Đồng bộ bằng tín hiệu thay sleep cứng [P1]

- **Tiền điều kiện / dữ liệu mồi:** Một luồng gửi HTTP → DB → Redis → WS có thể quan sát.
- **Cách tạo cạnh tranh hoặc sự cố:** Thiết kế test chờ sự kiện hoặc polling một trạng thái có deadline, lặp dưới máy chậm.
- **Điều kiện PASS — oracle:** Không phụ thuộc thời điểm sleep ngẫu nhiên; timeout có nguyên nhân và thông tin đủ debug.
- **Bằng chứng phải thu:** Trace timestamp, correlation_id, await log.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-ENV-008 — Kiểm soát trễ và timeout test [P1]

- **Tiền điều kiện / dữ liệu mồi:** Có một endpoint/side effect có thể làm chậm an toàn trong lab.
- **Cách tạo cạnh tranh hoặc sự cố:** Kiểm tra timeout client, timeout runner và cửa sổ quan sát âm tính ở các mức khác nhau.
- **Điều kiện PASS — oracle:** Timeout của test không ngắn hơn cửa sổ hành vi hợp đồng; phân biệt timeout client với lỗi dịch vụ.
- **Bằng chứng phải thu:** Timeline từng bước, cấu hình timeout, failure reason.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-ENV-009 — Mỗi test chạy độc lập và ngẫu nhiên thứ tự [P1]

- **Tiền điều kiện / dữ liệu mồi:** Có fixture factory cho A/B, hội thoại, upload.
- **Cách tạo cạnh tranh hoặc sự cố:** Chạy riêng case, rồi chạy nhiều case với thứ tự hoán đổi; kiểm tra kết quả.
- **Điều kiện PASS — oracle:** Không case nào giả định dữ liệu từ case khác, hoặc dùng ID hardcode ngẫu nhiên.
- **Bằng chứng phải thu:** Results theo permutation, đối chiếu fixture IDs.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-ENV-010 — Ghi nhận phiên bản và môi trường tái lập [P2]

- **Tiền điều kiện / dữ liệu mồi:** Một runner chạy trên Java/Node/Docker thực tế.
- **Cách tạo cạnh tranh hoặc sự cố:** Chạy suite hai lần, lưu commit, Java/Node versions, image digests, limits, cấu hình đã mask.
- **Điều kiện PASS — oracle:** Mỗi run có provenance đủ so sánh; không lưu secrets, presigned URLs.
- **Bằng chứng phải thu:** run manifest, redacted env, image digests.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

### 4.2. AUTH — Đồng thời xác thực, phiên và thu hồi token

**Mục tiêu:** Tìm race condition trong cấp/thu hồi token và bảo đảm các kênh thống nhất ở thời điểm nghiệp vụ.
**Cơ sở thiết kế:** `auth/AuthService.java`, `JwtAuthenticationFilter.java`, `JwtBlacklistService.java`, `UserTokenRevocationService.java`; Node signaling cần kiểm tra source mới.
**Fixture nền:** Một tài khoản A có nhiều cặp access/refresh token; phiên HTTP, WS messaging và signaling riêng.

#### T07-AUTH-001 — Logout đồng thời nhiều HTTP request đang xử lý [P0]

- **Tiền điều kiện / dữ liệu mồi:** A có access/refresh token; endpoint GET và POST dùng tài khoản test.
- **Cách tạo cạnh tranh hoặc sự cố:** Đặt barrier cho các request cùng lúc với logout; chia request bắt đầu trước/sau mốc revoke được ghi nhận.
- **Điều kiện PASS — oracle:** Request bắt đầu sau revoke không được xác thực; request đã vào trước có chính sách rõ, không tự quy FAIL; không phát hành token sau revoke ngoài contract.
- **Bằng chứng phải thu:** HTTP traces, DB refresh state, Redis revoke state, event timeline.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-AUTH-002 — Logout và mở messaging WebSocket cùng thời điểm [P0]

- **Tiền điều kiện / dữ liệu mồi:** A có token, chưa mở WS; tạo barrier gửi logout và WS handshake.
- **Cách tạo cạnh tranh hoặc sự cố:** Cho handshake nằm trước/sau mốc thu hồi bằng cách lặp có điều khiển.
- **Điều kiện PASS — oracle:** Kết nối mới sau revoke không được sử dụng quyền; nếu mở trong race phải bị kiểm tra/đóng theo chính sách, không gửi data được bảo vệ ngoài thời hạn.
- **Bằng chứng phải thu:** WS handshake/close, Redis keys, timeline.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-AUTH-003 — Logout và mở signaling WebSocket cùng thời điểm [P0]

- **Tiền điều kiện / dữ liệu mồi:** E10 lịch sử FAIL; A có signaling token hợp lệ trước logout.
- **Cách tạo cạnh tranh hoặc sự cố:** Đồng bộ logout thành công với các handshake signaling đến ngay sau đó; thử thêm kết nối đang mở.
- **Điều kiện PASS — oracle:** Không chấp nhận phiên mới bằng token đã thu hồi; đường đóng hoặc Upgrade reject theo hợp đồng; không làm lộ cuộc gọi.
- **Bằng chứng phải thu:** HTTP 401, signaling handshake, close code, backend/Node logs.
- **Phục hồi / dọn dữ liệu:** Case chặn nghiệm thu nếu E10 chưa sửa.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-AUTH-004 — Hai refresh đồng thời trên cùng một refresh token [P0]

- **Tiền điều kiện / dữ liệu mồi:** A có refresh token hợp lệ và chính sách rotation phải được xác minh.
- **Cách tạo cạnh tranh hoặc sự cố:** Gửi hai POST /auth/refresh đồng thời bằng cùng token; đọc DB và cả hai response.
- **Điều kiện PASS — oracle:** Đạt theo policy đã chốt (refresh reusable hay rotating); không cấp quyền vượt lifetime/quyền, không gây hỏng DB; nếu chưa chốt gán NEEDS_CONTRACT.
- **Bằng chứng phải thu:** Refresh rows, token metadata an toàn, response status.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-AUTH-005 — Logout đồng thời refresh [P0]

- **Tiền điều kiện / dữ liệu mồi:** Có access và refresh cùng phiên.
- **Cách tạo cạnh tranh hoặc sự cố:** Đặt barrier cho logout và refresh; lặp với thứ tự kết thúc khác nhau.
- **Điều kiện PASS — oracle:** Không còn token được chấp nhận sau khi phiên đã được thu hồi đầy đủ theo contract; xác minh cả access mới có thể phát hành trong race.
- **Bằng chứng phải thu:** Response/time order, DB revocation fields, API auth result.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-AUTH-006 — Nhiều login đồng thời cùng tài khoản [P1]

- **Tiền điều kiện / dữ liệu mồi:** A có tài khoản active, DB trống refresh fixture ban đầu.
- **Cách tạo cạnh tranh hoặc sự cố:** Gửi N login cùng lúc với mật khẩu hợp lệ ở N=2,5,10 (không benchmark).
- **Điều kiện PASS — oracle:** Không lỗi race bất thường; mỗi token phù hợp hợp đồng; không trùng DB key/refresh token.
- **Bằng chứng phải thu:** DB refresh row counts, token IDs hashed, HTTP statuses.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-AUTH-007 — Đăng ký cùng email đồng thời [P1]

- **Tiền điều kiện / dữ liệu mồi:** Email chưa tồn tại; hai client độc lập.
- **Cách tạo cạnh tranh hoặc sự cố:** Dùng barrier gửi nhiều register cùng một email; thử biến thể hoa/thường sau khi chốt normalization.
- **Điều kiện PASS — oracle:** Một tài khoản duy nhất; số request thành công và conflict theo hợp đồng; không tạo token cho bản ghi không tồn tại.
- **Bằng chứng phải thu:** SQL unique count, response statuses, audit trace.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-AUTH-008 — Thu hồi toàn bộ token khi xóa tài khoản cùng lúc dùng API [P1]

- **Tiền điều kiện / dữ liệu mồi:** A có avatar, conversations và các token sống.
- **Cách tạo cạnh tranh hoặc sự cố:** Đồng thời DELETE /users/me với GET/POST được bảo vệ; sau khi delete commit gọi tiếp HTTP.
- **Điều kiện PASS — oracle:** Không còn request mới sau commit được hành động dưới danh tính A; dữ liệu đã commit của request đua được giải thích bằng thứ tự thực tế.
- **Bằng chứng phải thu:** DB deleted_at, Redis revoke, response chronology.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-AUTH-009 — Redis thu hồi token bị gián đoạn khi logout [P1]

- **Tiền điều kiện / dữ liệu mồi:** Redis lab có thể bị chặn có kiểm soát; A có token hợp lệ.
- **Cách tạo cạnh tranh hoặc sự cố:** Tiêm lỗi Redis đúng khi logout kiểm tra/ghi revoke; khôi phục Redis; thử dùng lại token ở HTTP và WS.
- **Điều kiện PASS — oracle:** Không khẳng định logout an toàn nếu revoke chưa ghi bền; HTTP response phải phản ánh outcome, không vô tình báo success và cho dùng lại token.
- **Bằng chứng phải thu:** Redis snapshot, HTTP logout, auth afterward, logs.
- **Phục hồi / dọn dữ liệu:** Chốt failure policy và phân biệt tình huống lỗi trước/sau khi write Redis.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-AUTH-010 — Race token hết hạn và WS heartbeat [P1]

- **Tiền điều kiện / dữ liệu mồi:** JWT test có thời hạn ngắn hoặc đồng hồ điều khiển; WS mở gần expiry.
- **Cách tạo cạnh tranh hoặc sự cố:** Cho expiry trùng lúc heartbeat PING/PONG rồi gửi sự kiện sau expiry.
- **Điều kiện PASS — oracle:** Phiên bị đóng/không tiếp tục nhận data protected quá hạn cho phép; không sai close reason giữa expired/revoked.
- **Bằng chứng phải thu:** Clock trace, WS PING/close, Redis checks.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-AUTH-011 — Tài khoản xóa trong khi refresh và handshake [P1]

- **Tiền điều kiện / dữ liệu mồi:** A có token/refresh; tạo xóa tài khoản đồng thời refresh và WS handshake.
- **Cách tạo cạnh tranh hoặc sự cố:** Lặp 3 thứ tự interleave; sau deleted_at xác minh mọi phiên mới.
- **Điều kiện PASS — oracle:** Không có quyền sống lại từ refresh hoặc handshake sau deleted_at; request lỗi không tạo dữ liệu khác.
- **Bằng chứng phải thu:** DB users+refresh, Redis, HTTP and WS response.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-AUTH-012 — Thử cùng lúc nhiều phiên login/logout độc lập [P2]

- **Tiền điều kiện / dữ liệu mồi:** A/B/C có tài khoản khác nhau.
- **Cách tạo cạnh tranh hoặc sự cố:** Logout A và refresh B, login C đồng thời.
- **Điều kiện PASS — oracle:** Không nhầm thu hồi phiên giữa người dùng; B/C tiếp tục hoạt động; A bị từ chối theo mốc revoke.
- **Bằng chứng phải thu:** Identity assertions, DB refresh ownership, Redis user prefixes.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

### 4.3. CONV — Cạnh tranh tạo hội thoại và phân trang

**Mục tiêu:** Xác minh duy nhất hóa cặp người dùng, không tạo bản ghi trùng và hiểu giới hạn nhất quán của cursor khi dữ liệu đổi.
**Cơ sở thiết kế:** `messaging/ConversationService.java:46–108`, `ConversationRepository.java`, `ConversationCursorCodec.java`.
**Fixture nền:** A/B tạo hội thoại cùng lúc; tập hội thoại > 2 trang; kết quả SQL độc lập.

#### T07-CONV-001 — A và B cùng tạo hội thoại A–B [P0]

- **Tiền điều kiện / dữ liệu mồi:** A/B chưa có hội thoại chung.
- **Cách tạo cạnh tranh hoặc sự cố:** Hai request POST /conversations đồng thời, với chiều A→B và B→A.
- **Điều kiện PASS — oracle:** Một cặp active duy nhất trong DB; cả hai response tham chiếu cùng conversation ID; status created/existing đúng.
- **Bằng chứng phải thu:** SQL canonical pair count, both response bodies.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-CONV-002 — Nhiều request tạo cùng cặp hội thoại [P0]

- **Tiền điều kiện / dữ liệu mồi:** A/B chưa có hội thoại, có thể tạo 10 tác nhân.
- **Cách tạo cạnh tranh hoặc sự cố:** Đặt barrier cho 10 requests từ A hoặc cả hai; thu đủ response.
- **Điều kiện PASS — oracle:** Không có duplicate active pair, không lộ lỗi unique violation 500 không được xử lý; tất cả response trỏ cùng bản ghi.
- **Bằng chứng phải thu:** DB count, status histogram, log SQL exceptions.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-CONV-003 — Tạo hội thoại khi B bị xóa [P1]

- **Tiền điều kiện / dữ liệu mồi:** B đang active, có thể thực hiện delete.
- **Cách tạo cạnh tranh hoặc sự cố:** Cho A tạo conversation và B xóa gần nhau, ghi mốc commit của cả hai.
- **Điều kiện PASS — oracle:** Trạng thái cuối tuân hợp đồng soft-delete; không lộ cuộc trò chuyện tới user đã xóa; không có DB orphan sai ràng buộc.
- **Bằng chứng phải thu:** User deleted_at, conversation rows, GET responses.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-CONV-004 — Cập nhật updated_at bởi tin nhắn đồng thời [P1]

- **Tiền điều kiện / dữ liệu mồi:** A/B có conversation; hai message UUID khác nhau.
- **Cách tạo cạnh tranh hoặc sự cố:** Gửi hai tin đồng thời; lấy updated_at trước và sau, kiểm tra last-message.
- **Điều kiện PASS — oracle:** Conversation không quay về timestamp cũ; last-message hợp lý theo ordering đã chốt; không mất bản ghi.
- **Bằng chứng phải thu:** SQL timestamps, message list, GET conversations.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-CONV-005 — Cursor khi danh sách hội thoại đang thay đổi [P1]

- **Tiền điều kiện / dữ liệu mồi:** A có >2 trang hội thoại; có cửa sổ test không đồng bộ.
- **Cách tạo cạnh tranh hoặc sự cố:** Lấy trang 1, sau đó gửi tin làm một hội thoại thay đổi updated_at, tiếp tục cursor.
- **Điều kiện PASS — oracle:** Ghi rõ consistency contract; không gây vòng lặp vô hạn/duplicate không kiểm soát; mọi cursor hợp lệ và không lộ dữ liệu ngoài user.
- **Bằng chứng phải thu:** Page IDs, cursor chain, DB sort keys.
- **Phục hồi / dọn dữ liệu:** Nếu hợp đồng không đảm bảo snapshot cố định, không đặt yêu cầu exactly-once qua mọi page.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-CONV-006 — Cursor ở biên timestamp bằng nhau [P1]

- **Tiền điều kiện / dữ liệu mồi:** Seed nhiều hội thoại cùng updated_at trong DB fixture test.
- **Cách tạo cạnh tranh hoặc sự cố:** Phân trang với limit nhỏ, iterate hết tập bất biến.
- **Điều kiện PASS — oracle:** Tổng ID bằng tập ban đầu, không trùng/thiếu khi dùng tuple timestamp+UUID.
- **Bằng chứng phải thu:** Seed list ordered, pages/cursors.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-CONV-007 — Xóa tài khoản khi đang đọc danh sách [P1]

- **Tiền điều kiện / dữ liệu mồi:** A có nhiều hội thoại, B xóa tài khoản.
- **Cách tạo cạnh tranh hoặc sự cố:** Trong lúc A GET pages, xóa B; xem dữ liệu before/after.
- **Điều kiện PASS — oracle:** Không có 500 do tham chiếu user; nội dung hiển thị/chính sách đối tượng đã xóa được xử lý đúng.
- **Bằng chứng phải thu:** HTTP response, users deleted_at, conversation snapshot.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-CONV-008 — Tạo cặp hội thoại độc lập đồng thời [P2]

- **Tiền điều kiện / dữ liệu mồi:** A/B và C/D là hai cặp riêng.
- **Cách tạo cạnh tranh hoặc sự cố:** Tạo hai hội thoại cùng thời điểm; không tạo contention nhân tạo trên cùng cặp.
- **Điều kiện PASS — oracle:** Hai bản ghi riêng, không nhầm user; kết quả một cặp không thay đổi kết quả cặp còn lại.
- **Bằng chứng phải thu:** SQL pair IDs, API results.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-CONV-009 — Đọc chi tiết trong khi tạo hội thoại [P2]

- **Tiền điều kiện / dữ liệu mồi:** A/B tạo mới; phía B GET trước/sau commit.
- **Cách tạo cạnh tranh hoặc sự cố:** Đồng bộ read trong lúc create chưa hoàn thành, rồi đọc lại sau commit.
- **Điều kiện PASS — oracle:** Không thấy partial record chưa commit; sau commit đọc đúng và đủ.
- **Bằng chứng phải thu:** Transaction timing, GET result, DB commit markers.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

### 4.4. MSG — Gửi tin, idempotency và trạng thái dưới race

**Mục tiêu:** Kiểm chứng các bất biến một message ID, giới hạn phạm vi idempotency, thứ tự trạng thái và ghi nhận sau lỗi.
**Cơ sở thiết kế:** `messaging/MessageService.java:65–105,146–232`, `MessageRepository.java:20–35`; E05 đã PASS lịch sử 4 request.
**Fixture nền:** A/B có hội thoại; C ngoài hội thoại; bộ UUID mới; lịch sử nhiều tin; WS theo người dùng.

#### T07-MSG-001 — Bốn request giống nhau cùng UUID — regression E05 [P0]

- **Tiền điều kiện / dữ liệu mồi:** A/B có hội thoại và một request hợp lệ UUID/timestamp cố định.
- **Cách tạo cạnh tranh hoặc sự cố:** Gửi đồng thời 4 POST cùng body.
- **Điều kiện PASS — oracle:** Một INSERT thật; theo hợp đồng E05: 1×201, 3×200; lịch sử một tin; chỉ một NEW_MESSAGE cho B nếu phiên online.
- **Bằng chứng phải thu:** Responses, DB count, WS correlated ID.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-MSG-002 — Nhiều UUID khác nhau cùng lúc [P0]

- **Tiền điều kiện / dữ liệu mồi:** A/B có conversation, B WS online.
- **Cách tạo cạnh tranh hoặc sự cố:** Gửi 10 tin với UUID riêng, cùng lúc; chờ đủ response và WS events.
- **Điều kiện PASS — oracle:** DB lưu đủ 10 bản ghi, không mất/đè; eventual delivery theo điều kiện Redis khỏe; không khẳng định thứ tự WebSocket trùng thứ tự gọi HTTP.
- **Bằng chứng phải thu:** IDs set compare DB/WS/GET history.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-MSG-003 — Cùng UUID nhưng người gửi khác [P0]

- **Tiền điều kiện / dữ liệu mồi:** A/B có conversation, UUID do A dùng trước.
- **Cách tạo cạnh tranh hoặc sự cố:** Sau A tạo thành công, B POST cùng UUID; thử đồng thời A và B tranh cùng UUID.
- **Điều kiện PASS — oracle:** Không thể dùng idempotency của A để đọc hoặc tái sử dụng tin của B; đúng một owner và conflict cho scope khác.
- **Bằng chứng phải thu:** SQL sender_id, response codes, WS event IDs.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-MSG-004 — Cùng UUID nhưng hội thoại khác [P0]

- **Tiền điều kiện / dữ liệu mồi:** A có conversation với B và C; UUID cố định.
- **Cách tạo cạnh tranh hoặc sự cố:** Dùng cùng ID gửi tới hai conversations (song song và nối tiếp).
- **Điều kiện PASS — oracle:** Một record thuộc duy nhất một conversation; nhánh còn lại conflict, không có cross-conversation leak.
- **Bằng chứng phải thu:** DB ID/conversation_id, responses.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-MSG-005 — Retry sau mất response HTTP nhưng DB đã commit [P0]

- **Tiền điều kiện / dữ liệu mồi:** A/B conversation; proxy lab có thể cắt response server→client sau commit.
- **Cách tạo cạnh tranh hoặc sự cố:** POST UUID X; làm mất response trên đường về sau commit; client retry đúng X.
- **Điều kiện PASS — oracle:** Chỉ một tin trong DB; response retry cho biết bản ghi hiện có; không phát NEW_MESSAGE lần 2 từ đường retry.
- **Bằng chứng phải thu:** DB message count, WS events, request trace.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-MSG-006 — Retry sau transaction rollback [P0]

- **Tiền điều kiện / dữ liệu mồi:** Có fixture rollback tại DB cho INSERT hoặc touch updated_at.
- **Cách tạo cạnh tranh hoặc sự cố:** POST UUID X thất bại trước commit; phục hồi DB; POST lại cùng X.
- **Điều kiện PASS — oracle:** Lần thứ nhất không lưu tin/không publish; lần sau tạo đúng một tin và một thông báo khi kênh khỏe.
- **Bằng chứng phải thu:** DB rows, WS, fault gate/time ordering.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-MSG-007 — Timestamp hợp lệ khi nhiều thread gửi cùng lúc [P1]

- **Tiền điều kiện / dữ liệu mồi:** N tin với timestamp gần server clock, UUID riêng.
- **Cách tạo cạnh tranh hoặc sự cố:** Gửi N POST trong vài milliseconds, một số timestamp bằng nhau.
- **Điều kiện PASS — oracle:** Tất cả timestamp đúng contract được chấp nhận; cursor order theo tuple timestamp+UUID không bỏ/nhân bản tin.
- **Bằng chứng phải thu:** Messages DB sorted, paged GET.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-MSG-008 — Biên timestamp ±5 phút khi request bị chờ [P1]

- **Tiền điều kiện / dữ liệu mồi:** Sử dụng clock test điều khiển nếu có; timestamp gần biên.
- **Cách tạo cạnh tranh hoặc sự cố:** Tạo request ở biên rồi cho chờ trước validate, kiểm tra hai phía ngưỡng.
- **Điều kiện PASS — oracle:** Áp dụng quy tắc tại thời điểm xác nhận của server đúng code/hợp đồng; không gọi lỗi race nếu đơn thuần vượt clock skew.
- **Bằng chứng phải thu:** Controlled clock, response, saved time.
- **Phục hồi / dọn dữ liệu:** Không đưa sleep thật nhiều phút vào suite CI.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-MSG-009 — Update read và delivered đồng thời [P0]

- **Tiền điều kiện / dữ liệu mồi:** Tin ở trạng thái ban đầu; B là recipient.
- **Cách tạo cạnh tranh hoặc sự cố:** Hai worker B gửi `read` và `delivered` gần như đồng thời.
- **Điều kiện PASS — oracle:** Trạng thái cuối không lùi từ read về delivered; hàng row lock đúng; không có phantom duplicate event sai nghiệp vụ.
- **Bằng chứng phải thu:** SQL status final, response order, WS status events.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-MSG-010 — Update read nhiều lần đồng thời [P0]

- **Tiền điều kiện / dữ liệu mồi:** Tin ở delivered; B gửi 5 request read giống nhau.
- **Cách tạo cạnh tranh hoặc sự cố:** Đồng bộ requests, quan sát DB và WS sender A/B.
- **Điều kiện PASS — oracle:** Trạng thái cuối read; không phát sự kiện thay đổi trạng thái lặp cho request no-op; không 500 do lock.
- **Bằng chứng phải thu:** SQL row status, event count, responses.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-MSG-011 — Sender thử cập nhật trạng thái cạnh recipient [P1]

- **Tiền điều kiện / dữ liệu mồi:** A sender, B recipient; A/B cùng PUT status.
- **Cách tạo cạnh tranh hoặc sự cố:** Gửi request sender và recipient cùng lúc.
- **Điều kiện PASS — oracle:** A vẫn bị từ chối; B vẫn chuyển trạng thái hợp lệ; không làm sai DB do thứ tự request.
- **Bằng chứng phải thu:** Responses, message row, status event.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-MSG-012 — Cập nhật trạng thái đồng thời với xóa tài khoản [P1]

- **Tiền điều kiện / dữ liệu mồi:** Tin A→B, B đang cập nhật trạng thái trong lúc xóa B.
- **Cách tạo cạnh tranh hoặc sự cố:** Cho B PUT và DELETE /users/me đồng thời; đọc DB/sự kiện sau commit.
- **Điều kiện PASS — oracle:** Không có ghi thay đổi do tài khoản đã bị vô hiệu sau mốc delete; tình huống đã vào trước xác nhận bằng commit ordering.
- **Bằng chứng phải thu:** User status, message status, server logs.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-MSG-013 — Phân trang lịch sử khi tin mới đến [P1]

- **Tiền điều kiện / dữ liệu mồi:** A/B có 110+ tin, cursor nhiều trang.
- **Cách tạo cạnh tranh hoặc sự cố:** B lấy trang 1, A gửi tin mới, B tiếp tục cursor của trang cũ.
- **Điều kiện PASS — oracle:** Cursor không lỗi/loop; kết quả theo consistency contract, không kết luận thiếu dữ liệu nếu snapshot không được bảo đảm.
- **Bằng chứng phải thu:** Ordered IDs, cursor position, new message commit time.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-MSG-014 — Phân trang tin với timestamp trùng [P1]

- **Tiền điều kiện / dữ liệu mồi:** Có nhiều messages timestamp giống nhau nhưng UUID khác nhau, fixture hợp lệ.
- **Cách tạo cạnh tranh hoặc sự cố:** Paginate nhỏ toàn bộ tập không có writes.
- **Điều kiện PASS — oracle:** Không lặp hoặc bỏ bản ghi, thứ tự tuple ổn định.
- **Bằng chứng phải thu:** Seed IDs, pages, computed sorted reference.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-MSG-015 — Nhiều cuộc trò chuyện gửi đồng thời [P1]

- **Tiền điều kiện / dữ liệu mồi:** A–B, A–C, D–E có conversations độc lập.
- **Cách tạo cạnh tranh hoặc sự cố:** Gửi tin qua cả 3 hội thoại cùng lúc; subscriber đang lắng nghe.
- **Điều kiện PASS — oracle:** Không nhầm receiver/room; mọi row/event gắn đúng conversation; không bị một hội thoại làm thay đổi hội thoại khác.
- **Bằng chứng phải thu:** DB IDs, recipient WS inboxes, negative event windows.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-MSG-016 — Client hủy request khi server vẫn đang xử lý [P2]

- **Tiền điều kiện / dữ liệu mồi:** Có request gửi tin dài có thể cắt kết nối client.
- **Cách tạo cạnh tranh hoặc sự cố:** Client abort sau gửi body, trước khi nhận response; sau đó GET history và retry cùng UUID.
- **Điều kiện PASS — oracle:** Kết quả rõ: hoặc rollback, hoặc đã commit; retry bảo toàn idempotency; không trạng thái nửa vời.
- **Bằng chứng phải thu:** Commit marker, count, retry outcome.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

### 4.5. TX — Transaction, commit và tính nguyên tử

**Mục tiêu:** Đảm bảo không có dữ liệu nửa vời và các side effect không đi trước commit, đồng thời chỉ ra những nơi không có distributed transaction.
**Cơ sở thiết kế:** `MessageService.java:65,146,212–232`, `VideoService.java:52–106`, `UserAccountService.java:42–60`.
**Fixture nền:** DB baseline/snapshot, test hooks tại điểm kiểm soát (nếu cần), tài nguyên MinIO/Redis độc lập.

#### T07-TX-001 — Không phát NEW_MESSAGE trước DB commit [P0]

- **Tiền điều kiện / dữ liệu mồi:** A/B conversation; có test hook giữ transaction trước commit.
- **Cách tạo cạnh tranh hoặc sự cố:** Tạm dừng transaction sau insert/touch; quan sát B WS trước khi release; sau đó cho commit.
- **Điều kiện PASS — oracle:** Trước commit không có NEW_MESSAGE; sau commit tối đa một event cho tin mới khi Redis khỏe.
- **Bằng chứng phải thu:** SQL visibility separate connection, event timeline, hook timestamps.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-TX-002 — Rollback INSERT không phát event [P0]

- **Tiền điều kiện / dữ liệu mồi:** Inject DB exception sau insert trước commit.
- **Cách tạo cạnh tranh hoặc sự cố:** B mở WS; A POST; kích hoạt lỗi, quan sát response và state.
- **Điều kiện PASS — oracle:** Không row message, không update conversation được commit, không NEW_MESSAGE.
- **Bằng chứng phải thu:** DB snapshot diff, Redis publication trace, WS.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-TX-003 — Rollback status không phát MESSAGE_STATUS_UPDATE [P0]

- **Tiền điều kiện / dữ liệu mồi:** Tin của A, B cập nhật status; inject lỗi trước commit.
- **Cách tạo cạnh tranh hoặc sự cố:** Gửi PUT status với DB rollback, theo dõi hai WS.
- **Điều kiện PASS — oracle:** Trạng thái DB giữ nguyên, không publish status update trước commit.
- **Bằng chứng phải thu:** DB before/after, WS event trace.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-TX-004 — DB commit thành công nhưng Redis publish lỗi [P0]

- **Tiền điều kiện / dữ liệu mồi:** Redis publish bị chặn ngay khi afterCommit; DB vẫn phục vụ.
- **Cách tạo cạnh tranh hoặc sự cố:** A POST một tin mới; xác định outcome HTTP, quan sát DB và B WS; khôi phục Redis và GET history.
- **Điều kiện PASS — oracle:** Tin đã commit vẫn tồn tại, đọc được bằng history; không giả định sự kiện tự replay; HTTP status phải phù hợp failure policy.
- **Bằng chứng phải thu:** DB count, HTTP, Redis errors, WS timeline.
- **Phục hồi / dọn dữ liệu:** Kịch bản cực quan trọng: sau commit không rollback được bằng cách ném lỗi từ publisher.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-TX-005 — Redis publish chậm sau commit [P1]

- **Tiền điều kiện / dữ liệu mồi:** Có proxy delay cho publish Redis và không đứt toàn bộ DB.
- **Cách tạo cạnh tranh hoặc sự cố:** Đo mốc DB commit, publisher bắt đầu/kết thúc và HTTP response; lặp 3 lần.
- **Điều kiện PASS — oracle:** DB chính xác; response phụ thuộc thời gian publish nếu callback đồng bộ; ghi rõ quan sát, chưa đặt SLO định lượng trong T07.
- **Bằng chứng phải thu:** Trace spans/markers, HTTP result, Redis traffic.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-TX-006 — Giao dịch nhận message và chạm conversation atomic [P1]

- **Tiền điều kiện / dữ liệu mồi:** A/B conversation, DB có updated_at ban đầu.
- **Cách tạo cạnh tranh hoặc sự cố:** Làm INSERT thành công rồi fault touchUpdatedAt; rollback; kiểm tra cả hai bảng.
- **Điều kiện PASS — oracle:** Không lưu message mới nếu transaction rollback; updated_at không bị sai; không event.
- **Bằng chứng phải thu:** Message/conversation SQL before/after.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-TX-007 — Read committed không thấy dữ liệu chưa commit [P1]

- **Tiền điều kiện / dữ liệu mồi:** Có test hook ở transaction ghi message.
- **Cách tạo cạnh tranh hoặc sự cố:** Giữ transaction chưa commit; client B dùng connection khác GET history.
- **Điều kiện PASS — oracle:** Không thấy dữ liệu chưa commit theo mức cô lập DB đã cấu hình; sau commit mới thấy.
- **Bằng chứng phải thu:** Two-connection SQL/HTTP timeline; isolation config.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-TX-008 — Không giữ transaction khi chờ dịch vụ chậm vô hạn [P1]

- **Tiền điều kiện / dữ liệu mồi:** Có đường nghiệp vụ có I/O MinIO hoặc Redis bên trong @Transactional.
- **Cách tạo cạnh tranh hoặc sự cố:** Inject delay có hạn ở MinIO khi `POST /videos`/finalize; ghi open transaction duration, connection active.
- **Điều kiện PASS — oracle:** Không deadlock lâu dài sau khi hết lỗi; giải phóng resources; nếu transaction giữ lâu thì ghi ISSUE thiết kế, không sửa assertion làm PASS.
- **Bằng chứng phải thu:** Tx start/commit, Hikari active/pending, thread dump.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-TX-009 — Tạo video: MinIO OK, Redis create session FAIL [P1]

- **Tiền điều kiện / dữ liệu mồi:** MinIO trả uploadId; Redis fault ngay lúc tạo session.
- **Cách tạo cạnh tranh hoặc sự cố:** POST /videos, ép Redis createSession lỗi; khôi phục; kiểm tra SQL, Redis và MinIO multipart.
- **Điều kiện PASS — oracle:** Không có video row committed khi init fail; multipart đã cấp phải được bù/dọn theo yêu cầu; nếu không có cơ chế, báo FAIL_PRODUCT/KNOWN_GAP sau chốt contract.
- **Bằng chứng phải thu:** UploadId/objectKey, SQL rows, multipart listing, cleanup job.
- **Phục hồi / dọn dữ liệu:** Snapshot Java chứa nguy cơ orphan multipart rõ ràng.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-TX-010 — Tạo video: MinIO OK, PostgreSQL INSERT FAIL [P1]

- **Tiền điều kiện / dữ liệu mồi:** Tạo multipart thành công; DB có fault cho insert.
- **Cách tạo cạnh tranh hoặc sự cố:** POST /videos với lỗi DB; khôi phục, rà object/parts/Redis.
- **Điều kiện PASS — oracle:** Không còn DB row sai; resource MinIO cần dọn/bù, hoặc ghi gap có cơ sở; không xóa bucket vô điều kiện để che leak.
- **Bằng chứng phải thu:** Multipart list before/after; DB SQL; log.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-TX-011 — Xóa tài khoản thất bại giữa cleanup video [P1]

- **Tiền điều kiện / dữ liệu mồi:** A có nhiều video recording/ready; có bước storage cleanup lỗi.
- **Cách tạo cạnh tranh hoặc sự cố:** DELETE /users/me, inject lỗi cleanup sau khi DB update tạm; quan sát commit/rollback và trạng thái từng video.
- **Điều kiện PASS — oracle:** Không tạo user deleted_at đối nghịch video vẫn thuộc trạng thái sai theo hợp đồng; nếu cleanup sai boundary, lập bug kèm evidence.
- **Bằng chứng phải thu:** Tx log, user/video rows, Redis and MinIO objects.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-TX-012 — Sự kiện post-commit không tự cấp quyền transaction mới [P2]

- **Tiền điều kiện / dữ liệu mồi:** Có publisher subscriber nhận event, DB service riêng.
- **Cách tạo cạnh tranh hoặc sự cố:** Giữ request tạo tin rồi kiểm tra sự kiện chỉ đọc row đã commit từ connection mới.
- **Điều kiện PASS — oracle:** Không phụ thuộc visibility của transaction đã kết thúc hoặc thread-local tồn dư; event payload đúng row.
- **Bằng chứng phải thu:** DB event read, thread/log contexts.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

### 4.6. PUB — Redis Pub/Sub, phát lại và nhất quán eventual

**Mục tiêu:** Kiểm tra sự thật hệ thống lưu DB và chuyển thông báo là hai nghĩa vụ khác nhau; không hứa at-least-once nếu Pub/Sub không lưu hàng đợi.
**Cơ sở thiết kế:** `MessageRealtimePublisher.java`, `MessagingRedisSubscriber.java`, `RedisMessagingListenerConfig.java`.
**Fixture nền:** A/B có hội thoại; B có WS; trạng thái Redis được thu thập từ container test.

#### T07-PUB-001 — Gửi tin khi Redis Pub/Sub tạm mất [P0]

- **Tiền điều kiện / dữ liệu mồi:** A/B có hội thoại, B WS online; DB hoạt động.
- **Cách tạo cạnh tranh hoặc sự cố:** Tắt kênh Pub/Sub có kiểm soát khi A POST, khôi phục sau commit.
- **Điều kiện PASS — oracle:** Tin còn trong DB; nếu publish không diễn ra thì WS không buộc có event tự động; B lấy lại tin qua history.
- **Bằng chứng phải thu:** DB row, Redis subscriber/publisher logs, WS, GET history.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-PUB-002 — Subscriber mất kết nối khi publish [P0]

- **Tiền điều kiện / dữ liệu mồi:** B socket đang ở backend; chặn subscriber Redis, publisher vẫn có thể ghi.
- **Cách tạo cạnh tranh hoặc sự cố:** A tạo message trong lúc subscriber không nhận, rồi nối lại subscriber.
- **Điều kiện PASS — oracle:** Không hứa replay tự động cho các event đã mất của Redis Pub/Sub; lịch sử DB đúng; không gửi nhầm event cũ khi reconnect.
- **Bằng chứng phải thu:** Redis connection log, WS received IDs, DB history.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-PUB-003 — Tin trùng do retry HTTP không gửi lại event [P0]

- **Tiền điều kiện / dữ liệu mồi:** Tin X đã lưu và event đã gửi; B vẫn online.
- **Cách tạo cạnh tranh hoặc sự cố:** A retry đúng UUID 3 lần cả liên tiếp và song song.
- **Điều kiện PASS — oracle:** DB chỉ một row; đường retry không tạo thêm NEW_MESSAGE do idempotent create; nếu transport phát trùng độc lập phải phân loại riêng.
- **Bằng chứng phải thu:** Event IDs, SQL, publish counter.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-PUB-004 — Sự kiện và response lệch thời điểm [P1]

- **Tiền điều kiện / dữ liệu mồi:** B có WS; A POST một tin.
- **Cách tạo cạnh tranh hoặc sự cố:** Thu timestamp A nhận HTTP response và B nhận event qua kênh test.
- **Điều kiện PASS — oracle:** Không suy luận order toàn cục giữa response và event nếu contract không cam kết; cả hai tham chiếu đúng message ID.
- **Bằng chứng phải thu:** Timeline đồng hồ cùng host, correlation_id.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-PUB-005 — Publish có payload Unicode và metadata chính xác [P1]

- **Tiền điều kiện / dữ liệu mồi:** A/B conversation; tin emoji/Unicode hợp lệ.
- **Cách tạo cạnh tranh hoặc sự cố:** A POST; B nhận NEW_MESSAGE, đối chiếu body HTTP, event, DB.
- **Điều kiện PASS — oracle:** Nội dung, ID, conversation, sender và timestamp không bị đổi hoặc cắt; lỗi parse không đánh đồng lỗi transport.
- **Bằng chứng phải thu:** Raw payload redacted, DB record, assertions.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-PUB-006 — Một người nhận có nhiều socket [P1]

- **Tiền điều kiện / dữ liệu mồi:** B có 3 WS, A gửi một tin.
- **Cách tạo cạnh tranh hoặc sự cố:** Đợi mỗi socket nhận theo ID; đóng socket 2 trong giữa đợt, gửi tin tiếp.
- **Điều kiện PASS — oracle:** Các socket còn sống nhận đúng, không có dữ liệu ở người C; socket đóng bị loại khỏi registry.
- **Bằng chứng phải thu:** Socket registry metrics, per-socket inboxes.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-PUB-007 — Một socket gửi lỗi không hỏng tất cả receivers [P1]

- **Tiền điều kiện / dữ liệu mồi:** Có B socket khỏe và một B socket lỗi/chậm.
- **Cách tạo cạnh tranh hoặc sự cố:** Tiêm fail tại sendMessage của socket lỗi khi A POST.
- **Điều kiện PASS — oracle:** Tin đã lưu, socket khỏe vẫn nhận theo chính sách fanout; lỗi được log/clean và subscriber tiếp tục xử lý sự kiện sau.
- **Bằng chứng phải thu:** Per-socket delivery, subscriber logs, registry size.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-PUB-008 — Subscriber restart rồi nhận các event mới [P1]

- **Tiền điều kiện / dữ liệu mồi:** B WS online, Redis listener có thể restart riêng.
- **Cách tạo cạnh tranh hoặc sự cố:** Restart listener/subscriber ở thời điểm không có publish; sau reconnect A gửi tin mới.
- **Điều kiện PASS — oracle:** Nhận sự kiện mới; không nhân đôi listener gây duplicate event hoặc leak subscription.
- **Bằng chứng phải thu:** Listener registrations, events, logs.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-PUB-009 — Đồng thời publish từ nhiều hội thoại [P1]

- **Tiền điều kiện / dữ liệu mồi:** A/B, C/D có conversations; sender khác nhau.
- **Cách tạo cạnh tranh hoặc sự cố:** Cho 20 event đồng thời có ID riêng; mỗi recipient có WS.
- **Điều kiện PASS — oracle:** Không lẫn message/user channel; các set IDs đến đúng đích; nếu mất do overload phải phân tích thay vì mong exactly-once ngầm.
- **Bằng chứng phải thu:** Channel naming, inbox ID sets, DB rows.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-PUB-010 — Payload Pub/Sub không hợp lệ [P2]

- **Tiền điều kiện / dữ liệu mồi:** Trên Redis test, cho publisher fixture gửi payload JSON sai lên channel test theo đúng cấu trúc.
- **Cách tạo cạnh tranh hoặc sự cố:** Subscriber xử lý payload lỗi; sau đó gửi một event hợp lệ.
- **Điều kiện PASS — oracle:** Không crash listener lâu dài hoặc ngắt mọi kết nối; lỗi được ghi log không lộ secret; event tiếp theo vẫn xử lý.
- **Bằng chứng phải thu:** Subscriber log, next event delivery.
- **Phục hồi / dọn dữ liệu:** Chỉ phát trong namespace E2E và có sự cho phép.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-PUB-011 — Redis subscriber backlog khi receiver chậm [P2]

- **Tiền điều kiện / dữ liệu mồi:** Có slow receiver, burst nhỏ cố định và không phải benchmark.
- **Cách tạo cạnh tranh hoặc sự cố:** Gửi 10–30 events đến B, ghi thời gian subscriber xử lý và socket buffer.
- **Điều kiện PASS — oracle:** Không deadlock, bộ đệm/giới hạn hoạt động; nếu mất event, kết quả được ghi minh bạch và DB vẫn đầy đủ.
- **Bằng chứng phải thu:** Thread dump, buffer bytes, events counts.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-PUB-012 — Publish status update hai người nhận [P2]

- **Tiền điều kiện / dữ liệu mồi:** A/B đã tham gia hội thoại, cả hai có WS; B cập nhật read.
- **Cách tạo cạnh tranh hoặc sự cố:** Tiêm lỗi gửi đến A nhưng giữ B khỏe, sau đó cập nhật trạng thái tin khác.
- **Điều kiện PASS — oracle:** DB status đúng; không gửi nhầm user; event lần sau vẫn xử lý; ghi nhận partial fanout nếu xảy ra.
- **Bằng chứng phải thu:** Per-target WS, SQL status, error logs.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

### 4.7. WS — Vòng đời WebSocket, heartbeat và slow consumer

**Mục tiêu:** Kiểm chứng connection churn, multi-device, slow receiver, buffer, quyền và khả năng thu hồi tài nguyên.
**Cơ sở thiết kế:** `MessagingWebSocketHandler.java`, `WebSocketSessionRegistry.java`, `WebSocketKeepAliveScheduler.java`, `MessagingWebSocketLifecycleConfig.java`.
**Fixture nền:** B mở 1–3 socket, client có chế độ dừng đọc/đọc chậm, token có thể thu hồi.

#### T07-WS-001 — Đóng một trong nhiều socket không xóa socket khác [P0]

- **Tiền điều kiện / dữ liệu mồi:** B có 3 socket, A gửi tin.
- **Cách tạo cạnh tranh hoặc sự cố:** Đóng socket B#2 bằng close handshake; A gửi tin mới.
- **Điều kiện PASS — oracle:** B#1, B#3 vẫn nhận, registry giữ đúng 2 live sessions và cleanup B#2.
- **Bằng chứng phải thu:** Registry states, WS events, close codes.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-WS-002 — Terminate đột ngột không leak session [P0]

- **Tiền điều kiện / dữ liệu mồi:** B có socket active, có thể terminate TCP đột ngột.
- **Cách tạo cạnh tranh hoặc sự cố:** Kill client/terminate không close frame, chờ heartbeat/timeout; quan sát registry.
- **Điều kiện PASS — oracle:** Session cuối cùng bị loại trong giới hạn hợp đồng/lifecycle; không còn task heartbeats treo vô hạn.
- **Bằng chứng phải thu:** Registry count, scheduler tasks, timing.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-WS-003 — WebSocket token đã thu hồi trong phiên mở [P0]

- **Tiền điều kiện / dữ liệu mồi:** B đã mở messaging WS, sau đó logout B từ HTTP.
- **Cách tạo cạnh tranh hoặc sự cố:** Giữ socket và không đóng phía client; đợi kỳ heartbeat recheck; thử nhận sự kiện từ A.
- **Điều kiện PASS — oracle:** Session bị đóng/không nhận sự kiện nhạy cảm sau chính sách revocation window đã chốt; không liên tục sử dụng phiên đã revoke.
- **Bằng chứng phải thu:** Redis revoke, WS close/status, event trace.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-WS-004 — Slow consumer vượt giới hạn buffer [P0]

- **Tiền điều kiện / dữ liệu mồi:** Có B client tạm dừng đọc TCP; server gửi các event hợp lệ vừa đủ kích hoạt buffer limit trên lab.
- **Cách tạo cạnh tranh hoặc sự cố:** Tăng payload/đợt gửi có giới hạn an toàn; quan sát session decorator.
- **Điều kiện PASS — oracle:** Backpressure/close phù hợp giới hạn send buffer; không gây OOM hoặc kéo sập các user khác; tin vẫn được lưu DB.
- **Bằng chứng phải thu:** WS buffer, heap, close, DB history.
- **Phục hồi / dọn dữ liệu:** Không chạy flood không giới hạn; cap bytes và duration.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-WS-005 — Heartbeat PING/PONG hoạt động bình thường [P1]

- **Tiền điều kiện / dữ liệu mồi:** B WS online, chờ qua ≥2 nhịp heartbeat theo config test.
- **Cách tạo cạnh tranh hoặc sự cố:** Phản hồi mỗi PING bằng PONG; sau đó A gửi tin mới.
- **Điều kiện PASS — oracle:** Không đóng nhầm socket khỏe; nhận sự kiện sau nhiều kỳ heartbeat.
- **Bằng chứng phải thu:** PING/PONG times, close events, incoming IDs.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-WS-006 — Client im lặng không phản hồi PING [P1]

- **Tiền điều kiện / dữ liệu mồi:** B WS mở nhưng không gửi PONG.
- **Cách tạo cạnh tranh hoặc sự cố:** Chờ timeout heartbeat cấu hình có giới hạn; sau đó gửi event vào B.
- **Điều kiện PASS — oracle:** Server đóng phiên không phản hồi theo policy và không leak registry/task.
- **Bằng chứng phải thu:** Close code, timeout config, registry count.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-WS-007 — Redis lỗi khi heartbeat kiểm tra thu hồi [P1]

- **Tiền điều kiện / dữ liệu mồi:** B messaging WS online, Redis test bị lỗi trong 1 heartbeat.
- **Cách tạo cạnh tranh hoặc sự cố:** Chặn Redis có hạn rồi phục hồi; theo dõi WS tồn tại/đóng; sau đó logout và đo kỳ recheck.
- **Điều kiện PASS — oracle:** Ứng dụng tuân fail-open/fail-closed đã chốt; không vô hạn bỏ qua revoke sau khi Redis phục hồi; scheduler sống.
- **Bằng chứng phải thu:** Heartbeat error logs, close codes, redis request timeline.
- **Phục hồi / dọn dữ liệu:** Nếu code chủ động giữ phiên khi Redis lỗi, cần chính sách bảo mật T06 để quyết định PASS/FAIL.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-WS-008 — Nhiều client đồng thời reconnect [P1]

- **Tiền điều kiện / dữ liệu mồi:** B có N=10 socket lab, mất kết nối cùng lúc.
- **Cách tạo cạnh tranh hoặc sự cố:** Ngắt các client, reconnect một lần mỗi client; gửi tin sau reconnect.
- **Điều kiện PASS — oracle:** Registry không nhân đôi session cũ; mỗi socket mới nhận đúng, scheduler task count không tăng mãi.
- **Bằng chứng phải thu:** Session IDs, registry size, scheduler metrics.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-WS-009 — WS handshake và logout tranh nhau [P1]

- **Tiền điều kiện / dữ liệu mồi:** B có access token; logout và handshake diễn ra ở barrier.
- **Cách tạo cạnh tranh hoặc sự cố:** Lặp handshake trước/sau revoke, ghi mốc; gửi NEW_MESSAGE sau mốc revocation.
- **Điều kiện PASS — oracle:** Không giữ kết nối mới trái chính sách; không có unauthorized delivery kéo dài.
- **Bằng chứng phải thu:** Close/handshake, Redis revocation, events.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-WS-010 — WS gửi TYPING đồng thời nhiều tab [P1]

- **Tiền điều kiện / dữ liệu mồi:** A có 2 tabs WS và B có 1 socket; cùng hội thoại.
- **Cách tạo cạnh tranh hoặc sự cố:** Hai tab A gửi TYPING/STOP ở thứ tự khác nhau; quan sát B.
- **Điều kiện PASS — oracle:** Không phát sự kiện cho user C; sự kiện có ID hội thoại đúng; policy typing state (nếu có) được ghi rõ.
- **Bằng chứng phải thu:** Event ordering, recipient mapping.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-WS-011 — Socket B đang đóng giữa fanout [P1]

- **Tiền điều kiện / dữ liệu mồi:** B có 3 sockets; A gửi một tin trong khi B#2 close.
- **Cách tạo cạnh tranh hoặc sự cố:** Tạo race close và sendMessage có barrier/test hook.
- **Điều kiện PASS — oracle:** Không exception phá Redis subscriber; B#1/B#3 vẫn có thể nhận; registry không rò rỉ.
- **Bằng chứng phải thu:** Thread exception log, WS IDs, registry count.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-WS-012 — Scheduler shutdown và restart backend [P1]

- **Tiền điều kiện / dữ liệu mồi:** B có socket active; backend được restart có kiểm soát.
- **Cách tạo cạnh tranh hoặc sự cố:** Restart backend; B reconnect sau readiness rồi trao đổi tin.
- **Điều kiện PASS — oracle:** Task scheduler cũ không còn chạy, backend mới phục vụ được; không nhân đôi periodic jobs.
- **Bằng chứng phải thu:** Process list, thread names, reconnect traces.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-WS-013 — Client PONG trễ sát timeout [P2]

- **Tiền điều kiện / dữ liệu mồi:** Có clock/test scheduler điều khiển.
- **Cách tạo cạnh tranh hoặc sự cố:** Gửi PONG trước và sau deadline; lặp nhiều lần.
- **Điều kiện PASS — oracle:** Đóng/giữ phiên theo deadline đã công bố, không phụ thuộc sleep jitter; race được xử lý an toàn.
- **Bằng chứng phải thu:** Clock trace, heartbeat task, close.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-WS-014 — Fragmented/large WS frame giới hạn [P2]

- **Tiền điều kiện / dữ liệu mồi:** Có client gửi text messages sát biên giới hạn kích thước.
- **Cách tạo cạnh tranh hoặc sự cố:** Truyền payload dưới/sát/trên limit theo cấu hình test; dùng socket riêng.
- **Điều kiện PASS — oracle:** Giới hạn frame/message hoạt động, không crash server; các client khác tiếp tục dùng được.
- **Bằng chứng phải thu:** Close codes, logs, unaffected control session.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-WS-015 — Lặp 100 chu kỳ kết nối/đóng không tăng vô hạn [P2]

- **Tiền điều kiện / dữ liệu mồi:** B dùng token hợp lệ, không phát tải lớn.
- **Cách tạo cạnh tranh hoặc sự cố:** Mở/đóng tuần tự 100 lần; đo registry/thread/task count trước và sau, chờ cleanup.
- **Điều kiện PASS — oracle:** Số live sessions/tasks trở về baseline; không có xu hướng tăng giữ vĩnh viễn.
- **Bằng chứng phải thu:** Counters, heap refs if profiling, process metrics.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-WS-016 — Gửi sự kiện vào session thuộc user khác khi reconnect [P2]

- **Tiền điều kiện / dữ liệu mồi:** B/C login khác nhau; socket ID/registry tái sử dụng rất nhanh.
- **Cách tạo cạnh tranh hoặc sự cố:** Đóng B, mở C, gửi tin A→B và A→C.
- **Điều kiện PASS — oracle:** Không lẫn recipient; mọi socket nhận đúng user sau reconnect.
- **Bằng chứng phải thu:** Socket user attribution, correlated events.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

### 4.8. CALL — Signaling, trạng thái cuộc gọi và mất kết nối

**Mục tiêu:** Kiểm chứng các race theo trạng thái call, offline offer, timeout, restart signaling và sự kiện trễ.
**Cơ sở thiết kế:** E08 PASS, E09/E10 FAIL trong báo cáo lịch sử; `signaling/src` chưa có trong ZIP Java, cần kiểm tra source/call contract hiện hành.
**Fixture nền:** A/B có cả messaging và signaling; payload SDP/ICE giả; correlation/call ID nếu protocol hỗ trợ.

#### T07-CALL-001 — Người nhận signaling muộn — regression E09 [P0]

- **Tiền điều kiện / dữ liệu mồi:** A mở signaling, B chỉ mở messaging.
- **Cách tạo cạnh tranh hoặc sự cố:** A CALL_OFFER; B nhận CALL_INCOMING; B mở signaling trong cửa sổ accept; đợi offer.
- **Điều kiện PASS — oracle:** B nhận offer lần gọi đầu hoặc luồng thay thế được hợp đồng hóa; không phải bắt A bấm gọi lần hai; không giao offer sang người khác.
- **Bằng chứng phải thu:** Offer correlation, A/B event traces, Node state.
- **Phục hồi / dọn dữ liệu:** E09 hiện lịch sử FAIL; case này không được đổi oracle để PASS.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-CALL-002 — Logout token vẫn mở signaling — regression E10 [P0]

- **Tiền điều kiện / dữ liệu mồi:** A logout token sống trước đó; HTTP đã trả 401.
- **Cách tạo cạnh tranh hoặc sự cố:** A thử handshake signaling mới và gửi CALL_OFFER.
- **Điều kiện PASS — oracle:** Session signaling mới bị từ chối; không có call session được tạo; hình thức Upgrade rejection/WS close theo contract.
- **Bằng chứng phải thu:** HTTP auth result, signaling handshake/close, call Map size.
- **Phục hồi / dọn dữ liệu:** E10 lịch sử FAIL; cần xử lý trước release.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-CALL-003 — Hai CALL_OFFER đồng thời A→B [P0]

- **Tiền điều kiện / dữ liệu mồi:** A/B signaling sẵn; A có hai tab gửi offer.
- **Cách tạo cạnh tranh hoặc sự cố:** Gửi 2 offer cùng lúc, có correlation độc lập nếu protocol hỗ trợ.
- **Điều kiện PASS — oracle:** State machine nhất quán theo policy (busy/reject/replace); không giữ 2 phiên mâu thuẫn hay phát offer bị lẫn.
- **Bằng chứng phải thu:** Node sessions Map snapshots, events; contract decision.
- **Phục hồi / dọn dữ liệu:** Nếu giao thức chưa định nghĩa đồng thời gọi, NEEDS_CONTRACT.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-CALL-004 — A và B gọi nhau đồng thời [P0]

- **Tiền điều kiện / dữ liệu mồi:** Cả A/B signaling online.
- **Cách tạo cạnh tranh hoặc sự cố:** Cùng thời điểm A→B và B→A gửi offer; hai chiều chờ xử lý.
- **Điều kiện PASS — oracle:** Không deadlock signaling, không nhân đôi conflicting active calls; xử lý collision theo rule đã chốt.
- **Bằng chứng phải thu:** A/B events and session map snapshot.
- **Phục hồi / dọn dữ liệu:** Glare handling cần contract chốt.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-CALL-005 — CALL_END đến cùng lúc cả hai đầu [P0]

- **Tiền điều kiện / dữ liệu mồi:** A/B đang ở phiên active.
- **Cách tạo cạnh tranh hoặc sự cố:** Hai phía cùng gửi CALL_END với cùng call; kiểm tra state và event.
- **Điều kiện PASS — oracle:** Phiên kết thúc một lần theo trạng thái; không leak Map/timers; hai bên không kẹt active.
- **Bằng chứng phải thu:** Node state, timers, close/end events.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-CALL-006 — CALL_ANSWER đến sát timeout 30 giây [P1]

- **Tiền điều kiện / dữ liệu mồi:** Có cuộc gọi chờ; thời gian timeout cấu hình Node cần xác minh.
- **Cách tạo cạnh tranh hoặc sự cố:** Dùng controllable clock/test delay cho answer trước và sau deadline.
- **Điều kiện PASS — oracle:** Answer trước deadline được xử lý; answer sau timeout không hồi sinh call đã expired; không phát trạng thái mâu thuẫn.
- **Bằng chứng phải thu:** Time controls, state, events.
- **Phục hồi / dọn dữ liệu:** Cấu hình 30s theo khảo sát, xác minh lại server.js.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-CALL-007 — Caller rớt socket sau CALL_OFFER [P1]

- **Tiền điều kiện / dữ liệu mồi:** A CALL_OFFER đang pending; B nhận incoming.
- **Cách tạo cạnh tranh hoặc sự cố:** Terminate A signaling trước khi B answer.
- **Điều kiện PASS — oracle:** B nhận/khôi phục trạng thái kết thúc theo policy, không giữ pending call vô hạn; timeout cleanup hoạt động.
- **Bằng chứng phải thu:** Node session entries, B events, timing.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-CALL-008 — Callee rớt socket giữa ANSWER và ICE [P1]

- **Tiền điều kiện / dữ liệu mồi:** A/B active, ICE đang trao đổi.
- **Cách tạo cạnh tranh hoặc sự cố:** B signaling disconnect khi A gửi ICE và sau đó reconnect.
- **Điều kiện PASS — oracle:** Không gửi ICE cho socket cũ; policy reconnect/call continuation rõ; state không stale.
- **Bằng chứng phải thu:** Socket IDs, Node map, events.
- **Phục hồi / dọn dữ liệu:** Cần contract khi reconnect active.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-CALL-009 — Offer đến trong lúc callee vừa đăng ký signaling [P1]

- **Tiền điều kiện / dữ liệu mồi:** B đang mở socket mới sau CALL_INCOMING; A pending offer.
- **Cách tạo cạnh tranh hoặc sự cố:** Dùng barrier tại registerSocket và checkTarget; lặp thứ tự giao nhau.
- **Điều kiện PASS — oracle:** Không mất offer do race kiểm tra online; nếu có pending offer, chuyển đúng một lần đến B.
- **Bằng chứng phải thu:** Signal timeline, offer IDs, map state.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-CALL-010 — CALL_REJECT đồng thời CALL_END [P1]

- **Tiền điều kiện / dữ liệu mồi:** Phiên pending A→B.
- **Cách tạo cạnh tranh hoặc sự cố:** B reject và A end gần cùng lúc.
- **Điều kiện PASS — oracle:** Phiên được dọn, không tạo active state; A/B nhận trạng thái nhất quán theo policy.
- **Bằng chứng phải thu:** Map/timer snapshots, A/B events.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-CALL-011 — Restart Node signaling khi có pending call [P1]

- **Tiền điều kiện / dữ liệu mồi:** A/B trong cuộc gọi pending, Node state in-memory.
- **Cách tạo cạnh tranh hoặc sự cố:** Restart Node riêng, kết nối lại A/B và thử giao thức continuation.
- **Điều kiện PASS — oracle:** Phiên cũ mất hay khôi phục theo hợp đồng; không ghost call, không gửi stale offer không được phép; client có thể gọi lại.
- **Bằng chứng phải thu:** Node process/map state, reconnect and events.
- **Phục hồi / dọn dữ liệu:** Không mặc định tính bền vững vì Map in-memory.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-CALL-012 — Spring call notify tạm không hoạt động [P1]

- **Tiền điều kiện / dữ liệu mồi:** A signaling online, B messaging online; Spring endpoint nội bộ bị unavailable.
- **Cách tạo cạnh tranh hoặc sự cố:** A CALL_OFFER; inject lỗi notify HTTP, rồi phục hồi Spring; theo dõi kết quả tới A/B.
- **Điều kiện PASS — oracle:** Không thông báo thành công giả nếu notify là điều kiện bắt buộc; không giữ phiên rơi vào state mập mờ; retry theo policy.
- **Bằng chứng phải thu:** Node notify HTTP status, A error, session map.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-CALL-013 — Nhiều socket signaling cùng tài khoản [P1]

- **Tiền điều kiện / dữ liệu mồi:** A có 2 sockets, B có 1.
- **Cách tạo cạnh tranh hoặc sự cố:** B gọi A khi cả hai sockets online, sau đó đóng A1 rồi gọi lại.
- **Điều kiện PASS — oracle:** Không gửi offer nhầm user; fanout/dedup theo contract; registry xóa A1 sạch.
- **Bằng chứng phải thu:** WS events per socket, maps.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-CALL-014 — ICE đến sau CALL_END [P2]

- **Tiền điều kiện / dữ liệu mồi:** A/B từng active, đã kết thúc.
- **Cách tạo cạnh tranh hoặc sự cố:** Sau CALL_END, gửi ICE_CANDIDATE có correlation phiên cũ.
- **Điều kiện PASS — oracle:** Không tái tạo phiên đã kết thúc hoặc đưa ICE sang cuộc gọi mới; phản hồi theo contract.
- **Bằng chứng phải thu:** State and event trace.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

### 4.9. VID — Multipart video, webhook và trạng thái lưu trữ

**Mục tiêu:** Kiểm tra tranh chấp chunk/finalize/abort/delete, quota, webhook lặp và trạng thái lệch Redis–PostgreSQL–MinIO.
**Cơ sở thiết kế:** `VideoService.java:52–106,164–216,313–390`, `RedisVideoUploadSessionStore.java`, `MinioMultipartStorage.java`, `VideoWebhookService.java`.
**Fixture nền:** Video recording/processing/ready; MinIO bucket test; part ≥5 MiB theo fixture; ETag; metadata/quota snapshot.

#### T07-VID-001 — Hai finalize đồng thời trên cùng upload [P0]

- **Tiền điều kiện / dữ liệu mồi:** Video recording có đầy đủ part/ETag, ready to finalize.
- **Cách tạo cạnh tranh hoặc sự cố:** Gửi 2 POST finalize đồng thời cho cùng uploadId; giữ lock contention.
- **Điều kiện PASS — oracle:** Chỉ một complete thực sự; trạng thái và object nhất quán, response khác tuân contract; không nhân đôi quota/cleanup.
- **Bằng chứng phải thu:** MinIO multipart/object, SQL status/size, Redis keys.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-VID-002 — Finalize và abort đồng thời cùng video [P0]

- **Tiền điều kiện / dữ liệu mồi:** Video recording có các part trên MinIO.
- **Cách tạo cạnh tranh hoặc sự cố:** Đặt barrier cho POST finalize và POST abort cùng uploadId.
- **Điều kiện PASS — oracle:** Chỉ một terminal outcome theo policy; không vừa READY vừa hủy object; session/metadata không mâu thuẫn.
- **Bằng chứng phải thu:** DB video, MinIO existence, Redis session, responses.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-VID-003 — Finalize và delete đồng thời [P0]

- **Tiền điều kiện / dữ liệu mồi:** Video recording/processing, chỉ khi API delete hợp lệ theo state đã chốt.
- **Cách tạo cạnh tranh hoặc sự cố:** Cho DELETE /videos/{id} và finalize tranh lock; quan sát eventual terminal state.
- **Điều kiện PASS — oracle:** Không phục hồi video đã xóa bởi webhook muộn; object, quota, Redis phù hợp terminal state.
- **Bằng chứng phải thu:** DB deleted_at/status, MinIO object/parts, webhook logs.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-VID-004 — Hai chunk-next đồng thời với part_number giống nhau [P0]

- **Tiền điều kiện / dữ liệu mồi:** Video recording, part #1 đã PUT và có ETag.
- **Cách tạo cạnh tranh hoặc sự cố:** Gửi song song 2 POST /chunks cùng part_number=2 và ETag previous như nhau.
- **Điều kiện PASS — oracle:** Hành vi idempotent/duplicate theo atomic Redis script; không tăng next_part sai, không cấp thứ tự mâu thuẫn.
- **Bằng chứng phải thu:** Redis hash fields, responses, server logs.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-VID-005 — Hai chunk-next khác part_number đến đảo thứ tự [P0]

- **Tiền điều kiện / dữ liệu mồi:** Video part1 đã upload, client thử yêu cầu next2 và next3 song song.
- **Cách tạo cạnh tranh hoặc sự cố:** Barrier cả hai POST với etag phù hợp/không phù hợp.
- **Điều kiện PASS — oracle:** Chỉ bước hợp lệ theo thứ tự được chấp nhận; không bỏ qua part hoặc ghi sai ETag state.
- **Bằng chứng phải thu:** Redis nextPart, upload entries, API errors.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-VID-006 — Webhook Complete đến 2 lần giống nhau [P0]

- **Tiền điều kiện / dữ liệu mồi:** Video PROCESSING đã hoàn thành multipart, webhook hợp lệ.
- **Cách tạo cạnh tranh hoặc sự cố:** Gửi hai webhook giống nhau qua đường nội bộ test, có thể song song.
- **Điều kiện PASS — oracle:** Một trạng thái READY cuối cùng; quota/file_size không nhân đôi; không xóa nhầm object.
- **Bằng chứng phải thu:** DB status/size, MinIO object, webhook responses.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-VID-007 — Webhook đến trước response finalize [P0]

- **Tiền điều kiện / dữ liệu mồi:** MinIO event có thể đến nhanh, test hook delay HTTP response finalize.
- **Cách tạo cạnh tranh hoặc sự cố:** Hoàn thành MinIO, để webhook xử lý trong khi HTTP POST finalize chưa trả.
- **Điều kiện PASS — oracle:** Không mất event do trạng thái trung gian; video cuối READY hợp lệ, không bị overwrite quay lại PROCESSING.
- **Bằng chứng phải thu:** DB state timestamps, response/webhook order.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-VID-008 — Webhook muộn sau abort [P0]

- **Tiền điều kiện / dữ liệu mồi:** Video recording bị abort trước khi webhook cũ đến.
- **Cách tạo cạnh tranh hoặc sự cố:** Abort rồi phát webhook callback cũ có chữ ký hợp lệ fixture test.
- **Điều kiện PASS — oracle:** Video không bị chuyển READY trái phép; không tái tạo Redis session/quota.
- **Bằng chứng phải thu:** DB row, Redis keys, MinIO objects, webhook logs.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-VID-009 — Webhook muộn sau delete video [P0]

- **Tiền điều kiện / dữ liệu mồi:** Video READY rồi DELETE; callback Complete lặp lại.
- **Cách tạo cạnh tranh hoặc sự cố:** Gửi callback hợp lệ nhưng trễ sau deletion.
- **Điều kiện PASS — oracle:** Không resurrect metadata/object deleted; quota vẫn đúng.
- **Bằng chứng phải thu:** DB deleted_at, quota GET, storage object presence.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-VID-010 — Khởi tạo video concurrent gần quota [P0]

- **Tiền điều kiện / dữ liệu mồi:** A có used_bytes sát storage limit; two new uploads estimated size riêng, mỗi cái individually fit nhưng tổng vượt.
- **Cách tạo cạnh tranh hoặc sự cố:** Gửi hai POST /videos đồng thời cho cùng A; sau đó finalize nếu cần.
- **Điều kiện PASS — oracle:** Quota cuối không vượt chính sách; nếu quota chỉ tính READY, phải kiểm tra invariant ở finalize và không mặc định init phải reject; chốt contract.
- **Bằng chứng phải thu:** DB sum READY, responses, MinIO uploads.
- **Phục hồi / dọn dữ liệu:** Code snapshot ghi quota chỉ đếm READY: kiểm tra kịch bản overcommit ở finalize.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-VID-011 — Finalize hai video cùng user chạm quota [P0]

- **Tiền điều kiện / dữ liệu mồi:** A có hai uploads, nếu cả hai ready sẽ vượt quota.
- **Cách tạo cạnh tranh hoặc sự cố:** PUT đầy đủ parts, finalize cả hai gần nhau.
- **Điều kiện PASS — oracle:** Không vượt quota READY ở trạng thái cuối; lock quota cùng user ngăn race; không để object dư không được dọn.
- **Bằng chứng phải thu:** SQL sum file_size READY, locks, MinIO objects.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-VID-012 — Hai người khác nhau finalize song song [P1]

- **Tiền điều kiện / dữ liệu mồi:** A/B có hai uploads independent.
- **Cách tạo cạnh tranh hoặc sự cố:** Gửi finalize A/B đồng thời; không cố ý đua cùng lock key.
- **Điều kiện PASS — oracle:** Trạng thái của từng upload đúng, không khóa nhầm user; không kéo quota chéo.
- **Bằng chứng phải thu:** Lock keys, DB owners, objects.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-VID-013 — Finalize khi Redis upload session hết hạn [P1]

- **Tiền điều kiện / dữ liệu mồi:** Video recording, MinIO parts tồn tại; chỉnh TTL trong test.
- **Cách tạo cạnh tranh hoặc sự cố:** Cho Redis session hết TTL trước finalize; gọi finalize.
- **Điều kiện PASS — oracle:** Không complete bằng trạng thái ETag chưa xác minh; response lỗi có kiểm soát và tài nguyên có đường cleanup.
- **Bằng chứng phải thu:** Redis TTL/session, MinIO multipart/object, SQL status.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-VID-014 — Finalize khi part ETag thay đổi giữa các bước [P1]

- **Tiền điều kiện / dữ liệu mồi:** Video recording, nhiều part.
- **Cách tạo cạnh tranh hoặc sự cố:** Làm ETag không trùng danh sách đã ghi nhận trước finalize, race với PUT lại part.
- **Điều kiện PASS — oracle:** Không chấp nhận danh sách ETag sai; không tạo READY với bytes ngoài mong đợi.
- **Bằng chứng phải thu:** MinIO listParts, submitted ETags, SHA-256.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-VID-015 — MinIO complete thành công nhưng webhook không đến [P1]

- **Tiền điều kiện / dữ liệu mồi:** Video PROCESSING, MinIO object đã hoàn tất.
- **Cách tạo cạnh tranh hoặc sự cố:** Chặn webhook trước HTTP callback/notification, đợi deadline; khôi phục đường notify.
- **Điều kiện PASS — oracle:** Nếu không có retry/reconciliation, báo trạng thái kẹt PROCESSING là gap; không tự đánh PASS khi MinIO có object mà DB mãi không READY.
- **Bằng chứng phải thu:** DB status, MinIO object, retry/event config.
- **Phục hồi / dọn dữ liệu:** Cần chốt retention và notification retry của MinIO.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-VID-016 — MinIO complete lỗi sau khi đặt PROCESSING [P1]

- **Tiền điều kiện / dữ liệu mồi:** Video có valid parts, tiêm lỗi MinIO CompleteMultipart.
- **Cách tạo cạnh tranh hoặc sự cố:** POST finalize, buộc operation fail; khôi phục MinIO; retry hoặc cleanup theo contract.
- **Điều kiện PASS — oracle:** Không báo READY nếu object chưa tồn tại; không giữ lock/quota mãi; có đường retry/abort an toàn.
- **Bằng chứng phải thu:** Status timeline, MinIO multipart list, Redis session.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-VID-017 — Presigned URL PUT đang chạy khi user abort [P1]

- **Tiền điều kiện / dữ liệu mồi:** Video đang upload một part qua URL đã cấp.
- **Cách tạo cạnh tranh hoặc sự cố:** Bắt đầu PUT, gửi POST abort trước khi PUT hoàn tất bằng network delay có kiểm soát.
- **Điều kiện PASS — oracle:** Trạng thái cuối không cho finalize phiên đã abort; object/parts và Redis session được dọn/không thể dùng lại theo contract.
- **Bằng chứng phải thu:** PUT status, abort status, MinIO listParts, Redis.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-VID-018 — Delete READY đồng thời GET view URL [P1]

- **Tiền điều kiện / dữ liệu mồi:** Video READY; A chủ sở hữu đang GET detail/view.
- **Cách tạo cạnh tranh hoặc sự cố:** Cho client lấy presigned GET URL cùng lúc DELETE; thử URL sau xóa.
- **Điều kiện PASS — oracle:** Không làm metadata/trạng thái sai; quyền truy cập của presigned URL hiện hữu tuân policy thực tế, không suy đoán nó bị thu hồi tức thì.
- **Bằng chứng phải thu:** HTTP GET/delete, MinIO URL status, DB/objects.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-VID-019 — MinIO multipart orphan sau init lỗi [P1]

- **Tiền điều kiện / dữ liệu mồi:** Inject Redis/DB lỗi sau khi createMultipartUpload.
- **Cách tạo cạnh tranh hoặc sự cố:** Liệt kê tất cả uploadId/objectKey thuộc run ngay sau fail và sau cleanup period.
- **Điều kiện PASS — oracle:** Không có orphan tồn tại ngoài thời hạn cleanup đã cam kết; nếu code không có đường bù tương ứng, ghi KNOWN_GAP/FAIL theo contract.
- **Bằng chứng phải thu:** MinIO listIncompleteUploads, SQL rows, Redis keys.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-VID-020 — Đổi title khi status đổi PROCESSING → READY [P1]

- **Tiền điều kiện / dữ liệu mồi:** Video đã finalize, webhook chưa tới; owner PUT metadata.
- **Cách tạo cạnh tranh hoặc sự cố:** PUT title cùng lúc webhook READY.
- **Điều kiện PASS — oracle:** Title hợp lệ được giữ, không mất update do write race; status vẫn READY, quota đúng.
- **Bằng chứng phải thu:** SQL before/after, HTTP detail.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-VID-021 — Upload nhiều phần khi MinIO trả ETag không ổn định [P2]

- **Tiền điều kiện / dữ liệu mồi:** MinIO test proxy có thể giả lập đổi/thiếu ETag response, không thay server production.
- **Cách tạo cạnh tranh hoặc sự cố:** PUT part, gây ETag bất thường rồi gọi chunks/finalize.
- **Điều kiện PASS — oracle:** Backend không lưu sai ETag hoặc complete object sai byte; báo lỗi có kiểm soát.
- **Bằng chứng phải thu:** ETag logs masked, Redis session, MinIO parts.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-VID-022 — Nhiều video nhỏ tạo và abort liên tiếp [P2]

- **Tiền điều kiện / dữ liệu mồi:** A có quota; 20 uploads tạo→abort tuần tự trong lab.
- **Cách tạo cạnh tranh hoặc sự cố:** Lặp vòng đời video không phát tải cao; kiểm tra trước/sau total upload sessions, keys và records.
- **Điều kiện PASS — oracle:** Không tăng dần phiên multipart hoặc Redis keys chưa dọn; cleanup jobs có kết thúc.
- **Bằng chứng phải thu:** Counts at baseline/end, Redis prefixes, multipart listing.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

### 4.10. LOCK — Distributed lock, lease, contention và retry

**Mục tiêu:** Kiểm tra lock owner token, TTL, renewal, crash và nguy cơ thao tác tiếp diễn khi đã mất quyền sở hữu khóa.
**Cơ sở thiết kế:** `video/RedisDistributedLock.java:24–105`, `RedisVideoUploadSessionStore.java:24–140`, `MessageRepository.java:35`.
**Fixture nền:** Hai tác nhân thao tác cùng video/user, Redis test; đồng hồ/độ trễ có thể điều khiển.

#### T07-LOCK-001 — Hai thao tác cùng video không cùng giữ lock [P0]

- **Tiền điều kiện / dữ liệu mồi:** Video hợp lệ, hai tiến trình dùng cùng Redis.
- **Cách tạo cạnh tranh hoặc sự cố:** Đặt barrier acquire cùng key `video:operation-lock:{id}`.
- **Điều kiện PASS — oracle:** Tại mỗi thời điểm tối đa một chủ sở hữu có lease hợp lệ; actor kia chờ hoặc conflict theo timeout.
- **Bằng chứng phải thu:** Lock token hashes masked, operation timeline, Redis key owner.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-LOCK-002 — Release lock cũ không xóa khóa chủ mới [P0]

- **Tiền điều kiện / dữ liệu mồi:** Có lease TTL ngắn và giả lập owner A hết hạn, B acquire mới.
- **Cách tạo cạnh tranh hoặc sự cố:** A gọi release muộn sau khi B đã sở hữu.
- **Điều kiện PASS — oracle:** Lua compare-token không xóa key của B; B hoàn thành công việc bình thường.
- **Bằng chứng phải thu:** Redis key token identity masked, acquire/release responses.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-LOCK-003 — Renew từ owner cũ không gia hạn khóa mới [P0]

- **Tiền điều kiện / dữ liệu mồi:** Owner A lease expired, B sở hữu cùng key.
- **Cách tạo cạnh tranh hoặc sự cố:** Kích hoạt renew A sau TTL và sau B acquire.
- **Điều kiện PASS — oracle:** A không extend TTL của B; token compare script chỉ tác động đúng lease.
- **Bằng chứng phải thu:** Redis TTL before/after, controlled clock trace.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-LOCK-004 — Mất lock renewal giữa thao tác dài [P0]

- **Tiền điều kiện / dữ liệu mồi:** A đang finalize với MinIO delay; Redis renew bị chặn cho A.
- **Cách tạo cạnh tranh hoặc sự cố:** Đợi lease A hết hạn, B acquire, cho A tiếp tục I/O.
- **Điều kiện PASS — oracle:** Không cho phép hai thay đổi bất tương thích cùng commit; nếu code không có fencing/ownership recheck, ghi race nguy hiểm, không chỉ kiểm tra Lua renew đúng.
- **Bằng chứng phải thu:** DB final, MinIO side effects, lease/ownership trace.
- **Phục hồi / dọn dữ liệu:** Case nâng cao rất quan trọng để đánh giá distributed lock lease safety.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-LOCK-005 — Redis chết khi đang giữ lock [P1]

- **Tiền điều kiện / dữ liệu mồi:** Owner A đã acquire, Redis test dừng ngắn.
- **Cách tạo cạnh tranh hoặc sự cố:** A thực hiện release/renew trong lúc Redis unavailable rồi Redis hồi phục.
- **Điều kiện PASS — oracle:** Không deadlock/leak vô hạn; lock có TTL và thao tác failure được quản lý theo policy; không bị người khác giữ sai vĩnh viễn.
- **Bằng chứng phải thu:** Lease TTL, exception logs, next acquire.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-LOCK-006 — Lock acquire timeout chính xác [P1]

- **Tiền điều kiện / dữ liệu mồi:** A giữ lock lâu hơn cấu hình timeout acquire, B xin cùng khóa.
- **Cách tạo cạnh tranh hoặc sự cố:** B thử acquire, ghi duration/timeouts.
- **Điều kiện PASS — oracle:** B nhận lỗi conflict/retry đúng contract; không chờ vô hạn hoặc busy-spin mất CPU; A vẫn giữ quyền thao tác hợp lệ.
- **Bằng chứng phải thu:** Elapsed time, logs, Redis lock key, CPU sanity.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-LOCK-007 — Ngắt thread trong lúc chờ lock [P1]

- **Tiền điều kiện / dữ liệu mồi:** A giữ lock, B bị interrupt khi đợi.
- **Cách tạo cạnh tranh hoặc sự cố:** Cancel/interrupt B; sau đó thả A và thử request C.
- **Điều kiện PASS — oracle:** B kết thúc có kiểm soát, không chiếm lock; interrupt state được xử lý; C acquire được.
- **Bằng chứng phải thu:** Thread dump, key ownership, subsequent outcome.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-LOCK-008 — Quota lock cùng user ngăn overcommit [P1]

- **Tiền điều kiện / dữ liệu mồi:** A có hai finalize đang tranh quota.
- **Cách tạo cạnh tranh hoặc sự cố:** Barrier finalize video1/video2; quan sát critical section.
- **Điều kiện PASS — oracle:** Tính quota/ghi READY không vi phạm hạn mức; mọi lock được release.
- **Bằng chứng phải thu:** SQL quota sum, Redis keys, object storage.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-LOCK-009 — Lock khác user không cạnh tranh không cần thiết [P1]

- **Tiền điều kiện / dữ liệu mồi:** A/B khác user, video riêng; hai finalize.
- **Cách tạo cạnh tranh hoặc sự cố:** Đặt barrier, trace lock key của mỗi request.
- **Điều kiện PASS — oracle:** Không dùng nhầm global quota lock gây serialize không cần thiết; kết quả riêng rẽ đúng; đây là đánh giá thiết kế, không đặt ngưỡng tốc độ.
- **Bằng chứng phải thu:** Lock key IDs, operation timeline, DB ownership.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-LOCK-010 — Atomic Redis upload session update tranh nhau [P1]

- **Tiền điều kiện / dữ liệu mồi:** Một Redis hash video upload, 2 worker gọi cập nhật next_part.
- **Cách tạo cạnh tranh hoặc sự cố:** Tạo request race qua Lua code; đọc hash sau mỗi lần.
- **Điều kiện PASS — oracle:** `next_part`, ETag list và state không lệch; chỉ một thứ tự được chấp nhận hợp pháp.
- **Bằng chứng phải thu:** Redis hash fields, Lua result, API status.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-LOCK-011 — Message status pessimistic row lock [P1]

- **Tiền điều kiện / dữ liệu mồi:** Một message recipient B, 2 PUT cập nhật status.
- **Cách tạo cạnh tranh hoặc sự cố:** Giữ transaction 1 mở ở row lock, gửi transaction 2, sau đó release.
- **Điều kiện PASS — oracle:** Không lost update/downgrade; waiting kết thúc khi lock được release; DB cuối đúng.
- **Bằng chứng phải thu:** DB locks/waits, status rows, responses.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-LOCK-012 — Hàng loạt contention ngắn không để lock treo [P2]

- **Tiền điều kiện / dữ liệu mồi:** Một video, 10 thao tác cố ý tranh lock có giới hạn.
- **Cách tạo cạnh tranh hoặc sự cố:** Chạy burst nhỏ 10 operations, sau đó chờ mọi worker hoàn tất.
- **Điều kiện PASS — oracle:** Redis lock key hết TTL/release; không giữ thread waiting vô hạn; DB/MinIO không hỏng.
- **Bằng chứng phải thu:** Redis TTL and key listing, thread dump, results.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

### 4.11. FAIL — Mất phụ thuộc: PostgreSQL, Redis, MinIO và mạng

**Mục tiêu:** Kiểm tra fail-fast/fail-controlled, không nói mọi yêu cầu phải 200; tạo gián đoạn ngắn có giới hạn và quan sát trạng thái.
**Cơ sở thiết kế:** `application.yml` và cấu hình timeout runtime chưa nhận; Java snapshot; lỗi signaling E10 đã biết.
**Fixture nền:** Container cô lập và kênh quản trị test, health metrics, test-only network fault injection.

#### T07-FAIL-001 — PostgreSQL không khả dụng khi login [P0]

- **Tiền điều kiện / dữ liệu mồi:** Backend khỏe, Redis/MinIO khỏe.
- **Cách tạo cạnh tranh hoặc sự cố:** Dừng/chặn DB trước POST /auth/login, đợi timeout; khôi phục DB rồi login lại.
- **Điều kiện PASS — oracle:** Không cấp token thành công giả khi chưa xác thực DB; lỗi được kiểm soát và phục hồi; không leak connection.
- **Bằng chứng phải thu:** HTTP status/body, Hikari stats, DB ready, logs.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-FAIL-002 — PostgreSQL mất giữa gửi tin [P0]

- **Tiền điều kiện / dữ liệu mồi:** A/B conversation, B WS online; DB được fail ngay trước insert hoặc commit.
- **Cách tạo cạnh tranh hoặc sự cố:** Gửi POST và inject DB network break tại hai checkpoint khác nhau.
- **Điều kiện PASS — oracle:** Không có tin nửa vời; không NEW_MESSAGE cho message không commit; sau DB trở lại gửi tin được.
- **Bằng chứng phải thu:** SQL after recovery, WS events, HTTP and transaction logs.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-FAIL-003 — Redis không khả dụng khi JWT kiểm tra revoke [P0]

- **Tiền điều kiện / dữ liệu mồi:** A có token hợp lệ, Spring auth yêu cầu Redis.
- **Cách tạo cạnh tranh hoặc sự cố:** Dừng Redis trước GET /users/me hoặc messaging handshake; khôi phục Redis.
- **Điều kiện PASS — oracle:** Fail-open/fail-closed cần chốt theo yêu cầu bảo mật; không lộ dữ liệu trái chính sách; sau recover xác thực hoạt động.
- **Bằng chứng phải thu:** HTTP/WS, Redis errors, auth traces.
- **Phục hồi / dọn dữ liệu:** Đánh dấu NEEDS_CONTRACT nếu policy chưa định nghĩa.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-FAIL-004 — Redis mất khi lưu phiên upload [P0]

- **Tiền điều kiện / dữ liệu mồi:** MinIO còn khỏe; POST /videos bắt đầu tạo multipart.
- **Cách tạo cạnh tranh hoặc sự cố:** Inject Redis fail tại createSession sau MinIO create; hồi phục Redis.
- **Điều kiện PASS — oracle:** Không có video row committed sai; orphan multipart được theo dõi/cleanup; không để lại session dở.
- **Bằng chứng phải thu:** SQL, Redis keys, MinIO incomplete uploads.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-FAIL-005 — MinIO không khả dụng trong create upload [P0]

- **Tiền điều kiện / dữ liệu mồi:** DB và Redis khỏe, MinIO endpoint bị từ chối.
- **Cách tạo cạnh tranh hoặc sự cố:** POST /videos, ghi phản hồi; khôi phục MinIO rồi thử lại.
- **Điều kiện PASS — oracle:** Không tạo record `recording` thành công giả hoặc Redis session mồ côi; retry có thể tạo upload hợp lệ.
- **Bằng chứng phải thu:** Video SQL, Redis, MinIO and HTTP.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-FAIL-006 — MinIO lỗi giữa complete multipart [P0]

- **Tiền điều kiện / dữ liệu mồi:** Video đủ parts, backend bắt đầu finalize.
- **Cách tạo cạnh tranh hoặc sự cố:** Inject network timeout ở thời điểm complete, kết quả có thể ambiguous; khôi phục; reconcile state.
- **Điều kiện PASS — oracle:** Không kết luận incomplete nếu operation đã thành công tại server; xác minh object MinIO và DB, retry idempotent.
- **Bằng chứng phải thu:** MinIO object existence and size, SQL statuses, uploadId.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-FAIL-007 — Redis subscriber mất nhưng Redis key ops còn hoạt động [P1]

- **Tiền điều kiện / dữ liệu mồi:** Có thể cô lập kết nối subscriber, backend auth cache Redis vẫn khỏe.
- **Cách tạo cạnh tranh hoặc sự cố:** Ngắt listener connection trong khi A gửi vài tin; sau reconnect gửi tin mới.
- **Điều kiện PASS — oracle:** DB messages đúng; event cũ có thể mất theo Pub/Sub; event mới lại nhận; không crash app.
- **Bằng chứng phải thu:** WS received IDs, Redis subscribe log, DB history.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-FAIL-008 — Backend không tới được Node signaling [P1]

- **Tiền điều kiện / dữ liệu mồi:** Spring Boot và dữ liệu khỏe; Node signaling dừng.
- **Cách tạo cạnh tranh hoặc sự cố:** Thử HTTP messaging, avatar và gọi signaling từ client.
- **Điều kiện PASS — oracle:** Các API không phụ thuộc Node vẫn hoạt động; call bị từ chối/timeout có kiểm soát; không treo request khác.
- **Bằng chứng phải thu:** Health per component, HTTP status, signal close.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-FAIL-009 — Node signaling gọi internal notify timeout [P1]

- **Tiền điều kiện / dữ liệu mồi:** Node chạy, Spring internal notify delay hoặc unavailable.
- **Cách tạo cạnh tranh hoặc sự cố:** Gửi CALL_OFFER và buộc notify timeout; khôi phục Spring.
- **Điều kiện PASS — oracle:** Không giữ cuộc gọi pending mập mờ; caller có phản hồi lỗi/tình trạng rõ ràng; theo policy retry.
- **Bằng chứng phải thu:** Node HTTP client logs, A events, pending state.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-FAIL-010 — Mạng MinIO có độ trễ lớn nhưng chưa chết [P1]

- **Tiền điều kiện / dữ liệu mồi:** Có proxy network lab đặt delay ngắn cố định.
- **Cách tạo cạnh tranh hoặc sự cố:** Delay ListParts/CompleteMultipart; thực hiện finalize; theo dõi thread và lock.
- **Điều kiện PASS — oracle:** Timeout đúng cấu hình hoặc hoàn thành; không giữ lock/transaction vô hạn; state cuối nhất quán.
- **Bằng chứng phải thu:** Thread dump, timing, Redis lease TTL, SQL/MinIO.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-FAIL-011 — Database pool hết connection tạm thời [P1]

- **Tiền điều kiện / dữ liệu mồi:** Có test hook giữ số connection tối đa trong lab, không phải phát tải vô hạn.
- **Cách tạo cạnh tranh hoặc sự cố:** Chiếm tất cả connection trong phạm vi lab, gửi một GET protected, sau đó thả.
- **Điều kiện PASS — oracle:** Request chờ/timed out theo cấu hình; pool hồi phục; không giữ connection thất lạc.
- **Bằng chứng phải thu:** Hikari active/pending, HTTP response, SQL pg_stat_activity.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-FAIL-012 — Redis rate limit key không có TTL sau crash giữa INCR–EXPIRE [P1]

- **Tiền điều kiện / dữ liệu mồi:** Rate limiter Redis implement INCR rồi EXPIRE tách biệt.
- **Cách tạo cạnh tranh hoặc sự cố:** Dùng test hook crash sau INCR trước EXPIRE; khôi phục app; kiểm tra TTL key.
- **Điều kiện PASS — oracle:** Nếu TTL=-1 không có repair, ghi rủi ro key vĩnh viễn; không tự đánh PASS vì request tiếp theo vẫn chạy.
- **Bằng chứng phải thu:** Redis GET/TTL, rate limit behavior, code trace.
- **Phục hồi / dọn dữ liệu:** Snapshot code tạo nguy cơ do hai thao tác tách biệt.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-FAIL-013 — DNS/hostname của phụ thuộc thay đổi giữa request [P2]

- **Tiền điều kiện / dữ liệu mồi:** Dùng proxy/container DNS riêng trong lab.
- **Cách tạo cạnh tranh hoặc sự cố:** Làm một backend dependency hostname tạm không phân giải, phục hồi rồi thử lại.
- **Điều kiện PASS — oracle:** Không giữ client kết nối hỏng mãi; thông báo lỗi có kiểm soát và phục hồi sau khi DNS hoạt động.
- **Bằng chứng phải thu:** Resolution logs, retry timeline, subsequent success.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

### 4.12. REC — Khởi động lại, cleanup, retry và phục hồi

**Mục tiêu:** Kiểm chứng cơ chế retry bền vững và không làm sai trạng thái khi worker/process chết giữa bước nghiệp vụ.
**Cơ sở thiết kế:** `VideoTimeoutCleanupJob.java`, `VideoCleanupRetryJob.java`, `VideoCleanupJob*.java`, `UserAccountService.java`, `VideoAccountCleanupService.java`.
**Fixture nền:** Video nhiều trạng thái; cleanup job DB; khả năng restart chỉ một service; polling có hạn.

#### T07-REC-001 — Restart backend sau message đã commit [P0]

- **Tiền điều kiện / dữ liệu mồi:** A gửi tin thành công, B có history; backend restart ngay sau.
- **Cách tạo cạnh tranh hoặc sự cố:** Dừng backend, khởi động lại kết nối đến DB/Redis; GET history và gửi tin tiếp.
- **Điều kiện PASS — oracle:** Tin không mất; token hợp lệ vẫn hoạt động theo contract; không có duplicate do restart.
- **Bằng chứng phải thu:** DB rows, HTTP history, logs, new WS delivery.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-REC-002 — Restart backend trước commit message [P0]

- **Tiền điều kiện / dữ liệu mồi:** Có hook giữ txn trước commit; container backend có thể kill riêng.
- **Cách tạo cạnh tranh hoặc sự cố:** Kill process trước commit, restart, GET history/retry UUID.
- **Điều kiện PASS — oracle:** Không thấy partial DB commit; retry tạo một tin mới hoặc trả existing nếu commit đã xảy ra thực tế, xác minh bằng DB.
- **Bằng chứng phải thu:** DB transaction log, row count, retry response.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-REC-003 — Restart backend khi video PROCESSING [P0]

- **Tiền điều kiện / dữ liệu mồi:** Video finalize complete đang chờ webhook hoặc đang processing.
- **Cách tạo cạnh tranh hoặc sự cố:** Restart backend trước webhook tới; khôi phục, kiểm tra trạng thái cuối và retry/cleanup.
- **Điều kiện PASS — oracle:** Video cuối READY hoặc trạng thái recoverable theo policy; không treo vô hạn nếu webhook mất.
- **Bằng chứng phải thu:** DB status, MinIO object, webhook/event logs.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-REC-004 — Cleanup job thất bại khi xóa object [P0]

- **Tiền điều kiện / dữ liệu mồi:** Video có cleanup job đến hạn, MinIO lỗi xóa.
- **Cách tạo cạnh tranh hoặc sự cố:** Chạy cleanup, inject MinIO failure, khôi phục và chờ retry.
- **Điều kiện PASS — oracle:** Cleanup job còn bền vững và được retry theo lịch; object cuối bị dọn, trạng thái job kết thúc.
- **Bằng chứng phải thu:** video_cleanup_jobs rows, MinIO inventory, logs.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-REC-005 — Restart giữa retry cleanup job [P0]

- **Tiền điều kiện / dữ liệu mồi:** Job due đang chạy, video/object tồn tại.
- **Cách tạo cạnh tranh hoặc sự cố:** Kill backend trước khi cập nhật trạng thái job; restart rồi đợi retry.
- **Điều kiện PASS — oracle:** Không mất job; chạy lại an toàn (idempotent delete), không tạo vòng lặp vô hạn.
- **Bằng chứng phải thu:** DB cleanup rows, object state, attempts timestamps.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-REC-006 — Timeout cleanup bắt video PROCESSING quá hạn [P1]

- **Tiền điều kiện / dữ liệu mồi:** Video PROCESSING lâu hơn `processingTimeoutSeconds` trong fixture.
- **Cách tạo cạnh tranh hoặc sự cố:** Chạy scheduler với clock test; theo dõi chuyển trạng thái và cleanup.
- **Điều kiện PASS — oracle:** Video được đánh dấu failed/deleted hoặc cleanup theo code/contract; Redis/object không leak ngoài cam kết.
- **Bằng chứng phải thu:** SQL/video states, Redis keys, MinIO object/parts.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-REC-007 — Cleanup scheduler không chạy trùng khi restart [P1]

- **Tiền điều kiện / dữ liệu mồi:** Backend đang có jobs, restart một lần.
- **Cách tạo cạnh tranh hoặc sự cố:** Theo dõi thread named scheduler và thời điểm run sau restart.
- **Điều kiện PASS — oracle:** Không tạo nhiều timer sống trong cùng JVM do lifecycle; jobs được xử lý đúng một lần logic hoặc idempotent nếu retry.
- **Bằng chứng phải thu:** Thread dump, logs, DB job count.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-REC-008 — Poison cleanup job không chặn jobs sau [P1]

- **Tiền điều kiện / dữ liệu mồi:** Có hai jobs due, job1 luôn lỗi nhưng job2 hợp lệ.
- **Cách tạo cạnh tranh hoặc sự cố:** Chạy retry scheduler; theo dõi cả hai jobs.
- **Điều kiện PASS — oracle:** Lỗi job1 được cô lập; job2 vẫn hoàn thành; retry/backoff job1 cập nhật.
- **Bằng chứng phải thu:** Job rows, object presence, scheduler logs.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-REC-009 — Backoff retry tăng đúng và có giới hạn [P1]

- **Tiền điều kiện / dữ liệu mồi:** Có job fail N lần, clock điều khiển.
- **Cách tạo cạnh tranh hoặc sự cố:** Chạy job qua các lần thất bại, lấy nextAttemptAt.
- **Điều kiện PASS — oracle:** Khoảng chờ theo policy, không busy retry gây CPU/I/O tăng; trạng thái persisted và tiếp tục sau restart.
- **Bằng chứng phải thu:** Attempts, next_attempt_at, timestamps, CPU sanity.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-REC-010 — Account deletion có video đang upload [P1]

- **Tiền điều kiện / dữ liệu mồi:** A có READY + RECORDING, đang mở upload URL, chưa xóa account.
- **Cách tạo cạnh tranh hoặc sự cố:** DELETE account khi một upload đang hoạt động, rồi thử finalize cũ.
- **Điều kiện PASS — oracle:** Sau delete không tạo video READY thuộc tài khoản đã xóa trái chính sách; cleanup và revocation đầy đủ theo hợp đồng.
- **Bằng chứng phải thu:** users/videos DB, Redis session, MinIO uploadId.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-REC-011 — Orphan MinIO multipart có thể được liệt kê và xử lý [P1]

- **Tiền điều kiện / dữ liệu mồi:** Có multipart uploadId được tạo nhưng DB row rollback hoặc mất, chỉ trong test bucket.
- **Cách tạo cạnh tranh hoặc sự cố:** Chạy scan inventory/cleanup ngoài hoặc cơ chế hệ thống đã có; chờ thời hạn retention.
- **Điều kiện PASS — oracle:** Không để orphan vô hạn nếu hợp đồng đòi dọn; nếu chưa có chức năng, ghi ISSUE + kế hoạch, không ghi PASS bằng cách xóa cả bucket ngay.
- **Bằng chứng phải thu:** MinIO incomplete list, DB missing row, cleanup proof.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-REC-012 — Khôi phục sau reboot Docker Engine của lab [P2]

- **Tiền điều kiện / dữ liệu mồi:** Chỉ trên host test hoàn toàn riêng, có snapshot và run_id.
- **Cách tạo cạnh tranh hoặc sự cố:** Restart Docker Engine/host test rồi dựng lại stack đã biết; kiểm tra readiness và dữ liệu persisted nếu dùng volume test.
- **Điều kiện PASS — oracle:** Tài liệu hóa trạng thái expected của ephemeral/persistent data; không nhầm mất container test ephemeral với lỗi business durability.
- **Bằng chứng phải thu:** Host logs, container status, DB snapshots.
- **Phục hồi / dọn dữ liệu:** Không chạy trên máy có project quan trọng không được phép.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

### 4.13. MULTI — Mở rộng nhiều instance — nghiên cứu tùy chọn

**Mục tiêu:** Thử các giả định chia sẻ trạng thái khi có 2 backend/signaling instance, KHÔNG bắt buộc để nghiệm thu một instance.
**Cơ sở thiết kế:** `WebSocketSessionRegistry.java` giữ trạng thái trong JVM; Node signaling Map per-process theo báo cáo; cân bằng tải chưa xác minh.
**Fixture nền:** 2 instance backend, Redis chung, PostgreSQL chung, reverse proxy/route test; không chạy nếu chưa dựng lab.

#### T07-MULTI-001 — Redis Pub/Sub fanout hai Spring instances [P1]

- **Tiền điều kiện / dữ liệu mồi:** Hai backend Java chung Redis/DB; B WS ở instance #2, A HTTP POST vào #1.
- **Cách tạo cạnh tranh hoặc sự cố:** A gửi tin; B đợi NEW_MESSAGE; kiểm tra DB.
- **Điều kiện PASS — oracle:** Event được chuyển tới đúng WS ở #2; không nhân đôi sự kiện, không cần sticky HTTP vào #2.
- **Bằng chứng phải thu:** Instance logs, Redis pubsub, recipient event.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-MULTI-002 — Client reconnect qua instance khác [P1]

- **Tiền điều kiện / dữ liệu mồi:** B WS #1, sau đó reconnect #2; Redis/DB chung.
- **Cách tạo cạnh tranh hoặc sự cố:** Gửi tin khi chuyển tiếp, rồi gửi tin mới trên #2.
- **Điều kiện PASS — oracle:** Không còn stale registry #1; history DB cho phép phục hồi tin trong khoảng chuyển; tin mới đến #2.
- **Bằng chứng phải thu:** Both registry sizes, DB, events.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-MULTI-003 — Video finalize qua hai Java instances [P1]

- **Tiền điều kiện / dữ liệu mồi:** Hai instance dùng chung Redis lock/DB/MinIO.
- **Cách tạo cạnh tranh hoặc sự cố:** Cùng video, bắn finalize qua #1/#2 đồng thời.
- **Điều kiện PASS — oracle:** Distributed lock bảo toàn terminal state; không double-complete/charge.
- **Bằng chứng phải thu:** Lease owner, SQL, MinIO and instance logs.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-MULTI-004 — Scheduled cleanup jobs chạy ở cả hai instances [P1]

- **Tiền điều kiện / dữ liệu mồi:** Hai Java instances đều có scheduler enabled.
- **Cách tạo cạnh tranh hoặc sự cố:** Tạo một cleanup job đến hạn; đồng thời cho hai scheduler chạy.
- **Điều kiện PASS — oracle:** Chỉ một logical cleanup thành công; retry job row không hỏng do double worker; nếu thiếu lease/dedup ghi gap.
- **Bằng chứng phải thu:** Jobs DB, object deletes, logs each instance.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-MULTI-005 — Signaling A và B nằm hai Node instances [P1]

- **Tiền điều kiện / dữ liệu mồi:** Node signaling state hiện trong Map process theo báo cáo.
- **Cách tạo cạnh tranh hoặc sự cố:** Route A tới #1, B tới #2, A CALL_OFFER.
- **Điều kiện PASS — oracle:** Nếu chưa có distributed routing, xác nhận không hoạt động và ghi giới hạn scale; không ép PASS như đã support multi instance.
- **Bằng chứng phải thu:** Node maps, offer response, routing config.
- **Phục hồi / dọn dữ liệu:** Tùy chọn nghiên cứu, không block kết luận capacity một instance.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-MULTI-006 — Một Node signaling instance chết giữa cuộc gọi [P2]

- **Tiền điều kiện / dữ liệu mồi:** A/#1, B/#2 nếu lab có routing hợp lệ.
- **Cách tạo cạnh tranh hoặc sự cố:** Kill #1 khi call active; quan sát state ở #2 và reconnect.
- **Điều kiện PASS — oracle:** Phục hồi hoặc fail-closed theo hợp đồng phân tán; không để ghost session vô hạn.
- **Bằng chứng phải thu:** Node service states, events, reconnection.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-MULTI-007 — Load balancer không đưa WebSocket tới instance chết [P2]

- **Tiền điều kiện / dữ liệu mồi:** Hai Spring instances sau reverse proxy với health checks.
- **Cách tạo cạnh tranh hoặc sự cố:** Kill #1, reconnect B qua proxy; gửi tin.
- **Điều kiện PASS — oracle:** Proxy route sang #2 sau timeout/health behavior; không mất dữ liệu DB; không đóng sai socket khỏe.
- **Bằng chứng phải thu:** Proxy logs, upstream routing, events.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-MULTI-008 — Session tokens giữa nhiều backend instances [P2]

- **Tiền điều kiện / dữ liệu mồi:** A login instance #1, gọi API instance #2.
- **Cách tạo cạnh tranh hoặc sự cố:** Dùng cùng access token, sau logout #1 gọi #2 và WS.
- **Điều kiện PASS — oracle:** Xác thực nhất quán nhờ cùng key/revocation store; không mở quyền sau revoke.
- **Bằng chứng phải thu:** HTTP/WS, Redis revocation, instance config.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

### 4.14. OBS — Bằng chứng, tính lặp lại và ngưỡng vào T08

**Mục tiêu:** Xác minh runner, thời gian chờ, oracle, detection of intermittent races và quản lý artefact để số liệu T08 có ý nghĩa.
**Cơ sở thiết kế:** `backend.test.cjs` hiện có, `run.cjs` chưa được đọc; `docs/10_PERFORMANCE.md` cần đối chiếu.
**Fixture nền:** Run_id, commit, thời gian tương đối, logs ba dịch vụ, trạng thái DB/Redis/MinIO, báo cáo JSON/JUnit.

#### T07-OBS-001 — Mỗi test có oracle trạng thái cuối [P0]

- **Tiền điều kiện / dữ liệu mồi:** Chọn mỗi luồng auth, message, video, call tối thiểu một case.
- **Cách tạo cạnh tranh hoặc sự cố:** Kiểm tra kịch bản có định nghĩa DB/Redis/MinIO/WS expected và actual.
- **Điều kiện PASS — oracle:** Không PASS chỉ dựa status HTTP; các invariant quan trọng đều có assertion bằng chứng.
- **Bằng chứng phải thu:** Audit sample reports + backing state.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-OBS-002 — Phân loại lỗi product/test/environment/contract [P0]

- **Tiền điều kiện / dữ liệu mồi:** Cố tình chạy fixture sai, dependency down và sản phẩm vi phạm assertion riêng.
- **Cách tạo cạnh tranh hoặc sự cố:** Xem report giữ trạng thái khác nhau, không gom tất cả thành FAIL_PRODUCT.
- **Điều kiện PASS — oracle:** Chỉ FAIL_PRODUCT khi có yêu cầu được xác minh và chứng cứ đủ; NEEDS_CONTRACT cho yêu cầu chưa chốt.
- **Bằng chứng phải thu:** Reason codes, logs, contract links.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-OBS-003 — Phát hiện và chặn false PASS do thiếu event [P0]

- **Tiền điều kiện / dữ liệu mồi:** Tạo tình huống HTTP thành công nhưng WS không nhận khi Redis bị chặn.
- **Cách tạo cạnh tranh hoặc sự cố:** Chạy script E2E và kiểm tra assertion event với deadline.
- **Điều kiện PASS — oracle:** Không PASS chỉ vì có DB row; ghi chức năng realtime suy giảm và giới hạn Pub/Sub.
- **Bằng chứng phải thu:** HTTP, DB, WS, timeout correlation.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-OBS-004 — Evidence timeline bằng monotonic clock [P1]

- **Tiền điều kiện / dữ liệu mồi:** Có events cùng một host process và các server khác nhau.
- **Cách tạo cạnh tranh hoặc sự cố:** Ghi monotonic intervals của client, các mốc server theo riêng đồng hồ; không trừ timestamps lệch đồng hồ trực tiếp.
- **Điều kiện PASS — oracle:** Timeline tin cậy, nhận biết clock skew, không báo latency sai dấu/âm.
- **Bằng chứng phải thu:** Monotonic deltas, server timestamps, NTP status.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-OBS-005 — Test race lặp nhiều vòng có cùng seed [P1]

- **Tiền điều kiện / dữ liệu mồi:** Chọn 3 case concurrency có barrier, baseline DB sạch.
- **Cách tạo cạnh tranh hoặc sự cố:** Chạy 10–30 vòng theo seed, ghi từng interleaving và kết quả.
- **Điều kiện PASS — oracle:** Kết luận thống kê theo số vòng; một lần PASS không đóng bug race; các lần FAIL có seed/timeline tái lập.
- **Bằng chứng phải thu:** Seed/run IDs, outcomes, DB snapshots.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-OBS-006 — Fault injection có điểm đặt chính xác [P1]

- **Tiền điều kiện / dữ liệu mồi:** Chọn lỗi sau DB commit trước Redis publish.
- **Cách tạo cạnh tranh hoặc sự cố:** Chèn fault proxy/hook, xác nhận bằng trace rằng fault thực sự trúng điểm mục tiêu.
- **Điều kiện PASS — oracle:** Không kết luận thuộc code khi fault không tác động đúng đường; log chứng minh window kích hoạt.
- **Bằng chứng phải thu:** Fault activation log, request trace.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-OBS-007 — Không rò secret qua artifact fault log [P1]

- **Tiền điều kiện / dữ liệu mồi:** Test có JWT, Redis auth, presigned URL.
- **Cách tạo cạnh tranh hoặc sự cố:** Chạy suite, grep artifact cho token, signed query, password; mask before archival.
- **Điều kiện PASS — oracle:** Không lưu secret đầy đủ trong JUnit, stdout, screenshot, logs thu thập.
- **Bằng chứng phải thu:** Redaction audit, sanitized artifact sample.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-OBS-008 — Không có resource drift sau suite [P1]

- **Tiền điều kiện / dữ liệu mồi:** Chạy toàn T07 subset có lỗi; snapshot resources trước/sau.
- **Cách tạo cạnh tranh hoặc sự cố:** Kiểm tra DB rows fixture, Redis keys, multipart object/uploads, port, process và scheduler threads.
- **Điều kiện PASS — oracle:** Không còn tài nguyên test vô chủ theo run_id; orphan được ghi và dọn tường minh, không giấu leak.
- **Bằng chứng phải thu:** Before/after inventory, cleanup receipts.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-OBS-009 — Tạo báo cáo giới hạn đã biết cho T08 [P1]

- **Tiền điều kiện / dữ liệu mồi:** T04/T05/T06/T07 đã có kết quả theo module, một số case có thể blocked.
- **Cách tạo cạnh tranh hoặc sự cố:** Tổng hợp defect list, reliability contract, test environment reproducibility, timeout policies.
- **Điều kiện PASS — oracle:** Chỉ benchmark những luồng có correctness và data hygiene đủ; cảnh báo rõ lỗ hổng realtime/video ảnh hưởng diễn giải load.
- **Bằng chứng phải thu:** Go/no-go checklist, linked test IDs.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

#### T07-OBS-010 — Đối chiếu kết quả E09/E10 lịch sử [P2]

- **Tiền điều kiện / dữ liệu mồi:** Hai lỗi E2E đã được ghi FAIL lịch sử, chưa có chạy mới.
- **Cách tạo cạnh tranh hoặc sự cố:** Sau khi sửa, chạy E09/E10 + T07 regression tương ứng với môi trường sạch; lưu cả lịch sử.
- **Điều kiện PASS — oracle:** Không xóa lỗi lịch sử; có bằng chứng FAIL→PASS và không hồi quy các luồng khác.
- **Bằng chứng phải thu:** Old/new run IDs, diff traces, source commits.
- **Phục hồi / dọn dữ liệu:** Dọn fixture theo run_id; xác minh không còn tác dụng phụ sau khi test kết thúc.
- **Trạng thái ban đầu:** `NOT_RUN`. **Liên quan:** T04/T05/T06 theo module; T08 chỉ đo định lượng sau khi đúng chức năng.

---
## 5. Ba kịch bản mẫu diễn giải sâu để thực hiện đúng

### Mẫu A — T07-TX-004: Commit PostgreSQL thành công, Redis publish thất bại

**Tại sao quan trọng:** Ở VeilTalk, sau khi message mới được ghi và transaction commit, `afterCommit()` gọi Redis Publisher. Đây là **hai hệ thống độc lập**. Nếu Redis lỗi ở thời điểm đó, việc đã commit trong PostgreSQL không thể bị “undo” bởi Redis.

**Thiết lập:** Tạo A/B và conversation; B mở socket và lưu `before_rows`; bật instrumentation log ba mốc `DB_COMMIT`, `PUBLISH_ATTEMPT`, `WS_DELIVERED` với UUID duy nhất. Fault chỉ tác động lên đường publish sau khi DB commit; không tắt toàn bộ DB.

**Trình tự:** (1) A POST một UUID mới; (2) gate cho transaction commit xong; (3) ép publisher lỗi/timeout; (4) ghi HTTP outcome; (5) query DB message row và `GET history`; (6) kiểm tra inbox B, ghi nhận không có event trong bounded window; (7) phục hồi Redis; (8) đọc history/reconnect; (9) gửi UUID mới để xác minh hệ thống tiếp tục.

**PASS bắt buộc:** Tin đã commit tồn tại đúng một lần trong DB và GET history; không có row ma; nếu WS mất thông báo thì tài liệu phải ghi đây là giới hạn Redis Pub/Sub chứ không tự hứa replay. HTTP success/failure phải theo hợp đồng khi publish lỗi. **Nếu contract đòi realtime durable**, hệ thống hiện có phải có cơ chế khác ngoài Pub/Sub, nếu không nên ghi `KNOWN_GAP`/FAIL sau khi chốt yêu cầu.

**Không nên kiểm thử sai:** Không bắn 1000 request để “làm Redis lỗi”; không chứng minh “không có event” chỉ vì chờ 1 giây; không bỏ qua việc đã commit trong DB khi assertion HTTP timeout.

### Mẫu B — T07-VID-001: Hai finalize đồng thời cùng một video

**Tại sao quan trọng:** Finalize là chuỗi công việc liên quan đến quota, Redis lock, phiên upload, MinIO CompleteMultipart và webhook. Hai request có thể cùng nhận thấy video chưa hoàn thành nếu không có cơ chế kiểm soát.

**Thiết lập:** Video RECORDING, hai part được PUT thành công, ETag đã lưu đúng, A có đủ quota, DB status/MinIO inventory đã snapshot. Có barrier ở thời điểm hai request chuẩn bị acquire `video:operation-lock:{id}`; một request có thể bị giữ tại gateway MinIO để tạo xung đột có kiểm soát.

**Trình tự:** (1) khởi tạo hai finalize request có cùng uploadId và parts; (2) release barrier; (3) thu status và body từng request; (4) quan sát lock token và tiến trình CompleteMultipart; (5) polling webhook tới trạng thái terminal trong timeout; (6) kiểm tra Redis upload session đã bị xóa; (7) tải bytes và kiểm tra SHA-256; (8) rà quota/storage used.

**PASS bắt buộc:** Chỉ một kết quả hoàn tất logic, chỉ một object đúng bytes, metadata terminal nhất quán, quota không double count, session không rò rỉ; request thứ hai có thể nhận lỗi conflict/retry phù hợp contract. Không bắt buộc cả hai request trả 200/202.

**Nếu FAIL:** Phân tích từng mốc thời gian lock acquire → Redis session read → MinIO Complete → transaction DB → webhook. Đặc biệt xem có **lease hết hạn khi I/O kéo dài** hay không, thay vì sửa assertion cho phép mọi outcome.

### Mẫu C — T07-CALL-001: Người nhận vào signaling muộn

**Bằng chứng lịch sử:** E09 FAIL vì B nhận CALL_INCOMING trong messaging nhưng mở signaling sau đó không nhận CALL_OFFER của lần gọi đầu. Mẫu này là bài test hồi quy, không phải một bug mới được xác minh lại hôm nay.

**Thiết lập:** A và B đăng nhập thật; B chỉ giữ `/ws/messaging`; A giữ `/ws/signaling`. Có correlation call ID nếu protocol hỗ trợ hoặc correlation cặp sender/receiver/timestamp trong lab.

**Trình tự:** (1) A gửi OFFER; (2) xác nhận B nhận CALL_INCOMING; (3) B mở signaling trong thời gian người dùng chấp nhận; (4) quan sát pending state và offer delivery; (5) B trả ANSWER; (6) A và B trao đổi ICE giả và END; (7) đóng sockets và kiểm tra pending Map được dọn.

**PASS bắt buộc:** B nhận offer hoặc hoàn thành luồng thay thế đã được hợp đồng hóa **không cần A bấm gọi lại**; offer không được chuyển sang user khác; session/timer được dọn. Nếu policy chưa có khoảng thời gian chờ, chốt contract trước khi viết assert về deadline.

---
## 6. Ma trận lỗi và cách tiêm lỗi an toàn

| Loại lỗi | Điểm kích hoạt khả thi trong lab | Quan sát | Bẫy cần tránh |
|---|---|---|---|
| `DB_FAIL_BEFORE_COMMIT` | DB proxy/test transaction hook ngay trước commit | Row rollback, không publish | Không suy đoán rollback nếu timeout nằm *sau* commit |
| `REDIS_FAIL_AFTER_COMMIT` | Chặn Redis publisher khi afterCommit thực thi | Row bền vững, event có thể mất | Tắt toàn Redis quá sớm khiến auth fail trước vào Service |
| `REDIS_SUBSCRIBER_DROP` | Ngắt đúng subscriber connection | WS delivery, reconnect | Redis Pub/Sub không lưu lịch sử để tự replay |
| `MINIO_COMPLETE_AMBIGUOUS` | Cắt response sau CompleteMultipart trên MinIO | DB/MinIO reconciliation | Không retry mù vì server có thể đã complete |
| `LOCK_LEASE_EXPIRY` | Chặn renewal, giữ I/O đủ vượt TTL lab | Lock owner, stale writes | Test Lua release đúng chưa đủ chứng minh không double-write |
| `WS_SLOW_READER` | Hạn chế đọc từ một WebSocket client | Socket buffer, healthy peer | Không gửi payload vô hạn gây OOM máy test |
| `NODE_CRASH` | Kill đúng Node child process của run | Pending call, reconnect | Không mong Map local vẫn bền nếu chưa có persistence |
| `BACKEND_CRASH` | Kill đúng Java child process | DB commit, cleanup jobs, reconnect | Không giết PostgreSQL/Redis/MinIO cùng lúc trừ khi case yêu cầu |
| `MINIO_WEBHOOK_DELAY` | Delay webhook test có correlation | READY/PROCESSING state | Không giả định `finalize` HTTP success tương đương video READY |
| `HIKARI_POOL_WAIT` | Giữ connections lab theo cấu hình test | Pending, timeouts, recovery | Không dùng tải khổng lồ để làm cạn pool trong máy dùng chung |

**Quan trọng:** Không nhất thiết phải có mọi fault hook ngay. Nếu công cụ chưa cho phép tiêm lỗi tại checkpoint, ghi `BLOCKED — insufficient fault control`, không thay bằng `sleep` tùy tiện và tuyên bố đã kiểm chứng race.

## 7. Bản đồ thứ tự triển khai — 6 đợt

| Đợt | Nội dung | Mục tiêu hoàn thành | Điều kiện chuyển đợt |
|---|---|---|---|
| 0 | Chuẩn hóa harness và dữ liệu test (`ENV`, `OBS`) | Cô lập run, barrier, trace/cleanup, phân loại lỗi | Chạy thử một fault an toàn và dọn sạch |
| 1 | Data consistency (`CONV`, `MSG`, `TX`, `AUTH`) | Idempotency, uniqueness, status, commit boundary | P0 có oracle DB/WS/Redis rõ ràng |
| 2 | Realtime (`PUB`, `WS`, `CALL`) | Loss/reconnect/heartbeat/call state dưới race | Các hành vi mong muốn E09/E10 được đối chiếu và xử lý |
| 3 | Storage & locking (`VID`, `LOCK`) | Multipart/quota/lock/lease/webhook | Không có dữ liệu terminal mâu thuẫn hoặc orphan chưa xử lý |
| 4 | Faults & recovery (`FAIL`, `REC`) | Dependency outage, restart, cleanup/retry | Khôi phục được, không còn silent inconsistency cấp P0 |
| 5 | Mở rộng tùy chọn (`MULTI`) + tổng hợp (`OBS`) | Chỉ chạy nếu cần nhiều instance trong khóa luận | Có báo cáo rõ **single instance** vs **multi-instance** |

### 7.1. 25 case nên làm trước nhất

| Ưu tiên chạy | ID | Nội dung |
|---:|---|---|
| 1 | `T07-ENV-001` | Chỉ thao tác lên container của run hiện tại |
| 2 | `T07-ENV-002` | Dọn dịch vụ sau PASS |
| 3 | `T07-ENV-003` | Dọn sau FAIL assertion |
| 4 | `T07-OBS-001` | Mỗi test có oracle trạng thái cuối |
| 5 | `T07-AUTH-003` | Logout và mở signaling WebSocket cùng thời điểm |
| 6 | `T07-AUTH-004` | Hai refresh đồng thời trên cùng một refresh token |
| 7 | `T07-CONV-001` | A và B cùng tạo hội thoại A–B |
| 8 | `T07-MSG-001` | Bốn request giống nhau cùng UUID — regression E05 |
| 9 | `T07-MSG-003` | Cùng UUID nhưng người gửi khác |
| 10 | `T07-MSG-005` | Retry sau mất response HTTP nhưng DB đã commit |
| 11 | `T07-MSG-009` | Update read và delivered đồng thời |
| 12 | `T07-TX-001` | Không phát NEW_MESSAGE trước DB commit |
| 13 | `T07-TX-002` | Rollback INSERT không phát event |
| 14 | `T07-TX-004` | DB commit thành công nhưng Redis publish lỗi |
| 15 | `T07-PUB-001` | Gửi tin khi Redis Pub/Sub tạm mất |
| 16 | `T07-PUB-002` | Subscriber mất kết nối khi publish |
| 17 | `T07-WS-001` | Đóng một trong nhiều socket không xóa socket khác |
| 18 | `T07-WS-004` | Slow consumer vượt giới hạn buffer |
| 19 | `T07-CALL-001` | Người nhận signaling muộn — regression E09 |
| 20 | `T07-CALL-002` | Logout token vẫn mở signaling — regression E10 |
| 21 | `T07-VID-001` | Hai finalize đồng thời trên cùng upload |
| 22 | `T07-VID-002` | Finalize và abort đồng thời cùng video |
| 23 | `T07-VID-006` | Webhook Complete đến 2 lần giống nhau |
| 24 | `T07-VID-010` | Khởi tạo video concurrent gần quota |
| 25 | `T07-LOCK-004` | Mất lock renewal giữa thao tác dài |

**Đặc biệt:** Case E09/E10 cũ xuất hiện dưới `T07-CALL-001/002` (race/session consistency), đồng thời nằm ở T05/T06 theo mục tiêu. Không có nghĩa phải tạo 3 bản code giống nhau; dùng chung implementation, gắn **nhiều nhãn yêu cầu** và phân loại báo cáo.

### 7.2. Mẫu checklist để tự triển khai từng case

```text
Test ID: T07-...
Source version / commit: ...
Contract version / assumption: ...
Run ID / scenario seed / iteration: ...
Given: fixture, SQL state, Redis state, MinIO state, WS state
Barrier / fault point: tên gate, bước chặn, cách chứng minh gate đã hit
When: thao tác đồng thời, trình tự có kiểm soát, giới hạn thời gian
Then — API/events: ...
Then — DB: ...
Then — Redis / MinIO / socket / scheduler: ...
Recovery and cleanup: ...
Evidence artifacts: JUnit, run.json, request IDs, SQL snapshot, redacted logs
Outcome: NOT_RUN / PASS / FAIL_PRODUCT / FAIL_TEST / FAIL_ENV / BLOCKED / NEEDS_CONTRACT
Reason and next action: ...
```

## 8. Yêu cầu instrumentation tối thiểu — không phải yêu cầu sửa code sản phẩm ngay

Nếu chỉ có status HTTP, bạn sẽ không thể xác nhận fault hit sau commit hay trước commit. Nên có cách quan sát **có kiểm soát** cho các mốc: `HTTP_ACCEPT`, `AUTH_OK`, `TX_BEGIN`, `DB_INSERT`, `TX_COMMIT`, `AFTER_COMMIT`, `REDIS_PUBLISH`, `WS_SEND`, `MINIO_MULTIPART_CREATE`, `REDIS_SESSION_CREATE`, `MINIO_COMPLETE`, `WEBHOOK_RECEIVED`, `VIDEO_READY`, `LOCK_ACQUIRE`, `LOCK_RENEW`, `LOCK_RELEASE`, `CLEANUP_RETRY`. Các tên là nhãn đề xuất cho trace test, không khẳng định source hiện nay đã phát đủ mốc.

Nếu phải bổ sung test-only observability, cô lập bằng profile/container lab, tránh để test hook mở trong production. Không ghi JWT, password, presigned query signature, storage secret hoặc payload nhạy cảm vào log. Correlation nên dựa vào ID không bí mật + run_id; đồng hồ giữa nhiều host phải đồng bộ hoặc giữ phép đo latency trong cùng time domain.

**Bộ chỉ số quan sát phụ trợ:** JVM thread count, Hikari active/idle/pending, PG `pg_stat_activity` và locks, Redis connected clients/command errors/key TTL, MinIO multipart/object count, WS live session count/send buffer/close codes, Node pending call count, cleanup job attempts. Ở T07 chúng giúp giải thích **đúng/sai và phục hồi**, không phải để kết luận req/s chịu tải như T08.

## 9. Exit criteria và điều kiện chuyển sang T08

1. Toàn bộ P0 **thuộc phạm vi triển khai single instance và các flow sẽ benchmark** phải `PASS` hoặc có quyết định chính thức loại khỏi phạm vi cùng rủi ro được nêu rõ. `FAIL_PRODUCT`, `BLOCKED` quan trọng, `NEEDS_CONTRACT` liên quan dữ liệu hoặc phiên không thể bị đánh dấu đạt.
2. P1 được phân loại minh bạch: đã PASS, defect đang sửa, accepted limitation có lý do hoặc deferred với thời hạn; không dùng tỷ lệ PASS gộp che lỗi mất dữ liệu.
3. Các kịch bản fault injection có bằng chứng đã kích hoạt đúng checkpoint; trạng thái sau phục hồi khớp oracle DB/Redis/MinIO/WS, không chỉ HTTP status.
4. E09/E10 lịch sử được sửa/đối chiếu bằng regression không thay đổi kỳ vọng để “xanh”.
5. Suite chạy lại được trên dữ liệu test, có cleanup, không gây rò rỉ upload sessions/lock/jobs đáng kể ngoài giới hạn chấp nhận đã ghi.
6. Kết luận **backend một instance** có thể đạt dù nhóm `MULTI` chưa thực hiện. Với WebRTC media thật, phải có báo cáo độc lập, không suy từ signaling-only tests.
7. Nếu cần benchmark gấp, có thể bắt đầu **T08 có điều kiện** cho một API đọc đã PASS T04/T05, không có defect critical liên quan; không cần chờ xong toàn bộ các test P2 hay multi-instance. Ghi rõ những luồng chưa đủ điều kiện đo.

## 10. Danh sách thông tin cần xác minh trước khi khóa expected ở môi trường hiện hành

| Thành phần | Cần đối chiếu | Tác động |
|---|---|---|
| `signaling/src` | Call state machine, Map lifecycle, lỗi offline, timeout, token revoke | `CALL`, `AUTH`, `MULTI` |
| `docs/04_API.md` | Status/response khi retry/finalize/abort/offline call | `CALL`, `VID`, `MSG` |
| `application.yml`/runtime env | JDBC pool timeout, WS heartbeat, lock TTL, upload timeout, quota | `WS`, `LOCK`, `FAIL`, `VID` |
| Flyway SQL | Unique constraint conversation pair, message ID, indexes, cleanup job schema | `CONV`, `MSG`, `REC` |
| MinIO notification config | Event delivery/retry, bucket lifecycle multipart expiration | `VID`, `TX`, `REC` |
| `scripts/e2e/run.cjs` | Fault control, Docker isolation, labels, cleanup on crash | `ENV`, `OBS` |
| Nginx / load balancing | HTTP vs WebSocket routing, multi-instance | `MULTI` (tùy chọn) |

## 11. Kết luận phạm vi bảo đảm của T07

Một kết quả T07 tốt không chứng minh “server chịu được 50 VU” hoặc “p95 thấp”. Nó chứng minh rằng **trong các tình huống race và lỗi đã kích hoạt được**, backend duy trì các bất biến quan trọng hoặc có cơ chế thất bại/phục hồi đã được thiết kế và xác nhận. Khi các flow đúng chức năng, test harness tái lập và dữ liệu sạch, chúng ta mới có nền tảng để **T08/k6 đo định lượng** mà không bị đánh lừa bởi tin nhắn không được lưu, upload chưa hoàn tất hoặc thông báo bị mất.

---
**Kiểm toán số lượng:** 178 case ID duy nhất, 14 nhóm; P0=64, P1=91, P2=23. Tất cả đang `NOT_RUN` và là bản thiết kế cần đối chiếu source hiện hành.
