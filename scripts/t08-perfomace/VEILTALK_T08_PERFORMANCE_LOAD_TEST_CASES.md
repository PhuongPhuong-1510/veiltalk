# VEILTALK — T08: PERFORMANCE, LOAD, STRESS & SCALABILITY TESTING
## MASTER TEST CASE SPECIFICATION — CHỈ KỊCH BẢN, KHÔNG CHỨA SCRIPT k6

> **Mục đích:** Bộ đặc tả kịch bản để người thực hiện **tự viết và chạy** k6/WS tools; không triển khai script, không chỉnh backend, không chạy benchmark và chưa có số đo thực tế. Trạng thái mặc định toàn bộ T08: `PROPOSED / NOT_RUN`.
>
> **Phiên bản:** 1.0 — 19/10/2026. **Tổng số:** 197 case, 14 nhóm; P0 94, P1 94, P2 9.
>
> **Giới hạn bằng chứng:** Kịch bản dựa trên snapshot 137 file Java trong `veiltalk.zip` và tài liệu T04/T05/T06/T07, cùng báo cáo E2E ngày 19/10/2026. Chưa có trong nguồn hiện tại: `docs/10_PERFORMANCE.md` thực tế, cấu hình runtime, Docker/Compose, Flyway migrations, `signaling/src` hiện hành, HTTP proxy. Các mục thuộc Node signaling và thông số SLO/timeout phải đối chiếu lại. **Không tự gán mức p95/ms để chấm PASS.**

---
## 1. Phạm vi, mục tiêu và sự khác nhau với T04–T07

**T08 trả lời:** Trong một workload được mô tả và tái lập được, backend hoàn thành bao nhiêu thao tác đúng/giây, thời gian phản hồi p95/p99 là bao nhiêu, tỷ lệ lỗi ra sao, tài nguyên nào giới hạn, có ổn định theo thời gian và hồi phục sau khi tải giảm hay không?

| Bộ | Câu hỏi | Trọng tâm |
|---|---|---|
| T04 | Một request/response có đúng API contract không? | Schema, validation, HTTP status |
| T05 | Một hành trình có chạy đúng từ đầu đến cuối không? | HTTP→DB→Redis/WS/MinIO/signaling |
| T06 | Có vượt quyền, giả mạo, rò rỉ dữ liệu được không? | Threat/security boundaries |
| T07 | Khi race hoặc sự cố xảy ra, có đúng và phục hồi được không? | Race, transaction, fault injection |
| **T08** | Ở mức tải nào hệ thống còn nhanh, đúng và ổn định? | Latency, throughput, errors, saturation, resource use |

T08 **không** chứng minh media WebRTC, avatar webcam, mã hóa TLS hoặc người dùng thật đang hài lòng. WebSocket signaling relay với SDP giả không phải cuộc gọi có audio/video. Thông lượng MinIO PUT/GET khác hẳn throughput xử lý metadata của Spring Boot.

### 1.1. Nguyên tắc quyết định PASS / FAIL / INCONCLUSIVE

1. **PASS_SLO:** Có ngưỡng đã được chốt từ nguồn yêu cầu/hợp đồng và tất cả điều kiện latency, successful operations, lỗi, correctness cùng tài nguyên trong giới hạn đều thỏa.
2. **FAIL_SLO:** Ngưỡng hợp lệ bị vi phạm ở run hợp lệ; phải dẫn run_id và dữ liệu đo.
3. **NEEDS_SLO:** Chưa có ngưỡng theo nguồn, vẫn báo số đo nhưng không tự tuyên bố đạt/chưa đạt. Đặc biệt: sáu API trong `docs/10_PERFORMANCE.md` cần được cung cấp rồi ánh xạ nguyên văn.
4. **FAIL_PRODUCT:** Dữ liệu mất/ghi trùng, quyền truy cập sai, message bị lẫn user, upload còn rác ngoài policy — dù số ms đẹp cũng FAIL.
5. **FAIL_TEST / FAIL_ENV / INVALID_GENERATOR:** Script tạo UUID sai/timestamp hết hạn, dữ liệu mồi không đủ, Docker lỗi, máy k6 quá tải, dropped iterations quá nhiều. Không dùng run này kết luận backend.
6. **INCONCLUSIVE:** Mẫu p99 quá ít, nhiều biến thay đổi, 3 run lệch quá lớn hoặc thiếu quan sát đủ để phân biệt bottleneck.
7. **BLOCKED:** Luồng phụ thuộc E09/E10 hoặc cơ chế cleanup/contract chưa được xử lý. Có thể đo chẩn đoán riêng nhưng không nghiệm thu.

### 1.2. P0 / P1 / P2

- **P0:** Cần cho một kết luận hiệu năng backend chính đáng tin cậy và có thể bảo vệ trong đồ án (các API core, nhắn tin realtime, môi trường, observability, độ đúng).
- **P1:** Các biến thể cần để hiểu tính ổn định, khả năng mở rộng, điều kiện vận hành và xác định nguyên nhân điểm nghẽn.
- **P2:** Mở rộng/bài thăm dò tùy thời gian và hạ tầng, không lấy làm lý do chặn benchmark MVP.

## 2. Nguồn kỹ thuật trong source Java và các điểm phải kiểm chứng trước khi chạy

| Luồng | Bằng chứng snapshot | Hệ quả với performance script |
|---|---|---|
| Gửi tin | `messaging/ConversationController.java:63–74`, `MessageService.java:65–105` | `POST /conversations/{id}/messages` với UUID mới mỗi tin, timestamp ISO hiện hành; 201 là tin tạo mới, 200 có thể là retry idempotent |
| Lịch sử | `ConversationController.java:77–86`, `MessageService.java:108–144` | `GET /conversations/{id}/messages?limit=30`, có cursor; phải seed đúng 20/100/10k tin để so phân trang |
| Danh sách hội thoại | `ConversationController.java:43–51`, `ConversationService.java:70–108` | `GET /conversations?limit=20`, phân trang cursor; seed nhiều user/conv thay vì chỉ tài khoản trắng |
| Tìm kiếm người dùng | `user/UserProfileController.java:66–80`, `user/UserSearchRequest.java` | `POST /users/search` với JSON `{email}`; route có Redis rate limiting; không phải GET |
| Token | `auth/JwtAuthenticationFilter.java`, `auth/AuthService.java` | JWT + Redis revocation có thể tác động mọi route protected; login dùng BCrypt và ghi refresh token |
| Realtime | `messaging/MessagingRedisSubscriber.java`, `WebSocketKeepAliveScheduler.java` | Redis Pub/Sub → WebSocket; đo HTTP POST và delay A→B tách biệt; PING cần PONG |
| Video | `video/VideoController.java:63–102`, `VideoService.java`, `MinioMultipartStorage.java` | `POST /videos` khởi tạo, PUT bytes đến MinIO trực tiếp, `POST /finalize` trả 202 rồi webhook tạo READY |
| Khóa/cleanup | `video/RedisDistributedLock.java`, `VideoTimeoutCleanupJob.java` | Tải video có thể giữ Redis locks; phải quản lý orphan multipart trước stress/soak |
| Node signaling | Báo cáo E2E E08/E09/E10, chưa có source Node hiện hành | E09 late-join và E10 revoked token từng FAIL, chặn kết luận nghiệm thu CALL và SECURITY đến khi sửa |

**Đặc biệt:** 6 API cùng threshold gốc từ `docs/10_PERFORMANCE.md` phải trích nguyên bản rồi ánh xạ với T08. Không giả định tài liệu đó có p99/WS/SLO, vì chúng có thể chỉ là các chỉ tiêu thăm dò bổ sung.

## 3. Từ điển phép đo bắt buộc

| Thuật ngữ | Định nghĩa vận hành | Sai lầm phải tránh |
|---|---|---|
| VU (Virtual User) | Một thực thể thực thi workload trong k6 | 50 VU không nhất thiết là 50 RPS hay 50 request đồng thời |
| Offered rate | Tốc độ yêu cầu/iteration generator dự định khởi phát | Offered không đồng nghĩa served; phải đo `dropped_iterations` |
| RPS/throughput | Số HTTP requests hoàn thành trong 1 giây | HTTP requests khác với số messages mới được commit hoặc calls thành công |
| Valid business ops/s | Thao tác đúng nghiệp vụ hoàn tất/giây (new messages, delivered messages, ready videos) | 200 idempotent retry không phải created message |
| p50/p95/p99 | Các phân vị latency trên tập mẫu cùng loại | Gộp endpoint hoặc báo p99 với quá ít sample làm sai nghĩa |
| Error rate | Network, 5xx, timeout và lỗi check/schema/business; 429 theo policy báo riêng | Không coi mọi non-2xx là server performance bug; cũng không giấu HTTP 200 body sai |
| Soak | Tải ổn định trong khoảng dài để phát hiện drift/leak | Không giống spike; cần token rotation và quota dữ liệu |
| Spike | Bước nhảy offered load trong khoảng ngắn | Phải đo recovery sau spike |
| Capacity (có điều kiện) | Tốc độ hoàn thành đúng cao nhất **đã được thử** và đạt SLO dưới workload/hardware/dataset cụ thể | Không tuyên bố công suất production tổng quát |
| WS active | Kết nối đã auth và vẫn đáp ứng heartbeat | `open` thành công không đủ chứng minh socket còn hữu dụng |
| Delivery latency | Khoảng từ mốc gửi tin đã định đến event tương quan xuất hiện ở receiver | Không trừ timestamp từ các máy chưa đồng bộ |

**Little’s Law (tham khảo):** Với hệ ổn định, `L = λ × W` liên hệ số việc đang tồn tại, throughput và thời gian trong hệ. Dùng để kiểm tra tính hợp lý, không thay phép đo. **Closed model** giữ số VU, có thể giảm offered rate khi server chậm; **open model** đặt arrival rate, cần theo dõi dropped iterations và generator headroom. Hai loại phải được báo riêng.

## 4. Mẫu fixture, workload và điều kiện an toàn

| Fixture | Giá trị tối thiểu/tùy chọn | Quy tắc |
|---|---|---|
| Account | 50–200 tài khoản test độc lập nếu khả năng seed cho phép | Token hợp lệ; reset sau run; user thật không nằm trong test |
| Conversation | N pairs A–B, mỗi pair có conversation riêng; thêm hotspot cohort | Ghi tỷ lệ hotspot vs distributed |
| Messages | Small 20, medium 100, large 10.000+ tin/hội thoại với budget | UUID mới và timestamp hiện hành cho WRITE, fixed snapshot cho READ |
| Avatar | Có model catalog thực tế và profile đã lưu | Phân biệt route cache/in-memory và route DB |
| Video | 2 multipart parts, first ≥5 MiB, last part nhỏ; upload bytes định danh SHA-256 | Cần endpoint MinIO và webhook thật; abort/delete/cleanup cuối test |
| WS | Người nhận kết nối, trả PONG; các socket có correlation UUID | Không chia token cho sai user; tách active/attempts |
| Call | A/B có signaling, SDP/ICE payload giả đúng contract | Chỉ kiểm tra relay/state; không đánh giá codec/media |
| Load | `1 → 5 → 10 → 20 → 50 VU` ban đầu; fixed-RPS exploratory riêng | Mỗi bậc có warm-up, steady state, cooldown, time budget |
| Network | Ghi generator/server topology, RTT, DNS/proxy/TLS, NAT | Không gộp local với remote test |

### 4.1. Các profile tải tham khảo (KHÔNG PHẢI SLO)

- **Baseline:** 1 VU, think time xác định, thời gian đo đủ số mẫu; trước đó warm-up.
- **Load ladder:** 5, 10, 20, 50 VU; ghi achieved RPS và tỷ lệ lỗi cho từng bậc. Khi thấy rủi ro hoặc hết tài nguyên thì dừng.
- **Open-rate exploration:** Các bậc offered RPS được chọn theo kết quả smoke; nếu k6 dropped iterations hoặc CPU generator cao thì INVALID_GENERATOR.
- **Spike:** low→high ngắn→low, báo thời gian hồi phục p95 và queue.
- **Soak:** có thể 30–60 phút ở mức tải đã xác minh an toàn; nếu môi trường yếu điều chỉnh thời lượng có ghi lý do.
- **Mixed workload:** ratio READ/WRITE, login, chat WS và video được khai báo trước; ratio ví dụ 70/30 chỉ là giả thuyết khảo sát nếu chưa có telemetry sử dụng thực.

### 4.2. Gate trước khi được phép chạy LOAD/STRESS

1. T04/T05 các luồng mục tiêu có test PASS gần nhất; E09/E10 cần sửa trước benchmark chốt nghiệp vụ gọi điện/bảo mật.
2. Backend/Redis/PostgreSQL/MinIO/signaling có log, metrics và run_id; có thể quan sát generator capacity.
3. Có `docs/10_PERFORMANCE.md` nếu muốn chấm sáu mục tiêu chính thức. Nếu không, chỉ báo số đo thăm dò và `NEEDS_SLO`.
4. Video cleanup và quota đã được kiểm tra bằng T05/T07; không stress tạo multipart chưa có đường dọn chắc chắn.
5. Dataset đủ lớn, snapshot reset được; đủ token cho thời gian chạy; không gây login/token growth vô hạn.
6. Có stop conditions cho CPU/RAM/disk/object count, connection count, error burst, test timeout; chỉ chạy trong môi trường bạn quản lý.

## 5. Danh mục toàn bộ test case

| Nhóm | Nội dung | P0 | P1 | P2 | Tổng |
|---|---|---:|---:|---:|---:|
| ENV | Tính tái lập, an toàn môi trường và tài nguyên phát tải | 10 | 2 | 0 | 12 |
| OBS | Instrumentation, đo đạc và độ tin cậy của số liệu | 10 | 2 | 0 | 12 |
| API | Baseline HTTP theo từng endpoint và profile dữ liệu | 5 | 10 | 1 | 16 |
| AUTH | Tải xác thực, token, BCrypt, refresh và rate limit | 4 | 7 | 1 | 12 |
| WRITE | Tải HTTP ghi nghiệp vụ, idempotency và tác động DB | 5 | 11 | 1 | 17 |
| DB | PostgreSQL, HikariCP, SQL plans và dữ liệu lớn | 7 | 6 | 1 | 14 |
| RED | Redis xác thực, Pub/Sub, rate limiter và tác động realtime | 5 | 6 | 1 | 12 |
| WS | Messaging WebSocket: connection, heartbeat, fan-out và delivery latency | 11 | 7 | 1 | 19 |
| SIG | Node.js Signaling và latency gọi điện trước WebRTC media | 7 | 6 | 0 | 13 |
| VID | MinIO multipart, metadata, quota và webhook | 10 | 10 | 0 | 20 |
| MIX | Workload hỗn hợp mô phỏng người dùng VeilTalk | 4 | 7 | 1 | 12 |
| LOAD | Load, stress, spike, soak, capacity và recovery | 9 | 8 | 0 | 17 |
| NET | Mạng, reverse proxy, chi phí client và yếu tố đo ngoài backend | 0 | 8 | 2 | 10 |
| REP | Báo cáo, nghiệm thu, chẩn đoán và trước/sau tối ưu | 7 | 4 | 0 | 11 |
| **TỔNG** | **14 nhóm** | **94** | **94** | **9** | **197** |

## 6. Chi tiết từng test case

### 6.1. ENV — Tính tái lập, an toàn môi trường và tài nguyên phát tải

**Mục tiêu nhóm:** Chứng minh điều kiện đo ổn định trước khi gán thay đổi độ trễ cho backend.

#### T08-ENV-001 — Lưu dấu phiên bản cho từng lượt đo [P0]
- **Given / tiền điều kiện:** Checkout một commit cố định, snapshot cấu hình không chứa secret.
- **When / workload và bước thực hiện:** Ghi git SHA, Java/Node/Postgres/Redis/MinIO versions và dependency lock, thời gian UTC của từng run.
- **Then / oracle và cách đánh giá:** Hai run dùng cùng commit/config được nhận diện; thay đổi phiên bản có run_id khác và báo cáo rõ.
- **Metrics / bằng chứng cần lưu:** Build hash, versions, run_id.
- **Giới hạn an toàn / cleanup:** Không ghi access token, JDBC password hoặc presigned URL có chữ ký.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-ENV-002 — Tách dữ liệu test khỏi dữ liệu thực [P0]
- **Given / tiền điều kiện:** Tạo DB/bucket/namespace Redis và account riêng có prefix run_id.
- **When / workload và bước thực hiện:** Chạy smoke rồi truy vấn số bản ghi/object trước/sau.
- **Then / oracle và cách đánh giá:** Chỉ dữ liệu của run thay đổi; tuyệt đối không đọc/xóa tài nguyên production.
- **Metrics / bằng chứng cần lưu:** Row/object/key counts, container labels.
- **Giới hạn an toàn / cleanup:** Runner không được gọi docker system prune và không mount production volumes.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-ENV-003 — Ghi giới hạn phần cứng thực tế [P0]
- **Given / tiền điều kiện:** Xác định backend trên host, VM hay Docker; có CPU quota, memory limit hay không.
- **When / workload và bước thực hiện:** Thu CPU logical cores/quota, RAM, JVM heap, JVM flags, container limits, disk và network topology.
- **Then / oracle và cách đánh giá:** Báo cáo nêu cả giới hạn host lẫn giới hạn container, không nhầm 4 core host thành 4 CPU khả dụng.
- **Metrics / bằng chứng cần lưu:** cores, cgroup CPU quota, heap, RSS, disk IOPS.
- **Giới hạn an toàn / cleanup:** Không suy đoán cấu hình runtime từ file mặc định.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-ENV-004 — Ghi cấu hình pool và timeout đang áp dụng [P0]
- **Given / tiền điều kiện:** Khởi động backend trong môi trường benchmark.
- **When / workload và bước thực hiện:** Xác nhận HTTP server, max threads/connections, Hikari max pool, Redis client, MinIO timeouts và các env overrides.
- **Then / oracle và cách đánh giá:** Trích được nguồn runtime; cấu hình chưa đọc được đánh dấu UNKNOWN.
- **Metrics / bằng chứng cần lưu:** Worker pool, Hikari, connection count, Redis timeout.
- **Giới hạn an toàn / cleanup:** Không bật debug logging quá lớn ở vòng đo chính.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-ENV-005 — Tách môi trường tạo dữ liệu và môi trường đo [P0]
- **Given / tiền điều kiện:** Có seed script riêng tạo user, conversations, messages và videos theo run_id.
- **When / workload và bước thực hiện:** Seed xong, chụp thống kê rồi khóa việc seed trong giai đoạn baseline READ.
- **Then / oracle và cách đánh giá:** Baseline READ không bị thao tác seed cạnh tranh DB; dữ liệu đạt kích thước thiết kế.
- **Metrics / bằng chứng cần lưu:** Row/table sizes, SQL stats, baseline idle.
- **Giới hạn an toàn / cleanup:** Không reset DB khi bài WRITE đang chạy.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-ENV-006 — Kiểm tra máy phát tải không quá tải [P0]
- **Given / tiền điều kiện:** Có k6/WS generator và hệ thống giám sát máy phát.
- **When / workload và bước thực hiện:** Tăng dần tải với endpoint nhẹ và theo dõi CPU, RAM, dropped iterations, socket/file descriptors bên phát.
- **Then / oracle và cách đánh giá:** Máy phát còn headroom; nếu quá tải, kết quả bị gắn INVALID_GENERATOR.
- **Metrics / bằng chứng cần lưu:** Generator CPU/RAM, dropped_iterations, scheduling lag.
- **Giới hạn an toàn / cleanup:** Không quy bottleneck của generator thành server capacity.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-ENV-007 — So sánh cùng máy và máy phát tải tách biệt [P1]
- **Given / tiền điều kiện:** Có hai mô hình: generator chung host với backend hoặc chạy trên máy khác.
- **When / workload và bước thực hiện:** Chạy cùng kịch bản hiệu chỉnh ở từng mô hình, ghi NIC và Docker networking.
- **Then / oracle và cách đánh giá:** Sự khác biệt được ghi rõ; không cộng gộp số liệu hai cấu hình để kết luận năng lực backend.
- **Metrics / bằng chứng cần lưu:** CPU host, network RTT, p95, RPS.
- **Giới hạn an toàn / cleanup:** Nếu chỉ có một máy, đánh dấu kết luận capacity bị giới hạn bởi môi trường.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-ENV-008 — Kiểm tra readiness thay vì ngủ cố định [P0]
- **Given / tiền điều kiện:** Các dịch vụ được dựng qua runner/Compose.
- **When / workload và bước thực hiện:** Chờ backend, signaling, PG migration, Redis, MinIO bucket/webhook sẵn sàng trước lượt đầu.
- **Then / oracle và cách đánh giá:** Không có 5xx do khởi động dở bị đưa vào sample của steady-state.
- **Metrics / bằng chứng cần lưu:** Readiness status, startup time, log markers.
- **Giới hạn an toàn / cleanup:** Timeout readiness phải khiến bài đo BLOCKED chứ không âm thầm chạy.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-ENV-009 — Chu kỳ warm-up và đo riêng [P0]
- **Given / tiền điều kiện:** Chọn endpoint workload và thời lượng phù hợp.
- **When / workload và bước thực hiện:** Chạy warm-up không tính vào main samples rồi đo window ổn định được định nghĩa trước.
- **Then / oracle và cách đánh giá:** Có ranh giới warm-up/measurement rõ; không loại mẫu xấu theo cảm tính sau khi xem kết quả.
- **Metrics / bằng chứng cần lưu:** JIT warmup, throughput trend, latency trends.
- **Giới hạn an toàn / cleanup:** Ghi rõ cold-start là test riêng nếu có nhu cầu.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-ENV-010 — Reset dữ liệu giữa hai lần đo có thể so sánh [P0]
- **Given / tiền điều kiện:** Có snapshot DB sạch, Redis keys test và MinIO bucket test.
- **When / workload và bước thực hiện:** Khôi phục cùng fixture trước hai run A/B, kiểm đếm message, token, video, quota.
- **Then / oracle và cách đánh giá:** Dữ liệu đầu vào tương đương; chênh lệch chỉ do biến đang so sánh.
- **Metrics / bằng chứng cần lưu:** Count/hash fixture, row growth, storage usage.
- **Giới hạn an toàn / cleanup:** Với upload, abort/clear pending multipart cả khi test thất bại.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-ENV-011 — Kiểm tra đồng bộ đồng hồ giữa các máy [P1]
- **Given / tiền điều kiện:** Backend/generator/WS receivers có thể chạy trên nhiều host.
- **When / workload và bước thực hiện:** Ghi sai lệch clock, dùng monotonic timer cho duration và UTC có correlation cho phân tích log.
- **Then / oracle và cách đánh giá:** Độ trễ A→B được đo ở cùng clock domain hoặc đã bù offset có căn cứ.
- **Metrics / bằng chứng cần lưu:** Clock offset/drift, RTT uncertainty.
- **Giới hạn an toàn / cleanup:** Không lấy thời điểm gửi client A trừ timestamp client B khi hai máy chưa sync.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-ENV-012 — Tự động abort khi môi trường vượt ngưỡng an toàn [P0]
- **Given / tiền điều kiện:** Có quota test DB, bucket, message count, giới hạn thời gian/CPU và người chịu trách nhiệm chạy.
- **When / workload và bước thực hiện:** Đặt stop condition trước chạy; thử abort bằng môi trường test nhỏ.
- **Then / oracle và cách đánh giá:** Generator dừng được, cleanup chạy và artifacts vẫn được lưu.
- **Metrics / bằng chứng cần lưu:** CPU/RAM/disk/Redis OOM flags, budget bytes.
- **Giới hạn an toàn / cleanup:** Không chạy bài stress phá hủy ngoài môi trường được cấp phép.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

### 6.2. OBS — Instrumentation, đo đạc và độ tin cậy của số liệu

**Mục tiêu nhóm:** Đảm bảo chỉ số p95/p99, DB/Redis/MinIO, WS và error được thu đúng nghĩa.

#### T08-OBS-001 — Kiểm tra đo latency phía client và phía server [P0]
- **Given / tiền điều kiện:** Endpoint GET nhẹ có trace ID hoặc request correlation.
- **When / workload và bước thực hiện:** So thời gian k6 quan sát với thời gian server ghi nhận trên cùng sample.
- **Then / oracle và cách đánh giá:** Hai giá trị có ranh giới đo giải thích được; sai khác network/proxy không bị coi bug.
- **Metrics / bằng chứng cần lưu:** Client duration, server duration, wait/receive.
- **Giới hạn an toàn / cleanup:** Không dùng timestamp không đồng bộ để đo duration.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-OBS-002 — Thu p50/p90/p95/p99 hợp lệ theo từng endpoint [P0]
- **Given / tiền điều kiện:** Đủ mẫu request thành công cho mỗi route.
- **When / workload và bước thực hiện:** Đo riêng từng URL template, method, status, phase và workload.
- **Then / oracle và cách đánh giá:** Không gộp READ với WRITE thành một p95 báo cáo đại diện; cảnh báo p99 khi mẫu ít.
- **Metrics / bằng chứng cần lưu:** Sample count, p50, p90, p95, p99, max.
- **Giới hạn an toàn / cleanup:** Không chỉ chọn kết quả đẹp nhất.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-OBS-003 — Định nghĩa failure rate kết hợp status và business check [P0]
- **Given / tiền điều kiện:** Mọi script có expected body và route-specific status.
- **When / workload và bước thực hiện:** Đếm timeout/network/5xx/vi phạm schema/vi phạm nghiệp vụ, 429 chính sách thành nhóm riêng.
- **Then / oracle và cách đánh giá:** Test có 200 nhưng body sai được tính functional failure; retry duplicate 200 không tính created mới.
- **Metrics / bằng chứng cần lưu:** http_req_failed, checks, error taxonomy.
- **Giới hạn an toàn / cleanup:** Không giấu 401/403/429 bằng custom tags coi là thành công vô điều kiện.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-OBS-004 — Thu throughput hoàn thành và throughput thành công [P0]
- **Given / tiền điều kiện:** Có latency/error metrics độc lập cho từng operation.
- **When / workload và bước thực hiện:** Ghi request starts, completions, successful operations/s theo từng 1s/10s window.
- **Then / oracle và cách đánh giá:** Throughput phản ánh thao tác hoàn tất đúng, không chỉ request gửi đi.
- **Metrics / bằng chứng cần lưu:** total RPS, valid_ops/s, failures/s.
- **Giới hạn an toàn / cleanup:** Không lấy VUs làm RPS.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-OBS-005 — Thu tài nguyên JVM theo thời gian [P0]
- **Given / tiền điều kiện:** Java metrics/agent hoặc OS profiler được bật ở mức overhead phù hợp.
- **When / workload và bước thực hiện:** Thu process CPU, heap, nonheap, RSS, GC pause, allocations nếu có, threads và file descriptors.
- **Then / oracle và cách đánh giá:** Metrics có timestamp đồng bộ với phases; overhead đã đánh giá.
- **Metrics / bằng chứng cần lưu:** JVM process CPU, GC p95, heap usage, thread states.
- **Giới hạn an toàn / cleanup:** Không thay đổi profiler giữa hai baseline A/B.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-OBS-006 — Thu HikariCP và connection wait [P0]
- **Given / tiền điều kiện:** Hikari metrics hoặc log có thể bật trong test.
- **When / workload và bước thực hiện:** Thu active/idle/pending connections, connection acquire duration, timeout.
- **Then / oracle và cách đánh giá:** Khi latency tăng có dữ liệu chứng minh đang đợi pool hay SQL; nếu thiếu ghi OBSERVABILITY_GAP.
- **Metrics / bằng chứng cần lưu:** Hikari active/idle/pending, acquire p95, timeout count.
- **Giới hạn an toàn / cleanup:** Đừng suy SQL chậm chỉ từ HTTP duration.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-OBS-007 — Thu PostgreSQL query stats và lock waits [P0]
- **Given / tiền điều kiện:** Có quyền read-only quan sát pg_stat_statements nếu extension sẵn, pg_stat_activity và log slow query được chấp thuận.
- **When / workload và bước thực hiện:** Thu query p95/mean, calls, rows, shared buffers, locks/deadlocks và connections theo phase.
- **Then / oracle và cách đánh giá:** Có phân biệt query time với time chờ pool; execution plan chỉ chạy khi an toàn.
- **Metrics / bằng chứng cần lưu:** SQL timings, wait events, buffers, locks, DB CPU/IO.
- **Giới hạn an toàn / cleanup:** Không chạy EXPLAIN ANALYZE trên câu ghi destructive ở DB thật.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-OBS-008 — Thu Redis command latency và publish hoạt động [P0]
- **Given / tiền điều kiện:** Redis test riêng, metrics INFO và latency stats có thể đọc.
- **When / workload và bước thực hiện:** Thu ops/sec, latency, blocked clients, used memory, connected clients, dropped/subscriber signs.
- **Then / oracle và cách đánh giá:** Có thể kiểm chứng Redis chậm đồng thời với HTTP/WS bằng dữ liệu.
- **Metrics / bằng chứng cần lưu:** Redis latency, pubsub channels/subscribers, clients, memory.
- **Giới hạn an toàn / cleanup:** Không dùng KEYS * trên Redis nhiều dữ liệu.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-OBS-009 — Thu số socket và sự kiện WebSocket [P0]
- **Given / tiền điều kiện:** WS generator giữ connection và nhận PING/PONG.
- **When / workload và bước thực hiện:** Đếm attempts/opens/active/closes, close code, send/receive, message IDs, ping delays.
- **Then / oracle và cách đánh giá:** Phân biệt kết nối mở với kết nối hữu dụng; socket chết không bị tính active.
- **Metrics / bằng chứng cần lưu:** Active WS, disconnects/s, event delivery%, RTT.
- **Giới hạn an toàn / cleanup:** Không in raw JWT ở WebSocket URL vào log.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-OBS-010 — Thu chuỗi latency nhắn tin HTTP→WS [P0]
- **Given / tiền điều kiện:** A/B có correlation message UUID được tạo tại client.
- **When / workload và bước thực hiện:** Đặt điểm đo trước POST, sau HTTP response, khi B thấy NEW_MESSAGE khớp ID; lưu correlation.
- **Then / oracle và cách đánh giá:** Báo cáo riêng POST latency, event lag và end-to-end send→receive.
- **Metrics / bằng chứng cần lưu:** msg created/s, delivered/s, p95/p99 delivery, duplicates/loss.
- **Giới hạn an toàn / cleanup:** Không đo bằng đồng hồ hai host chưa sync.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-OBS-011 — Thu luồng video từ request đến READY [P1]
- **Given / tiền điều kiện:** Bucket test và webhook thật; fixture bytes hợp lệ cho multipart.
- **When / workload và bước thực hiện:** Đo init→PUT parts→finalize→READY và tách từng giai đoạn, quan sát MinIO process/net.
- **Then / oracle và cách đánh giá:** Phân biệt Spring metadata latency với file transfer bytes/s và webhook delay.
- **Metrics / bằng chứng cần lưu:** init p95, PUT Mbps, finalize p95, time-to-ready p95.
- **Giới hạn an toàn / cleanup:** Không gộp throughput MinIO với backend HTTP request throughput.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-OBS-012 — Kiểm tra tính đầy đủ của artifact và trace [P1]
- **Given / tiền điều kiện:** Có run_id, scenario_id, request IDs, timestamps, output path.
- **When / workload và bước thực hiện:** Chạy một smoke gồm success/intentional fail rồi mở raw + JUnit/JSON/CSV/log.
- **Then / oracle và cách đánh giá:** Có thể truy ngược một request lỗi qua các thành phần, không log secrets.
- **Metrics / bằng chứng cần lưu:** Missing samples, trace propagation, log count.
- **Giới hạn an toàn / cleanup:** Thất bại khi mất raw results phải là INVALID_RUN nếu không còn đủ bằng chứng.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

### 6.3. API — Baseline HTTP theo từng endpoint và profile dữ liệu

**Mục tiêu nhóm:** Lấy tốc độ từng API dưới tải thấp, tách cold/warm và dữ liệu nhỏ/lớn.

#### T08-API-001 — Baseline GET avatar catalog [P0]
- **Given / tiền điều kiện:** Resource catalog đã tải, dùng GET /avatars/models theo auth policy.
- **When / workload và bước thực hiện:** Chạy 1 VU và sau warmup, lặp yêu cầu với pacing cố định.
- **Then / oracle và cách đánh giá:** Body có models hợp lệ; tách serialization khỏi truy vấn DB.
- **Metrics / bằng chứng cần lưu:** p50/p95/p99, RPS, CPU, heap.
- **Giới hạn an toàn / cleanup:** Không đại diện cho năng lực DB nhắn tin.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-API-002 — Baseline GET current user [P1]
- **Given / tiền điều kiện:** 10+ account hợp lệ có token còn hạn.
- **When / workload và bước thực hiện:** Luân phiên GET /users/me với token phân bố theo VU.
- **Then / oracle và cách đánh giá:** Identity đúng user; không trả dữ liệu chéo.
- **Metrics / bằng chứng cần lưu:** latency/status, Redis auth reads, SQL lookup.
- **Giới hạn an toàn / cleanup:** Không gửi token vào artifacts.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-API-003 — Baseline GET user settings [P1]
- **Given / tiền điều kiện:** Các account có settings khác nhau.
- **When / workload và bước thực hiện:** GET /users/me/settings, kiểm tra response đúng từng fixture.
- **Then / oracle và cách đánh giá:** Không cache nhầm user; p95 riêng.
- **Metrics / bằng chứng cần lưu:** DB time, Redis check, duration.
- **Giới hạn an toàn / cleanup:** Không vô tình cập nhật settings trong lượt READ.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-API-004 — Baseline GET own avatar [P1]
- **Given / tiền điều kiện:** Có account đã lưu avatar và account chưa lưu theo contract.
- **When / workload và bước thực hiện:** GET /avatars/me từng cohort, ghi riêng status 200/404 nếu hợp đồng xác nhận.
- **Then / oracle và cách đánh giá:** Không trộn positive/negative thành một baseline.
- **Metrics / bằng chứng cần lưu:** latency by cohort, SQL calls.
- **Giới hạn an toàn / cleanup:** Chỉ xác lập expected sau đối chiếu contract current.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-API-005 — Baseline GET public avatar [P1]
- **Given / tiền điều kiện:** Có nhiều user public avatar và user không có avatar.
- **When / workload và bước thực hiện:** GET /avatars/{userId} theo phân bố account.
- **Then / oracle và cách đánh giá:** Correct model and permissions; no wrong-user data.
- **Metrics / bằng chứng cần lưu:** p95, DB cost, cache hit if any.
- **Giới hạn an toàn / cleanup:** Không truy cập user thật.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-API-006 — Baseline GET conversations small [P0]
- **Given / tiền điều kiện:** Seed 5 hội thoại/user với 20 tin mỗi hội thoại, status stable.
- **When / workload và bước thực hiện:** GET /conversations?limit=20 ở 1 VU hoặc RPS thấp.
- **Then / oracle và cách đánh giá:** Trả trang và cursor đúng; phản hồi 2xx.
- **Metrics / bằng chứng cần lưu:** server/client p95, SQL calls, Hikari waits.
- **Giới hạn an toàn / cleanup:** Dữ liệu cố định ở READ run.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-API-007 — Baseline GET conversations medium [P0]
- **Given / tiền điều kiện:** Seed 50+ hội thoại/user, last message có dữ liệu.
- **When / workload và bước thực hiện:** GET /conversations?limit=20 và điều hướng cursor 2-3 trang ở tải thấp.
- **Then / oracle và cách đánh giá:** Không trùng/mất trong snapshot, page counts hợp lệ.
- **Metrics / bằng chứng cần lưu:** p95 per page, query time, rows returned.
- **Giới hạn an toàn / cleanup:** Không trộn limit 20 và 50 trong cùng tag.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-API-008 — Baseline GET conversations large [P1]
- **Given / tiền điều kiện:** Seed 500+ hội thoại/user riêng.
- **When / workload và bước thực hiện:** Đo first/middle/last pages rồi đối chiếu profile small/medium.
- **Then / oracle và cách đánh giá:** Latency không được nhận xét tăng/giảm nếu không có kích thước dữ liệu và explain plan.
- **Metrics / bằng chứng cần lưu:** CPU/IO/SQL buffer/page p95.
- **Giới hạn an toàn / cleanup:** Seed fixture hợp lệ; không suy hệ thống phải có 500 hội thoại thực.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-API-009 — Baseline GET conversation detail [P1]
- **Given / tiền điều kiện:** A/B có hội thoại và outsider fixture.
- **When / workload và bước thực hiện:** GET /conversations/{id} hợp lệ theo cohort, đo load thấp.
- **Then / oracle và cách đánh giá:** Response đúng ID, member; status theo contract.
- **Metrics / bằng chứng cần lưu:** p95, SQL queries.
- **Giới hạn an toàn / cleanup:** Không trộn test BOLA âm tính vào business throughput.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-API-010 — Baseline GET messages small [P0]
- **Given / tiền điều kiện:** Hội thoại có 20 tin nhắn.
- **When / workload và bước thực hiện:** GET /conversations/{id}/messages?limit=30 lặp có pacing.
- **Then / oracle và cách đánh giá:** 20 tin đúng order và cursor; DB ổn định.
- **Metrics / bằng chứng cần lưu:** p95, SQL time, response bytes.
- **Giới hạn an toàn / cleanup:** Account không tạo tin mới trong phase.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-API-011 — Baseline GET messages medium [P0]
- **Given / tiền điều kiện:** 100+ tin nhắn/hội thoại.
- **When / workload và bước thực hiện:** GET first page với limit 30, rồi cursor page sau.
- **Then / oracle và cách đánh giá:** Không trùng, thiếu hoặc đảo thứ tự trong fixture frozen.
- **Metrics / bằng chứng cần lưu:** p95/page, rows, buffers, network bytes.
- **Giới hạn an toàn / cleanup:** Cố định seed/limit.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-API-012 — Baseline GET messages large [P1]
- **Given / tiền điều kiện:** 10k+ tin phân phối nhiều hội thoại seed riêng.
- **When / workload và bước thực hiện:** Đo cursor đầu/giữa/cuối theo dataset cố định.
- **Then / oracle và cách đánh giá:** Phân biệt index scan với seq scan bằng evidence; không suy index chậm chỉ nhìn thời gian.
- **Metrics / bằng chứng cần lưu:** EXPLAIN read safe, SQL p95, IO, RPS.
- **Giới hạn an toàn / cleanup:** Khống chế disk budget khi seed.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-API-013 — Baseline GET video library [P1]
- **Given / tiền điều kiện:** User có 0/20/100 video metadata ready/processing.
- **When / workload và bước thực hiện:** GET /videos?limit=20 theo status và cursor đã chốt.
- **Then / oracle và cách đánh giá:** Result/total/storage usage đúng, p95 theo cohort.
- **Metrics / bằng chứng cần lưu:** SQL response time, rows, payload size.
- **Giới hạn an toàn / cleanup:** Không tạo MinIO part trong bài đọc.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-API-014 — Baseline GET video detail [P1]
- **Given / tiền điều kiện:** Video READY đã có và presigned GET còn hiệu lực.
- **When / workload và bước thực hiện:** GET /videos/{id} nhiều video IDs theo phân bố.
- **Then / oracle và cách đánh giá:** Metadata đúng; mỗi response presigned URL chỉ dùng theo chính sách.
- **Metrics / bằng chứng cần lưu:** latency, SQL, MinIO signing cost.
- **Giới hạn an toàn / cleanup:** Không log full signed URLs.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-API-015 — Baseline POST user search theo email [P1]
- **Given / tiền điều kiện:** User test discoverable/non-discoverable, có email hợp lệ thuộc fixture.
- **When / workload và bước thực hiện:** POST /users/search với JSON {email} theo UserProfileController hiện có, tốc độ dưới limiter; chạy cohort found/not-found.
- **Then / oracle và cách đánh giá:** Trả kết quả đúng policy discoverability; phân biệt found vs not-found; không gộp 429 vào baseline.
- **Metrics / bằng chứng cần lưu:** latency, DB query, 429 count, Redis limiter operations.
- **Giới hạn an toàn / cleanup:** Không log email thật; không kích hoạt limiter ở baseline.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-API-016 — Baseline GET empty/result-not-found [P2]
- **Given / tiền điều kiện:** User không có hội thoại/video và một ID không tồn tại hợp lệ.
- **When / workload và bước thực hiện:** Chạy empty-list và not-found tách cohorts.
- **Then / oracle và cách đánh giá:** Không nhầm p95 của response rỗng với response nhiều dữ liệu.
- **Metrics / bằng chứng cần lưu:** status by cohort, latency, SQL work.
- **Giới hạn an toàn / cleanup:** Error expected theo contract, không coi 404 mặc định là backend failure.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

### 6.4. AUTH — Tải xác thực, token, BCrypt, refresh và rate limit

**Mục tiêu nhóm:** Đo chi phí CPU/DB của auth và các biến thể xác thực thực tế.

#### T08-AUTH-001 — Baseline POST register [P1]
- **Given / tiền điều kiện:** Dùng email duy nhất mỗi lần và cleanup DB.
- **When / workload và bước thực hiện:** 1 VU tạo account thật với password hợp lệ; không reuse email.
- **Then / oracle và cách đánh giá:** Mỗi 201 là account mới, stored password hash; DB rows khớp count.
- **Metrics / bằng chứng cần lưu:** registrations/s, BCrypt CPU, DB inserts, p95.
- **Giới hạn an toàn / cleanup:** Dừng nếu DB account/token growth vượt ngân sách.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-AUTH-002 — Baseline POST login [P0]
- **Given / tiền điều kiện:** Seed cohort 50 account test biết password.
- **When / workload và bước thực hiện:** Luân phiên account, login pacing thấp, không làm trùng dữ liệu ngoài ý muốn.
- **Then / oracle và cách đánh giá:** Token trả đúng; login thành công; refresh token rows được kiểm đếm.
- **Metrics / bằng chứng cần lưu:** p95, CPU, BCrypt time, SQL, token rows.
- **Giới hạn an toàn / cleanup:** Không lưu password/token thô trong log.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-AUTH-003 — Login 5→10→20→50 VU [P0]
- **Given / tiền điều kiện:** Seed đủ tài khoản, đặt trần refresh token rows.
- **When / workload và bước thực hiện:** Tăng concurrency có thời gian giữ ổn định từng bậc, không gộp với API khác.
- **Then / oracle và cách đánh giá:** Throughput, 5xx, p95/p99, CPU/hikari trong từng bậc.
- **Metrics / bằng chứng cần lưu:** login_ops/s, CPU, GC, p95, errors.
- **Giới hạn an toàn / cleanup:** Cẩn trọng brute-force limiter; cleanup token tạo mới.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-AUTH-004 — Login nhiều VU cùng một account [P1]
- **Given / tiền điều kiện:** Một account test và chính sách cho phép multi-device.
- **When / workload và bước thực hiện:** Nhiều VU đăng nhập hợp lệ cùng account; đối chiếu cohort distinct accounts.
- **Then / oracle và cách đánh giá:** Phân biệt contention theo user/refresh token với CPU BCrypt chung.
- **Metrics / bằng chứng cần lưu:** latency, DB locks, 409/429, token rows.
- **Giới hạn an toàn / cleanup:** Test riêng, không suy đây là typical-user load.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-AUTH-005 — POST refresh baseline và tải vừa [P0]
- **Given / tiền điều kiện:** Mỗi worker sở hữu refresh token hợp lệ, vòng đời được quản lý.
- **When / workload và bước thực hiện:** Refresh với token hợp lệ theo hợp đồng, cấp mới rồi thay token sử dụng.
- **Then / oracle và cách đánh giá:** Không reuse token đã rotate sai; refresh_ops/s và lỗi hợp lệ.
- **Metrics / bằng chứng cần lưu:** p95, DB writes, errors, token count.
- **Giới hạn an toàn / cleanup:** Không gây refresh storm bằng token cũ trừ scenario riêng.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-AUTH-006 — POST logout baseline [P1]
- **Given / tiền điều kiện:** Tài khoản test có access+refresh đang hoạt động.
- **When / workload và bước thực hiện:** Logout rồi thử API protected trước khi reset test data.
- **Then / oracle và cách đánh giá:** Sau logout token bị từ chối; đo request logout riêng.
- **Metrics / bằng chứng cần lưu:** p95, Redis write/read, revocation ops.
- **Giới hạn an toàn / cleanup:** Mỗi token chỉ logout hợp lệ một lần theo contract.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-AUTH-007 — Authorization filter overhead bằng GET nhẹ [P0]
- **Given / tiền điều kiện:** Chọn route public và route auth có business cost tương đương hoặc instrument riêng thời gian filter.
- **When / workload và bước thực hiện:** Đo đường auth JWT+Redis ở mức RPS giống nhau; tránh so hai route có SQL khác hẳn.
- **Then / oracle và cách đánh giá:** Kết luận overhead chỉ khi isolate được chi phí Security.
- **Metrics / bằng chứng cần lưu:** auth filter span, Redis reads, CPU.
- **Giới hạn an toàn / cleanup:** Không lấy chênh lệch avatar vs messages làm chi phí auth.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-AUTH-008 — Token lifetime qua soak [P1]
- **Given / tiền điều kiện:** Kịch bản lâu hơn 15 phút hoặc expiry runtime; refresh coordinator.
- **When / workload và bước thực hiện:** Chạy GET/POST với token refresh hợp pháp khi sắp hết hạn.
- **Then / oracle và cách đánh giá:** 401 do harness thiếu refresh không bị ghi thành giới hạn server.
- **Metrics / bằng chứng cần lưu:** refresh success%, 401 timeline, session renew delays.
- **Giới hạn an toàn / cleanup:** Không chia sẻ refresh token rotation giữa VUs thiếu khóa.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-AUTH-009 — Negative login có kiểm soát [P1]
- **Given / tiền điều kiện:** Tài khoản test riêng; chính sách chống thử password được chốt.
- **When / workload và bước thực hiện:** Trộn tỷ lệ nhỏ mật khẩu sai có gắn tag negative_expected, không làm vượt giới hạn an toàn.
- **Then / oracle và cách đánh giá:** Không để request thất bại kỳ vọng làm biến dạng success throughput login hợp lệ.
- **Metrics / bằng chứng cần lưu:** 401/429 rate, cost, CPU.
- **Giới hạn an toàn / cleanup:** Không thực hiện credential-stuffing trên account thật.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-AUTH-010 — Rate limiter auth theo ngưỡng công bố [P1]
- **Given / tiền điều kiện:** Xác nhận route có limiter trên source/config hiện hành.
- **When / workload và bước thực hiện:** Tăng request một user trong cửa sổ ngắn theo phạm vi được phép.
- **Then / oracle và cách đánh giá:** 429 nếu được quy định; vẫn đếm throttling riêng, không coi capacity core.
- **Metrics / bằng chứng cần lưu:** 429 onset, limiter latency, Redis ops.
- **Giới hạn an toàn / cleanup:** Không tự áp đặt limiter ở route chưa triển khai.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-AUTH-011 — Token validation burst [P1]
- **Given / tiền điều kiện:** Nhiều token hợp lệ của user khác nhau.
- **When / workload và bước thực hiện:** Đo burst ngắn vào protected GET để thấy JWT/Redis check p99.
- **Then / oracle và cách đánh giá:** Không có false 401 nếu token còn hạn, không leakage.
- **Metrics / bằng chứng cần lưu:** p99, Redis latency, thread usage.
- **Giới hạn an toàn / cleanup:** Tải burst an toàn không là security brute force.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-AUTH-012 — Refresh-token table growth dài hạn [P2]
- **Given / tiền điều kiện:** Có quota DB và cấu hình cleanup token.
- **When / workload và bước thực hiện:** Chạy login/refresh chu kỳ, ghi row count và query cost theo thời gian.
- **Then / oracle và cách đánh giá:** Phân biệt suy giảm do tích lũy dữ liệu với ổn định API.
- **Metrics / bằng chứng cần lưu:** rows, table/index bytes, login p95 over time.
- **Giới hạn an toàn / cleanup:** Reset DB sau bài; không phát triển vô hạn.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

### 6.5. WRITE — Tải HTTP ghi nghiệp vụ, idempotency và tác động DB

**Mục tiêu nhóm:** Đo ghi thật, không để retry hoặc response 200 cho tin cũ thổi phồng throughput ghi mới.

#### T08-WRITE-001 — Baseline tạo hội thoại A–B [P0]
- **Given / tiền điều kiện:** Seed cặp user mới, A/B không có hội thoại từ trước.
- **When / workload và bước thực hiện:** POST /conversations với other_user_id=B.id cho từng cặp mới.
- **Then / oracle và cách đánh giá:** HTTP 201 cho created; chỉ một conversation cho pair, DB đúng.
- **Metrics / bằng chứng cần lưu:** create/s, p95, SQL writes, Redis auth.
- **Giới hạn an toàn / cleanup:** Không dùng cùng cặp để đo tốc độ tạo mới.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WRITE-002 — Create-or-get hội thoại có sẵn [P1]
- **Given / tiền điều kiện:** Seed conversation A–B tồn tại.
- **When / workload và bước thực hiện:** POST /conversations cùng cặp; đo riêng luồng get-existing.
- **Then / oracle và cách đánh giá:** Không tạo row thứ hai; response/status đúng hợp đồng; không gộp với create/s.
- **Metrics / bằng chứng cần lưu:** lookup/s, p95, DB reads/locks.
- **Giới hạn an toàn / cleanup:** Cách này không đại diện đường ghi mới.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WRITE-003 — Baseline gửi một tin nhắn mới [P0]
- **Given / tiền điều kiện:** A/B có conversation; UUID khác cho mỗi tin và timestamp hiện hành.
- **When / workload và bước thực hiện:** POST /conversations/{id}/messages với payload hợp lệ, 1 VU có pacing.
- **Then / oracle và cách đánh giá:** HTTP 201, DB thêm một row/tin; không chấp nhận 200 duplicate là created.
- **Metrics / bằng chứng cần lưu:** created_messages/s, p95, SQL/Redis spans.
- **Giới hạn an toàn / cleanup:** Không gửi vào một hội thoại không giới hạn; giới hạn row budget.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WRITE-004 — Gửi tin mới 5→10→20→50 VU [P0]
- **Given / tiền điều kiện:** Nhiều pairs độc lập, token hợp lệ, mỗi request UUID duy nhất.
- **When / workload và bước thực hiện:** Tăng VU theo bậc, mỗi VU gửi theo think time cố định.
- **Then / oracle và cách đánh giá:** Created 201 đạt, DB count tương ứng, errors và tail latency theo từng bậc.
- **Metrics / bằng chứng cần lưu:** messages/s, p95/p99, CPU, DB locks.
- **Giới hạn an toàn / cleanup:** Ghi nhận RPS thực tế khác VUs, stop khi DB/disk gần giới hạn.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WRITE-005 — Tải ghi tập trung cùng một conversation [P1]
- **Given / tiền điều kiện:** Một A–B conversation có nhiều worker, mỗi request UUID mới.
- **When / workload và bước thực hiện:** Bắn tải kiểm soát cùng conversation, so với phân tán pairs.
- **Then / oracle và cách đánh giá:** Phân tích contention cập nhật conversation.updated_at/last message; không sai dữ liệu.
- **Metrics / bằng chứng cần lưu:** locks, p99, messages/s.
- **Giới hạn an toàn / cleanup:** Không suy kết quả hotspot là tải người dùng thông thường.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WRITE-006 — Ghi trải rộng nhiều conversation [P0]
- **Given / tiền điều kiện:** Seed hàng chục/nghìn conversation độc lập và tokens hợp lệ.
- **When / workload và bước thực hiện:** Các VU chọn conversation độc lập theo round-robin/random có seed.
- **Then / oracle và cách đánh giá:** Không bị một dòng DB nóng giới hạn giả tạo; event routed đúng.
- **Metrics / bằng chứng cần lưu:** aggregate/s, per-partition p95, DB CPU.
- **Giới hạn an toàn / cleanup:** Ghi rõ cardinality dữ liệu và seed.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WRITE-007 — Tách tạo mới và idempotent retry [P0]
- **Given / tiền điều kiện:** Seed một body đã được tạo thành công, cùng UUID/conversation/user.
- **When / workload và bước thực hiện:** Chạy load riêng request trùng body, không pha vào tải created.
- **Then / oracle và cách đánh giá:** 200 theo contract và DB count không đổi; không báo 200 này là throughput ghi mới.
- **Metrics / bằng chứng cần lưu:** dedup_ops/s, DB lookups, p95.
- **Giới hạn an toàn / cleanup:** Cũng cần giới hạn retry không làm nhiễm metrics create.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WRITE-008 — Tải với tỷ lệ retry thực tế [P1]
- **Given / tiền điều kiện:** Xác định tỷ lệ retry giả định công khai (ví dụ 2% chỉ để khảo sát).
- **When / workload và bước thực hiện:** Trộn tạo mới và retry có tag khác, correlation id.
- **Then / oracle và cách đánh giá:** created_messages/s riêng, retries/s riêng, DB unique count và duplicates đúng.
- **Metrics / bằng chứng cần lưu:** valid_new/s, retry rate, p99.
- **Giới hạn an toàn / cleanup:** Không coi tỷ lệ retry khảo sát là dữ liệu production.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WRITE-009 — Update delivered và read baseline [P1]
- **Given / tiền điều kiện:** Tin nhắn tồn tại, người nhận có quyền cập nhật.
- **When / workload và bước thực hiện:** PUT /conversations/{id}/messages/{messageId} chuyển trạng thái hợp lệ.
- **Then / oracle và cách đánh giá:** DB status đúng, không transition ngược; latency của PUT đo riêng.
- **Metrics / bằng chứng cần lưu:** status_updates/s, row locks, p95.
- **Giới hạn an toàn / cleanup:** Chuẩn bị tin mới hoặc reset fixture cho từng iteration.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WRITE-010 — Cập nhật trạng thái nhiều tin độc lập [P1]
- **Given / tiền điều kiện:** Nhiều message chưa đọc cho nhiều user pairs.
- **When / workload và bước thực hiện:** PUT delivered/read phân tán message IDs, tăng load từng bậc.
- **Then / oracle và cách đánh giá:** Không tạo 403/409 ngoài thiết kế, DB valid states; tìm SQL lock hotspots.
- **Metrics / bằng chứng cần lưu:** PUT/s, DB waits, p99.
- **Giới hạn an toàn / cleanup:** Giới hạn việc tạo dữ liệu nguồn.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WRITE-011 — Cập nhật avatar profile [P1]
- **Given / tiền điều kiện:** User/valid model id, payload customizations hợp lệ.
- **When / workload và bước thực hiện:** PUT /avatars/me trên nhiều user, luân phiên hai cấu hình hợp lệ.
- **Then / oracle và cách đánh giá:** Response đúng user, GET sau phase cho dữ liệu cuối; so với GET avatar.
- **Metrics / bằng chứng cần lưu:** updates/s, SQL writes, p95.
- **Giới hạn an toàn / cleanup:** Không phát tải vô hạn vào cùng user.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WRITE-012 — Cập nhật user settings [P1]
- **Given / tiền điều kiện:** Distinct users, hai settings hợp lệ.
- **When / workload và bước thực hiện:** PUT /users/me/settings rồi GET xác nhận sample.
- **Then / oracle và cách đánh giá:** Không lộ dữ liệu user khác, không mất cập nhật; load nhỏ/vừa.
- **Metrics / bằng chứng cần lưu:** write p95, read-after-write latency, DB.
- **Giới hạn an toàn / cleanup:** Không trộn search limiter vào bài này.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WRITE-013 — Cập nhật hồ sơ người dùng [P1]
- **Given / tiền điều kiện:** Seed nhiều user với display name thay đổi.
- **When / workload và bước thực hiện:** PUT /users/me với thông tin hợp lệ, verify qua GET sample.
- **Then / oracle và cách đánh giá:** Cập nhật thành công đúng user; response/body đúng.
- **Metrics / bằng chứng cần lưu:** write p95, SQL locks, updates/s.
- **Giới hạn an toàn / cleanup:** Dùng prefix run_id tránh lẫn user thật.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WRITE-014 — Rename video metadata [P1]
- **Given / tiền điều kiện:** Seed videos READY hợp lệ của nhiều user.
- **When / workload và bước thực hiện:** PUT /videos/{id} để đổi title, sau đó GET sample.
- **Then / oracle và cách đánh giá:** Không đổi object content/quota; trả đúng title.
- **Metrics / bằng chứng cần lưu:** rename p95, DB updates, CPU.
- **Giới hạn an toàn / cleanup:** Không cần PUT file lên MinIO mỗi lần rename.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WRITE-015 — Delete video metadata và object [P1]
- **Given / tiền điều kiện:** Seed video READY trong test bucket, xác nhận cleanup.
- **When / workload và bước thực hiện:** DELETE /videos/{id} dưới tốc độ kiểm soát, kiểm tra DB/quota/MinIO sau.
- **Then / oracle và cách đánh giá:** Không báo 204 là xong nếu object cleanup còn lỗi; đo thời gian eventual cleanup riêng.
- **Metrics / bằng chứng cần lưu:** DELETE p95, cleanup lag, MinIO errors.
- **Giới hạn an toàn / cleanup:** Không dùng as hot stress cho đến khi T07 cleanup pass.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WRITE-016 — Telemetry ingest bình thường [P1]
- **Given / tiền điều kiện:** User token đúng, session_type hợp lệ.
- **When / workload và bước thực hiện:** POST /metrics/client với tỷ lệ hợp lý, payload có fps/latency hợp lệ.
- **Then / oracle và cách đánh giá:** 204 và logging/metrics theo contract; tách log overhead.
- **Metrics / bằng chứng cần lưu:** ingest/s, p95, rate limit.
- **Giới hạn an toàn / cleanup:** Không bắn telemetry vượt limiter ở baseline.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WRITE-017 — Telemetry bị rate limit khi burst [P2]
- **Given / tiền điều kiện:** Xác nhận limiter có trong code/config hiện hành.
- **When / workload và bước thực hiện:** Tăng POST /metrics/client trong cửa sổ ngắn cho user test.
- **Then / oracle và cách đánh giá:** 429 theo policy; phân biệt controlled throttling với 5xx.
- **Metrics / bằng chứng cần lưu:** allowed/s, throttled/s, Redis ops.
- **Giới hạn an toàn / cleanup:** Không coi 429 là 2xx pass cho các thao tác hợp lệ.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

### 6.6. DB — PostgreSQL, HikariCP, SQL plans và dữ liệu lớn

**Mục tiêu nhóm:** Tìm giới hạn DB và nguyên nhân tail latency thay vì đo API một cách mù quáng.

#### T08-DB-001 — Connection pool steady-state read [P0]
- **Given / tiền điều kiện:** Endpoint GET conversations, metrics Hikari hoạt động.
- **When / workload và bước thực hiện:** Tăng rate đọc ổn định theo bậc; giữ dataset cố định.
- **Then / oracle và cách đánh giá:** Biểu đồ active/idle/pending giải thích được latency; không timeout ngoài SLO.
- **Metrics / bằng chứng cần lưu:** Hikari active/pending, acquire p95, RPS.
- **Giới hạn an toàn / cleanup:** Không tùy tiện tăng maxPoolSize trong cùng run.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-DB-002 — Connection pool steady-state write [P0]
- **Given / tiền điều kiện:** Nhiều pairs/message UUID duy nhất.
- **When / workload và bước thực hiện:** Tăng rate POST messages qua các mức ổn định.
- **Then / oracle và cách đánh giá:** Đo cả SQL transaction và borrow connection; xác định ngưỡng pending tăng.
- **Metrics / bằng chứng cần lưu:** pool waits, SQL p95, 5xx.
- **Giới hạn an toàn / cleanup:** Dừng trước khi DB mất ổn định lâu dài.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-DB-003 — Saturate pool có kiểm soát [P1]
- **Given / tiền điều kiện:** Môi trường cô lập, biết giới hạn max pool, đã có stop rules.
- **When / workload và bước thực hiện:** Tăng concurrent DB operations tới vùng pending tăng rồi dừng.
- **Then / oracle và cách đánh giá:** Phân biệt 503/timeout connection với server CPU saturation.
- **Metrics / bằng chứng cần lưu:** pending threads, acquire timeout, error burst.
- **Giới hạn an toàn / cleanup:** Không để mức nghẽn kéo dài nhiều phút ngoài cửa sổ dự kiến.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-DB-004 — Cursor messages trên bảng lớn [P0]
- **Given / tiền điều kiện:** Seed nhiều messages, có schema/index migration chuẩn.
- **When / workload và bước thực hiện:** Đo early/middle/deep cursor và đọc EXPLAIN cho SELECT.
- **Then / oracle và cách đánh giá:** Query path phù hợp, không kết luận chậm nếu chưa phân tích buffer/rows.
- **Metrics / bằng chứng cần lưu:** SQL plan, execution time, buffers, p95.
- **Giới hạn an toàn / cleanup:** Không sử dụng offset thay cursor khi chưa đối chiếu code.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-DB-005 — Cursor conversation trên user nhiều hội thoại [P0]
- **Given / tiền điều kiện:** User có 20/100/1000 conversations, có last message.
- **When / workload và bước thực hiện:** GET /conversations?limit=20 theo vị trí cursor khác nhau.
- **Then / oracle và cách đánh giá:** Quan sát query OR user_a/user_b và sort; không có full table scan bất lợi bất ngờ khi dữ liệu tăng.
- **Metrics / bằng chứng cần lưu:** query plans, IO, p95 by cardinality.
- **Giới hạn an toàn / cleanup:** Chỉ đánh giá EXPLAIN từ môi trường có index thật.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-DB-006 — Latest-message batch query [P0]
- **Given / tiền điều kiện:** Conversations có số lượng tin không đồng đều.
- **When / workload và bước thực hiện:** Load GET /conversations theo cohort 5/50/500 conv, đánh giá truy vấn latest message.
- **Then / oracle và cách đánh giá:** Không N+1 đáng kể theo số conversations; xác minh bằng SQL count.
- **Metrics / bằng chứng cần lưu:** SQL statements/request, buffers, p95.
- **Giới hạn an toàn / cleanup:** Không bật SQL logging verbose trong benchmark chính.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-DB-007 — Index sensitivity sau migrations [P1]
- **Given / tiền điều kiện:** Cấu hình migration giống deployment, seed DB lớn.
- **When / workload và bước thực hiện:** So plan và latency trước/sau thay đổi index trong bản benchmark clone.
- **Then / oracle và cách đánh giá:** Báo cáo chứng cứ SQL plan và delta, không tự thêm index vào production.
- **Metrics / bằng chứng cần lưu:** index usage, p95, write overhead.
- **Giới hạn an toàn / cleanup:** Chỉ chỉnh schema trong branch test có kiểm soát.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-DB-008 — DB data growth trong test ghi dài [P0]
- **Given / tiền điều kiện:** Seed cố định trước chạy, có quota storage.
- **When / workload và bước thực hiện:** POST messages ổn định đủ dài để table/index phình to, đo latency theo thời gian.
- **Then / oracle và cách đánh giá:** Phân biệt ảnh hưởng write amplification và bảng tăng so với JIT/GC.
- **Metrics / bằng chứng cần lưu:** rows/s, index bytes, vacuum stats, p95 by window.
- **Giới hạn an toàn / cleanup:** Cleanup snapshot sau bài, dừng khi disk gần full.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-DB-009 — Checkpoint/vacuum tác động latency [P1]
- **Given / tiền điều kiện:** PostgreSQL test có metrics checkpoint/vacuum.
- **When / workload và bước thực hiện:** Chạy read-write workload qua nhiều thời điểm, đối chiếu spike latency với DB background work.
- **Then / oracle và cách đánh giá:** Có bằng chứng temporal correlation, chưa khẳng định causal nếu chỉ trùng thời điểm.
- **Metrics / bằng chứng cần lưu:** checkpoint writes, WAL, autovacuum, IO, p99.
- **Giới hạn an toàn / cleanup:** Không tắt autovacuum bừa để làm số liệu đẹp.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-DB-010 — Lock wait/transaction scope từ status updates [P1]
- **Given / tiền điều kiện:** Nhiều message riêng và một hotspot message, oracle T07 cho dữ liệu đúng.
- **When / workload và bước thực hiện:** Đo riêng hot-row vs distributed updates.
- **Then / oracle và cách đánh giá:** Chênh lệch có SQL locks evidence; không làm mất trạng thái.
- **Metrics / bằng chứng cần lưu:** lock wait time, p99, rows updated.
- **Giới hạn an toàn / cleanup:** Không trộn correctness race với việc kết luận capacity.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-DB-011 — Read/write concurrency hỗn hợp [P0]
- **Given / tiền điều kiện:** Seed users/pairs, GET history+POST messages theo tỷ lệ xác định.
- **When / workload và bước thực hiện:** Tăng tổng arrival rate giữ tỷ lệ READ/WRITE.
- **Then / oracle và cách đánh giá:** Đo tác động write lên read p95 và DB; correctness giữ.
- **Metrics / bằng chứng cần lưu:** read p95, write p95, DB CPU/IO/locks.
- **Giới hạn an toàn / cleanup:** Chỉ so run có cùng mix và dataset.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-DB-012 — Connection leak sau tải dài [P1]
- **Given / tiền điều kiện:** Có Hikari metrics/pg_stat_activity.
- **When / workload và bước thực hiện:** So active/idle trước, trong, sau soak với cùng workload.
- **Then / oracle và cách đánh giá:** Active quay về mức bình thường; số connection không tăng vô hạn.
- **Metrics / bằng chứng cần lưu:** Hikari active, DB sessions, pool timeouts.
- **Giới hạn an toàn / cleanup:** Một sample hậu test chưa đủ; quan sát window ổn định.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-DB-013 — DB timeouts và pool protection [P1]
- **Given / tiền điều kiện:** Timeout config đã biết, pool saturated test giới hạn ngắn.
- **When / workload và bước thực hiện:** Đo request khi vượt capacity và sau khi hạ tải.
- **Then / oracle và cách đánh giá:** Không cascade lỗi dai dẳng; nếu có, phân loại FAIL_PRODUCT hoặc FAIL_EXPECTED_POLICY theo spec.
- **Metrics / bằng chứng cần lưu:** 5xx by class, time to recover, queue length.
- **Giới hạn an toàn / cleanup:** Không cố ý kill DB ở đây (thuộc T07).
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-DB-014 — So sánh throughput theo kích thước response [P2]
- **Given / tiền điều kiện:** Hai message fixtures cùng số rows nhưng content kích thước khác.
- **When / workload và bước thực hiện:** GET history với payload nhỏ/vừa/lớn; giữ row count/limit tương đương.
- **Then / oracle và cách đánh giá:** Biết overhead serialize/network vs SQL; báo cáo payload bytes.
- **Metrics / bằng chứng cần lưu:** response bytes, CPU, net TX, p95.
- **Giới hạn an toàn / cleanup:** Không so các cohort mà không kiểm tra payload length.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

### 6.7. RED — Redis xác thực, Pub/Sub, rate limiter và tác động realtime

**Mục tiêu nhóm:** Phân biệt Redis command bottleneck với chi phí fan-out và trạng thái nghiệp vụ.

#### T08-RED-001 — Redis read trên protected HTTP [P0]
- **Given / tiền điều kiện:** JWT valid, đủ users/requests, Redis metrics.
- **When / workload và bước thực hiện:** Tăng GET protected RPS bằng workload nhẹ, theo dõi ops/sec tương ứng.
- **Then / oracle và cách đánh giá:** Redis auth check không là nguyên nhân suy đoán nếu không có latency evidence.
- **Metrics / bằng chứng cần lưu:** GET latency, Redis reads/s, command p95.
- **Giới hạn an toàn / cleanup:** Không tắt revoke check để so benchmark nếu chưa là experiment riêng.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-RED-002 — Redis revocation key cardinality [P1]
- **Given / tiền điều kiện:** Test users có logout, TTL được biết từ config.
- **When / workload và bước thực hiện:** Chạy login/logout có kiểm soát, theo dõi số key và memory theo thời gian.
- **Then / oracle và cách đánh giá:** Không tăng keys không giới hạn vượt TTL/policy.
- **Metrics / bằng chứng cần lưu:** keys, memory, evictions, latency.
- **Giới hạn an toàn / cleanup:** Xóa namespace test sau.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-RED-003 — Publish NEW_MESSAGE tăng đều [P0]
- **Given / tiền điều kiện:** B mở WS, POST tin mới với IDs riêng, Redis listener active.
- **When / workload và bước thực hiện:** Tăng messages/s theo bậc, thu publish rate và receiver delivery rate.
- **Then / oracle và cách đánh giá:** Chênh created/delivered được báo rõ; không dùng Redis Pub/Sub làm nguồn persisted.
- **Metrics / bằng chứng cần lưu:** pubsub msgs/s, post p95, WS lag, loss.
- **Giới hạn an toàn / cleanup:** Không coi Pub/Sub là durable queue.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-RED-004 — Fan-out 1→N socket của cùng user [P0]
- **Given / tiền điều kiện:** B có 1/2/5/10 socket hợp lệ, registry và WS instrument.
- **When / workload và bước thực hiện:** A POST cùng một message mỗi round, B nhận N event khớp ID.
- **Then / oracle và cách đánh giá:** Đo event delivery percent và lag theo N socket, không nhầm số socket với số users.
- **Metrics / bằng chứng cần lưu:** WS deliveries/s, Redis listener cost, CPU.
- **Giới hạn an toàn / cleanup:** Thu hồi session sau mỗi round.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-RED-005 — Fan-out nhiều người nhận độc lập [P1]
- **Given / tiền điều kiện:** N pairs độc lập trên backend 1 instance.
- **When / workload và bước thực hiện:** Mỗi sender POST; cùng thời điểm mỗi receiver có một WS.
- **Then / oracle và cách đánh giá:** Event không sang nhầm user; lag không tăng bất hợp lý theo số pairs.
- **Metrics / bằng chứng cần lưu:** delivery p95/p99, listener CPU, WS closes.
- **Giới hạn an toàn / cleanup:** Token/connection count trong ngân sách.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-RED-006 — Redis listener với slow receiver [P0]
- **Given / tiền điều kiện:** Một socket nhận chậm và nhiều socket bình thường, bộ đệm WS có giới hạn.
- **When / workload và bước thực hiện:** Chạy publish rate thấp→vừa, giữ client chậm không đọc hoặc network throttling có kiểm soát.
- **Then / oracle và cách đánh giá:** Socket chậm không làm đơ toàn bộ receiver khỏe; phân tích listener scheduling.
- **Metrics / bằng chứng cần lưu:** normal vs slow lag, buffers, listener processing.
- **Giới hạn an toàn / cleanup:** Giới hạn RAM/buffer để tránh OOM; liên hệ T07.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-RED-007 — Tác động publish sync afterCommit lên POST [P0]
- **Given / tiền điều kiện:** Instrument post-commit Redis publish, baseline khi Redis khỏe.
- **When / workload và bước thực hiện:** Tăng message load rồi đối chiếu thời gian DB commit→publish→HTTP complete.
- **Then / oracle và cách đánh giá:** Có chứng cứ phần publish đóng góp bao nhiêu vào POST tail; không kết luận bằng suy đoán.
- **Metrics / bằng chứng cần lưu:** commit-to-publish ms, post p95, Redis p95.
- **Giới hạn an toàn / cleanup:** Không cố ý làm Redis chết trong bài này.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-RED-008 — Redis rate limiter user search [P1]
- **Given / tiền điều kiện:** Xác định route và giới hạn rate ở source/runtime.
- **When / workload và bước thực hiện:** Gửi POST /users/search với JSON {email} theo rates dưới và trên ngưỡng, user khác nhau/tương đồng.
- **Then / oracle và cách đánh giá:** Xác minh 429 theo policy, throttle isolated theo key, p95 under-policy.
- **Metrics / bằng chứng cần lưu:** allowed RPS, throttled RPS, Redis ops.
- **Giới hạn an toàn / cleanup:** Không gán threshold mà chưa xác nhận.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-RED-009 — Redis rate limiter metrics [P1]
- **Given / tiền điều kiện:** Metrics payload hợp lệ và user fixtures.
- **When / workload và bước thực hiện:** Gửi POST /metrics/client dưới/vượt ngưỡng bằng hai cohorts.
- **Then / oracle và cách đánh giá:** Đếm 204/429 riêng; Redis key TTL đúng policy.
- **Metrics / bằng chứng cần lưu:** 429 onset, p95, used_memory.
- **Giới hạn an toàn / cleanup:** Giữ logger disk usage trong giới hạn.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-RED-010 — Redis network latency giả lập ở mức thấp [P1]
- **Given / tiền điều kiện:** Chỉ trong sandbox có network shaping, quy trình T07 đã xác minh.
- **When / workload và bước thực hiện:** Thêm RTT nhỏ định mức vào đường Redis, chạy cùng workload auth+message.
- **Then / oracle và cách đánh giá:** Đo độ nhạy p95 chứ chưa đánh giá failover; ghi RTT thực đo.
- **Metrics / bằng chứng cần lưu:** p95 delta, Redis command latency, WS lag.
- **Giới hạn an toàn / cleanup:** Không tạo packet loss mất dịch vụ trong bài hiệu năng thông thường.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-RED-011 — Subscriber reconnect sau phase tải [P1]
- **Given / tiền điều kiện:** Cơ chế reconnect/Redis PubSub test T07 đã PASS.
- **When / workload và bước thực hiện:** Chạy workload steady, chuyển sang recovery measurement sau khi restart listener trong env cô lập.
- **Then / oracle và cách đánh giá:** Thời gian delivery trở lại bình thường; DB messages persisted.
- **Metrics / bằng chứng cần lưu:** recovery time, delivery percent, CPU.
- **Giới hạn an toàn / cleanup:** Phân loại reliability case crossref, không làm default baseline.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-RED-012 — Redis memory/evictions dưới tải dài [P2]
- **Given / tiền điều kiện:** Redis test có limit RAM, namespace đo.
- **When / workload và bước thực hiện:** So INFO used_memory và evictions khi login+rate limit+upload sessions tăng.
- **Then / oracle và cách đánh giá:** Không evict nhầm key quan trọng nếu cấu hình yêu cầu; ghi memory trend.
- **Metrics / bằng chứng cần lưu:** RSS, used_memory, evictions, latency.
- **Giới hạn an toàn / cleanup:** Không gây Redis OOM trên shared host.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

### 6.8. WS — Messaging WebSocket: connection, heartbeat, fan-out và delivery latency

**Mục tiêu nhóm:** Đo số kết nối hữu dụng, độ trễ sự kiện và mức sử dụng tài nguyên theo socket.

#### T08-WS-001 — Kết nối messaging WS một user [P0]
- **Given / tiền điều kiện:** JWT valid, route /ws/messaging, có PING/PONG handler.
- **When / workload và bước thực hiện:** Mở một WS, giữ 60s, phản hồi PONG khi PING, đóng sạch.
- **Then / oracle và cách đánh giá:** Socket mở, giữ sống, đóng đúng; không gửi message business giả.
- **Metrics / bằng chứng cần lưu:** connect latency, ping RTT, close code, JVM threads.
- **Giới hạn an toàn / cleanup:** Token không lưu raw query trong log.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WS-002 — Nhiều WS của một user [P0]
- **Given / tiền điều kiện:** A có một token/đa device theo policy.
- **When / workload và bước thực hiện:** Mở 1→2→5→10 socket của cùng user, không tải message.
- **Then / oracle và cách đánh giá:** Tất cả hợp lệ hoạt động, active socket count đúng; không leak sau close.
- **Metrics / bằng chứng cần lưu:** handshakes/s, memory/socket, FD, Redis reads.
- **Giới hạn an toàn / cleanup:** Chỉ dùng nhiều socket nếu contract cho phép.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WS-003 — Tăng số user WS đồng thời [P0]
- **Given / tiền điều kiện:** Seed 10/50/100/250+ test users tùy headroom, mỗi user 1 socket.
- **When / workload và bước thực hiện:** Ramped connection setup, giữ từng bậc đủ thời gian heartbeat.
- **Then / oracle và cách đánh giá:** Active authenticated sockets đạt mức; close/error count theo phase.
- **Metrics / bằng chứng cần lưu:** max stable sockets, p95 handshake, CPU/RAM/FD.
- **Giới hạn an toàn / cleanup:** Số mục tiêu chỉ khảo sát, stop theo giới hạn hệ thống.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WS-004 — Tốc độ thiết lập socket burst [P1]
- **Given / tiền điều kiện:** Có ngân sách handshake/s, token test còn hạn.
- **When / workload và bước thực hiện:** Tạo burst ngắn cùng nhiều user; sau đó giữ socket.
- **Then / oracle và cách đánh giá:** Không có lỗi bất thường so với policy; đo thời gian phục hồi sau burst.
- **Metrics / bằng chứng cần lưu:** successful handshakes/s, p95 setup, 5xx/close.
- **Giới hạn an toàn / cleanup:** Đừng kết luận ổn định chỉ vì open succeeded mà không giữ heartbeat.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WS-005 — Giữ idle WS lâu dài [P0]
- **Given / tiền điều kiện:** N sockets ở mức vừa, tất cả trả PONG.
- **When / workload và bước thực hiện:** Giữ trong khoảng nhiều chu kỳ heartbeat; không gửi message nghiệp vụ.
- **Then / oracle và cách đánh giá:** Active count ổn định, không memory/session leak, Redis load được đo.
- **Metrics / bằng chứng cần lưu:** ping scheduled/s, RSS slope, disconnects.
- **Giới hạn an toàn / cleanup:** Nếu test quá hạn JWT, refresh/reconnect theo hợp đồng.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WS-006 — Nhiều socket và heartbeat cùng lúc [P0]
- **Given / tiền điều kiện:** N sockets tạo lệch pha và tạo cùng pha ở các run riêng.
- **When / workload và bước thực hiện:** Đo khi scheduler phải phát PING và kiểm tra token cho nhiều session trong một window.
- **Then / oracle và cách đánh giá:** Không có false close do heartbeat scheduler delay ở tải dưới ngưỡng đã chốt.
- **Metrics / bằng chứng cần lưu:** heartbeat jitter, Redis p95, 2-thread scheduler queue if instrumented.
- **Giới hạn an toàn / cleanup:** Không suy scheduler HTTP chỉ vì cấu hình 2 threads.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WS-007 — Tăng số tab B nhận một tin [P0]
- **Given / tiền điều kiện:** B có 1/2/5/10 WS, A gửi HTTP message UUID mới.
- **When / workload và bước thực hiện:** Mỗi socket B chờ NEW_MESSAGE tương quan ID; đo fan-out.
- **Then / oracle và cách đánh giá:** N events delivered, đúng payload, không duplicate trên cùng socket ngoài policy.
- **Metrics / bằng chứng cần lưu:** per-socket delivery p95/p99, event fanout/s.
- **Giới hạn an toàn / cleanup:** Không đếm N fan-outs là N created messages.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WS-008 — Độ trễ HTTP POST→NEW_MESSAGE ở mức tải thấp [P0]
- **Given / tiền điều kiện:** Một A/B pair, B WS mở ổn định; cùng clock generator.
- **When / workload và bước thực hiện:** A POST, đo từ trước request tới event nhận, so với thời gian POST response.
- **Then / oracle và cách đánh giá:** Event đúng UUID, DB created; phân biệt timings.
- **Metrics / bằng chứng cần lưu:** post p95, send→receive p95/p99, lag.
- **Giới hạn an toàn / cleanup:** Không tính timeout event thành sample latency thành công.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WS-009 — Delivery nhiều pairs tại 5/10/20/50 VU [P0]
- **Given / tiền điều kiện:** Mỗi VU pair A/B, receiver WS sẵn, unique UUID.
- **When / workload và bước thực hiện:** A gửi HTTP với think time, B chờ event, tăng workers theo bậc.
- **Then / oracle và cách đánh giá:** created count≈delivered đúng trong window+drain, mất/nhầm/duplicate rõ.
- **Metrics / bằng chứng cần lưu:** created/s, delivered/s, end-to-end p99, loss%.
- **Giới hạn an toàn / cleanup:** Warmup và drain cuối phase, đừng coi in-flight chưa hết là lost ngay.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WS-010 — Delivery hotspot một receiver [P1]
- **Given / tiền điều kiện:** N senders có quyền hợp lệ gửi đến B qua các conversation, một WS B.
- **When / workload và bước thực hiện:** Gửi đồng thời với unique IDs theo workload định nghĩa.
- **Then / oracle và cách đánh giá:** Thứ tự/per-conversation policy được tôn trọng; delivery không bị gửi nhầm.
- **Metrics / bằng chứng cần lưu:** receiver events/s, backlog proxy, p99, drops.
- **Giới hạn an toàn / cleanup:** Dừng trước buffer memory limit.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WS-011 — Typing events sustained [P1]
- **Given / tiền điều kiện:** A/B có conversation, WS mở; throttle gửi typing hợp lý.
- **When / workload và bước thực hiện:** Gửi TYPING/TYPING_STOP theo tần suất người dùng, đo nhận B.
- **Then / oracle và cách đánh giá:** Event hợp đồng đến đúng bên; không ép typing trở thành durable.
- **Metrics / bằng chứng cần lưu:** typing events/s, latency, Redis CPU.
- **Giới hạn an toàn / cleanup:** Không gửi tốc độ phi thực tế mà không tách mục stress.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WS-012 — Typing bursts [P2]
- **Given / tiền điều kiện:** N conversations và per-user bounded burst.
- **When / workload và bước thực hiện:** Tạo loạt typing trong cửa sổ ngắn rồi nghỉ.
- **Then / oracle và cách đánh giá:** Không cản NEW_MESSAGE hoặc heartbeat; error/close được ghi.
- **Metrics / bằng chứng cần lưu:** WS event lag, p99 NEW_MESSAGE, dropped.
- **Giới hạn an toàn / cleanup:** Tránh flooding vượt hợp đồng chống lạm dụng.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WS-013 — Read receipt WS propagation [P1]
- **Given / tiền điều kiện:** A gửi tin, B nhận rồi PUT status read.
- **When / workload và bước thực hiện:** A đo MESSAGE_STATUS_UPDATE tương quan message ID.
- **Then / oracle và cách đánh giá:** DB status cuối đúng; receipt lag đo riêng từ PUT, không nhầm với NEW_MESSAGE.
- **Metrics / bằng chứng cần lưu:** PUT p95, receipt p95, loss%.
- **Giới hạn an toàn / cleanup:** Reset message fixture từng loop.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WS-014 — Reconnect rate sau network drop ngắn [P1]
- **Given / tiền điều kiện:** T07 reconnection correctness đã xác minh; N test sockets.
- **When / workload và bước thực hiện:** Cho một cohort disconnect có kiểm soát rồi reconnect lại từ token hợp lệ.
- **Then / oracle và cách đánh giá:** Server khôi phục active count, không leak registry, history có tin offline.
- **Metrics / bằng chứng cần lưu:** reconnect success/s, reconnect p95, memory.
- **Giới hạn an toàn / cleanup:** Chỉ thực hiện fault injection trong env riêng.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WS-015 — Slow receiver vs healthy receiver latency [P0]
- **Given / tiền điều kiện:** Có thể throttle đầu nhận B1; B2 đọc bình thường.
- **When / workload và bước thực hiện:** Publish các tin vào pairs có receiver chậm/khỏe, theo dõi Redis subscriber và WS send buffer.
- **Then / oracle và cách đánh giá:** Healthy không bị starvation kéo dài ngoài ngưỡng nghiên cứu; B1 có thể bị đóng theo policy.
- **Metrics / bằng chứng cần lưu:** healthy p99, send buffer, WS errors.
- **Giới hạn an toàn / cleanup:** Stop khi gần buffer/quota; không giữ client vô hạn.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WS-016 — Socket close và cleanup sau spike [P0]
- **Given / tiền điều kiện:** Đã mở N WS, có metrics registry/thread/FD.
- **When / workload và bước thực hiện:** Đóng chủ động phần lớn sockets và giữ một cohort; chờ cleanup ổn định.
- **Then / oracle và cách đánh giá:** Socket count/RSS/FD về mức bình thường, không còn session ghost.
- **Metrics / bằng chứng cần lưu:** cleanup time, heap/FD baseline delta.
- **Giới hạn an toàn / cleanup:** Phân biệt GC memory retained với leak đã xác minh.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WS-017 — Mở WS token gần hết hạn [P1]
- **Given / tiền điều kiện:** Biết expiry runtime và refresh policy.
- **When / workload và bước thực hiện:** Giữ WS qua thời điểm expiry, đo lần close và khả năng mở lại bằng token mới.
- **Then / oracle và cách đánh giá:** Hành vi theo contract; không nhầm expected close là availability error.
- **Metrics / bằng chứng cần lưu:** close timing, handshake recovery, auth Redis calls.
- **Giới hạn an toàn / cleanup:** Không tự kéo dài access token để đẹp số liệu.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WS-018 — RPS HTTP ổn định trong lúc WS idle lớn [P0]
- **Given / tiền điều kiện:** N WS idle đang giữ heartbeat, fixed read/write API workload.
- **When / workload và bước thực hiện:** So HTTP-only vs HTTP+N WS cùng CPU/DB host.
- **Then / oracle và cách đánh giá:** Định lượng chi phí nền của session, không kết luận từ khác biệt chưa kiểm soát.
- **Metrics / bằng chứng cần lưu:** HTTP p95 delta, JVM/Redis CPU, RAM, FD.
- **Giới hạn an toàn / cleanup:** Hai run cùng seed/config/arrival rate.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-WS-019 — Delivery correctness dưới stress WS [P1]
- **Given / tiền điều kiện:** N receivers/senders, correlation UUID và drain window.
- **When / workload và bước thực hiện:** Tăng message arrival tới vùng tail tăng có kiểm soát.
- **Then / oracle và cách đánh giá:** Report delivery ratio và duplicates cùng capacity, không chỉ throughput tốt.
- **Metrics / bằng chứng cần lưu:** p99, delivered/new, duplicates, closes.
- **Giới hạn an toàn / cleanup:** Stop nếu mất event vượt rào an toàn đã định.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

### 6.9. SIG — Node.js Signaling và latency gọi điện trước WebRTC media

**Mục tiêu nhóm:** Đo signaling events thật với Node process nhưng không nhận nhầm đây là benchmark audio/video WebRTC.

#### T08-SIG-001 — Handshake signaling 1 connection [P0]
- **Given / tiền điều kiện:** User đăng nhập thật và signaling server chạy; E10 chưa sửa thì đánh dấu rủi ro.
- **When / workload và bước thực hiện:** Đo mở /ws/signaling với token hợp lệ, giữ kết nối, đóng sạch.
- **Then / oracle và cách đánh giá:** Auth success và close hợp đồng; ghi rõ E10 cũ là blocker nghiệm thu bảo mật.
- **Metrics / bằng chứng cần lưu:** handshake p95, CPU Node, active sockets.
- **Giới hạn an toàn / cleanup:** Không coi signaling an toàn chỉ vì handshake thành công.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-SIG-002 — Handshake signaling nhiều users [P1]
- **Given / tiền điều kiện:** N test users, token hợp lệ và Node resource metrics.
- **When / workload và bước thực hiện:** Tăng 10/50/100+ sockets theo bậc, giữ kết nối idle.
- **Then / oracle và cách đánh giá:** Active count đúng, heartbeat/timing theo code hiện hành.
- **Metrics / bằng chứng cần lưu:** sockets, RAM/FD Node, handshake errors.
- **Giới hạn an toàn / cleanup:** Không ép node process vượt memory limit.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-SIG-003 — Offer khi hai bên online [P0]
- **Given / tiền điều kiện:** A/B signaling sẵn, B messaging nhận CALL_INCOMING, hợp đồng E08.
- **When / workload và bước thực hiện:** A CALL_OFFER, B nhận offer, gửi ANSWER; đo round trip.
- **Then / oracle và cách đánh giá:** Payload correlation đúng A/B, Node relay thành công; không media claim.
- **Metrics / bằng chứng cần lưu:** offer→answer p95/p99, events/s.
- **Giới hạn an toàn / cleanup:** Fixture SDP test chỉ chứng minh relay.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-SIG-004 — Offer sau CALL_INCOMING khi B mở signaling muộn [P0]
- **Given / tiền điều kiện:** E09 đang FAIL theo báo cáo 19/10; B ban đầu chỉ mở messaging.
- **When / workload và bước thực hiện:** A offer, B nhận CALL_INCOMING rồi mới mở signaling, đo time-to-offer theo window đã chốt.
- **Then / oracle và cách đánh giá:** Offer đến mà A không phải gửi lại theo nghiệp vụ đã cam kết; nếu chưa sửa đánh BLOCKED_PRODUCT.
- **Metrics / bằng chứng cần lưu:** late-join success%, offer delay, errors TARGET_OFFLINE.
- **Giới hạn an toàn / cleanup:** Không sửa assertion để hợp thức hóa lỗi cũ.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-SIG-005 — CALL_OFFER thông báo Spring Boot→Redis→Messaging [P0]
- **Given / tiền điều kiện:** A/B accounts, B messaging WS; signaling Node.
- **When / workload và bước thực hiện:** Đo từ A gửi offer đến CALL_INCOMING tại B, tách internal notify latency.
- **Then / oracle và cách đánh giá:** Event đến đúng user, correlation caller đúng.
- **Metrics / bằng chứng cần lưu:** end-to-end notification p95/p99, internal HTTP duration.
- **Giới hạn an toàn / cleanup:** Giữ routing và secrets test đúng cấu hình.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-SIG-006 — Answer relay sustained [P1]
- **Given / tiền điều kiện:** Cặp A/B có offer pending hợp lệ cho từng run.
- **When / workload và bước thực hiện:** B gửi ANSWER, A nhận tương quan call; nhiều pairs theo arrival rate.
- **Then / oracle và cách đánh giá:** Không lẫn lời đáp cuộc gọi; theo dõi Node event loop.
- **Metrics / bằng chứng cần lưu:** answer p95, Node CPU, lag.
- **Giới hạn an toàn / cleanup:** Reset state sau mỗi call, không dùng một cuộc gọi vô hạn.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-SIG-007 — ICE candidate relay sustained [P1]
- **Given / tiền điều kiện:** Các cuộc gọi đang thiết lập có session hợp lệ.
- **When / workload và bước thực hiện:** Gửi số lượng ICE messages/offer theo profile thực tế giả định có ghi rõ.
- **Then / oracle và cách đánh giá:** Candidate đúng bên, đúng call; throughput candidate không là successful calls.
- **Metrics / bằng chứng cần lưu:** ICE msgs/s, relay lag p95, dropped.
- **Giới hạn an toàn / cleanup:** Payload mô phỏng không chứng minh ICE connectivity thật.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-SIG-008 — Call end / cleanup latency [P1]
- **Given / tiền điều kiện:** Calls active hoặc pending, state record nếu có.
- **When / workload và bước thực hiện:** Gửi CALL_END đúng trình tự; quan sát trạng thái socket/map sau end.
- **Then / oracle và cách đánh giá:** Không còn pending call bị giữ trái policy, end event đến đích.
- **Metrics / bằng chứng cần lưu:** end p95, pending map size, memory.
- **Giới hạn an toàn / cleanup:** Không gửi call end dồn dập lên cuộc gọi đã kết thúc trừ bài riêng.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-SIG-009 — Call setup concurrency theo số pairs [P0]
- **Given / tiền điều kiện:** N pairs độc lập, B online hoặc late join thành hai cohorts.
- **When / workload và bước thực hiện:** 5→10→20→50 cuộc gọi đồng thời; mỗi call có offer/answer/ICE/end.
- **Then / oracle và cách đánh giá:** Call setup successes, timeouts và đúng target; p95 theo online cohort.
- **Metrics / bằng chứng cần lưu:** setup/s, p95/p99, Node event loop lag, CPU.
- **Giới hạn an toàn / cleanup:** Ghi rõ 'concurrent calls' chỉ là state/signaling, chưa có media.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-SIG-010 — Target offline response theo policy [P1]
- **Given / tiền điều kiện:** B offline và yêu cầu CALL_OFFER, chính sách offline được chốt.
- **When / workload và bước thực hiện:** Gửi controlled offers, đo TARGET_OFFLINE hoặc cơ chế pending mới.
- **Then / oracle và cách đánh giá:** Expected rõ, không tính offline policy failure thành capacity lỗi.
- **Metrics / bằng chứng cần lưu:** response time, policy error rate.
- **Giới hạn an toàn / cleanup:** E09 có thể thay đổi policy nên đối chiếu source mới nhất.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-SIG-011 — Signaling JWT revoke dưới load [P0]
- **Given / tiền điều kiện:** E10 hiện FAIL trong báo cáo, dùng token logout thật.
- **When / workload và bước thực hiện:** Xen tỷ lệ rất nhỏ reconnect sau revoke để kiểm tra không được chấp nhận.
- **Then / oracle và cách đánh giá:** Nếu token bị chấp nhận thì FAIL_SECURITY; capacity run chỉ nghiệm thu khi đã khắc phục.
- **Metrics / bằng chứng cần lưu:** unauthorized accepts, WS close codes, Node auth time.
- **Giới hạn an toàn / cleanup:** Không dùng token không hợp lệ làm phần lớn workload throughput.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-SIG-012 — Node.js event loop delay [P0]
- **Given / tiền điều kiện:** Có lag monitor Node trong sandbox, các route signaling đang hoạt động.
- **When / workload và bước thực hiện:** Đo event-loop lag qua steady→burst calls/ICE, đối chiếu relay latency.
- **Then / oracle và cách đánh giá:** Tách Node blocking vs Spring internal notify vs network; tránh suy từ CPU riêng.
- **Metrics / bằng chứng cần lưu:** event loop p95/p99, heap, CPU, messages/s.
- **Giới hạn an toàn / cleanup:** Instrumentation overhead phải cố định giữa runs.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-SIG-013 — Spring backend bị tải HTTP khi signaling chạy [P1]
- **Given / tiền điều kiện:** Fixed call setup stream có internal backend notify, HTTP workload cơ sở.
- **When / workload và bước thực hiện:** So HTTP-only, signaling-only và combined trong cấu hình giống nhau.
- **Then / oracle và cách đánh giá:** Cross-impact được đo định lượng, không lấy 2 run khác host so trực tiếp.
- **Metrics / bằng chứng cần lưu:** HTTP p95 delta, notify p95, Node/Spring CPU.
- **Giới hạn an toàn / cleanup:** Không tạo media traffic giả tạo gán vào signaling.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

### 6.10. VID — MinIO multipart, metadata, quota và webhook

**Mục tiêu nhóm:** Đo cả đường điều phối Java và truyền byte trực tiếp tới MinIO, giữ cleanup an toàn.

#### T08-VID-001 — Baseline POST /videos khởi tạo upload [P0]
- **Given / tiền điều kiện:** User test còn quota, bucket test riêng, cơ chế abort orphan hoạt động.
- **When / workload và bước thực hiện:** Khởi tạo phiên bằng title, estimated_size_bytes và chunk_size_bytes ≥ 5 MiB.
- **Then / oracle và cách đánh giá:** HTTP 201 và upload metadata hợp lệ, Redis session tồn tại; đo time-to-init.
- **Metrics / bằng chứng cần lưu:** init p95, MinIO CreateMultipart time, Redis/DB latency.
- **Giới hạn an toàn / cleanup:** Không lặp trước khi có cơ chế cleanup multipart mồ côi.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-VID-002 — Chi phí tạo session theo số user [P1]
- **Given / tiền điều kiện:** Seed users quota riêng và bucket test.
- **When / workload và bước thực hiện:** POST /videos theo 5/10/20 users song song với trần session đang mở.
- **Then / oracle và cách đánh giá:** Đo throughput init, quota/DB state, session memory.
- **Metrics / bằng chứng cần lưu:** init/s, p95, Redis used_memory, MinIO pending sessions.
- **Giới hạn an toàn / cleanup:** Abort mọi session sau run.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-VID-003 — Phân biệt init metadata với upload bytes [P0]
- **Given / tiền điều kiện:** Một video fixture part 1 ≥ 5 MiB, part cuối nhỏ, MinIO thực.
- **When / workload và bước thực hiện:** Đo riêng POST /videos và PUT presigned first chunk.
- **Then / oracle và cách đánh giá:** Hai metric tách biệt; response backend không được báo là đã truyền file.
- **Metrics / bằng chứng cần lưu:** init p95, PUT bytes/s, MinIO CPU/Net.
- **Giới hạn an toàn / cleanup:** URL signed không được log; không tính file transfer vào Spring RPS.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-VID-004 — Presigned PUT một part 5 MiB [P0]
- **Given / tiền điều kiện:** Upload session hợp lệ còn sống và PUT URL mới.
- **When / workload và bước thực hiện:** PUT 5 MiB fixture qua MinIO, lưu ETag, validate bytes.
- **Then / oracle và cách đánh giá:** Content bytes đúng và part accepted; thời gian/throughput ghi riêng.
- **Metrics / bằng chứng cần lưu:** PUT p95, MiB/s, MinIO IO/CPU.
- **Giới hạn an toàn / cleanup:** Test riêng network-local vs external ingress.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-VID-005 — Presigned PUT nhiều kích thước file [P1]
- **Given / tiền điều kiện:** Fixtures 5/10/50/100 MiB với max budget.
- **When / workload và bước thực hiện:** Truyền bytes qua các kích thước, giữ network/config cố định.
- **Then / oracle và cách đánh giá:** Throughput theo bytes và thời gian không chỉ request/s; SHA-256 cuối.
- **Metrics / bằng chứng cần lưu:** transfer Mbps, p95, retransmits.
- **Giới hạn an toàn / cleanup:** Tránh file quá lớn nếu disk/RAM thấp.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-VID-006 — Upload multipart 2 phần hoàn chỉnh [P0]
- **Given / tiền điều kiện:** Video mới, part1=5MiB, part cuối nhỏ.
- **When / workload và bước thực hiện:** POST init→PUT part1→POST chunks→PUT part2→POST finalize→chờ READY.
- **Then / oracle và cách đánh giá:** Byte hash đúng, DB ready, Redis session gone; đo các đoạn.
- **Metrics / bằng chứng cần lưu:** time-to-ready p95, bytes/s, finalize p95.
- **Giới hạn an toàn / cleanup:** Dọn video/object sau run.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-VID-007 — Upload nhiều phần liên tục [P1]
- **Given / tiền điều kiện:** Video fixtures với số part 2/5/10, chunk size hợp lệ.
- **When / workload và bước thực hiện:** Thực hiện flow nhiều chunks tăng dần theo session.
- **Then / oracle và cách đánh giá:** Không lỗi ETag, thứ tự/total đúng; latency theo part count.
- **Metrics / bằng chứng cần lưu:** chunk-url p95, upload time, Redis ops.
- **Giới hạn an toàn / cleanup:** Budget disk theo sum bytes.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-VID-008 — POST chunks latency [P1]
- **Given / tiền điều kiện:** Upload đang có part trước upload thành công, ETag trước hợp lệ.
- **When / workload và bước thực hiện:** Gọi POST /videos/{id}/chunks sau mỗi part, đo riêng latency ký URL.
- **Then / oracle và cách đánh giá:** Không nhầm chunk metadata endpoint với PUT trực tiếp MinIO.
- **Metrics / bằng chứng cần lưu:** chunks/s, p95, Redis Lua ops.
- **Giới hạn an toàn / cleanup:** Không phát URL cho part không tồn tại trong flow.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-VID-009 — POST finalize latency [P0]
- **Given / tiền điều kiện:** Tất cả parts upload xong, ETags chuẩn, quota còn.
- **When / workload và bước thực hiện:** POST /videos/{id}/finalize, lấy 202 rồi chờ webhook READY theo timeout hợp đồng.
- **Then / oracle và cách đánh giá:** Finalize response p95 riêng và READY lag riêng; state consistent.
- **Metrics / bằng chứng cần lưu:** finalize p95, MinIO complete latency, webhook lag.
- **Giới hạn an toàn / cleanup:** Chỉ finalize một lần/video trong profile baseline.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-VID-010 — Webhook time-to-ready [P0]
- **Given / tiền điều kiện:** MinIO webhook thật đã bật, video processing.
- **When / workload và bước thực hiện:** Quan sát từ complete thành công đến DB status READY, lấy server timestamps/correlation.
- **Then / oracle và cách đánh giá:** READY đúng video, Redis session cleanup, không sai account/quota.
- **Metrics / bằng chứng cần lưu:** webhook delivery p95, processing p95, retries.
- **Giới hạn an toàn / cleanup:** Không bắn webhook giả thay thế integration thật.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-VID-011 — GET library theo số video [P0]
- **Given / tiền điều kiện:** Seed 0/20/100/500 metadata video/user, trạng thái đa dạng.
- **When / workload và bước thực hiện:** GET /videos?limit=20 và cursor, so lat theo cardinality.
- **Then / oracle và cách đánh giá:** Thứ tự/cursor đúng; thời gian đi theo storage count được mô tả.
- **Metrics / bằng chứng cần lưu:** p95, SQL plan, DB IO.
- **Giới hạn an toàn / cleanup:** Không cần upload 500 file lớn để benchmark metadata.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-VID-012 — GET video detail/GET presigned download [P1]
- **Given / tiền điều kiện:** Video READY với object bytes thật.
- **When / workload và bước thực hiện:** Đo GET /videos/{id} lấy signed URL, rồi GET trực tiếp MinIO ở bài đo riêng.
- **Then / oracle và cách đánh giá:** Metadata latency không nhầm với download throughput.
- **Metrics / bằng chứng cần lưu:** detail p95, download Mbps, MinIO IO.
- **Giới hạn an toàn / cleanup:** Không chia sẻ URL hết hạn giữa VUs.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-VID-013 — Download nhiều người dùng song song [P1]
- **Given / tiền điều kiện:** Mỗi user có video riêng và signed URL hợp lệ.
- **When / workload và bước thực hiện:** Tăng số download song song MinIO theo cap băng thông.
- **Then / oracle và cách đánh giá:** MiB/s, p95 download và object integrity đúng; Spring metadata load theo thiết kế.
- **Metrics / bằng chứng cần lưu:** MinIO net/disk, complete downloads/s, failed bytes.
- **Giới hạn an toàn / cleanup:** Không stream nội dung file qua Spring API ngoài cấu trúc thực tế.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-VID-014 — Quota check cùng lúc nhiều người dùng [P0]
- **Given / tiền điều kiện:** Seed quota và video sessions theo user, T07 quota correctness đã PASS.
- **When / workload và bước thực hiện:** Khởi tạo upload/finalize hợp lệ phân tán users.
- **Then / oracle và cách đánh giá:** Không tạo overquota data, throughput theo quota state.
- **Metrics / bằng chứng cần lưu:** quota lock wait, p99, rejects.
- **Giới hạn an toàn / cleanup:** Giới hạn quota không để hết disk.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-VID-015 — Hotspot quota một user [P1]
- **Given / tiền điều kiện:** Một user có nhiều recordings và quota gần ngưỡng.
- **When / workload và bước thực hiện:** Tạo/finalize serial vs concurrent ở tải thấp/vừa, so Redis lock contention.
- **Then / oracle và cách đánh giá:** Dữ liệu và quota không sai, lock wait có metric.
- **Metrics / bằng chứng cần lưu:** Redis lock contention, p99, operations/s.
- **Giới hạn an toàn / cleanup:** Không đưa race correctness chưa pass vào stress lớn.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-VID-016 — Delete video và cleanup cost [P1]
- **Given / tiền điều kiện:** Video ready thật; background cleanup cấu hình quan sát được.
- **When / workload và bước thực hiện:** DELETE nhiều video ở tốc độ giới hạn, theo dõi object deletion và DB state.
- **Then / oracle và cách đánh giá:** 204 không che tình trạng object còn tồn; eventual cleanup theo policy.
- **Metrics / bằng chứng cần lưu:** delete p95, cleanup backlog, disk reclaimed.
- **Giới hạn an toàn / cleanup:** Reset test bucket và xác minh quota sau.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-VID-017 — Abort pending multipart latency [P0]
- **Given / tiền điều kiện:** Có phiên multipart hợp lệ chưa finalize.
- **When / workload và bước thực hiện:** POST /videos/{id}/abort, đối chiếu Redis và MinIO multipart còn lại.
- **Then / oracle và cách đánh giá:** Abort theo policy, không được bỏ orphan; chi phí đo riêng.
- **Metrics / bằng chứng cần lưu:** abort p95, MinIO abort time, sessions left.
- **Giới hạn an toàn / cleanup:** Tránh stress abort trước khi cleanup baseline pass.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-VID-018 — Orphan multipart detection dưới run dài [P0]
- **Given / tiền điều kiện:** Có quyền liệt kê pending multipart trong bucket test.
- **When / workload và bước thực hiện:** Chạy một số flow init→abort/finalize, kiểm count trước/sau và sau TTL cleanup.
- **Then / oracle và cách đánh giá:** Không tồn tài nguyên ngoài kế hoạch; nếu có thì fail và stop load write.
- **Metrics / bằng chứng cần lưu:** orphan multipart count, object bytes, cleanup lag.
- **Giới hạn an toàn / cleanup:** Đây là điều kiện an toàn bắt buộc trước soak video.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-VID-019 — Upload/download đồng thời với API messaging [P1]
- **Given / tiền điều kiện:** Cùng host hoặc mạng theo topology rõ; fixed messaging workload.
- **When / workload và bước thực hiện:** So HTTP messaging-only và messaging+MinIO PUT/GET trong cùng môi trường.
- **Then / oracle và cách đánh giá:** Tác động tài nguyên mạng/CPU được tách nguyên nhân.
- **Metrics / bằng chứng cần lưu:** msg p95 delta, NIC Mbps, MinIO disk, GC.
- **Giới hạn an toàn / cleanup:** Tách ingress MinIO khỏi Spring API metrics.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-VID-020 — Độ trễ video processing lâu hơn response finalize [P1]
- **Given / tiền điều kiện:** Video hoàn chỉnh, webhook polling theo bounded schedule.
- **When / workload và bước thực hiện:** Đo 202→READY trên nhiều phiên hoàn tất, ghi p95/p99 và timeout.
- **Then / oracle và cách đánh giá:** Không coi HTTP 202 là video READY; thống kê thành công chuyển trạng thái.
- **Metrics / bằng chứng cần lưu:** time-to-ready p99, stuck_processing count.
- **Giới hạn an toàn / cleanup:** Cleanup các phiên không READY đúng policy.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

### 6.11. MIX — Workload hỗn hợp mô phỏng người dùng VeilTalk

**Mục tiêu nhóm:** Đo khả năng phục vụ nhiều chức năng thực tế trong một môi trường, không lấy API nhanh nhất làm đại diện.

#### T08-MIX-001 — Workload nhắn tin 70% đọc 30% ghi [P0]
- **Given / tiền điều kiện:** Seed đa user/pair, tỉ lệ giả định nghiên cứu có ghi, kịch bản THINK TIME.
- **When / workload và bước thực hiện:** Mỗi VU xem hội thoại/history rồi có xác suất gửi tin; chạy stable rate.
- **Then / oracle và cách đánh giá:** Báo cả ops theo loại và tỷ lệ tổng; không khẳng định tỷ lệ là telemetry thực tế.
- **Metrics / bằng chứng cần lưu:** read/write p95, ops/s, DB/Redis.
- **Giới hạn an toàn / cleanup:** Tránh dồn mọi người vào một pair.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-MIX-002 — Workload đọc nhiều 90/10 [P1]
- **Given / tiền điều kiện:** Cùng dataset/hardware như mix 70/30.
- **When / workload và bước thực hiện:** Chạy read-heavy, giữ tổng offered rate như bài chuẩn.
- **Then / oracle và cách đánh giá:** Biết ảnh hưởng giảm write tới DB và tail read.
- **Metrics / bằng chứng cần lưu:** throughput, read p95, SQL IO.
- **Giới hạn an toàn / cleanup:** Không thay data seed giữa mix.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-MIX-003 — Workload ghi nhiều 50/50 [P1]
- **Given / tiền điều kiện:** User pairs độc lập, unique IDs, quota DB.
- **When / workload và bước thực hiện:** Chạy write-heavy, cùng tổng arrival và duration như baseline 70/30.
- **Then / oracle và cách đánh giá:** So tail/write/GC; không bỏ qua created count integrity.
- **Metrics / bằng chứng cần lưu:** p95/p99, successful messages/s, lock wait.
- **Giới hạn an toàn / cleanup:** Stop theo row/disk budget.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-MIX-004 — Workload mở app và đọc initial data [P0]
- **Given / tiền điều kiện:** Mô hình login/session, GET /users/me, avatar, conversations, first history.
- **When / workload và bước thực hiện:** User thực hiện chuỗi mở ứng dụng có pacing, đo thời gian cả journey.
- **Then / oracle và cách đánh giá:** Journey thành công trọn vẹn; per-step và journey p95.
- **Metrics / bằng chứng cần lưu:** journey duration, ops count, DB/Redis.
- **Giới hạn an toàn / cleanup:** Login lần nào cũng tạo refresh token: giới hạn tỷ lệ login.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-MIX-005 — Workload hội thoại có realtime WS [P0]
- **Given / tiền điều kiện:** B giữ WS, A gửi HTTP, hai bên GET history/status.
- **When / workload và bước thực hiện:** Mỗi pair mô phỏng gửi tin→WS receive→read receipt theo profile xác định.
- **Then / oracle và cách đánh giá:** Business correctness và event delivery p95 trong cùng workload.
- **Metrics / bằng chứng cần lưu:** valid journeys/s, HTTP p95, WS p99.
- **Giới hạn an toàn / cleanup:** Không đánh đồng WS messages/s với HTTP RPS.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-MIX-006 — Workload nhiều tab trên người nhận [P1]
- **Given / tiền điều kiện:** Một phần user có 2 hoặc 3 messaging sockets.
- **When / workload và bước thực hiện:** So với 1 socket/user với cùng số users và message rate.
- **Then / oracle và cách đánh giá:** Biết overhead fanout và WS memory; không tăng số người dùng vô thức.
- **Metrics / bằng chứng cần lưu:** socket count, event deliveries/s, p99.
- **Giới hạn an toàn / cleanup:** Đồng nhất user population giữa 2 runs.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-MIX-007 — Workload có call notification [P1]
- **Given / tiền điều kiện:** N pairs gọi signaling hợp lệ, E09/E10 đã sửa/nghiệm thu.
- **When / workload và bước thực hiện:** Trộn chat (đa số) với tỷ lệ nhỏ CALL_OFFER/ANSWER/END.
- **Then / oracle và cách đánh giá:** Call setup latency và messaging không suy giảm vượt mục tiêu khảo sát.
- **Metrics / bằng chứng cần lưu:** call setup p95, WS message p95, HTTP p95.
- **Giới hạn an toàn / cleanup:** Nếu E09/E10 fail, chỉ chạy để chẩn đoán, không nghiệm thu.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-MIX-008 — Workload có upload video hiếm [P1]
- **Given / tiền điều kiện:** Chỉ khi cleanup multipart an toàn và dữ liệu MinIO quota đủ.
- **When / workload và bước thực hiện:** Thêm tỉ lệ upload nhỏ trong nền chat; đo network/IO impact.
- **Then / oracle và cách đánh giá:** File bytes hash đúng, không orphan, read/chat metrics tách.
- **Metrics / bằng chứng cần lưu:** upload Mbps, chat p95, disk IO.
- **Giới hạn an toàn / cleanup:** Cap số phiên và bytes/run.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-MIX-009 — Mixed workload theo phân bố kích thước dữ liệu [P1]
- **Given / tiền điều kiện:** User cohorts small/medium/heavy: conversations 5/50/500; messages 20/100/10k.
- **When / workload và bước thực hiện:** Phân VUs cố định theo cohort, chạy một mix ổn định.
- **Then / oracle và cách đánh giá:** p95 mỗi cohort và tổng; tổng không che cohort heavy.
- **Metrics / bằng chứng cần lưu:** per-cohort latency, SQL IO, payload bytes.
- **Giới hạn an toàn / cleanup:** Chọn cohort tỉ lệ giả định, không gọi là phân bố production nếu chưa có bằng chứng.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-MIX-010 — Mixed workload đăng nhập và tái sử dụng session [P1]
- **Given / tiền điều kiện:** 5–10% users đăng nhập tại đầu session, phần còn lại reuse JWT theo luồng thật.
- **When / workload và bước thực hiện:** Chạy arrival sessions, tránh login mỗi iteration nếu người dùng thật không như vậy.
- **Then / oracle và cách đánh giá:** Thông lượng session/s và CPU BCrypt được tách.
- **Metrics / bằng chứng cần lưu:** sessions/s, login p95, app load p95.
- **Giới hạn an toàn / cleanup:** Tài khoản test đủ và giới hạn token rows.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-MIX-011 — Phân chia 100 conversations trên 2 backend instances [P2]
- **Given / tiền điều kiện:** Chỉ khi có hạ tầng multi-instance và Redis routing validated; không nằm trong MVP single instance.
- **When / workload và bước thực hiện:** So workload balanced/unbalanced giữa 2 instances, giữ tổng offered load.
- **Then / oracle và cách đánh giá:** Không claim scale tuyến tính khi session affinity/Redis fanout chưa kiểm chứng.
- **Metrics / bằng chứng cần lưu:** per-instance throughput, CPU, WS delivery.
- **Giới hạn an toàn / cleanup:** Tách báo cáo mở rộng, không gộp với single-instance baseline.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-MIX-012 — Kiểm chứng workload generator phát tải theo tỷ lệ thiết kế [P0]
- **Given / tiền điều kiện:** Mix được định nghĩa theo operation probabilities và pacing.
- **When / workload và bước thực hiện:** Đếm actual starts/completions theo route, so tỉ lệ planned vs actual mỗi phase.
- **Then / oracle và cách đánh giá:** Sai lệch được giải thích (dependency, timeout, think time); sửa harness nếu quá lớn.
- **Metrics / bằng chứng cần lưu:** planned/actual ratio, dropped iterations, request counts.
- **Giới hạn an toàn / cleanup:** Một mix sai phân bố không hợp lệ cho capacity claim.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

### 6.12. LOAD — Load, stress, spike, soak, capacity và recovery

**Mục tiêu nhóm:** Xác định vùng hoạt động ổn định có điều kiện, không suy capacity từ một lần chạy hoặc số VU.

#### T08-LOAD-001 — Steady baseline 1 VU cho mỗi route [P0]
- **Given / tiền điều kiện:** Script từng API đúng T04/T05, input fixture ổn định.
- **When / workload và bước thực hiện:** Đo 1 VU với think time cụ thể cho từng endpoint.
- **Then / oracle và cách đánh giá:** Có p95 và throughput baseline nhưng chưa gọi capacity.
- **Metrics / bằng chứng cần lưu:** duration avg/p95, req/s, valid_ops/s, CPU.
- **Giới hạn an toàn / cleanup:** Mỗi route tag riêng.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-LOAD-002 — Steady 5→10→20→50 VU cho GET history [P0]
- **Given / tiền điều kiện:** Seed messages 100+ và token active.
- **When / workload và bước thực hiện:** Giữ workload/think time giống nhau qua các bậc, đo steady mỗi bậc.
- **Then / oracle và cách đánh giá:** Ghi actual RPS, tail, errors và resources; không gọi 50 VU tương đương 50 RPS.
- **Metrics / bằng chứng cần lưu:** p95/p99, RPS, CPU, Hikari, DB wait.
- **Giới hạn an toàn / cleanup:** Cài stop condition và warmup mỗi bậc.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-LOAD-003 — Steady 5→10→20→50 VU cho POST message [P0]
- **Given / tiền điều kiện:** Pairs phân tán, ID/timestamp mới, DB budget.
- **When / workload và bước thực hiện:** Tăng bậc như GET nhưng pacing phù hợp write, verify created count.
- **Then / oracle và cách đánh giá:** Created/s không chỉ http_reqs/s, no silent retries counted.
- **Metrics / bằng chứng cần lưu:** created/s, p99, DB rows, Redis/WS lag.
- **Giới hạn an toàn / cleanup:** Giới hạn tổng new messages.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-LOAD-004 — Steady fixed-arrival-rate cho GET [P0]
- **Given / tiền điều kiện:** Generator đủ mạnh, controlled rate schedule ví dụ 10/25/50 RPS (chỉ mức thăm dò).
- **When / workload và bước thực hiện:** Đặt arrival rate mục tiêu, quan sát achieved rate và dropped iterations.
- **Then / oracle và cách đánh giá:** Không coi offered 50 RPS là served 50 RPS khi engine rớt iteration.
- **Metrics / bằng chứng cần lưu:** offered vs completed RPS, dropped, p95.
- **Giới hạn an toàn / cleanup:** Thử mức cụ thể theo headroom, không coi đây là SLO.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-LOAD-005 — Closed VU vs open arrival comparison [P0]
- **Given / tiền điều kiện:** Cùng endpoint, env, dataset, seed.
- **When / workload và bước thực hiện:** So 20 VU think time với fixed arrival có RPS tương đương trong phase đầu.
- **Then / oracle và cách đánh giá:** Hiểu coordinated omission/queue growth; báo hai model riêng, không xếp hạng đơn giản.
- **Metrics / bằng chứng cần lưu:** achieved arrival, latency, queue, dropped iterations.
- **Giới hạn an toàn / cleanup:** Không kết luận capacity khi generator không đạt rate.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-LOAD-006 — Định điểm gối knee của throughput [P0]
- **Given / tiền điều kiện:** Rate steps tăng nhỏ, có ít nhất 3 điểm quanh vùng p95 bắt đầu tăng mạnh.
- **When / workload và bước thực hiện:** Dựng đồ thị throughput vs p95 và error; quan sát saturation.
- **Then / oracle và cách đánh giá:** Knee ghi là khoảng ước lượng theo điều kiện test, không là giới hạn tuyệt đối.
- **Metrics / bằng chứng cần lưu:** throughput, tail, CPU/DB resource.
- **Giới hạn an toàn / cleanup:** Stop khi vi phạm safety bounds.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-LOAD-007 — Giới hạn ổn định theo SLO sáu API gốc [P0]
- **Given / tiền điều kiện:** Đã nhận chính xác docs/10_PERFORMANCE.md với SLO từng API và thống nhất cách đo.
- **When / workload và bước thực hiện:** Chạy từng route ở nhiều rates, xác định mức cao nhất còn đạt ngưỡng tài liệu.
- **Then / oracle và cách đánh giá:** Chỉ PASS SLO khi có threshold nguồn thật; nếu thiếu ghi NEEDS_SLO, không tự bịa số ms.
- **Metrics / bằng chứng cần lưu:** p95 (hoặc metric gốc), success%, throughput, resources.
- **Giới hạn an toàn / cleanup:** Không trộn SLO thăm dò p99 vào mục tiêu chính thức.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-LOAD-008 — Stress qua vùng lỗi có kiểm soát [P1]
- **Given / tiền điều kiện:** Environment disposable, abort config, data reset.
- **When / workload và bước thực hiện:** Tăng rate/VU vượt steady limit ngắn để tìm hình thức suy giảm: timeout/5xx/queue.
- **Then / oracle và cách đánh giá:** Hệ thống phải không corrupt data, phân biệt policy 429 và resource error.
- **Metrics / bằng chứng cần lưu:** error types, time-to-fail, CPU/DB/Redis.
- **Giới hạn an toàn / cleanup:** Giới hạn thời gian, disk, memory và thực hiện sau T07.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-LOAD-009 — Spike arrival của read API [P1]
- **Given / tiền điều kiện:** Ready DB/Redis, đủ generator headroom.
- **When / workload và bước thực hiện:** Từ low steady lên burst ngắn rồi quay về steady.
- **Then / oracle và cách đánh giá:** Đo p99 spike và recovery p95, không chỉ peak RPS.
- **Metrics / bằng chứng cần lưu:** recovery seconds, errors, pending pool.
- **Giới hạn an toàn / cleanup:** Không tạo test vô hạn ngoài env test.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-LOAD-010 — Spike ghi tin nhắn realtime [P1]
- **Given / tiền điều kiện:** Unique messages, nhiều pairs, receivers mở WS.
- **When / workload và bước thực hiện:** Gửi burst ngắn theo offered rate, chờ drain events.
- **Then / oracle và cách đánh giá:** Không mất persisted messages; event delivery/lags được đo.
- **Metrics / bằng chứng cần lưu:** created vs delivered, p99 delay, closes.
- **Giới hạn an toàn / cleanup:** Nếu Pub/Sub không durable, báo rõ giới hạn guarantee.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-LOAD-011 — Soak 30–60 phút API READ [P1]
- **Given / tiền điều kiện:** Token refresh strategy, ổn định dataset và resource headroom.
- **When / workload và bước thực hiện:** Chạy steady read đủ lâu để xem heap, GC, pool, latency drift.
- **Then / oracle và cách đánh giá:** Không có memory/threads/FD growth bất thường; time-series.
- **Metrics / bằng chứng cần lưu:** p95 per 5 min, heap slope, GC, handles.
- **Giới hạn an toàn / cleanup:** Soak duration đề xuất, không bắt buộc cố định khi env yếu.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-LOAD-012 — Soak gửi tin nhắn với dữ liệu tăng [P1]
- **Given / tiền điều kiện:** Bounded message budget, cleanup/rollover fixture.
- **When / workload và bước thực hiện:** Chạy write+WS steady lâu, theo dõi row growth, Redis memory, event lag.
- **Then / oracle và cách đánh giá:** Không có event loss/buffer leak vượt policy; quantify data growth effect.
- **Metrics / bằng chứng cần lưu:** created/s, DB bytes, RAM, p99 over time.
- **Giới hạn an toàn / cleanup:** Stop trước disk/row budgets.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-LOAD-013 — Soak WS idle connections [P1]
- **Given / tiền điều kiện:** N WS có PONG, token lifetimes đã kiểm chứng.
- **When / workload và bước thực hiện:** Giữ sockets qua nhiều chu kỳ heartbeat, kiểm reconnect hợp pháp khi hết hạn.
- **Then / oracle và cách đánh giá:** Active counts và CPU/Redis ổn định, không leak.
- **Metrics / bằng chứng cần lưu:** ping failures, session count, RSS slope.
- **Giới hạn an toàn / cleanup:** Không giữ stale token trái policy.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-LOAD-014 — Capacity sensitivity với CPU quota khác [P1]
- **Given / tiền điều kiện:** Có thể giới hạn CPU riêng trong môi trường test, giữ mọi thứ khác.
- **When / workload và bước thực hiện:** Đo cùng workload tại hai cấu hình quota CPU cố định.
- **Then / oracle và cách đánh giá:** Delta có nghĩa theo quota; không khẳng định phần mềm scale tuyến tính.
- **Metrics / bằng chứng cần lưu:** per-core CPU, RPS, p95, GC.
- **Giới hạn an toàn / cleanup:** Không thay JVM heap đồng thời.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-LOAD-015 — Capacity sensitivity với Hikari pool khác [P1]
- **Given / tiền điều kiện:** Có benchmark clone, kiểm soát SQL workload và baseline.
- **When / workload và bước thực hiện:** So 2–3 giá trị pool size an toàn, đo DB CPU/locks/waits.
- **Then / oracle và cách đánh giá:** Chọn giá trị có bằng chứng, không mặc định pool lớn tốt hơn.
- **Metrics / bằng chứng cần lưu:** throughput, acquire p95, DB connections, lock waits.
- **Giới hạn an toàn / cleanup:** Không đổi pool ở production chỉ vì một kết quả.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-LOAD-016 — Thời gian hồi phục sau giảm tải [P0]
- **Given / tiền điều kiện:** Run đã chạm vùng p95 tăng nhưng chưa làm chết môi trường.
- **When / workload và bước thực hiện:** Hạ offered load xuống mức baseline và theo dõi quãng hồi phục.
- **Then / oracle và cách đánh giá:** Hệ thống quay về latency/error baseline hoặc báo rõ tồn tại backlog/leak.
- **Metrics / bằng chứng cần lưu:** time-to-recover, queue/pool drain, GC.
- **Giới hạn an toàn / cleanup:** Dừng nếu DB vẫn không ổn định; chuyển sang T07 diagnosis.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-LOAD-017 — Lặp cùng scenario nhiều run [P0]
- **Given / tiền điều kiện:** Dataset và commit reset cố định; ít nhất 3 lượt benchmark tách biệt.
- **When / workload và bước thực hiện:** Chạy tuần tự các lần A theo cùng topology và workload, so biến thiên.
- **Then / oracle và cách đánh giá:** Không cherry-pick run tốt nhất; ghi median giữa runs cùng spread.
- **Metrics / bằng chứng cần lưu:** run-to-run CV, p95 spread, mean RPS.
- **Giới hạn an toàn / cleanup:** Nếu kết quả dao động lớn đánh INCONCLUSIVE trước tối ưu.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

### 6.13. NET — Mạng, reverse proxy, chi phí client và yếu tố đo ngoài backend

**Mục tiêu nhóm:** Phân rã chênh lệch HTTP/TCP/WS/MinIO từ topology và transport.

#### T08-NET-001 — Direct backend vs reverse proxy [P1]
- **Given / tiền điều kiện:** Có config Nginx và port direct hợp lệ; cùng TLS policy được công bố.
- **When / workload và bước thực hiện:** Chạy identical GET/messaging workloads trực tiếp và qua proxy.
- **Then / oracle và cách đánh giá:** Delta p95 có gắn nhãn đường đi; không suy proxy là nguyên nhân từ run khác cấu hình.
- **Metrics / bằng chứng cần lưu:** RTT, TLS overhead, proxy 4xx/5xx, CPU.
- **Giới hạn an toàn / cleanup:** Không dùng direct route bỏ qua security làm baseline công khai.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-NET-002 — HTTP keep-alive on/off [P1]
- **Given / tiền điều kiện:** Generator cho điều khiển connection reuse.
- **When / workload và bước thực hiện:** So request GET giống nhau với reuse và tạo kết nối mới.
- **Then / oracle và cách đánh giá:** Phân biệt handshake latency khỏi application request duration.
- **Metrics / bằng chứng cần lưu:** connect time, TLS handshake, p95, sockets.
- **Giới hạn an toàn / cleanup:** Mô hình keepalive thực tế được ghi rõ.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-NET-003 — HTTP/1.1 vs HTTP/2 ở proxy [P2]
- **Given / tiền điều kiện:** Server/proxy thực sự hỗ trợ và đã xác nhận ALPN.
- **When / workload và bước thực hiện:** Chạy requests tương đồng theo protocol, so connection efficiency.
- **Then / oracle và cách đánh giá:** Không ghi HTTP/2 nếu chỉ proxy hỗ trợ nội bộ/không negotiated.
- **Metrics / bằng chứng cần lưu:** protocol version, connections, p95.
- **Giới hạn an toàn / cleanup:** Không so h2 với direct h1 khác TLS path mà không giải thích.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-NET-004 — TLS overhead khi thiết lập mới [P1]
- **Given / tiền điều kiện:** TLS termination sẵn trong env test.
- **When / workload và bước thực hiện:** Đo connect+TLS warm/cold, nhiều kết nối ngắn và reuse.
- **Then / oracle và cách đánh giá:** Chi phí khởi tạo được định lượng, không gộp vào app CPU.
- **Metrics / bằng chứng cần lưu:** tls_handshaking, connect, CPU proxy.
- **Giới hạn an toàn / cleanup:** Không vô hiệu hóa TLS trong test kết luận production.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-NET-005 — Network latency giữa backend và PostgreSQL [P1]
- **Given / tiền điều kiện:** Test isolated, traffic shaping có kiểm soát; T07 fault handling sẵn.
- **When / workload và bước thực hiện:** Thêm RTT nhỏ và chạy GET/POST read/write unchanged.
- **Then / oracle và cách đánh giá:** Nhận diện số vòng DB làm chi phí tăng, so server spans.
- **Metrics / bằng chứng cần lưu:** DB RTT, p95 delta, SQL calls.
- **Giới hạn an toàn / cleanup:** Chỉ dùng traffic shaping trên mạng sandbox.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-NET-006 — Network latency backend↔Redis [P1]
- **Given / tiền điều kiện:** Có đo RTT Redis/metrics.
- **When / workload và bước thực hiện:** Thêm RTT giới hạn rồi chạy protected GET/WS messaging.
- **Then / oracle và cách đánh giá:** Kiểm tra auth+publish tail nhạy thế nào; không suy Redis lỗi nếu không packet loss.
- **Metrics / bằng chứng cần lưu:** Redis roundtrips, p95 HTTP, WS lag.
- **Giới hạn an toàn / cleanup:** Tách khỏi fault recovery test T07.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-NET-007 — Băng thông giới hạn MinIO upload/download [P1]
- **Given / tiền điều kiện:** MinIO có endpoint và fixture test bytes, policy kiểm soát network.
- **When / workload và bước thực hiện:** Giới hạn bandwidth ở link test, tăng upload concurrent.
- **Then / oracle và cách đánh giá:** Throughput bám link limit thay vì quy lỗi Spring backend.
- **Metrics / bằng chứng cần lưu:** Mbps, retransmits, MinIO CPU, disk IO.
- **Giới hạn an toàn / cleanup:** Không kéo shared NIC đầy trong môi trường chung.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-NET-008 — Đo response compression cho JSON nếu cấu hình có [P2]
- **Given / tiền điều kiện:** Confirm compression on/off cho content-type/size.
- **When / workload và bước thực hiện:** GET conversation history với payload lớn/vừa qua cùng proxy.
- **Then / oracle và cách đánh giá:** Lợi ích bytes so với CPU p95 được ghi rõ.
- **Metrics / bằng chứng cần lưu:** transferred bytes, CPU, p95.
- **Giới hạn an toàn / cleanup:** Không tự bật compression mà thiếu review nội dung nhạy cảm.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-NET-009 — Máy client có RTT cao so với local [P1]
- **Given / tiền điều kiện:** Generator đặt tại host khác, RTT đo được.
- **When / workload và bước thực hiện:** Chạy cùng workload pacing, so local vs remote và tách server-side metrics.
- **Then / oracle và cách đánh giá:** Không kết luận code chậm hơn khi mạng client khác; mô tả RTT.
- **Metrics / bằng chứng cần lưu:** end-user p95, server p95, RTT, packet loss.
- **Giới hạn an toàn / cleanup:** Không giả RTT bằng sleep trong script rồi trừ vào latency.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-NET-010 — Ảnh hưởng log/metrics verbose [P1]
- **Given / tiền điều kiện:** Một môi trường benchmark clone có log config thay đổi có chủ ý.
- **When / workload và bước thực hiện:** So normal logging vs debug với cùng offered load, ghi disk writes.
- **Then / oracle và cách đánh giá:** Chọn logging đủ quan sát nhưng không làm benchmark lệch, kết quả có provenance.
- **Metrics / bằng chứng cần lưu:** CPU, disk writes, p95, dropped logs.
- **Giới hạn an toàn / cleanup:** Không xóa log bảo mật cần thiết chỉ để đạt mục tiêu.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

### 6.14. REP — Báo cáo, nghiệm thu, chẩn đoán và trước/sau tối ưu

**Mục tiêu nhóm:** Đưa ra kết luận có thể kiểm chứng và hành động tiếp theo, không lạm dụng ngôn ngữ capacity.

#### T08-REP-001 — Báo cáo sáu API gốc theo bảng nguồn [P0]
- **Given / tiền điều kiện:** docs/10_PERFORMANCE.md được cung cấp, exact endpoints/SLO đã đối chiếu.
- **When / workload và bước thực hiện:** Xuất 1 dòng/endpoint gồm workload/seed, RPS, latency, errors, threshold từ tài liệu.
- **Then / oracle và cách đánh giá:** Không thiếu API gốc, không bịa SLO nếu chưa có.
- **Metrics / bằng chứng cần lưu:** p50/p95/p99, successful ops/s, error%, target.
- **Giới hạn an toàn / cleanup:** Kết luận NEEDS_SLO nếu tài liệu gốc thiếu.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-REP-002 — Báo cáo VU khác request/s [P0]
- **Given / tiền điều kiện:** Các scenario closed-VU có think time.
- **When / workload và bước thực hiện:** Ghi số VU, avg iteration duration, achieved HTTP RPS và event ops riêng.
- **Then / oracle và cách đánh giá:** Không tuyên bố 50 VU = 50 req/s hay 50 simultaneous HTTP handlers.
- **Metrics / bằng chứng cần lưu:** VUs, RPS, iterations/s, think time.
- **Giới hạn an toàn / cleanup:** Ghi pacing chi tiết.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-REP-003 — Báo cáo lỗi theo taxonomy [P0]
- **Given / tiền điều kiện:** Kết quả có request/response checks và correlation.
- **When / workload và bước thực hiện:** Phân loại auth/validation/429 policy/5xx/timeout/connection/WS close/business mismatch.
- **Then / oracle và cách đánh giá:** Không trộn lỗi harness với lỗi backend; mỗi nhóm có count và tỷ lệ.
- **Metrics / bằng chứng cần lưu:** error breakdown, sample links, status.
- **Giới hạn an toàn / cleanup:** Không log sensitive payload.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-REP-004 — Báo cáo giới hạn chịu tải có điều kiện [P0]
- **Given / tiền điều kiện:** Ít nhất 3 lượt run ổn định, threshold đã xác định, generator không nghẽn.
- **When / workload và bước thực hiện:** Xác định tốc độ successful ops/s cao nhất đã kiểm chứng đạt SLO dưới workload X.
- **Then / oracle và cách đánh giá:** Nêu topology, data, resource bounds, time window và confidence; không ghi năng lực production vô điều kiện.
- **Metrics / bằng chứng cần lưu:** highest verified rate, p95, resource saturation.
- **Giới hạn an toàn / cleanup:** Nếu chưa chạm ngưỡng, chỉ nói >= mức đã thử.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-REP-005 — Bảng bottleneck hypothesis vs evidence [P0]
- **Given / tiền điều kiện:** Có cùng timestamp app/DB/Redis/MinIO + k6 metrics.
- **When / workload và bước thực hiện:** Với mỗi tail spike lập giả thuyết CPU, Hikari, SQL, Redis, WS, network; kiểm tra bằng dấu hiệu trực tiếp.
- **Then / oracle và cách đánh giá:** Giả thuyết chưa xác minh giữ status HYPOTHESIS, không đề xuất fix vô căn cứ.
- **Metrics / bằng chứng cần lưu:** supporting measurements, traces, alternate causes.
- **Giới hạn an toàn / cleanup:** Không thay nhiều biến trong một run.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-REP-006 — Trước/sau tối ưu trên cùng workload [P0]
- **Given / tiền điều kiện:** Có baseline commit A, branch commit B, dữ liệu/môi trường tương đương.
- **When / workload và bước thực hiện:** Chạy cùng scenario 3+ lượt mỗi variant theo thứ tự giảm bias.
- **Then / oracle và cách đánh giá:** Báo p95/p99/throughput/error/resource và correctness; không bỏ outcome xấu.
- **Metrics / bằng chứng cần lưu:** relative change%, run variability, DB metrics.
- **Giới hạn an toàn / cleanup:** Rollback được; không đổi schema/heap/traffic cùng lúc nếu không kiểm soát.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-REP-007 — Kiểm tra tính đúng đắn khi đạt peak rate [P0]
- **Given / tiền điều kiện:** T05/T07 core oracles đang PASS ở baseline.
- **When / workload và bước thực hiện:** Sau stress/query DB+Redis/MinIO, đối chiếu counts, sample messages, zero cross-user leaks.
- **Then / oracle và cách đánh giá:** Throughput cao nhưng sai data không đạt nghiệm thu.
- **Metrics / bằng chứng cần lưu:** data consistency, created vs persisted, delivery%.
- **Giới hạn an toàn / cleanup:** Nếu corruption xuất hiện, dừng benchmark và ưu tiên bug correctness.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-REP-008 — Báo cáo chi phí tạo tải và độ tin cậy của generator [P1]
- **Given / tiền điều kiện:** Monitoring máy phát tải, dropped iterations và data file.
- **When / workload và bước thực hiện:** Kết thúc run ghi generator CPU/RAM/network + actual offered rate.
- **Then / oracle và cách đánh giá:** Tuyên bố bottleneck backend chỉ khi generator có headroom.
- **Metrics / bằng chứng cần lưu:** dropped, CPU gen, socket errors.
- **Giới hạn an toàn / cleanup:** Nếu quá tải generator, đánh INVALID_RUN.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-REP-009 — Báo cáo thời gian hồi phục và leak sau run [P1]
- **Given / tiền điều kiện:** Có metric background sau đo.
- **When / workload và bước thực hiện:** Tiếp tục đo sau khi hạ tải, theo dõi CPU, heap, DB pool, WS sockets, MinIO orphan.
- **Then / oracle và cách đánh giá:** Tài nguyên quay về mức bình thường hoặc có issue được mở; no silent residue.
- **Metrics / bằng chứng cần lưu:** recovery sec, connection count, orphan count.
- **Giới hạn an toàn / cleanup:** Dọn đúng run_id, không xóa service khác.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-REP-010 — Liên kết phát hiện T08 với test T04–T07 [P1]
- **Given / tiền điều kiện:** Có defect IDs và test IDs cross-suite.
- **When / workload và bước thực hiện:** Khi phát hiện lỗi dưới tải, tạo regression ở T04/T05/T06/T07 tương ứng.
- **Then / oracle và cách đánh giá:** Bug không biến mất khỏi backlog khi benchmark kết thúc; có case tái hiện.
- **Metrics / bằng chứng cần lưu:** issue map, regression status, severity.
- **Giới hạn an toàn / cleanup:** Performance run không thay thế correctness/security tests.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

#### T08-REP-011 — Tạo báo cáo có thể trình bày khóa luận [P1]
- **Given / tiền điều kiện:** Đã thu đủ raw files, đồ thị và source context.
- **When / workload và bước thực hiện:** Xuất executive summary, workload table, methodology, results, bottleneck evidence, limitations, next steps.
- **Then / oracle và cách đánh giá:** Một người khác có thể tái lập kết quả theo mô tả, không hứa đạt production SLO khi chưa có.
- **Metrics / bằng chứng cần lưu:** run links, hardware, versions, p95, RPS, errors.
- **Giới hạn an toàn / cleanup:** Xóa toàn bộ secrets khỏi artifacts trước khi chia sẻ.
- **Trạng thái khởi tạo:** `NOT_RUN`. Khi áp dụng, lưu `run_id`, `commit`, `fixture_hash`, `scenario`, `threshold_source`, `status` và link artifacts.

---
## 7. Ba bài mẫu cách thực hiện và chấm kết quả chi tiết (không có script)

### Mẫu A — HTTP `POST /messages`: throughput tạo tin mới, không nhầm retry

**Fixture:** 20 cặp A/B; mỗi A có JWT hợp lệ và conversation_id; ít nhất 20 receiver WS B (nếu đo delivery). Seed PG ổn định; lấy số row message ban đầu. **Workload:** warmup 1 VU; 5→10→20→50 VU; mỗi iteration tạo UUID mới + timestamp ISO mới, POST một message và nghĩ 1 giây nếu closed model; nếu dùng fixed-arrival-rate phải dùng run riêng. **Oracle:** 201 `created` cho mỗi message mới, count DB tăng tương ứng, response id khớp UUID; retry 200 chỉ ở cohort retry riêng. **Bằng chứng:** HTTP avg/p95/p99, new messages/s, 4xx/5xx/timeouts, rows appended, Hikari, SQL/Redis times, nếu bật WS thì tỷ lệ delivery và delay. **Không kết luận:** 50 VU bằng 50 RPS; nếu 20% response là 200 retry thì không nói đã tạo được 100 messages/s. **Safety:** giới hạn tổng row; không dùng chung 1 message UUID cho toàn bộ VU.

### Mẫu B — HTTP `POST /videos` tới MinIO READY: chia latency thành các tầng

**Fixture:** user có quota, test bucket riêng có webhook thật, part đầu ≥5 MiB, part cuối nhỏ, cơ chế dọn multipart. **Workload:** POST /videos khởi tạo → MinIO PUT part1 → POST chunks → PUT part2 → POST finalize → theo dõi webhook/GET video đến READY → xác minh SHA-256, rồi DELETE. **Oracle:** DB READY, Redis session được dọn, MinIO bytes đúng, quota tính đúng. **Bằng chứng:** `init p95`, `PUT bytes/s`, `chunk-url p95`, `finalize p95`, `time-to-READY p95`, cleanup lag và pending orphan multipart. **Không kết luận:** Spring Boot đạt 100 MiB/s vì MinIO download nhanh; PUT file không đi qua Spring controller. **Safety:** dừng nếu thấy orphan multipart chưa có biện pháp cleanup.

### Mẫu C — WS messaging 50 users: kết nối không phải sự kiện thành công

**Fixture:** 50 cặp người dùng, 50 B đang mở `/ws/messaging?token=...`, trả PONG theo PING; A có quyền gửi tin vào conversation tương ứng. **Workload:** mở socket theo tốc độ có kiểm soát, giữ nhiều chu kỳ heartbeat, A lần lượt POST tin ID mới, chờ B nhận NEW_MESSAGE đúng ID, sau đó tăng rate. **Oracle:** socket B đã auth và còn sống, DB lưu tin, B nhận đúng event, không lẫn người; đo đến khi event drain và ghi số late/missing. **Bằng chứng:** active/open WS, connect p95, HTTP post p95, send→receive p95/p99, event delivered%, missing%, close code, Node/Java CPU, Redis listener load. **Không kết luận:** 50 WS tương đương 50 cuộc gọi WebRTC hoặc 50 user đang gửi tin không ngừng. **Safety:** đóng socket và so registry/FD trước-sau.

## 8. Trình tự triển khai T08 với Codex làm reviewer (không tự code hộ)

| Đợt | Phạm vi | Mốc kết quả bắt buộc |
|---|---|---|
| 0 | ENV + OBS + read source/config/docs hiện hành | Môi trường an toàn, metrics và SLO mapping rõ; không chạy stress |
| 1 | API + AUTH baseline ở 1 VU | Có baseline 6 API yêu cầu gốc nếu source đủ; payload/checks đúng |
| 2 | WRITE + DB + RED | Ghi tin mới thật, queries/pool/Redis quan sát được, dữ liệu đúng |
| 3 | WS + SIG | Latency realtime và signaling đúng; giải quyết blocker E09/E10 trước nghiệm thu |
| 4 | VID | Có full multipart→READY→download→delete và cleanup an toàn |
| 5 | MIX + LOAD + NET | 5→50 VU, fixed-rate, spike/soak có giới hạn, xác định knee |
| 6 | REP | Báo cáo có điều kiện, bằng chứng bottleneck, kế hoạch trước/sau |

**Thứ tự khuyến nghị khi gấp:** Đợt 0 rút gọn (chỉ những gate thật sự cần), Đợt 1, WRITE/messages trong Đợt 2, rồi WS và video. Không vì gấp mà bỏ version, fixture, metrics, generator headroom, check business và cleanup.

## 9. Template một dòng báo cáo kết quả

| Trường | Nội dung cần ghi |
|---|---|
| Run | run_id, start/end UTC, commit SHA, OS/Java/Node/DB versions |
| Topology | Nginx hay direct, nơi chạy k6, CPU/RAM/container quota, network |
| Fixture | users, conversations/user, messages/conversation, videos, fixture hash |
| Workload | closed/open model; VUs, iterations, offered RPS, pacing, mix ratio, duration |
| Result | started/completed requests, valid ops/s, p50/p95/p99/max, error rate theo nhóm |
| Resource | backend JVM CPU/RSS/GC/threads; Hikari; PG CPU/locks/IO; Redis latency; MinIO/Node |
| Correctness | DB count, WS delivered fraction, content hashes, quota/orphans, unauthorized access |
| Threshold | ngưỡng lấy từ đường dẫn/tài liệu nào; nếu thiếu ghi NEEDS_SLO |
| Assessment | PASS_SLO, FAIL_SLO, FAIL_PRODUCT, INVALID_RUN, BLOCKED, INCONCLUSIVE |
| Reproducibility | ≥3 lần chạy, variance, artifacts, lệnh tổng quát, seed, cleanup log |

## 10. Quy tắc kết luận và những điều tuyệt đối không tự khẳng định

- Nếu hệ thống **chưa chạm giới hạn trong vùng khảo sát**, chỉ kết luận “đã kiểm chứng ít nhất mức X RPS/valid ops/s ở workload Y”, không khẳng định đây là max capacity.
- Nếu **điểm nghẽn CPU/DB/Redis/MinIO** chưa có metric cùng pha, đánh `HYPOTHESIS`, không ghi đã chứng minh.
- Nếu **T04/T05/T06/T07 FAIL correctness/security**, số throughput cao không đủ điều kiện nghiệm thu; phải xử lý lỗi nghiệp vụ/bảo mật trước.
- Nếu **JWT hết hạn trong soak**, lỗi do harness không refresh không được mặc định xem là backend không chịu tải.
- Nếu **máy phát k6 quá tải hoặc dropped iterations**, không xem offered RPS là successful RPS.
- Nếu **Redis Pub/Sub không đảm bảo lưu bền**, không hứa `0% lost events` ở mọi failure injection; kiểm chứng history recovery riêng ở T07/T05.
- Nếu **MinIO lưu bytes thành công**, không mặc định video playback, media codec hoặc WebRTC call đã hoạt động.
- T08 là tài liệu **test plan**, không phải chứng nhận đáp ứng SLO, không phải lời bảo đảm an toàn hay kết quả benchmark đã chạy.

## 11. Danh sách input cần bổ sung để khóa T08 thành phiên bản chạy chính thức

1. `docs/10_PERFORMANCE.md`: sáu API, ngưỡng gốc, cách tính latency và mức tải/điều kiện nghiệm thu (giữ nguyên, không tự diễn giải).
2. `backend/pom.xml` và `application*.yml` đã ẩn secret; JVM flags, Tomcat/Hikari/Redis/MinIO metrics, Actuator hiện hành.
3. Flyway migration schema + index; `docker-compose.yml`, Nginx routing/TLS; CPU/RAM limits và thông tin topology thật.
4. Source Node signaling và hợp đồng WS hiện hành; tình trạng đã sửa E09/E10 hay chưa.
5. Test datasets size, mong muốn 1/2 máy chạy test, target bao nhiêu user/test budget, giới hạn số tin nhắn/video/GB và cleanup policy.

**Nội dung đang được thiết kế để người dùng tự viết k6 và kiểm thử, theo đúng yêu cầu, không có kết quả chạy mới.**
