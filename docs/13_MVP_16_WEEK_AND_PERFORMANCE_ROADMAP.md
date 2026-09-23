# VEILTALK — ROADMAP 16 TUẦN MVP + 08 TUẦN CHỊU TẢI VÀ HIỆU NĂNG

**Phiên bản:** 2.0 — Bản hợp nhất chính thức  
**Ngày lập:** 22/09/2026  
**Thời gian MVP:** 16 tuần, từ 21/09/2026 đến 10/01/2027  
**Thời gian Performance/Load:** 08 tuần, từ 11/01/2027 đến 07/03/2027  
**Tổng thời gian roadmap:** 24 tuần  

> Thời gian là khung điều phối, không phải lý do để hạ tiêu chuẩn nghiệm thu. Nếu một gate kỹ thuật quan trọng cần thêm thời gian, task được giữ mở và lịch sau được cập nhật bằng bằng chứng; không đổi `CODE COMPLETE` thành `DONE` chỉ để kịp mốc.

## 1. Cách hiểu phạm vi

Roadmap này chia dự án thành hai chặng độc lập về mục tiêu nghiệm thu:

1. **Chặng A — MVP, tuần 1–16:** hoàn thiện sản phẩm chạy đầu-cuối. Kết thúc tuần 16 mới được coi là kết thúc MVP.
2. **Chặng B — Chịu tải và hiệu năng, tuần 17–24:** đo baseline, tìm bottleneck, tối ưu, scale ngang, kiểm thử độ bền và công bố capacity bằng số liệu.

Kết thúc MVP không đồng nghĩa dự án đã hoàn thành mục tiêu nâng cao. MVP chỉ xác nhận tính đúng và tính đầy đủ của luồng sản phẩm. Mọi tuyên bố về số người dùng đồng thời, latency, throughput hoặc khả năng scale chỉ được đưa ra sau Chặng B.

### 1.1. Phạm vi MVP bắt buộc

- Xác thực và quản lý tài khoản.
- Chọn, tùy chỉnh, xem trước và lưu avatar.
- Tracking/render avatar local-only, bảo vệ quyền riêng tư.
- Home, tìm người dùng và chat realtime.
- Gọi 1-1 bằng audio + `AvatarPosePacket`; không truyền webcam video track.
- Quay canvas avatar, upload trực tiếp MinIO và quản lý thư viện video.
- Profile, settings, logout và xóa tài khoản.
- Automated test, integration test, E2E, security test và demo ổn định.
- Avatar MVP chạy được trên ít nhất 03 VRM.

### 1.2. Phạm vi không chặn MVP

- Continuous anatomical fingers hoàn chỉnh.
- Contact tay–mặt/thân.
- Hair, clothing và accessory secondary motion nâng cao.
- Two-hand/object interaction.
- Motion prior hoặc AI completion.
- Full-body và soft-body deformation.
- Scale ngang signaling hoàn chỉnh nếu phương án một instance đã benchmark đủ cho MVP; giới hạn phải được ghi rõ.

### 1.3. Câu hỏi nghiên cứu của giai đoạn Performance

Chặng B phải trả lời bằng số liệu, không trả lời bằng suy đoán:

1. Một backend instance chịu được bao nhiêu request/giây ở mức ổn định?
2. Hệ thống chịu được bao nhiêu người dùng và kết nối đồng thời trên phần cứng thử nghiệm?
3. Messaging WebSocket chịu được bao nhiêu connection và message/giây trước khi latency/error tăng mạnh?
4. Signaling xử lý được bao nhiêu phiên thiết lập cuộc gọi đồng thời?
5. PostgreSQL bắt đầu bottleneck ở query, CPU, I/O, lock hay connection pool?
6. Redis Pub/Sub và các thao tác rate-limit/token blacklist có trở thành bottleneck không?
7. Multipart video tạo tải bao nhiêu lên backend metadata và bao nhiêu lên MinIO/network?
8. Tăng backend từ một lên hai instance làm throughput tăng bao nhiêu và bottleneck chuyển về đâu?
9. Khi một backend/signaling/Redis/MinIO bị gián đoạn, hệ thống lỗi và phục hồi như thế nào?
10. P50/P95/P99, throughput và error rate thay đổi ra sao khi tăng tải?
11. Soak test có phát hiện memory, connection, session hoặc resource leak không?
12. Capacity khuyến nghị của một node là bao nhiêu và safety margin hợp lý là gì?

### 1.4. Điểm nhấn học thuật

Ngoài việc chứng minh VeilTalk chạy được, báo cáo cuối cần phân tích:

- Hiệu quả của kiến trúc client-heavy đối với tải server.
- Redis Pub/Sub trong mô hình WebSocket nhiều backend instance.
- Cursor pagination/index khi dataset tăng lớn.
- Ảnh hưởng của signaling state in-memory tới khả năng scale và failover.
- Lợi ích của presigned multipart upload trong việc tách data plane khỏi backend.
- Scaling efficiency khi tăng số backend instance.
- Breaking point, bottleneck migration và giới hạn thực tế của kiến trúc.

---

## 2. Definition of Done cho MVP ở cuối tuần 16

MVP chỉ được đóng khi đáp ứng đồng thời các điều kiện sau:

### 2.1. Chức năng

- [ ] Hai tài khoản có thể đăng ký, đăng nhập và khôi phục session.
- [ ] Người dùng chọn, tùy chỉnh, preview và lưu avatar.
- [ ] Hai người dùng tìm thấy nhau theo đúng privacy setting.
- [ ] Hai người dùng tạo conversation và chat realtime.
- [ ] Hai thiết bị thực hiện được cuộc gọi audio + avatar pose.
- [ ] Người dùng quay canvas avatar, upload, xem lại, đổi tên và xóa video.
- [ ] Profile, theme, discoverable, logout và delete account hoạt động.

### 2.2. Avatar và quyền riêng tư

- [ ] Ít nhất 03 VRM qua cùng một manual acceptance matrix.
- [ ] Face, gaze, head/neck/torso/shoulder, arm và wrist không có lỗi flip/snap nghiêm trọng.
- [ ] Tracking loss/reacquire và model reload không giữ stale state.
- [ ] Không có NaN/Infinity trong output đã đo.
- [ ] Không gửi ảnh webcam, video webcam hoặc raw landmarks khỏi trình duyệt.
- [ ] Packet có version và fallback rõ ràng.

### 2.3. Chất lượng

- [ ] Frontend test/lint/build xanh.
- [ ] Signaling test xanh.
- [ ] Backend test chạy tái lập bằng một lệnh trên test stack sạch.
- [ ] TC-01 → TC-58 có kết quả và bằng chứng.
- [ ] Không còn lỗi Critical hoặc High.
- [ ] E2E hai trình duyệt/thiết bị chạy lặp lại.
- [ ] Có release tag, runbook và video demo dự phòng.

### 2.4. Performance tối thiểu để chấp nhận MVP

Đây là client gate tối thiểu, chưa phải kết quả chịu tải cuối dự án:

- [ ] Avatar đạt trung bình ít nhất 24 FPS trên máy tham chiếu.
- [ ] Tracking-to-render trung bình dưới 100 ms; p95 được ghi lại.
- [ ] WebRTC setup thành công trong kịch bản demo đã định nghĩa.
- [ ] Không có memory/GPU leak rõ ràng khi đổi model và kết thúc cuộc gọi.

---

## 3. Chặng A — Roadmap MVP 16 tuần

## Tuần 1 — 21/09 đến 27/09: Khóa baseline và môi trường kiểm thử

**Mục tiêu:** có một baseline đáng tin cậy trước khi tiếp tục phát triển.

### Công việc

- Chuẩn hóa PostgreSQL, Redis, MinIO và secret cho backend test.
- Tạo lệnh duy nhất để dựng test stack và chạy backend test.
- Chạy lại toàn bộ 228 backend test, phân biệt lỗi môi trường và lỗi code.
- Xác nhận frontend 777 test, lint và build.
- Xác nhận signaling 36 test.
- Chốt status file và scope MVP/non-MVP.
- Tạo defect/risk log dùng xuyên suốt 16 tuần.
- Ghi baseline bundle/asset hiện tại.

### Bằng chứng nghiệm thu

- Backend test report chạy từ môi trường sạch.
- Script/runbook một lệnh.
- Bảng baseline frontend/signaling/backend.
- Danh sách blocker có owner và hạn xử lý.

## Tuần 2 — 28/09 đến 04/10: Đóng face và gaze gate

**Mục tiêu:** đóng các phần avatar đã code nhưng còn thiếu manual acceptance.

### Công việc

- Chạy F4 D1–D10: nói nhanh, pucker, m/b/p, silent smile.
- Chạy AR3 E1–E12 trên ít nhất 03 VRM.
- Kiểm tra faithful/cinematic, eyelid coupling và head-relative gaze.
- Ghi latency, saturation, neutral recovery và invalid output.
- Chạy AR4 verification follow-up để phát hiện regression.
- Mỗi lỗi manual phải có fixture/regression trước corrective.

### Bằng chứng nghiệm thu

- Video manual test theo case ID.
- Bảng PASS/FAIL theo model.
- Metric và corrective commit nếu có.
- F4/AR3 được đóng hoặc có blocker cụ thể.

## Tuần 3 — 05/10 đến 11/10: AR5-T01 lát cắt 1–4

**Mục tiêu:** triển khai lại anatomical arm constraints mà không phá baseline tay.

### Công việc

- AR5-T01-01: contract, profile, validator và model generation.
- AR5-T01-02: pure shoulder cone.
- AR5-T01-03: elbow hinge và pole transport.
- AR5-T01-04: elbow-side hysteresis theo timestamp.
- Targeted test sau từng lát cắt.
- So sánh legacy/constraint output bằng DEV feature flag.
- Không tích hợp nhiều lát cắt khi lát trước chưa xanh.

### Bằng chứng nghiệm thu

- Unit/property tests cho từng solver.
- Không regression test hiện hữu.
- Không stale state khi reload model.
- Báo cáo quyết định tiếp tục hoặc rollback từng lát cắt.

## Tuần 4 — 12/10 đến 18/10: AR5-T01 integration và khóa Avatar MVP

**Mục tiêu:** hoàn tất AR5-T01 và freeze contract avatar dùng cho WebRTC.

### Công việc

- AR5-T01-05: upper-arm twist.
- AR5-T01-06: tích hợp arm solver và candidate ranking.
- AR5-T01-07: diagnostics/metrics/DEV panel.
- AR5-T01-08: A1–A14 trên ít nhất 03 VRM.
- Chạy F7 subset bắt buộc 03 VRM × 60 giây.
- Chốt gesture preset; continuous fingers chuyển backlog sau MVP.
- Freeze/version `AvatarPosePacket`.
- Privacy audit packet.

### Bằng chứng nghiệm thu

- Acceptance report 03 VRM.
- Không flip/snap nghiêm trọng, invalid output bằng 0 trong gate.
- FPS/latency đạt gate hoặc corrective có hạn rõ ràng.
- Tag/checkpoint `avatar-mvp`.

## Tuần 5 — 19/10 đến 25/10: P4-T11 Customize và Preview

**Mục tiêu:** hoàn thành setup avatar đầu-cuối.

### Công việc

- SCR-08: tóc, mắt, outfit và color swatches theo catalog hỗ trợ.
- Giữ model/customization state qua route và reload phù hợp.
- SCR-09: webcam + live avatar preview.
- Camera permission, loading, error và retry states.
- Gọi `PUT /avatars/me`.
- Edit/resume flow cho user đã có avatar.
- Route guard và điều hướng đến Home.
- Lazy-load DEV harness và model/asset lớn.

### Bằng chứng nghiệm thu

- Demo register → select → customize → preview → save → Home.
- Component/API tests.
- Không raw webcam/landmark egress.

## Tuần 6 — 26/10 đến 01/11: P4-T12 Home và P4-T13 Search

**Mục tiêu:** người dùng có thể tìm nhau và mở conversation.

### Công việc

- Home conversation list bằng cursor.
- Last message, empty state và avatar fallback.
- Không hiển thị presence sai khi chưa có Presence Service.
- Search user với anti-enumeration.
- Countdown cho 429.
- Local history tối đa năm email.
- Tạo/mở conversation idempotent.

### Bằng chứng nghiệm thu

- Hai tài khoản tìm và mở conversation được.
- Pagination không trùng/mất.
- Privacy/search tests PASS.

## Tuần 7 — 02/11 đến 08/11: P4-T14 Chat realtime

**Mục tiêu:** chat REST + WebSocket chạy ổn định.

### Công việc

- Message list/bubble.
- Load lịch sử cũ bằng keyset cursor.
- Optimistic/idempotent send.
- Merge REST response và `NEW_MESSAGE` không tạo duplicate.
- `sent/delivered/read` UI.
- Typing/typing-stop.
- Offline/reconnect banner.
- Kiểm tra nhiều tab/session.

### Bằng chứng nghiệm thu

- Chat realtime hai tài khoản.
- History/reconnect không mất hoặc trùng tin.
- Integration tests cho các race chính.

## Tuần 8 — 09/11 đến 15/11: P4-T15/T16 WebRTC và signaling client

**Mục tiêu:** thiết lập được peer connection audio + pose.

### Công việc

- Signaling WebSocket client vòng đời ngắn.
- `RTCPeerConnection`, ICE và audio track.
- DataChannel chỉ truyền packet đã freeze.
- Không thêm webcam video track.
- Jitter buffer/timestamp alignment phiên bản tối thiểu.
- Kiểm tra STUN; đánh giá TURN sớm.
- Log setup time, RTT và disconnect reason.

### Bằng chứng nghiệm thu

- Hai peer kết nối được trên môi trường test định nghĩa.
- Remote avatar nhận pose.
- Privacy audit bằng WebRTC stats/packet inspection.

## Tuần 9 — 16/11 đến 22/11: P4-T17/T18 Call UI

**Mục tiêu:** hoàn thành gọi đi và nhận cuộc gọi.

### Công việc

- Calling screen, timeout 30 giây và retry/message fallback.
- Incoming screen.
- Accept/reject/end flow.
- Busy handling khi đang trong cuộc gọi.
- Cleanup signaling/peer connection khi cancel, reject hoặc mất kết nối.

### Bằng chứng nghiệm thu

- 10 lần gọi thử với kết quả success/failure được ghi.
- Không session treo sau reject/timeout/disconnect.

## Tuần 10 — 23/11 đến 29/11: P4-T19 Active Call

**Mục tiêu:** màn gọi hoàn chỉnh và avatar hoạt động trong cuộc gọi thật.

### Công việc

- Remote avatar lớn và self PiP.
- Mic, Tracking, End, Chat và More controls.
- Auto-hide controls.
- Reconnecting overlay.
- Loss/reacquire avatar trong call.
- Kiểm tra AR4/AR5 không regression trong layout thật.
- Đo FPS, tracking-to-render, packet rate và RTT.

### Bằng chứng nghiệm thu

- Cuộc gọi hai thiết bị ổn định theo test window.
- Không gửi video/raw landmarks.
- Metric call baseline v0.

## Tuần 11 — 30/11 đến 06/12: P4-T20 Record Flow

**Mục tiêu:** quay và upload canvas avatar.

### Công việc

- `canvas.captureStream()` và `MediaRecorder`.
- Chunk upload trực tiếp tới MinIO bằng presigned URL.
- ETag, retry, finalize và abort.
- Xử lý quota và upload failure.
- Không ghi webcam thật.
- Cleanup resource khi stop/unmount.

### Bằng chứng nghiệm thu

- Record → upload → processing → ready.
- Failure/retry/abort tests.
- Kiểm tra backend không relay binary video.

## Tuần 12 — 07/12 đến 13/12: P4-T21/T22 Video Library

**Mục tiêu:** quản lý đầy đủ video đã quay.

### Công việc

- Library grid và cursor pagination.
- Storage indicator và quota states.
- Resume dialog nếu giữ trong MVP scope.
- Video player.
- Rename/delete.
- `recording`, `processing`, `ready`, `failed` UI.

### Bằng chứng nghiệm thu

- Record → library → playback → rename → delete.
- Quota, failed và processing cases PASS.

## Tuần 13 — 14/12 đến 20/12: P4-T23/T24 Profile và Settings

**Mục tiêu:** đóng toàn bộ màn hình sản phẩm còn lại.

### Công việc

- Profile avatar và display name.
- Discoverable setting.
- Theme setting.
- Logout.
- Delete account bằng password confirmation.
- No-connection/error screen.
- Session-expired handling xuyên ứng dụng.
- Accessibility cơ bản: keyboard, focus, label và error announcement.

### Bằng chứng nghiệm thu

- Profile/settings API integration PASS.
- Xóa tài khoản thu hồi session và kích hoạt video cleanup.

## Tuần 14 — 21/12 đến 27/12: Phase 5 Integration và Security

**Mục tiêu:** chạy toàn bộ test plan, không chỉ unit test riêng lẻ.

### Công việc

- P5-T01 → P5-T04: TC-01 → TC-45.
- Auth, avatar, search, conversation, video và security.
- CORS, JWT, anti-enumeration, webhook authentication.
- Test hai browser/tài khoản.
- Lập defect log và triage.

### Bằng chứng nghiệm thu

- Test report TC-01 → TC-45.
- Critical/High có owner và deadline.

## Tuần 15 — 28/12 đến 03/01: Full E2E và sửa lỗi

**Mục tiêu:** chạy luồng VeilTalk hoàn chỉnh, lặp lại được.

### Công việc

- P5-T05: TC-46 → TC-58.
- Register → avatar → search → chat → call → record → playback → settings.
- Hai thiết bị hoặc hai browser profile độc lập.
- Network interruption và reconnect.
- Sửa Critical → High → Medium.
- Regression toàn bộ test sau mỗi nhóm fix.

### Bằng chứng nghiệm thu

- Full E2E video.
- Critical = 0, High = 0.
- Release candidate 1.

## Tuần 16 — 04/01 đến 10/01: Đóng MVP

**Mục tiêu:** release MVP có thể demo và chuyển sang workstream chịu tải.

### Công việc

- Chạy lại Definition of Done toàn MVP.
- Client performance gate 03 VRM.
- Cập nhật README, API, architecture, deployment và codebase guide.
- Hoàn thiện runbook và seed/demo data.
- Tạo release tag và backup artifacts.
- Ghi known limitations rõ ràng.
- Freeze feature: sau mốc này không thêm chức năng MVP mới nếu không phải blocker.

### Bằng chứng nghiệm thu

- Release `mvp-v1`.
- Test report, manual avatar report và demo video.
- Runbook dựng hệ thống từ môi trường sạch.
- Danh sách giới hạn chuyển sang Chặng B.

---

## 4. Chặng B — Roadmap 08 tuần chịu tải và hiệu năng

Chặng B được chia thành:

- **Tháng 1, tuần 17–20 — bắt buộc:** workload, observability, baseline và tối ưu chính.
- **Tháng 2, tuần 21–24 — chuyên sâu:** scale ngang, resilience, soak/stress và capacity report.

Nếu chỉ có thêm một tháng, phải hoàn thành tuần 17–20 và công bố giới hạn một instance trung thực. Nếu có đủ hai tháng, tiếp tục tuần 21–24.

## 4.1. Nguyên tắc thực nghiệm bắt buộc

Chu trình của mọi tối ưu:

```text
MEASURE → IDENTIFY BOTTLENECK → CHANGE ONE CONTROLLED VARIABLE → MEASURE AGAIN
```

- Không tối ưu trước khi có baseline.
- Không kết luận scalability khi chỉ chạy một instance.
- Không kết luận capacity từ CPU hoặc average latency đơn lẻ.
- Không thay average cho P95/P99.
- Không load test database rỗng.
- Không thay đổi đồng thời nhiều biến rồi nhận toàn bộ cải thiện cho một nguyên nhân.
- Không đổi workload, dataset hoặc phần cứng giữa before/after mà không công bố.
- Không tăng timeout, retry, pool hoặc cache chỉ để che bottleneck.
- Không đánh đổi correctness, security hoặc privacy để lấy throughput.
- Raw result, log, dashboard snapshot và script phải truy vết được tới từng kết luận.

## 4.2. SLO dự thảo và KPI khởi điểm

SLO ban đầu chỉ là giả thuyết cần benchmark và hiệu chỉnh, không phải kết quả đã đạt:

Các số dưới đây là target để kiểm thử, không phải kết quả đã đạt:

| Workload | Target khởi điểm | Gate đánh giá |
|---|---:|---|
| REST hỗn hợp | 100 virtual users, ramp 2 phút, steady 10 phút | Error <1%; p95 read ≤300 ms; login/video-init ≤500 ms |
| Messaging WebSocket | 200 kết nối, 50 message/s, soak 30 phút | Delivery p95 ≤500 ms; lỗi/disconnect <1%; không leak rõ |
| Signaling | 40 client, 20 cặp setup đồng thời | Setup success ≥95%; setup trung bình <5 giây; không session treo |
| Video metadata/presign | 20 phiên metadata, 5 upload đồng thời | API p95 ≤500 ms; không sai quota/idempotency |
| Client avatar | 03 VRM × 10 lần × 60 giây | ≥24 FPS; avg <100 ms; p95 <150 ms; invalid = 0 |
| Tài nguyên | Theo dõi toàn bài test | Không OOM; CPU không duy trì >80%; pool pending không kéo dài |

Ngưỡng được hiệu chỉnh sau baseline nhưng mọi so sánh before/after phải chạy trên cùng phần cứng, data seed và workload version.

Các SLO chi tiết cần chốt ở tuần 17:

- User search P95 mục tiêu dưới 250–300 ms.
- Message-send API P95 mục tiêu dưới 200–300 ms.
- WebSocket delivery P95 mục tiêu dưới 200–500 ms tùy topology thực tế.
- Connection/setup success trên 99% cho tải ổn định đã công bố.
- Signaling backend overhead được đo riêng với tổng thời gian ICE/WebRTC setup.
- Error rate dưới 1% trong stable-load window; lỗi chủ động do rate limit phải báo cáo riêng.

## 4.3. Workload profiles

Không dùng một workload hỗn hợp duy nhất cho mọi kết luận. Tối thiểu có bốn profile:

### Profile A — Browse/Read Heavy

- Restore session/login.
- Lấy profile/avatar.
- Conversation list.
- Message history pagination.
- Video library metadata.

### Profile B — Chat Heavy

- WebSocket giữ kết nối.
- Đọc conversation/message history.
- Gửi message mỗi 10–30 giây theo phân phối có seed.
- Typing/typing-stop.
- Delivery/read status và Redis Pub/Sub fanout.

### Profile C — Call Heavy

- CALL_INCOMING notification.
- Signaling connect/auth.
- OFFER → ANSWER → ICE → END.
- Không giả lập audio/media đi qua backend nếu kết nối là P2P.

### Profile D — Video Upload

- Tạo multipart upload.
- Nhận presigned part URL.
- Client PUT part trực tiếp tới MinIO.
- Finalize và webhook.
- Phân biệt backend metadata latency với MinIO MB/s và network throughput.

Mỗi profile phải ghi tỷ lệ hành động, think time, session duration, ramp và steady window.

## 4.4. Dataset tiers

Dataset phải version hóa và có thể seed lại:

| Tier | Users | Conversations | Messages | Video metadata | Mục đích |
|---|---:|---:|---:|---:|---|
| Small | 10.000 | 10.000+ | 100.000+ | 10.000 | Smoke và debug script |
| Medium | 50.000 | 50.000+ | 1.000.000+ nếu máy cho phép | 50.000 | Baseline và query/index profiling |
| Large | 100.000+ | Theo workload | Trên 1.000.000 | 100.000 | Stress/query scale nếu phần cứng cho phép |

Large tier không phải điều kiện bắt buộc nếu phần cứng không đáp ứng. Báo cáo phải ghi rõ tier thực tế và không so sánh hai lần chạy khác dataset như before/after tương đương.

## 4.5. Load ladder khám phá

Các mức dưới đây là dải thử ban đầu, không phải capacity tuyên bố:

| Scenario | Load ladder ban đầu |
|---|---|
| REST | 10 → 25 → 50 → 100 → 200 VU; mở rộng tới 500 nếu còn headroom |
| Message-send API | 10 → 50 → 100 → 250 VU; mở rộng theo baseline |
| Messaging WebSocket | 100 → 250 → 500 → 1.000 → 2.000 connection; cao hơn chỉ khi hạ tầng cho phép |
| Signaling setup | 10 → 20 → 50 → 100 → 250 cặp đồng thời |
| Video metadata | 10 → 25 → 50 → 100 VU |
| Multipart data upload | 5 → 10 → 20 → 50 upload đồng thời, đo riêng MinIO/network |

Mỗi stage có warm-up, ramp và steady window 5–10 phút. Không chạy stage kế tiếp nếu đã chạm điều kiện dừng.

## 4.6. Điều kiện dừng an toàn

Dừng hoặc giảm tải khi xảy ra một trong các điều kiện:

- Error rate vượt ngưỡng liên tục trong cửa sổ đánh giá.
- CPU duy trì trên 90% và latency tăng mất kiểm soát.
- OOM, swap pressure nghiêm trọng hoặc disk gần đầy.
- Hikari pending kéo dài/pool exhaustion.
- PostgreSQL connection/lock/I/O bão hòa.
- Redis blocked clients, latency hoặc memory tăng bất thường.
- WebSocket send queue/backpressure tăng không hồi phục.
- Dữ liệu sai, mất tính idempotent, sai quota hoặc có dấu hiệu corruption.
- Test harness trở thành bottleneck; phải đo resource phía load generator.

Failure injection chỉ chạy trên test stack với dataset có thể tái tạo, không chạy trên dữ liệu phát triển quan trọng.

## 4.7. Metric theo tầng

### API/JVM

- Request/giây, P50/P95/P99 và error rate theo endpoint/status.
- CPU, heap/RSS, GC pause, thread và allocation nếu đo được.
- Hikari active/idle/pending, acquire time và timeout.

### Messaging WebSocket

- Concurrent connections, connect success và disconnect/reconnect rate.
- Message/giây và delivery P50/P95/P99.
- Resource/connection.
- Send failure, queue/backpressure, heartbeat timeout.
- Redis Pub/Sub publish-to-local-delivery delay.

### Signaling Node.js

- Connections, active/pending sessions và cleanup count.
- Setup/giây, OFFER→ANSWER và signaling processing latency.
- Error/timeout/TARGET_OFFLINE rate.
- Event-loop lag, RSS/heap và resource/session.

### PostgreSQL

- `pg_stat_statements`, slow query và query throughput.
- Sequential/index scans, buffer hit, rows examined/returned.
- Active/idle connections, transaction duration, lock wait và deadlock.
- CPU, memory và I/O nếu quan sát được.

### Redis

- Ops/giây, command latency, memory và eviction.
- Connected/Pub/Sub/blocked clients.
- Pub/Sub throughput và cross-instance delivery.

### Video/MinIO

- Backend create/chunk/finalize/webhook P50/P95/P99.
- MinIO response latency, concurrent upload và MB/s.
- Retry/error, quota/idempotency/race correctness.
- Backend CPU/RAM phải được tách khỏi storage/network utilization.

### WebRTC/client avatar

- Call setup và success rate.
- Peer/DataChannel RTT, pose packet rate, loss/jitter nếu quan sát được.
- Tracking-to-render, FPS và invalid output.
- Audio–mouth alignment nếu pipeline có metric phù hợp.
- Không gọi P2P media traffic là backend throughput; nếu dùng TURN phải đo và báo cáo TURN riêng.

## Tuần 17 — 11/01 đến 17/01: Workload model và test harness

**Mục tiêu:** tạo workload có thể chạy lại, không đo thủ công cảm tính.

### Công việc

- Mô tả user journey và tỷ lệ read/write.
- Chốt SLO dự thảo và cách tính cửa sổ đánh giá.
- Chốt bốn workload profile Browse/Chat/Call/Video.
- Seed user, avatar, conversation, message và video metadata.
- Chuẩn bị Small tier; kiểm tra khả năng tạo Medium tier.
- k6 cho REST và Messaging WebSocket.
- Node harness cho signaling.
- Kịch bản smoke, load, stress, spike và soak.
- Version hóa config, dataset và result schema.
- Container resource limits cho môi trường test.
- Đo CPU/RAM/network của chính load generator.
- Định nghĩa run ID, thư mục output và điều kiện dừng.

### Bằng chứng nghiệm thu

- Một lệnh seed và một lệnh chạy từng workload.
- Raw JSON/CSV được lưu theo run ID.
- Workload README ghi rõ phần cứng và topology.
- Ma trận workload/profile/dataset/SLO đã được duyệt.

## Tuần 18 — 18/01 đến 24/01: Observability và baseline

**Mục tiêu:** nhìn thấy bottleneck trước khi tối ưu.

### Công việc

- Micrometer/Prometheus cho HTTP, JVM, Hikari, Redis và DB.
- Metric WS connection, message fanout, send failure và buffer/backpressure.
- Metric signaling connection/session/setup/error/cleanup.
- Node event-loop lag cho signaling.
- Correlation/request ID xuyên log phù hợp.
- Dashboard Grafana hoặc report tương đương.
- Bật/đọc `pg_stat_statements`, lock/connection/buffer metrics.
- Thu Redis command latency, connected/Pub/Sub/blocked clients.
- Chạy load ladder baseline cho REST, WS, signaling và video API.
- Thu p50/p95/p99, RPS, error rate, CPU, RAM, GC, pool wait và DB query.
- Xác minh load generator chưa bão hòa trước system under test.

### Bằng chứng nghiệm thu

- Dashboard và raw baseline v1.
- Top 5 bottleneck có dữ liệu chứng minh.
- Breaking point sơ bộ của topology một instance.
- Raw result có run ID và dashboard snapshot tương ứng.

## Tuần 19 — 25/01 đến 31/01: Database, API và video optimization

**Mục tiêu:** giảm latency/pool pressure mà không làm sai nghiệp vụ.

### Công việc

- `EXPLAIN ANALYZE` các query nóng.
- Kiểm tra index, cursor pagination, projection và N+1.
- Rút ngắn transaction và cấu hình timeout.
- Thử Hikari pool theo ma trận 10/20/30/50 khi phù hợp; tính tổng pool của mọi instance và không vượt giới hạn DB an toàn.
- Cache catalog/avatar read nếu evidence cho thấy cần.
- Kiểm tra serialization, payload size, logging overhead và Redis round-trip.
- Kiểm tra quota/idempotency/race video khi concurrent.
- Đo riêng create/presign/finalize/webhook với PUT part/MB/s của MinIO.
- Tune cleanup batch/concurrency và retry.
- Chạy lại đúng baseline workload.

### Bằng chứng nghiệm thu

- Query plan trước/sau.
- Bảng latency, throughput và resource before/after.
- Regression chức năng xanh.
- Không nhận cải thiện nếu đổi đồng thời dataset/workload/phần cứng.

## Tuần 20 — 01/02 đến 07/02: Frontend và realtime optimization

**Mục tiêu:** hoàn thành tháng performance tối thiểu với report một instance đáng tin cậy.

### Công việc

- WS connection/user limits, heartbeat và reconnect jitter.
- Backpressure/payload limits và slow-consumer handling.
- Đo Redis Pub/Sub fanout và delivery latency.
- Tính resource trên mỗi WebSocket connection và mỗi mức message rate.
- Nén ảnh WebP/AVIF, route code splitting và cache-control.
- Model cache, abort/latest-request và GPU dispose.
- Đo cold/warm load, memory/VRAM và FPS trong call/record mode.
- Chạy lại toàn bộ workload tháng 1.
- Công bố capacity một instance và giới hạn hiện tại.
- Tạo performance regression suite có thể chạy lại.

### Bằng chứng nghiệm thu

- Performance Report v1.
- Before/after tháng 1.
- Capacity recommendation cho một instance.
- SLO đạt/không đạt theo endpoint/profile, không chỉ số trung bình tổng.
- Danh sách việc cần scale ngang trong tháng 2.

## Tuần 21 — 08/02 đến 14/02: Nginx và hai backend instance

**Mục tiêu:** hiện thực topology production-like cho backend/realtime.

### Công việc

- Cấu hình Nginx reverse proxy thật.
- WebSocket upgrade, idle/read/send timeout và body limits.
- Hai backend instance.
- Health/readiness và graceful shutdown.
- Redis relay cross-instance cho message/status/typing/call incoming.
- Kiểm tra scheduled cleanup coordination khi nhiều instance.
- Kiểm tra connection pool tổng không vượt sức DB.
- Chạy cùng workload/dataset với một và hai instance.
- Tính scaling efficiency và xác định bottleneck có chuyển sang DB/Redis hay không.

### Bằng chứng nghiệm thu

- Cross-instance chat PASS.
- Restart một backend không làm mất toàn hệ thống.
- So sánh một và hai backend instance.
- Báo cáo throughput gain, P95/P99, error và resource thay đổi theo topology.

## Tuần 22 — 15/02 đến 21/02: Scale signaling và failure model

**Mục tiêu:** chọn và chứng minh mô hình signaling có giới hạn rõ ràng.

### Công việc

- Đo signaling một instance tới breaking point.
- Chọn một trong ba hướng:
  - Một instance đã benchmark và có resource limit/runbook.
  - Sticky session cùng routing đảm bảo peer cùng instance.
  - Shared routing/state qua Redis hoặc cơ chế tương đương.
- Bounded maps, timeout, cleanup và rate limit state.
- Test disconnect/restart/session leak.
- Kiểm tra TARGET_OFFLINE giả khi peer khác instance.
- Đo event-loop lag, memory/session và cleanup latency theo tải.
- Nếu chọn sticky session, kiểm tra giới hạn failover; nếu externalize state, kiểm tra tính đúng khi Redis gián đoạn.

### Bằng chứng nghiệm thu

- Architecture decision record.
- Setup success/latency/error theo concurrency.
- Không session treo sau stress/restart.

## Tuần 23 — 22/02 đến 28/02: Stress, spike, soak và resilience

**Mục tiêu:** tìm giới hạn thật và kiểm tra độ bền.

### Công việc

- Stress tăng tải tới breaking point.
- Spike traffic.
- Chạy smoke soak 15 phút, development soak 30–60 phút, final soak tối thiểu 1 giờ; mở rộng 2–4 giờ nếu môi trường cho phép.
- Restart backend và Redis interruption/recovery trong môi trường cho phép.
- Thử PostgreSQL/MinIO unavailable ngắn trên test stack nếu có cơ chế phục hồi an toàn.
- Kiểm tra RAM sau GC, connection leak, session leak và queue growth.
- Đo recovery time, reconnect success và consistency sau failure.
- Kiểm tra degraded mode và error budget.
- Re-run correctness checks sau test chịu tải.

### Bằng chứng nghiệm thu

- Breaking point theo từng workload.
- Resilience/failure report.
- Không che lỗi correctness bằng retry hoặc timeout quá lớn.

## Tuần 24 — 01/03 đến 07/03: Capacity report và đóng workstream hiệu năng

**Mục tiêu:** chuyển kết quả kỹ thuật thành kết luận có thể bảo vệ.

### Công việc

- Tổng hợp baseline, các thay đổi và kết quả after optimization.
- Ghi cấu hình máy, container limits, dataset và workload version.
- Báo cáo p50/p95/p99, throughput, error, CPU, RAM, GC, DB/Redis/pool.
- Công bố capacity recommendation và safety margin.
- Phân biệt max observed, max stable và recommended capacity.
- Ước lượng số instance cho một workload mục tiêu bằng giả định được ghi rõ; không ngoại suy tuyến tính ngoài vùng đã đo.
- Ghi bottleneck còn lại và hướng scale tiếp theo.
- Cập nhật architecture/deployment/runbook.
- Chuẩn bị biểu đồ, bảng và phần trình bày bảo vệ.

### Bằng chứng nghiệm thu

- Performance & Load Report cuối.
- Raw results và scripts truy vết được.
- Bảng before/after.
- Capacity/limitations được công bố trung thực.
- Release `performance-v1`.

---

## 5. Cấu trúc artifact performance

Workstream performance nên được version hóa trong repository theo cấu trúc tương đương:

```text
performance/
├── README.md
├── environments/
├── datasets/
├── scenarios/
├── api/
├── websocket/
├── signaling/
├── video/
├── dashboards/
├── results/
│   └── <run-id>/
└── reports/
```

Mỗi `run-id` tối thiểu lưu:

- Commit SHA và trạng thái working tree.
- Ngày/giờ, phần cứng, OS và container limits.
- Topology và số instance.
- Dataset version/tier.
- Workload/profile và tool version.
- Environment/config đã loại bỏ secret.
- Raw JSON/CSV.
- Metric/dashboard snapshot.
- Tóm tắt PASS/FAIL, anomaly và điều kiện dừng.

Không commit secret, token thật, dữ liệu cá nhân hoặc raw webcam/landmark.

## 6. Cấu trúc Performance & Capacity Report cuối

1. Mục tiêu và câu hỏi nghiên cứu.
2. Kiến trúc và traffic path thực tế.
3. Môi trường/phần cứng/container limits.
4. Dataset và workload model.
5. Công cụ, phương pháp và sai số/giới hạn phép đo.
6. SLO và acceptance criteria.
7. Baseline một instance.
8. Bottleneck analysis theo tầng.
9. Các thay đổi tối ưu và lý do.
10. Before/after trên cùng workload.
11. Horizontal scaling và scaling efficiency.
12. Messaging/Redis cross-instance.
13. Signaling state/scaling decision.
14. Video backend load so với MinIO/storage load.
15. Stress, spike và breaking point.
16. Soak, leak và resource drift.
17. Failure/recovery và consistency.
18. Max observed, max stable, recommended capacity và safety margin.
19. Limitations và rủi ro ngoại suy.
20. Kết luận và hướng phát triển.

---

## 7. Các mốc nghiệm thu

| Mốc | Thời điểm | Điều kiện chính |
|---|---|---|
| M0 — Baseline | Cuối tuần 1 | Test stack tái lập; scope/status được khóa |
| M1 — Avatar MVP | Cuối tuần 4 | 03 VRM qua gate; packet freeze; privacy PASS |
| M2 — Social MVP | Cuối tuần 7 | Avatar setup, Home, Search và Chat hoạt động |
| M3 — Call MVP | Cuối tuần 10 | Audio + pose call hai thiết bị hoạt động |
| M4 — Functional MVP | Cuối tuần 13 | Record, Video Library và Settings hoàn thành |
| M5 — Quality MVP | Cuối tuần 15 | TC-01 → TC-58; Critical/High = 0 |
| M6 — MVP Release | Cuối tuần 16 | Release, docs, runbook và demo đầy đủ |
| P1 — Load Baseline | Cuối tuần 18 | Workload + observability + breaking point sơ bộ |
| P2 — One-instance Optimization | Cuối tuần 20 | Before/after và capacity một instance |
| P3 — Scale/Resilience | Cuối tuần 23 | Hai backend instance; stress/spike/soak/failure evidence |
| P4 — Performance Release | Cuối tuần 24 | Báo cáo cuối và capacity recommendation |

---

## 8. Quy tắc ưu tiên và cắt phạm vi

### 8.1. Trong 16 tuần MVP

Ưu tiên theo thứ tự:

1. Privacy và correctness.
2. Auth/avatar/chat/call/record core flow.
3. Automated/integration/E2E evidence.
4. Stability và error handling.
5. Polish.
6. Avatar research ngoài MVP.

Nếu chậm tiến độ, cắt theo thứ tự:

1. Continuous fingers và avatar research nâng cao.
2. Resume recording edge case.
3. Animation/polish không ảnh hưởng usability.
4. Tính năng phụ không nằm trong core demo.

Không cắt auth, avatar core, chat, call, privacy, record/playback core và bằng chứng test.

### 8.2. Trong 08 tuần performance

- Không tối ưu nếu chưa có baseline.
- Mỗi thay đổi phải chạy lại cùng workload.
- Không tăng timeout/pool/cache như cách che bottleneck.
- Không đánh đổi correctness, security hoặc privacy để lấy throughput.
- Nếu chỉ có bốn tuần, công bố capacity một instance; không tuyên bố scale ngang chưa kiểm chứng.
- Nếu có đủ tám tuần, ưu tiên hai backend instance và failure/soak evidence trước các tối ưu vi mô.

---

## 9. Mẫu báo cáo hằng tuần

Mỗi tuần lưu một gói bằng chứng gồm:

1. Task/mục tiêu và dependency.
2. Commit/tag liên quan.
3. Automated test result.
4. Manual/E2E/load evidence phù hợp.
5. Metric chính.
6. Lỗi/rủi ro và corrective.
7. Quyết định scope cần xác nhận.
8. Tối đa ba mục tiêu kiểm tra được cho tuần tiếp theo.

### Quy ước trạng thái

- `[x] DONE`: đủ code, test và acceptance tương ứng.
- `[-] IN PROGRESS`: đang làm hoặc code complete nhưng còn gate.
- `[ ] NOT STARTED`: chưa bắt đầu.
- `[ ] DEFERRED`: có quyết định hoãn rõ ràng.
- `[ ] ROLLED BACK`: implementation đã gỡ; phải review lại trước khi code.

---

## 10. Đầu ra cuối cùng của đồ án

### Product

- MVP chạy end-to-end trên quy trình triển khai đã tài liệu hóa.
- Demo chính và video demo dự phòng.
- Known limitations rõ ràng.

### Avatar

- Manual/automated/performance evidence trên ít nhất 03 VRM.
- Packet/version/privacy contract.
- Các hướng continuous finger/contact/hair/full-body được đặt đúng ở Future Work nếu chưa nghiệm thu.

### Test

- Unit, integration, security và E2E reports.
- Defect log và trạng thái Critical/High.
- Performance regression scripts.

### Performance

- Workload, dataset seed và dashboard.
- Baseline, bottleneck và before/after optimization.
- Horizontal scaling, stress, soak và failure evidence nếu hoàn thành tháng thứ hai.
- Capacity recommendation và limitations.

### Hồ sơ bảo vệ

- Architecture/implementation/test/performance chapters.
- Bảng/biểu đồ truy vết về raw result.
- Slide, video, runbook và rehearsal checklist.

## 11. Tài liệu liên quan

- `docs/09_ROADMAP_AND_TASKS.md`
- `docs/11_AVATAR_EVOLUTION_ROADMAP.md`
- `docs/12_CURRENT_IMPLEMENTATION_STATUS.md`
- `docs/KE_HOACH_03_THANG_DO_AN_VEILTALK.docx`
- `docs/10_PERFORMANCE.md`
- `docs/07_DEVELOPMENT_AND_TESTING.md`
- `docs/08_DEPLOYMENT_AND_OPERATIONS.md`
- `docs/AR5_T01_ANATOMICAL_ARM_CONSTRAINTS_PLAN.md`
