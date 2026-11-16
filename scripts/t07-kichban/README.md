# T07 Reliability/Concurrency — binary 178-case runner

> **Trạng thái:** báo cáo luôn đánh giá đủ 178 ID và trả kết quả nhị phân `PASS` hoặc `FAIL`; Node test runner chỉ đăng ký những ID đã có implementation và oracle thật.
> Cột `Classification` mới là căn cứ kết luận: `FAIL_PRODUCT` là assertion chức năng đã chạy và không đạt; `FAIL_TEST` là harness chưa triển khai đủ hoặc case không được chọn khi chạy có filter, không phải bằng chứng backend lỗi; `FAIL_ENV` là lỗi cô lập/dọn môi trường.

## Cài đặt

1. Giải nén package này **vào thư mục gốc repository VeilTalk**, giữ đường dẫn `scripts/t07-kichban/`.
2. Cần repository đầy đủ có `backend/pom.xml`, `signaling/package.json`, `signaling/src/index.js`, `scripts/t04-api/support.cjs`, `scripts/t05-e2e/dev-snapshot.cjs`; Node.js (có `node --test` và reporter JUnit), Docker Desktop, Maven, Java 21, và dependency của Node signaling đã cài.
3. Bắt đầu với **các case đã có oracle rõ ràng**, trong môi trường Docker riêng không chứa dữ liệu thật.

```powershell
node scripts/t07-kichban/run.cjs
```

Lọc chỉ các test theo nhóm ID (vẫn phải tạo lab riêng):

```powershell
$env:T07_TEST_PATTERN='T07-MSG-001|T07-MSG-009'
node scripts/t07-kichban/run.cjs
Remove-Item Env:T07_TEST_PATTERN
```

Nếu muốn lưu một lần chạy không ghi đè báo cáo `latest`:

```powershell
$env:T07_RUN_NAME='msg-race-01'
node scripts/t07-kichban/run.cjs
Remove-Item Env:T07_RUN_NAME
```

Artifacts: `scripts/t07-kichban/results/<run-name>/results.xml`, `run.json`, `RESULTS.md`, `case-status.json`, `backend.log`, `signaling.log`, `build.log`.

## Sự khác nhau giữa một probe và một T07 race được chứng minh

- `parallel()` dùng start gate ở **client**, không tạo barrier tại transaction/Redis Lua/MinIO critical section. Kết quả PASS của probe loại này chỉ nói rằng oracle quan sát được đã giữ trong lần chạy đó.
- Case bắt buộc có barrier/fault/topology nhưng lab chưa cung cấp sẽ không được tạo thành assertion giả. Reporter ghi Result `FAIL`, Classification `FAIL_TEST` và reason `TEST_NOT_EXECUTED`; tuyệt đối không tính nó là lỗi sản phẩm.
- `PASS` yêu cầu assertion thực thi thành công và ownership/cleanup/artifact gate của toàn run đều được xác minh.
- Dùng cột `Classification`, không dùng riêng cột Result, để phân biệt assertion sản phẩm với thiếu capability của harness.
- Tất cả kết quả chạy phải dùng chính commit backend/signaling đang kiểm thử. Nếu chạy với source mới, cần rà soát lại contract trước khi khóa expected.

## Các mã đã triển khai thành test thật

- AUTH: 001–008, 010–012 (002–003 là hậu revoke; các race client-gate chưa chứng minh critical-section overlap).
- CONV: 001–008.
- MSG: 001–005, 007–016.
- TX: 006.
- PUB: 003–006, 008–012.
- WS: 001–003, 005, 006, 008–011, 014–016 (002 chưa xác minh hoàn toàn registry leak).
- CALL: 001–014.
- VID: 001–006, 008–014, 017, 018, 020, 022.
- LOCK: 006, 008–012.
- FAIL: 001.
- REC: 010.

`remaining.test.cjs` chỉ đăng ký các implementation có thật trong map `actual`. ID còn thiếu không được tạo thành
`assert.fail` giả; reporter nhận diện việc không có JUnit evidence và ghi `FAIL_TEST/TEST_NOT_EXECUTED`, tuyệt đối
không trình bày như PASS hoặc lỗi backend.

**Không có test nào bị làm yếu hoặc tự skip vì backend FAIL.** Một số case mới chủ ý bắt contract đã khóa và có thể FAIL trên implementation hiện tại; phải phân loại bằng log/evidence, không đổi assertion để làm xanh suite.

## Giới hạn phiên bản này

- Multi-node signaling chưa thuộc contract MVP; `T07-MULTI-005` được báo `FAIL_TEST/TEST_NOT_EXECUTED`, không giả lập bằng hai process có state tách rời.
- Không triển khai fault-injection bằng cách dừng PostgreSQL/Redis/MinIO trong test chung khi chưa có process-level watchdog và chứng cứ cách khôi phục.
- T07-ENV-003/004 phải có **self-check độc lập** cho runner error/kill, không được khai PASS chỉ vì một suite chạy bình thường.
- Test `T07-MSG-014` kiểm tra tuple cursor khi timestamp bằng nhau; không dùng thứ tự gửi làm thứ tự phải nhận.
- Lab nâng giới hạn đăng ký/login (`AUTH_REGISTER_SUCCESS_LIMIT`, v.v.) để fixture không chịu throttling không liên quan; muốn kiểm thử chính sách auth limit thật phải dùng T06 với cấu hình production.

Đọc `CONTRACT_DECISIONS.md` để hiểu oracle. Báo cáo giữ Result `PASS`/`FAIL` theo yêu cầu 178 kết quả nhị phân, đồng thời bắt buộc có Classification để không báo sai lỗi backend.
