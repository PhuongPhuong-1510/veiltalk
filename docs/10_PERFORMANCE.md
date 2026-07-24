TRƯỜNG ĐẠI HỌC CÔNG NGHỆ — ĐHQGHN

Khoa Công nghệ Thông tin

**BÁO CÁO KIỂM THỬ HIỆU NĂNG**

*(Performance Test Report)*

**VEILTALK**

Kết quả đo hiệu năng tracking, cuộc gọi video và API

Phiên bản: 1.0 \| Ngày đo: \_\_\_/\_\_\_/2026

Người thực hiện: Lê Thị Tú Phương — MSSV 23020695

## 1. Mục tiêu và Phạm vi

Tài liệu này ghi nhận kết quả đo hiệu năng thực tế của hệ thống VeilTalk, đối chiếu với các ngưỡng đã cam kết trong SRS v1.0 (NFR-01, NFR-02, NFR-03, NFR-04) và SLO trong SAD v1.0 (mục 7). Mỗi chỉ số được đo trong điều kiện chuẩn đã định nghĩa trong SRS mục 4.1 để đảm bảo có thể tái hiện và so sánh.

## 2. Thiết bị và Điều kiện Đo

### 2.1. Thiết bị tham chiếu (theo SRS mục 4.1)

| **Thông số**     | **Giá trị thực tế của thiết bị đo**                                  |
|------------------|----------------------------------------------------------------------|
| **CPU**          | \[ĐIỀN: Model CPU, ví dụ Intel Core i5-10300H @ 2.5GHz\]             |
| **RAM**          | \[ĐIỀN: Tổng RAM, ví dụ 8GB DDR4 3200MHz\]                           |
| **GPU**          | \[ĐIỀN: GPU tích hợp, ví dụ Intel UHD Graphics 630\]                 |
| **Webcam**       | \[ĐIỀN: Model webcam, độ phân giải, ví dụ Logitech C270 720p 30fps\] |
| **Hệ điều hành** | \[ĐIỀN: Windows 11 22H2 / macOS 14.x / Ubuntu 22.04\]                |
| **Trình duyệt**  | \[ĐIỀN: Chrome version X.X.X.X\]                                     |
| **Kết nối mạng** | \[ĐIỀN: WiFi/Ethernet, băng thông, ví dụ WiFi 5GHz 200Mbps\]         |

### 2.2. Điều kiện môi trường đo (theo SRS mục 4.1)

| **Điều kiện**                  | **Giá trị thực tế**                                        |
|--------------------------------|------------------------------------------------------------|
| **Ánh sáng phòng**             | \[ĐIỀN: đo bằng app lux meter, ví dụ 250 lux\]             |
| **Khoảng cách người → camera** | \[ĐIỀN: ví dụ 65cm\]                                       |
| **Thời điểm đo**               | \[ĐIỀN: ngày, giờ\]                                        |
| **Ứng dụng chạy đồng thời**    | \[ĐIỀN: chỉ Chrome và VeilTalk, không ứng dụng nặng khác\] |
| **Số lần đo (mỗi chỉ số)**     | 10 lần đo, lấy trung bình và percentile 95                 |

## 3. Phương pháp Đo

### 3.1. NFR-01 — Tracking-to-render Latency

Phương pháp: chèn performance.now() marker tại hai điểm trong pipeline — (1) ngay sau khi MediaPipe Tasks API trả về landmark results, (2) ngay sau khi Avatar Renderer hoàn tất draw call cho khung hình đó. Latency = điểm 2 - điểm 1.

Công cụ: console.log trong Chrome DevTools hoặc PerformanceObserver API. Đo trong 60 giây liên tục khi avatar đang tracking.

Điều kiện: SCR-09 (xem trước avatar) với webcam đang chạy, người dùng cử động bình thường.

### 3.2. NFR-02 — Frame Rate

Phương pháp: đếm số lần requestAnimationFrame callback được gọi trong mỗi giây trong Avatar Renderer. FPS = số callback / giây, lấy trung bình trong 60 giây.

Công cụ: Chrome DevTools Performance tab → Frame rate graph; hoặc counter nội bộ trong Renderer.

### 3.3. NFR-03 — End-to-End Call Latency

Phương pháp: gọi RTCPeerConnection.getStats() mỗi 1 giây trong cuộc gọi đang diễn ra. Lấy giá trị currentRoundTripTime từ candidate-pair statistics (đơn vị giây, nhân 1000 ra ms).

Điều kiện: hai thiết bị tham chiếu trên cùng mạng LAN, cuộc gọi kéo dài 30 giây, đo liên tục.

### 3.4. NFR-04 — WebRTC Setup Time

Phương pháp: ghi timestamp ngay trước khi gửi CALL_OFFER lên Signaling Server và timestamp khi RTCPeerConnection.iceConnectionState chuyển thành 'connected'. Setup time = timestamp connected - timestamp offer gửi.

Điều kiện: đo 10 lần thiết lập cuộc gọi mới, tính trung bình và tỉ lệ đạt ngưỡng 5 giây.

### 3.5. API Response Time

Phương pháp: dùng Postman Runner với 50 lần gọi liên tiếp cho mỗi endpoint quan trọng, ghi response time (ms) từ Postman.

## 4. Kết quả Đo

### 4.1. NFR-01 & NFR-02 — Avatar Tracking Performance

Đo trong điều kiện chuẩn SRS mục 4.1, thời gian đo: 60 giây/lần, đo 10 lần, lấy trung bình của trung bình.

| **Chỉ số**                           | **Mục tiêu (SRS)**  | **Đo được (avg)** | **Đo được (p95)** | **Kết quả**       | **Ghi chú**                              |
|--------------------------------------|---------------------|-------------------|-------------------|-------------------|------------------------------------------|
| **Tracking-to-render latency (avg)** | \< 100ms (NFR-01)   | \[\_\_\_\] ms     | \[\_\_\_\] ms     | **\[PASS/FAIL\]** | Đo bằng performance.now() trong pipeline |
| **Tracking-to-render latency (p95)** | \< 150ms (SAD SLO)  | \[\_\_\_\] ms     | —                 | **\[PASS/FAIL\]** | 95% khung hình dưới ngưỡng này           |
| **Avatar Frame Rate (avg)**          | ≥ 24fps (NFR-02)    | \[\_\_\_\] fps    | —                 | **\[PASS/FAIL\]** | Đo bằng rAF counter trong 60 giây        |
| **Avatar Frame Rate (min)**          | ≥ 20fps (tối thiểu) | \[\_\_\_\] fps    | —                 | **\[PASS/FAIL\]** | Giá trị thấp nhất trong chuỗi đo         |

### 4.2. NFR-03 & NFR-04 — WebRTC Performance

| **Chỉ số**                        | **Mục tiêu (SRS)** | **Đo được (avg)** | **Đo được (p95)** | **Kết quả**       | **Ghi chú**                                          |
|-----------------------------------|--------------------|-------------------|-------------------|-------------------|------------------------------------------------------|
| **End-to-end call latency (avg)** | \< 400ms (NFR-03)  | \[\_\_\_\] ms     | \[\_\_\_\] ms     | **\[PASS/FAIL\]** | currentRoundTripTime từ RTCPeerConnection.getStats() |
| **WebRTC setup time (avg)**       | \< 5 giây (NFR-04) | \[\_\_\_\] s      | —                 | **\[PASS/FAIL\]** | Từ CALL_OFFER đến ICE connected                      |
| **WebRTC setup success rate**     | ≥ 90% (SAD SLO)    | \[\_\_\_\] %      | —                 | **\[PASS/FAIL\]** | Số lần kết nối thành công / tổng số lần thử          |

### 4.3. API Response Time

Đo bằng Postman Runner, 50 request/endpoint, server chạy local Docker Compose.

| **Chỉ số**                            | **Mục tiêu (SRS)** | **Đo được (avg)** | **Đo được (p95)** | **Kết quả**       | **Ghi chú**                      |
|---------------------------------------|--------------------|-------------------|-------------------|-------------------|----------------------------------|
| **POST /auth/login**                  | \< 500ms           | \[\_\_\_\] ms     | \[\_\_\_\] ms     | **\[PASS/FAIL\]** | Bao gồm bcrypt verify password   |
| **GET /conversations**                | \< 200ms           | \[\_\_\_\] ms     | \[\_\_\_\] ms     | **\[PASS/FAIL\]** | Danh sách 20 conversation        |
| **GET /conversations/{id}/messages**  | \< 200ms           | \[\_\_\_\] ms     | \[\_\_\_\] ms     | **\[PASS/FAIL\]** | 30 tin nhắn, cursor page đầu     |
| **POST /conversations/{id}/messages** | \< 300ms           | \[\_\_\_\] ms     | \[\_\_\_\] ms     | **\[PASS/FAIL\]** | Bao gồm Pub/Sub Redis notify     |
| **POST /videos**                      | \< 500ms           | \[\_\_\_\] ms     | \[\_\_\_\] ms     | **\[PASS/FAIL\]** | Bao gồm khởi tạo MinIO multipart |
| **GET /avatars/models**               | \< 100ms           | \[\_\_\_\] ms     | \[\_\_\_\] ms     | **\[PASS/FAIL\]** | Static catalog, có thể cache     |

## 5. Phân tích và Nhận xét

### 5.1. Tổng kết

| **Hạng mục**                        | **Kết quả tổng hợp**                                            |
|-------------------------------------|-----------------------------------------------------------------|
| **Tổng số chỉ số đo**               | \[ĐIỀN: ví dụ 14 chỉ số\]                                       |
| **Số chỉ số PASS**                  | \[ĐIỀN\]                                                        |
| **Số chỉ số FAIL**                  | \[ĐIỀN\]                                                        |
| **Chỉ số quan trọng nhất (NFR-01)** | \[ĐIỀN: PASS/FAIL với giá trị\]                                 |
| **Kết luận tổng thể**               | \[ĐIỀN: Hệ thống ĐÁP ỨNG / KHÔNG ĐÁP ỨNG các NFR về hiệu năng\] |

### 5.2. Điểm cần lưu ý (nếu có FAIL)

\[ĐIỀN sau khi đo: Nếu có chỉ số FAIL, phân tích nguyên nhân và đề xuất hướng xử lý. Ví dụ: 'Tracking latency đạt 110ms trung bình, vượt ngưỡng 100ms NFR-01. Nguyên nhân: MediaPipe FaceLandmarker chạy trên CPU thay vì GPU WebGL. Giải pháp: bật delegate=GPU trong MediaPipe Tasks API config.'\]

### 5.3. Điều kiện đo không đạt chuẩn (nếu có)

\[ĐIỀN: ghi nhận nếu điều kiện đo thực tế khác với điều kiện chuẩn SRS. Ví dụ: 'Thiết bị đo có RAM 16GB thay vì 8GB theo điều kiện chuẩn — kết quả đo có thể tốt hơn thực tế trên thiết bị tối thiểu.'\]

*— Hết tài liệu —*
