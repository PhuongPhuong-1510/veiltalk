TRƯỜNG ĐẠI HỌC CÔNG NGHỆ — ĐHQGHN

Khoa Công nghệ Thông tin

**TÀI LIỆU ĐẶC TẢ YÊU CẦU PHẦN MỀM**

*(Software Requirements Specification — SRS)*

**VEILTALK**

Hệ thống giao tiếp video, nhắn tin và quay video qua nhân vật ảo

Phiên bản tài liệu: 1.0

Trạng thái: Bản nháp (Draft)

Ngày cập nhật: 21/06/2026

Người soạn thảo: Lê Thị Tú Phương — MSSV 23020695

Lớp: K68 — Khoa Công nghệ Thông tin

Lịch sử thay đổi tài liệu

| **Phiên bản** | **Nội dung thay đổi**                                            |
|---------------|------------------------------------------------------------------|
| **0.1**       | Khởi tạo cấu trúc tài liệu và phạm vi dự án                      |
| **1.0**       | Hoàn thiện yêu cầu chức năng, phi chức năng, kiến trúc tổng quan |

Mục lục

## 1. Giới thiệu

### 1.1. Mục đích tài liệu

Tài liệu này đặc tả đầy đủ các yêu cầu chức năng và phi chức năng của hệ thống VeilTalk — nền tảng giao tiếp trực tuyến cho phép người dùng nhắn tin, gọi video và quay video thông qua một nhân vật ảo (avatar) đại diện, thay vì hiển thị trực tiếp hình ảnh khuôn mặt thật. Tài liệu hướng đến việc làm rõ phạm vi, ràng buộc kỹ thuật và tiêu chí nghiệm thu cho từng yêu cầu, làm cơ sở cho quá trình thiết kế, cài đặt, kiểm thử và bảo vệ đồ án tốt nghiệp.

### 1.2. Phạm vi dự án

VeilTalk là một ứng dụng web cho phép:

- Theo dõi biểu cảm khuôn mặt và chuyển động tay/thân của người dùng theo thời gian thực qua webcam thông thường (không yêu cầu cảm biến chuyên dụng).

- Ánh xạ dữ liệu theo dõi lên một nhân vật ảo 3D, hiển thị trong thời gian thực trong cuộc gọi video hoặc khi quay video.

- Cung cấp tính năng nhắn tin văn bản và gọi video một-một giữa hai người dùng.

- Cho phép quay và lưu trữ video có nhân vật ảo để sử dụng lại sau.

- Bảo vệ danh tính thật của người dùng bằng cách xử lý dữ liệu khuôn mặt/cử chỉ ngay trên thiết bị (on-device), không truyền hình ảnh khuôn mặt thật ra khỏi máy người dùng.

Phạm vi đồ án giới hạn ở phiên bản sản phẩm khả dụng tối thiểu (MVP): gọi video một-một, một mẫu nhân vật ảo dựng sẵn có thể tùy biến cơ bản, không bao gồm gọi nhóm nhiều người hay marketplace nhân vật ảo của bên thứ ba.

### 1.3. Định nghĩa, từ viết tắt

| **Thuật ngữ**               | **Giải thích**                                                                                                                                                                                                                                                                                   |
|-----------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **SRS**                     | Software Requirements Specification — Tài liệu đặc tả yêu cầu phần mềm                                                                                                                                                                                                                           |
| **Avatar**                  | Nhân vật ảo 3D đại diện cho người dùng trong giao tiếp                                                                                                                                                                                                                                           |
| **Blendshape**              | Tập hệ số biểu diễn các trạng thái biểu cảm khuôn mặt (cười, nhướn mày, mở miệng...)                                                                                                                                                                                                             |
| **IK (Inverse Kinematics)** | Kỹ thuật tính góc khớp xương từ vị trí mong muốn của điểm cuối chi                                                                                                                                                                                                                               |
| **One Euro Filter**         | Bộ lọc làm mượt dữ liệu theo thời gian, giảm nhiễu rung giật (jitter)                                                                                                                                                                                                                            |
| **WebRTC**                  | Web Real-Time Communication — chuẩn giao tiếp video/audio thời gian thực trên trình duyệt                                                                                                                                                                                                        |
| **DTLS-SRTP**               | Giao thức mã hóa luồng audio/video thời gian thực dùng trong WebRTC                                                                                                                                                                                                                              |
| **On-device processing**    | Xử lý dữ liệu ngay trên thiết bị người dùng, không gửi lên máy chủ                                                                                                                                                                                                                               |
| **FR**                      | Functional Requirement — Yêu cầu chức năng                                                                                                                                                                                                                                                       |
| **NFR**                     | Non-Functional Requirement — Yêu cầu phi chức năng                                                                                                                                                                                                                                               |
| **MVP**                     | Minimum Viable Product — Phiên bản sản phẩm khả dụng tối thiểu                                                                                                                                                                                                                                   |
| **conversation_id**         | Định danh duy nhất của một cuộc trò chuyện giữa hai người dùng. Trong MVP chỉ hỗ trợ chat 1-1, conversation_id được sinh từ cặp (user_id_A, user_id_B) đã chuẩn hóa (sắp xếp tăng dần để (A,B) và (B,A) cho cùng một ID) — mỗi cặp người dùng chỉ có đúng một cuộc trò chuyện tại một thời điểm. |

### 1.4. Tài liệu tham khảo

- MediaPipe Face Landmarker & Holistic Documentation — Google.

- WebRTC 1.0: Real-Time Communication Between Browsers — W3C Specification.

- Casiez, G., Roussel, N., Vogel, D. (2012). 1€ Filter: A Simple Speed-based Low-pass Filter for Noisy Input in Interactive Systems.

- IEEE Std 830-1998 — Recommended Practice for Software Requirements Specifications (tham khảo cấu trúc trình bày).

### 1.5. Tổng quan tài liệu

Phần 2 trình bày mô tả tổng quan sản phẩm. Phần 3 đặc tả chi tiết yêu cầu chức năng theo từng module. Phần 4 trình bày yêu cầu phi chức năng. Phần 5 mô tả giao diện ngoài. Phần 6 trình bày kiến trúc hệ thống tổng quan. Phần 7 là ma trận truy vết yêu cầu. Phần 8 là phụ lục.

## 2. Mô tả tổng quan

### 2.1. Bối cảnh sản phẩm

VeilTalk là sản phẩm độc lập (standalone), không phải module mở rộng của hệ thống có sẵn nào khác. Sản phẩm vận hành như một ứng dụng web client-server: phần xử lý theo dõi khuôn mặt/cử chỉ và render nhân vật ảo chạy hoàn toàn trên trình duyệt người dùng (client-side); máy chủ chỉ đảm nhiệm xác thực, lưu trữ tài khoản/tin nhắn, và làm trung gian báo hiệu (signaling) cho kết nối WebRTC.

### 2.2. Tóm tắt chức năng sản phẩm

- Quản lý tài khoản: đăng ký, đăng nhập, quản lý hồ sơ.

- Quản lý nhân vật ảo: tạo, tùy chỉnh, theo dõi và điều khiển nhân vật ảo theo thời gian thực.

- Nhắn tin: gửi/nhận tin nhắn văn bản, lưu lịch sử trò chuyện.

- Gọi video: thiết lập cuộc gọi video một-một, hiển thị nhân vật ảo thay cho khuôn mặt thật.

- Quay và lưu video: ghi lại phiên có nhân vật ảo để dùng lại.

### 2.3. Đối tượng người dùng

| **Nhóm người dùng**         | **Đặc điểm và nhu cầu chính**                                                                     |
|-----------------------------|---------------------------------------------------------------------------------------------------|
| **Người dùng phổ thông**    | Muốn giao tiếp video/nhắn tin nhưng không muốn lộ khuôn mặt thật vì lý do riêng tư cá nhân.       |
| **Người sáng tạo nội dung** | Muốn dùng nhân vật ảo để quay video, livestream theo phong cách VTuber với chi phí thiết bị thấp. |
| **Quản trị viên hệ thống**  | Quản lý tài khoản người dùng, giám sát vận hành hệ thống.                                         |

### 2.4. Môi trường vận hành

- Trình duyệt: Chrome, Edge, Firefox phiên bản hiện hành hỗ trợ WebRTC và WebGL.

- Thiết bị đầu vào: webcam độ phân giải tối thiểu 720p, microphone.

- Phần cứng: không yêu cầu GPU rời hay cảm biến chuyên dụng (mocap suit, camera độ sâu); chạy được trên laptop phổ thông có card đồ họa tích hợp.

- Kết nối mạng: băng thông tối thiểu khuyến nghị 1.5 Mbps hai chiều cho cuộc gọi video chất lượng ổn định.

### 2.5. Ràng buộc thiết kế và cài đặt

- Chỉ sử dụng một webcam đơn (monocular), không dùng nhiều camera hay cảm biến độ sâu — phù hợp ràng buộc chi phí và khả năng triển khai thực tế của đồ án.

- Toàn bộ xử lý theo dõi khuôn mặt/cử chỉ phải chạy được theo thời gian thực (tối thiểu 24 khung hình/giây) trên trình duyệt, không phụ thuộc xử lý phía máy chủ cho bước này.

- Dữ liệu hình ảnh khuôn mặt thật của người dùng không được truyền ra khỏi thiết bị dưới bất kỳ hình thức nào trong luồng vận hành bình thường.

- Kiến trúc phải cho phép mở rộng để phục vụ nhiều cuộc gọi đồng thời ở giai đoạn phát triển tiếp theo, dù MVP chỉ cần hỗ trợ số lượng người dùng đồng thời ở quy mô thử nghiệm.

### 2.6. Giả định và phụ thuộc

- Giả định người dùng có thiết bị đáp ứng yêu cầu tối thiểu về webcam và trình duyệt.

- Phụ thuộc thư viện theo dõi điểm mốc khuôn mặt/cử chỉ mã nguồn mở (ví dụ MediaPipe) — thay đổi từ phía nhà cung cấp thư viện có thể ảnh hưởng đến độ chính xác theo dõi.

- Phụ thuộc hạ tầng máy chủ STUN/TURN để thiết lập kết nối WebRTC trong trường hợp hai phía nằm sau NAT/firewall phức tạp.

### 2.7. Kịch bản sử dụng chính (Use Case)

Các kịch bản dưới đây mô tả luồng tương tác chính, bao gồm cả đường ngoại lệ, làm cơ sở thiết kế chi tiết và kiểm thử chấp nhận.

*Lưu ý phạm vi quản trị viên trong MVP: mục 2.3 liệt kê Quản trị viên là một nhóm người dùng, nhưng trong phạm vi MVP, chức năng quản trị (xem log, khóa tài khoản, quản lý dung lượng lưu trữ) được thực hiện thông qua giao diện dòng lệnh/truy cập trực tiếp database, không xây dựng giao diện quản trị web riêng. Đây là quyết định scope có chủ đích — xây giao diện admin đầy đủ thuộc phạm vi mở rộng sau MVP.*

UC-00 — Đăng ký và đăng nhập tài khoản

Tác nhân: Người dùng mới (đăng ký) hoặc người dùng hiện có (đăng nhập).

Luồng đăng ký: (1) Người dùng nhập email và mật khẩu → (2) Hệ thống kiểm tra email chưa tồn tại → (3) Tạo tài khoản, mật khẩu được băm trước khi lưu (FR-01) → (4) Chuyển sang bước thiết lập nhân vật ảo lần đầu (UC-03).

Luồng đăng nhập: (1) Người dùng nhập email/mật khẩu → (2) Hệ thống xác minh thông tin (FR-02) → (3) Cấp JWT, chuyển vào màn hình chính.

Luồng ngoại lệ đăng ký: email đã tồn tại → thông báo lỗi không tiết lộ email nào đang có (tránh user enumeration). Luồng ngoại lệ đăng nhập: sai mật khẩu → thông báo lỗi chung, không phân biệt sai email hay sai mật khẩu.

UC-01 — Khởi tạo cuộc gọi video

Tác nhân: Người dùng A (người gọi), Người dùng B (người nhận).

Điều kiện tiên quyết: Cả hai đã đăng nhập. Người gọi (A) phải đã thiết lập nhân vật ảo (FR-04) — không thể gọi video nếu chưa có avatar vì không có gì để truyền. Người nhận (B) được phép chưa có avatar (xem luồng ngoại lệ).

Luồng chính: (1) A chọn B từ danh sách trò chuyện và bấm gọi video → (2) Hệ thống kiểm tra A đã có avatar; nếu chưa, chuyển A sang UC-03 trước → (3) Hệ thống gửi tín hiệu cuộc gọi đến B qua kênh báo hiệu (SDP offer kèm user_id của A, không kèm avatar metadata) → (4) B nhận thông báo, gọi Backend API lấy avatar metadata của A (model_id + customizations) và bắt đầu tải model GLB, sau đó chấp nhận cuộc gọi → (5) Server trả về avatar metadata của B cho A theo cùng cơ chế; nếu B chưa có avatar, B dùng avatar mặc định của hệ thống cho phiên gọi này và được nhắc thiết lập sau → (6) Kết nối WebRTC được thiết lập; cả hai bên thấy nhân vật ảo của nhau, đồng bộ với giọng nói (FR-14).

Luồng ngoại lệ: Nếu B không trực tuyến hoặc không phản hồi trong 30 giây, A nhận thông báo rõ ràng và được đề nghị để lại tin nhắn (chuyển sang UC-02). Nếu kết nối WebRTC thất bại sau 5 giây ICE negotiation, cả hai nhận thông báo lỗi kết nối kèm đề nghị thử lại (FR-13, NFR-23).

UC-02 — Gửi tin nhắn khi người nhận ngoại tuyến

Tác nhân: Người dùng A.

Luồng chính: (1) A gửi tin nhắn văn bản cho B đang ngoại tuyến → (2) Hệ thống lưu tin nhắn vào hàng đợi gắn với tài khoản B (NFR-14) → (3) Khi B đăng nhập trở lại, hệ thống đẩy tin nhắn về client của B → (4) B thấy tin nhắn mới với đúng thứ tự thời gian gửi ban đầu.

UC-03 — Thiết lập nhân vật ảo lần đầu

Tác nhân: Người dùng mới.

Luồng chính: (1) Người dùng chọn một mẫu nhân vật ảo dựng sẵn → (2) Hệ thống yêu cầu quyền truy cập camera/microphone → (3) Người dùng xem trước nhân vật ảo phản ánh biểu cảm của mình theo thời gian thực → (4) Người dùng xác nhận, nhân vật ảo được lưu gắn với tài khoản (FR-04).

Luồng ngoại lệ: Nếu người dùng từ chối quyền camera, hệ thống hiển thị hướng dẫn cấp quyền kèm tùy chọn tiếp tục với nhân vật ảo ở trạng thái tĩnh (NFR-30) — không chặn hoàn toàn.

UC-04 — Mất dữ liệu theo dõi giữa cuộc gọi

Tác nhân: Người dùng đang trong cuộc gọi video.

Luồng chính: (1) Tay người dùng ra khỏi khung hình camera hoặc bị che khuất hoàn toàn → (2) Hệ thống phát hiện độ tin cậy theo dõi giảm dưới ngưỡng → (3) Theo FR-09, nhân vật ảo giữ tư thế hợp lệ gần nhất thay vì hiển thị dữ liệu nhiễu → (4) Khi tay trở lại khung hình, theo dõi khôi phục bình thường trong vòng 1 khung hình hợp lệ liên tiếp.

UC-05 — Tìm kiếm người dùng và bắt đầu trò chuyện lần đầu

Tác nhân: Người dùng A (người muốn kết nối).

Điều kiện tiên quyết: A đã đăng nhập. B phải đã bật tùy chọn 'cho phép tìm thấy qua email' trong cài đặt tài khoản.

Luồng chính: (1) A nhập email của B vào ô tìm kiếm → (2) Hệ thống kiểm tra rate limit (tối đa 10 lần/phút) → (3) Hệ thống tra cứu user có email khớp VÀ đã bật discoverable → (4) Hệ thống hiển thị tên hiển thị của B (không hiển thị email hay thông tin khác) → (5) A bấm 'Nhắn tin' → (6) Hệ thống tạo conversation mới cho cặp (A, B) nếu chưa tồn tại → (7) A được chuyển vào màn hình trò chuyện và gửi tin nhắn đầu tiên.

Luồng ngoại lệ: Email không tìm thấy (không tồn tại hoặc chưa bật discoverable) → cùng một thông báo 'Không tìm thấy người dùng' cho cả hai trường hợp. Vượt rate limit → thông báo 'Thử lại sau 1 phút' kèm thời gian đếm ngược.

UC-06 — Quay và lưu video với nhân vật ảo

Tác nhân: Người dùng.

Điều kiện tiên quyết: Người dùng đã đăng nhập, đã thiết lập nhân vật ảo, dung lượng tài khoản chưa vượt giới hạn 2GB (NFR-19).

Luồng chính: (1) Người dùng bấm bắt đầu quay (độc lập hoặc trong cuộc gọi đang diễn ra) → (2) Hệ thống bắt đầu capture luồng canvas WebGL kèm audio, lưu theo từng đoạn (NFR-26) → (3) Người dùng bấm dừng → (4) Hệ thống ghép đoạn, xuất file MP4 (NFR-18), lưu vào thư viện cá nhân → (5) Video hiển thị trong thư viện ngay sau khi lưu xong (FR-16).

Luồng ngoại lệ: Nếu dung lượng tài khoản đã đạt giới hạn 2GB, nút quay bị vô hiệu hóa kèm thông báo rõ ràng và đề nghị xóa video cũ trước. Nếu trình duyệt crash giữa chừng, phần đã quay đến đoạn gần nhất được khôi phục khi người dùng truy cập lại (NFR-26).

## 3. Yêu cầu chức năng

Mỗi yêu cầu được gán mã định danh duy nhất, mức độ ưu tiên (Cao / Trung bình / Thấp) và tiêu chí chấp nhận cụ thể để làm căn cứ kiểm thử.

### 3.1. Module Xác thực và Quản lý tài khoản

| **Mã**    | **Mô tả yêu cầu**                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **Ưu tiên** | **Tiêu chí chấp nhận**                                                                                                                                                                                                                                                                                                         |
|-----------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **FR-01** | Người dùng đăng ký tài khoản bằng email và mật khẩu. Hệ thống xác minh email chưa tồn tại và mật khẩu đủ độ phức tạp tối thiểu trước khi tạo tài khoản.                                                                                                                                                                                                                                                                                                                              | Cao         | Tài khoản được tạo thành công, mật khẩu được băm (hash) trước khi lưu trữ, không lưu mật khẩu dạng văn bản thuần.                                                                                                                                                                                                              |
| **FR-02** | Người dùng đăng nhập bằng email/mật khẩu đã đăng ký. Thông báo lỗi không phân biệt email sai hay mật khẩu sai để tránh user enumeration.                                                                                                                                                                                                                                                                                                                                             | Cao         | Đăng nhập đúng thông tin trả về token xác thực hợp lệ; đăng nhập sai bị từ chối với thông báo chung, không tiết lộ email có tồn tại hay không.                                                                                                                                                                                 |
| **FR-03** | Người dùng quản lý hồ sơ cá nhân (tên hiển thị, ảnh đại diện ứng dụng).                                                                                                                                                                                                                                                                                                                                                                                                              | Trung bình  | Thay đổi hồ sơ được lưu và phản ánh ngay trong giao diện mà không cần đăng nhập lại.                                                                                                                                                                                                                                           |
| **FR-22** | Người dùng tìm kiếm người dùng khác bằng địa chỉ email chính xác và bắt đầu trò chuyện. Chỉ tìm thấy user đã bật tùy chọn 'cho phép tìm thấy qua email' trong cài đặt tài khoản (mặc định: TẮT). Cuộc trò chuyện đầu tiên được tạo khi người dùng gửi tin nhắn đầu tiên. Đây là đánh đổi privacy có chủ đích: tính năng tìm kiếm email vốn xung đột với nguyên tắc tránh user enumeration ở FR-02 — giải quyết bằng cơ chế opt-in tường minh thay vì để mọi email đều có thể bị tra. | Cao         | Tìm email của user đã bật discoverable → hiển thị tên hiển thị và cho phép nhắn tin. Tìm email của user chưa bật hoặc không tồn tại → cùng một thông báo 'Không tìm thấy người dùng' (không phân biệt hai trường hợp). Giới hạn 10 lần tìm kiếm/phút/tài khoản — vượt ngưỡng trả về HTTP 429 (liên quan NFR-32/rate limiting). |

### 3.2. Module Quản lý Nhân vật ảo (Avatar Engine)

Đây là module lõi của hệ thống, chịu trách nhiệm theo dõi người dùng thật và điều khiển nhân vật ảo tương ứng theo thời gian thực.

| **Mã**    | **Mô tả yêu cầu**                                                                                                                                                                                                                                                                                                                                                               | **Ưu tiên** | **Tiêu chí chấp nhận**                                                                                                                                                                                                                                   |
|-----------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **FR-04** | Người dùng chọn và tùy chỉnh cơ bản một nhân vật ảo 3D dựng sẵn (màu tóc, trang phục) trước khi sử dụng. Khi thiết lập cuộc gọi video, server trả về avatar metadata (model_id + customizations JSON) của cả hai bên như một phần của call session — phía nhận dùng thông tin này để tải đúng model 3D và áp dụng tùy chỉnh của người gọi trước khi bắt đầu nhận skeleton data. | Cao         | Nhân vật ảo được lưu gắn với tài khoản, hiển thị đúng trong các phiên sử dụng sau. Khi B nhận cuộc gọi từ A, B thấy nhân vật ảo của A với đúng màu tóc và trang phục mà A đã thiết lập — không dùng model mặc định thay thế.                             |
| **FR-05** | Hệ thống theo dõi biểu cảm khuôn mặt người dùng theo thời gian thực qua webcam và ánh xạ sang hệ số blendshape của nhân vật ảo (nhắm/mở mắt, các hình miệng khi nói, nhướn mày, cười).                                                                                                                                                                                          | Cao         | Tối thiểu 20 hệ số blendshape được cập nhật liên tục với độ trễ theo dõi-đến-hiển thị dưới 100ms; biểu cảm nhân vật ảo phản ánh đúng chiều hướng biểu cảm thật của người dùng trong điều kiện ánh sáng đủ.                                               |
| **FR-06** | Hệ thống theo dõi vị trí khớp tay và thân trên (vai, khuỷu tay, cổ tay) theo thời gian thực qua webcam.                                                                                                                                                                                                                                                                         | Cao         | Khớp được theo dõi liên tục khi nằm trong khung hình và không bị che khuất hoàn toàn.                                                                                                                                                                    |
| **FR-07** | Hệ thống làm mượt dữ liệu khớp theo thời gian bằng bộ lọc One Euro Filter trước khi áp dụng lên khung xương nhân vật ảo.                                                                                                                                                                                                                                                        | Cao         | Khi so sánh có/không áp dụng bộ lọc trên cùng một đoạn video đầu vào, độ lệch chuẩn (standard deviation) vị trí khớp giữa các khung hình liên tiếp giảm tối thiểu 30%; chuyển động nhân vật ảo không còn hiện tượng rung giật thấy được bằng mắt thường. |
| **FR-08** | Hệ thống giới hạn góc xoay của từng khớp (khuỷu tay, cổ tay, vai) trong phạm vi giải phẫu hợp lệ của con người trước khi áp dụng lên nhân vật ảo.                                                                                                                                                                                                                               | Cao         | Không có khung hình nào trong video kiểm thử mà góc khớp vượt ngưỡng giải phẫu đã định nghĩa; nhân vật ảo không xuất hiện tư thế tay vặn xoắn bất khả thi.                                                                                               |
| **FR-09** | Khi một khớp bị che khuất hoàn toàn hoặc ra khỏi khung hình, hệ thống giữ tư thế hợp lệ gần nhất hoặc chuyển dần về tư thế mặc định thay vì hiển thị dữ liệu nhiễu.                                                                                                                                                                                                             | Trung bình  | Khi che khuất camera bằng tay trong khi kiểm thử, nhân vật ảo không xuất hiện chuyển động giật cục bất thường tại thời điểm mất dữ liệu.                                                                                                                 |

*Lưu ý: tính năng sinh cử chỉ thay thế từ giọng nói (trước đây đánh số FR-10) đã được chuyển sang mục 8.2 dưới mã EXT-01, vì đây là hướng mở rộng mang tính nghiên cứu với ưu tiên Thấp, không phải yêu cầu chức năng chính thức cần kiểm thử chấp nhận trong phạm vi MVP.*

### 3.3. Module Nhắn tin

| **Mã**    | **Mô tả yêu cầu**                                                                     | **Ưu tiên** | **Tiêu chí chấp nhận**                                                                                                     |
|-----------|---------------------------------------------------------------------------------------|-------------|----------------------------------------------------------------------------------------------------------------------------|
| **FR-11** | Người dùng gửi và nhận tin nhắn văn bản với người dùng khác trong thời gian thực.     | Cao         | Tin nhắn gửi đi xuất hiện ở phía người nhận trong vòng 2 giây khi cả hai đang trực tuyến.                                  |
| **FR-12** | Hệ thống lưu trữ và hiển thị lịch sử trò chuyện khi người dùng mở lại cuộc hội thoại. | Trung bình  | Lịch sử tin nhắn được tải đầy đủ theo đúng thứ tự thời gian khi mở lại cuộc trò chuyện sau khi đăng xuất và đăng nhập lại. |

### 3.4. Module Gọi video

| **Mã**    | **Mô tả yêu cầu**                                                                                                            | **Ưu tiên** | **Tiêu chí chấp nhận**                                                                                                          |
|-----------|------------------------------------------------------------------------------------------------------------------------------|-------------|---------------------------------------------------------------------------------------------------------------------------------|
| **FR-13** | Người dùng khởi tạo cuộc gọi video một-một với một người dùng khác đang trực tuyến.                                          | Cao         | Cuộc gọi được thiết lập thành công với độ trễ thiết lập kết nối dưới 5 giây trong điều kiện mạng bình thường.                   |
| **FR-14** | Trong cuộc gọi, nhân vật ảo của mỗi bên được hiển thị thời gian thực thay cho hình ảnh khuôn mặt thật, đồng bộ với âm thanh. | Cao         | Độ lệch giữa âm thanh và chuyển động miệng nhân vật ảo (lip-sync) dưới 120ms, nằm trong ngưỡng cảm nhận tự nhiên của con người. |
| **FR-15** | Người dùng điều khiển trạng thái cuộc gọi: tắt/bật microphone, tắt/bật camera, kết thúc cuộc gọi.                            | Cao         | Mọi thao tác điều khiển phản ánh đúng trạng thái ở cả hai phía trong vòng 1 giây.                                               |

### 3.5. Module Quay và Lưu trữ video

| **Mã**    | **Mô tả yêu cầu**                                                                                                                                                                                                                                                                                    | **Ưu tiên** | **Tiêu chí chấp nhận**                                                                                                                                                                   |
|-----------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **FR-16** | Người dùng quay lại video có nhân vật ảo (độc lập hoặc trong cuộc gọi) và lưu lên tài khoản (Media Storage Server). Trong phạm vi MVP không có tính năng tải trực tiếp về thiết bị — người dùng có thể xem lại qua thư viện cá nhân. Tính năng export/download file MP4 về máy để ngoài phạm vi MVP. | Trung bình  | File video được lưu thành công lên server, xuất hiện trong thư viện cá nhân sau khi quay xong; chất lượng hình ảnh và đồng bộ âm thanh tương đương với những gì hiển thị thời gian thực. |
| **FR-17** | Người dùng xem lại, đổi tên, xóa các video đã quay trong thư viện cá nhân.                                                                                                                                                                                                                           | Thấp        | Thao tác quản lý video phản ánh đúng ngay trên giao diện thư viện.                                                                                                                       |

### 3.6. Module Xử lý lỗi và Thông báo người dùng

Các yêu cầu dưới đây đặc tả hành vi hệ thống khi gặp lỗi ngoài dự kiến — bổ sung cho NFR-23 (phi chức năng) bằng các tiêu chí chức năng cụ thể hơn cho từng tình huống.

| **Mã**    | **Mô tả yêu cầu**                                                                                                                                                                                                                                                                                     | **Ưu tiên** | **Tiêu chí chấp nhận**                                                                                                                                                     |
|-----------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **FR-18** | Khi thiết lập cuộc gọi video thất bại (hết thời gian chờ 5 giây, lỗi ICE negotiation), hệ thống hiển thị thông báo rõ ràng nêu nguyên nhân khả thi và đề nghị thử lại hoặc kiểm tra kết nối mạng.                                                                                                     | Cao         | Thông báo lỗi xuất hiện trong vòng 5 giây kể từ khi phát hiện thất bại; có nút thử lại ngay trên thông báo.                                                                |
| **FR-19** | Khi camera bị chiếm bởi ứng dụng khác hoặc quyền truy cập camera bị từ chối, hệ thống phát hiện sự kiện lỗi từ getUserMedia() và hiển thị hướng dẫn cụ thể (đóng ứng dụng đang dùng camera, hoặc cấp lại quyền trong cài đặt trình duyệt), đồng thời cho phép tiếp tục với nhân vật ảo tĩnh (NFR-30). | Cao         | Thông báo hiển thị đúng loại lỗi (camera bị chiếm vs. bị từ chối quyền), kèm bước hành động cụ thể — không hiển thị thông báo kỹ thuật thuần (mã lỗi nội bộ, stack trace). |
| **FR-20** | Khi kết nối mạng bị mất trong cuộc gọi, hệ thống hiển thị chỉ báo trực quan (ví dụ icon mạng kèm đếm ngược thời gian còn lại để thử kết nối lại) thay vì để màn hình cuộc gọi đứng im không phản hồi.                                                                                                 | Trung bình  | Trong vòng 2 giây sau khi phát hiện mất kết nối, người dùng thấy chỉ báo trạng thái đang thử kết nối lại.                                                                  |
| **FR-21** | Khi quá trình lưu video thất bại (lỗi lưu trữ, vượt giới hạn dung lượng phát hiện muộn), hệ thống thông báo rõ ràng và giữ lại phần dữ liệu đã quay được (NFR-26) để người dùng không mất toàn bộ nội dung.                                                                                           | Trung bình  | Người dùng nhận được thông báo rõ nguyên nhân thất bại và biết rằng dữ liệu từng đoạn đã quay được không bị mất hoàn toàn.                                                 |

## 4. Yêu cầu phi chức năng

### 4.1. Hiệu năng

*NFR-01 và NFR-02 áp dụng trong điều kiện kiểm thử chuẩn sau đây: laptop tham chiếu (Intel Core i5 thế hệ 10+ hoặc tương đương, 8GB RAM, GPU tích hợp Intel Iris/UHD), webcam 720p 30fps, ánh sáng phòng bình thường (≥ 200 lux), người dùng ngồi cách camera 50–80cm, không có ứng dụng nặng khác chạy đồng thời. Nếu thiết bị người dùng yếu hơn thiết bị tham chiếu, kết quả đo thấp hơn được chấp nhận nhưng không tính vào việc nghiệm thu yêu cầu.*

| **Mã**     | **Yêu cầu**                                                                                                                                                                                                                                                |
|------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **NFR-01** | Độ trễ từ lúc theo dõi đến lúc hiển thị thay đổi trên nhân vật ảo (tracking-to-render latency) không vượt quá 100ms, đo trên thiết bị và điều kiện tham chiếu đã định nghĩa ở đầu mục này.                                                                 |
| **NFR-02** | Tốc độ khung hình theo dõi và render nhân vật ảo đạt tối thiểu 24 khung hình/giây, đo trên thiết bị và điều kiện tham chiếu đã định nghĩa ở đầu mục này. Giá trị 24fps là ngưỡng tối thiểu cảm nhận mượt — không phải cam kết cho mọi thiết bị người dùng. |
| **NFR-03** | Độ trễ truyền thông hai chiều trong cuộc gọi video (end-to-end latency) không vượt quá 400ms, theo khuyến nghị ITU-T G.114 cho thoại thời gian thực.                                                                                                       |
| **NFR-04** | Thời gian thiết lập kết nối WebRTC ban đầu không vượt quá 5 giây trong điều kiện mạng ổn định.                                                                                                                                                             |

### 4.2. Bảo mật

| **Mã**     | **Yêu cầu**                                                                                                                                                                                                                                                                                                                                                 |
|------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **NFR-05** | Toàn bộ luồng audio/video trong cuộc gọi được mã hóa bằng DTLS-SRTP theo chuẩn WebRTC, không truyền dữ liệu chưa mã hóa qua mạng công cộng.                                                                                                                                                                                                                 |
| **NFR-06** | Dữ liệu khung hình khuôn mặt thật chỉ được xử lý trong bộ nhớ trình duyệt (on-device), không được lưu trữ hoặc truyền lên máy chủ dưới bất kỳ hình thức nào.                                                                                                                                                                                                |
| **NFR-07** | Mật khẩu người dùng được băm bằng thuật toán băm mật khẩu chuyên dụng (ví dụ bcrypt/argon2) trước khi lưu trữ.                                                                                                                                                                                                                                              |
| **NFR-08** | Toàn bộ endpoint API yêu cầu xác thực hợp lệ (JWT hoặc tương đương), từ chối truy cập trái phép với mã trạng thái phù hợp.                                                                                                                                                                                                                                  |
| **NFR-09** | Dữ liệu nhập từ người dùng được kiểm tra hợp lệ (input validation) ở phía máy chủ trước khi xử lý, phòng chống injection.                                                                                                                                                                                                                                   |
| **NFR-32** | Backend cấu hình CORS (Cross-Origin Resource Sharing) chỉ cho phép các origin hợp lệ (domain của client và signaling server) — đặc biệt quan trọng khi client, backend, và signaling server có thể chạy trên các subdomain/port khác nhau. Đồng thời bật HSTS (HTTP Strict Transport Security) để buộc trình duyệt luôn dùng HTTPS, tránh downgrade attack. |

### 4.3. Khả năng mở rộng

| **Mã**     | **Yêu cầu**                                                                                                                                                    |
|------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **NFR-10** | Kiến trúc backend cho phép mở rộng theo chiều ngang (horizontal scaling) để phục vụ số lượng cuộc gọi đồng thời tăng dần ở các giai đoạn phát triển tiếp theo. |
| **NFR-11** | Thành phần xử lý theo dõi và render nhân vật ảo chạy phía client, không tạo thêm tải tính toán cho máy chủ khi số lượng người dùng tăng.                       |

### 4.4. Khả năng sử dụng

| **Mã**     | **Yêu cầu**                                                                                                                                       |
|------------|---------------------------------------------------------------------------------------------------------------------------------------------------|
| **NFR-12** | Người dùng mới hoàn tất bước thiết lập nhân vật ảo lần đầu (chọn mẫu, cấp quyền camera/micro) trong vòng 5 phút mà không cần hướng dẫn bên ngoài. |
| **NFR-13** | Giao diện hiển thị rõ trạng thái theo dõi (đang hoạt động/mất theo dõi tạm thời) để người dùng nhận biết khi cần điều chỉnh tư thế hoặc ánh sáng. |

### 4.5. Độ tin cậy

| **Mã**     | **Yêu cầu**                                                                                                                                                                                                                                                                                                                                 |
|------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **NFR-14** | Khi mất kết nối mạng tạm thời (dưới 5 giây), cuộc gọi tự động khôi phục mà không cần người dùng thực hiện thao tác nào và không mất trạng thái hiển thị nhân vật ảo hiện tại — phân biệt với NFR-04 (thiết lập kết nối mới từ đầu): khôi phục dùng ICE restart trên phiên đã có, không tạo phiên mới, không yêu cầu chấp nhận cuộc gọi lại. |
| **NFR-15** | Tin nhắn gửi đi khi người nhận ngoại tuyến được lưu trữ và gửi lại khi người nhận trực tuyến trở lại.                                                                                                                                                                                                                                       |

### 4.6. Khả năng tương thích

| **Mã**     | **Yêu cầu**                                                                                                                     |
|------------|---------------------------------------------------------------------------------------------------------------------------------|
| **NFR-16** | Hệ thống hoạt động đúng trên hai phiên bản gần nhất của Chrome, Edge và Firefox.                                                |
| **NFR-17** | Giao diện hiển thị hợp lý trên màn hình laptop (1366×768 trở lên); không bắt buộc hỗ trợ trình duyệt di động trong phạm vi MVP. |

### 4.7. Ràng buộc dữ liệu và lưu trữ

| **Mã**     | **Yêu cầu**                                                                                                                                                           |
|------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **NFR-18** | Video quay được xuất ra định dạng MP4 (codec H.264/AAC) để đảm bảo khả năng phát lại rộng rãi trên trình duyệt và thiết bị phổ biến.                                  |
| **NFR-19** | Dung lượng lưu trữ video tối đa cho mỗi tài khoản trong phạm vi MVP là 2GB; khi vượt ngưỡng, hệ thống từ chối quay thêm và thông báo người dùng cần xóa bớt video cũ. |
| **NFR-20** | Trong phạm vi MVP, video không bị hệ thống tự động xóa; chính sách lưu trữ dài hạn và dọn dẹp tự động được để ngoài phạm vi MVP (xem mục 8.2).                        |

### 4.8. Khả năng quan sát hệ thống (Observability)

SRS định nghĩa hệ thống phải làm gì và đạt mức nào, nhưng cần thêm yêu cầu về cách xác nhận điều đó đang đúng trong môi trường vận hành thực.

| **Mã**     | **Yêu cầu**                                                                                                                                                                                                                                       |
|------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **NFR-21** | Hệ thống ghi log các sự kiện quan trọng (cuộc gọi thất bại, lỗi kết nối WebRTC/WebSocket, exception không mong đợi) kèm timestamp và đủ ngữ cảnh để truy vết nguyên nhân sau khi sự cố đã xảy ra.                                                 |
| **NFR-22** | Client định kỳ gửi số liệu hiệu năng thực đo được (độ trễ theo dõi-đến-hiển thị, khung hình/giây, độ trễ cuộc gọi) về backend, làm cơ sở phát hiện khi hệ thống vi phạm NFR-01/NFR-02/NFR-03 trong thực tế, không chỉ trong môi trường kiểm thử.  |
| **NFR-23** | Khi gặp lỗi không mong đợi (máy chủ lỗi, thư viện theo dõi tải thất bại, WebSocket bị đóng đột ngột), hệ thống hiển thị thông báo rõ ràng cho người dùng và cố gắng khôi phục hoặc hướng dẫn bước tiếp theo, thay vì treo im lặng không phản hồi. |

### 4.9. Tính toàn vẹn dữ liệu (Data Integrity)

| **Mã**     | **Yêu cầu**                                                                                                                                                                                          |
|------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **NFR-24** | Mỗi tin nhắn được gán định danh duy nhất (idempotency key) tạo phía client. Khi tin nhắn được gửi lại do mất kết nối tạm thời, hệ thống nhận diện và loại bỏ bản trùng thay vì hiển thị hai lần.     |
| **NFR-25** | Tin nhắn được hiển thị đúng theo thứ tự thời điểm gửi logic (timestamp/sequence number do client gán), không phụ thuộc thứ tự gói tin đến do độ trễ mạng không đều.                                  |
| **NFR-26** | Video đang quay được lưu tạm theo từng đoạn (chunked) trong quá trình quay. Nếu trình duyệt gặp sự cố giữa chừng, phần đã quay đến đoạn gần nhất được khôi phục, không mất toàn bộ nội dung đã quay. |

### 4.10. Quyền riêng tư và Tuân thủ (Privacy & Compliance)

Khác với mục 4.2 (Bảo mật — bảo vệ dữ liệu khỏi truy cập trái phép), mục này quy định quyền của người dùng đối với chính dữ liệu của họ và giới hạn truy cập từ phía vận hành hệ thống.

| **Mã**     | **Yêu cầu**                                                                                                                                                                                              |
|------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **NFR-27** | Người dùng có quyền yêu cầu xóa tài khoản; khi xác nhận, toàn bộ dữ liệu liên quan (hồ sơ, tin nhắn, video đã lưu) bị xóa khỏi hệ thống trong vòng 30 ngày.                                              |
| **NFR-28** | Mặc định trong phạm vi MVP, dữ liệu được lưu trữ vô thời hạn cho đến khi người dùng chủ động yêu cầu xóa (NFR-27); chính sách tự động hết hạn theo thời gian để ngoài phạm vi MVP, nhất quán với NFR-20. |
| **NFR-29** | Truy cập dữ liệu người dùng từ phía quản trị viên được giới hạn theo vai trò (role-based access control) và mọi lần truy cập được ghi log riêng, tách biệt với log vận hành thông thường.                |

### 4.11. Khả năng tiếp cận (Accessibility)

| **Mã**     | **Yêu cầu**                                                                                                                                                                                           |
|------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **NFR-30** | Hệ thống vẫn hoạt động được khi người dùng không cấp quyền camera hoặc thiết bị không có webcam — nhân vật ảo hiển thị ở trạng thái tĩnh/idle thay vì chặn hoàn toàn chức năng nhắn tin và gọi video. |
| **NFR-31** | Các chức năng điều khiển chính (gửi tin nhắn, bắt đầu/kết thúc cuộc gọi, tắt mic/camera) thao tác được bằng bàn phím, không bắt buộc phải dùng chuột.                                                 |

## 5. Yêu cầu giao diện ngoài

### 5.1. Giao diện người dùng

- Màn hình Đăng nhập / Đăng ký.

- Màn hình Thiết lập Nhân vật ảo: chọn mẫu, tùy chỉnh cơ bản, xem trước theo thời gian thực qua webcam trước khi xác nhận.

- Màn hình Danh sách trò chuyện: hiển thị danh sách liên hệ, tin nhắn gần nhất.

- Màn hình Trò chuyện: khung nhắn tin và nút khởi tạo cuộc gọi video.

- Màn hình Cuộc gọi video: hiển thị nhân vật ảo hai bên, thanh điều khiển (mic, camera, kết thúc, quay video).

- Màn hình Thư viện video: danh sách video đã quay, thao tác xem/đổi tên/xóa.

### 5.2. Giao diện phần cứng

- Webcam: nguồn ảnh đầu vào cho module theo dõi khuôn mặt và cử chỉ, truy cập qua WebRTC getUserMedia API của trình duyệt.

- Microphone: nguồn âm thanh cho cuộc gọi và (ở tính năng mở rộng) cho phân tích đặc trưng giọng nói.

### 5.3. Giao diện phần mềm

| **Thành phần**                                   | **Vai trò**                                                                                                                |
|--------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------|
| **Thư viện theo dõi điểm mốc (ví dụ MediaPipe)** | Trích xuất điểm mốc khuôn mặt, bàn tay, tư thế từ khung hình webcam theo thời gian thực.                                   |
| **Thư viện render 3D (ví dụ three.js)**          | Render nhân vật ảo và áp dụng dữ liệu khung xương lên mô hình 3D trong trình duyệt.                                        |
| **WebRTC API trình duyệt**                       | Thiết lập và duy trì kết nối audio/video thời gian thực giữa hai người dùng.                                               |
| **Backend API (REST)**                           | Xử lý xác thực, quản lý tài khoản, lưu trữ tin nhắn và siêu dữ liệu video.                                                 |
| **Signaling Server**                             | Trao đổi thông tin thiết lập kết nối WebRTC (SDP, ICE candidate) giữa hai phía trước khi kết nối trực tiếp được thiết lập. |

### 5.4. Giao diện truyền thông

- Giao thức WebRTC (DTLS-SRTP) cho luồng audio/video thời gian thực giữa hai client.

- Giao thức HTTPS/REST cho giao tiếp giữa client và backend (xác thực, tin nhắn, siêu dữ liệu).

- WebSocket cho kênh báo hiệu (signaling) thời gian thực phục vụ thiết lập cuộc gọi.

## 6. Kiến trúc hệ thống tổng quan

Mục này trình bày kiến trúc ở mức tổng quan cần thiết để hiểu cách các yêu cầu ở mục 3 và 4 được hiện thực hóa. Thiết kế chi tiết hơn (sơ đồ lớp, schema CSDL, đặc tả API) thuộc về Tài liệu thiết kế kiến trúc (Architecture Design Document) — tài liệu này sẽ được soạn ở giai đoạn thiết kế chi tiết tiếp theo của đồ án, sau khi SRS được thông qua.

### 6.1. Thành phần Client (trình duyệt)

- Module theo dõi (Tracking Module): thu nhận khung hình webcam, trích xuất điểm mốc khuôn mặt/tay/thân theo thời gian thực, áp dụng One Euro Filter và ràng buộc IK.

- Module nhân vật ảo (Avatar Renderer): nhận dữ liệu khung xương đã xử lý, render nhân vật ảo 3D theo thời gian thực lên một canvas/WebGL context.

- Module giao tiếp (Communication Module): quản lý kết nối WebRTC — tách riêng hai loại luồng dữ liệu gửi đi (xem chi tiết 6.1.1).

#### 6.1.1. Cách truyền dữ liệu skeleton thay cho video thô

Đây là điểm kiến trúc cốt lõi hiện thực hóa yêu cầu bảo mật NFR-06. Mỗi kết nối WebRTC giữa hai client mang hai loại dữ liệu tách biệt:

- RTCDataChannel (kênh dữ liệu): truyền hệ số blendshape khuôn mặt và góc khớp khung xương đã qua One Euro Filter + IK constraint, cập nhật ở tần suất theo dõi (≥24 lần/giây). Đây là dữ liệu số nhỏ gọn (vài trăm byte mỗi khung hình), không chứa hình ảnh.

- MediaStreamTrack loại audio: truyền giọng nói thật của người dùng, mã hóa bằng DTLS-SRTP theo chuẩn WebRTC — không có track loại video chứa khuôn mặt thật được tạo ra hay truyền đi.

Phía nhận sử dụng cùng Module nhân vật ảo đang chạy cho chính mình để render nhân vật ảo của người gửi, nhưng nguồn dữ liệu khung xương lúc này là dữ liệu nhận qua RTCDataChannel thay vì dữ liệu theo dõi cục bộ. Nhờ vậy, khuôn mặt thật của người dùng không bao giờ tồn tại dưới dạng hình ảnh ngoài phạm vi trình duyệt của chính họ.

### 6.2. Thành phần máy chủ tín hiệu và trung gian (Signaling/TURN)

- Signaling Server: trao đổi thông tin thiết lập kết nối (SDP/ICE) giữa hai client qua WebSocket.

- STUN/TURN Server: hỗ trợ thiết lập kết nối trực tiếp giữa hai client nằm sau NAT/firewall; TURN đóng vai trò trung gian relay khi không thể kết nối trực tiếp.

### 6.3. Thành phần Backend (ứng dụng)

- Authentication Service: xử lý đăng ký, đăng nhập, cấp phát token xác thực.

- Messaging Service: lưu trữ và truy xuất tin nhắn, lịch sử trò chuyện.

- Media Storage Service: lưu trữ siêu dữ liệu và file video đã quay (video chỉ chứa hình ảnh nhân vật ảo, không chứa khuôn mặt thật).

Nguyên tắc kiến trúc xuyên suốt: dữ liệu hình ảnh khuôn mặt thật của người dùng không bao giờ rời khỏi thành phần Client — chỉ dữ liệu khung xương đã được trừu tượng hóa (góc khớp, hệ số blendshape) và luồng âm thanh mới được truyền qua kênh WebRTC tới phía nhận, qua đó vừa giảm băng thông cần thiết vừa đảm bảo yêu cầu bảo mật NFR-06.

## 7. Ma trận truy vết yêu cầu

Bảng dưới đây ánh xạ các nhóm yêu cầu chức năng tới mục tiêu nghiệp vụ và yêu cầu phi chức năng liên quan, phục vụ việc kiểm tra tính đầy đủ khi thiết kế và kiểm thử.

| **Yêu cầu chức năng**       | **Mục tiêu nghiệp vụ**                                                                  | **NFR liên quan**                                                              |
|-----------------------------|-----------------------------------------------------------------------------------------|--------------------------------------------------------------------------------|
| **FR-04 — FR-09**           | Trải nghiệm nhân vật ảo tự nhiên, không lỗi hình ảnh; B thấy đúng avatar A đã tùy chỉnh | NFR-01, NFR-02                                                                 |
| **FR-05, FR-06**            | Bảo vệ danh tính người dùng khi giao tiếp                                               | NFR-06                                                                         |
| **FR-11, FR-12**            | Giao tiếp văn bản liên tục, đúng thứ tự, không trùng lặp                                | NFR-14, NFR-24, NFR-25                                                         |
| **FR-13 — FR-15**           | Giao tiếp thời gian thực ổn định                                                        | NFR-03, NFR-04, NFR-14                                                         |
| **FR-01, FR-02**            | Bảo vệ tài khoản và quyền riêng tư người dùng                                           | NFR-07, NFR-08, NFR-27, NFR-28, NFR-29, NFR-32 (CORS/HSTS áp dụng toàn bộ API) |
| **FR-22**                   | Tìm kiếm người dùng có opt-in, không vi phạm nguyên tắc privacy FR-01/02                | NFR-08, NFR-09, NFR-32                                                         |
| **FR-16, FR-17**            | Lưu giữ, tái sử dụng và không mất nội dung video                                        | NFR-18, NFR-19, NFR-20, NFR-26                                                 |
| **Toàn bộ FR (xuyên suốt)** | Vận hành quan sát được, phát hiện lỗi trong môi trường thực                             | NFR-21, NFR-22, NFR-23                                                         |
| **FR-04, FR-13**            | Truy cập được khi thiếu thiết bị hoặc không dùng chuột                                  | NFR-30, NFR-31                                                                 |

## 8. Phụ lục

### 8.1. Danh sách giả định rủi ro kỹ thuật

| **Rủi ro**                                                      | **Phương án giảm thiểu**                                                                                                                  |
|-----------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------|
| **Theo dõi tay mất chính xác khi bị che khuất hoàn toàn**       | Áp dụng FR-09 (giữ tư thế hợp lệ gần nhất); cân nhắc EXT-01 (sinh cử chỉ từ giọng nói — xem mục 8.2) ở giai đoạn mở rộng.                 |
| **Độ trễ tăng cao khi mạng không ổn định**                      | Áp dụng cơ chế điều chỉnh chất lượng thích ứng (adaptive bitrate) của WebRTC; ưu tiên truyền dữ liệu khung xương (nhẹ) thay vì video thô. |
| **Hiệu năng xử lý không đồng đều giữa các thiết bị người dùng** | Đặt yêu cầu phần cứng tối thiểu rõ ràng (mục 2.4); cung cấp chế độ giảm chất lượng render khi phát hiện khung hình/giây thấp.             |

### 8.2. Ghi chú phạm vi ngoài MVP

- Gọi video nhóm nhiều người tham gia.

- Kho nhân vật ảo do bên thứ ba/cộng đồng đóng góp.

- Sinh chuyển động toàn thân từ mô hình sinh tạo (generative model) huấn luyện riêng — chỉ dừng ở mức tham khảo nghiên cứu, không thuộc phạm vi cài đặt chính thức của đồ án.

- Ứng dụng di động native (chỉ hỗ trợ trình duyệt desktop trong phạm vi MVP).

- Livestream một-nhiều kèm tính năng tặng quà ảo — yêu cầu kiến trúc phân phối luồng (SFU/RTMP) và hệ thống giao dịch riêng, để ngoài phạm vi MVP.

EXT-01 — Sinh cử chỉ thay thế từ giọng nói khi mất dữ liệu theo dõi

Mức ưu tiên: Thấp — định hướng nghiên cứu mở rộng, không phải yêu cầu chức năng chính thức.

Mô tả: Khi dữ liệu theo dõi cử chỉ tay không khả dụng trong thời gian dài (ví dụ tay ra khỏi khung hình quá lâu để FR-09 còn giữ tư thế hợp lý), hệ thống có thể kích hoạt một cử chỉ thay thế được sinh dựa trên đặc trưng âm thanh giọng nói (cao độ, biên độ, điểm nhấn).

Tiêu chí nếu được triển khai: nhân vật ảo thực hiện một cử chỉ tay hợp lệ về mặt giải phẫu, đồng bộ thời điểm với điểm nhấn trong giọng nói.

Lý do để ngoài MVP: đòi hỏi dữ liệu huấn luyện chuyển động ghép cặp với audio, vượt quy mô một đồ án solo nếu tự huấn luyện từ đầu; chỉ khả thi nếu tận dụng mô hình mã nguồn mở đã huấn luyện sẵn.

*— Hết tài liệu —*
