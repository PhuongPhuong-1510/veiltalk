TRƯỜNG ĐẠI HỌC CÔNG NGHỆ — ĐHQGHN

Khoa Công nghệ Thông tin

**HƯỚNG DẪN TRIỂN KHAI**

*(Deployment Guide)*

**VEILTALK**

Hướng dẫn cài đặt và vận hành hệ thống

Phiên bản: 1.0 \| Ngày: 21/06/2026

Người soạn: Lê Thị Tú Phương — MSSV 23020695

## 1. Yêu cầu Môi trường

### 1.1. Phần mềm cần thiết

| **Phần mềm**        | **Phiên bản tối thiểu — Lý do**              |
|---------------------|----------------------------------------------|
| **Docker Engine**   | 24.0+ — chạy tất cả service qua container    |
| **Docker Compose**  | 2.20+ — orchestrate 7 container (SAD mục 10) |
| **Git**             | 2.40+ — clone repository                     |
| **Make (tuỳ chọn)** | GNU Make — chạy Makefile shortcut commands   |

### 1.2. Phần cứng tối thiểu (server/máy phát triển)

| **Thông số** | **Yêu cầu — Lý do**                                                                                                  |
|--------------|----------------------------------------------------------------------------------------------------------------------|
| **RAM**      | ≥ 4GB (khuyến nghị 8GB) — Backend 1GB + PostgreSQL 512MB + Redis 256MB + Signaling 512MB + MinIO 512MB + OS overhead |
| **CPU**      | ≥ 2 vCPU — backend xử lý concurrent WebSocket connections                                                            |
| **Storage**  | ≥ 20GB — PostgreSQL data + MinIO video storage cho môi trường dev                                                    |
| **Network**  | Port 8080 (Backend API), 3000 (Signaling), 9000/9001 (MinIO) phải mở                                                 |

## 2. Cấu trúc Project

Repository VeilTalk tổ chức theo monorepo với các thư mục sau:

| **Thư mục / File**          | **Mô tả**                                                                         |
|-----------------------------|-----------------------------------------------------------------------------------|
| **backend/**                | Spring Boot (Java 21) — REST API, WebSocket messaging, business logic             |
| **signaling/**              | Node.js (ws library) — Signaling Server relay SDP/ICE                             |
| **frontend/**               | React/TypeScript — Browser client, MediaPipe Tasks API, Three.js                  |
| **docker-compose.yml**      | Định nghĩa 7 service: backend, signaling, postgres, redis, minio, frontend, nginx |
| **docker-compose.dev.yml**  | Override cho môi trường development (volume mount source code)                    |
| **.env.example**            | Template biến môi trường — copy thành .env và điền giá trị                        |
| **backend/src/main/resources/db/migration/** | Flyway migrations; V1 tạo toàn bộ schema ứng dụng khi Backend khởi động lần đầu |
| **infra/minio/**            | MinIO bucket setup script                                                         |
| **Makefile**                | Shortcut: make up, make down, make logs, make migrate                             |

## 3. Biến Môi trường

Copy file .env.example thành .env và điền giá trị trước khi chạy. Không commit file .env vào git.

### 3.1. Backend (Spring Boot)

\# Database

DB_HOST=localhost

DB_PORT=5432

DB_NAME=veiltalk

DB_USER=veiltalk_user

DB_PASSWORD=\<strong-password\>

\# Redis

REDIS_HOST=redis

REDIS_PORT=6379

\# JWT

JWT_SECRET=\<random-256-bit-hex\> \# openssl rand -hex 32

JWT_ACCESS_EXPIRY=900 \# 15 phút (giây)

JWT_REFRESH_EXPIRY=604800 \# 7 ngày (giây)

\# MinIO

MINIO_ENDPOINT=http://minio:9000

MINIO_ACCESS_KEY=\<minio-access-key\>

MINIO_SECRET_KEY=\<minio-secret-key\>

MINIO_BUCKET=veiltalk

MINIO_WEBHOOK_SECRET=\<hmac-secret\> \# SAD mục 7.6 /internal/videos/webhook

\# CORS

CORS_ALLOWED_ORIGINS=http://localhost:5173,https://app.veiltalk.example.com

\# Signaling

SIGNALING_JWT_SECRET=\<same-as-JWT_SECRET\>

### 3.2. Signaling Server (Node.js)

PORT=3000

JWT_SECRET=\<same-as-JWT_SECRET\> \# validate JWT trước khi relay (SAD mục 4.2)

RATE_LIMIT_MAX=20 \# max connections/IP/minute

### 3.3. PostgreSQL

POSTGRES_DB=veiltalk

POSTGRES_USER=veiltalk_user

POSTGRES_PASSWORD=\<strong-password\>

### 3.4. MinIO

MINIO_ROOT_USER=\<minio-access-key\>

MINIO_ROOT_PASSWORD=\<minio-secret-key\>

## 4. Docker Compose — Cấu trúc Service

File docker-compose.yml định nghĩa 7 service nhất quán với SAD mục 10. Dưới đây là cấu hình tóm tắt; file đầy đủ trong repository.

| **Service**   | **Image — Port — Phụ thuộc**                                                    |
|---------------|---------------------------------------------------------------------------------|
| **postgres**  | postgres:16-alpine — 5432 (internal) — không phụ thuộc                          |
| **redis**     | redis:7-alpine — 6379 (internal) — không phụ thuộc                              |
| **minio**     | minio/minio:latest — 9000 (API), 9001 (Console) — không phụ thuộc               |
| **backend**   | veiltalk/backend:latest — 8080 — postgres, redis, minio                         |
| **signaling** | veiltalk/signaling:latest — 3000 — không phụ thuộc runtime (chỉ cần JWT secret) |
| **frontend**  | veiltalk/frontend:latest — 5173 (dev) / 80 (prod) — backend, signaling          |
| **nginx**     | nginx:alpine — 80, 443 — backend, signaling, frontend                           |

**Volume mapping quan trọng:**

- postgres_data:/var/lib/postgresql/data — dữ liệu database persistent

- minio_data:/data — file video persistent

Schema không được mount hoặc tạo bằng Docker init script. Flyway thuộc Backend sở hữu
schema từ migration V1. Khi phát triển, Backend chạy local và kết nối PostgreSQL
container qua `localhost:5432`; khi chạy full Docker Compose, service Backend dùng
hostname nội bộ `postgres`.

## 5. Hướng dẫn Triển khai từng Bước

### 5.1. Clone repository và cấu hình

## 1. Clone repository: git clone https://github.com/\<org\>/veiltalk.git && cd veiltalk

## 2. Copy env template: cp .env.example .env

## 3. Điền giá trị trong .env — đặc biệt JWT_SECRET (phải giống nhau cho backend và signaling) và MINIO_WEBHOOK_SECRET.

## 4. Tạo JWT_SECRET: openssl rand -hex 32

### 5.2. Khởi động lần đầu

## 5. Build images: docker compose build

## 6. Khởi động database và cache trước: docker compose up -d postgres redis

## 7. Chờ PostgreSQL sẵn sàng (khoảng 10-15 giây): docker compose logs postgres \| grep 'ready to accept'

## 8. Khởi động MinIO: docker compose up -d minio

## 9. Tạo bucket và cấu hình webhook MinIO (xem mục 5.3)

## 10. Khởi động toàn bộ: docker compose up -d

Khi Backend khởi động, Flyway tự kiểm tra và áp dụng các migration còn thiếu. Database
mới được tạo từ `V1__initial_schema.sql`; không chạy schema thủ công bằng `psql` và
không dùng Flyway baseline cho database mới.

## 11. Kiểm tra health (xem mục 6): make health hoặc curl localhost:8080/actuator/health

### 5.3. Cấu hình MinIO Bucket và Webhook

MinIO cần được cấu hình để gửi bucket notification về Backend khi upload hoàn tất (SAD mục 7.6 — /internal/videos/webhook).

## 12. Truy cập MinIO Console: http://localhost:9001 — đăng nhập bằng MINIO_ROOT_USER/PASSWORD

## 13. Tạo bucket: Buckets → Create → Tên: veiltalk

## 14. Cấu hình webhook: Events → Add Event Destination → Webhook → URL: http://backend:8080/internal/videos/webhook → Authentication Header: X-MinIO-Signature: \<MINIO_WEBHOOK_SECRET\>

## 15. Bật notification: trong bucket veiltalk → Events → Subscribe to Event → chọn s3:ObjectCreated:CompleteMultipartUpload

### 5.4. Lệnh vận hành thường dùng

| **Lệnh**                                                           | **Tác dụng**                               |
|--------------------------------------------------------------------|--------------------------------------------|
| **docker compose up -d**                                           | Khởi động tất cả service ở background      |
| **docker compose down**                                            | Dừng tất cả service (giữ volume data)      |
| **docker compose down -v**                                         | Dừng và xóa toàn bộ data (reset sạch)      |
| **docker compose logs -f backend**                                 | Xem log realtime của Backend               |
| **docker compose logs -f signaling**                               | Xem log Signaling Server                   |
| **docker compose ps**                                              | Xem trạng thái các container               |
| **docker compose exec postgres psql -U veiltalk_user -d veiltalk** | Kết nối trực tiếp PostgreSQL               |
| **docker compose restart backend**                                 | Restart chỉ Backend (sau khi update image) |
| **docker compose pull && docker compose up -d**                    | Cập nhật lên image mới nhất                |

## 6. Health Check & Observability

### 6.1. Endpoint kiểm tra sức khỏe

| **Service**          | **Endpoint kiểm tra — Kết quả mong đợi**                          |
|----------------------|-------------------------------------------------------------------|
| **Backend API**      | GET http://localhost:8080/actuator/health → {"status":"UP"}       |
| **Backend — DB**     | GET http://localhost:8080/actuator/health/db → {"status":"UP"}    |
| **Backend — Redis**  | GET http://localhost:8080/actuator/health/redis → {"status":"UP"} |
| **Signaling Server** | GET http://localhost:3000/health → {"status":"ok","uptime":...}   |
| **MinIO**            | GET http://localhost:9000/minio/health/live → HTTP 200            |
| **PostgreSQL**       | docker compose exec postgres pg_isready -U veiltalk_user          |

### 6.2. Xử lý sự cố thường gặp

| **Triệu chứng**                                          | **Nguyên nhân thường gặp — Cách khắc phục**                                                                                                                      |
|----------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Backend không start, lỗi 'Connection refused' tới DB** | PostgreSQL chưa sẵn sàng — đợi thêm 10-15 giây rồi restart backend: docker compose restart backend                                                               |
| **MinIO webhook không trigger**                          | URL webhook sai hoặc backend chưa start — kiểm tra MinIO Console Events, đảm bảo URL dùng tên service 'backend' không phải 'localhost'                           |
| **Signaling JWT validation fail**                        | JWT_SECRET trong .env của backend và signaling khác nhau — đảm bảo cùng giá trị                                                                                  |
| **Video mãi ở trạng thái processing**                    | MinIO webhook không đến Backend — kiểm tra log backend: docker compose logs backend \| grep webhook. Background job sẽ đánh dấu failed sau 10 phút (ADD mục 7.4) |
| **CORS error từ frontend**                               | CORS_ALLOWED_ORIGINS chưa thêm origin của frontend — thêm vào .env và restart backend                                                                            |
| **Redis connection fail**                                | Redis container chưa start — docker compose up -d redis rồi restart backend                                                                                      |

## 7. Checklist Triển khai Lần đầu

| **\#** | **Hạng mục kiểm tra**                                                                                                   |
|--------|-------------------------------------------------------------------------------------------------------------------------|
| **1**  | ✓ File .env đã được tạo từ .env.example và điền đủ giá trị                                                              |
| **2**  | ✓ JWT_SECRET giống nhau trong cả backend và signaling                                                                   |
| **3**  | ✓ MINIO_WEBHOOK_SECRET đã đặt và khớp với cấu hình MinIO webhook                                                        |
| **4**  | ✓ CORS_ALLOWED_ORIGINS bao gồm domain frontend                                                                          |
| **5**  | ✓ Bucket 'veiltalk' đã tạo trên MinIO                                                                                   |
| **6**  | ✓ MinIO webhook đã subscribe s3:ObjectCreated:CompleteMultipartUpload                                                   |
| **7**  | ✓ GET /actuator/health trả về {"status":"UP"}                                                                           |
| **8**  | ✓ GET /actuator/health/db và /redis đều UP                                                                              |
| **9**  | ✓ Có thể đăng ký tài khoản mới qua POST /api/auth/register                                                              |
| **10** | ✓ Có thể đăng nhập và nhận JWT qua POST /api/auth/login                                                                 |
| **11** | ✓ WebSocket messaging kết nối được tới wss://.../ws/messaging                                                           |
| **12** | ✓ Signaling WebSocket kết nối được với JWT hợp lệ                                                                       |
| **13** | ✓ Upload video test: POST /api/videos → nhận presigned URL → PUT chunk → POST finalize → MinIO webhook → status = ready |

*— Hết tài liệu —*
