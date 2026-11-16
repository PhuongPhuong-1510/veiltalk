# Kết quả E2E backend — 19/10/2026

Lần chạy: `veiltalk-e2e-1792390372135-71955e` từ `node scripts/e2e/run.cjs` trên source hiện tại.

**14 PASS, 0 FAIL, 0 SKIP; exit code 0.** Các service thật gồm Spring Boot JAR, Node signaling, PostgreSQL, Redis và MinIO có webhook. Container riêng được dọn sau lượt chạy.

E09 hiện PASS: B nhận `CALL_INCOMING`, mở signaling sau đó và nhận đúng offer lần đầu. E10 hiện PASS: access token đã logout bị signaling đóng bằng code `4001`. Hai kết quả này thay thế trạng thái FAIL của lượt chạy cũ; bằng chứng nằm ở `backend/target/e2e/results.xml` và `run.json`.

Suite 14 case chỉ kiểm tra các hành trình đã viết. T05 có ma trận riêng 120 ID tại `scripts/t05-e2e/`; không suy diễn 14 PASS thành độ bao phủ toàn hệ thống. Fixture signaling của E08/E09 được cập nhật để mang `call_id` theo hợp đồng mới; assertion về late offer và token thu hồi vẫn giữ nguyên mục tiêu nghiệm thu.
