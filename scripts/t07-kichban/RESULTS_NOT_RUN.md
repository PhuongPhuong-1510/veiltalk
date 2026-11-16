# T07 results — evidence-first

- Run: NOT_RUN, exit: not started
- Environment/cleanup/artifact gate: NOT VERIFIED
- Spec: **178** cases. Counts: NOT_RUN 116 · NEEDS_HOOK 45 · NEEDS_CONTRACT 17
- `PASS`: scenario assertions executed and passed with clean isolation/cleanup.
- `OBSERVED_ONLY`: probe assertions executed and passed, but no proof of critical-section interleaving or complete fault scenario. Not counted as T07 verified PASS.
- `REVIEW_REQUIRED`: failure, incomplete lab evidence, or an error; must classify FAIL_PRODUCT / FAIL_TEST / FAIL_ENV manually after inspecting logs.
- `NEEDS_CONTRACT`: decision required before creating expected result. `NEEDS_HOOK`: instrumented barrier/fault injection needed. `NOT_RUN`: no executed full test.
- JUnit `<skipped>` never counts as PASS. Missing XML never counts as PASS.

## Contract decisions

- **T07-AUTH-004**: Confirm that concurrent refresh of one reusable refresh token is allowed; source AuthService.refresh() is read-only and does not rotate.
- **T07-AUTH-005**: Decide whether a refresh begun before logout may succeed after logout and whether access token minted during race is valid.
- **T07-AUTH-009**: Specify response/rollback semantics when Redis blacklist writes fail during logout (DB row may be in transaction).
- **T07-TX-004**: After DB commit but Redis publish failure: decide HTTP response status and required reconciliation path, distinct from DB durability.
- **T07-CALL-003**: Define duplicate CALL_OFFER with same/different call_id, response and state.
- **T07-CALL-004**: Define simultaneous A↔B offers (glare): deterministic winner/reject rule.
- **T07-CALL-005**: Define duplicate CALL_END acknowledgement and event contract.
- **T07-CALL-006**: Confirm timeout from live signaling source, boundary clock and allowed late answer.
- **T07-CALL-007**: Define pending-call teardown when caller disconnects; timebound.
- **T07-CALL-013**: Define if multiple signaling sockets per user are allowed, replaced or jointly notified.
- **T07-VID-001**: Define response codes for the losing finalize request while requiring exactly one successful MinIO complete.
- **T07-VID-002**: Define accepted HTTP responses for finalize-vs-abort; invariant: one consistent final outcome.
- **T07-VID-003**: Spec says delete only when API state allows; Java source currently soft-deletes any visible video, without recording/processing guard. Decide intended state policy first.
- **T07-VID-005**: Define if part 3 can be reserved before part 2 bytes are PUT/verified. Lua currently advances by reservation and does not check MinIO part existence.
- **T07-VID-015**: Define recovery bound when CompleteMultipart succeeds but webhook never arrives; cleanup scans PROCESSING only.
- **T07-LOCK-004**: Define guaranteed behavior after losing renewal (lease owner/fencing) before asserting strict cross-process safety.
- **T07-MULTI-005**: Node signaling uses process-local call state as described in spec; cross-instance delivery requires explicit architecture policy.

| Case | Priority | Status | Scenario |
|---|---|---|---|
| T07-ENV-001 | P0 | NOT_RUN | Chỉ thao tác lên container của run hiện tại |
| T07-ENV-002 | P0 | NOT_RUN | Dọn dịch vụ sau PASS |
| T07-ENV-003 | P0 | NEEDS_HOOK | Dọn sau FAIL assertion |
| T07-ENV-004 | P0 | NEEDS_HOOK | Trường hợp runner bị kill cứng |
| T07-ENV-005 | P1 | NEEDS_HOOK | Khôi phục snapshot sau tiêm lỗi |
| T07-ENV-006 | P1 | NEEDS_HOOK | Không nhầm lỗi hạ tầng với lỗi sản phẩm |
| T07-ENV-007 | P1 | NEEDS_HOOK | Đồng bộ bằng tín hiệu thay sleep cứng |
| T07-ENV-008 | P1 | NOT_RUN | Kiểm soát trễ và timeout test |
| T07-ENV-009 | P1 | NOT_RUN | Mỗi test chạy độc lập và ngẫu nhiên thứ tự |
| T07-ENV-010 | P2 | NOT_RUN | Ghi nhận phiên bản và môi trường tái lập |
| T07-AUTH-001 | P0 | NOT_RUN | Logout đồng thời nhiều HTTP request đang xử lý |
| T07-AUTH-002 | P0 | NOT_RUN | Logout và mở messaging WebSocket cùng thời điểm |
| T07-AUTH-003 | P0 | NOT_RUN | Logout và mở signaling WebSocket cùng thời điểm |
| T07-AUTH-004 | P0 | NEEDS_CONTRACT | Hai refresh đồng thời trên cùng một refresh token |
| T07-AUTH-005 | P0 | NEEDS_CONTRACT | Logout đồng thời refresh |
| T07-AUTH-006 | P1 | NOT_RUN | Nhiều login đồng thời cùng tài khoản |
| T07-AUTH-007 | P1 | NOT_RUN | Đăng ký cùng email đồng thời |
| T07-AUTH-008 | P1 | NOT_RUN | Thu hồi toàn bộ token khi xóa tài khoản cùng lúc dùng API |
| T07-AUTH-009 | P1 | NEEDS_CONTRACT | Redis thu hồi token bị gián đoạn khi logout |
| T07-AUTH-010 | P1 | NOT_RUN | Race token hết hạn và WS heartbeat |
| T07-AUTH-011 | P1 | NOT_RUN | Tài khoản xóa trong khi refresh và handshake |
| T07-AUTH-012 | P2 | NOT_RUN | Thử cùng lúc nhiều phiên login/logout độc lập |
| T07-CONV-001 | P0 | NOT_RUN | A và B cùng tạo hội thoại A–B |
| T07-CONV-002 | P0 | NOT_RUN | Nhiều request tạo cùng cặp hội thoại |
| T07-CONV-003 | P1 | NOT_RUN | Tạo hội thoại khi B bị xóa |
| T07-CONV-004 | P1 | NOT_RUN | Cập nhật updated_at bởi tin nhắn đồng thời |
| T07-CONV-005 | P1 | NOT_RUN | Cursor khi danh sách hội thoại đang thay đổi |
| T07-CONV-006 | P1 | NOT_RUN | Cursor ở biên timestamp bằng nhau |
| T07-CONV-007 | P1 | NOT_RUN | Xóa tài khoản khi đang đọc danh sách |
| T07-CONV-008 | P2 | NOT_RUN | Tạo cặp hội thoại độc lập đồng thời |
| T07-CONV-009 | P2 | NOT_RUN | Đọc chi tiết trong khi tạo hội thoại |
| T07-MSG-001 | P0 | NOT_RUN | Bốn request giống nhau cùng UUID — regression E05 |
| T07-MSG-002 | P0 | NOT_RUN | Nhiều UUID khác nhau cùng lúc |
| T07-MSG-003 | P0 | NOT_RUN | Cùng UUID nhưng người gửi khác |
| T07-MSG-004 | P0 | NOT_RUN | Cùng UUID nhưng hội thoại khác |
| T07-MSG-005 | P0 | NEEDS_HOOK | Retry sau mất response HTTP nhưng DB đã commit |
| T07-MSG-006 | P0 | NEEDS_HOOK | Retry sau transaction rollback |
| T07-MSG-007 | P1 | NOT_RUN | Timestamp hợp lệ khi nhiều thread gửi cùng lúc |
| T07-MSG-008 | P1 | NOT_RUN | Biên timestamp ±5 phút khi request bị chờ |
| T07-MSG-009 | P0 | NOT_RUN | Update read và delivered đồng thời |
| T07-MSG-010 | P0 | NOT_RUN | Update read nhiều lần đồng thời |
| T07-MSG-011 | P1 | NOT_RUN | Sender thử cập nhật trạng thái cạnh recipient |
| T07-MSG-012 | P1 | NOT_RUN | Cập nhật trạng thái đồng thời với xóa tài khoản |
| T07-MSG-013 | P1 | NOT_RUN | Phân trang lịch sử khi tin mới đến |
| T07-MSG-014 | P1 | NOT_RUN | Phân trang tin với timestamp trùng |
| T07-MSG-015 | P1 | NOT_RUN | Nhiều cuộc trò chuyện gửi đồng thời |
| T07-MSG-016 | P2 | NOT_RUN | Client hủy request khi server vẫn đang xử lý |
| T07-TX-001 | P0 | NEEDS_HOOK | Không phát NEW_MESSAGE trước DB commit |
| T07-TX-002 | P0 | NEEDS_HOOK | Rollback INSERT không phát event |
| T07-TX-003 | P0 | NEEDS_HOOK | Rollback status không phát MESSAGE_STATUS_UPDATE |
| T07-TX-004 | P0 | NEEDS_CONTRACT | DB commit thành công nhưng Redis publish lỗi |
| T07-TX-005 | P1 | NEEDS_HOOK | Redis publish chậm sau commit |
| T07-TX-006 | P1 | NOT_RUN | Giao dịch nhận message và chạm conversation atomic |
| T07-TX-007 | P1 | NEEDS_HOOK | Read committed không thấy dữ liệu chưa commit |
| T07-TX-008 | P1 | NOT_RUN | Không giữ transaction khi chờ dịch vụ chậm vô hạn |
| T07-TX-009 | P1 | NEEDS_HOOK | Tạo video: MinIO OK, Redis create session FAIL |
| T07-TX-010 | P1 | NEEDS_HOOK | Tạo video: MinIO OK, PostgreSQL INSERT FAIL |
| T07-TX-011 | P1 | NOT_RUN | Xóa tài khoản thất bại giữa cleanup video |
| T07-TX-012 | P2 | NOT_RUN | Sự kiện post-commit không tự cấp quyền transaction mới |
| T07-PUB-001 | P0 | NEEDS_HOOK | Gửi tin khi Redis Pub/Sub tạm mất |
| T07-PUB-002 | P0 | NEEDS_HOOK | Subscriber mất kết nối khi publish |
| T07-PUB-003 | P0 | NOT_RUN | Tin trùng do retry HTTP không gửi lại event |
| T07-PUB-004 | P1 | NOT_RUN | Sự kiện và response lệch thời điểm |
| T07-PUB-005 | P1 | NOT_RUN | Publish có payload Unicode và metadata chính xác |
| T07-PUB-006 | P1 | NOT_RUN | Một người nhận có nhiều socket |
| T07-PUB-007 | P1 | NEEDS_HOOK | Một socket gửi lỗi không hỏng tất cả receivers |
| T07-PUB-008 | P1 | NEEDS_HOOK | Subscriber restart rồi nhận các event mới |
| T07-PUB-009 | P1 | NOT_RUN | Đồng thời publish từ nhiều hội thoại |
| T07-PUB-010 | P2 | NOT_RUN | Payload Pub/Sub không hợp lệ |
| T07-PUB-011 | P2 | NOT_RUN | Redis subscriber backlog khi receiver chậm |
| T07-PUB-012 | P2 | NOT_RUN | Publish status update hai người nhận |
| T07-WS-001 | P0 | NOT_RUN | Đóng một trong nhiều socket không xóa socket khác |
| T07-WS-002 | P0 | NOT_RUN | Terminate đột ngột không leak session |
| T07-WS-003 | P0 | NOT_RUN | WebSocket token đã thu hồi trong phiên mở |
| T07-WS-004 | P0 | NEEDS_HOOK | Slow consumer vượt giới hạn buffer |
| T07-WS-005 | P1 | NOT_RUN | Heartbeat PING/PONG hoạt động bình thường |
| T07-WS-006 | P1 | NOT_RUN | Client im lặng không phản hồi PING |
| T07-WS-007 | P1 | NOT_RUN | Redis lỗi khi heartbeat kiểm tra thu hồi |
| T07-WS-008 | P1 | NOT_RUN | Nhiều client đồng thời reconnect |
| T07-WS-009 | P1 | NOT_RUN | WS handshake và logout tranh nhau |
| T07-WS-010 | P1 | NOT_RUN | WS gửi TYPING đồng thời nhiều tab |
| T07-WS-011 | P1 | NOT_RUN | Socket B đang đóng giữa fanout |
| T07-WS-012 | P1 | NOT_RUN | Scheduler shutdown và restart backend |
| T07-WS-013 | P2 | NOT_RUN | Client PONG trễ sát timeout |
| T07-WS-014 | P2 | NOT_RUN | Fragmented/large WS frame giới hạn |
| T07-WS-015 | P2 | NOT_RUN | Lặp 100 chu kỳ kết nối/đóng không tăng vô hạn |
| T07-WS-016 | P2 | NOT_RUN | Gửi sự kiện vào session thuộc user khác khi reconnect |
| T07-CALL-001 | P0 | NOT_RUN | Người nhận signaling muộn — regression E09 |
| T07-CALL-002 | P0 | NOT_RUN | Logout token vẫn mở signaling — regression E10 |
| T07-CALL-003 | P0 | NEEDS_CONTRACT | Hai CALL_OFFER đồng thời A→B |
| T07-CALL-004 | P0 | NEEDS_CONTRACT | A và B gọi nhau đồng thời |
| T07-CALL-005 | P0 | NEEDS_CONTRACT | CALL_END đến cùng lúc cả hai đầu |
| T07-CALL-006 | P1 | NEEDS_CONTRACT | CALL_ANSWER đến sát timeout 30 giây |
| T07-CALL-007 | P1 | NEEDS_CONTRACT | Caller rớt socket sau CALL_OFFER |
| T07-CALL-008 | P1 | NOT_RUN | Callee rớt socket giữa ANSWER và ICE |
| T07-CALL-009 | P1 | NOT_RUN | Offer đến trong lúc callee vừa đăng ký signaling |
| T07-CALL-010 | P1 | NOT_RUN | CALL_REJECT đồng thời CALL_END |
| T07-CALL-011 | P1 | NOT_RUN | Restart Node signaling khi có pending call |
| T07-CALL-012 | P1 | NOT_RUN | Spring call notify tạm không hoạt động |
| T07-CALL-013 | P1 | NEEDS_CONTRACT | Nhiều socket signaling cùng tài khoản |
| T07-CALL-014 | P2 | NOT_RUN | ICE đến sau CALL_END |
| T07-VID-001 | P0 | NEEDS_CONTRACT | Hai finalize đồng thời trên cùng upload |
| T07-VID-002 | P0 | NEEDS_CONTRACT | Finalize và abort đồng thời cùng video |
| T07-VID-003 | P0 | NEEDS_CONTRACT | Finalize và delete đồng thời |
| T07-VID-004 | P0 | NOT_RUN | Hai chunk-next đồng thời với part_number giống nhau |
| T07-VID-005 | P0 | NEEDS_CONTRACT | Hai chunk-next khác part_number đến đảo thứ tự |
| T07-VID-006 | P0 | NOT_RUN | Webhook Complete đến 2 lần giống nhau |
| T07-VID-007 | P0 | NEEDS_HOOK | Webhook đến trước response finalize |
| T07-VID-008 | P0 | NEEDS_HOOK | Webhook muộn sau abort |
| T07-VID-009 | P0 | NEEDS_HOOK | Webhook muộn sau delete video |
| T07-VID-010 | P0 | NOT_RUN | Khởi tạo video concurrent gần quota |
| T07-VID-011 | P0 | NOT_RUN | Finalize hai video cùng user chạm quota |
| T07-VID-012 | P1 | NOT_RUN | Hai người khác nhau finalize song song |
| T07-VID-013 | P1 | NOT_RUN | Finalize khi Redis upload session hết hạn |
| T07-VID-014 | P1 | NOT_RUN | Finalize khi part ETag thay đổi giữa các bước |
| T07-VID-015 | P1 | NEEDS_CONTRACT | MinIO complete thành công nhưng webhook không đến |
| T07-VID-016 | P1 | NEEDS_HOOK | MinIO complete lỗi sau khi đặt PROCESSING |
| T07-VID-017 | P1 | NOT_RUN | Presigned URL PUT đang chạy khi user abort |
| T07-VID-018 | P1 | NOT_RUN | Delete READY đồng thời GET view URL |
| T07-VID-019 | P1 | NOT_RUN | MinIO multipart orphan sau init lỗi |
| T07-VID-020 | P1 | NOT_RUN | Đổi title khi status đổi PROCESSING → READY |
| T07-VID-021 | P2 | NOT_RUN | Upload nhiều phần khi MinIO trả ETag không ổn định |
| T07-VID-022 | P2 | NOT_RUN | Nhiều video nhỏ tạo và abort liên tiếp |
| T07-LOCK-001 | P0 | NOT_RUN | Hai thao tác cùng video không cùng giữ lock |
| T07-LOCK-002 | P0 | NEEDS_HOOK | Release lock cũ không xóa khóa chủ mới |
| T07-LOCK-003 | P0 | NEEDS_HOOK | Renew từ owner cũ không gia hạn khóa mới |
| T07-LOCK-004 | P0 | NEEDS_CONTRACT | Mất lock renewal giữa thao tác dài |
| T07-LOCK-005 | P1 | NOT_RUN | Redis chết khi đang giữ lock |
| T07-LOCK-006 | P1 | NOT_RUN | Lock acquire timeout chính xác |
| T07-LOCK-007 | P1 | NOT_RUN | Ngắt thread trong lúc chờ lock |
| T07-LOCK-008 | P1 | NOT_RUN | Quota lock cùng user ngăn overcommit |
| T07-LOCK-009 | P1 | NOT_RUN | Lock khác user không cạnh tranh không cần thiết |
| T07-LOCK-010 | P1 | NOT_RUN | Atomic Redis upload session update tranh nhau |
| T07-LOCK-011 | P1 | NOT_RUN | Message status pessimistic row lock |
| T07-LOCK-012 | P2 | NOT_RUN | Hàng loạt contention ngắn không để lock treo |
| T07-FAIL-001 | P0 | NEEDS_HOOK | PostgreSQL không khả dụng khi login |
| T07-FAIL-002 | P0 | NEEDS_HOOK | PostgreSQL mất giữa gửi tin |
| T07-FAIL-003 | P0 | NEEDS_HOOK | Redis không khả dụng khi JWT kiểm tra revoke |
| T07-FAIL-004 | P0 | NEEDS_HOOK | Redis mất khi lưu phiên upload |
| T07-FAIL-005 | P0 | NEEDS_HOOK | MinIO không khả dụng trong create upload |
| T07-FAIL-006 | P0 | NEEDS_HOOK | MinIO lỗi giữa complete multipart |
| T07-FAIL-007 | P1 | NEEDS_HOOK | Redis subscriber mất nhưng Redis key ops còn hoạt động |
| T07-FAIL-008 | P1 | NEEDS_HOOK | Backend không tới được Node signaling |
| T07-FAIL-009 | P1 | NEEDS_HOOK | Node signaling gọi internal notify timeout |
| T07-FAIL-010 | P1 | NEEDS_HOOK | Mạng MinIO có độ trễ lớn nhưng chưa chết |
| T07-FAIL-011 | P1 | NOT_RUN | Database pool hết connection tạm thời |
| T07-FAIL-012 | P1 | NOT_RUN | Redis rate limit key không có TTL sau crash giữa INCR–EXPIRE |
| T07-FAIL-013 | P2 | NOT_RUN | DNS/hostname của phụ thuộc thay đổi giữa request |
| T07-REC-001 | P0 | NEEDS_HOOK | Restart backend sau message đã commit |
| T07-REC-002 | P0 | NEEDS_HOOK | Restart backend trước commit message |
| T07-REC-003 | P0 | NOT_RUN | Restart backend khi video PROCESSING |
| T07-REC-004 | P0 | NEEDS_HOOK | Cleanup job thất bại khi xóa object |
| T07-REC-005 | P0 | NEEDS_HOOK | Restart giữa retry cleanup job |
| T07-REC-006 | P1 | NOT_RUN | Timeout cleanup bắt video PROCESSING quá hạn |
| T07-REC-007 | P1 | NOT_RUN | Cleanup scheduler không chạy trùng khi restart |
| T07-REC-008 | P1 | NOT_RUN | Poison cleanup job không chặn jobs sau |
| T07-REC-009 | P1 | NOT_RUN | Backoff retry tăng đúng và có giới hạn |
| T07-REC-010 | P1 | NOT_RUN | Account deletion có video đang upload |
| T07-REC-011 | P1 | NOT_RUN | Orphan MinIO multipart có thể được liệt kê và xử lý |
| T07-REC-012 | P2 | NOT_RUN | Khôi phục sau reboot Docker Engine của lab |
| T07-MULTI-001 | P1 | NEEDS_HOOK | Redis Pub/Sub fanout hai Spring instances |
| T07-MULTI-002 | P1 | NEEDS_HOOK | Client reconnect qua instance khác |
| T07-MULTI-003 | P1 | NEEDS_HOOK | Video finalize qua hai Java instances |
| T07-MULTI-004 | P1 | NEEDS_HOOK | Scheduled cleanup jobs chạy ở cả hai instances |
| T07-MULTI-005 | P1 | NEEDS_CONTRACT | Signaling A và B nằm hai Node instances |
| T07-MULTI-006 | P2 | NEEDS_HOOK | Một Node signaling instance chết giữa cuộc gọi |
| T07-MULTI-007 | P2 | NEEDS_HOOK | Load balancer không đưa WebSocket tới instance chết |
| T07-MULTI-008 | P2 | NOT_RUN | Session tokens giữa nhiều backend instances |
| T07-OBS-001 | P0 | NOT_RUN | Mỗi test có oracle trạng thái cuối |
| T07-OBS-002 | P0 | NOT_RUN | Phân loại lỗi product/test/environment/contract |
| T07-OBS-003 | P0 | NOT_RUN | Phát hiện và chặn false PASS do thiếu event |
| T07-OBS-004 | P1 | NOT_RUN | Evidence timeline bằng monotonic clock |
| T07-OBS-005 | P1 | NOT_RUN | Test race lặp nhiều vòng có cùng seed |
| T07-OBS-006 | P1 | NOT_RUN | Fault injection có điểm đặt chính xác |
| T07-OBS-007 | P1 | NOT_RUN | Không rò secret qua artifact fault log |
| T07-OBS-008 | P1 | NOT_RUN | Không có resource drift sau suite |
| T07-OBS-009 | P1 | NOT_RUN | Tạo báo cáo giới hạn đã biết cho T08 |
| T07-OBS-010 | P2 | NOT_RUN | Đối chiếu kết quả E09/E10 lịch sử |
