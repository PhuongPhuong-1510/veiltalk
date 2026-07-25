# P2-T18 Bước 3 — Xác minh Redis Pub/Sub đa instance

Ngày thực hiện: 2026-07-25 (Asia/Bangkok)  
Branch: `task/P2-T18`  
Kết quả: PASS

## Mục tiêu

Xác minh một Backend instance có thể xử lý REST/publish Redis trong khi WebSocket của
recipient nằm ở Backend instance khác; đồng thời xác minh Redis restart không đóng socket
và subscriber tự phục hồi.

## Môi trường

- PostgreSQL và Redis từ Docker Compose của dự án.
- Backend instance A: `localhost:18081`.
- Backend instance B: `localhost:18082`.
- Hai instance dùng cùng database và Redis.
- Recipient kết nối instance B bằng `wscat`.
- REST tạo message/cập nhật status được gọi vào instance A.
- Không thêm dependency, migration hoặc service lâu dài.

## Kịch bản 1 — Delivery xuyên hai instance

1. Đăng ký sender và recipient tạm.
2. Tạo conversation qua instance A.
3. Mở recipient socket tại
   `ws://localhost:18082/ws/messaging?token=<recipient_access_token>`.
4. Sender gọi `POST /conversations/{id}/messages` tại instance A.
5. Recipient gọi `PUT /conversations/{id}/messages/{messageId}` tại instance A.

Wscat của instance B nhận:

```json
{"type":"PING"}
{"type":"NEW_MESSAGE","data":{"id":"de8f4cdc-301c-48a4-9535-343a1a6f7b23","conversation_id":"8992c373-06f3-47a8-8b52-eb4e120676db","sender_id":"dd3d150c-479c-430b-a597-31a9b6790758","content":"Cross-instance Redis delivery","status":"sent","client_timestamp":"2026-07-24T19:32:55.647256Z","created_at":"2026-07-24T19:32:55.675872Z"}}
{"type":"MESSAGE_STATUS_UPDATE","data":{"id":"de8f4cdc-301c-48a4-9535-343a1a6f7b23","status":"read"}}
```

Kết luận:

- `NEW_MESSAGE` đi từ REST instance A → Redis → subscriber instance B → local socket.
- `data` chứa đủ bảy field của `MessageResponse`.
- `MESSAGE_STATUS_UPDATE` giữ đúng contract `{id,status}`.
- Pattern subscription tĩnh hoạt động khi REST và WebSocket nằm ở hai instance khác nhau.

## Kịch bản 2 — Redis restart và subscriber recovery

1. Giữ một wscat connection đang mở trên instance B.
2. Chạy `docker compose stop redis`.
3. Xác nhận connection monitor ghi `Redis connection disconnected`; socket không bị đóng.
4. Chạy `docker compose start redis`.
5. Chờ Lettuce reconnect rồi publish một envelope `CALL_INCOMING` bằng
   `redis-cli -x PUBLISH` để giữ nguyên JSON.

Cùng socket nhận:

```json
{"type":"PING"}
{"type":"CALL_INCOMING","data":{"caller_id":"4ffab900-54cd-4564-843a-2fea6adfa9ac","caller_display_name":"MonitorProof2","call_session_id":"71dffeed-74d3-4d7e-8587-a3d23558b59c"}}
```

Phép đo health component riêng:

```text
HEALTH_BEFORE=UP
HEALTH_DURING=DEGRADED
HEALTH_AFTER=UP
```

Kết luận:

- Redis outage không đóng WebSocket.
- Lettuce tự reconnect và static pattern subscription tiếp tục nhận event.
- `messagingRedisSubscriber` phản ánh đúng `UP → DEGRADED → UP`.
- `CALL_INCOMING` đã sẵn đường pass-through; trigger chính thức vẫn thuộc P3-T04.
- Event phát trong thời gian Redis mất kết nối không được replay; client phải resync history.

## Test tự động liên quan

```text
MessagingRedisSubscriberTests: 5 PASS
MessagingWebSocketDeliveryIntegrationTests: 3 PASS
P2-T18 Bước 1–3 scoped regression: 41 PASS, 0 failure, 0 error
```

## Cleanup

- Hai Backend process tạm đã dừng; cổng 18081/18082 không còn listen.
- User, refresh token, conversation và message fixture đã xóa; số row còn lại: `0`.
- Redis đã khởi động lại và `redis-cli ping` trả `PONG`.
