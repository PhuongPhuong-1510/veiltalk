# T06 combined status

- latest: veiltalk-e2e-1793132142991-73975d, exit 0
- abuse: veiltalk-e2e-1793132654262-8374fd, exit 0
- quota: veiltalk-e2e-1793132710089-be9fc0, exit 0
- multipart: veiltalk-e2e-1793132762014-305cc1, exit 0
- expiry: veiltalk-e2e-1793132817762-b58547, exit 0
- remaining: veiltalk-e2e-1793175077242-169b79, exit 1
- supply: veiltalk-supply-1793175124629-8ab4c1, exit 1
- 206 case IDs: 190 PASS, 5 REVIEW_REQUIRED, 0 NEEDS_CONTRACT, 2 N/A, 9 NOT RUN.
- PASS covers only the tested assertions. LOG-010 retention remains NOT RUN pending verification on the production-equivalent host.
- CONFIG-003 is REVIEW_REQUIRED: docker-compose.yml publishes PostgreSQL 5432, Redis 6379, and MinIO 9000/9001 on all host interfaces.
- VID-017 is REVIEW_REQUIRED: the compensation regression test confirms a Redis session failure does not abort the MinIO multipart created earlier.
- AUTH-022 N/A: No password reset/update endpoint exists in the current AuthController or UserProfileController; the scenario explicitly permits N/A in that case.
- SUPPLY-006 N/A: No CI workflow or pipeline manifest exists in the current repository; there is no CI credential scope to inspect yet. Reopen when CI is added.

| Case | Priority | Status | Run | Scenario |
|---|---|---|---|---|
| AUTH-001 | P0 | PASS | latest | Đăng ký tạo mật khẩu lưu an toàn |
| AUTH-002 | P0 | PASS | latest | Đăng nhập đúng và sai không lộ bí mật |
| AUTH-003 | P0 | PASS | latest | Không token gọi toàn bộ API bảo vệ |
| AUTH-004 | P0 | PASS | latest | Chữ ký JWT bị sửa |
| AUTH-005 | P0 | PASS | latest | Payload JWT bị sửa không ký lại |
| AUTH-006 | P0 | PASS | latest | JWT alg none và thuật toán khác |
| AUTH-007 | P0 | PASS | latest | Refresh token dùng thay access |
| AUTH-008 | P0 | PASS | latest | Access token dùng thay refresh |
| AUTH-009 | P0 | PASS | latest | JWT đã hết hạn |
| AUTH-010 | P0 | PASS | latest | Logout thu hồi access ở HTTP |
| AUTH-011 | P0 | PASS | latest | Logout thu hồi access ở messaging WS |
| AUTH-012 | P0 | PASS | latest | Logout thu hồi access ở signaling |
| AUTH-013 | P0 | PASS | latest | Logout không thu hồi nhầm người khác |
| AUTH-014 | P1 | PASS | latest | Thu hồi access sau xóa tài khoản |
| AUTH-015 | P1 | PASS | latest | Thu hồi refresh token sau logout |
| AUTH-016 | P1 | PASS | latest | Refresh token giả không có bản ghi DB |
| AUTH-017 | P1 | PASS | latest | Refresh token của A không logout phiên B |
| AUTH-018 | P1 | PASS | latest | Cấu trúc Bearer header bất thường |
| AUTH-019 | P1 | PASS | latest | JWT thiếu claim bắt buộc |
| AUTH-020 | P1 | PASS | latest | JWT iat tương lai, exp ngược |
| AUTH-021 | P1 | PASS | latest | Token kích thước bất thường |
| AUTH-022 | P1 | N/A |  | Mật khẩu reset/cập nhật không tồn tại |
| AUTH-023 | P1 | PASS | latest | Không kéo dài access token bằng đổi client clock |
| AUTH-024 | P1 | PASS | latest | Session cố định hoặc tái sử dụng token khi login |
| BOLA-001 | P0 | PASS | latest | C đọc chi tiết hội thoại A-B |
| BOLA-002 | P0 | PASS | latest | C đọc danh sách tin nhắn A-B |
| BOLA-003 | P0 | PASS | latest | C gửi tin vào hội thoại A-B |
| BOLA-004 | P0 | PASS | latest | C cập nhật trạng thái tin A-B |
| BOLA-005 | P0 | PASS | latest | B thao tác tin trong hội thoại khác |
| BOLA-006 | P0 | PASS | latest | A sửa upload video của B |
| BOLA-007 | P0 | PASS | latest | A finalize video B |
| BOLA-008 | P0 | PASS | latest | A abort video B |
| BOLA-009 | P0 | PASS | latest | A xem video riêng B |
| BOLA-010 | P0 | PASS | latest | A xóa video B |
| BOLA-011 | P0 | PASS | latest | A đổi tên video B |
| BOLA-012 | P1 | PASS | latest | A thử điều khiển session upload của B bằng upload_id |
| BOLA-013 | P1 | PASS | latest | Lịch sử hội thoại cursor của người khác |
| BOLA-014 | P1 | PASS | latest | Model avatar public không lộ trường private |
| BOLA-015 | P1 | PASS | latest | Đối tượng bị xóa mềm không thể truy cập lại |
| BOLA-016 | P1 | PASS | latest | C không phát typing vào hội thoại A-B |
| BOLA-017 | P1 | PASS | latest | ID ngẫu nhiên không cho phép liệt kê dữ liệu |
| BOLA-018 | P1 | PASS | latest | Không chiếm quyền dữ liệu qua JSON user_id |
| BFLA-001 | P0 | PASS | latest | Không gọi internal call notify bằng JWT thường |
| BFLA-002 | P0 | PASS | latest | Không gọi internal webhook bằng JWT thường |
| BFLA-003 | P0 | PASS | latest | Không gọi internal bằng secret sai |
| BFLA-004 | P0 | PASS | latest | Phân biệt endpoint public và protected |
| BFLA-005 | P0 | PASS | latest | Không tự nâng role bằng API hồ sơ |
| BFLA-006 | P0 | PASS | latest | Không tự đổi user_id hoặc deleted_at |
| BFLA-007 | P0 | PASS | latest | Không tự đặt sender_id trong tin nhắn |
| BFLA-008 | P0 | PASS | latest | Không tự đặt video owner/quota/status |
| BFLA-009 | P1 | PASS | latest | Không dùng HTTP method khác để qua filter internal |
| BFLA-010 | P1 | PASS | latest | Không mạo danh admin bằng claim sai |
| BFLA-011 | P1 | PASS | latest | Không sửa trạng thái qua trường response-only |
| BFLA-012 | P1 | PASS | latest | Phân quyền xóa tài khoản yêu cầu đúng mật khẩu |
| BFLA-013 | P1 | PASS | latest | Không truy cập endpoint chưa xuất bản |
| BFLA-014 | P1 | PASS | latest | CORS preflight không cấp quyền backend |
| WSM-001 | P0 | PASS | latest | Handshake thiếu token |
| WSM-002 | P0 | PASS | latest | Handshake hai token hoặc token rỗng |
| WSM-003 | P0 | PASS | latest | Handshake access token bị sửa |
| WSM-004 | P0 | PASS | latest | Handshake token đã logout |
| WSM-005 | P0 | PASS | latest | Handshake tài khoản xóa mềm |
| WSM-006 | P0 | PASS | latest | Handshake Origin lạ |
| WSM-007 | P0 | PASS | latest | Typing không thể giả user |
| WSM-008 | P0 | PASS | latest | Không nhận sự kiện của user khác |
| WSM-009 | P0 | PASS | latest | Logout khi socket đã mở |
| WSM-010 | P1 | PASS | latest | Hết hạn token khi socket đang mở |
| WSM-011 | P1 | PASS | latest | Tin nhắn JSON bị lỗi |
| WSM-012 | P1 | PASS | latest | Type ngoài allowlist |
| WSM-013 | P1 | PASS | latest | Payload quá lớn |
| WSM-014 | P1 | PASS | latest | Liên tiếp sai contract đến ngưỡng |
| WSM-015 | P1 | PASS | latest | PONG giả không làm nâng quyền |
| WSM-016 | P1 | PASS | latest | Nhiều tab cùng user nhưng cô lập xác thực |
| WSM-017 | P1 | PASS | latest | Không lộ JWT trong lỗi/log handshake |
| WSM-018 | P1 | PASS | latest | Heartbeat không bỏ qua kiểm tra quyền |
| WSM-019 | P1 | PASS | latest | Không giữ event trái quyền trong buffer |
| SIG-001 | P0 | PASS | latest | Token logout bị signaling từ chối |
| SIG-002 | P0 | PASS | latest | Token không hợp lệ bị từ chối |
| SIG-003 | P0 | PASS | latest | Token refresh không trở thành access signaling |
| SIG-004 | P0 | PASS | latest | Không giả from_user_id trong CALL_OFFER |
| SIG-005 | P0 | PASS | latest | Không giả người trả lời cuộc gọi |
| SIG-006 | P0 | PASS | latest | Không kết thúc cuộc gọi người khác |
| SIG-007 | P0 | PASS | latest | B kết nối signaling sau CALL_INCOMING |
| SIG-008 | P0 | PASS | latest | Không chuyển offer bị lưu cho tài khoản khác |
| SIG-009 | P0 | PASS | latest | Không relay ICE tới target tùy ý |
| SIG-010 | P1 | PASS | latest | Offer lại khi đang pending |
| SIG-011 | P1 | PASS | latest | Answer trước offer |
| SIG-012 | P1 | PASS | latest | ICE sau END hoặc REJECT |
| SIG-013 | P1 | PASS | latest | Không giả call id hoặc session id |
| SIG-014 | P1 | PASS | latest | Tài khoản bị xóa đang có signaling |
| SIG-015 | P1 | PASS | latest | Giới hạn kết nối theo IP/user |
| SIG-016 | P1 | PASS | latest | Token ký khác key/backend |
| SIG-017 | P1 | PASS | latest | Không đưa JWT qua log signaling |
| SIG-018 | P1 | PASS | latest | Không giữ pending offer vô hạn |
| SIG-019 | P1 | PASS | latest | Chống nhầm hai cuộc gọi đồng thời |
| SIG-020 | P1 | PASS | latest | Không tiết lộ nội dung signaling qua notify nội bộ |
| SIG-021 | P1 | PASS | latest | Kết nối đang mở sau logout |
| VID-001 | P0 | PASS | latest | Owner không thể đọc object video người khác |
| VID-002 | P0 | PASS | latest | Không chiếm quyền upload bằng video ID B |
| VID-003 | P0 | PASS | latest | Không chiếm quyền finalize bằng upload_id B |
| VID-004 | P0 | PASS | latest | Không chiếm quyền abort bằng upload_id B |
| VID-005 | P0 | PASS | latest | Presigned URL bị thay đổi chữ ký |
| VID-006 | P0 | PASS | expiry | Presigned URL hết hạn |
| VID-007 | P0 | PASS | latest | Webhook giả không có secret |
| VID-008 | P0 | PASS | latest | Webhook secret sai hoặc access JWT |
| VID-009 | P0 | PASS | latest | Webhook đúng secret nhưng object không khớp |
| VID-010 | P0 | PASS | quota | Quota không vượt bằng giá trị ước tính nhỏ |
| VID-011 | P0 | PASS | latest | Không hoàn tất upload với ETag giả |
| VID-012 | P0 | PASS | latest | Không hoàn tất với missing/duplicate part |
| VID-013 | P1 | PASS | latest | URL GET không rò qua JSON người ngoài |
| VID-014 | P1 | PASS | latest | Đóng session upload rồi URL cũ không dùng tiếp |
| VID-015 | P1 | PASS | latest | Không dùng một URL cho part/object khác |
| VID-016 | P1 | PASS | latest | Object key được cô lập |
| VID-017 | P1 | REVIEW_REQUIRED | remaining | Multipart rác sau lỗi khởi tạo |
| VID-018 | P1 | PASS | latest | Webhook lặp nhiều lần |
| VID-019 | P1 | PASS | latest | Webhook đến sau DELETE/ABORT |
| VID-020 | P1 | PASS | latest | Chống content-type hoặc extension giả |
| VID-021 | P1 | PASS | latest | Không lộ MinIO access key trong response |
| VID-022 | P1 | PASS | latest | Chỉ được xóa object của owner |
| VID-023 | P1 | PASS | latest | Không phát URL download khi video chưa READY |
| VID-024 | P1 | PASS | latest | Client không tự sửa file_size_bytes/status |
| VID-025 | P1 | PASS | latest | Đường webhook không truy cập bằng CORS/origin |
| VID-026 | P1 | PASS | latest | Presigned URL không bị log toàn chuỗi |
| INPUT-001 | P0 | PASS | latest | JSON syntax hỏng trên endpoint bảo vệ |
| INPUT-002 | P0 | PASS | latest | Mass assignment user/role |
| INPUT-003 | P0 | PASS | latest | SQL injection qua search |
| INPUT-004 | P0 | PASS | latest | SQL injection qua cursor/ID |
| INPUT-005 | P1 | PASS | latest | Trường JSON null/sai type |
| INPUT-006 | P1 | PASS | latest | Giá trị quá dài và nested sâu có giới hạn |
| INPUT-007 | P1 | PASS | latest | Unicode và ký tự điều khiển trong display_name/content |
| INPUT-008 | P1 | PASS | latest | Script trong display_name hoặc tin nhắn |
| INPUT-009 | P1 | PASS | latest | Format video có ký tự điều hướng đường dẫn |
| INPUT-010 | P1 | PASS | latest | Header injection ở các trường hiển thị |
| INPUT-011 | P1 | PASS | latest | Request content-type sai |
| INPUT-012 | P1 | PASS | latest | HTTP method override không vượt xác thực |
| INPUT-013 | P1 | PASS | latest | Duplicate JSON keys nhạy cảm |
| INPUT-014 | P1 | PASS | latest | Error handler không lộ stacktrace/SQL |
| INPUT-015 | P1 | PASS | latest | Tham số phân trang không giới hạn dữ liệu |
| INPUT-016 | P2 | PASS | latest | Content encoding không được hỗ trợ |
| ABUSE-001 | P0 | PASS | latest | Giới hạn tìm kiếm user theo tài khoản |
| ABUSE-002 | P1 | PASS | latest | Rate limit search cách ly A và B |
| ABUSE-003 | P1 | PASS | latest | Rate limit metrics mỗi 3 giây |
| ABUSE-004 | P1 | PASS | latest | Không bypass rate limit qua header giả |
| ABUSE-005 | P1 | PASS | latest | Rate limit đổi key sau TTL đúng |
| ABUSE-006 | P1 | PASS | abuse | Đăng nhập sai nhiều lần có biện pháp chống lạm dụng |
| ABUSE-007 | P1 | PASS | abuse | Đăng ký hàng loạt tài khoản |
| ABUSE-008 | P1 | PASS | latest | Kết nối WebSocket vượt giới hạn |
| ABUSE-009 | P1 | PASS | latest | Gửi sự kiện WS sai liên tục |
| ABUSE-010 | P1 | PASS | latest | Video quota theo user |
| ABUSE-011 | P1 | PASS | multipart | Không mở số lượng phiên multipart vô hạn |
| ABUSE-012 | P2 | PASS | latest | Đối xử công bằng khi một client lỗi liên tiếp |
| INT-001 | P0 | PASS | latest | Không secret tại notify |
| INT-002 | P0 | PASS | latest | JWT người dùng không thay secret notify |
| INT-003 | P0 | PASS | latest | Notify secret sai không có tác dụng |
| INT-004 | P0 | PASS | latest | Không secret tại webhook |
| INT-005 | P0 | PASS | latest | Webhook JWT không thay shared secret |
| INT-006 | P0 | PASS | latest | Không thể dùng secret notify ở webhook |
| INT-007 | P1 | PASS | latest | Secret so sánh chính xác từng byte |
| INT-008 | P1 | PASS | latest | Notify body hợp lệ nhưng actor sai |
| INT-009 | P1 | PASS | latest | Webhook secret đúng nhưng event giả |
| INT-010 | P1 | PASS | latest | Không lộ endpoint nội bộ qua response lỗi |
| INT-011 | P1 | NOT RUN |  | Giới hạn mạng của API nội bộ khi triển khai |
| INT-012 | P1 | PASS | latest | Webhook replay sau khi video đã xóa |
| CONFIG-001 | P0 | PASS | latest | CORS không cho origin trái phép |
| CONFIG-002 | P0 | PASS | latest | Messaging WS kiểm tra Origin |
| CONFIG-003 | P0 | REVIEW_REQUIRED | remaining | Không lộ PostgreSQL/Redis/MinIO ra Internet |
| CONFIG-004 | P0 | PASS | latest | Secret không dùng giá trị mặc định hoặc quá ngắn |
| CONFIG-005 | P0 | NOT RUN |  | HTTPS/WSS bắt buộc ở môi trường public |
| CONFIG-006 | P1 | NOT RUN |  | Security headers được phát ở đường HTTP thật |
| CONFIG-007 | P1 | PASS | latest | Actuator chỉ mở endpoint được phép |
| CONFIG-008 | P1 | PASS | latest | Lỗi 404/500 không hiện stacktrace |
| CONFIG-009 | P1 | NOT RUN |  | Bí mật không nằm trong image, env dump hoặc build artifact công khai |
| CONFIG-010 | P1 | REVIEW_REQUIRED | remaining | Docker không chạy quyền quá cao |
| CONFIG-011 | P1 | NOT RUN |  | Nginx route không vượt filter |
| CONFIG-012 | P1 | NOT RUN |  | Proxy forwarding headers được tin đúng mức |
| CONFIG-013 | P1 | PASS | remaining | Không cache response nhạy cảm ở proxy |
| CONFIG-014 | P1 | NOT RUN |  | Kiểm tra Content Security Policy phía frontend nếu triển khai |
| CONFIG-015 | P1 | PASS | remaining | Time sync của server |
| LOG-001 | P0 | PASS | latest | Access/refresh không xuất hiện trong log |
| LOG-002 | P0 | PASS | latest | Mật khẩu không bị log hoặc trả lại |
| LOG-003 | P0 | PASS | latest | Presigned URL không lộ toàn chuỗi |
| LOG-004 | P0 | PASS | latest | Shared secret internal không xuất hiện trong log |
| LOG-005 | P1 | PASS | latest | Error response không lộ SQL và đường dẫn nội bộ |
| LOG-006 | P1 | PASS | latest | Telemetry không in token hoặc nội dung riêng |
| LOG-007 | P1 | PASS | latest | Không lộ thông tin người khác qua errors |
| LOG-008 | P1 | REVIEW_REQUIRED | remaining | Audit các thao tác bảo mật quan trọng |
| LOG-009 | P1 | PASS | latest | Không lộ thông tin qua JUnit XML |
| LOG-010 | P1 | NOT RUN |  | Giới hạn thông tin được lưu và xóa |
| LOG-011 | P1 | PASS | latest | Không hiển thị secret trong health/metrics |
| SUPPLY-001 | P0 | NOT RUN |  | Quét lỗ hổng dependency Java |
| SUPPLY-002 | P0 | PASS | supply | Quét lỗ hổng dependency signaling |
| SUPPLY-003 | P1 | PASS | supply | Dependency được khóa phiên bản và build tái lập |
| SUPPLY-004 | P1 | REVIEW_REQUIRED | supply | Container images cập nhật và rõ nguồn |
| SUPPLY-005 | P1 | PASS | supply | Không commit secret hoặc private key |
| SUPPLY-006 | P1 | N/A |  | Không cấp CI credential dư quyền |
| SUPPLY-007 | P1 | PASS | supply | Không tải script hoặc binary không kiểm soát khi build |
| SUPPLY-008 | P2 | PASS | supply | SBOM và danh sách phiên bản phát hành |
| CROSS-001 | P0 | PASS | latest | Đăng xuất rồi dùng token cũ ở mọi kênh |
| CROSS-002 | P0 | PASS | latest | Người ngoài không thể tương tác hội thoại bằng nhiều kênh |
| CROSS-003 | P0 | PASS | latest | Không lạm dụng callback notify để mạo danh cuộc gọi |
| CROSS-004 | P0 | PASS | latest | Video ownership xuyên metadata và presigned URL |
| CROSS-005 | P0 | PASS | latest | Xóa tài khoản hủy quyền theo mọi kênh |
| CROSS-006 | P0 | PASS | latest | Thu hồi token và đổi phiên nhiều thiết bị |
| CROSS-007 | P1 | PASS | latest | Payload phản hồi không làm lộ secret thông qua E2E lỗi |
| CROSS-008 | P1 | PASS | latest | CORS/browser và auth backend là lớp khác nhau |
| CROSS-009 | P1 | PASS | latest | Thông báo cuộc gọi không biến thành quyền nhận Offer giả |
| CROSS-010 | P1 | PASS | latest | Xử lý lỗi internal service fail closed |
