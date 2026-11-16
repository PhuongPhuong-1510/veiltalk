# Kết quả T05 E2E backend

- Run: `veiltalk-e2e-1792415503640-9a37c1`
- Thời gian (Asia/Bangkok): 20:15 19 thg 10, 2026
- Commit nền: `a759fa5`; source có thể gồm thay đổi chưa commit.
- Môi trường: Spring Boot JAR, Node signaling, PostgreSQL, Redis, MinIO with webhook; container riêng đã được dọn.
- Kết quả: **119 PASS, 0 FAIL, 0 NEEDS_CONTRACT, 1 NOT RUN** trên 120 ID.
- Phạm vi DEL-004: lịch sử và ẩn danh hiển thị trước mốc 30 ngày. Dọn/ẩn danh dữ liệu sau 30 ngày chưa được triển khai và chưa nghiệm thu.
- FAIL cần đối chiếu assertion và log trước khi phân loại FAIL_PRODUCT, FAIL_TEST hay FAIL_ENV.

## Kết quả từng case

| ID | Kết quả | Ghi chú |
|---|---|---|
| T05-ENV-001 | PASS |  |
| T05-ENV-002 | PASS |  |
| T05-ENV-003 | NOT RUN | Cần hai lần chạy runner độc lập; lượt xác minh này chạy một lần. |
| T05-ENV-004 | PASS |  |
| T05-ENV-005 | PASS |  |
| T05-ENV-006 | PASS |  |
| T05-ACC-001 | PASS |  |
| T05-ACC-002 | PASS |  |
| T05-ACC-003 | PASS |  |
| T05-ACC-004 | PASS |  |
| T05-ACC-005 | PASS |  |
| T05-ACC-006 | PASS |  |
| T05-ACC-007 | PASS |  |
| T05-ACC-008 | PASS |  |
| T05-ACC-009 | PASS |  |
| T05-ACC-010 | PASS |  |
| T05-ACC-011 | PASS |  |
| T05-ACC-012 | PASS |  |
| T05-USR-001 | PASS |  |
| T05-USR-002 | PASS |  |
| T05-USR-003 | PASS |  |
| T05-USR-004 | PASS |  |
| T05-USR-005 | PASS |  |
| T05-USR-006 | PASS |  |
| T05-USR-007 | PASS |  |
| T05-USR-008 | PASS |  |
| T05-AVA-001 | PASS |  |
| T05-AVA-002 | PASS |  |
| T05-AVA-003 | PASS |  |
| T05-AVA-004 | PASS |  |
| T05-AVA-005 | PASS |  |
| T05-AVA-006 | PASS |  |
| T05-CON-001 | PASS |  |
| T05-CON-002 | PASS |  |
| T05-CON-003 | PASS |  |
| T05-CON-004 | PASS |  |
| T05-CON-005 | PASS |  |
| T05-CON-006 | PASS |  |
| T05-CON-007 | PASS |  |
| T05-CON-008 | PASS |  |
| T05-CON-009 | PASS |  |
| T05-CON-010 | PASS |  |
| T05-MSG-001 | PASS |  |
| T05-MSG-002 | PASS |  |
| T05-MSG-003 | PASS |  |
| T05-MSG-004 | PASS |  |
| T05-MSG-005 | PASS |  |
| T05-MSG-006 | PASS |  |
| T05-MSG-007 | PASS |  |
| T05-MSG-008 | PASS |  |
| T05-MSG-009 | PASS |  |
| T05-MSG-010 | PASS |  |
| T05-MSG-011 | PASS |  |
| T05-MSG-012 | PASS |  |
| T05-MSG-013 | PASS |  |
| T05-MSG-014 | PASS |  |
| T05-MSG-015 | PASS |  |
| T05-MSG-016 | PASS |  |
| T05-WS-001 | PASS |  |
| T05-WS-002 | PASS |  |
| T05-WS-003 | PASS |  |
| T05-WS-004 | PASS |  |
| T05-WS-005 | PASS |  |
| T05-WS-006 | PASS |  |
| T05-WS-007 | PASS |  |
| T05-WS-008 | PASS |  |
| T05-WS-009 | PASS |  |
| T05-WS-010 | PASS |  |
| T05-WS-011 | PASS |  |
| T05-CALL-001 | PASS |  |
| T05-CALL-002 | PASS |  |
| T05-CALL-003 | PASS |  |
| T05-CALL-004 | PASS |  |
| T05-CALL-005 | PASS |  |
| T05-CALL-006 | PASS |  |
| T05-CALL-007 | PASS |  |
| T05-CALL-008 | PASS |  |
| T05-CALL-009 | PASS |  |
| T05-CALL-010 | PASS |  |
| T05-CALL-011 | PASS |  |
| T05-CALL-012 | PASS |  |
| T05-CALL-013 | PASS |  |
| T05-VID-001 | PASS |  |
| T05-VID-002 | PASS |  |
| T05-VID-003 | PASS |  |
| T05-VID-004 | PASS |  |
| T05-VID-005 | PASS |  |
| T05-VID-006 | PASS |  |
| T05-VID-007 | PASS |  |
| T05-VID-008 | PASS |  |
| T05-VID-009 | PASS |  |
| T05-VID-010 | PASS |  |
| T05-VID-011 | PASS |  |
| T05-VID-012 | PASS |  |
| T05-VID-013 | PASS |  |
| T05-VID-014 | PASS |  |
| T05-VID-015 | PASS |  |
| T05-VID-016 | PASS |  |
| T05-VID-017 | PASS |  |
| T05-VID-018 | PASS |  |
| T05-DEL-001 | PASS |  |
| T05-DEL-002 | PASS |  |
| T05-DEL-003 | PASS |  |
| T05-DEL-004 | PASS |  |
| T05-DEL-005 | PASS |  |
| T05-DEL-006 | PASS |  |
| T05-DEL-007 | PASS |  |
| T05-DEL-008 | PASS |  |
| T05-MET-001 | PASS |  |
| T05-MET-002 | PASS |  |
| T05-MET-003 | PASS |  |
| T05-MET-004 | PASS |  |
| T05-CROSS-001 | PASS |  |
| T05-CROSS-002 | PASS |  |
| T05-CROSS-003 | PASS |  |
| T05-CROSS-004 | PASS |  |
| T05-CROSS-005 | PASS |  |
| T05-CROSS-006 | PASS |  |
| T05-CROSS-007 | PASS |  |
| T05-CROSS-008 | PASS |  |

## Bằng chứng

- `results/env-003-first/results.xml`: assertion theo từng case đã chạy.
- `results/env-003-first/backend.log` và `results/env-003-first/signaling.log`: log tiến trình.
- `results/env-003-first/run.json`: run ID và exit code.
- `pending-cases.json`: lý do cho case NEEDS_CONTRACT và các kiểm tra runner chưa chạy.
- PASS chỉ áp dụng cho assertion của ID đã chạy; không suy ra độ bao phủ toàn hệ thống.
