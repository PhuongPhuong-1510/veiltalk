# T05 E2E backend

Chạy tại root repo:

```powershell
node scripts/t05-e2e/run.cjs
```

Runner build backend từ source hiện tại, tạo PostgreSQL/Redis/MinIO riêng bằng Docker, khởi động Spring và signaling trên port tạm, rồi chạy test qua HTTP và WebSocket thật. Cần Docker, Java 21, Maven, Node.js và dependency `signaling` đã cài. Runner dọn tiến trình/container của đúng run ID trong `finally`.

Các test được chia theo hành trình trong `core.test.cjs`, `call.test.cjs`, `journeys.test.cjs`, `extended.test.cjs`, `p1.test.cjs`, `remaining.test.cjs` và `environment.test.cjs`. Danh sách đầy đủ 120 kịch bản nằm trong `VEILTALK_T05_END_TO_END_TEST_CASES.md`; `RESULTS.md` ghi PASS/FAIL/NOT RUN cho từng ID, không tính case chưa chạy là PASS. Bằng chứng của lần chạy mới nhất nằm trong `results/latest/`.

Để xác minh ENV-003 (hai lượt chạy độc lập) và ENV-005 (runner dọn tài nguyên sau khi test cố ý thất bại), chạy tuần tự từ root repo:

```powershell
$env:T05_RUN_NAME='probe-env-005'; $env:T05_PROBE_FAILURE='1'; node scripts/t05-e2e/run.cjs
Remove-Item Env:T05_PROBE_FAILURE
$env:T05_RUN_NAME='env-003-first'; node scripts/t05-e2e/run.cjs
Remove-Item Env:T05_RUN_NAME
$env:T05_PREVIOUS_RUN_NAME='env-003-first'; node scripts/t05-e2e/run.cjs
Remove-Item Env:T05_PREVIOUS_RUN_NAME
```

Lượt probe phải trả exit code khác 0; các lượt sau kiểm tra artifact, container đã dọn và dữ liệu run trước không xuất hiện trong database mới. Chỉ lượt cuối ghi `RESULTS.md` và `results/latest/`. DEL-004 nghiệm thu lịch sử và ẩn danh hiển thị trước mốc 30 ngày; việc dọn dữ liệu sau 30 ngày chưa được triển khai hoặc nghiệm thu.

Runner đặt heartbeat Messaging WebSocket ngắn trong stack E2E riêng để kiểm tra PING/PONG và thu hồi token nhanh; production config không bị đổi. Nó cũng tin địa chỉ loopback làm proxy kiểm thử để mỗi socket dùng IP fixture riêng, tránh ghép rate limit của các test độc lập.

`call_id` là UUID mới do caller gửi trong mỗi `CALL_OFFER`, sau đó phải được dùng lại ở mọi sự kiện signaling cùng phiên. `CALL_INCOMING` của Spring mang cùng ID để đối chiếu hai kênh.
