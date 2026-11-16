# VeilTalk — Báo cáo lỗi ưu tiên

Ngày tổng hợp: 2026-10-28  
Phạm vi: backend, signaling và cấu hình triển khai hiện có trong repository.  
Mục đích: bàn giao sang phiên làm việc sửa lỗi; tài liệu này không xác nhận rằng các lỗi đã được sửa.

## 1. Tóm tắt điều hành

Hiện có bốn vấn đề ở mức code/contract và ba vấn đề deployment cần ưu tiên:

| STT | Vấn đề | Loại | Mức chắc chắn | Ưu tiên đề xuất |
|---:|---|---|---|---|
| 1 | Đóng một WebSocket phụ làm kết thúc cuộc gọi đang hoạt động | Signaling/reliability | Đã tái hiện bằng test fail | P0/P1 |
| 2 | `VID-017`: Redis lỗi sau khi tạo multipart có thể để lại multipart mồ côi | Backend/storage | Đã tái hiện bằng test fail | P1 |
| 3 | API trả `expires_in = 900` không theo thời hạn JWT được cấu hình | Backend/API contract | Đã tái hiện bằng test fail | P1 |
| 4 | `CALL_END` do server sinh ra thiếu `call_id` | Signaling/API contract | Bằng chứng source và contract trực tiếp; chưa có regression test riêng | P1 |
| 5 | `CONFIG-003`: PostgreSQL, Redis và MinIO được publish trên mọi interface | Deployment/security | Test cấu hình đã fail; mức nguy hiểm phụ thuộc topology thật | P0 trước production |
| 6 | `CONFIG-005`: Chưa có HTTPS/WSS bắt buộc trong topology repository | Deployment/security | Khoảng trống cấu hình rõ; cần xác nhận external TLS termination | P0 trước khi public |
| 7 | `INT-011`: Internal API chưa được cô lập ở tầng mạng | Deployment/defense-in-depth | Có shared-secret filter; rủi ro phụ thuộc public exposure và policy | P1 trước production |

Lưu ý quan trọng:

- `CONFIG-004` không nằm trong danh sách lỗi đã xác nhận. Mục đúng đang được ưu tiên là `CONFIG-003`.
- Ba mục deployment không được gọi là lỗi production tuyệt đối nếu `docker-compose.yml` chỉ dùng cho local và production có private network, firewall, ingress/TLS riêng.
- Kết quả T06 `190 PASS, 5 REVIEW_REQUIRED, 2 N/A, 9 NOT RUN` không bao phủ toàn bộ lỗi chức năng. Lỗi multi-socket và `expires_in` là regression ngoài 206 case T06.

## 2. BUG-CALL-001 — Đóng tab/socket phụ làm kết thúc cuộc gọi chính

### Trạng thái

Đã xác nhận bằng regression test đang fail.

Kết quả gần nhất:

```text
tests 41
pass 40
fail 1

failing test:
closing one of multiple sockets for a user does not end the active call
```

### Mô tả kỹ thuật

Signaling cho phép một người dùng có nhiều WebSocket bằng `connectionsByUserId: Map<userId, Set<WebSocket>>`. Khi một socket đóng, server:

1. Xóa socket đó khỏi tập kết nối.
2. Luôn gọi `endSession(userId)`.
3. `endSession` xóa session cuộc gọi của cả user và peer.

Code không kiểm tra user còn socket hoạt động nào khác trước khi kết thúc cuộc gọi.

### Tình huống người dùng

1. A đang gọi B trên tab 1.
2. A mở VeilTalk ở tab 2.
3. A reload hoặc đóng tab 2.
4. Server xóa session cuộc gọi A–B.
5. B nhận `CALL_END` với lý do `peer_disconnected`, dù tab 1 của A vẫn kết nối.

### Ảnh hưởng

- Cuộc gọi bị ngắt ngoài ý muốn.
- Reload một tab không tham gia cuộc gọi cũng ảnh hưởng tab đang gọi.
- Trạng thái UI và P2P media có thể không đồng bộ với signaling server.

### Bằng chứng

- Quản lý nhiều socket: [`signaling/src/server.js`](../signaling/src/server.js#L73).
- Close handler xóa socket rồi luôn kết thúc session: [`signaling/src/server.js`](../signaling/src/server.js#L196).
- `endSession` xóa session hai phía: [`signaling/src/server.js`](../signaling/src/server.js#L107).
- Regression test: [`signaling/src/server.test.js`](../signaling/src/server.test.js#L567).
- Assertion chứng minh session bị mất: [`signaling/src/server.test.js`](../signaling/src/server.test.js#L609).

### Lệnh tái hiện

```powershell
cd C:\project\veiltalk\signaling
node --test --test-name-pattern="closing one of multiple sockets" src/server.test.js
```

Hoặc chạy toàn bộ signaling suite:

```powershell
cd C:\project\veiltalk\signaling
npm.cmd test
```

### Tiêu chí xác nhận sau sửa

- Đóng một socket phụ không xóa active/pending call nếu user còn socket hợp lệ.
- Peer không nhận `CALL_END` trong trường hợp trên.
- Khi socket cuối cùng của user đóng, peer vẫn nhận `CALL_END` đúng một lần.
- Test hiện tại chuyển sang PASS và toàn bộ signaling suite không regression.

## 3. `VID-017` — Multipart MinIO mồ côi khi Redis lỗi

### Trạng thái

Đã xác nhận bằng test fail trong T06 (`REVIEW_REQUIRED`).

Thông báo fail:

```text
Redis-session failure left the created MinIO multipart
without an abort/compensation call
```

### Mô tả kỹ thuật

Luồng khởi tạo upload hiện tại:

1. Tạo multipart upload trên MinIO.
2. Tạo và lưu record video trong transaction DB.
3. Tạo upload session trong Redis.
4. Nếu Redis lỗi, code log rồi ném `VideoStorageException`.

Transaction DB có thể rollback, nhưng multipart trên MinIO là external side effect và không tự rollback theo database. Khối `catch` không gọi `abortMultipartUpload` và chưa ghi một cleanup job bền vững trước khi mất dấu phiên.

### Tình huống người dùng

1. Người dùng bắt đầu upload video.
2. MinIO tạo multipart thành công.
3. Redis restart hoặc timeout.
4. Người dùng nhận lỗi và thử upload lại.
5. Multipart cũ vẫn nằm trong MinIO.

Nếu sự cố xảy ra nhiều lần, incomplete multipart có thể tích tụ, chiếm storage và cuối cùng làm upload của người dùng khác chậm hoặc thất bại.

### Bằng chứng

- Tạo multipart trước Redis: [`backend/src/main/java/com/veiltalk/video/VideoService.java`](../backend/src/main/java/com/veiltalk/video/VideoService.java#L86).
- Tạo Redis session: [`VideoService.java`](../backend/src/main/java/com/veiltalk/video/VideoService.java#L107).
- Khối catch chỉ log và throw: [`VideoService.java`](../backend/src/main/java/com/veiltalk/video/VideoService.java#L110).
- Code comment hiện ghi không abort tại đây: [`VideoService.java`](../backend/src/main/java/com/veiltalk/video/VideoService.java#L104).
- Regression wrapper: [`scripts/t06-seciurity/remaining-runnable.test.cjs`](../scripts/t06-seciurity/remaining-runnable.test.cjs#L19).
- Unit regression: [`backend/src/test/java/com/veiltalk/video/VideoInitiateUploadCompensationTests.java`](../backend/src/test/java/com/veiltalk/video/VideoInitiateUploadCompensationTests.java).
- Kết quả T06: [`scripts/t06-seciurity/results/remaining/results.xml`](../scripts/t06-seciurity/results/remaining/results.xml#L27).

### Lệnh tái hiện

```powershell
cd C:\project\veiltalk\backend
.\mvnw.cmd -q -Dtest=VideoInitiateUploadCompensationTests test
```

### Điểm cần xác minh trước khi chọn cách sửa

Đặc tả cho phép một trong hai hướng:

- Compensation ngay lập tức, ví dụ abort multipart khi Redis/DB thất bại; hoặc
- Cơ chế phát hiện/dọn multipart mồ côi đáng tin cậy, có dữ liệu bền vững và bằng chứng vận hành.

Nếu MinIO production đã có lifecycle rule tự xóa incomplete multipart, cần đưa cấu hình đó vào repository/test evidence. Không nên mặc định rằng lifecycle rule tồn tại.

### Tiêu chí xác nhận sau sửa

- Redis failure không để lại multipart không thể truy vết.
- Không tạo video record hoặc quota sai sau rollback.
- Nếu abort tạm thời thất bại, có cleanup job bền vững để retry.
- Regression test chuyển sang PASS.

## 4. BUG-AUTH-001 — `expires_in` không khớp thời hạn JWT

### Trạng thái

Đã xác nhận bằng unit regression test fail.

Kết quả với JWT access lifetime được cấu hình là 300 giây:

```text
expected: 300L
but was: 900L
Tests run: 1, Failures: 1
```

### Mô tả kỹ thuật

`JwtService` tạo access token theo `jwt.access-expiry`, nhưng `AuthService` có constant `ACCESS_TOKEN_EXPIRY_SECONDS = 900` và dùng constant này cho response register, login và refresh.

Do đó claim `exp - iat` của token và trường response `expires_in` có thể khác nhau.

### Tình huống người dùng

Ví dụ production đặt token sống 300 giây:

1. API trả `expires_in = 900` nên frontend cho rằng token sống 15 phút.
2. Token thực tế hết hạn sau 5 phút.
3. Từ phút thứ 5, API bắt đầu trả `401` trước lịch refresh của client.
4. Người dùng thấy thao tác thất bại hoặc bị đăng xuất bất ngờ.

Nếu token thật sống lâu hơn 900 giây, client có thể refresh quá sớm, tạo request và ghi refresh-token không cần thiết.

### Bằng chứng

- Constant hardcode: [`backend/src/main/java/com/veiltalk/auth/AuthService.java`](../backend/src/main/java/com/veiltalk/auth/AuthService.java#L23).
- Register response dùng constant: [`AuthService.java`](../backend/src/main/java/com/veiltalk/auth/AuthService.java#L81).
- Login response dùng constant: [`AuthService.java`](../backend/src/main/java/com/veiltalk/auth/AuthService.java#L103).
- Refresh response dùng constant: [`AuthService.java`](../backend/src/main/java/com/veiltalk/auth/AuthService.java#L110).
- JWT config: [`backend/src/main/resources/application.yml`](../backend/src/main/resources/application.yml#L42).
- Regression test: [`backend/src/test/java/com/veiltalk/auth/AuthTokenExpiryContractTests.java`](../backend/src/test/java/com/veiltalk/auth/AuthTokenExpiryContractTests.java#L20).

### Lệnh tái hiện

```powershell
cd C:\project\veiltalk\backend
.\mvnw.cmd -q -Dtest=AuthTokenExpiryContractTests test
```

### Tiêu chí xác nhận sau sửa

- Register, login và refresh trả `expires_in` bằng lifetime thật của access token.
- Thay đổi `JWT_ACCESS_EXPIRY` không cần sửa constant khác.
- Regression 300 giây chuyển sang PASS.
- Các integration test đang hardcode `900` được điều chỉnh để kiểm tra theo config/claims, không che giấu sai lệch.

## 5. BUG-CALL-002 — `CALL_END` do server sinh ra thiếu `call_id`

### Trạng thái

Bằng chứng source và API contract trực tiếp; chưa có regression test chuyên biệt nên chưa xếp cùng mức “dynamic test confirmed” với ba lỗi trên.

### Mô tả kỹ thuật

Khi socket disconnect hoặc pending call timeout, `endSession` tự tạo `CALL_END` chỉ gồm:

```javascript
{
  type: "CALL_END",
  data: { reason: notifyReason },
  from_user_id: userId
}
```

Session đã có `callId`, nhưng event không đưa `call_id` vào payload. API contract yêu cầu `CALL_ANSWER`, `ICE_CANDIDATE`, `CALL_REJECT` và `CALL_END` mang cùng `call_id` của cuộc gọi.

### Tình huống người dùng

1. A đang gọi hoặc đang chờ B trả lời.
2. A mất mạng, đóng socket cuối hoặc call timeout.
3. Server gửi `CALL_END` thiếu `call_id`.
4. Client B không thể correlation event với cuộc gọi hiện tại hoặc loại bỏ event sai schema.
5. UI B có thể bị kẹt ở trạng thái đang gọi/đang kết nối.

### Bằng chứng

- `endSession` đọc session nhưng chỉ lấy `peerUserId`: [`signaling/src/server.js`](../signaling/src/server.js#L107).
- Event server-generated thiếu `call_id`: [`server.js`](../signaling/src/server.js#L117).
- Session lưu `callId`: [`server.js`](../signaling/src/server.js#L284).
- API contract yêu cầu cùng `call_id`: [`docs/04_API.md`](04_API.md#L949).

### Test cần bổ sung trước hoặc cùng lúc sửa

- Disconnect socket cuối trong active call: peer nhận đúng một `CALL_END` có `call_id` hiện tại.
- Pending call timeout: cả hai đầu nhận `CALL_END` có đúng `call_id`.
- Không phát `CALL_END` của call cũ sang call mới.

### Tiêu chí xác nhận sau sửa

- Mọi `CALL_END` do client relay hoặc server sinh đều chứa đúng `call_id`.
- Disconnect, timeout và multi-socket tests đều PASS.
- Event của call cũ không kết thúc call mới.

## 6. `CONFIG-003` — Dịch vụ dữ liệu được publish trên mọi interface

### Trạng thái

Test cấu hình T06 đã fail (`REVIEW_REQUIRED`). Đây là lỗi production nếu manifest hiện tại được triển khai trên host có các cổng đó truy cập được từ mạng không tin cậy.

### Mô tả

Compose publish trực tiếp:

- PostgreSQL: `5432:5432`
- Redis: `6379:6379`
- MinIO API: `9000:9000`
- MinIO Console: `9001:9001`

Không có bind `127.0.0.1` trong manifest. Việc có thật sự lộ Internet còn phụ thuộc firewall, security group và topology host.

### Tình huống người dùng

Nếu các cổng public và credential bị dò/lộ:

- Dữ liệu tài khoản, tin nhắn hoặc video có thể bị đọc/xóa.
- Redis bị xóa có thể ảnh hưởng blacklist/session/rate-limit.
- MinIO bị truy cập trực tiếp có thể làm lộ video mà không đi qua authorization backend.
- Dịch vụ có thể ngừng hoạt động do dữ liệu hoặc storage bị phá hoại.

### Bằng chứng

- PostgreSQL port: [`docker-compose.yml`](../docker-compose.yml#L10).
- Redis port: [`docker-compose.yml`](../docker-compose.yml#L17).
- MinIO ports: [`docker-compose.yml`](../docker-compose.yml#L32).
- Test cấu hình: [`scripts/t06-seciurity/remaining-runnable.test.cjs`](../scripts/t06-seciurity/remaining-runnable.test.cjs#L33).
- Kết quả fail: [`scripts/t06-seciurity/results/remaining/results.xml`](../scripts/t06-seciurity/results/remaining/results.xml#L54).

### Điều cần xác nhận

- `docker-compose.yml` là local/dev hay production manifest?
- Production có firewall/security group/private subnet nào?
- Có nhu cầu truy cập database/MinIO Console từ host ngoài Docker network không?

### Tiêu chí xác nhận sau sửa

- Production chỉ public các entrypoint dự định công khai.
- PostgreSQL, Redis và MinIO administration chỉ nằm trong private network hoặc được bảo vệ theo thiết kế đã duyệt.
- Có kiểm tra port thực tế từ một máy ngoài mạng tin cậy, không chỉ đọc YAML.

## 7. `CONFIG-005` — Chưa chứng minh HTTPS/WSS bắt buộc

### Trạng thái

`NOT RUN` trong T06 vì chưa có public HTTPS/WSS URL. Source topology hiện tại không chứa TLS server block, certificate hoặc redirect HTTP sang HTTPS.

### Mô tả

Nginx publish cổng 80/443 nhưng repository chưa có:

- `listen 443 ssl` và certificate configuration;
- HTTP-to-HTTPS redirect/chặn cleartext;
- Reverse proxy route cho backend, frontend và signaling;
- Bằng chứng external load balancer/CDN đang terminate TLS.

Backend `8080`, signaling `3000` và frontend `5173` còn được publish trực tiếp.

### Tình huống người dùng

- Token gửi qua HTTP/WS cleartext có thể bị nghe lén trên mạng không tin cậy.
- Website HTTPS kết nối `ws://` có thể bị trình duyệt chặn mixed content.
- Cuộc gọi không kết nối hoặc người dùng bị chiếm phiên nếu deployment thực sự cho phép cleartext.

### Bằng chứng

- Backend direct port: [`docker-compose.yml`](../docker-compose.yml#L83).
- Signaling direct port: [`docker-compose.yml`](../docker-compose.yml#L105).
- Frontend direct port: [`docker-compose.yml`](../docker-compose.yml#L117).
- Nginx chỉ publish port: [`docker-compose.yml`](../docker-compose.yml#L125).
- Nginx config không có TLS server block: [`ops/logging/nginx.conf`](../ops/logging/nginx.conf#L10).

### Điều cần xác nhận

- Production có Cloudflare, ALB, ingress hoặc reverse proxy nằm ngoài repository không?
- Các direct ports có bị firewall chặn từ Internet không?
- Frontend production dùng `https://` và `wss://` tuyệt đối hay derive theo origin?

### Tiêu chí xác nhận sau sửa

- HTTP/WS public bị redirect hoặc chặn theo policy.
- HTTPS/WSS dùng certificate hợp lệ.
- Token không truyền qua cleartext.
- Direct backend/signaling ports không thể bypass TLS entrypoint từ Internet.

## 8. `INT-011` — Internal routes chưa được cô lập ở tầng mạng

### Trạng thái

`NOT RUN` trong T06 vì cần kiểm tra từ public/private network thật. Đây là defense-in-depth gap, không phải bằng chứng rằng internal API hiện không có authentication.

### Mô tả

Backend publish cổng `8080`, vì vậy `/internal/**` có thể tới được ở tầng mạng nếu host port public. Spring cho `/internal/**` đi qua security authorization chung bằng `permitAll`, sau đó các custom filters xác thực shared secret cho từng internal endpoint.

Shared-secret filters hiện là lớp bảo vệ có thật. Khoảng trống là chưa thấy network isolation, firewall policy hoặc tài liệu chấp nhận việc expose internal route.

### Tình huống người dùng

Trong trạng thái bình thường, request không có đúng secret sẽ nhận `401`. Nguy cơ tăng mạnh nếu internal secret bị lộ qua environment, Docker access, log hoặc một service khác bị compromise:

1. Attacker không cần ở private network vì gọi được backend public.
2. Attacker dùng secret để gọi notify/webhook như một service nội bộ.
3. Người dùng có thể nhận cuộc gọi giả, trạng thái video sai hoặc dịch vụ chậm do spam.

Ngay cả khi secret chưa lộ, endpoint public vẫn nhận traffic rác tới lớp ứng dụng, làm tăng connection/log/CPU pressure.

### Bằng chứng

- Backend publish cổng 8080: [`docker-compose.yml`](../docker-compose.yml#L83).
- `/internal/**` được đưa qua custom filters: [`backend/src/main/java/com/veiltalk/auth/SecurityConfig.java`](../backend/src/main/java/com/veiltalk/auth/SecurityConfig.java#L68).
- Call notify filter trả 401 khi credential sai: [`backend/src/main/java/com/veiltalk/call/CallNotifyAuthenticationFilter.java`](../backend/src/main/java/com/veiltalk/call/CallNotifyAuthenticationFilter.java#L48).
- Video webhook filter tương ứng: [`backend/src/main/java/com/veiltalk/video/VideoWebhookAuthenticationFilter.java`](../backend/src/main/java/com/veiltalk/video/VideoWebhookAuthenticationFilter.java#L49).
- Định nghĩa test: [`scripts/t06-seciurity/VEILTALK_T06_SECURITY_TEST_CASES.md`](../scripts/t06-seciurity/VEILTALK_T06_SECURITY_TEST_CASES.md#L1606).

### Điều cần xác nhận

- Internal API intended private hay intended public + shared secret?
- Nếu public, có rate limit, rotation, audit và incident response policy nào?
- Proxy/firewall production có chặn `/internal/**` từ public network không?

### Tiêu chí xác nhận sau sửa

- Nếu intended private: client public không kết nối được tới internal routes ở tầng mạng/proxy.
- Private services vẫn gọi được bằng credential hợp lệ.
- Secret sai/thiếu tiếp tục fail closed.
- Secret không xuất hiện trong log hoặc response.

## 9. Thứ tự xử lý đề xuất

Nếu hệ thống chưa public:

1. Sửa multi-socket disconnect.
2. Sửa `VID-017`.
3. Sửa `expires_in`.
4. Thêm test rồi sửa server-generated `CALL_END` thiếu `call_id`.
5. Chốt production topology và xử lý `CONFIG-003`, `CONFIG-005`, `INT-011` trước khi triển khai public.

Nếu hệ thống chuẩn bị public ngay:

1. Chặn public database/Redis/MinIO và direct service ports (`CONFIG-003`).
2. Dựng HTTPS/WSS entrypoint bắt buộc (`CONFIG-005`).
3. Cô lập internal routes hoặc phê duyệt policy bảo vệ tương đương (`INT-011`).
4. Song song sửa bốn lỗi code/contract ở trên.

## 10. Các mục không nên trộn vào danh sách bug code ưu tiên

Những mục sau vẫn có giá trị nhưng chủ yếu là hardening, vận hành hoặc thiếu bằng chứng deployment:

- `CONFIG-006`: backend có security-header config, còn thiếu đường HTTPS thật để kiểm tra end-to-end.
- `CONFIG-009`: chưa có bằng chứng secret thật nằm trong image; thiếu release artifacts để kiểm tra.
- `CONFIG-010`: non-root container hardening và Dockerfiles chưa hoàn chỉnh.
- `CONFIG-011`: chưa có reverse proxy route thật để test path normalization/bypass.
- `CONFIG-012`: backend forwarding-header logic khá an toàn; signaling còn thiếu proxy IP configuration.
- `CONFIG-014`: CSP là hardening quan trọng nhưng chưa phải bug chức năng đã khai thác.
- `LOG-008`: thiếu audit trail rõ ràng; test hiện dựa vào regex log và cần thống nhất audit sink/schema.
- `LOG-010`: có logrotate template nhưng chưa chứng minh đã cài và chạy trên host.
- `SUPPLY-001`: chưa scan vì thiếu `NVD_API_KEY`, chưa thể kết luận có CVE.
- `SUPPLY-004`: image provenance/digest chưa đạt policy; kết quả hiện chưa chứng minh image có High/Critical CVE.

## 11. Nguyên tắc cho phiên sửa lỗi tiếp theo

- Không sửa assertion để làm test xanh nếu contract chưa thay đổi hợp lệ.
- Giữ từng lỗi trong một regression test nhỏ, tái hiện được độc lập.
- Sau khi sửa, chạy test mục tiêu trước rồi chạy suite liên quan.
- Không coi deployment-dependent case là PASS chỉ bằng source review; cần probe từ môi trường tương đương production.
- Không ghi token, shared secret, password hoặc presigned URL đầy đủ vào evidence/log.

