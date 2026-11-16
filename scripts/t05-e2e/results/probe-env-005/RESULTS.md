# Kết quả T05 E2E backend

- Run: `veiltalk-e2e-1792415228191-715fe4`
- Thời gian (Asia/Bangkok): 20:08 19 thg 10, 2026
- Commit nền: `a759fa5`; source có thể gồm thay đổi chưa commit.
- Môi trường: Spring Boot JAR, Node signaling, PostgreSQL, Redis, MinIO with webhook; container riêng đã được dọn.
- Kết quả: **4 PASS, 1 FAIL, 2 NEEDS_CONTRACT, 113 NOT RUN** trên 120 ID.
- FAIL cần đối chiếu assertion và log trước khi phân loại FAIL_PRODUCT, FAIL_TEST hay FAIL_ENV.

## Kết quả từng case

| ID | Kết quả | Ghi chú |
|---|---|---|
| T05-ENV-001 | PASS |  |
| T05-ENV-002 | PASS |  |
| T05-ENV-003 | NOT RUN | Cần hai lần chạy runner độc lập; lượt xác minh này chạy một lần. |
| T05-ENV-004 | PASS |  |
| T05-ENV-005 | FAIL (chưa phân loại) | Chưa chạy probe cố ý làm fail trong thư mục kết quả riêng. |
| T05-ENV-006 | PASS |  |
| T05-ACC-001 | NOT RUN |  |
| T05-ACC-002 | NOT RUN |  |
| T05-ACC-003 | NOT RUN |  |
| T05-ACC-004 | NOT RUN |  |
| T05-ACC-005 | NOT RUN |  |
| T05-ACC-006 | NOT RUN |  |
| T05-ACC-007 | NOT RUN |  |
| T05-ACC-008 | NOT RUN |  |
| T05-ACC-009 | NOT RUN |  |
| T05-ACC-010 | NOT RUN |  |
| T05-ACC-011 | NOT RUN |  |
| T05-ACC-012 | NEEDS_CONTRACT | Chốt chính sách logout khi còn access token khác được cấp từ cùng refresh token. |
| T05-USR-001 | NOT RUN |  |
| T05-USR-002 | NOT RUN |  |
| T05-USR-003 | NOT RUN |  |
| T05-USR-004 | NOT RUN |  |
| T05-USR-005 | NOT RUN |  |
| T05-USR-006 | NOT RUN |  |
| T05-USR-007 | NOT RUN |  |
| T05-USR-008 | NOT RUN |  |
| T05-AVA-001 | NOT RUN |  |
| T05-AVA-002 | NOT RUN |  |
| T05-AVA-003 | NOT RUN |  |
| T05-AVA-004 | NOT RUN |  |
| T05-AVA-005 | NOT RUN |  |
| T05-AVA-006 | NOT RUN |  |
| T05-CON-001 | NOT RUN |  |
| T05-CON-002 | NOT RUN |  |
| T05-CON-003 | NOT RUN |  |
| T05-CON-004 | NOT RUN |  |
| T05-CON-005 | NOT RUN |  |
| T05-CON-006 | NOT RUN |  |
| T05-CON-007 | NOT RUN |  |
| T05-CON-008 | NOT RUN |  |
| T05-CON-009 | NOT RUN |  |
| T05-CON-010 | NOT RUN |  |
| T05-MSG-001 | NOT RUN |  |
| T05-MSG-002 | NOT RUN |  |
| T05-MSG-003 | NOT RUN |  |
| T05-MSG-004 | NOT RUN |  |
| T05-MSG-005 | NOT RUN |  |
| T05-MSG-006 | NOT RUN |  |
| T05-MSG-007 | NOT RUN |  |
| T05-MSG-008 | NOT RUN |  |
| T05-MSG-009 | NOT RUN |  |
| T05-MSG-010 | NOT RUN |  |
| T05-MSG-011 | NOT RUN |  |
| T05-MSG-012 | NOT RUN |  |
| T05-MSG-013 | NOT RUN |  |
| T05-MSG-014 | NOT RUN |  |
| T05-MSG-015 | NOT RUN |  |
| T05-MSG-016 | NOT RUN |  |
| T05-WS-001 | NOT RUN |  |
| T05-WS-002 | NOT RUN |  |
| T05-WS-003 | NOT RUN |  |
| T05-WS-004 | NOT RUN |  |
| T05-WS-005 | NOT RUN |  |
| T05-WS-006 | NOT RUN |  |
| T05-WS-007 | NOT RUN |  |
| T05-WS-008 | NOT RUN |  |
| T05-WS-009 | NOT RUN |  |
| T05-WS-010 | NOT RUN |  |
| T05-WS-011 | NOT RUN |  |
| T05-CALL-001 | NOT RUN |  |
| T05-CALL-002 | NOT RUN |  |
| T05-CALL-003 | NOT RUN |  |
| T05-CALL-004 | NOT RUN |  |
| T05-CALL-005 | NOT RUN |  |
| T05-CALL-006 | NOT RUN |  |
| T05-CALL-007 | NOT RUN |  |
| T05-CALL-008 | NOT RUN |  |
| T05-CALL-009 | NOT RUN |  |
| T05-CALL-010 | NOT RUN |  |
| T05-CALL-011 | NOT RUN |  |
| T05-CALL-012 | NOT RUN |  |
| T05-CALL-013 | NOT RUN |  |
| T05-VID-001 | NOT RUN |  |
| T05-VID-002 | NOT RUN |  |
| T05-VID-003 | NOT RUN |  |
| T05-VID-004 | NOT RUN |  |
| T05-VID-005 | NOT RUN |  |
| T05-VID-006 | NOT RUN |  |
| T05-VID-007 | NOT RUN |  |
| T05-VID-008 | NOT RUN |  |
| T05-VID-009 | NOT RUN |  |
| T05-VID-010 | NOT RUN |  |
| T05-VID-011 | NOT RUN |  |
| T05-VID-012 | NOT RUN |  |
| T05-VID-013 | NOT RUN |  |
| T05-VID-014 | NOT RUN |  |
| T05-VID-015 | NOT RUN |  |
| T05-VID-016 | NOT RUN |  |
| T05-VID-017 | NOT RUN |  |
| T05-VID-018 | NOT RUN |  |
| T05-DEL-001 | NOT RUN |  |
| T05-DEL-002 | NOT RUN |  |
| T05-DEL-003 | NOT RUN |  |
| T05-DEL-004 | NEEDS_CONTRACT | Chốt retention hội thoại và hành vi gửi tin sau khi một thành viên bị xóa. |
| T05-DEL-005 | NOT RUN |  |
| T05-DEL-006 | NOT RUN |  |
| T05-DEL-007 | NOT RUN |  |
| T05-DEL-008 | NOT RUN |  |
| T05-MET-001 | NOT RUN |  |
| T05-MET-002 | NOT RUN |  |
| T05-MET-003 | NOT RUN |  |
| T05-MET-004 | NOT RUN |  |
| T05-CROSS-001 | NOT RUN |  |
| T05-CROSS-002 | NOT RUN |  |
| T05-CROSS-003 | NOT RUN |  |
| T05-CROSS-004 | NOT RUN |  |
| T05-CROSS-005 | NOT RUN |  |
| T05-CROSS-006 | NOT RUN |  |
| T05-CROSS-007 | NOT RUN |  |
| T05-CROSS-008 | NOT RUN |  |

## Bằng chứng

- `results/latest/results.xml`: assertion theo từng case đã chạy.
- `results/latest/backend.log` và `results/latest/signaling.log`: log tiến trình.
- `results/latest/run.json`: run ID và exit code.
- `pending-cases.json`: lý do cho case NEEDS_CONTRACT và các kiểm tra runner chưa chạy.
- PASS chỉ áp dụng cho assertion của ID đã chạy; không suy ra độ bao phủ toàn hệ thống.
