TRƯỜNG ĐẠI HỌC CÔNG NGHỆ — ĐHQGHN

Khoa Công nghệ Thông tin

**TÀI LIỆU THIẾT KẾ KIẾN TRÚC**

*(Software Architecture Document — SAD)*

**VEILTALK**

Tài liệu kỹ thuật bổ trợ cho SRS v1.0

Phiên bản tài liệu: 1.0

Trạng thái: Bản nháp (Draft)

Ngày cập nhật: 21/06/2026

Người soạn thảo: Lê Thị Tú Phương — MSSV 23020695

Lớp: K68 — Khoa Công nghệ Thông tin

Mục lục

## 1. Giới thiệu

### 1.1. Mục đích tài liệu

Tài liệu này mô tả kiến trúc kỹ thuật chi tiết của VeilTalk, làm cơ sở cho quá trình cài đặt, kiểm thử và bảo trì. Mọi quyết định kiến trúc trong tài liệu này được truy vết ngược về một yêu cầu cụ thể trong SRS v1.0 — không có quyết định công nghệ nào được chọn theo xu hướng mà không gắn với một ràng buộc hoặc mục tiêu chất lượng đã định nghĩa. Một số quyết định công nghệ (Spring Boot, PostgreSQL) tham chiếu đến “nền tảng kỹ thuật đã có sẵn” — đây là kinh nghiệm thực tế từ các dự án trước của người phát triển với cùng stack, giúp giảm rủi ro học công nghệ mới trong thời gian thực hiện đồ án.

### 1.2. Phạm vi

Bao phủ toàn bộ hệ thống MVP: client trình duyệt, signaling server, backend, cơ sở dữ liệu, lưu trữ media, và hạ tầng STUN/TURN. Không bao gồm thiết kế chi tiết schema CSDL (xem Database Design Document riêng) hay đặc tả từng endpoint API (xem API Design Document riêng).

### 1.3. Tài liệu liên quan

- SRS v1.0 — VeilTalk Software Requirements Specification.

- Database Design Document v1.0 (VeilTalk_DDD.docx — đã soạn, tham chiếu mục 4.4).

- API Design Document (chưa soạn — tham chiếu mục 4.3).

## 2. Mục tiêu và ràng buộc kiến trúc

### 2.1. Mục tiêu kiến trúc (Quality Attributes)

Ánh xạ trực tiếp từ yêu cầu phi chức năng trong SRS:

| **Mục tiêu**              | **Yêu cầu SRS gốc**                                   |
|---------------------------|-------------------------------------------------------|
| **Privacy by design**     | Khuôn mặt thật không rời khỏi client (NFR-06)         |
| **Real-time performance** | Tracking-to-render \< 100ms (NFR-01), ≥24fps (NFR-02) |
| **Scalability**           | Backend mở rộng theo chiều ngang (NFR-10)             |
| **Reliability**           | Tự khôi phục sau mất kết nối \< 5 giây (NFR-14)       |
| **Observability**         | Logging, monitoring số liệu thực đo (NFR-21, NFR-22)  |

### 2.2. Ràng buộc kỹ thuật

- Chỉ dùng webcam đơn (monocular) — không cảm biến độ sâu hay nhiều camera.

- Toàn bộ pipeline theo dõi (tracking) chạy trên trình duyệt, không phụ thuộc xử lý phía server cho bước này.

- Hỗ trợ Chrome, Edge, Firefox — hai phiên bản gần nhất.

- Chạy được trên laptop tầm trung, GPU tích hợp (không yêu cầu GPU rời).

## 3. Kiến trúc tổng quan

### 3.1. Architectural style

VeilTalk theo phong cách client-heavy: phần lớn xử lý có tính toán nặng (theo dõi khuôn mặt/tay, lọc mượt, ràng buộc IK, render 3D) được đẩy xuống trình duyệt thay vì server. Đây không phải lựa chọn tối ưu hiệu năng đơn thuần — nó bị bắt buộc bởi mục tiêu Privacy by design: nếu dữ liệu khuôn mặt được xử lý ở server, hình ảnh khuôn mặt thật buộc phải rời khỏi thiết bị người dùng trước, vi phạm trực tiếp NFR-06.

Backend theo kiến trúc modular monolith — một ứng dụng triển khai duy nhất, tổ chức nội bộ thành các package độc lập theo domain (Auth, Messaging, Media). Lựa chọn này được giải thích chi tiết kèm so sánh với microservices ở ADR-04 (mục 11).

### 3.2. System Context Diagram (C4 — Level 1)

VeilTalk là hệ thống trung tâm, tương tác với hai nhóm người dùng (Người dùng A, Người dùng B) và các hệ thống ngoài: hạ tầng STUN/TURN (do bên thứ ba cung cấp hoặc tự host) và dịch vụ lưu trữ media.

| **Tác nhân/Hệ thống ngoài** | **Quan hệ với VeilTalk**                                                 |
|-----------------------------|--------------------------------------------------------------------------|
| **Người dùng A, B**         | Tương tác trực tiếp qua trình duyệt: nhắn tin, gọi video qua nhân vật ảo |
| **STUN/TURN Server**        | Hỗ trợ thiết lập kết nối P2P khi hai client nằm sau NAT/firewall         |
| **Media Storage**           | Lưu trữ file video người dùng quay lại                                   |

### 3.3. Container Diagram (C4 — Level 2)

Bảy container chính và quan hệ giữa chúng:

| **Container**        | **Vai trò**                                    | **Giao tiếp với**                              |
|----------------------|------------------------------------------------|------------------------------------------------|
| **Browser Client**   | Tracking, render avatar, giao tiếp WebRTC      | Client khác (P2P), Signaling, Backend          |
| **Signaling Server** | Relay SDP/ICE qua WebSocket                    | Browser Client                                 |
| **Backend API**      | Xác thực, nhắn tin, metadata media             | Browser Client, Database, Media Storage, Redis |
| **Database**         | Lưu tài khoản, tin nhắn, metadata video        | Backend API                                    |
| **Redis**            | Pub/Sub cho WebSocket đa instance, cache phiên | Backend API, Signaling Server                  |
| **Media Storage**    | Lưu file video nhị phân                        | Backend API                                    |
| **STUN/TURN Server** | NAT traversal cho kết nối P2P                  | Browser Client                                 |

*Lưu ý quan trọng về luồng dữ liệu: Browser Client kết nối P2P trực tiếp với Client khác để truyền audio và skeleton data — luồng này không đi qua Signaling Server hay Backend API. Hai thành phần đó chỉ tham gia vào bước thiết lập kết nối ban đầu, không mang dữ liệu cuộc gọi đang diễn ra. Điểm này được làm rõ thêm ở mục 8.1 vì đây là chỗ dễ hiểu nhầm khi ước tính tải hệ thống.*

*Lưu ý về hai kết nối WebSocket song song: Browser Client duy trì đồng thời hai kết nối WebSocket độc lập — một tới Signaling Server (chỉ dùng trong giai đoạn thiết lập cuộc gọi, trao đổi SDP/ICE) và một tới Backend API (dùng liên tục cho luồng nhắn tin thời gian thực). Đây là thiết kế có chủ đích: tách biệt hai luồng dữ liệu có tính chất và vòng đời khác nhau hoàn toàn. Hai kết nối WebSocket này không chia sẻ trạng thái hay giao thức với nhau.*

### 3.4. Component Diagram — Browser Client (C4 — Level 3)

Browser Client là thành phần phức tạp nhất hệ thống, đáng được tách riêng một sơ đồ mức component thay vì chỉ dừng ở Container diagram. Bảng dưới đây thể hiện 4 module nội bộ, trách nhiệm, và luồng dữ liệu giữa chúng — trình bày dạng bảng để đảm bảo chính xác khi đối chiếu lúc cài đặt, nhất quán với cách trình bày sequence flow ở mục 5.

| **Component**            | **Trách nhiệm**                                                       | **Nhận dữ liệu từ**                                        | **Gửi dữ liệu tới**                                                     |
|--------------------------|-----------------------------------------------------------------------|------------------------------------------------------------|-------------------------------------------------------------------------|
| **Tracking/Motion Module** | Trích xuất landmark; lọc direction; chuyển target world sang normalized-humanoid parent-local, rest-relative joint delta; áp constraint | Webcam (getUserMedia) | Avatar Renderer (nội bộ) · Communication Module |
| **Avatar Renderer**      | Render nhân vật ảo 3D lên canvas, nhận dữ liệu từ 1 trong 2 nguồn     | Tracking Module (local) hoặc Communication Module (remote) | WebGL canvas (hiển thị)                                                 |
| **Communication Module** | Quản lý RTCPeerConnection, tách luồng audio/skeleton, xử lý reconnect | Tracking Module · Signaling Server · Client khác (P2P)     | Avatar Renderer (dữ liệu remote) · Signaling Server · Client khác (P2P) |
| **Messaging Module**     | Gửi/nhận tin nhắn, hàng đợi ngoại tuyến, đảm bảo idempotency          | Giao diện người dùng (input)                               | Backend API (WebSocket riêng cho messaging)                             |

*Điểm đáng chú ý: Tracking Module và Messaging Module không giao tiếp trực tiếp với nhau — chúng độc lập hoàn toàn, chỉ Avatar Renderer và Communication Module có quan hệ hai chiều (vì Renderer cần dữ liệu cả từ tracking cục bộ lẫn từ Communication Module khi hiển thị nhân vật của người đối thoại).*

## 4. Thiết kế chi tiết từng thành phần

### 4.1. Browser Client

#### 4.1.1. Tracking Module

- Nguồn đầu vào: WebRTC getUserMedia() → chuỗi khung hình video thô (raw frame), không rời khỏi bộ nhớ trình duyệt.

- Thư viện: MediaPipe Tasks API (thay thế cho MediaPipe Holistic đã bị deprecated). Lý do chọn so với phương án khác: TensorFlow.js cho độ chính xác tương đương nhưng đòi hỏi tự huấn luyện/tinh chỉnh model theo dõi tay — tốn thời gian ngoài phạm vi đồ án; face-api.js chỉ mạnh ở khuôn mặt, không có model theo dõi tay/thân tích hợp sẵn. MediaPipe Tasks API cung cấp các task chuyên biệt (FaceLandmarker, HandLandmarker, PoseLandmarker) thay thế Holistic đơn khối, hiệu năng tốt hơn và được Google tiếp tục duy trì.

- Pipeline xử lý hiện tại: raw frame → landmark extraction (MediaPipe) → phân loại Hand sample tại processor boundary (`unsampled`/`duplicate`/`new-sample`) → per-side image bounds/visibility gate → torso semantic basis → three-point anatomical arm-frame (primary direction + elbow-offset secondary reference) → direction/pole filters → parent-local/rest-relative delta → safety constraint → hold/return/recovery → optional Hand forearm axial-twist correction → hệ số blendshape + `AvatarPosePacketV1`. Duplicate bị chặn trước Hand matching/palm construction nhưng temporal vẫn tick theo `dt`. Hand world palm basis được đổi đồng bộ sang motion frame `(x,-y,-z)` trước chirality và trước phép đo twist. Convention đo giải phẫu hiện dùng `positiveSign=+1` cho cả hai side; code có application-sign boundary riêng để điều tra chiều rig, nhưng webcam gate tay phải vẫn FAIL nên dấu cuối chưa được coi là convention đã nghiệm thu. Neutral/matching/temporal dùng tracking epoch độc lập từng side; short reacquire và lower-arm geometry dropout chưa được xác nhận giữ epoch. Reset/dispose/rig change/discontinuity/long loss, hoặc recovery sau geometry loss đã vượt `invalidGraceMs`, mới tạo epoch mới. Depth-degenerate dùng previous/rest pole fallback. Trạng thái và acceptance gate Phase 3B nằm tại `docs/P4_T10_PHASE3B_HAND_TWIST_STATUS_AND_PLAN.md`.

- Output: `AvatarPosePacketV1` plain-data nhỏ gọn. `jointRotations` chứa quaternion delta trong normalized-humanoid parent-local, rest-relative space; packet không chứa raw face/hand/pose landmarks hoặc facial transform matrix. RTCDataChannel transport thuộc P4-T15, chưa nằm trong P4-T10.

- Xử lý edge case: mất theo dõi do che khuất/ánh sáng yếu — áp dụng đúng FR-09 (giữ tư thế hợp lệ gần nhất).

#### 4.1.2. Avatar Renderer

- Thư viện: Three.js. Lý do chọn so với Babylon.js, PlayCanvas: hệ sinh thái rộng nhất cho định dạng GLB/GLTF kèm morph target (cần thiết cho blendshape), tài liệu phong phú, cộng đồng lớn giúp tra cứu khi gặp vướng mắc trong đồ án solo. Đánh đổi: nặng hơn một chút so với Babylon.js cho riêng tác vụ render nhân vật đơn giản, nhưng không đáng kể ở quy mô một nhân vật/cảnh.

- Định dạng model: GLB/GLTF với morph target ánh xạ trực tiếp tới hệ số blendshape từ Tracking Module (nhất quán với khuyến nghị dùng model VRM — VRM xây trên nền GLTF).

- Pipeline render: nhận `AvatarPosePacketV1` → ánh xạ blendshape → tái tạo target local tuyệt đối bằng `qRestLocal × qDeltaLocal` → optional frame-rate-independent quaternion smoothing → gán normalized humanoid bone quaternion → `vrm.update(dt)` → render WebGL canvas. Renderer không ghi bone position/scale khi apply pose.

- Hai chế độ nguồn dữ liệu: theo dõi cục bộ (cho chính nhân vật của người dùng) và dữ liệu nhận qua RTCDataChannel (cho nhân vật của người đối thoại) — cùng một Renderer, khác nguồn input. Về model 3D phía nhận: khi thiết lập cuộc gọi, phía nhận tải model GLB của người gọi từ Backend API (không truyền trực tiếp qua WebRTC DataChannel vì file model có thể lớn). Backend lưu sẵn URL/reference tới model đã chọn của từng user trong hồ sơ tài khoản (FR-04); phía nhận dùng URL này để tải model đúng trước khi bắt đầu nhận skeleton data. Nhờ đó, người dùng B thấy đúng nhân vật ảo (màu tóc, trang phục) mà người dùng A đã tùy chỉnh.

- Bảng giới hạn góc khớp giải phẫu (khuỷu tay, cổ tay, vai) được định nghĩa tĩnh trong cấu hình, dùng chung cho cả theo dõi cục bộ và dữ liệu nhận từ xa, đảm bảo FR-08 áp dụng nhất quán cho cả hai chế độ.

##### P4-T10 normalized arm retargeting contract

Model loader chuẩn hóa VRM0 trước, lấy normalized humanoid nodes và capture một immutable
rig profile theo model generation. Mỗi controlled joint lưu rest local rotation, rest world
rotation, parent rest world rotation và rest world direction từ model thật. Profile cũ bị
loại khi reload model; motion processor không solve nếu chưa có profile hợp lệ.

Solver chạy `leftUpperArm → leftLowerArm → rightUpperArm → rightLowerArm`. Upper arm dùng
parent rest world cố định; lower arm dùng target world của upper arm vừa giải trong cùng
target pose. Solver không đọc animated bone transform từ renderer, nhờ đó cùng input cho
cùng output và không tích lũy drift theo frame:

```text
qSwingWorld  = fromTo(dRestWorld, dTargetWorld)
qTargetWorld = qSwingWorld × qRestWorld
qTargetLocal = inverse(qParentTargetWorld) × qTargetWorld
qDeltaLocal  = inverse(qRestLocal) × qTargetLocal
qAppliedLocal = qRestLocal × qDeltaLocal
```

Production coordinate conversion vẫn là `(x,y,z) → (x,-y,-z)`. Constraint hiện clamp
rest-relative delta; khi delta bị clamp, target world của parent được tính lại trước khi solve
child. Phase 3A thay production one-vector path bằng full arm frame dựng từ direction và
elbow-offset pole, có hysteresis cùng previous/rest fallback. Swing–twist utility mới phục vụ
test/diagnostics; palm twist và anatomical calibration thuộc Phase 3B/3C.

#### 4.1.3. Communication Module

- Quản lý vòng đời RTCPeerConnection: tạo offer/answer, trao đổi ICE candidate qua Signaling Server.

- Hai loại dữ liệu tách biệt trong một kết nối WebRTC: RTCDataChannel (JSON skeleton/blendshape) và MediaStreamTrack loại audio — không tạo hay truyền bất kỳ MediaStreamTrack loại video nào chứa khuôn mặt thật.

- Xử lý reconnect: khi phát hiện kết nối ICE chuyển trạng thái 'disconnected', giữ nguyên tư thế avatar cuối cùng (không đóng băng giao diện) và thử kết nối lại trong vòng 5 giây trước khi báo lỗi cho người dùng (NFR-14).

#### 4.1.4. Messaging Module

- Kết nối WebSocket riêng tới Backend cho luồng nhắn tin thời gian thực (tách biệt với WebSocket của Signaling Server).

- Hàng đợi tin nhắn ngoại tuyến: tin nhắn được lưu tạm phía client kèm trạng thái 'đang gửi' cho đến khi nhận xác nhận từ server; tự động gửi lại khi kết nối khôi phục.

- Đảm bảo idempotency: mỗi tin nhắn mang một ID duy nhất sinh phía client (UUID); Backend dùng ID này để loại bỏ bản trùng nếu nhận lại cùng một tin nhắn (hiện thực hóa NFR-24).

### 4.2. Signaling Server

- Công nghệ: Node.js + thư viện ws. Lý do chọn: signaling chỉ cần xử lý I/O bất đồng bộ nhẹ (relay message qua WebSocket), không có tính toán nặng — Node.js phù hợp cho khối lượng công việc I/O-bound này, và việc tách riêng khỏi Backend chính (Spring Boot) cho phép scale độc lập nếu cần mà không ảnh hưởng tới Backend.

- Chức năng duy nhất: relay SDP offer/answer và ICE candidate giữa hai peer. Không lưu trữ, không xử lý nội dung cuộc gọi.

<!-- -->

- Xác thực kết nối WebSocket: khi client kết nối tới Signaling Server, client phải gửi JWT hợp lệ trong handshake (qua query param hoặc header). Signaling Server validate token trước khi chấp nhận kết nối — từ chối nếu token không hợp lệ/hết hạn. Điều này ngăn kẻ tấn công gửi offer giả mạo lên Signaling Server mà không cần tài khoản hợp lệ (lỗ hổng bảo mật được xác định trong STRIDE-S, mục 9.4). Lưu ý: Signaling Server chỉ validate chữ ký JWT; không gọi Backend API để xác minh từng message — tránh tăng độ trễ thiết lập cuộc gọi.

<!-- -->

- Session management: timeout phiên chờ kết nối, dọn dẹp tài nguyên khi một peer ngắt kết nối đột ngột.

- Mô hình session (P3-T03): session gắn theo `userId`, KHÔNG dùng `call_session_id` riêng (field đó chỉ tồn tại ở CALL_INCOMING trên kênh Messaging — mục 10.1 của API Design — sinh từ cặp caller/callee chuẩn hoá, tương tự conversation_id, không phải một entity được Signaling Server track). Với model gọi 1-1, mỗi user chỉ ở một cuộc gọi tại một thời điểm nên `Map<userId, {peerUserId, status, lastActivityAt}>` là đủ. Trạng thái `pending` (đã gửi CALL_OFFER, chưa nhận CALL_ANSWER) bị dọn sau 30 giây không hoạt động (UC-01 no-answer). Trạng thái `active` (đã nhận CALL_ANSWER) bị loại khỏi timeout-sweep vĩnh viễn, vì sau khi kết nối P2P thiết lập xong, Signaling Server không còn thấy message nào nữa (client trao đổi trực tiếp) — áp timeout 30s lên `active` sẽ giết mọi cuộc gọi hợp lệ dài hơn 30 giây. Session `active`/`pending` chỉ kết thúc bởi CALL_REJECT, CALL_END, hoặc ngắt kết nối đột ngột (khi đó phía còn lại nhận CALL_END với `reason` tương ứng: `timeout`, `peer_disconnected`).

### 4.3. Backend API

- Công nghệ: Spring Boot (Java 21). Lý do chọn: Spring Boot cung cấp đầy đủ các thành phần cần thiết (Spring Security cho JWT, Spring Data JPA cho truy xuất dữ liệu, validation tích hợp) với hệ sinh thái trưởng thành; người phát triển đã có kinh nghiệm thực tế với stack này, giảm rủi ro học công nghệ mới giữa thời gian làm đồ án. Java 21 là LTS release mới nhất, bổ sung Virtual Threads (Project Loom) giúp xử lý WebSocket concurrent hiệu quả hơn mà không cần đổi code. Đánh đổi: khởi động ứng dụng chậm hơn Node.js/FastAPI vài giây — không đáng kể với một backend chạy liên tục, không phải serverless.

- Authentication Service: luồng JWT — issue khi đăng nhập thành công, validate ở mỗi request qua filter, refresh token riêng để gia hạn không cần đăng nhập lại, revoke khi đăng xuất (đưa token vào danh sách đen tạm thời trong Redis đến khi hết hạn tự nhiên). Thời hạn cụ thể: access token 15 phút (đủ ngắn để giới hạn thiệt hại nếu bị đánh cắp, đủ dài để không cần refresh liên tục trong một phiên sử dụng thông thường); refresh token 7 ngày (đủ dài để không yêu cầu đăng nhập lại mỗi ngày, có thể rút ngắn xuống 24 giờ nếu yêu cầu bảo mật cao hơn sau MVP). Redis blacklist TTL = thời hạn access token còn lại khi revoke — tối đa 15 phút, dung lượng Redis cho blacklist không đáng kể ở quy mô MVP.

<!-- -->

- User Discovery Service: tra cứu người dùng theo email (FR-22) — chỉ trả kết quả khi user đích đã bật tùy chọn discoverable trong cài đặt tài khoản. Cả hai trường hợp (email không tồn tại / tồn tại nhưng chưa bật discoverable) trả về cùng một response trung lập để tránh user enumeration. Rate limiting cứng: 10 request/phút/tài khoản đã xác thực, trả về HTTP 429 khi vượt ngưỡng (NFR-32).

<!-- -->

- Messaging Service: lưu tin nhắn vào Database, đánh index theo cặp (conversation_id, created_at) để truy vấn lịch sử trò chuyện hiệu quả; dùng Redis Pub/Sub để đẩy tin nhắn thời gian thực tới đúng instance Backend đang giữ kết nối WebSocket của người nhận (cần thiết khi Backend chạy nhiều instance — xem mục 10.3).

- Media Storage Service: lưu metadata video (link tới file vật lý, dung lượng, thời điểm tạo) trong Database; giới hạn 2GB/tài khoản theo NFR-19, kiểm tra trước khi cho phép lưu thêm.

- Logging: ghi log lỗi, cảnh báo, sự kiện quan trọng (xác thực thất bại, vượt hạn mức lưu trữ, lỗi kết nối) theo NFR-21, có thể tích hợp SLF4J + Logback có sẵn trong Spring Boot.

### 4.4. Database

- Công nghệ: PostgreSQL. Lý do chọn SQL thay vì NoSQL: dữ liệu tài khoản, tin nhắn, metadata video đều có quan hệ rõ ràng (một tài khoản có nhiều tin nhắn, nhiều video) và cần ràng buộc toàn vẹn tham chiếu (foreign key) — phù hợp mô hình quan hệ hơn là document-based. PostgreSQL cụ thể được chọn vì tương thích trực tiếp với nền tảng kỹ thuật đã xây dựng từ trước.

- Indexing strategy cho bảng tin nhắn: composite index trên (conversation_id, created_at) để tối ưu truy vấn 'lấy lịch sử trò chuyện theo thứ tự thời gian' — đúng pattern truy vấn phổ biến nhất của Messaging Service, tránh full table scan khi số tin nhắn tăng lên.

- Schema chi tiết (bảng, cột, kiểu dữ liệu, khóa ngoại) được trình bày trong Database Design Document riêng, xây dựng sau khi SAD này được thông qua.

### 4.5. Redis

- Vai trò 1 — Pub/Sub cho Messaging Service: khi Backend chạy nhiều instance (mục 10.3), tin nhắn cần được đẩy tới đúng instance đang giữ kết nối WebSocket của người nhận; Redis Pub/Sub giải quyết bài toán này mà không cần các instance biết về nhau trực tiếp.

  Message mới chỉ được publish sau khi transaction database commit thành công, đến channel `messaging:user:{recipientUserId}` với event `{"type":"NEW_MESSAGE","data":{message response fields}}`. Redis Pub/Sub là kênh realtime best-effort: lỗi publish không rollback dữ liệu hay làm REST API thất bại; client đồng bộ lại qua message history khi reconnect. Transactional outbox chưa được triển khai trong P2-T15.

  Mỗi Backend instance thực hiện một static pattern subscription `messaging:user:*`. Khi nhận
  event, instance tách `userId` từ channel và chỉ fan-out tới các WebSocket session local của
  user đó. Vì mọi instance cùng subscribe pattern, event vẫn tới đúng instance dù REST request
  được xử lý ở instance khác. Subscriber lỗi không đóng socket; backend ghi log/metric, báo
  health `DEGRADED` và để Redis client tự reconnect.

  `TYPING`/`TYPING_STOP` là event tạm thời: Backend kiểm tra conversation active và membership,
  xác định user còn lại rồi publish cùng channel pattern để relay xuyên instance. Typing không
  lưu database, không replay và không gửi lại chính sender. Client gửi payload sai nhận
  `ERROR`; vi phạm lần thứ ba trong cùng connection bị đóng code 1008.

- Vai trò 2 — Token blacklist: lưu tạm các JWT đã bị thu hồi (đăng xuất) cho đến khi token hết hạn tự nhiên, tránh phải tra Database cho mỗi request.

### 4.6. STUN/TURN Server

- Vai trò: hỗ trợ NAT traversal cho kết nối WebRTC P2P giữa hai client.

- Lý do cần TURN (không chỉ STUN): khi cả hai phía nằm sau symmetric NAT, kết nối trực tiếp không thể thiết lập được; TURN đóng vai trò relay trung gian trong trường hợp đó — không phổ biến nhưng cần có để tránh cuộc gọi thất bại hoàn toàn ở một số mạng doanh nghiệp/di động.

- Lựa chọn cho MVP: dùng dịch vụ ngoài (ví dụ Xirsys, có gói miễn phí đủ cho quy mô demo đồ án) thay vì tự host coturn — giảm công sức vận hành hạ tầng cho một đồ án solo; cân nhắc tự host nếu chi phí dịch vụ ngoài vượt ngân sách khi mở rộng.

## 5. Luồng xử lý chính (Sequence Flows)

Trình bày dạng bảng bước-theo-bước thay vì sơ đồ UML, để đảm bảo độ chính xác và dễ đối chiếu khi cài đặt — mỗi bước ánh xạ trực tiếp tới một đoạn code/module cụ thể.

### 5.1. Luồng thiết lập cuộc gọi WebRTC

| **Bước** | **Thành phần**         | **Hành động**                                                                                                                                                                                                                                                              |
|----------|------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **1**    | Client A               | Tạo RTCPeerConnection, gọi createOffer(), gửi SDP offer tới Signaling Server qua WebSocket kèm JWT để xác thực danh tính (Signaling Server validate JWT trước khi relay — mục 4.2).                                                                                        |
| **1b**   | Signaling Server → Backend | Trước khi relay, Signaling Server gọi `POST /internal/call/notify` (chờ kết quả, timeout `CALL_NOTIFY_TIMEOUT_MS`) để Backend đẩy `CALL_INCOMING` cho B qua Messaging WebSocket — B thường **chưa** mở Signaling WebSocket lúc này, đây là cách duy nhất B biết có cuộc gọi đến (API mục 10.1, 10.3; P3-T04). Nếu thất bại (callee không hợp lệ, backend lỗi/timeout), Signaling Server báo `TARGET_OFFLINE` cho A và **không** relay SDP offer, bất kể B có kết nối Signaling WebSocket khác đang mở hay không. |
| **2**    | Signaling Server       | Nếu bước 1b thành công: relay SDP offer tới Client B nếu B tình cờ đã có kết nối Signaling WebSocket mở sẵn (ví dụ đang ở màn hình cuộc gọi khác); nếu chưa, B tự kết nối Signaling WebSocket sau khi nhận `CALL_INCOMING` rồi hai bên tiếp tục trao đổi SDP/ICE qua kênh đó. |
| **3**    | Client B               | Nhận offer, tạo answer, gửi SDP answer ngược lại qua Signaling Server.                                                                                                                                                                                                     |
| **3b**   | Client B → Backend API | B biết danh tính A từ offer vừa nhận. B gọi Backend API để lấy avatar metadata của A (model_url + customizations JSON — mục 4.1.2). B tải file GLB từ model_url trước khi kết nối P2P hoàn tất — đảm bảo Avatar Renderer có model sẵn sàng khi skeleton data đầu tiên đến. |
| **4**    | Cả hai Client          | Trao đổi ICE candidate qua Signaling Server cho đến khi tìm được đường kết nối khả dụng.                                                                                                                                                                                   |
| **5**    | Cả hai Client          | RTCPeerConnection chuyển trạng thái 'connected'; RTCDataChannel và audio track sẵn sàng.                                                                                                                                                                                   |
| **6**    | Cả hai Client          | Tracking Module bắt đầu gửi dữ liệu skeleton; Avatar Renderer hiển thị nhân vật ảo của cả hai bên (FR-14).                                                                                                                                                                 |

### 5.2. Luồng theo dõi → render một khung hình

*Luồng này gồm hai sub-flow chạy đồng thời trên hai thiết bị khác nhau. Ranh giới “GửI” (bước 1–5) xảy ra trên thiết bị người gửi; ranh giới “NHẬN” (bước 6) xảy ra trên thiết bị người nhận. Hai sub-flow không tuần tự — bước 6 bắt đầu khi bước 5 hoàn tất ở phía bên kia mạng.*

| **Bước** | **Thành phần**              | **Hành động**                                                                                 |
|----------|-----------------------------|-----------------------------------------------------------------------------------------------|
| **1**    | Webcam                      | Sinh khung hình mới, đưa vào Tracking Module qua getUserMedia().                              |
| **2**    | MediaPipe                   | Trích xuất landmark khuôn mặt/tay/thân từ khung hình.                                         |
| **3**    | Motion Processor            | Cập nhật tracking-loss state; lọc segment direction khi có sample mới.                        |
| **4**    | Arm Retargeting Solver      | Tính target world, parent-local target và rest-relative delta theo parent → child; optional constraint trên delta. |
| **5**    | Communication Module        | — GỬI — Đóng gói `AvatarPosePacketV1`, gửi qua RTCDataChannel; không gửi raw landmarks.       |
| **6**    | Avatar Renderer (phía nhận) | — NHẬN — Tái tạo `restLocal × deltaLocal`, áp normalized bone/morph target và render canvas. |

### 5.3. Luồng xác thực

| **Bước** | **Thành phần**         | **Hành động**                                                                                                      |
|----------|------------------------|--------------------------------------------------------------------------------------------------------------------|
| **1**    | Client                 | Gửi email/mật khẩu tới Backend qua HTTPS POST /auth/login.                                                         |
| **2**    | Authentication Service | Xác minh mật khẩu (so khớp hash bcrypt/argon2), nếu đúng thì issue JWT (access + refresh token).                   |
| **3**    | Client                 | Lưu token, đính kèm access token vào header Authorization của các request tiếp theo.                               |
| **4**    | Backend (mọi request)  | Filter xác thực validate token trước khi cho request đi tới Controller; từ chối nếu token không hợp lệ/hết hạn.    |
| **5**    | Client                 | Khi access token hết hạn, dùng refresh token gọi /auth/refresh để lấy access token mới mà không cần đăng nhập lại. |

### 5.4. Luồng gửi tin nhắn khi người nhận ngoại tuyến

| **Bước** | **Thành phần**    | **Hành động**                                                                                                                                            |
|----------|-------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------|
| **1**    | Client A          | Gửi tin nhắn (kèm ID duy nhất) tới Messaging Service qua WebSocket/REST.                                                                                 |
| **2**    | Messaging Service | Lưu tin nhắn vào Database, đánh dấu trạng thái 'đã lưu, chưa gửi tới B' vì B đang ngoại tuyến.                                                           |
| **3**    | Client B          | Đăng nhập trở lại, mở kết nối WebSocket mới.                                                                                                             |
| **4**    | Messaging Service | Phát hiện B trực tuyến (qua Redis Pub/Sub nếu B kết nối tới instance Backend khác A), đẩy các tin nhắn đang chờ theo đúng thứ tự thời gian gửi (NFR-25). |
| **5**    | Client B          | Nhận và hiển thị tin nhắn; gửi xác nhận đã nhận về Messaging Service.                                                                                    |

### 5.5. Luồng kết nối lại khi mất mạng

| **Bước** | **Thành phần**          | **Hành động**                                                                                       |
|----------|-------------------------|-----------------------------------------------------------------------------------------------------|
| **1**    | Communication Module    | Phát hiện RTCPeerConnection chuyển trạng thái ICE 'disconnected'.                                   |
| **2**    | Avatar Renderer         | Giữ nguyên tư thế avatar tại thời điểm mất kết nối, không đóng băng hay hiển thị lỗi ngay lập tức.  |
| **3**    | Communication Module    | Thử thiết lập lại kết nối ICE (ICE restart) trong vòng 5 giây.                                      |
| **4a**   | Nếu thành công          | Kết nối khôi phục, tracking/render tiếp tục bình thường, không cần người dùng thao tác gì (NFR-14). |
| **4b**   | Nếu thất bại sau 5 giây | Hệ thống thông báo rõ cho người dùng và đề nghị thiết lập lại cuộc gọi từ đầu (NFR-23).             |

### 5.6. Luồng tìm kiếm người dùng và bắt đầu trò chuyện lần đầu (UC-05/FR-22)

| **Bước** | **Thành phần**                    | **Hành động**                                                                                                                                                                                                                   |
|----------|-----------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **1**    | Client A                          | Gửi request POST /api/users/search kèm email cần tìm và JWT trong header — xác thực danh tính người tìm kiếm.                                                                                                                   |
| **2**    | User Discovery Service            | Kiểm tra rate limit (10 req/phút/tài khoản — Redis counter). Nếu vượt ngưỡng: trả 429, kết thúc luồng.                                                                                                                          |
| **3**    | User Discovery Service → Database | Tra cứu users WHERE email = \$1 AND deleted_at IS NULL dùng idx_users_email. Nếu không có kết quả hoặc user chưa bật discoverable: trả response trung lập “Không tìm thấy” — không phân biệt hai trường hợp (anti-enumeration). |
| **4**    | Client A                          | Nhận kết quả: tên hiển thị của B. A bấm “Nhắn tin” — gửi request tạo hoặc lấy conversation_id cho cặp (A, B).                                                                                                                   |
| **5**    | Messaging Service → Database      | INSERT INTO conversations ... ON CONFLICT DO NOTHING (dùng idx_conv_pair) — đảm bảo mỗi cặp (A,B) chỉ có đúng một conversation. Trả về conversation_id cho Client A.                                                            |
| **6**    | Client A                          | Chuyển vào màn hình trò chuyện với conversation_id vừa tạo. Luồng tiếp theo là luồng nhắn tin thông thường (luồng 5.4 nếu B ngoại tuyến).                                                                                       |

## 6. Technology Stack

| **Tầng**          | **Công nghệ**         | **Lý do chọn**                                                           | **Đánh đổi chấp nhận**                                                 |
|-------------------|-----------------------|--------------------------------------------------------------------------|------------------------------------------------------------------------|
| **Tracking**      | MediaPipe             | Chạy được trên trình duyệt, không cần server, có model tay/thân/mặt sẵn  | Phụ thuộc Google duy trì thư viện                                      |
| **Render 3D**     | Three.js              | Hệ sinh thái rộng, hỗ trợ GLB/morph target tốt                           | Nặng hơn Babylon.js một chút                                           |
| **Signaling**     | Node.js + ws          | Đơn giản, đủ cho MVP, tách độc lập khỏi Backend                          | Cần thêm việc nếu scale lớn                                            |
| **Backend**       | Spring Boot (Java 21) | Tận dụng nền tảng kỹ thuật đã có, hệ sinh thái Security/JPA trưởng thành | Khởi động chậm hơn Node/FastAPI vài giây                               |
| **Database**      | PostgreSQL            | Dữ liệu có quan hệ rõ ràng, nhất quán với nền tảng kỹ thuật đã có        | Cần thêm công sức nếu sau này cần horizontal sharding                  |
| **Cache/Pub-Sub** | Redis                 | Giải quyết bài toán đẩy tin nhắn đúng instance khi scale ngang           | Thêm một thành phần hạ tầng cần vận hành                               |
| **Auth**          | JWT                   | Stateless, phù hợp kiến trúc REST, không cần session lưu server          | Không revoke được tức thời nếu không có blacklist (đã xử lý qua Redis) |

## 7. Service Level Objectives (SLO)

Tổng hợp từ NFR trong SRS thành cam kết đo được cụ thể. Bảng SLO định nghĩa cả mức mục tiêu (target) lẫn ngưỡng cảnh báo (alert threshold) — khi vượt alert threshold nhưng chưa vi phạm target là dấu hiệu cần điều tra sớm trước khi SLO bị vi phạm.

| **Chỉ số**                        | **Mục tiêu** | **Đo bằng cách nào**                                                                                                                                                                                                                                                                                                                          |
|-----------------------------------|--------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Tracking-to-render latency**    | \< 100ms     | performance.now() trước và sau pipeline xử lý mỗi khung hình                                                                                                                                                                                                                                                                                  |
| **Frame rate**                    | ≥ 24fps      | Bộ đếm khung hình tích hợp trong Avatar Renderer, lấy trung bình mỗi giây                                                                                                                                                                                                                                                                     |
| **End-to-end call latency**       | \< 400ms     | RTCPeerConnection.getStats() — đo round-trip time                                                                                                                                                                                                                                                                                             |
| **WebRTC setup time**             | \< 5 giây    | Khoảng cách thời gian từ lúc gửi offer đến khi ICE chuyển 'connected'                                                                                                                                                                                                                                                                         |
| **Message delivery (online)**     | \< 2 giây    | So sánh timestamp gửi (client A) và timestamp nhận (client B)                                                                                                                                                                                                                                                                                 |
| **Uptime MVP (giai đoạn demo)**   | ≥ 95%        | Theo dõi thủ công/script kiểm tra định kỳ trong thời gian bảo vệ đồ án                                                                                                                                                                                                                                                                        |
| **Thời gian khôi phục sau sự cố** | \< 30 phút   | Theo quy trình xử lý sự cố cá nhân, ghi nhận trong nhật ký vận hành                                                                                                                                                                                                                                                                           |
| **API Error Rate**                | ≤ 1% (5xx)   | Tỉ lệ response HTTP 5xx trên tổng request trong cửa sổ 5 phút gần nhất — đo qua Spring Boot Actuator + Micrometer metrics; alert threshold: \> 0.5% trong 2 phút liên tiếp.                                                                                                                                                                   |
| **Tracking latency p95**          | \< 150ms     | Percentile 95 của tracking-to-render latency — nghĩa là 95% khung hình đạt dưới 150ms, cho phép tối đa 5% khung hình vượt ngưỡng do spike ngắn. Bổ sung cho chỉ số trung bình ở dòng đầu bảng. Alert threshold: p95 \> 120ms kéo dài trên 30 giây liên tiếp — dấu hiệu thiết bị người dùng đang bị quá tải hoặc có bottleneck trong pipeline. |
| **WebRTC call success rate**      | ≥ 90%        | Tỉ lệ cuộc gọi thiết lập thành công (ICE connected) trên tổng số cuộc gọi được khởi tạo — đo qua log signaling server; 10% thất bại được chấp nhận vì một số mạng NAT phức tạp không hỗ trợ WebRTC P2P tốt.                                                                                                                                   |

### 7.2. Error Budget

Error Budget là lượng vi phạm SLO được phép trước khi cần hành động khẩn cấp. Ở quy mô MVP với thời gian demo khoảng 1 tuần (168 giờ), error budget cho từng SLO quan trọng nhất:

| **SLO**                 | **Mục tiêu**   | **Error Budget (1 tuần demo)** | **Hành động khi hết budget**                                              |
|-------------------------|----------------|--------------------------------|---------------------------------------------------------------------------|
| **Uptime ≥ 95%**        | 5% downtime    | 8.4 giờ / tuần                 | Ưu tiên ổn định hơn tính năng mới, dừng deploy cho đến khi uptime ổn định |
| **API Error Rate ≤ 1%** | 1% request lỗi | Tùy khối lượng request thực tế | Điều tra và fix ngay — error rate tăng thường báo hiệu lỗi hệ thống thật  |

## 8. Capacity Planning

### 8.1. Ước tính băng thông

Bản tính lại chính xác đơn vị (bản nháp trước nhầm kb với KB, khiến số liệu bị thổi phồng gần gấp đôi):

- Audio Opus thoại: ~32 kbps = 4KB/s mỗi chiều.

- Skeleton JSON: ~5KB/s mỗi chiều (ước tính cho JSON nén gọn, gửi mỗi khung hình hợp lệ).

- Băng thông một cuộc gọi (P2P, hai chiều): (4 + 5) KB/s × 2 chiều = 18KB/s.

*Điểm quan trọng cần nhấn mạnh lại: toàn bộ 18KB/s này truyền trực tiếp giữa hai trình duyệt qua kết nối P2P, không đi qua Signaling Server hay Backend. Băng thông của Signaling Server chỉ đến từ việc trao đổi SDP offer/answer và ICE candidate lúc thiết lập cuộc gọi — tổng dung lượng một lần thiết lập thường dưới 10KB, xảy ra một lần khi bắt đầu cuộc gọi, không phải một luồng liên tục theo giây. Với 10 cuộc gọi được thiết lập trong một khung thời gian demo, tải thực tế lên Signaling Server ở mức không đáng kể (dưới 100KB tổng cộng cho cả 10 lần thiết lập), khác hẳn cách tính ban đầu nhầm lẫn với băng thông cuộc gọi.*

### 8.2. Ước tính tải MVP

- Số người dùng đồng thời khi demo: 10–20 người → 5–10 cuộc gọi song song.

- Tổng băng thông P2P toàn hệ thống (không qua server): 10 cuộc gọi × 18KB/s ≈ 180KB/s — vẫn rất nhỏ, nhưng đây là tải của kết nối giữa các client với nhau, không phải tải server.

- Tải thực sự lên Backend: chỉ gồm REST API (xác thực, lấy lịch sử tin nhắn) và WebSocket messaging — ở quy mô 10-20 người dùng, không đáng kể.

### 8.3. Ước tính lưu trữ

- Video storage: tối đa 2GB/tài khoản (NFR-19) × số tài khoản trong phạm vi demo.

- Database messages: dung lượng nhỏ, không đáng kể ở quy mô MVP.

- Tốc độ tăng trưởng dài hạn: không áp dụng trong phạm vi MVP, để ngoài phạm vi đồ án theo đúng SRS mục 8.2.

### 8.4. Yêu cầu phần cứng server tối thiểu

| **Thành phần**            | **Cấu hình tối thiểu**       | **Lý do**                                                                                                                                                                                                                                               |
|---------------------------|------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Signaling Server**      | 1 CPU, 512MB RAM             | Chỉ relay message nhẹ, không xử lý tính toán                                                                                                                                                                                                            |
| **Backend (Spring Boot)** | 1 CPU, 1GB RAM               | Xử lý nặng đã đẩy xuống client; backend chỉ làm CRUD và xác thực                                                                                                                                                                                        |
| **Redis**                 | 1 CPU, 256MB RAM             | Dữ liệu tạm thời, dung lượng nhỏ ở quy mô MVP                                                                                                                                                                                                           |
| **PostgreSQL**            | 1 CPU, 512MB RAM (tối thiểu) | shared_buffers khuyến nghị 25% RAM (128MB với 512MB total). Đây là thành phần nặng RAM nhất trong stack — tổng RAM VPS cần tối thiểu 2.5GB khi chạy đủ 4 service (Signaling 512MB + Backend 1GB + Redis 256MB + PostgreSQL 512MB = 2.28GB + buffer OS). |

### 8.5. Scaling Trigger — Khi nào cần mở rộng

Bảng dưới đây định nghĩa ngưỡng quan sát cụ thể khi hệ thống cần thêm tài nguyên — thay vì mô tả "có thể scale khi cần" theo kiểu lý thuyết. Đây là thông tin thực tế hơn cho người vận hành MVP.

| **Chỉ số quan sát**    | **Ngưỡng cần hành động**                           | **Hành động cụ thể**                                                                                                                                                    |
|------------------------|----------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **CPU Backend**        | \> 80% trong 5 phút liên tục                       | Tăng CPU VPS hoặc thêm 1 instance Backend sau load balancer (stateless theo JWT nên không cần cấu hình đặc biệt).                                                       |
| **RAM Backend**        | \> 80% heap trong 10 phút                          | Kiểm tra heap dump tìm memory leak trước khi tăng RAM — GC có thể là nguyên nhân, không phải thiếu RAM thật sự.                                                         |
| **DB connection pool** | Pool thường xuyên hết connection (queue wait \> 0) | Tăng maximumPoolSize của HikariCP và đồng thời tăng max_connections của PostgreSQL tương ứng; kiểm tra có query chậm giữ connection lâu không trước khi tăng pool size. |
| **Storage video**      | \> 70% dung lượng volume                           | Mở rộng volume VPS hoặc chuyển sang object storage (S3-compatible) tách khỏi VPS chính để không ảnh hưởng các service khác khi storage đầy.                             |

## 9. Bảo mật kiến trúc

### 9.1. Defense in depth

Các lớp bảo vệ từ ngoài vào trong: HSTS (buộc trình duyệt dùng HTTPS, tránh downgrade attack) → HTTPS + CORS policy (mã hóa kênh truyền; CORS chỉ cho phép origin của client domain — bắt buộc vì client, backend, signaling có thể ở domain/port khác nhau, NFR-32) → JWT (xác thực danh tính) → Rate limiting (bảo vệ endpoint tìm kiếm và Signaling WebSocket) → input validation (chặn dữ liệu độc hại) → on-device processing (giới hạn phạm vi dữ liệu nhạy cảm tồn tại).

### 9.2. Data flow security

| **Loại dữ liệu**              | **Đường đi**                          | **Bảo vệ bằng**                                       |
|-------------------------------|---------------------------------------|-------------------------------------------------------|
| **Khuôn mặt thật (hình ảnh)** | Chỉ tồn tại trong RAM trình duyệt     | Không truyền đi dưới bất kỳ hình thức nào (NFR-06)    |
| **Skeleton/blendshape data**  | RTCDataChannel, P2P giữa hai client   | Mã hóa DTLS-SRTP (chuẩn WebRTC)                       |
| **Audio**                     | MediaStreamTrack, P2P giữa hai client | Mã hóa DTLS-SRTP (chuẩn WebRTC)                       |
| **Tin nhắn văn bản**          | HTTPS/WebSocket tới Backend           | TLS trên kênh truyền, lưu trữ tại Database            |
| **Mật khẩu**                  | HTTPS tới Backend, một chiều          | Băm bcrypt/argon2 trước khi lưu, không lưu dạng thuần |

### 9.3. Threat summary

Thay vì chỉ liệt kê tên mối đe dọa và đẩy sang một tài liệu riêng chưa tồn tại, bảng dưới đây nêu cụ thể biện pháp đối phó đã được tích hợp ngay trong kiến trúc — đủ để trả lời trực tiếp khi được hỏi, không cần chờ tài liệu khác:

| **Mối đe dọa**                                             | **Biện pháp đối phó đã áp dụng trong kiến trúc**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
|------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Giả mạo danh tính (impersonation)**                      | JWT ký bằng khóa bí mật phía server; access token có thời hạn ngắn, refresh token riêng để gia hạn có kiểm soát.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Đánh cắp token (token theft qua XSS/MITM)**              | Toàn bộ kênh truyền bắt buộc HTTPS; access token truyền qua Authorization: Bearer header (không localStorage) Toàn bộ kênh truyền bắt buộc HTTPS; token không lưu trong localStorage dễ bị XSS đọc mà dùng cookie HttpOnly khi khả thi; revoke tức thời qua blacklist Redis khi phát hiện bất thường.#x2014; lựa chọn này nhất quán với WebSocket auth dùng query param vì WebSocket không hỗ trợ header tùy chỉnh trong handshake; thời hạn ngắn 15 phút giới hạn thiệt hại nếu token bị lộ; revoke tức thời qua blacklist Redis. |
| **SQL Injection / NoSQL Injection**                        | Dùng Spring Data JPA với parameterized query qua thiết kế mặc định, không nối chuỗi SQL thủ công; input validation ở tầng Controller trước khi tới Service.                                                                                                                                                                                                                                                                                                                                                                        |
| **Lộ khuôn mặt thật qua kênh không mong muốn**             | Kiến trúc loại bỏ khả năng này từ gốc — không có MediaStreamTrack video khuôn mặt được tạo ra ở bất kỳ đâu trong Communication Module (ADR-01), nên không có kênh nào để lộ dù server hay client có bị xâm nhập.                                                                                                                                                                                                                                                                                                                   |
| **Nghe lén luồng audio/skeleton giữa hai client**          | Bắt buộc DTLS-SRTP theo chuẩn WebRTC cho mọi kết nối P2P, không có đường vòng truyền không mã hóa.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Truy cập trái phép dữ liệu người dùng từ phía vận hành** | Role-based access control cho tài khoản quản trị (NFR-29), mọi lần truy cập dữ liệu nhạy cảm được ghi log riêng để truy vết sau này.                                                                                                                                                                                                                                                                                                                                                                                               |
| **Tấn công từ chối dịch vụ (DoS) vào Signaling Server**    | Giới hạn tốc độ (rate limiting) số lượng kết nối WebSocket mới từ một địa chỉ IP trong một khoảng thời gian; timeout dọn dẹp phiên treo (mục 4.2).                                                                                                                                                                                                                                                                                                                                                                                 |

*Bảng trên đặc tả biện pháp đối phó cho từng mối đe dọa cụ thể. Mục 9.4 dưới đây bổ sung phân tích theo khung STRIDE để đảm bảo không bỏ sót nhóm mối đe dọa nào.*

### 9.4. STRIDE Threat Model

STRIDE là khung phân tích mối đe dọa của Microsoft — mỗi chữ cái đại diện một loại tấn công: Spoofing (giả mạo danh tính), Tampering (giả mạo dữ liệu), Repudiation (phủ nhận hành động), Information Disclosure (lộ thông tin), Denial of Service (từ chối dịch vụ), Elevation of Privilege (leo thang đặc quyền). Bảng dưới đây áp dụng STRIDE cho các tài sản cần bảo vệ quan trọng nhất của VeilTalk.

| **STRIDE**                     | **Tài sản / Bề mặt tấn công**                        | **Kịch bản tấn công**                                                                                                                                                                                                                      | **Biện pháp đối phó trong kiến trúc**                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
|--------------------------------|------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **S — Spoofing**               | JWT token, định danh người dùng                      | Kẻ tấn công dùng token đánh cắp được để mạo danh người dùng hợp lệ, truy cập tin nhắn hoặc tham gia cuộc gọi thay người đó.                                                                                                                | JWT access token thời hạn ngắn (15 phút) truyền qua Authorization: Bearer header JWT access token thời hạn ngắn + refresh token riêng; cookie HttpOnly ngăn XSS đọc token; revoke qua Redis blacklist khi phát hiện bất thường (mục 4.5).#x2014; nhất quán với WebSocket auth dùng query param; refresh token (7 ngày) lưu phía client; revoke qua Redis blacklist TTL khi phát hiện bất thường (mục 4.5). Không dùng cookie HttpOnly vì WebSocket handshake không hỗ trợ cookie theo cùng cách HTTP request. |
| **T — Tampering**              | Skeleton data trên RTCDataChannel, tin nhắn trên API | Kẻ tấn công MITM chặn và sửa dữ liệu skeleton đang truyền giữa hai client, khiến nhân vật ảo của một bên hiển thị cử chỉ/biểu cảm bị giả mạo.                                                                                              | DTLS-SRTP mã hóa và xác thực tính toàn vẹn dữ liệu trên WebRTC DataChannel; sửa dữ liệu khi đang truyền sẽ bị phát hiện và gói tin bị loại bỏ.                                                                                                                                                                                                                                                                                                                                                                |
| **R — Repudiation**            | Hành động quản trị, lịch sử tin nhắn                 | Quản trị viên phủ nhận việc đã truy cập dữ liệu người dùng; người dùng phủ nhận đã gửi tin nhắn gây hại.                                                                                                                                   | Log riêng cho hành động quản trị (NFR-29); tin nhắn lưu kèm timestamp và user_id người gửi không thể chỉnh sửa sau khi lưu.                                                                                                                                                                                                                                                                                                                                                                                   |
| **I — Info Disclosure**        | Khuôn mặt thật, email, nội dung tin nhắn             | Lộ ảnh khuôn mặt thật qua kênh không mong muốn; lộ email/nội dung tin nhắn khi database bị xâm phạm hoặc kênh truyền bị nghe lén.                                                                                                          | On-device processing loại bỏ hoàn toàn kênh lộ khuôn mặt (ADR-01); DTLS-SRTP mã hóa kênh truyền; HTTPS toàn hệ thống; mật khẩu băm bcrypt/argon2 (NFR-07).                                                                                                                                                                                                                                                                                                                                                    |
| **D — Denial of Service**      | Signaling Server, Backend API, Media Storage         | Flood kết nối WebSocket vào Signaling Server; spam API request làm cạn kiệt connection pool; upload video liên tục chiếm hết storage; brute-force endpoint tìm kiếm người dùng (FR-22) để liệt kê email tồn tại dù đã có anti-enumeration. | Rate limiting trên Signaling Server (mục 4.2); giới hạn 2GB/tài khoản cho storage (NFR-19); connection pool HikariCP giới hạn tổng số connection DB; timeout dọn dẹp phiên treo; rate limiting 10 req/phút trên endpoint FR-22 (mục 4.3 User Discovery Service) — response trung lập cho cả hai trường hợp không tìm thấy/chưa bật discoverable.                                                                                                                                                              |
| **E — Elevation of Privilege** | Phân quyền user vs. admin, API endpoints             | Người dùng thường gọi trực tiếp endpoint chỉ dành cho admin; khai thác lỗ hổng để đọc tin nhắn của người dùng khác hoặc xóa tài khoản không phải của mình.                                                                                 | Role-based access control (NFR-29): JWT claim phân biệt user/admin; mọi endpoint kiểm tra ownership (chỉ được đọc/xóa dữ liệu của chính mình); Spring Security filter chain chặn trước khi vào Controller (mục 4.3).                                                                                                                                                                                                                                                                                          |

## 10. Deployment Architecture

### 10.1. Sơ đồ triển khai MVP

Tất cả thành phần (Signaling Server, Backend Spring Boot, PostgreSQL, Redis) triển khai trên một VPS duy nhất cho giai đoạn demo đồ án, dùng Docker Compose để quản lý vòng đời từng container. STUN/TURN dùng dịch vụ ngoài (mục 4.6), không tự host trong phạm vi MVP.

Phác thảo cấu trúc docker-compose (đặc tả đầy đủ thuộc về Deployment Guide riêng):

| **Service**       | **Image/Build**                    | **Volume**                           | **Network**  |
|-------------------|------------------------------------|--------------------------------------|--------------|
| **backend**       | Build từ Dockerfile (Spring Boot)  | Không cần volume riêng (stateless)   | internal-net |
| **signaling**     | Build từ Dockerfile (Node.js + ws) | Không cần volume riêng (stateless)   | internal-net |
| **postgres**      | postgres:16                        | pgdata:/var/lib/postgresql/data      | internal-net |
| **redis**         | redis:7                            | Không bắt buộc cho MVP (dữ liệu tạm) | internal-net |
| **media-storage** | Thư mục mount hoặc service riêng   | video-data:/app/storage              | internal-net |

- Mạng nội bộ internal-net cô lập các service backend khỏi truy cập trực tiếp từ ngoài; chỉ backend và signaling expose port ra ngoài qua reverse proxy (Nginx) xử lý HTTPS.

- Volume pgdata đảm bảo dữ liệu PostgreSQL không mất khi container restart/redeploy; volume video-data tương tự cho file video đã quay.

### 10.2. Biến môi trường cần cấu hình

- DATABASE_URL — chuỗi kết nối PostgreSQL.

- JWT_SECRET — khóa ký JWT, không hardcode trong mã nguồn.

- REDIS_URL — chuỗi kết nối Redis.

- TURN_USERNAME, TURN_CREDENTIAL — thông tin xác thực dịch vụ TURN ngoài.

- MEDIA_STORAGE_PATH — đường dẫn/endpoint lưu trữ file video.

### 10.3. Hướng mở rộng theo chiều ngang (Horizontal Scaling Path)

- Backend API: stateless theo thiết kế JWT — mở rộng đơn giản bằng cách thêm instance phía sau load balancer, không cần cấu hình đặc biệt.

- Signaling Server: dùng kết nối WebSocket có trạng thái (stateful) — khi scale ngang, cần sticky session ở load balancer (định tuyến cùng client về cùng instance) hoặc chuyển sang cơ chế pub/sub (đã chuẩn bị sẵn Redis cho việc này ở mục 4.5, có thể mở rộng áp dụng tương tự cho Signaling Server nếu cần).

## 11. Các quyết định kiến trúc quan trọng (ADR)

ADR-01 — Truyền skeleton data thay vì video stream

Quyết định: truyền hệ số blendshape và góc khớp qua RTCDataChannel thay vì tạo MediaStreamTrack video chứa khuôn mặt thật.

Lý do: bảo mật/riêng tư (NFR-06), giảm băng thông đáng kể so với truyền video thô, không cần xử lý codec video.

Đánh đổi: phải tự đồng bộ hóa thủ công giữa audio track và skeleton data ở phía nhận (hai luồng độc lập, không có cơ chế đồng bộ sẵn như khi cùng nằm trong một video track).

Cơ chế lip-sync cụ thể (đáp ứng NFR-13 ≤ 120ms): mỗi gói skeleton JSON được đính kèm trường ts (performance.now() phía gửi, độ chính xác millisecond). Phía nhận duy trì một jitter buffer nhỏ (~50ms) chứa các gói skeleton theo thứ tự ts. Renderer đọc từ buffer và render gói có ts gần nhất với timestamp audio hiện tại (lấy từ Web Audio API currentTime). Nếu ts skeleton lệch quá 120ms so với audio, Renderer bỏ qua gói đó và giữ frame trước — thay vì render không đồng bộ. Jitter buffer 50ms hấp thụ network jitter thông thường mà vẫn đảm bảo tổng độ trễ nằm trong ngưỡng 120ms yêu cầu.

ADR-02 — Theo dõi (tracking) chạy trên thiết bị (on-device)

Quyết định: toàn bộ MediaPipe pipeline chạy trên trình duyệt, không gửi khung hình lên server xử lý.

Lý do: privacy by design, giảm tải tính toán cho server, độ trễ thấp hơn do không có vòng round-trip mạng cho từng khung hình.

Đánh đổi: hiệu năng theo dõi phụ thuộc trực tiếp vào thiết bị người dùng — máy yếu có thể không đạt 24fps mục tiêu.

ADR-03 — Three.js cho render 3D

Quyết định: dùng Three.js thay vì Babylon.js hoặc PlayCanvas cho Avatar Renderer.

Lý do: hỗ trợ GLB/GLTF với morph target trưởng thành nhất trong ba lựa chọn, tài liệu và ví dụ cộng đồng phong phú — quan trọng với một người tự làm không có team hỗ trợ khi gặp vướng mắc.

Đánh đổi: bundle size lớn hơn Babylon.js cho cùng tác vụ, chấp nhận được vì ứng dụng không nhạy cảm về thời gian tải trang ở mức độ đó.

ADR-04 — Modular monolith thay vì microservices cho Backend

Quyết định: Backend triển khai như một ứng dụng Spring Boot duy nhất, tổ chức nội bộ theo module domain (Auth, Messaging, Media) thay vì tách thành các service độc lập.

Lý do: backend chỉ có 3 trách nhiệm nghiệp vụ, một người phát triển, không cần scale độc lập từng phần ở quy mô MVP — tách microservices sẽ tạo chi phí vận hành (nhiều pipeline deploy, giao tiếp giữa service, theo dõi phân tán) vượt xa lợi ích thu được.

Đánh đổi: nếu một module sau này cần tải tính toán vượt trội hẳn so với các module còn lại (ví dụ Media Storage Service nếu lượng video tăng đột biến), sẽ cần tách riêng — module hóa rõ ràng ngay từ đầu giúp việc tách sau này (nếu cần) không phải viết lại từ đầu.

ADR-05 — PostgreSQL thay vì NoSQL cho Database

Quyết định: dùng PostgreSQL làm cơ sở dữ liệu chính cho toàn bộ dữ liệu có cấu trúc (tài khoản, tin nhắn, metadata video).

Lý do: dữ liệu có quan hệ rõ ràng (một tài khoản — nhiều tin nhắn, nhiều video) cần ràng buộc toàn vẹn tham chiếu; nhất quán với nền tảng kỹ thuật đã xây dựng từ trước, giảm chi phí học công nghệ mới.

Đánh đổi: nếu sau này cần lưu dữ liệu phi cấu trúc quy mô lớn (ví dụ log chi tiết từng khung hình theo dõi cho mục đích phân tích), có thể cần bổ sung một kho dữ liệu khác chuyên biệt — không thuộc phạm vi MVP.

*— Hết tài liệu —*
