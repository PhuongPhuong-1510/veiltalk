# T07 results — binary execution report

- Run: veiltalk-e2e-1793207983833-43b97d, exit: 1
- Environment/cleanup/artifact gate: VERIFIED
- Spec: **178** cases. Counts: FAIL 89 · PASS 89
- Executed assertions: **95**. Missing JUnit evidence: **83**.
- Classification: FAIL_TEST 83 · PASS 89 · FAIL_PRODUCT 6
- `PASS`: executable assertion completed successfully and the environment evidence gate passed.
- `FAIL_PRODUCT`: executable product assertion failed.
- `FAIL_TEST`: the required deterministic harness capability is not implemented yet; this is not evidence of a backend defect.
- `FAIL_ENV`: isolation/cleanup/artifact evidence failed.
- All 178 specification IDs are binary; there are no NOT_RUN/NEEDS_HOOK/NEEDS_CONTRACT states in this report.

| Case | Priority | Result | Classification | Scenario | Reason |
|---|---|---|---|---|---|
| T07-ENV-001 | P0 | FAIL | FAIL_TEST | Chỉ thao tác lên container của run hiện tại | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-ENV-002 | P0 | FAIL | FAIL_TEST | Dọn dịch vụ sau PASS | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-ENV-003 | P0 | FAIL | FAIL_TEST | Dọn sau FAIL assertion | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-ENV-004 | P0 | FAIL | FAIL_TEST | Trường hợp runner bị kill cứng | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-ENV-005 | P1 | FAIL | FAIL_TEST | Khôi phục snapshot sau tiêm lỗi | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-ENV-006 | P1 | FAIL | FAIL_TEST | Không nhầm lỗi hạ tầng với lỗi sản phẩm | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-ENV-007 | P1 | FAIL | FAIL_TEST | Đồng bộ bằng tín hiệu thay sleep cứng | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-ENV-008 | P1 | FAIL | FAIL_TEST | Kiểm soát trễ và timeout test | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-ENV-009 | P1 | FAIL | FAIL_TEST | Mỗi test chạy độc lập và ngẫu nhiên thứ tự | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-ENV-010 | P2 | FAIL | FAIL_TEST | Ghi nhận phiên bản và môi trường tái lập | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-AUTH-001 | P0 | PASS | PASS | Logout đồng thời nhiều HTTP request đang xử lý |  |
| T07-AUTH-002 | P0 | PASS | PASS | Logout và mở messaging WebSocket cùng thời điểm |  |
| T07-AUTH-003 | P0 | PASS | PASS | Logout và mở signaling WebSocket cùng thời điểm |  |
| T07-AUTH-004 | P0 | PASS | PASS | Hai refresh đồng thời trên cùng một refresh token |  |
| T07-AUTH-005 | P0 | FAIL | FAIL_PRODUCT | Logout đồng thời refresh | HTTP expected 401, got 200, error=none 200 !== 401 |
| T07-AUTH-006 | P1 | PASS | PASS | Nhiều login đồng thời cùng tài khoản |  |
| T07-AUTH-007 | P1 | PASS | PASS | Đăng ký cùng email đồng thời |  |
| T07-AUTH-008 | P1 | PASS | PASS | Thu hồi toàn bộ token khi xóa tài khoản cùng lúc dùng API |  |
| T07-AUTH-009 | P1 | FAIL | FAIL_TEST | Redis thu hồi token bị gián đoạn khi logout | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-AUTH-010 | P1 | PASS | PASS | Race token hết hạn và WS heartbeat |  |
| T07-AUTH-011 | P1 | PASS | PASS | Tài khoản xóa trong khi refresh và handshake |  |
| T07-AUTH-012 | P2 | PASS | PASS | Thử cùng lúc nhiều phiên login/logout độc lập |  |
| T07-CONV-001 | P0 | PASS | PASS | A và B cùng tạo hội thoại A–B |  |
| T07-CONV-002 | P0 | PASS | PASS | Nhiều request tạo cùng cặp hội thoại |  |
| T07-CONV-003 | P1 | PASS | PASS | Tạo hội thoại khi B bị xóa |  |
| T07-CONV-004 | P1 | PASS | PASS | Cập nhật updated_at bởi tin nhắn đồng thời |  |
| T07-CONV-005 | P1 | PASS | PASS | Cursor khi danh sách hội thoại đang thay đổi |  |
| T07-CONV-006 | P1 | PASS | PASS | Cursor ở biên timestamp bằng nhau |  |
| T07-CONV-007 | P1 | PASS | PASS | Xóa tài khoản khi đang đọc danh sách |  |
| T07-CONV-008 | P2 | PASS | PASS | Tạo cặp hội thoại độc lập đồng thời |  |
| T07-CONV-009 | P2 | FAIL | FAIL_TEST | Đọc chi tiết trong khi tạo hội thoại | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-MSG-001 | P0 | PASS | PASS | Bốn request giống nhau cùng UUID — regression E05 |  |
| T07-MSG-002 | P0 | PASS | PASS | Nhiều UUID khác nhau cùng lúc |  |
| T07-MSG-003 | P0 | PASS | PASS | Cùng UUID nhưng người gửi khác |  |
| T07-MSG-004 | P0 | PASS | PASS | Cùng UUID nhưng hội thoại khác |  |
| T07-MSG-005 | P0 | PASS | PASS | Retry sau mất response HTTP nhưng DB đã commit |  |
| T07-MSG-006 | P0 | FAIL | FAIL_TEST | Retry sau transaction rollback | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-MSG-007 | P1 | PASS | PASS | Timestamp hợp lệ khi nhiều thread gửi cùng lúc |  |
| T07-MSG-008 | P1 | PASS | PASS | Biên timestamp ±5 phút khi request bị chờ |  |
| T07-MSG-009 | P0 | PASS | PASS | Update read và delivered đồng thời |  |
| T07-MSG-010 | P0 | PASS | PASS | Update read nhiều lần đồng thời |  |
| T07-MSG-011 | P1 | PASS | PASS | Sender thử cập nhật trạng thái cạnh recipient |  |
| T07-MSG-012 | P1 | PASS | PASS | Cập nhật trạng thái đồng thời với xóa tài khoản |  |
| T07-MSG-013 | P1 | PASS | PASS | Phân trang lịch sử khi tin mới đến |  |
| T07-MSG-014 | P1 | PASS | PASS | Phân trang tin với timestamp trùng |  |
| T07-MSG-015 | P1 | PASS | PASS | Nhiều cuộc trò chuyện gửi đồng thời |  |
| T07-MSG-016 | P2 | PASS | PASS | Client hủy request khi server vẫn đang xử lý |  |
| T07-TX-001 | P0 | FAIL | FAIL_TEST | Không phát NEW_MESSAGE trước DB commit | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-TX-002 | P0 | FAIL | FAIL_TEST | Rollback INSERT không phát event | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-TX-003 | P0 | FAIL | FAIL_TEST | Rollback status không phát MESSAGE_STATUS_UPDATE | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-TX-004 | P0 | FAIL | FAIL_TEST | DB commit thành công nhưng Redis publish lỗi | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-TX-005 | P1 | FAIL | FAIL_TEST | Redis publish chậm sau commit | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-TX-006 | P1 | PASS | PASS | Giao dịch nhận message và chạm conversation atomic |  |
| T07-TX-007 | P1 | FAIL | FAIL_TEST | Read committed không thấy dữ liệu chưa commit | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-TX-008 | P1 | FAIL | FAIL_TEST | Không giữ transaction khi chờ dịch vụ chậm vô hạn | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-TX-009 | P1 | FAIL | FAIL_TEST | Tạo video: MinIO OK, Redis create session FAIL | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-TX-010 | P1 | FAIL | FAIL_TEST | Tạo video: MinIO OK, PostgreSQL INSERT FAIL | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-TX-011 | P1 | FAIL | FAIL_TEST | Xóa tài khoản thất bại giữa cleanup video | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-TX-012 | P2 | FAIL | FAIL_TEST | Sự kiện post-commit không tự cấp quyền transaction mới | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-PUB-001 | P0 | FAIL | FAIL_TEST | Gửi tin khi Redis Pub/Sub tạm mất | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-PUB-002 | P0 | FAIL | FAIL_TEST | Subscriber mất kết nối khi publish | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-PUB-003 | P0 | PASS | PASS | Tin trùng do retry HTTP không gửi lại event |  |
| T07-PUB-004 | P1 | PASS | PASS | Sự kiện và response lệch thời điểm |  |
| T07-PUB-005 | P1 | PASS | PASS | Publish có payload Unicode và metadata chính xác |  |
| T07-PUB-006 | P1 | PASS | PASS | Một người nhận có nhiều socket |  |
| T07-PUB-007 | P1 | FAIL | FAIL_TEST | Một socket gửi lỗi không hỏng tất cả receivers | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-PUB-008 | P1 | PASS | PASS | Subscriber restart rồi nhận các event mới |  |
| T07-PUB-009 | P1 | PASS | PASS | Đồng thời publish từ nhiều hội thoại |  |
| T07-PUB-010 | P2 | PASS | PASS | Payload Pub/Sub không hợp lệ |  |
| T07-PUB-011 | P2 | PASS | PASS | Redis subscriber backlog khi receiver chậm |  |
| T07-PUB-012 | P2 | PASS | PASS | Publish status update hai người nhận |  |
| T07-WS-001 | P0 | PASS | PASS | Đóng một trong nhiều socket không xóa socket khác |  |
| T07-WS-002 | P0 | PASS | PASS | Terminate đột ngột không leak session |  |
| T07-WS-003 | P0 | PASS | PASS | WebSocket token đã thu hồi trong phiên mở |  |
| T07-WS-004 | P0 | FAIL | FAIL_TEST | Slow consumer vượt giới hạn buffer | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-WS-005 | P1 | PASS | PASS | Heartbeat PING/PONG hoạt động bình thường |  |
| T07-WS-006 | P1 | PASS | PASS | Client im lặng không phản hồi PING |  |
| T07-WS-007 | P1 | FAIL | FAIL_TEST | Redis lỗi khi heartbeat kiểm tra thu hồi | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-WS-008 | P1 | PASS | PASS | Nhiều client đồng thời reconnect |  |
| T07-WS-009 | P1 | PASS | PASS | WS handshake và logout tranh nhau |  |
| T07-WS-010 | P1 | PASS | PASS | WS gửi TYPING đồng thời nhiều tab |  |
| T07-WS-011 | P1 | PASS | PASS | Socket B đang đóng giữa fanout |  |
| T07-WS-012 | P1 | FAIL | FAIL_TEST | Scheduler shutdown và restart backend | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-WS-013 | P2 | FAIL | FAIL_TEST | Client PONG trễ sát timeout | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-WS-014 | P2 | PASS | PASS | Fragmented/large WS frame giới hạn |  |
| T07-WS-015 | P2 | PASS | PASS | Lặp 100 chu kỳ kết nối/đóng không tăng vô hạn |  |
| T07-WS-016 | P2 | PASS | PASS | Gửi sự kiện vào session thuộc user khác khi reconnect |  |
| T07-CALL-001 | P0 | PASS | PASS | Người nhận signaling muộn — regression E09 |  |
| T07-CALL-002 | P0 | PASS | PASS | Logout token vẫn mở signaling — regression E10 |  |
| T07-CALL-003 | P0 | PASS | PASS | Hai CALL_OFFER đồng thời A→B |  |
| T07-CALL-004 | P0 | PASS | PASS | A và B gọi nhau đồng thời |  |
| T07-CALL-005 | P0 | PASS | PASS | CALL_END đến cùng lúc cả hai đầu |  |
| T07-CALL-006 | P1 | PASS | PASS | CALL_ANSWER đến sát timeout 30 giây |  |
| T07-CALL-007 | P1 | PASS | PASS | Caller rớt socket sau CALL_OFFER |  |
| T07-CALL-008 | P1 | PASS | PASS | Callee rớt socket giữa ANSWER và ICE |  |
| T07-CALL-009 | P1 | FAIL | FAIL_PRODUCT | Offer đến trong lúc callee vừa đăng ký signaling | Callee received a duplicate offer when registration crossed notify completion 1 !== 0 |
| T07-CALL-010 | P1 | PASS | PASS | CALL_REJECT đồng thời CALL_END |  |
| T07-CALL-011 | P1 | PASS | PASS | Restart Node signaling khi có pending call |  |
| T07-CALL-012 | P1 | PASS | PASS | Spring call notify tạm không hoạt động |  |
| T07-CALL-013 | P1 | FAIL | FAIL_PRODUCT | Nhiều socket signaling cùng tài khoản | Missing WS CALL_ANSWER; received ; close=open |
| T07-CALL-014 | P2 | PASS | PASS | ICE đến sau CALL_END |  |
| T07-VID-001 | P0 | PASS | PASS | Hai finalize đồng thời trên cùng upload |  |
| T07-VID-002 | P0 | FAIL | FAIL_PRODUCT | Finalize và abort đồng thời cùng video | The losing terminal operation must return 409; statuses=404,204 0 !== 1 |
| T07-VID-003 | P0 | FAIL | FAIL_PRODUCT | Finalize và delete đồng thời | Deleting a recording/processing video leaked its upload session '1' !== '0' |
| T07-VID-004 | P0 | PASS | PASS | Hai chunk-next đồng thời với part_number giống nhau |  |
| T07-VID-005 | P0 | FAIL | FAIL_PRODUCT | Hai chunk-next khác part_number đến đảo thứ tự | Part 3 was reserved before part 2 bytes and its real ETag existed in MinIO; initial statuses=200,400, final=200 200 !== 400 |
| T07-VID-006 | P0 | PASS | PASS | Webhook Complete đến 2 lần giống nhau |  |
| T07-VID-007 | P0 | FAIL | FAIL_TEST | Webhook đến trước response finalize | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-VID-008 | P0 | PASS | PASS | Webhook muộn sau abort |  |
| T07-VID-009 | P0 | PASS | PASS | Webhook muộn sau delete video |  |
| T07-VID-010 | P0 | PASS | PASS | Khởi tạo video concurrent gần quota |  |
| T07-VID-011 | P0 | PASS | PASS | Finalize hai video cùng user chạm quota |  |
| T07-VID-012 | P1 | PASS | PASS | Hai người khác nhau finalize song song |  |
| T07-VID-013 | P1 | PASS | PASS | Finalize khi Redis upload session hết hạn |  |
| T07-VID-014 | P1 | PASS | PASS | Finalize khi part ETag thay đổi giữa các bước |  |
| T07-VID-015 | P1 | FAIL | FAIL_TEST | MinIO complete thành công nhưng webhook không đến | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-VID-016 | P1 | FAIL | FAIL_TEST | MinIO complete lỗi sau khi đặt PROCESSING | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-VID-017 | P1 | PASS | PASS | Presigned URL PUT đang chạy khi user abort |  |
| T07-VID-018 | P1 | PASS | PASS | Delete READY đồng thời GET view URL |  |
| T07-VID-019 | P1 | FAIL | FAIL_TEST | MinIO multipart orphan sau init lỗi | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-VID-020 | P1 | PASS | PASS | Đổi title khi status đổi PROCESSING → READY |  |
| T07-VID-021 | P2 | FAIL | FAIL_TEST | Upload nhiều phần khi MinIO trả ETag không ổn định | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-VID-022 | P2 | PASS | PASS | Nhiều video nhỏ tạo và abort liên tiếp |  |
| T07-LOCK-001 | P0 | FAIL | FAIL_TEST | Hai thao tác cùng video không cùng giữ lock | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-LOCK-002 | P0 | FAIL | FAIL_TEST | Release lock cũ không xóa khóa chủ mới | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-LOCK-003 | P0 | FAIL | FAIL_TEST | Renew từ owner cũ không gia hạn khóa mới | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-LOCK-004 | P0 | FAIL | FAIL_TEST | Mất lock renewal giữa thao tác dài | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-LOCK-005 | P1 | FAIL | FAIL_TEST | Redis chết khi đang giữ lock | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-LOCK-006 | P1 | PASS | PASS | Lock acquire timeout chính xác |  |
| T07-LOCK-007 | P1 | FAIL | FAIL_TEST | Ngắt thread trong lúc chờ lock | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-LOCK-008 | P1 | PASS | PASS | Quota lock cùng user ngăn overcommit |  |
| T07-LOCK-009 | P1 | PASS | PASS | Lock khác user không cạnh tranh không cần thiết |  |
| T07-LOCK-010 | P1 | PASS | PASS | Atomic Redis upload session update tranh nhau |  |
| T07-LOCK-011 | P1 | PASS | PASS | Message status pessimistic row lock |  |
| T07-LOCK-012 | P2 | PASS | PASS | Hàng loạt contention ngắn không để lock treo |  |
| T07-FAIL-001 | P0 | PASS | PASS | PostgreSQL không khả dụng khi login |  |
| T07-FAIL-002 | P0 | FAIL | FAIL_TEST | PostgreSQL mất giữa gửi tin | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-FAIL-003 | P0 | FAIL | FAIL_TEST | Redis không khả dụng khi JWT kiểm tra revoke | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-FAIL-004 | P0 | FAIL | FAIL_TEST | Redis mất khi lưu phiên upload | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-FAIL-005 | P0 | FAIL | FAIL_TEST | MinIO không khả dụng trong create upload | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-FAIL-006 | P0 | FAIL | FAIL_TEST | MinIO lỗi giữa complete multipart | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-FAIL-007 | P1 | FAIL | FAIL_TEST | Redis subscriber mất nhưng Redis key ops còn hoạt động | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-FAIL-008 | P1 | FAIL | FAIL_TEST | Backend không tới được Node signaling | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-FAIL-009 | P1 | FAIL | FAIL_TEST | Node signaling gọi internal notify timeout | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-FAIL-010 | P1 | FAIL | FAIL_TEST | Mạng MinIO có độ trễ lớn nhưng chưa chết | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-FAIL-011 | P1 | FAIL | FAIL_TEST | Database pool hết connection tạm thời | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-FAIL-012 | P1 | FAIL | FAIL_TEST | Redis rate limit key không có TTL sau crash giữa INCR–EXPIRE | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-FAIL-013 | P2 | FAIL | FAIL_TEST | DNS/hostname của phụ thuộc thay đổi giữa request | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-REC-001 | P0 | FAIL | FAIL_TEST | Restart backend sau message đã commit | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-REC-002 | P0 | FAIL | FAIL_TEST | Restart backend trước commit message | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-REC-003 | P0 | FAIL | FAIL_TEST | Restart backend khi video PROCESSING | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-REC-004 | P0 | FAIL | FAIL_TEST | Cleanup job thất bại khi xóa object | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-REC-005 | P0 | FAIL | FAIL_TEST | Restart giữa retry cleanup job | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-REC-006 | P1 | FAIL | FAIL_TEST | Timeout cleanup bắt video PROCESSING quá hạn | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-REC-007 | P1 | FAIL | FAIL_TEST | Cleanup scheduler không chạy trùng khi restart | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-REC-008 | P1 | FAIL | FAIL_TEST | Poison cleanup job không chặn jobs sau | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-REC-009 | P1 | FAIL | FAIL_TEST | Backoff retry tăng đúng và có giới hạn | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-REC-010 | P1 | PASS | PASS | Account deletion có video đang upload |  |
| T07-REC-011 | P1 | FAIL | FAIL_TEST | Orphan MinIO multipart có thể được liệt kê và xử lý | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-REC-012 | P2 | FAIL | FAIL_TEST | Khôi phục sau reboot Docker Engine của lab | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-MULTI-001 | P1 | FAIL | FAIL_TEST | Redis Pub/Sub fanout hai Spring instances | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-MULTI-002 | P1 | FAIL | FAIL_TEST | Client reconnect qua instance khác | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-MULTI-003 | P1 | FAIL | FAIL_TEST | Video finalize qua hai Java instances | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-MULTI-004 | P1 | FAIL | FAIL_TEST | Scheduled cleanup jobs chạy ở cả hai instances | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-MULTI-005 | P1 | FAIL | FAIL_TEST | Signaling A và B nằm hai Node instances | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-MULTI-006 | P2 | FAIL | FAIL_TEST | Một Node signaling instance chết giữa cuộc gọi | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-MULTI-007 | P2 | FAIL | FAIL_TEST | Load balancer không đưa WebSocket tới instance chết | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-MULTI-008 | P2 | FAIL | FAIL_TEST | Session tokens giữa nhiều backend instances | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-OBS-001 | P0 | FAIL | FAIL_TEST | Mỗi test có oracle trạng thái cuối | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-OBS-002 | P0 | FAIL | FAIL_TEST | Phân loại lỗi product/test/environment/contract | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-OBS-003 | P0 | FAIL | FAIL_TEST | Phát hiện và chặn false PASS do thiếu event | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-OBS-004 | P1 | FAIL | FAIL_TEST | Evidence timeline bằng monotonic clock | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-OBS-005 | P1 | FAIL | FAIL_TEST | Test race lặp nhiều vòng có cùng seed | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-OBS-006 | P1 | FAIL | FAIL_TEST | Fault injection có điểm đặt chính xác | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-OBS-007 | P1 | FAIL | FAIL_TEST | Không rò secret qua artifact fault log | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-OBS-008 | P1 | FAIL | FAIL_TEST | Không có resource drift sau suite | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-OBS-009 | P1 | FAIL | FAIL_TEST | Tạo báo cáo giới hạn đã biết cho T08 | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
| T07-OBS-010 | P2 | FAIL | FAIL_TEST | Đối chiếu kết quả E09/E10 lịch sử | TEST_NOT_EXECUTED: Test ID was not selected or produced no JUnit result |
