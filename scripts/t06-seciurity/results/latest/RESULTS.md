# T06 Security test results

- Run ID: veiltalk-e2e-1793132142991-73975d
- Time (UTC): 2026-10-27T20:24:08.868Z
- Stack: Spring Boot JAR, Node signaling, PostgreSQL, Redis, MinIO with webhook
- Test executions: 175; case IDs PASS: 178; REVIEW_REQUIRED: 0; NEEDS_CONTRACT: 0; N/A: 2; NOT RUN: 26
- BOLA-009 contract decision (owner, 2026-10-19): nonowner GET /videos/{id} must be denied entirely.
- ABUSE-006/007, WSM-014 and LOG-010 policies were confirmed on 2026-10-19. A case remains NOT RUN until tested; LOG-010 requires production log retention verification.
- AUTH-022 N/A: No password reset/update endpoint exists in the current AuthController or UserProfileController; the scenario explicitly permits N/A in that case.
- SUPPLY-006 N/A: No CI workflow or pipeline manifest exists in the current repository; there is no CI credential scope to inspect yet. Reopen when CI is added.
- PASS applies only to rows marked PASS. This run does not establish T06 acceptance or system-wide security coverage.

| Case | Priority | Status | Scenario |
|---|---|---|---|
| AUTH-001 | P0 | PASS | Đăng ký tạo mật khẩu lưu an toàn |
| AUTH-002 | P0 | PASS | Đăng nhập đúng và sai không lộ bí mật |
| AUTH-003 | P0 | PASS | Không token gọi toàn bộ API bảo vệ |
| AUTH-004 | P0 | PASS | Chữ ký JWT bị sửa |
| AUTH-005 | P0 | PASS | Payload JWT bị sửa không ký lại |
| AUTH-006 | P0 | PASS | JWT alg none và thuật toán khác |
| AUTH-007 | P0 | PASS | Refresh token dùng thay access |
| AUTH-008 | P0 | PASS | Access token dùng thay refresh |
| AUTH-009 | P0 | PASS | JWT đã hết hạn |
| AUTH-010 | P0 | PASS | Logout thu hồi access ở HTTP |
| AUTH-011 | P0 | PASS | Logout thu hồi access ở messaging WS |
| AUTH-012 | P0 | PASS | Logout thu hồi access ở signaling |
| AUTH-013 | P0 | PASS | Logout không thu hồi nhầm người khác |
| AUTH-014 | P1 | PASS | Thu hồi access sau xóa tài khoản |
| AUTH-015 | P1 | PASS | Thu hồi refresh token sau logout |
| AUTH-016 | P1 | PASS | Refresh token giả không có bản ghi DB |
| AUTH-017 | P1 | PASS | Refresh token của A không logout phiên B |
| AUTH-018 | P1 | PASS | Cấu trúc Bearer header bất thường |
| AUTH-019 | P1 | PASS | JWT thiếu claim bắt buộc |
| AUTH-020 | P1 | PASS | JWT iat tương lai, exp ngược |
| AUTH-021 | P1 | PASS | Token kích thước bất thường |
| AUTH-022 | P1 | N/A | Mật khẩu reset/cập nhật không tồn tại |
| AUTH-023 | P1 | PASS | Không kéo dài access token bằng đổi client clock |
| AUTH-024 | P1 | PASS | Session cố định hoặc tái sử dụng token khi login |
| BOLA-001 | P0 | PASS | C đọc chi tiết hội thoại A-B |
| BOLA-002 | P0 | PASS | C đọc danh sách tin nhắn A-B |
| BOLA-003 | P0 | PASS | C gửi tin vào hội thoại A-B |
| BOLA-004 | P0 | PASS | C cập nhật trạng thái tin A-B |
| BOLA-005 | P0 | PASS | B thao tác tin trong hội thoại khác |
| BOLA-006 | P0 | PASS | A sửa upload video của B |
| BOLA-007 | P0 | PASS | A finalize video B |
| BOLA-008 | P0 | PASS | A abort video B |
| BOLA-009 | P0 | PASS | A xem video riêng B |
| BOLA-010 | P0 | PASS | A xóa video B |
| BOLA-011 | P0 | PASS | A đổi tên video B |
| BOLA-012 | P1 | PASS | A thử điều khiển session upload của B bằng upload_id |
| BOLA-013 | P1 | PASS | Lịch sử hội thoại cursor của người khác |
| BOLA-014 | P1 | PASS | Model avatar public không lộ trường private |
| BOLA-015 | P1 | PASS | Đối tượng bị xóa mềm không thể truy cập lại |
| BOLA-016 | P1 | PASS | C không phát typing vào hội thoại A-B |
| BOLA-017 | P1 | PASS | ID ngẫu nhiên không cho phép liệt kê dữ liệu |
| BOLA-018 | P1 | PASS | Không chiếm quyền dữ liệu qua JSON user_id |
| BFLA-001 | P0 | PASS | Không gọi internal call notify bằng JWT thường |
| BFLA-002 | P0 | PASS | Không gọi internal webhook bằng JWT thường |
| BFLA-003 | P0 | PASS | Không gọi internal bằng secret sai |
| BFLA-004 | P0 | PASS | Phân biệt endpoint public và protected |
| BFLA-005 | P0 | PASS | Không tự nâng role bằng API hồ sơ |
| BFLA-006 | P0 | PASS | Không tự đổi user_id hoặc deleted_at |
| BFLA-007 | P0 | PASS | Không tự đặt sender_id trong tin nhắn |
| BFLA-008 | P0 | PASS | Không tự đặt video owner/quota/status |
| BFLA-009 | P1 | PASS | Không dùng HTTP method khác để qua filter internal |
| BFLA-010 | P1 | PASS | Không mạo danh admin bằng claim sai |
| BFLA-011 | P1 | PASS | Không sửa trạng thái qua trường response-only |
| BFLA-012 | P1 | PASS | Phân quyền xóa tài khoản yêu cầu đúng mật khẩu |
| BFLA-013 | P1 | PASS | Không truy cập endpoint chưa xuất bản |
| BFLA-014 | P1 | PASS | CORS preflight không cấp quyền backend |
| WSM-001 | P0 | PASS | Handshake thiếu token |
| WSM-002 | P0 | PASS | Handshake hai token hoặc token rỗng |
| WSM-003 | P0 | PASS | Handshake access token bị sửa |
| WSM-004 | P0 | PASS | Handshake token đã logout |
| WSM-005 | P0 | PASS | Handshake tài khoản xóa mềm |
| WSM-006 | P0 | PASS | Handshake Origin lạ |
| WSM-007 | P0 | PASS | Typing không thể giả user |
| WSM-008 | P0 | PASS | Không nhận sự kiện của user khác |
| WSM-009 | P0 | PASS | Logout khi socket đã mở |
| WSM-010 | P1 | PASS | Hết hạn token khi socket đang mở |
| WSM-011 | P1 | PASS | Tin nhắn JSON bị lỗi |
| WSM-012 | P1 | PASS | Type ngoài allowlist |
| WSM-013 | P1 | PASS | Payload quá lớn |
| WSM-014 | P1 | PASS | Liên tiếp sai contract đến ngưỡng |
| WSM-015 | P1 | PASS | PONG giả không làm nâng quyền |
| WSM-016 | P1 | PASS | Nhiều tab cùng user nhưng cô lập xác thực |
| WSM-017 | P1 | PASS | Không lộ JWT trong lỗi/log handshake |
| WSM-018 | P1 | PASS | Heartbeat không bỏ qua kiểm tra quyền |
| WSM-019 | P1 | PASS | Không giữ event trái quyền trong buffer |
| SIG-001 | P0 | PASS | Token logout bị signaling từ chối |
| SIG-002 | P0 | PASS | Token không hợp lệ bị từ chối |
| SIG-003 | P0 | PASS | Token refresh không trở thành access signaling |
| SIG-004 | P0 | PASS | Không giả from_user_id trong CALL_OFFER |
| SIG-005 | P0 | PASS | Không giả người trả lời cuộc gọi |
| SIG-006 | P0 | PASS | Không kết thúc cuộc gọi người khác |
| SIG-007 | P0 | PASS | B kết nối signaling sau CALL_INCOMING |
| SIG-008 | P0 | PASS | Không chuyển offer bị lưu cho tài khoản khác |
| SIG-009 | P0 | PASS | Không relay ICE tới target tùy ý |
| SIG-010 | P1 | PASS | Offer lại khi đang pending |
| SIG-011 | P1 | PASS | Answer trước offer |
| SIG-012 | P1 | PASS | ICE sau END hoặc REJECT |
| SIG-013 | P1 | PASS | Không giả call id hoặc session id |
| SIG-014 | P1 | PASS | Tài khoản bị xóa đang có signaling |
| SIG-015 | P1 | PASS | Giới hạn kết nối theo IP/user |
| SIG-016 | P1 | PASS | Token ký khác key/backend |
| SIG-017 | P1 | PASS | Không đưa JWT qua log signaling |
| SIG-018 | P1 | PASS | Không giữ pending offer vô hạn |
| SIG-019 | P1 | PASS | Chống nhầm hai cuộc gọi đồng thời |
| SIG-020 | P1 | PASS | Không tiết lộ nội dung signaling qua notify nội bộ |
| SIG-021 | P1 | PASS | Kết nối đang mở sau logout |
| VID-001 | P0 | PASS | Owner không thể đọc object video người khác |
| VID-002 | P0 | PASS | Không chiếm quyền upload bằng video ID B |
| VID-003 | P0 | PASS | Không chiếm quyền finalize bằng upload_id B |
| VID-004 | P0 | PASS | Không chiếm quyền abort bằng upload_id B |
| VID-005 | P0 | PASS | Presigned URL bị thay đổi chữ ký |
| VID-006 | P0 | NOT RUN | Presigned URL hết hạn |
| VID-007 | P0 | PASS | Webhook giả không có secret |
| VID-008 | P0 | PASS | Webhook secret sai hoặc access JWT |
| VID-009 | P0 | PASS | Webhook đúng secret nhưng object không khớp |
| VID-010 | P0 | NOT RUN | Quota không vượt bằng giá trị ước tính nhỏ |
| VID-011 | P0 | PASS | Không hoàn tất upload với ETag giả |
| VID-012 | P0 | PASS | Không hoàn tất với missing/duplicate part |
| VID-013 | P1 | PASS | URL GET không rò qua JSON người ngoài |
| VID-014 | P1 | PASS | Đóng session upload rồi URL cũ không dùng tiếp |
| VID-015 | P1 | PASS | Không dùng một URL cho part/object khác |
| VID-016 | P1 | PASS | Object key được cô lập |
| VID-017 | P1 | NOT RUN | Multipart rác sau lỗi khởi tạo |
| VID-018 | P1 | PASS | Webhook lặp nhiều lần |
| VID-019 | P1 | PASS | Webhook đến sau DELETE/ABORT |
| VID-020 | P1 | PASS | Chống content-type hoặc extension giả |
| VID-021 | P1 | PASS | Không lộ MinIO access key trong response |
| VID-022 | P1 | PASS | Chỉ được xóa object của owner |
| VID-023 | P1 | PASS | Không phát URL download khi video chưa READY |
| VID-024 | P1 | PASS | Client không tự sửa file_size_bytes/status |
| VID-025 | P1 | PASS | Đường webhook không truy cập bằng CORS/origin |
| VID-026 | P1 | PASS | Presigned URL không bị log toàn chuỗi |
| INPUT-001 | P0 | PASS | JSON syntax hỏng trên endpoint bảo vệ |
| INPUT-002 | P0 | PASS | Mass assignment user/role |
| INPUT-003 | P0 | PASS | SQL injection qua search |
| INPUT-004 | P0 | PASS | SQL injection qua cursor/ID |
| INPUT-005 | P1 | PASS | Trường JSON null/sai type |
| INPUT-006 | P1 | PASS | Giá trị quá dài và nested sâu có giới hạn |
| INPUT-007 | P1 | PASS | Unicode và ký tự điều khiển trong display_name/content |
| INPUT-008 | P1 | PASS | Script trong display_name hoặc tin nhắn |
| INPUT-009 | P1 | PASS | Format video có ký tự điều hướng đường dẫn |
| INPUT-010 | P1 | PASS | Header injection ở các trường hiển thị |
| INPUT-011 | P1 | PASS | Request content-type sai |
| INPUT-012 | P1 | PASS | HTTP method override không vượt xác thực |
| INPUT-013 | P1 | PASS | Duplicate JSON keys nhạy cảm |
| INPUT-014 | P1 | PASS | Error handler không lộ stacktrace/SQL |
| INPUT-015 | P1 | PASS | Tham số phân trang không giới hạn dữ liệu |
| INPUT-016 | P2 | PASS | Content encoding không được hỗ trợ |
| ABUSE-001 | P0 | PASS | Giới hạn tìm kiếm user theo tài khoản |
| ABUSE-002 | P1 | PASS | Rate limit search cách ly A và B |
| ABUSE-003 | P1 | PASS | Rate limit metrics mỗi 3 giây |
| ABUSE-004 | P1 | PASS | Không bypass rate limit qua header giả |
| ABUSE-005 | P1 | PASS | Rate limit đổi key sau TTL đúng |
| ABUSE-006 | P1 | NOT RUN | Đăng nhập sai nhiều lần có biện pháp chống lạm dụng |
| ABUSE-007 | P1 | NOT RUN | Đăng ký hàng loạt tài khoản |
| ABUSE-008 | P1 | PASS | Kết nối WebSocket vượt giới hạn |
| ABUSE-009 | P1 | PASS | Gửi sự kiện WS sai liên tục |
| ABUSE-010 | P1 | PASS | Video quota theo user |
| ABUSE-011 | P1 | NOT RUN | Không mở số lượng phiên multipart vô hạn |
| ABUSE-012 | P2 | PASS | Đối xử công bằng khi một client lỗi liên tiếp |
| INT-001 | P0 | PASS | Không secret tại notify |
| INT-002 | P0 | PASS | JWT người dùng không thay secret notify |
| INT-003 | P0 | PASS | Notify secret sai không có tác dụng |
| INT-004 | P0 | PASS | Không secret tại webhook |
| INT-005 | P0 | PASS | Webhook JWT không thay shared secret |
| INT-006 | P0 | PASS | Không thể dùng secret notify ở webhook |
| INT-007 | P1 | PASS | Secret so sánh chính xác từng byte |
| INT-008 | P1 | PASS | Notify body hợp lệ nhưng actor sai |
| INT-009 | P1 | PASS | Webhook secret đúng nhưng event giả |
| INT-010 | P1 | PASS | Không lộ endpoint nội bộ qua response lỗi |
| INT-011 | P1 | NOT RUN | Giới hạn mạng của API nội bộ khi triển khai |
| INT-012 | P1 | PASS | Webhook replay sau khi video đã xóa |
| CONFIG-001 | P0 | PASS | CORS không cho origin trái phép |
| CONFIG-002 | P0 | PASS | Messaging WS kiểm tra Origin |
| CONFIG-003 | P0 | NOT RUN | Không lộ PostgreSQL/Redis/MinIO ra Internet |
| CONFIG-004 | P0 | PASS | Secret không dùng giá trị mặc định hoặc quá ngắn |
| CONFIG-005 | P0 | NOT RUN | HTTPS/WSS bắt buộc ở môi trường public |
| CONFIG-006 | P1 | NOT RUN | Security headers được phát ở đường HTTP thật |
| CONFIG-007 | P1 | PASS | Actuator chỉ mở endpoint được phép |
| CONFIG-008 | P1 | PASS | Lỗi 404/500 không hiện stacktrace |
| CONFIG-009 | P1 | NOT RUN | Bí mật không nằm trong image, env dump hoặc build artifact công khai |
| CONFIG-010 | P1 | NOT RUN | Docker không chạy quyền quá cao |
| CONFIG-011 | P1 | NOT RUN | Nginx route không vượt filter |
| CONFIG-012 | P1 | NOT RUN | Proxy forwarding headers được tin đúng mức |
| CONFIG-013 | P1 | NOT RUN | Không cache response nhạy cảm ở proxy |
| CONFIG-014 | P1 | NOT RUN | Kiểm tra Content Security Policy phía frontend nếu triển khai |
| CONFIG-015 | P1 | NOT RUN | Time sync của server |
| LOG-001 | P0 | PASS | Access/refresh không xuất hiện trong log |
| LOG-002 | P0 | PASS | Mật khẩu không bị log hoặc trả lại |
| LOG-003 | P0 | PASS | Presigned URL không lộ toàn chuỗi |
| LOG-004 | P0 | PASS | Shared secret internal không xuất hiện trong log |
| LOG-005 | P1 | PASS | Error response không lộ SQL và đường dẫn nội bộ |
| LOG-006 | P1 | PASS | Telemetry không in token hoặc nội dung riêng |
| LOG-007 | P1 | PASS | Không lộ thông tin người khác qua errors |
| LOG-008 | P1 | NOT RUN | Audit các thao tác bảo mật quan trọng |
| LOG-009 | P1 | PASS | Không lộ thông tin qua JUnit XML |
| LOG-010 | P1 | NOT RUN | Giới hạn thông tin được lưu và xóa |
| LOG-011 | P1 | PASS | Không hiển thị secret trong health/metrics |
| SUPPLY-001 | P0 | NOT RUN | Quét lỗ hổng dependency Java |
| SUPPLY-002 | P0 | NOT RUN | Quét lỗ hổng dependency signaling |
| SUPPLY-003 | P1 | NOT RUN | Dependency được khóa phiên bản và build tái lập |
| SUPPLY-004 | P1 | NOT RUN | Container images cập nhật và rõ nguồn |
| SUPPLY-005 | P1 | NOT RUN | Không commit secret hoặc private key |
| SUPPLY-006 | P1 | N/A | Không cấp CI credential dư quyền |
| SUPPLY-007 | P1 | NOT RUN | Không tải script hoặc binary không kiểm soát khi build |
| SUPPLY-008 | P2 | NOT RUN | SBOM và danh sách phiên bản phát hành |
| CROSS-001 | P0 | PASS | Đăng xuất rồi dùng token cũ ở mọi kênh |
| CROSS-002 | P0 | PASS | Người ngoài không thể tương tác hội thoại bằng nhiều kênh |
| CROSS-003 | P0 | PASS | Không lạm dụng callback notify để mạo danh cuộc gọi |
| CROSS-004 | P0 | PASS | Video ownership xuyên metadata và presigned URL |
| CROSS-005 | P0 | PASS | Xóa tài khoản hủy quyền theo mọi kênh |
| CROSS-006 | P0 | PASS | Thu hồi token và đổi phiên nhiều thiết bị |
| CROSS-007 | P1 | PASS | Payload phản hồi không làm lộ secret thông qua E2E lỗi |
| CROSS-008 | P1 | PASS | CORS/browser và auth backend là lớp khác nhau |
| CROSS-009 | P1 | PASS | Thông báo cuộc gọi không biến thành quyền nhận Offer giả |
| CROSS-010 | P1 | PASS | Xử lý lỗi internal service fail closed |
