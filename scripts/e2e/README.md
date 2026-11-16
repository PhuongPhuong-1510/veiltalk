# Kiểm thử chức năng backend qua các tiến trình thật

Chạy tại thư mục gốc dự án:

```powershell
node scripts/e2e/run.cjs
```

Điều kiện: Docker Engine đang chạy, Java 21, Maven (`mvn` trên PATH), Node.js 24 và đã cài dependency của `signaling` (`cd signaling`, `npm.cmd ci`). Không cần chạy backend hoặc signaling trước.

Runner build JAR từ source hiện tại, khởi động Java và signaling ở các port còn trống. PostgreSQL, Redis và MinIO chạy trong ba container mới với tên ngẫu nhiên, mật khẩu riêng, không gắn volume dữ liệu hiện có. Spring không import `.env` của dự án. Runner cấu hình bucket mới và webhook **MinIO → backend** thật. Khi kết thúc (kể cả test thất bại), runner dừng các tiến trình và xóa đúng container có nhãn của lần chạy đó.

Các test dùng `node:test` và `ws` đang có trong signaling. Không dùng MockMvc, không mock service, không gọi trực tiếp service Java. Token được lấy từ API đăng ký/đăng nhập thật. Một số kết quả còn được đối chiếu bằng truy vấn PostgreSQL và Redis trong container kiểm thử.

## Kịch bản và kết quả mong đợi

| ID | Kịch bản | Điều kiện PASS |
|---|---|---|
| E01 | Đăng ký, trùng email, sai mật khẩu, đăng nhập, refresh, logout | Mã HTTP đúng; token logout bị từ chối; mật khẩu không lưu rõ |
| E02 | Cập nhật hồ sơ và cài đặt | GET và PostgreSQL giữ dữ liệu mới; theme sai bị từ chối |
| E03 | Danh mục avatar, lưu, đọc hồ sơ | Model đã chọn đọc lại đúng |
| E04 | A gửi tin, B mở hai tab | Cả hai WebSocket nhận đúng dữ liệu HTTP; DB có tin |
| E05 | Bốn request đồng thời cùng message ID | Một 201, ba 200; DB và lịch sử chỉ có một tin |
| E06 | Đang gõ, đã đọc, người ngoài cuộc hội thoại | Sự kiện đến đúng bên; trạng thái lưu DB; người ngoài bị 403 |
| E07 | B ngắt socket rồi kết nối lại | Tin trong lúc offline có trong lịch sử; tin mới đến qua socket |
| E08 | Hai bên có signaling sẵn | CALL_INCOMING qua backend/Redis/messaging; offer, answer, ICE, end đến đúng bên |
| E09 | B chỉ mở messaging, sau CALL_INCOMING mới mở signaling | B vẫn nhận offer của lần gọi đầu, không cần A gọi lại |
| E10 | Đăng xuất rồi dùng token cũ mở signaling | Backend từ chối HTTP và signaling đóng với 4001 |
| E11 | Upload hai phần, finalize, webhook, tải xuống, xóa | Video ready nhờ webhook thật; SHA-256 dữ liệu tải về đúng; Redis được dọn; quota giảm sau xóa |
| E12 | Hủy upload | Redis được dọn; presigned URL cũ không tiếp tục upload được |
| E13 | Xóa tài khoản | DB có deleted_at; token và đăng nhập bị từ chối |
| E14 | Gửi telemetry | Dữ liệu hợp lệ được nhận; session_type sai bị từ chối |

E09 và E10 là tiêu chí nghiệm thu hành vi mong muốn, **không được đổi assertion để hợp thức hóa hành vi lỗi hiện tại**. Suite trả exit code khác 0 nếu có tiêu chí chưa đạt. Khi thất bại cần phân biệt lỗi sản phẩm, lỗi thiết lập môi trường và lỗi của chính test trước khi sửa backend.

## Báo cáo

- `backend/target/e2e/results.xml`: kết quả JUnit cho từng test, có thể dùng trong CI.
- `backend/target/e2e/run.json`: mã lần chạy, thời điểm, exit code và giới hạn.
- `backend/target/e2e/build.log`, `backend.log`, `signaling.log`: log điều tra.

Kết quả lần mới ghi đè lần trước. Dữ liệu và secret của các service chỉ phục vụ lần chạy; báo cáo là artifact cục bộ trong `target/`.

## Giới hạn của bằng chứng

- E08 kiểm tra chuyển tiếp payload signaling. SDP/ICE là payload kiểm thử; không chứng minh có kết nối WebRTC hay hình/tiếng thật.
- E11 kiểm tra đường truyền/lưu trữ byte, webhook và metadata. Fixture không phải video phát được, nên chưa kiểm tra codec/player/camera.
- Các test âm tính là một số tình huống tiêu biểu, chưa bao phủ mọi input, phân trang, hết hạn token, mất Redis/PostgreSQL/MinIO, khởi động lại, timeout hay rò rỉ tài nguyên dài hạn.
- Đây là kiểm thử chức năng với lượng request nhỏ, không phải benchmark hay load test. Thời gian chạy test không phải số đo hiệu năng backend.
- Chưa kiểm tra frontend, CORS từ trình duyệt, NAT/TURN, proxy/TLS hoặc nhiều instance. Các luồng đó cần bộ test riêng trước khi kết luận sẵn sàng triển khai.

Nếu runner bị kill cứng hoặc máy tắt, `finally` không thể dọn tài nguyên. Xem container bằng `docker ps -a --filter name=veiltalk-e2e-`, đối chiếu nhãn `veiltalk.e2e` với mã lần chạy trước khi dọn thủ công. Không dùng `docker system prune` để dọn bộ test này.
