# Chạy bộ T04

Trong thư mục gốc repo:

```powershell
node scripts/t04-api/run.cjs
```

Runner build backend hiện tại, tạo PostgreSQL/Redis/MinIO tạm bằng Docker, mở backend và signaling trên cổng ngẫu nhiên, chạy 195 case, ghi JUnit vào `results/latest/results.xml`, ghi log và tạo lại `RESULTS.md`. Container và tiến trình được dọn sau lượt chạy. Runner không đọc `.env` của dự án.

Các file test: `http.test.cjs`, `video-internal.test.cjs`, `websocket.test.cjs`; helper chung ở `support.cjs`. Mỗi ID trong tài liệu test case có đúng một test mang cùng ID. Exit code 1 có nghĩa ít nhất một case FAIL hoặc môi trường không khởi động được; hãy xem `RESULTS.md` và `results/latest/results.xml`.

Để chạy lại một số ID phục vụ điều tra:

```powershell
$env:T04_PATTERN='^(VID-003|SIG-004)$'
node scripts/t04-api/run.cjs
Remove-Item Env:T04_PATTERN
```

Lượt chạy chọn ID cũng cập nhật `RESULTS.md`; cột `NOT RUN` cho biết các ID bị bỏ qua. Chạy lệnh không có `T04_PATTERN` để khôi phục kết quả đầy đủ.
