# VeilTalk

> Giao tiếp tự nhiên qua nhân vật ảo 3D mà không để lộ khuôn mặt thật.

VeilTalk là ứng dụng web nhắn tin, gọi video 1-1 và quay video thông qua avatar 3D. Webcam chỉ được dùng để nhận diện biểu cảm, bàn tay và tư thế ngay trong trình duyệt; hình ảnh khuôn mặt thật không được gửi lên máy chủ hoặc sang thiết bị khác.

Đây là đồ án tốt nghiệp đang trong quá trình phát triển. Tài liệu thiết kế được xây dựng trước khi cài đặt và là nguồn tham chiếu chính của dự án.

## Bài toán VeilTalk giải quyết

Các ứng dụng gọi video thông thường buộc người dùng lựa chọn giữa việc bật camera và để lộ ngoại hình, hoặc tắt camera và mất phần lớn tín hiệu phi ngôn ngữ. VeilTalk bổ sung lựa chọn thứ ba: truyền tải biểu cảm và cử chỉ qua một nhân vật ảo, trong khi hình ảnh thật vẫn nằm trên thiết bị của người dùng.

## Điểm nổi bật

- Theo dõi khuôn mặt, bàn tay và tư thế theo thời gian thực bằng MediaPipe Tasks.
- Ánh xạ chuyển động lên mô hình VRM và dựng hình 3D bằng Three.js.
- Gọi 1-1 qua WebRTC với audio và dữ liệu chuyển động dạng skeleton.
- Nhắn tin thời gian thực qua WebSocket.
- Chọn và tùy chỉnh avatar đại diện.
- Quay lại canvas avatar thay vì ghi hình webcam thật.
- Lưu metadata trong PostgreSQL, dùng Redis cho cache/Pub-Sub và MinIO cho media.
- Thiết kế chống dò tài khoản, xóa mềm và mặc định không cho tìm kiếm bằng email.

## Riêng tư ngay từ thiết kế

Nguyên tắc cốt lõi của VeilTalk là **khuôn mặt thật không rời khỏi trình duyệt**.

```text
Webcam
  └─> MediaPipe chạy trên trình duyệt
        ├─> Avatar Renderer ─> Canvas 3D
        └─> Skeleton data ───────────────> Người nhận

Microphone ─────────────────────────────> Người nhận

Ảnh/video webcam thật ──X──> Server hoặc người nhận
```

Tracking và render được thực hiện hoàn toàn phía client. Trong cuộc gọi, hai trình duyệt trao đổi audio và skeleton data qua kết nối WebRTC ngang hàng; backend và signaling server chỉ hỗ trợ xác thực, nhắn tin, lưu trữ và thiết lập kết nối.

## Kiến trúc tổng quan

VeilTalk sử dụng kiến trúc client-heavy kết hợp backend modular monolith:

| Thành phần | Vai trò |
|---|---|
| Frontend | Giao diện React, MediaPipe tracking, render avatar và WebRTC client |
| Backend API | Xác thực, người dùng, avatar, hội thoại, tin nhắn và video metadata |
| Signaling Server | Chuyển tiếp SDP/ICE để thiết lập cuộc gọi WebRTC |
| PostgreSQL | Lưu dữ liệu nghiệp vụ |
| Redis | Cache, rate limit và Pub/Sub cho kết nối thời gian thực |
| MinIO | Lưu trữ video theo giao thức S3-compatible |
| Nginx | Reverse proxy cho các dịch vụ khi triển khai |

Backend được tổ chức theo tính năng (`auth`, `avatar`, `messaging`, `video`) thay vì chia package theo tầng kỹ thuật.

## Công nghệ sử dụng

| Tầng | Công nghệ |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS, Zustand |
| 3D & tracking | Three.js, `@pixiv/three-vrm`, MediaPipe Tasks Vision |
| Backend | Java 21, Spring Boot 3.5, Spring Security, Spring Data JPA |
| Signaling | Node.js, WebSocket (`ws`), JWT |
| Database | PostgreSQL 16, Flyway |
| Cache & Pub/Sub | Redis 7 |
| Media storage | MinIO |
| Realtime | WebRTC, WebSocket |
| Hạ tầng | Docker Compose, Nginx |

## Trạng thái phát triển

Dự án đã hoàn thành phần thiết lập nền tảng, database, backend API và signaling server theo roadmap. Frontend đang được phát triển trong Phase 4; pipeline tracking và render avatar thuộc P4-T10 vẫn đang được hoàn thiện và kiểm thử bằng webcam.

Các chức năng được mô tả trong README thể hiện phạm vi MVP. Một số màn hình và luồng tích hợp đầu-cuối chưa hoàn thành. Trạng thái chi tiết, tiêu chí nghiệm thu và quan hệ phụ thuộc của từng task nằm trong [`docs/09_ROADMAP_AND_TASKS.md`](docs/09_ROADMAP_AND_TASKS.md).

## Cấu trúc repository

```text
veiltalk/
├── backend/             # Spring Boot REST API và Messaging WebSocket
├── signaling/           # WebSocket relay cho WebRTC signaling
├── frontend/            # React, tracking, avatar renderer và giao diện
├── infra/               # Cấu hình hạ tầng bổ sung
├── docs/                # Tài liệu yêu cầu, thiết kế, test và vận hành
├── docker-compose.yml   # Định nghĩa các service của hệ thống
└── .env.example         # Mẫu biến môi trường, không chứa secret thật
```

## Chạy môi trường phát triển

### Yêu cầu

- Java 21
- Node.js 20 trở lên và npm
- Docker Engine 24 trở lên
- Docker Compose 2.20 trở lên

### 1. Lấy mã nguồn và cấu hình môi trường

```bash
git clone https://github.com/PhuongPhuong-1510/veiltalk.git
cd veiltalk
cp .env.example .env
```

Điền các giá trị trong `.env`, đặc biệt là mật khẩu PostgreSQL/MinIO, `JWT_SECRET`, `SIGNALING_JWT_SECRET` và `MINIO_WEBHOOK_SECRET`. Không commit file `.env` hoặc secret thật lên repository.

Có thể tạo JWT secret bằng:

```bash
openssl rand -hex 32
```

`JWT_SECRET` và `SIGNALING_JWT_SECRET` phải dùng cùng giá trị.

### 2. Khởi động các dịch vụ nền tảng

```bash
docker compose up -d postgres redis minio
docker compose ps
```

MinIO Console chạy tại `http://localhost:9001`. Bucket và webhook cần được cấu hình theo [`docs/08_DEPLOYMENT_AND_OPERATIONS.md`](docs/08_DEPLOYMENT_AND_OPERATIONS.md).

### 3. Chạy backend

```bash
cd backend
./mvnw spring-boot:run
```

Trên Windows PowerShell:

```powershell
cd backend
.\mvnw.cmd spring-boot:run
```

Khi chạy backend trực tiếp trên máy, dùng `localhost` cho PostgreSQL và Redis. Các hostname `postgres` và `redis` chỉ hoạt động bên trong mạng Docker Compose.

### 4. Chạy signaling server

```bash
cd signaling
npm install
npm start
```

### 5. Chạy frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend mặc định được phục vụ tại `http://localhost:5173`.

> Cấu hình chạy trọn hệ thống bằng Docker Compose vẫn đang được hoàn thiện cùng tiến độ dự án. Hãy dùng hướng dẫn phát triển theo từng thành phần ở trên cho trạng thái repository hiện tại.

## Kiểm thử

```bash
# Backend
cd backend
./mvnw test

# Signaling server
cd signaling
npm test

# Frontend
cd frontend
npm test
npm run lint
npm run build
```

Chiến lược kiểm thử, mã test case `TC-xx` và điều kiện chạy được mô tả trong [`docs/07_DEVELOPMENT_AND_TESTING.md`](docs/07_DEVELOPMENT_AND_TESTING.md).

## Tài liệu dự án

| Tài liệu | Nội dung |
|---|---|
| [`00_PROJECT_CONTEXT.md`](docs/00_PROJECT_CONTEXT.md) | Bối cảnh, mục tiêu và thuật ngữ |
| [`01_PRODUCT_REQUIREMENTS.md`](docs/01_PRODUCT_REQUIREMENTS.md) | Yêu cầu chức năng, phi chức năng và use case |
| [`02_SYSTEM_ARCHITECTURE.md`](docs/02_SYSTEM_ARCHITECTURE.md) | Kiến trúc và các quyết định thiết kế |
| [`03_DATABASE.md`](docs/03_DATABASE.md) | Schema, constraint, index và migration |
| [`04_API.md`](docs/04_API.md) | REST API và giao thức WebSocket |
| [`05_UI_UX.md`](docs/05_UI_UX.md) | Design system và đặc tả màn hình |
| [`06_CODEBASE_GUIDE.md`](docs/06_CODEBASE_GUIDE.md) | Bản đồ code hiện có |
| [`07_DEVELOPMENT_AND_TESTING.md`](docs/07_DEVELOPMENT_AND_TESTING.md) | Quy trình phát triển và kiểm thử |
| [`08_DEPLOYMENT_AND_OPERATIONS.md`](docs/08_DEPLOYMENT_AND_OPERATIONS.md) | Triển khai và vận hành |
| [`09_ROADMAP_AND_TASKS.md`](docs/09_ROADMAP_AND_TASKS.md) | Roadmap và trạng thái task |
| [`10_PERFORMANCE.md`](docs/10_PERFORMANCE.md) | Phương pháp và kết quả đo hiệu năng |

Các file gốc trong `docs/_source/` chỉ dùng để đối chiếu và nộp báo cáo, không chỉnh sửa trực tiếp.

## Tác giả

**Lê Thị Tú Phương**

Đồ án tốt nghiệp — Khoa Công nghệ Thông tin, Trường Đại học Công nghệ, ĐHQGHN.

## Bản quyền

Dự án hiện chưa công bố giấy phép nguồn mở. Mọi quyền được bảo lưu.
